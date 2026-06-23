// Bundles the stdio server into a single node-runnable ESM file with a shebang,
// so the package can be launched via `npx @deephr/mcp` (npx runs node, not bun).
// Runtime deps (@modelcontextprotocol/sdk, zod) stay external — npm/npx installs
// them from package.json rather than us inlining a copy.
import { chmodSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/server.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  external: ["@modelcontextprotocol/sdk", "zod"],
  banner: "#!/usr/bin/env node",
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}

chmodSync("dist/server.js", 0o755);
console.error("built dist/server.js");
