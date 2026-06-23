#!/usr/bin/env node
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/client.ts
class DeepHrClient {
  cfg;
  fetchFn;
  token;
  constructor(cfg, fetchFn = fetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }
  async login() {
    const res = await this.fetchFn(`${this.cfg.apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.cfg.email, password: this.cfg.password })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success || !body.token) {
      throw new Error(`deepHR login failed (${res.status}): ${body.error ?? "no token returned"}`);
    }
    this.token = body.token;
  }
  async refresh() {
    if (!this.token)
      return false;
    const res = await this.fetchFn(`${this.cfg.apiUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (!res.ok)
      return false;
    const body = await res.json().catch(() => ({}));
    if (!body.success || !body.token)
      return false;
    this.token = body.token;
    return true;
  }
  buildUrl(path, query) {
    const url = new URL(this.cfg.apiUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null)
          url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
  async fire(method, url) {
    return this.fetchFn(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}` }
    });
  }
  async request(method, path, query) {
    if (!this.token)
      await this.login();
    const url = this.buildUrl(path, query);
    let res = await this.fire(method, url);
    if (res.status === 401) {
      const refreshed = await this.refresh();
      if (!refreshed)
        await this.login();
      res = await this.fire(method, url);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`deepHR API ${res.status} for ${method} ${path}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }
}

// src/config.ts
function loadConfig(env = process.env) {
  const email = env.DEEPHR_EMAIL;
  const password = env.DEEPHR_PASSWORD;
  if (!email)
    throw new Error("Missing required env: DEEPHR_EMAIL");
  if (!password)
    throw new Error("Missing required env: DEEPHR_PASSWORD");
  return {
    apiUrl: env.DEEPHR_API_URL ?? "http://localhost:4445",
    email,
    password
  };
}

// src/facade.ts
import { z } from "zod";
function text(t) {
  return { type: "text", text: t };
}
function err(msg) {
  return { isError: true, content: [text(msg)] };
}
async function runOperation(ops, client, input) {
  const op = ops.find((o) => o.id === input.operation);
  if (!op) {
    const known = ops.map((o) => o.id).join(", ");
    return err(`Unknown operation "${input.operation}". Available: ${known}`);
  }
  const params = input.params ?? {};
  const pathShape = {};
  for (const p of op.pathParams)
    pathShape[p] = z.union([z.string(), z.number()]);
  const schema = op.query.merge(z.object(pathShape)).passthrough();
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return err(`Invalid params for ${op.id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const data = parsed.data;
  let path = op.path;
  const query = { ...data };
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
function buildFacadeTool(server, facade, ops, client) {
  const catalog = ops.map((o) => `- ${o.id}: ${o.summary}`).join(`
`);
  const description = `Read deepHR ${facade} data. Set "operation" to one of:
${catalog}
Pass any path/query params via "params".`;
  server.registerTool(`deephr_${facade}`, {
    description,
    inputSchema: {
      operation: z.string().describe("The operation id, e.g. one listed in the tool description."),
      params: z.record(z.string(), z.unknown()).optional().describe("Path and query parameters for the operation.")
    }
  }, async (args) => {
    const res = await runOperation(ops, client, args);
    return res;
  });
}

// src/registry/admin.ts
import { z as z2 } from "zod";
var adminOps = [
  {
    id: "admin.applicants",
    facade: "admin",
    method: "GET",
    path: "/api/public/applicants",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/public/applicants"
  },
  {
    id: "admin.applicants_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/public/applicants/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/public/applicants/{id}"
  },
  {
    id: "admin.approval_delegations",
    facade: "admin",
    method: "GET",
    path: "/api/admin/approval-delegations",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/approval-delegations"
  },
  {
    id: "admin.approval_workflows",
    facade: "admin",
    method: "GET",
    path: "/api/admin/approval-workflows",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/approval-workflows"
  },
  {
    id: "admin.approval_workflows_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/approval-workflows/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/approval-workflows/{id}"
  },
  {
    id: "admin.approval_workflows_steps_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/approval-workflows/{id}/steps",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/approval-workflows/{id}/steps"
  },
  {
    id: "admin.archetypes_by_cid",
    facade: "admin",
    method: "GET",
    path: "/api/ckm/archetypes/{cid}",
    pathParams: ["cid"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/ckm/archetypes/{cid}"
  },
  {
    id: "admin.archetypes_search",
    facade: "admin",
    method: "GET",
    path: "/api/ckm/archetypes/search",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/ckm/archetypes/search"
  },
  {
    id: "admin.archetypes_xml_by_cid",
    facade: "admin",
    method: "GET",
    path: "/api/ckm/archetypes/{cid}/xml",
    pathParams: ["cid"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/ckm/archetypes/{cid}/xml"
  },
  {
    id: "admin.audit_activity_log",
    facade: "admin",
    method: "GET",
    path: "/api/admin/audit/activity-log",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/audit/activity-log"
  },
  {
    id: "admin.audit_compliance",
    facade: "admin",
    method: "GET",
    path: "/api/admin/audit/compliance",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/audit/compliance"
  },
  {
    id: "admin.automation_plugins",
    facade: "admin",
    method: "GET",
    path: "/api/admin/automation-plugins",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/automation-plugins"
  },
  {
    id: "admin.companies",
    facade: "admin",
    method: "GET",
    path: "/api/admin/companies",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/companies"
  },
  {
    id: "admin.conversations",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/ai-agent/conversations",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/ai-agent/conversations"
  },
  {
    id: "admin.conversations_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/ai-agent/conversations/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/ai-agent/conversations/{id}"
  },
  {
    id: "admin.exchange_rates",
    facade: "admin",
    method: "GET",
    path: "/api/admin/exchange-rates",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/exchange-rates"
  },
  {
    id: "admin.groups",
    facade: "admin",
    method: "GET",
    path: "/api/admin/groups",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/groups"
  },
  {
    id: "admin.groups_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/groups/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/groups/{id}"
  },
  {
    id: "admin.groups_members_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/groups/{id}/members",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/groups/{id}/members"
  },
  {
    id: "admin.history_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/approvals/{id}/history",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/approvals/{id}/history"
  },
  {
    id: "admin.instances",
    facade: "admin",
    method: "GET",
    path: "/api/camunda/instances",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/camunda/instances"
  },
  {
    id: "admin.integration_directory",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/directory",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/directory"
  },
  {
    id: "admin.integration_directory_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/directory/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/directory/{id}"
  },
  {
    id: "admin.integration_erp",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/erp",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/erp"
  },
  {
    id: "admin.integration_erp_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/erp/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/erp/{id}"
  },
  {
    id: "admin.integration_finance",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/finance",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/finance"
  },
  {
    id: "admin.integration_finance_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/finance/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/finance/{id}"
  },
  {
    id: "admin.integration_fingerprint_devices",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/fingerprint-devices",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/fingerprint-devices"
  },
  {
    id: "admin.integration_fingerprint_devices_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/fingerprint-devices/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/fingerprint-devices/{id}"
  },
  {
    id: "admin.integration_webhooks",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/webhooks",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/webhooks"
  },
  {
    id: "admin.integration_webhooks_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/webhooks/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/webhooks/{id}"
  },
  {
    id: "admin.integration_workflow",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/workflow",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/workflow"
  },
  {
    id: "admin.integration_workflow_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/integration/workflow/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/integration/workflow/{id}"
  },
  {
    id: "admin.layout_bootstrap",
    facade: "admin",
    method: "GET",
    path: "/api/admin/layout-bootstrap",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/layout-bootstrap"
  },
  {
    id: "admin.locations",
    facade: "admin",
    method: "GET",
    path: "/api/admin/locations",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/locations"
  },
  {
    id: "admin.me",
    facade: "admin",
    method: "GET",
    path: "/api/auth/me",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/auth/me"
  },
  {
    id: "admin.mentions",
    facade: "admin",
    method: "GET",
    path: "/api/users/mentions",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/users/mentions"
  },
  {
    id: "admin.openapi",
    facade: "admin",
    method: "GET",
    path: "/api/public/openapi",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/public/openapi"
  },
  {
    id: "admin.openings",
    facade: "admin",
    method: "GET",
    path: "/api/public/openings",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/public/openings"
  },
  {
    id: "admin.pending",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/approvals/pending",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/approvals/pending"
  },
  {
    id: "admin.permissions",
    facade: "admin",
    method: "GET",
    path: "/api/auth/permissions",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/auth/permissions"
  },
  {
    id: "admin.permissions_2",
    facade: "admin",
    method: "GET",
    path: "/api/admin/permissions",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/permissions"
  },
  {
    id: "admin.permissions_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/permissions/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/permissions/{id}"
  },
  {
    id: "admin.plugins",
    facade: "admin",
    method: "GET",
    path: "/api/integrations/plugins",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/integrations/plugins"
  },
  {
    id: "admin.process_definitions",
    facade: "admin",
    method: "GET",
    path: "/api/camunda/process-definitions",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/camunda/process-definitions"
  },
  {
    id: "admin.process_definitions_xml_by_key",
    facade: "admin",
    method: "GET",
    path: "/api/camunda/process-definitions/{key}/xml",
    pathParams: ["key"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/camunda/process-definitions/{key}/xml"
  },
  {
    id: "admin.regions",
    facade: "admin",
    method: "GET",
    path: "/api/admin/regions",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/regions"
  },
  {
    id: "admin.roles",
    facade: "admin",
    method: "GET",
    path: "/api/admin/roles",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/roles"
  },
  {
    id: "admin.roles_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/roles/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/roles/{id}"
  },
  {
    id: "admin.roles_permissions_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/admin/roles/{id}/permissions",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/roles/{id}/permissions"
  },
  {
    id: "admin.root",
    facade: "admin",
    method: "GET",
    path: "/api/seed",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/seed"
  },
  {
    id: "admin.root_2",
    facade: "admin",
    method: "GET",
    path: "/api/groups",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/groups"
  },
  {
    id: "admin.root_3",
    facade: "admin",
    method: "GET",
    path: "/api/audit",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/audit"
  },
  {
    id: "admin.root_4",
    facade: "admin",
    method: "GET",
    path: "/api/users",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/users"
  },
  {
    id: "admin.root_5",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/reminder-settings",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/reminder-settings"
  },
  {
    id: "admin.root_6",
    facade: "admin",
    method: "GET",
    path: "/api/opt",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/opt"
  },
  {
    id: "admin.root_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/users/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/users/{id}"
  },
  {
    id: "admin.routing_rules",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/helpdesk/routing-rules",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/helpdesk/routing-rules"
  },
  {
    id: "admin.stats_users",
    facade: "admin",
    method: "GET",
    path: "/api/admin/stats/users",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/admin/stats/users"
  },
  {
    id: "admin.system",
    facade: "admin",
    method: "GET",
    path: "/api/configuration/system",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/configuration/system"
  },
  {
    id: "admin.tasks",
    facade: "admin",
    method: "GET",
    path: "/api/camunda/tasks",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/camunda/tasks"
  },
  {
    id: "admin.templates_opt_by_cid",
    facade: "admin",
    method: "GET",
    path: "/api/ckm/templates/{cid}/opt",
    pathParams: ["cid"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/ckm/templates/{cid}/opt"
  },
  {
    id: "admin.templates_search",
    facade: "admin",
    method: "GET",
    path: "/api/ckm/templates/search",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/ckm/templates/search"
  },
  {
    id: "admin.testimonials",
    facade: "admin",
    method: "GET",
    path: "/api/landing/testimonials",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/landing/testimonials"
  },
  {
    id: "admin.tickets",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/helpdesk/tickets",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/helpdesk/tickets"
  },
  {
    id: "admin.tickets_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/hcm/helpdesk/tickets/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/hcm/helpdesk/tickets/{id}"
  },
  {
    id: "admin.v1_applicants",
    facade: "admin",
    method: "GET",
    path: "/api/public/v1/applicants",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/public/v1/applicants"
  },
  {
    id: "admin.v1_applicants_by_id",
    facade: "admin",
    method: "GET",
    path: "/api/public/v1/applicants/{id}",
    pathParams: ["id"],
    query: z2.object({}).passthrough(),
    summary: "GET /api/public/v1/applicants/{id}"
  },
  {
    id: "admin.v1_openapi_json",
    facade: "admin",
    method: "GET",
    path: "/api/public/v1/openapi.json",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/public/v1/openapi.json"
  },
  {
    id: "admin.worklist",
    facade: "admin",
    method: "GET",
    path: "/api/camunda/worklist",
    pathParams: [],
    query: z2.object({}).passthrough(),
    summary: "GET /api/camunda/worklist"
  }
];

// src/registry/analytics.ts
import { z as z3 } from "zod";
var analyticsOps = [
  {
    id: "analytics.alerts",
    facade: "analytics",
    method: "GET",
    path: "/api/admin/analytics/alerts",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/admin/analytics/alerts"
  },
  {
    id: "analytics.alerts_events",
    facade: "analytics",
    method: "GET",
    path: "/api/admin/analytics/alerts/events",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/admin/analytics/alerts/events"
  },
  {
    id: "analytics.attrition",
    facade: "analytics",
    method: "GET",
    path: "/api/admin/analytics/attrition",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/admin/analytics/attrition"
  },
  {
    id: "analytics.consolidated",
    facade: "analytics",
    method: "GET",
    path: "/api/reports/consolidated",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/reports/consolidated"
  },
  {
    id: "analytics.data_by_id",
    facade: "analytics",
    method: "GET",
    path: "/api/kpi-plugins/{id}/data",
    pathParams: ["id"],
    query: z3.object({}).passthrough(),
    summary: "GET /api/kpi-plugins/{id}/data"
  },
  {
    id: "analytics.footprint",
    facade: "analytics",
    method: "GET",
    path: "/api/hcm/green-hr/footprint",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/hcm/green-hr/footprint"
  },
  {
    id: "analytics.initiatives",
    facade: "analytics",
    method: "GET",
    path: "/api/hcm/green-hr/initiatives",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/hcm/green-hr/initiatives"
  },
  {
    id: "analytics.layouts",
    facade: "analytics",
    method: "GET",
    path: "/api/kpi-plugins/layouts",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/kpi-plugins/layouts"
  },
  {
    id: "analytics.overview",
    facade: "analytics",
    method: "GET",
    path: "/api/hcm/green-hr/overview",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/hcm/green-hr/overview"
  },
  {
    id: "analytics.root",
    facade: "analytics",
    method: "GET",
    path: "/api/kpi-plugins",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/kpi-plugins"
  },
  {
    id: "analytics.runs",
    facade: "analytics",
    method: "GET",
    path: "/api/admin/reports/runs",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/admin/reports/runs"
  },
  {
    id: "analytics.schedules",
    facade: "analytics",
    method: "GET",
    path: "/api/admin/reports/schedules",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/admin/reports/schedules"
  },
  {
    id: "analytics.schedules_export_by_id",
    facade: "analytics",
    method: "GET",
    path: "/api/admin/reports/schedules/{id}/export",
    pathParams: ["id"],
    query: z3.object({}).passthrough(),
    summary: "GET /api/admin/reports/schedules/{id}/export"
  },
  {
    id: "analytics.users",
    facade: "analytics",
    method: "GET",
    path: "/api/reports/users",
    pathParams: [],
    query: z3.object({}).passthrough(),
    summary: "GET /api/reports/users"
  }
];

// src/registry/annotations.ts
import { z as z4 } from "zod";
var ANNOTATIONS = {
  "payroll.runs": {
    summary: "List payroll runs, optionally filtered by status.",
    query: z4.object({ status: z4.string().optional(), periodId: z4.string().optional() }).passthrough()
  },
  "employees.root": { id: "employees.change_requests" },
  "employees.root_by_id": { id: "employees.change_request_by_id" },
  "employees.root_2": { id: "employees.contracts" },
  "employees.root_by_id_2": { id: "employees.contract_by_id" },
  "employees.documents_by_id": { id: "employees.contract_documents" },
  "employees.documents_by_id_docId": { id: "employees.contract_document_by_id" },
  "employees.root_3": { id: "employees.documents" },
  "employees.root_by_id_3": { id: "employees.document_by_id" },
  "employees.download_by_id": { id: "employees.document_download" },
  "employees.shares_by_id": { id: "employees.document_shares" },
  "employees.versions_by_id": { id: "employees.document_versions" },
  "employees.versions_download_by_id_versionId": { id: "employees.document_version_download" },
  "employees.root_4": { id: "employees.list" },
  "employees.root_by_id_4": { id: "employees.by_id" },
  "employees.documents": { id: "employees.onboarding_documents" },
  "employees.templates": { id: "employees.onboarding_templates" },
  "employees.templates_by_id": { id: "employees.onboarding_template_by_id" },
  "employees.stats": { id: "employees.lifecycle_stats" },
  "employees.documents_by_entityType_entityId": { id: "employees.lifecycle_documents" }
};
function applyAnnotations(reg) {
  for (const ops of Object.values(reg)) {
    for (const op of ops) {
      const a = ANNOTATIONS[op.id];
      if (!a)
        continue;
      if (a.id)
        op.id = a.id;
      if (a.summary)
        op.summary = a.summary;
      if (a.query)
        op.query = a.query;
    }
  }
  return reg;
}

// src/registry/attendance.ts
import { z as z5 } from "zod";
var attendanceOps = [
  {
    id: "attendance.analytics_by_id",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/projects/{id}/analytics",
    pathParams: ["id"],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/projects/{id}/analytics"
  },
  {
    id: "attendance.anomalies",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance/anomalies",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance/anomalies"
  },
  {
    id: "attendance.corrections",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance/corrections",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance/corrections"
  },
  {
    id: "attendance.department_shifts",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance/department-shifts",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance/department-shifts"
  },
  {
    id: "attendance.holidays",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance/holidays",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance/holidays"
  },
  {
    id: "attendance.pay_preview",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/overtime/pay-preview",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/overtime/pay-preview"
  },
  {
    id: "attendance.root",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance"
  },
  {
    id: "attendance.root_2",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/timesheets",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/timesheets"
  },
  {
    id: "attendance.root_3",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/overtime-rules",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/overtime-rules"
  },
  {
    id: "attendance.root_4",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/projects",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/projects"
  },
  {
    id: "attendance.root_5",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/overtime",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/overtime"
  },
  {
    id: "attendance.root_by_id",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance/{id}",
    pathParams: ["id"],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance/{id}"
  },
  {
    id: "attendance.root_by_id_2",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/timesheets/{id}",
    pathParams: ["id"],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/timesheets/{id}"
  },
  {
    id: "attendance.root_by_id_3",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/overtime-rules/{id}",
    pathParams: ["id"],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/overtime-rules/{id}"
  },
  {
    id: "attendance.root_by_id_4",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/projects/{id}",
    pathParams: ["id"],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/projects/{id}"
  },
  {
    id: "attendance.root_by_id_5",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/overtime/{id}",
    pathParams: ["id"],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/overtime/{id}"
  },
  {
    id: "attendance.settings",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance/settings",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance/settings"
  },
  {
    id: "attendance.shifts",
    facade: "attendance",
    method: "GET",
    path: "/api/hcm/attendance/shifts",
    pathParams: [],
    query: z5.object({}).passthrough(),
    summary: "GET /api/hcm/attendance/shifts"
  }
];

// src/registry/compliance.ts
import { z as z6 } from "zod";
var complianceOps = [
  {
    id: "compliance.overview",
    facade: "compliance",
    method: "GET",
    path: "/api/hcm/compliance/overview",
    pathParams: [],
    query: z6.object({}).passthrough(),
    summary: "GET /api/hcm/compliance/overview"
  },
  {
    id: "compliance.policies",
    facade: "compliance",
    method: "GET",
    path: "/api/hcm/compliance/policies",
    pathParams: [],
    query: z6.object({}).passthrough(),
    summary: "GET /api/hcm/compliance/policies"
  },
  {
    id: "compliance.requirements",
    facade: "compliance",
    method: "GET",
    path: "/api/hcm/compliance/requirements",
    pathParams: [],
    query: z6.object({}).passthrough(),
    summary: "GET /api/hcm/compliance/requirements"
  }
];

// src/registry/employees.ts
import { z as z7 } from "zod";
var employeesOps = [
  {
    id: "employees.custom_fields",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employees/custom-fields",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employees/custom-fields"
  },
  {
    id: "employees.documents",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/onboarding/documents",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/onboarding/documents"
  },
  {
    id: "employees.documents_by_entityType_entityId",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/{entityType}/{entityId}/documents",
    pathParams: ["entityType", "entityId"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/{entityType}/{entityId}/documents"
  },
  {
    id: "employees.documents_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/contracts/{id}/documents",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/contracts/{id}/documents"
  },
  {
    id: "employees.documents_by_id_docId",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/contracts/{id}/documents/{docId}",
    pathParams: ["id", "docId"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/contracts/{id}/documents/{docId}"
  },
  {
    id: "employees.download_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/hcm-documents/{id}/download",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/hcm-documents/{id}/download"
  },
  {
    id: "employees.education_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employees/{id}/education",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employees/{id}/education"
  },
  {
    id: "employees.employee_demotions",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-demotions",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-demotions"
  },
  {
    id: "employees.employee_demotions_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-demotions/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-demotions/{id}"
  },
  {
    id: "employees.employee_onboardings",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-onboardings",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-onboardings"
  },
  {
    id: "employees.employee_onboardings_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-onboardings/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-onboardings/{id}"
  },
  {
    id: "employees.employee_promotions",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-promotions",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-promotions"
  },
  {
    id: "employees.employee_promotions_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-promotions/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-promotions/{id}"
  },
  {
    id: "employees.employee_rotations",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-rotations",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-rotations"
  },
  {
    id: "employees.employee_rotations_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-rotations/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-rotations/{id}"
  },
  {
    id: "employees.employee_separations",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-separations",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-separations"
  },
  {
    id: "employees.employee_separations_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-separations/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-separations/{id}"
  },
  {
    id: "employees.employee_skill_maps",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-skill-maps",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-skill-maps"
  },
  {
    id: "employees.employee_skill_maps_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-skill-maps/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-skill-maps/{id}"
  },
  {
    id: "employees.employee_transfers",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-transfers",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-transfers"
  },
  {
    id: "employees.employee_transfers_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/employee-transfers/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/employee-transfers/{id}"
  },
  {
    id: "employees.exit_interviews",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/exit-interviews",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/exit-interviews"
  },
  {
    id: "employees.exit_interviews_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/exit-interviews/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/exit-interviews/{id}"
  },
  {
    id: "employees.export",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employees/export",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employees/export"
  },
  {
    id: "employees.full_and_final_statements",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/full-and-final-statements",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/full-and-final-statements"
  },
  {
    id: "employees.full_and_final_statements_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/full-and-final-statements/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/full-and-final-statements/{id}"
  },
  {
    id: "employees.geo",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employees/geo",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employees/geo"
  },
  {
    id: "employees.root",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/info-change-requests",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/info-change-requests"
  },
  {
    id: "employees.root_2",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/contracts",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/contracts"
  },
  {
    id: "employees.root_3",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/hcm-documents",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/hcm-documents"
  },
  {
    id: "employees.root_4",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employees",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employees"
  },
  {
    id: "employees.root_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/info-change-requests/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/info-change-requests/{id}"
  },
  {
    id: "employees.root_by_id_2",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/contracts/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/contracts/{id}"
  },
  {
    id: "employees.root_by_id_3",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/hcm-documents/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/hcm-documents/{id}"
  },
  {
    id: "employees.root_by_id_4",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employees/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employees/{id}"
  },
  {
    id: "employees.shares_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/hcm-documents/{id}/shares",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/hcm-documents/{id}/shares"
  },
  {
    id: "employees.stats",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employee-lifecycle/stats",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employee-lifecycle/stats"
  },
  {
    id: "employees.templates",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/onboarding/templates",
    pathParams: [],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/onboarding/templates"
  },
  {
    id: "employees.templates_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/onboarding/templates/{id}",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/onboarding/templates/{id}"
  },
  {
    id: "employees.versions_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/hcm-documents/{id}/versions",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/hcm-documents/{id}/versions"
  },
  {
    id: "employees.versions_download_by_id_versionId",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/hcm-documents/{id}/versions/{versionId}/download",
    pathParams: ["id", "versionId"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/hcm-documents/{id}/versions/{versionId}/download"
  },
  {
    id: "employees.work_history_by_id",
    facade: "employees",
    method: "GET",
    path: "/api/hcm/employees/{id}/work-history",
    pathParams: ["id"],
    query: z7.object({}).passthrough(),
    summary: "GET /api/hcm/employees/{id}/work-history"
  }
];

// src/registry/engagement.ts
import { z as z8 } from "zod";
var engagementOps = [
  {
    id: "engagement.action_plans",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/action-plans",
    pathParams: [],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/action-plans"
  },
  {
    id: "engagement.action_plans_updates_by_id",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/action-plans/{id}/updates",
    pathParams: ["id"],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/action-plans/{id}/updates"
  },
  {
    id: "engagement.analytics",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/employee-relations/analytics",
    pathParams: [],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/employee-relations/analytics"
  },
  {
    id: "engagement.analytics_2",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/analytics",
    pathParams: [],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/analytics"
  },
  {
    id: "engagement.cases",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/employee-relations/cases",
    pathParams: [],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/employee-relations/cases"
  },
  {
    id: "engagement.cases_by_id",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/employee-relations/cases/{id}",
    pathParams: ["id"],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/employee-relations/cases/{id}"
  },
  {
    id: "engagement.drivers",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/drivers",
    pathParams: [],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/drivers"
  },
  {
    id: "engagement.question_bank",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/question-bank",
    pathParams: [],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/question-bank"
  },
  {
    id: "engagement.surveys",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/surveys",
    pathParams: [],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/surveys"
  },
  {
    id: "engagement.surveys_assignments_by_id",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/surveys/{id}/assignments",
    pathParams: ["id"],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/surveys/{id}/assignments"
  },
  {
    id: "engagement.surveys_by_id",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/surveys/{id}",
    pathParams: ["id"],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/surveys/{id}"
  },
  {
    id: "engagement.surveys_results_by_id",
    facade: "engagement",
    method: "GET",
    path: "/api/hcm/engagement/surveys/{id}/results",
    pathParams: ["id"],
    query: z8.object({}).passthrough(),
    summary: "GET /api/hcm/engagement/surveys/{id}/results"
  }
];

// src/registry/ess.ts
import { z as z9 } from "zod";
var essOps = [
  {
    id: "ess.attendance_corrections",
    facade: "ess",
    method: "GET",
    path: "/api/ess/attendance/corrections",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/attendance/corrections"
  },
  {
    id: "ess.attendance_history",
    facade: "ess",
    method: "GET",
    path: "/api/ess/attendance/history",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/attendance/history"
  },
  {
    id: "ess.attendance_records",
    facade: "ess",
    method: "GET",
    path: "/api/ess/attendance/records",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/attendance/records"
  },
  {
    id: "ess.attendance_statistics",
    facade: "ess",
    method: "GET",
    path: "/api/ess/attendance/statistics",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/attendance/statistics"
  },
  {
    id: "ess.attendance_summary",
    facade: "ess",
    method: "GET",
    path: "/api/ess/attendance/summary",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/attendance/summary"
  },
  {
    id: "ess.attendance_today",
    facade: "ess",
    method: "GET",
    path: "/api/ess/attendance/today",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/attendance/today"
  },
  {
    id: "ess.benefits",
    facade: "ess",
    method: "GET",
    path: "/api/ess/benefits",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/benefits"
  },
  {
    id: "ess.benefits_transactions",
    facade: "ess",
    method: "GET",
    path: "/api/ess/benefits/transactions",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/benefits/transactions"
  },
  {
    id: "ess.benefits_transactions_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/benefits/transactions/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/benefits/transactions/{id}"
  },
  {
    id: "ess.calendar",
    facade: "ess",
    method: "GET",
    path: "/api/ess/calendar",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/calendar"
  },
  {
    id: "ess.claims",
    facade: "ess",
    method: "GET",
    path: "/api/ess/claims",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/claims"
  },
  {
    id: "ess.claims_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/claims/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/claims/{id}"
  },
  {
    id: "ess.directory",
    facade: "ess",
    method: "GET",
    path: "/api/ess/directory",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/directory"
  },
  {
    id: "ess.documents",
    facade: "ess",
    method: "GET",
    path: "/api/ess/documents",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/documents"
  },
  {
    id: "ess.documents_shared",
    facade: "ess",
    method: "GET",
    path: "/api/ess/documents/shared",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/documents/shared"
  },
  {
    id: "ess.employee_relations_cases",
    facade: "ess",
    method: "GET",
    path: "/api/ess/employee-relations/cases",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/employee-relations/cases"
  },
  {
    id: "ess.engagement_assignments",
    facade: "ess",
    method: "GET",
    path: "/api/ess/engagement/assignments",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/engagement/assignments"
  },
  {
    id: "ess.engagement_surveys_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/engagement/surveys/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/engagement/surveys/{id}"
  },
  {
    id: "ess.ewa",
    facade: "ess",
    method: "GET",
    path: "/api/ess/ewa",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/ewa"
  },
  {
    id: "ess.ewa_eligibility",
    facade: "ess",
    method: "GET",
    path: "/api/ess/ewa/eligibility",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/ewa/eligibility"
  },
  {
    id: "ess.feedback",
    facade: "ess",
    method: "GET",
    path: "/api/ess/feedback",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/feedback"
  },
  {
    id: "ess.helpdesk",
    facade: "ess",
    method: "GET",
    path: "/api/ess/helpdesk",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/helpdesk"
  },
  {
    id: "ess.helpdesk_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/helpdesk/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/helpdesk/{id}"
  },
  {
    id: "ess.info_change_requests",
    facade: "ess",
    method: "GET",
    path: "/api/ess/info-change-requests",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/info-change-requests"
  },
  {
    id: "ess.learning_certifications",
    facade: "ess",
    method: "GET",
    path: "/api/ess/learning/certifications",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/learning/certifications"
  },
  {
    id: "ess.learning_courses_by_courseId",
    facade: "ess",
    method: "GET",
    path: "/api/ess/learning/courses/{courseId}",
    pathParams: ["courseId"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/learning/courses/{courseId}"
  },
  {
    id: "ess.learning_enrollments",
    facade: "ess",
    method: "GET",
    path: "/api/ess/learning/enrollments",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/learning/enrollments"
  },
  {
    id: "ess.leave",
    facade: "ess",
    method: "GET",
    path: "/api/mss/leave",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/mss/leave"
  },
  {
    id: "ess.leave_2",
    facade: "ess",
    method: "GET",
    path: "/api/ess/leave",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/leave"
  },
  {
    id: "ess.live_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/qr/{id}/live",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/qr/{id}/live"
  },
  {
    id: "ess.loans",
    facade: "ess",
    method: "GET",
    path: "/api/ess/loans",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/loans"
  },
  {
    id: "ess.loans_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/loans/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/loans/{id}"
  },
  {
    id: "ess.loans_schedule_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/loans/{id}/schedule",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/loans/{id}/schedule"
  },
  {
    id: "ess.my_okr",
    facade: "ess",
    method: "GET",
    path: "/api/ess/my-okr",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/my-okr"
  },
  {
    id: "ess.my_shifts",
    facade: "ess",
    method: "GET",
    path: "/api/ess/my-shifts",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/my-shifts"
  },
  {
    id: "ess.notifications",
    facade: "ess",
    method: "GET",
    path: "/api/ess/notifications",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/notifications"
  },
  {
    id: "ess.onboarding",
    facade: "ess",
    method: "GET",
    path: "/api/ess/onboarding",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/onboarding"
  },
  {
    id: "ess.overtime",
    facade: "ess",
    method: "GET",
    path: "/api/mss/overtime",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/mss/overtime"
  },
  {
    id: "ess.payslip_by_slipId",
    facade: "ess",
    method: "GET",
    path: "/api/ess/payslip/{slipId}",
    pathParams: ["slipId"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/payslip/{slipId}"
  },
  {
    id: "ess.payslips",
    facade: "ess",
    method: "GET",
    path: "/api/ess/payslips",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/payslips"
  },
  {
    id: "ess.payslips_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/payslips/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/payslips/{id}"
  },
  {
    id: "ess.performance_self_review",
    facade: "ess",
    method: "GET",
    path: "/api/ess/performance/self-review",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/performance/self-review"
  },
  {
    id: "ess.profile",
    facade: "ess",
    method: "GET",
    path: "/api/ess/profile",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/profile"
  },
  {
    id: "ess.qr",
    facade: "ess",
    method: "GET",
    path: "/api/ess/qr",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/qr"
  },
  {
    id: "ess.qr_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/qr/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/qr/{id}"
  },
  {
    id: "ess.qr_list",
    facade: "ess",
    method: "GET",
    path: "/api/ess/qr/list",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/qr/list"
  },
  {
    id: "ess.qr_live_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/qr/{id}/live",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/qr/{id}/live"
  },
  {
    id: "ess.qr_statistics",
    facade: "ess",
    method: "GET",
    path: "/api/ess/qr/statistics",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/qr/statistics"
  },
  {
    id: "ess.root_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/qr/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/qr/{id}"
  },
  {
    id: "ess.shift_preferences",
    facade: "ess",
    method: "GET",
    path: "/api/ess/shift-preferences",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/shift-preferences"
  },
  {
    id: "ess.shift_swaps",
    facade: "ess",
    method: "GET",
    path: "/api/ess/shift-swaps",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/shift-swaps"
  },
  {
    id: "ess.shift_swaps_options",
    facade: "ess",
    method: "GET",
    path: "/api/ess/shift-swaps/options",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/shift-swaps/options"
  },
  {
    id: "ess.shifts",
    facade: "ess",
    method: "GET",
    path: "/api/ess/shifts",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/shifts"
  },
  {
    id: "ess.tasks",
    facade: "ess",
    method: "GET",
    path: "/api/ess/tasks",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/tasks"
  },
  {
    id: "ess.tasks_comments_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/tasks/{id}/comments",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/tasks/{id}/comments"
  },
  {
    id: "ess.tax_1721_a1",
    facade: "ess",
    method: "GET",
    path: "/api/ess/tax/1721-a1",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/tax/1721-a1"
  },
  {
    id: "ess.team_attendance",
    facade: "ess",
    method: "GET",
    path: "/api/ess/team/attendance",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/team/attendance"
  },
  {
    id: "ess.team_okr",
    facade: "ess",
    method: "GET",
    path: "/api/mss/team-okr",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/mss/team-okr"
  },
  {
    id: "ess.timesheets",
    facade: "ess",
    method: "GET",
    path: "/api/ess/timesheets",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/timesheets"
  },
  {
    id: "ess.training_requests",
    facade: "ess",
    method: "GET",
    path: "/api/ess/training-requests",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/training-requests"
  },
  {
    id: "ess.travel",
    facade: "ess",
    method: "GET",
    path: "/api/ess/travel",
    pathParams: [],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/travel"
  },
  {
    id: "ess.travel_by_id",
    facade: "ess",
    method: "GET",
    path: "/api/ess/travel/{id}",
    pathParams: ["id"],
    query: z9.object({}).passthrough(),
    summary: "GET /api/ess/travel/{id}"
  }
];

// src/registry/leave.ts
import { z as z10 } from "zod";
var leaveOps = [
  {
    id: "leave.root",
    facade: "leave",
    method: "GET",
    path: "/api/hcm/leave-accrual",
    pathParams: [],
    query: z10.object({}).passthrough(),
    summary: "GET /api/hcm/leave-accrual"
  },
  {
    id: "leave.root_2",
    facade: "leave",
    method: "GET",
    path: "/api/hcm/medical-certificates",
    pathParams: [],
    query: z10.object({}).passthrough(),
    summary: "GET /api/hcm/medical-certificates"
  },
  {
    id: "leave.root_3",
    facade: "leave",
    method: "GET",
    path: "/api/hcm/leave",
    pathParams: [],
    query: z10.object({}).passthrough(),
    summary: "GET /api/hcm/leave"
  },
  {
    id: "leave.root_by_id",
    facade: "leave",
    method: "GET",
    path: "/api/hcm/medical-certificates/{id}",
    pathParams: ["id"],
    query: z10.object({}).passthrough(),
    summary: "GET /api/hcm/medical-certificates/{id}"
  },
  {
    id: "leave.root_by_id_2",
    facade: "leave",
    method: "GET",
    path: "/api/hcm/leave/{id}",
    pathParams: ["id"],
    query: z10.object({}).passthrough(),
    summary: "GET /api/hcm/leave/{id}"
  }
];

// src/registry/masterdata.ts
import { z as z11 } from "zod";
var masterdataOps = [
  {
    id: "masterdata.lov",
    facade: "masterdata",
    method: "GET",
    path: "/api/masterdata/lov",
    pathParams: [],
    query: z11.object({}).passthrough(),
    summary: "GET /api/masterdata/lov"
  }
];

// src/registry/org_development.ts
import { z as z12 } from "zod";
var org_developmentOps = [
  {
    id: "org_development.analytics",
    facade: "org_development",
    method: "GET",
    path: "/api/hcm/org-development/analytics",
    pathParams: [],
    query: z12.object({}).passthrough(),
    summary: "GET /api/hcm/org-development/analytics"
  },
  {
    id: "org_development.departments_tree",
    facade: "org_development",
    method: "GET",
    path: "/api/hcm/org/departments/tree",
    pathParams: [],
    query: z12.object({}).passthrough(),
    summary: "GET /api/hcm/org/departments/tree"
  },
  {
    id: "org_development.root",
    facade: "org_development",
    method: "GET",
    path: "/api/hcm/org-chart",
    pathParams: [],
    query: z12.object({}).passthrough(),
    summary: "GET /api/hcm/org-chart"
  },
  {
    id: "org_development.scenarios",
    facade: "org_development",
    method: "GET",
    path: "/api/hcm/org-development/scenarios",
    pathParams: [],
    query: z12.object({}).passthrough(),
    summary: "GET /api/hcm/org-development/scenarios"
  }
];

// src/registry/payroll.ts
import { z as z13 } from "zod";
var payrollOps = [
  {
    id: "payroll.additional_salaries",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/additional-salaries",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/additional-salaries"
  },
  {
    id: "payroll.additional_salaries_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/additional-salaries/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/additional-salaries/{id}"
  },
  {
    id: "payroll.agreement_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/loans/{id}/agreement",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/loans/{id}/agreement"
  },
  {
    id: "payroll.analytics",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/analytics",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/analytics"
  },
  {
    id: "payroll.bik",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/bik",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/bik"
  },
  {
    id: "payroll.bik_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/bik/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/bik/{id}"
  },
  {
    id: "payroll.company_tax",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/company-tax",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/company-tax"
  },
  {
    id: "payroll.compliance_checks",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/compliance/checks",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/compliance/checks"
  },
  {
    id: "payroll.config_versions",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/config-versions",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/config-versions"
  },
  {
    id: "payroll.cost_allocation",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/cost-allocation",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/cost-allocation"
  },
  {
    id: "payroll.cost_center_splits",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/cost-center-splits",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/cost-center-splits"
  },
  {
    id: "payroll.employee_incentives",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/employee-incentives",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/employee-incentives"
  },
  {
    id: "payroll.employee_incentives_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/employee-incentives/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/employee-incentives/{id}"
  },
  {
    id: "payroll.expense_reports",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/travel/expense-reports",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/travel/expense-reports"
  },
  {
    id: "payroll.inputs_by_periodId",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/inputs/{periodId}",
    pathParams: ["periodId"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/inputs/{periodId}"
  },
  {
    id: "payroll.payment_batches",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/payment-batches",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/payment-batches"
  },
  {
    id: "payroll.payment_batches_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/payment-batches/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/payment-batches/{id}"
  },
  {
    id: "payroll.payroll_entries",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/payroll-entries",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/payroll-entries"
  },
  {
    id: "payroll.payroll_entries_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/payroll-entries/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/payroll-entries/{id}"
  },
  {
    id: "payroll.payroll_periods",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/payroll-periods",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/payroll-periods"
  },
  {
    id: "payroll.payroll_periods_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/payroll-periods/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/payroll-periods/{id}"
  },
  {
    id: "payroll.programs",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/benefits/programs",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/benefits/programs"
  },
  {
    id: "payroll.programs_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/benefits/programs/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/benefits/programs/{id}"
  },
  {
    id: "payroll.programs_eligibility_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/benefits/programs/{id}/eligibility",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/benefits/programs/{id}/eligibility"
  },
  {
    id: "payroll.report",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/loans/report",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/loans/report"
  },
  {
    id: "payroll.retention_bonuses",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/retention-bonuses",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/retention-bonuses"
  },
  {
    id: "payroll.retention_bonuses_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/retention-bonuses/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/retention-bonuses/{id}"
  },
  {
    id: "payroll.root",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/loans",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/loans"
  },
  {
    id: "payroll.root_2",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/ewa",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/ewa"
  },
  {
    id: "payroll.root_3",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll"
  },
  {
    id: "payroll.root_4",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/travel",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/travel"
  },
  {
    id: "payroll.root_5",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/claims",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/claims"
  },
  {
    id: "payroll.root_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/{id}"
  },
  {
    id: "payroll.root_by_id_2",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/travel/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/travel/{id}"
  },
  {
    id: "payroll.run_inputs_claims_ewa",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/run-inputs/claims-ewa",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/run-inputs/claims-ewa"
  },
  {
    id: "payroll.run_scope_facets",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/run/scope-facets",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/run/scope-facets"
  },
  {
    id: "payroll.run_status_by_runId",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/run/{runId}/status",
    pathParams: ["runId"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/run/{runId}/status"
  },
  {
    id: "payroll.run_validate",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/run/validate",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/run/validate"
  },
  {
    id: "payroll.salary_components",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-components",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-components"
  },
  {
    id: "payroll.salary_components_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-components/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-components/{id}"
  },
  {
    id: "payroll.salary_slips",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-slips",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-slips"
  },
  {
    id: "payroll.salary_slips_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-slips/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-slips/{id}"
  },
  {
    id: "payroll.salary_structure_assignments",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-structure-assignments",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-structure-assignments"
  },
  {
    id: "payroll.salary_structure_assignments_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-structure-assignments/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-structure-assignments/{id}"
  },
  {
    id: "payroll.salary_structures",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-structures",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-structures"
  },
  {
    id: "payroll.salary_structures_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/salary-structures/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/salary-structures/{id}"
  },
  {
    id: "payroll.stats",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/stats",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/stats"
  },
  {
    id: "payroll.tax_export",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/tax-export",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/tax-export"
  },
  {
    id: "payroll.thr_run",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/payroll/thr-run",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/payroll/thr-run"
  },
  {
    id: "payroll.transactions",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/benefits/transactions",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/benefits/transactions"
  },
  {
    id: "payroll.types",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/loans/types",
    pathParams: [],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/loans/types"
  },
  {
    id: "payroll.types_by_id",
    facade: "payroll",
    method: "GET",
    path: "/api/hcm/loans/types/{id}",
    pathParams: ["id"],
    query: z13.object({}).passthrough(),
    summary: "GET /api/hcm/loans/types/{id}"
  }
];

// src/registry/performance.ts
import { z as z14 } from "zod";
var performanceOps = [
  {
    id: "performance.alignment",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/okr/alignment",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/okr/alignment"
  },
  {
    id: "performance.appraisal_templates",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/appraisal-templates",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/appraisal-templates"
  },
  {
    id: "performance.appraisal_templates_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/appraisal-templates/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/appraisal-templates/{id}"
  },
  {
    id: "performance.assessment_centers",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/assessment-centers",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/assessment-centers"
  },
  {
    id: "performance.assessment_centers_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/assessment-centers/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/assessment-centers/{id}"
  },
  {
    id: "performance.assessment_centers_review_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/assessment-centers/{id}/review",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/assessment-centers/{id}/review"
  },
  {
    id: "performance.calibration",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/calibration",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/calibration"
  },
  {
    id: "performance.calibration_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/calibration/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/calibration/{id}"
  },
  {
    id: "performance.calibration_distribution",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/calibration/distribution",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/calibration/distribution"
  },
  {
    id: "performance.calibration_grid",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/calibration/grid",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/calibration/grid"
  },
  {
    id: "performance.calibration_review_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/calibration/{id}/review",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/calibration/{id}/review"
  },
  {
    id: "performance.calibration_sessions",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/calibration/sessions",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/calibration/sessions"
  },
  {
    id: "performance.checkins",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/checkins",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/checkins"
  },
  {
    id: "performance.checkins_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/checkins/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/checkins/{id}"
  },
  {
    id: "performance.checkins_review_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/checkins/{id}/review",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/checkins/{id}/review"
  },
  {
    id: "performance.comparison_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/{id}/comparison",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/{id}/comparison"
  },
  {
    id: "performance.continuous_period_score",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/continuous/period-score",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/continuous/period-score"
  },
  {
    id: "performance.cycles",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/cycles",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/cycles"
  },
  {
    id: "performance.cycles_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/cycles/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/cycles/{id}"
  },
  {
    id: "performance.development_plan_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/{id}/development-plan",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/{id}/development-plan"
  },
  {
    id: "performance.evaluations_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/evaluations/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/evaluations/{id}"
  },
  {
    id: "performance.evaluations_by_id_2",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/{id}/evaluations",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/{id}/evaluations"
  },
  {
    id: "performance.increments",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/increments",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/increments"
  },
  {
    id: "performance.increments_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/increments/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/increments/{id}"
  },
  {
    id: "performance.increments_review_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/increments/{id}/review",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/increments/{id}/review"
  },
  {
    id: "performance.increments_seed",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/increments/seed",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/increments/seed"
  },
  {
    id: "performance.key_results_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/okr/key-results/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/okr/key-results/{id}"
  },
  {
    id: "performance.key_results_checkins_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/okr/key-results/{id}/checkins",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/okr/key-results/{id}/checkins"
  },
  {
    id: "performance.kpis",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/kpis",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/kpis"
  },
  {
    id: "performance.kpis_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/kpis/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/kpis/{id}"
  },
  {
    id: "performance.kpis_trend",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/kpis/trend",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/kpis/trend"
  },
  {
    id: "performance.objectives",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/okr/objectives",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/okr/objectives"
  },
  {
    id: "performance.objectives_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/okr/objectives/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/okr/objectives/{id}"
  },
  {
    id: "performance.objectives_key_results_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/okr/objectives/{id}/key-results",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/okr/objectives/{id}/key-results"
  },
  {
    id: "performance.overview",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/overview",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/overview"
  },
  {
    id: "performance.pip",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/pip",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/pip"
  },
  {
    id: "performance.pip_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/pip/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/pip/{id}"
  },
  {
    id: "performance.pip_candidates",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/pip/candidates",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/pip/candidates"
  },
  {
    id: "performance.pip_review_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/pip/{id}/review",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/pip/{id}/review"
  },
  {
    id: "performance.pip_users",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/pip/users",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/pip/users"
  },
  {
    id: "performance.prism",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/prism",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/prism"
  },
  {
    id: "performance.root",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance"
  },
  {
    id: "performance.root_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/{id}"
  },
  {
    id: "performance.succession_positions",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/succession-positions",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/succession-positions"
  },
  {
    id: "performance.succession_positions_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/succession-positions/{id}",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/succession-positions/{id}"
  },
  {
    id: "performance.succession_positions_candidate_suggestions_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/succession-positions/{id}/candidate-suggestions",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/succession-positions/{id}/candidate-suggestions"
  },
  {
    id: "performance.succession_positions_prep_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/succession-positions/{id}/prep",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/succession-positions/{id}/prep"
  },
  {
    id: "performance.succession_positions_review_by_id",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/succession-positions/{id}/review",
    pathParams: ["id"],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/succession-positions/{id}/review"
  },
  {
    id: "performance.talent_pool",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/talent-pool",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/talent-pool"
  },
  {
    id: "performance.talent_pool_preview",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/talent-pool/preview",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/talent-pool/preview"
  },
  {
    id: "performance.tree",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/okr/tree",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/okr/tree"
  },
  {
    id: "performance.work_evidence",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/work-evidence",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/work-evidence"
  },
  {
    id: "performance.workforce_productivity",
    facade: "performance",
    method: "GET",
    path: "/api/hcm/performance/workforce-productivity",
    pathParams: [],
    query: z14.object({}).passthrough(),
    summary: "GET /api/hcm/performance/workforce-productivity"
  }
];

// src/registry/recruitment.ts
import { z as z15 } from "zod";
var recruitmentOps = [
  {
    id: "recruitment.ai_extractions_by_applicantId",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/ai/extractions/{applicantId}",
    pathParams: ["applicantId"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/ai/extractions/{applicantId}"
  },
  {
    id: "recruitment.ai_generations",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/ai/generations",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/ai/generations"
  },
  {
    id: "recruitment.ai_interview_question_packs",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/ai/interview-question-packs",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/ai/interview-question-packs"
  },
  {
    id: "recruitment.ai_interview_question_packs_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/ai/interview-question-packs/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/ai/interview-question-packs/{id}"
  },
  {
    id: "recruitment.ai_scores_by_applicantId",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/ai/scores/{applicantId}",
    pathParams: ["applicantId"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/ai/scores/{applicantId}"
  },
  {
    id: "recruitment.ai_scores_by_opening_by_openingId",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/ai/scores/by-opening/{openingId}",
    pathParams: ["openingId"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/ai/scores/by-opening/{openingId}"
  },
  {
    id: "recruitment.applications_by_token",
    facade: "recruitment",
    method: "GET",
    path: "/api/careers/applications/{token}",
    pathParams: ["token"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/careers/applications/{token}"
  },
  {
    id: "recruitment.appointment_letters",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/appointment-letters",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/appointment-letters"
  },
  {
    id: "recruitment.appointment_letters_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/appointment-letters/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/appointment-letters/{id}"
  },
  {
    id: "recruitment.assessment_tests",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/assessment-tests",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/assessment-tests"
  },
  {
    id: "recruitment.assessment_tests_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/assessment-tests/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/assessment-tests/{id}"
  },
  {
    id: "recruitment.assessment_tests_versions_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/assessment-tests/{id}/versions",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/assessment-tests/{id}/versions"
  },
  {
    id: "recruitment.automation_rules",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/automation-rules",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/automation-rules"
  },
  {
    id: "recruitment.automation_rules_action_types",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/automation-rules/action-types",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/automation-rules/action-types"
  },
  {
    id: "recruitment.automation_rules_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/automation-rules/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/automation-rules/{id}"
  },
  {
    id: "recruitment.automation_rules_fires_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/automation-rules/{id}/fires",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/automation-rules/{id}/fires"
  },
  {
    id: "recruitment.branding",
    facade: "recruitment",
    method: "GET",
    path: "/api/careers/branding",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/careers/branding"
  },
  {
    id: "recruitment.branding_2",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/branding",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/branding"
  },
  {
    id: "recruitment.custom_fields",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/custom-fields",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/custom-fields"
  },
  {
    id: "recruitment.custom_fields_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/custom-fields/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/custom-fields/{id}"
  },
  {
    id: "recruitment.drip_campaigns",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/drip-campaigns",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/drip-campaigns"
  },
  {
    id: "recruitment.drip_campaigns_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/drip-campaigns/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/drip-campaigns/{id}"
  },
  {
    id: "recruitment.drip_campaigns_enrollments_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/drip-campaigns/{id}/enrollments",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/drip-campaigns/{id}/enrollments"
  },
  {
    id: "recruitment.email_logs",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/email-logs",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/email-logs"
  },
  {
    id: "recruitment.email_logs_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/email-logs/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/email-logs/{id}"
  },
  {
    id: "recruitment.email_templates",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/email-templates",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/email-templates"
  },
  {
    id: "recruitment.email_templates_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/email-templates/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/email-templates/{id}"
  },
  {
    id: "recruitment.employee_referrals",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/employee-referrals",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/employee-referrals"
  },
  {
    id: "recruitment.employee_referrals_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/employee-referrals/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/employee-referrals/{id}"
  },
  {
    id: "recruitment.files_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/careers/files/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/careers/files/{id}"
  },
  {
    id: "recruitment.hires",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/hires",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/hires"
  },
  {
    id: "recruitment.hires_review_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/hires/{id}/review",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/hires/{id}/review"
  },
  {
    id: "recruitment.interview_feedback",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interview-feedback",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interview-feedback"
  },
  {
    id: "recruitment.interview_feedback_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interview-feedback/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interview-feedback/{id}"
  },
  {
    id: "recruitment.interview_rounds",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interview-rounds",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interview-rounds"
  },
  {
    id: "recruitment.interview_rounds_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interview-rounds/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interview-rounds/{id}"
  },
  {
    id: "recruitment.interview_types",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interview-types",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interview-types"
  },
  {
    id: "recruitment.interview_types_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interview-types/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interview-types/{id}"
  },
  {
    id: "recruitment.interviews",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interviews",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interviews"
  },
  {
    id: "recruitment.interviews_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interviews/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interviews/{id}"
  },
  {
    id: "recruitment.interviews_review_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/interviews/{id}/review",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/interviews/{id}/review"
  },
  {
    id: "recruitment.job_applicants",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants"
  },
  {
    id: "recruitment.job_applicants_activities_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/activities",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/activities"
  },
  {
    id: "recruitment.job_applicants_assessment_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/assessment",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/assessment"
  },
  {
    id: "recruitment.job_applicants_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}"
  },
  {
    id: "recruitment.job_applicants_consensus_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/consensus",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/consensus"
  },
  {
    id: "recruitment.job_applicants_custom_fields_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/custom-fields",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/custom-fields"
  },
  {
    id: "recruitment.job_applicants_resumes_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/resumes",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/resumes"
  },
  {
    id: "recruitment.job_applicants_scorecard_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/scorecard",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/scorecard"
  },
  {
    id: "recruitment.job_applicants_screening_responses_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/screening-responses",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/screening-responses"
  },
  {
    id: "recruitment.job_applicants_tags_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-applicants/{id}/tags",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-applicants/{id}/tags"
  },
  {
    id: "recruitment.job_families",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-families",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-families"
  },
  {
    id: "recruitment.job_offers",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-offers",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-offers"
  },
  {
    id: "recruitment.job_offers_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-offers/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-offers/{id}"
  },
  {
    id: "recruitment.job_offers_review_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-offers/{id}/review",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-offers/{id}/review"
  },
  {
    id: "recruitment.job_openings",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-openings",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-openings"
  },
  {
    id: "recruitment.job_openings_board_postings_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-openings/{id}/board-postings",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-openings/{id}/board-postings"
  },
  {
    id: "recruitment.job_openings_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-openings/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-openings/{id}"
  },
  {
    id: "recruitment.job_openings_requirements_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-openings/{id}/requirements",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-openings/{id}/requirements"
  },
  {
    id: "recruitment.job_openings_role_competencies_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-openings/{id}/role-competencies",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-openings/{id}/role-competencies"
  },
  {
    id: "recruitment.job_requisitions",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-requisitions",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-requisitions"
  },
  {
    id: "recruitment.job_requisitions_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/job-requisitions/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/job-requisitions/{id}"
  },
  {
    id: "recruitment.messages",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/messages",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/messages"
  },
  {
    id: "recruitment.openings",
    facade: "recruitment",
    method: "GET",
    path: "/api/careers/openings",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/careers/openings"
  },
  {
    id: "recruitment.openings_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/careers/openings/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/careers/openings/{id}"
  },
  {
    id: "recruitment.pipeline_stages",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/pipeline-stages",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/pipeline-stages"
  },
  {
    id: "recruitment.pipeline_stages_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/pipeline-stages/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/pipeline-stages/{id}"
  },
  {
    id: "recruitment.question_bank",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/question-bank",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/question-bank"
  },
  {
    id: "recruitment.question_bank_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/question-bank/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/question-bank/{id}"
  },
  {
    id: "recruitment.reports_candidate_experience",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/reports/candidate-experience",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/reports/candidate-experience"
  },
  {
    id: "recruitment.reports_cost_per_hire",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/reports/cost-per-hire",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/reports/cost-per-hire"
  },
  {
    id: "recruitment.reports_forecasting",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/reports/forecasting",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/reports/forecasting"
  },
  {
    id: "recruitment.reports_offer_outcomes",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/reports/offer-outcomes",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/reports/offer-outcomes"
  },
  {
    id: "recruitment.reports_pipeline_velocity",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/reports/pipeline-velocity",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/reports/pipeline-velocity"
  },
  {
    id: "recruitment.reports_quality_of_hire",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/reports/quality-of-hire",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/reports/quality-of-hire"
  },
  {
    id: "recruitment.reports_recruiter_productivity",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/reports/recruiter-productivity",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/reports/recruiter-productivity"
  },
  {
    id: "recruitment.saved_reports",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/saved-reports",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/saved-reports"
  },
  {
    id: "recruitment.scenarios",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/scenarios",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/scenarios"
  },
  {
    id: "recruitment.scenarios_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/scenarios/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/scenarios/{id}"
  },
  {
    id: "recruitment.scenarios_compare_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/scenarios/{id}/compare",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/scenarios/{id}/compare"
  },
  {
    id: "recruitment.scorecard_templates",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/scorecard-templates",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/scorecard-templates"
  },
  {
    id: "recruitment.scorecard_templates_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/scorecard-templates/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/scorecard-templates/{id}"
  },
  {
    id: "recruitment.screening_questions",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/screening-questions",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/screening-questions"
  },
  {
    id: "recruitment.screening_questions_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/screening-questions/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/screening-questions/{id}"
  },
  {
    id: "recruitment.staffing_plans",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/staffing-plans",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/staffing-plans"
  },
  {
    id: "recruitment.staffing_plans_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/staffing-plans/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/staffing-plans/{id}"
  },
  {
    id: "recruitment.staffing_plans_review_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/staffing-plans/{id}/review",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/staffing-plans/{id}/review"
  },
  {
    id: "recruitment.staffing_plans_variance_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/staffing-plans/{id}/variance",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/staffing-plans/{id}/variance"
  },
  {
    id: "recruitment.stats",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/stats",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/stats"
  },
  {
    id: "recruitment.surveys_by_token",
    facade: "recruitment",
    method: "GET",
    path: "/api/careers/surveys/{token}",
    pathParams: ["token"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/careers/surveys/{token}"
  },
  {
    id: "recruitment.surveys_results",
    facade: "recruitment",
    method: "GET",
    path: "/api/recruitment/surveys/results",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/recruitment/surveys/results"
  },
  {
    id: "recruitment.tags",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/tags",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/tags"
  },
  {
    id: "recruitment.tags_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/tags/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/tags/{id}"
  },
  {
    id: "recruitment.video_interviews",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/video-interviews",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/video-interviews"
  },
  {
    id: "recruitment.video_interviews_by_id",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/video-interviews/{id}",
    pathParams: ["id"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/video-interviews/{id}"
  },
  {
    id: "recruitment.video_interviews_by_token",
    facade: "recruitment",
    method: "GET",
    path: "/api/careers/video-interviews/{token}",
    pathParams: ["token"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/careers/video-interviews/{token}"
  },
  {
    id: "recruitment.video_interviews_compare",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/video-interviews/compare",
    pathParams: [],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/video-interviews/compare"
  },
  {
    id: "recruitment.video_interviews_responses_stream_by_responseId",
    facade: "recruitment",
    method: "GET",
    path: "/api/hcm/recruitment/video-interviews/responses/{responseId}/stream",
    pathParams: ["responseId"],
    query: z15.object({}).passthrough(),
    summary: "GET /api/hcm/recruitment/video-interviews/responses/{responseId}/stream"
  }
];

// src/registry/scheduling.ts
import { z as z16 } from "zod";
var schedulingOps = [
  {
    id: "scheduling.analytics",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-assignments/analytics",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-assignments/analytics"
  },
  {
    id: "scheduling.root",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/roster",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/roster"
  },
  {
    id: "scheduling.root_2",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-locations",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-locations"
  },
  {
    id: "scheduling.root_3",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-swaps",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-swaps"
  },
  {
    id: "scheduling.root_4",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-schedule-assignments",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-schedule-assignments"
  },
  {
    id: "scheduling.root_5",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-assignments",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-assignments"
  },
  {
    id: "scheduling.root_6",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-schedules",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-schedules"
  },
  {
    id: "scheduling.root_7",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-requests",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-requests"
  },
  {
    id: "scheduling.root_8",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-demand-profiles",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-demand-profiles"
  },
  {
    id: "scheduling.root_by_id",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-locations/{id}",
    pathParams: ["id"],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-locations/{id}"
  },
  {
    id: "scheduling.root_by_id_2",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-assignments/{id}",
    pathParams: ["id"],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-assignments/{id}"
  },
  {
    id: "scheduling.root_by_id_3",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-schedules/{id}",
    pathParams: ["id"],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-schedules/{id}"
  },
  {
    id: "scheduling.root_by_id_4",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-requests/{id}",
    pathParams: ["id"],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-requests/{id}"
  },
  {
    id: "scheduling.root_by_id_5",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-demand-profiles/{id}",
    pathParams: ["id"],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-demand-profiles/{id}"
  },
  {
    id: "scheduling.stats",
    facade: "scheduling",
    method: "GET",
    path: "/api/hcm/shift-assignments/stats",
    pathParams: [],
    query: z16.object({}).passthrough(),
    summary: "GET /api/hcm/shift-assignments/stats"
  }
];

// src/registry/talent.ts
import { z as z17 } from "zod";
var talentOps = [
  {
    id: "talent.applications",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/applications",
    pathParams: [],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/applications"
  },
  {
    id: "talent.career_plans",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/career-plans",
    pathParams: [],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/career-plans"
  },
  {
    id: "talent.competencies",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/competencies",
    pathParams: [],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/competencies"
  },
  {
    id: "talent.competencies_by_id",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/competencies/{id}",
    pathParams: ["id"],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/competencies/{id}"
  },
  {
    id: "talent.competencies_hub_by_id",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/competencies/{id}/hub",
    pathParams: ["id"],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/competencies/{id}/hub"
  },
  {
    id: "talent.idp",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/idp",
    pathParams: [],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/idp"
  },
  {
    id: "talent.job_families",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/job-families",
    pathParams: [],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/job-families"
  },
  {
    id: "talent.opportunities",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/opportunities",
    pathParams: [],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/opportunities"
  },
  {
    id: "talent.profiles",
    facade: "talent",
    method: "GET",
    path: "/api/hcm/tms/profiles",
    pathParams: [],
    query: z17.object({}).passthrough(),
    summary: "GET /api/hcm/tms/profiles"
  }
];

// src/registry/training.ts
import { z as z18 } from "zod";
var trainingOps = [
  {
    id: "training.assignment_submissions",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/assignment-submissions",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/assignment-submissions"
  },
  {
    id: "training.assignments",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/assignments",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/assignments"
  },
  {
    id: "training.batches",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/batches",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/batches"
  },
  {
    id: "training.batches_available_learners_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/batches/{id}/available-learners",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/batches/{id}/available-learners"
  },
  {
    id: "training.batches_learners_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/batches/{id}/learners",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/batches/{id}/learners"
  },
  {
    id: "training.behavior_followups",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/behavior-followups",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/behavior-followups"
  },
  {
    id: "training.categories",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/categories",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/categories"
  },
  {
    id: "training.chapters",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/chapters",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/chapters"
  },
  {
    id: "training.course_enrollments",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/course-enrollments",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/course-enrollments"
  },
  {
    id: "training.courses",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/courses",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/courses"
  },
  {
    id: "training.courses_2",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/courses",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/courses"
  },
  {
    id: "training.courses_access_rules_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/courses/{id}/access-rules",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/courses/{id}/access-rules"
  },
  {
    id: "training.courses_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/courses/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/courses/{id}"
  },
  {
    id: "training.courses_by_id_2",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/courses/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/courses/{id}"
  },
  {
    id: "training.courses_competencies_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/courses/{id}/competencies",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/courses/{id}/competencies"
  },
  {
    id: "training.courses_prerequisites_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/courses/{id}/prerequisites",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/courses/{id}/prerequisites"
  },
  {
    id: "training.courses_review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/courses/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/courses/{id}/review"
  },
  {
    id: "training.courses_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/courses/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/courses/stats"
  },
  {
    id: "training.detail_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/certifications/{id}/detail",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/certifications/{id}/detail"
  },
  {
    id: "training.document_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/certifications/{id}/document",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/certifications/{id}/document"
  },
  {
    id: "training.effectiveness",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/effectiveness",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/effectiveness"
  },
  {
    id: "training.instructors",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/instructors",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/instructors"
  },
  {
    id: "training.interests",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/interests",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/interests"
  },
  {
    id: "training.interests_discover",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/interests/discover",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/interests/discover"
  },
  {
    id: "training.learning_paths",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/learning-paths",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/learning-paths"
  },
  {
    id: "training.learning_paths_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/learning-paths/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/learning-paths/{id}"
  },
  {
    id: "training.learning_paths_review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/learning-paths/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/learning-paths/{id}/review"
  },
  {
    id: "training.lesson_completions",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/lesson-completions",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/lesson-completions"
  },
  {
    id: "training.lessons",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/lessons",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/lessons"
  },
  {
    id: "training.lessons_playback_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/lessons/{id}/playback",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/lessons/{id}/playback"
  },
  {
    id: "training.live_classes",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/live-classes",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/live-classes"
  },
  {
    id: "training.outcome_links",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/outcome-links",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/outcome-links"
  },
  {
    id: "training.programs",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/programs",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/programs"
  },
  {
    id: "training.programs_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/programs/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/programs/{id}"
  },
  {
    id: "training.progress",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/progress",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/progress"
  },
  {
    id: "training.quiz_attempts",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/quiz-attempts",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/quiz-attempts"
  },
  {
    id: "training.quiz_attempts_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/quiz-attempts/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/quiz-attempts/stats"
  },
  {
    id: "training.quiz_questions",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/quiz-questions",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/quiz-questions"
  },
  {
    id: "training.quizzes",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/quizzes",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/quizzes"
  },
  {
    id: "training.recommendations",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/recommendations",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/recommendations"
  },
  {
    id: "training.recommendations_overview",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/recommendations/overview",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/recommendations/overview"
  },
  {
    id: "training.recommendations_review",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/recommendations/review",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/recommendations/review"
  },
  {
    id: "training.requests",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/requests",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/requests"
  },
  {
    id: "training.requests_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/requests/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/requests/stats"
  },
  {
    id: "training.review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/certifications/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/certifications/{id}/review"
  },
  {
    id: "training.reviews_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/credentials/{id}/reviews",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/credentials/{id}/reviews"
  },
  {
    id: "training.root",
    facade: "training",
    method: "GET",
    path: "/api/hcm/certifications",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/certifications"
  },
  {
    id: "training.root_2",
    facade: "training",
    method: "GET",
    path: "/api/hcm/credentials",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/credentials"
  },
  {
    id: "training.root_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/certifications/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/certifications/{id}"
  },
  {
    id: "training.stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/stats"
  },
  {
    id: "training.students",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/students",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/students"
  },
  {
    id: "training.tags",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/tags",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/tags"
  },
  {
    id: "training.threads",
    facade: "training",
    method: "GET",
    path: "/api/hcm/lms/threads",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/lms/threads"
  },
  {
    id: "training.tna",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna"
  },
  {
    id: "training.tna_analysis",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/analysis",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/analysis"
  },
  {
    id: "training.tna_analysis_review",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/analysis/review",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/analysis/review"
  },
  {
    id: "training.tna_analysis_review_overview",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/analysis/review/overview",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/analysis/review/overview"
  },
  {
    id: "training.tna_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/{id}"
  },
  {
    id: "training.tna_kpi_movement_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/{id}/kpi-movement",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/{id}/kpi-movement"
  },
  {
    id: "training.tna_plan",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/plan",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/plan"
  },
  {
    id: "training.tna_plan_review",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/plan/review",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/plan/review"
  },
  {
    id: "training.tna_review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/{id}/review"
  },
  {
    id: "training.tna_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/stats"
  },
  {
    id: "training.tna_succession_gaps",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/tna/succession-gaps",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/tna/succession-gaps"
  },
  {
    id: "training.training_events",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events"
  },
  {
    id: "training.training_events_access_rules_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/{id}/access-rules",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/{id}/access-rules"
  },
  {
    id: "training.training_events_attendance_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/{id}/attendance",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/{id}/attendance"
  },
  {
    id: "training.training_events_auto_place_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/{id}/auto-place",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/{id}/auto-place"
  },
  {
    id: "training.training_events_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/{id}"
  },
  {
    id: "training.training_events_prerequisites_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/{id}/prerequisites",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/{id}/prerequisites"
  },
  {
    id: "training.training_events_review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/{id}/review"
  },
  {
    id: "training.training_events_roster_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/{id}/roster",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/{id}/roster"
  },
  {
    id: "training.training_events_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-events/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-events/stats"
  },
  {
    id: "training.training_feedback",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-feedback",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-feedback"
  },
  {
    id: "training.training_feedback_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-feedback/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-feedback/{id}"
  },
  {
    id: "training.training_feedback_review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-feedback/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-feedback/{id}/review"
  },
  {
    id: "training.training_feedback_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-feedback/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-feedback/stats"
  },
  {
    id: "training.training_programs",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-programs",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-programs"
  },
  {
    id: "training.training_programs_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-programs/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-programs/{id}"
  },
  {
    id: "training.training_programs_competencies_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-programs/{id}/competencies",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-programs/{id}/competencies"
  },
  {
    id: "training.training_programs_review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-programs/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-programs/{id}/review"
  },
  {
    id: "training.training_programs_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-programs/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-programs/stats"
  },
  {
    id: "training.training_results",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-results",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-results"
  },
  {
    id: "training.training_results_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-results/{id}",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-results/{id}"
  },
  {
    id: "training.training_results_review_by_id",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-results/{id}/review",
    pathParams: ["id"],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-results/{id}/review"
  },
  {
    id: "training.training_results_stats",
    facade: "training",
    method: "GET",
    path: "/api/hcm/training/training-results/stats",
    pathParams: [],
    query: z18.object({}).passthrough(),
    summary: "GET /api/hcm/training/training-results/stats"
  }
];

// src/registry/index.ts
var REGISTRY = applyAnnotations({
  employees: employeesOps,
  attendance: attendanceOps,
  leave: leaveOps,
  scheduling: schedulingOps,
  payroll: payrollOps,
  performance: performanceOps,
  talent: talentOps,
  recruitment: recruitmentOps,
  training: trainingOps,
  compliance: complianceOps,
  engagement: engagementOps,
  org_development: org_developmentOps,
  analytics: analyticsOps,
  ess: essOps,
  masterdata: masterdataOps,
  admin: adminOps
});

// src/server.ts
async function main() {
  const cfg = loadConfig();
  const client = new DeepHrClient(cfg);
  const server = new McpServer({ name: "deephr", version: "0.1.0" });
  let toolCount = 0;
  for (const [facade, ops] of Object.entries(REGISTRY)) {
    if (ops.length === 0)
      continue;
    buildFacadeTool(server, facade, ops, client);
    toolCount++;
  }
  const transport = new StdioServerTransport;
  await server.connect(transport);
  console.error(`deephr-mcp ready: ${toolCount} facade tools, api=${cfg.apiUrl}`);
}
main().catch((e) => {
  console.error("deephr-mcp failed to start:", e);
  process.exit(1);
});
