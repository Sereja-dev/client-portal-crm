/**
 * AI Assistant Batch 1A — the one central, explicit statement of what
 * must never reach an AI provider, for later tool batches to be reviewed
 * and tested against. This module imports no Prisma types/records and
 * queries nothing — it is a static policy reference, not a runtime
 * content scanner. It is deliberately NOT a substitute for a future
 * tool's own typed output schema (e.g. a real `ClientSummary` type that
 * simply has no `email`/`taxId`/`streetAddress` fields at all) — the
 * architecture plan's own class A/B/C field matrix is enforced primarily
 * by each tool's output TYPE not including a forbidden field in the first
 * place; this policy exists so that decision has one reviewable,
 * cross-referenced home, and so a test can assert "the policy still lists
 * every category the plan required" independently of any one tool's
 * implementation (see test/unit/ai/privacy-policy.test.ts).
 *
 * Some categories below are exact-field-name-shaped (a fixed, checkable
 * list of real Prisma column names) and some are structural/categorical
 * (a whole model or a whole class of behavior that must never be reached
 * at all, not a specific field to filter out of an otherwise-included
 * record) — each rule's own `note` says which kind it is and why.
 */

export type AiForbiddenFieldCategory =
  | "banking-payment"
  | "billing-provider-identifiers"
  | "storage-paths"
  | "raw-activity-internals"
  | "auth-session-material"
  | "platform-admin-data"
  | "webhook-provider-payloads"
  | "raw-internal-ids";

export type AiForbiddenFieldRule = {
  category: AiForbiddenFieldCategory;
  /** Exact Prisma field names this rule covers, when the category is field-name-shaped. Omitted for a purely structural/categorical rule — see `note`. */
  fieldNames?: readonly string[];
  note: string;
};

export const AI_FORBIDDEN_FIELD_POLICY: readonly AiForbiddenFieldRule[] = [
  {
    category: "banking-payment",
    fieldNames: ["bankName", "accountHolder", "accountNumber", "swiftBic", "paymentInstructions"],
    note: "OrganizationPaymentDetails — literal banking/payment secrets. Never sent to a provider under any circumstance, regardless of what a user asks.",
  },
  {
    category: "billing-provider-identifiers",
    fieldNames: ["providerCustomerId", "providerSubscriptionId"],
    note: "Subscription — billing-provider-issued identifiers, not business content a user would ever legitimately need summarized.",
  },
  {
    category: "storage-paths",
    fieldNames: ["pdfStoragePath", "storagePath"],
    note: "Invoice.pdfStoragePath / Attachment.storagePath — internal Supabase Storage object paths, never a business fact worth surfacing.",
  },
  {
    category: "raw-activity-internals",
    fieldNames: ["metadata", "entityId"],
    note: "Activity.metadata (the raw, unfiltered JSON column) and Activity.entityId (a bare foreign id) — only an already-filtered, display-safe summary (the same shape the staff Activity UI already renders) may ever reach a tool's output, never these two raw columns directly.",
  },
  {
    category: "auth-session-material",
    note: "Supabase session/JWT/cookie material, and anything derived from it (access tokens, refresh tokens, the TEST_MODE identity cookie) — a structural exclusion: no AI code path reads or forwards this by construction. getAiAssistantRequestContext() (request-context.ts) resolves identity exactly once, server-side, and returns only { userId, organizationId, role } — never a token, session object, or cookie value.",
  },
  {
    category: "platform-admin-data",
    note: "PlatformAdminAuditEvent, and every reader under src/lib/platform-admin/** — categorically unreachable, not merely field-filtered: the AI Assistant has no Platform Admin concept, and no module under src/lib/ai/** may import anything from src/lib/platform-admin/** except the one reviewed exception, isPlatformAdmin() from authorization.ts, used only to deny access (see request-context.ts) — see check-ai-assistant-security.mjs's own import-boundary rule.",
  },
  {
    category: "webhook-provider-payloads",
    note: "WebhookEvent, and any raw or summarized billing/email-provider webhook payload — provider-internal plumbing, never something a user asked the assistant about.",
  },
  {
    category: "raw-internal-ids",
    note: "Any bare UUID (id, organizationId, userId, clientId, projectId, taskId, invoiceId, and equivalents) appearing in a tool's model-facing output or the assistant's rendered text. A tool implementation may use an id internally to chain a second lookup (e.g. resolve a client id from a search hit, then fetch that client's detail) — that id must never itself be included in what the model receives or the user reads, except where strictly unavoidable (the architecture plan's own explicit, narrow exception — not a default).",
  },
];

/** True only for an exact match against one of this policy's fixed, named fields (the four field-name-shaped categories above). Categorical rules (auth/session material, Platform Admin data, webhook payloads, raw internal ids) are structural exclusions enforced by import boundaries and output-schema review, not by name-matching a single field — see each rule's own `note`. */
export function isForbiddenFieldName(fieldName: string): boolean {
  return AI_FORBIDDEN_FIELD_POLICY.some((rule) => rule.fieldNames?.includes(fieldName) ?? false);
}

export function getForbiddenFieldCategories(): readonly AiForbiddenFieldCategory[] {
  return AI_FORBIDDEN_FIELD_POLICY.map((rule) => rule.category);
}
