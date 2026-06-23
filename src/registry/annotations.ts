import { z } from "zod";

import type { OperationDef } from "./types";

// Hand annotations keyed by the *generated* operation id. Merged over generated
// defaults by applyAnnotations(). Only override what you want to improve.
// `id` renames the operation (the scanner can't disambiguate facades that
// aggregate several resources, so it emits opaque ids like `root_2`).
type Annotation = { id?: string; summary?: string; query?: z.AnyZodObject };

export const ANNOTATIONS: Record<string, Annotation> = {
  "payroll.runs": {
    summary: "List payroll runs, optionally filtered by status.",
    query: z.object({ status: z.string().optional(), periodId: z.string().optional() }).passthrough(),
  },

  // The `employees` facade aggregates 6 HCM resources, so the scanner collapsed
  // four collection roots into root/root_2/3/4 and left several document ops
  // ambiguous about which resource they belong to. Rename to guessable ids.
  // info-change-requests
  "employees.root": { id: "employees.change_requests" },
  "employees.root_by_id": { id: "employees.change_request_by_id" },
  // contracts
  "employees.root_2": { id: "employees.contracts" },
  "employees.root_by_id_2": { id: "employees.contract_by_id" },
  "employees.documents_by_id": { id: "employees.contract_documents" },
  "employees.documents_by_id_docId": { id: "employees.contract_document_by_id" },
  // hcm-documents
  "employees.root_3": { id: "employees.documents" },
  "employees.root_by_id_3": { id: "employees.document_by_id" },
  "employees.download_by_id": { id: "employees.document_download" },
  "employees.shares_by_id": { id: "employees.document_shares" },
  "employees.versions_by_id": { id: "employees.document_versions" },
  "employees.versions_download_by_id_versionId": { id: "employees.document_version_download" },
  // employees (core)
  "employees.root_4": { id: "employees.list" },
  "employees.root_by_id_4": { id: "employees.by_id" },
  // onboarding
  "employees.documents": { id: "employees.onboarding_documents" },
  "employees.templates": { id: "employees.onboarding_templates" },
  "employees.templates_by_id": { id: "employees.onboarding_template_by_id" },
  // employee-lifecycle
  "employees.stats": { id: "employees.lifecycle_stats" },
  "employees.documents_by_entityType_entityId": { id: "employees.lifecycle_documents" },
  // Add more hot operations here as needed.
};

export function applyAnnotations(reg: Record<string, OperationDef[]>): Record<string, OperationDef[]> {
  for (const ops of Object.values(reg)) {
    for (const op of ops) {
      const a = ANNOTATIONS[op.id];
      if (!a) continue;
      if (a.id) op.id = a.id;
      if (a.summary) op.summary = a.summary;
      if (a.query) op.query = a.query;
    }
  }
  return reg;
}
