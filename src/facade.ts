import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DeepHrClient } from "./client";
import type { OperationDef } from "./registry/types";

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

function text(t: string): { type: "text"; text: string } {
  return { type: "text", text: t };
}

function err(msg: string): ToolResult {
  return { isError: true, content: [text(msg)] };
}

interface Invocation {
  operation: string;
  params?: Record<string, unknown>;
}

/** Pure core: resolve the op, validate, build URL parts, proxy, format. */
export async function runOperation(
  ops: OperationDef[],
  client: Pick<DeepHrClient, "request">,
  input: Invocation,
): Promise<ToolResult> {
  const op = ops.find((o) => o.id === input.operation);
  if (!op) {
    const known = ops.map((o) => o.id).join(", ");
    return err(`Unknown operation "${input.operation}". Available: ${known}`);
  }

  const params = input.params ?? {};

  const pathShape: z.ZodRawShape = {};
  for (const p of op.pathParams) pathShape[p] = z.union([z.string(), z.number()]);
  // .merge() adopts the second schema's unknownKeys mode (strip), which would
  // discard op.query's .passthrough() and silently drop every undeclared query
  // param (company, pageSize, …). Re-apply passthrough so they reach the backend.
  const schema = op.query.merge(z.object(pathShape)).passthrough();
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return err(
      `Invalid params for ${op.id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const data = parsed.data as Record<string, unknown>;

  let path = op.path;
  const query: Record<string, unknown> = { ...data };
  for (const p of op.pathParams) {
    path = path.replace(`{${p}}`, encodeURIComponent(String(data[p])));
    delete query[p];
  }

  try {
    const result = await client.request(op.method, path, query);
    return { content: [text(JSON.stringify(result, null, 2))] };
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/** Register a `deephr_<facade>` tool backed by its operation list. */
export function buildFacadeTool(server: McpServer, facade: string, ops: OperationDef[], client: DeepHrClient): void {
  const catalog = ops.map((o) => `- ${o.id}: ${o.summary}`).join("\n");
  const description = `Read deepHR ${facade} data. Set "operation" to one of:\n${catalog}\nPass any path/query params via "params".`;

  server.registerTool(
    `deephr_${facade}`,
    {
      description,
      inputSchema: {
        operation: z.string().describe("The operation id, e.g. one listed in the tool description."),
        params: z.record(z.string(), z.unknown()).optional().describe("Path and query parameters for the operation."),
      },
    },
    async (args: { operation: string; params?: Record<string, unknown> }) => {
      const res = await runOperation(ops, client, args);
      return res as never;
    },
  );
}
