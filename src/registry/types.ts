import { z } from "zod";

export interface OperationDef {
  id: string; // e.g. "payroll.salary_slips_by_id"
  facade: string; // facade tool key, e.g. "payroll"
  method: "GET";
  path: string; // URL template with {param}, e.g. /api/hcm/payroll/salary-slips/{id}
  pathParams: string[]; // ["id"]
  query: z.AnyZodObject; // annotated; generated default = z.object({}).passthrough()
  summary: string;
}

// The 16 facade keys. Tools are exposed as `deephr_<key>`.
export const FACADE_NAMES = [
  "employees",
  "attendance",
  "leave",
  "scheduling",
  "payroll",
  "performance",
  "talent",
  "recruitment",
  "training",
  "compliance",
  "engagement",
  "org_development",
  "analytics",
  "ess",
  "masterdata",
  "admin",
] as const;

export type FacadeName = (typeof FACADE_NAMES)[number];

// HCM routes (`/api/hcm/<segment>/...`) are classified by their second segment.
// Exact-match on the segment, so plural/compound names (employees,
// employee-lifecycle, shift-assignments, ...) are handled precisely.
// Unlisted hcm segments fall back to "admin".
export const HCM_SEGMENT_FACADE: Record<string, FacadeName> = {
  // employees / core HR data
  employees: "employees",
  "employee-lifecycle": "employees",
  "hcm-documents": "employees",
  contracts: "employees",
  onboarding: "employees",
  "info-change-requests": "employees",
  // attendance / time
  attendance: "attendance",
  overtime: "attendance",
  "overtime-rules": "attendance",
  timesheets: "attendance",
  projects: "attendance",
  // leave
  leave: "leave",
  "leave-accrual": "leave",
  "medical-certificates": "leave",
  // scheduling / shifts
  "shift-assignments": "scheduling",
  "shift-schedules": "scheduling",
  "shift-schedule-assignments": "scheduling",
  "shift-requests": "scheduling",
  "shift-swaps": "scheduling",
  "shift-locations": "scheduling",
  "shift-demand-profiles": "scheduling",
  roster: "scheduling",
  // payroll + compensation & benefits
  payroll: "payroll",
  loans: "payroll",
  benefits: "payroll",
  claims: "payroll",
  ewa: "payroll",
  travel: "payroll",
  // performance
  performance: "performance",
  okr: "performance",
  // talent
  tms: "talent",
  // recruitment
  recruitment: "recruitment",
  // training / L&D
  training: "training",
  lms: "training",
  certifications: "training",
  credentials: "training",
  // compliance
  compliance: "compliance",
  // engagement / employee relations
  engagement: "engagement",
  "employee-relations": "engagement",
  // org development
  "org-development": "org_development",
  "org-chart": "org_development",
  org: "org_development",
  // analytics
  "green-hr": "analytics",
  // admin / workflow / misc
  helpdesk: "admin",
  approvals: "admin",
  "ai-agent": "admin",
  "reminder-settings": "admin",
};

// Non-hcm routes are classified by URL prefix. Ordered: first match wins.
// Matched by exact path or `prefix + "/"`. Unmatched routes fall back to "admin".
export const GROUP_RULES: Array<{ prefix: string; facade: FacadeName }> = [
  { prefix: "/api/admin/analytics", facade: "analytics" },
  { prefix: "/api/admin/reports", facade: "analytics" },
  { prefix: "/api/admin/forecast", facade: "analytics" },
  { prefix: "/api/recruitment", facade: "recruitment" },
  { prefix: "/api/careers", facade: "recruitment" },
  { prefix: "/api/ess", facade: "ess" },
  { prefix: "/api/mss", facade: "ess" },
  { prefix: "/api/qr", facade: "ess" },
  { prefix: "/api/reports", facade: "analytics" },
  { prefix: "/api/kpi-plugins", facade: "analytics" },
  { prefix: "/api/masterdata", facade: "masterdata" },
  { prefix: "/api/lov", facade: "masterdata" },
];
