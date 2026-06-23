import { DeepHrClient } from "./client";
import { describe, expect, test } from "bun:test";

const cfg = { apiUrl: "http://api.test", email: "a@b.c", password: "pw" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DeepHrClient", () => {
  test("logs in then attaches Bearer token on request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/auth/login")) return jsonResponse({ success: true, token: "tok1" });
      return jsonResponse({ data: [1, 2, 3] });
    }) as unknown as typeof fetch;

    const client = new DeepHrClient(cfg, fetchFn);
    const out = await client.request("GET", "/api/hcm/payroll/runs", { status: "completed" });

    expect(out).toEqual({ data: [1, 2, 3] });
    expect(calls[0].url).toBe("http://api.test/api/auth/login");
    expect(calls[1].url).toBe("http://api.test/api/hcm/payroll/runs?status=completed");
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok1");
  });

  test("on 401 refreshes the token and retries once", async () => {
    let dataHits = 0;
    const fetchFn = (async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/auth/login")) return jsonResponse({ success: true, token: "tok1" });
      if (u.endsWith("/api/auth/refresh")) return jsonResponse({ success: true, token: "tok2" });
      dataHits++;
      if (dataHits === 1) return jsonResponse({ error: "unauthorized" }, 401);
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = new DeepHrClient(cfg, fetchFn);
    const out = await client.request("GET", "/api/auth/me");
    expect(out).toEqual({ ok: true });
    expect(dataHits).toBe(2);
  });

  test("throws a typed error on non-2xx after auth recovery", async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/api/auth/login")) return jsonResponse({ success: true, token: "tok1" });
      return jsonResponse({ error: "boom" }, 500);
    }) as unknown as typeof fetch;

    const client = new DeepHrClient(cfg, fetchFn);
    await expect(client.request("GET", "/api/x")).rejects.toThrow(/500/);
  });

  test("throws when login fails", async () => {
    const fetchFn = (async () => jsonResponse({ success: false, error: "bad creds" }, 401)) as unknown as typeof fetch;
    const client = new DeepHrClient(cfg, fetchFn);
    await expect(client.request("GET", "/api/x")).rejects.toThrow(/login/i);
  });
});
