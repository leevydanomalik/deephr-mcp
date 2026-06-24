import { z } from "zod";

import { ANNOTATIONS, applyAnnotations } from "./annotations";
import { REGISTRY } from "./index";
import type { OperationDef } from "./types";
import { describe, expect, test } from "bun:test";

function op(id: string): OperationDef {
  return { id, facade: "employees", method: "GET", path: "/x", pathParams: [], query: z.object({}), summary: id };
}

describe("applyAnnotations", () => {
  test("renames an operation id when the annotation supplies one", () => {
    const reg = applyAnnotations({ employees: [op("employees.root_4")] });
    expect(reg.employees[0].id).toBe("employees.list");
  });

  test("leaves the id untouched when no annotation matches", () => {
    const reg = applyAnnotations({ employees: [op("employees.education_by_id")] });
    expect(reg.employees[0].id).toBe("employees.education_by_id");
  });
});

describe("employees facade ids", () => {
  test("no opaque root* ids survive after annotation", () => {
    const ids = REGISTRY.employees.map((o) => o.id);
    expect(ids.filter((id) => /\.root(_|$)/.test(id))).toEqual([]);
  });

  test("renamed ids are unique (no collisions)", () => {
    const ids = REGISTRY.employees.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every id-rename annotation resolves to a live operation", () => {
    const liveIds = new Set(Object.values(REGISTRY).flatMap((ops) => ops.map((o) => o.id)));
    for (const ann of Object.values(ANNOTATIONS)) {
      if (ann.id) expect(liveIds.has(ann.id)).toBe(true);
    }
  });
});

describe("annotation keys resolve", () => {
  test("every annotation key maps to a live operation (no orphans)", () => {
    const liveIds = new Set(Object.values(REGISTRY).flatMap((ops) => ops.map((o) => o.id)));
    for (const key of Object.keys(ANNOTATIONS)) {
      // Rename annotations move the id; summary/query annotations keep the key as the id.
      const resolved = ANNOTATIONS[key].id ?? key;
      expect(liveIds.has(resolved)).toBe(true);
    }
  });

  test("the recruitment specialist agent ops carry non-generic summaries", () => {
    const byId = new Map(REGISTRY.recruitment.map((o) => [o.id, o]));
    for (const id of [
      "recruitment.agent_rank",
      "recruitment.agent_skill_gap",
      "recruitment.agent_benchmark",
      "recruitment.agent_interview_questions",
      "recruitment.agent_recommendation",
      "recruitment.agent_screen",
    ]) {
      const op = byId.get(id);
      expect(op).toBeDefined();
      expect(op?.summary.startsWith("GET ")).toBe(false);
    }
  });
});
