import { assignFacade, scanDir, toUrlPath } from "./scan";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("toUrlPath", () => {
  test("derives URL path and dynamic params from a route dir", () => {
    const { path, pathParams } = toUrlPath("hcm/payroll/salary-slips/[id]");
    expect(path).toBe("/api/hcm/payroll/salary-slips/{id}");
    expect(pathParams).toEqual(["id"]);
  });

  test("handles routes with no dynamic params", () => {
    const { path, pathParams } = toUrlPath("hcm/payroll/runs");
    expect(path).toBe("/api/hcm/payroll/runs");
    expect(pathParams).toEqual([]);
  });
});

describe("assignFacade", () => {
  test("maps by longest/first matching prefix", () => {
    expect(assignFacade("/api/hcm/payroll/runs")).toBe("payroll");
    expect(assignFacade("/api/hcm/attendance/today")).toBe("attendance");
    expect(assignFacade("/api/recruitment/vacancies")).toBe("recruitment");
  });

  test("falls back to admin for unmatched paths", () => {
    expect(assignFacade("/api/something/weird")).toBe("admin");
  });
});

describe("scanDir", () => {
  test("finds GET-handler routes and builds operation defs", () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-scan-"));
    const api = join(root, "api");
    mkdirSync(join(api, "hcm", "payroll", "runs"), { recursive: true });
    mkdirSync(join(api, "hcm", "payroll", "salary-slips", "[id]"), { recursive: true });
    mkdirSync(join(api, "hcm", "payroll", "run"), { recursive: true });
    writeFileSync(join(api, "hcm", "payroll", "runs", "route.ts"), "export async function GET() {}");
    writeFileSync(join(api, "hcm", "payroll", "salary-slips", "[id]", "route.ts"), "export const GET = () => {}");
    writeFileSync(join(api, "hcm", "payroll", "run", "route.ts"), "export async function POST() {}");

    const ops = scanDir(api);
    const ids = ops.map((o) => o.id).sort();
    expect(ids).toEqual(["payroll.salary_slips_by_id", "payroll.runs"].sort());

    const byId = Object.fromEntries(ops.map((o) => [o.id, o]));
    expect(byId["payroll.runs"].path).toBe("/api/hcm/payroll/runs");
    expect(byId["payroll.salary_slips_by_id"].pathParams).toEqual(["id"]);
    expect(byId["payroll.runs"].facade).toBe("payroll");
  });

  test("derives the recruitment specialist op ids for the agent/* routes", () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-scan-rec-"));
    const api = join(root, "api");
    const mk = (p: string) => {
      mkdirSync(join(api, p), { recursive: true });
      writeFileSync(join(api, p, "route.ts"), "export async function GET() {}");
    };
    mk("hcm/recruitment/agent/rank");
    mk("hcm/recruitment/agent/skill-gap");
    mk("hcm/recruitment/agent/benchmark");
    mk("hcm/recruitment/agent/interview-questions");
    mk("hcm/recruitment/agent/recommendation");
    mk("hcm/recruitment/agent/screen");

    const ids = scanDir(api)
      .map((o) => o.id)
      .sort();
    expect(ids).toEqual(
      [
        "recruitment.agent_benchmark",
        "recruitment.agent_interview_questions",
        "recruitment.agent_rank",
        "recruitment.agent_recommendation",
        "recruitment.agent_screen",
        "recruitment.agent_skill_gap",
      ].sort(),
    );
  });
});
