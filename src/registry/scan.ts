import { z } from "zod";

import { GROUP_RULES, HCM_SEGMENT_FACADE, type OperationDef } from "./types";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GET_RE = /export\s+(async\s+function|const|function)\s+GET\b|export\s+\{[^}]*\bGET\b/;

/** Convert an api-relative route dir ("hcm/payroll/[id]") to URL path + dynamic params. */
export function toUrlPath(routeRelDir: string): { path: string; pathParams: string[] } {
  const segments = routeRelDir.split("/").filter(Boolean);
  const pathParams: string[] = [];
  const out = segments.map((seg) => {
    const m = seg.match(/^\[(\.\.\.)?(.+)\]$/);
    if (m) {
      pathParams.push(m[2]);
      return `{${m[2]}}`;
    }
    return seg;
  });
  return { path: `/api/${out.join("/")}`, pathParams };
}

/**
 * Classify a URL path to a facade, and return the prefix to strip when building
 * the operation id. HCM routes map by their second segment; everything else by
 * an ordered prefix rule; unmatched routes fall back to "admin".
 */
export function classify(urlPath: string): { facade: string; stripPrefix: string } {
  const segs = urlPath
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean);
  if (segs[0] === "hcm" && segs.length >= 2) {
    const seg = segs[1];
    return { facade: HCM_SEGMENT_FACADE[seg] ?? "admin", stripPrefix: `/api/hcm/${seg}` };
  }
  for (const { prefix, facade } of GROUP_RULES) {
    if (urlPath === prefix || urlPath.startsWith(`${prefix}/`)) return { facade, stripPrefix: prefix };
  }
  return { facade: "admin", stripPrefix: `/api/${segs[0] ?? ""}` };
}

export function assignFacade(urlPath: string): string {
  return classify(urlPath).facade;
}

/** Build a stable operation id: facade + the path tail after the classified prefix. */
function makeId(facade: string, stripPrefix: string, urlPath: string, pathParams: string[]): string {
  let rest = urlPath;
  if (rest === stripPrefix || rest.startsWith(`${stripPrefix}/`)) rest = rest.slice(stripPrefix.length);
  const segs = rest.split("/").filter((s) => s && !s.startsWith("{"));
  const tail = segs.join("_") || "root";
  const suffix = pathParams.length ? `_by_${pathParams.join("_")}` : "";
  const base = `${tail}${suffix}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${facade}.${base || "root"}`;
}

/** Recursively scan an `app/api` dir for route.ts files that export a GET handler. */
export function scanDir(apiDir: string): OperationDef[] {
  const ops: OperationDef[] = [];
  const seen = new Set<string>();

  function walk(dir: string, relDir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, relDir ? `${relDir}/${entry.name}` : entry.name);
      } else if (entry.name === "route.ts") {
        // Strip comments so a commented-out GET handler doesn't register a phantom op.
        const src = readFileSync(abs, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        if (!GET_RE.test(src)) continue;
        const { path, pathParams } = toUrlPath(relDir);
        const { facade, stripPrefix } = classify(path);
        let id = makeId(facade, stripPrefix, path, pathParams);
        let n = 2;
        while (seen.has(id)) id = `${makeId(facade, stripPrefix, path, pathParams)}_${n++}`;
        seen.add(id);
        ops.push({
          id,
          facade,
          method: "GET",
          path,
          pathParams,
          query: z.object({}).passthrough(),
          summary: `GET ${path}`,
        });
      }
    }
  }

  walk(apiDir, "");
  return ops.sort((a, b) => a.id.localeCompare(b.id));
}
