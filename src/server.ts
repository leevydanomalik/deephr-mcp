import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { DeepHrClient } from "./client";
import { loadConfig } from "./config";
import { buildFacadeTool } from "./facade";
import { REGISTRY } from "./registry/index";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const client = new DeepHrClient(cfg);

  const server = new McpServer({ name: "deephr", version: "0.1.0" });

  let toolCount = 0;
  for (const [facade, ops] of Object.entries(REGISTRY)) {
    if (ops.length === 0) continue;
    buildFacadeTool(server, facade, ops, client);
    toolCount++;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP transport.
  console.error(`deephr-mcp ready: ${toolCount} facade tools, api=${cfg.apiUrl}`);
}

main().catch((e) => {
  console.error("deephr-mcp failed to start:", e);
  process.exit(1);
});
