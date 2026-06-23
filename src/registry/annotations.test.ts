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
