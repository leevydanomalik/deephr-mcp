import { z } from "zod";

import { runOperation } from "./facade";
import type { OperationDef } from "./registry/types";
import { describe, expect, test } from "bun:test";

const ops: OperationDef[] = [
  {
    id: "payroll.runs",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/runs",
    pathParams: [],
    query: z.object({ status: z.string().optional() }).passthrough(),
    summary: "List payroll runs",
  },
  {
    id: "payroll.salary_slips_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-slips/{id}",
    pathParams: ["id"],
    query: z.object({}).passthrough(),
    summary: "Get a salary slip",
  },
];

function fakeClient(captured: { method?: string; path?: string; query?: unknown }) {
  return {
    request: async (method: string, path: string, query?: Record<string, unknown>) => {
      captured.method = method;
      captured.path = path;
      captured.query = query;
      return { ok: true };
    },
  };
}

describe("runOperation", () => {
  test("proxies a simple read with query params", async () => {
    const cap: { method?: string; path?: string; query?: unknown } = {};
    const res = await runOperation(ops, fakeClient(cap) as never, {
      operation: "payroll.runs",
      params: { status: "completed" },
    });
    expect(cap.path).toBe("/api/hcm/payroll/runs");
    expect(cap.query).toEqual({ status: "completed" });
    expect(res.isError).toBeFalsy();
  });

  test("forwards undeclared query params (passthrough survives the path-param merge)", async () => {
    const cap: { method?: string; path?: string; query?: unknown } = {};
    await runOperation(ops, fakeClient(cap) as never, {
      operation: "payroll.runs",
      params: { company: "DEEPHEALTH_MY", pageSize: 1 },
    });
    expect(cap.query).toEqual({ company: "DEEPHEALTH_MY", pageSize: 1 });
  });

  test("substitutes path params and excludes them from query", async () => {
    const cap: { method?: string; path?: string; query?: unknown } = {};
    await runOperation(ops, fakeClient(cap) as never, {
      operation: "payroll.salary_slips_by_id",
      params: { id: "abc123" },
    });
    expect(cap.path).toBe("/api/hcm/payroll/salary-slips/abc123");
    expect(cap.query).toEqual({});
  });

  test("returns an MCP error for unknown operation", async () => {
    const cap = {};
    const res = await runOperation(ops, fakeClient(cap) as never, { operation: "nope", params: {} });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/unknown operation/i);
  });

  test("returns an MCP error when a required path param is missing", async () => {
    const cap = {};
    const res = await runOperation(ops, fakeClient(cap) as never, {
      operation: "payroll.salary_slips_by_id",
      params: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/id/);
  });

  test("maps an upstream client error to an MCP error", async () => {
    const throwingClient = {
      request: async () => {
        throw new Error("deepHR API 500 for GET /x: boom");
      },
    };
    const res = await runOperation(ops, throwingClient as never, {
      operation: "payroll.runs",
      params: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/500/);
  });
});
