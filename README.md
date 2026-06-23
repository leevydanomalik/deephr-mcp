# deephr-mcp

Read-only MCP server exposing deepHR's modules to MCP clients (Claude Desktop /
Claude Code). It proxies read calls to the deepHR backend `/api/*` over HTTP,
authenticating with a service account and refreshing the JWT on 401.

## Install (clients)

No clone needed — run it straight from GitHub with `npx`:

```bash
claude mcp add deephr -s user \
  -e DEEPHR_API_URL=https://deephr.your-cloud-domain.com \
  -e DEEPHR_EMAIL=you@yourco.com \
  -e DEEPHR_PASSWORD=... \
  -- npx -y github:leevydanomalik/deephr-mcp
```

(If/when published to npm, swap the last line for `npx -y deephr-mcp`.)

`-s user` makes it global (available in every project on that machine). Each user
only changes `DEEPHR_API_URL` (the deployed backend) and their own login. Needs
Node >= 18.

## Run (local dev)

```bash
DEEPHR_EMAIL=svc@yourco.com DEEPHR_PASSWORD=... bun run src/server.ts
```

The backend must be running (default `http://localhost:4445`).

## Build & publish (maintainers)

```bash
bun run build     # bundles src/ -> dist/server.js (node ESM, shebang, npx-runnable)
npm publish       # prepublishOnly runs the build automatically
```

`deephr-mcp` is an unscoped public package — `npm login` once, then `npm publish`.

## Env

| Var | Default | Purpose |
|---|---|---|
| `DEEPHR_API_URL` | `http://localhost:4445` | Backend base URL |
| `DEEPHR_EMAIL` | (required) | Service-identity login (use an admin/superadmin account) |
| `DEEPHR_PASSWORD` | (required) | Service-identity password |

## Register in Claude Code / Desktop

```json
{
  "mcpServers": {
    "deephr": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/deepHR/mcp/src/server.ts"],
      "env": {
        "DEEPHR_API_URL": "http://localhost:4445",
        "DEEPHR_EMAIL": "svc@yourco.com",
        "DEEPHR_PASSWORD": "..."
      }
    }
  }
}
```

## Tools

~16 facade tools (`deephr_payroll`, `deephr_employees`, …). Each takes
`{ operation, params }`. See a tool's description for its operation catalog.

## Maintaining the registry

Routes are scanned from `backend/src/app/api`:

```bash
bun run scan   # regenerates src/registry/<facade>.ts + index.ts
```

Hand-tune hot operations (better summaries, real query schemas) in
`src/registry/annotations.ts` — that layer survives re-scans.
