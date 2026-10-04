import "server-only";
import { getCurrentMembership } from "@/lib/current-user";
import { canApplyContractTemplates } from "./authorization";
import { getActiveContractTemplateForApply } from "./queries";
import { addExpiryOffsetDays } from "./date";
import { formatDateOnly } from "@/lib/invoices/date-only";

/**
 * Contract Templates V1 — the one, read-only apply/prefill entry point.
 * Mirrors src/lib/invoice-templates/apply.ts's own identical shape
 * exactly: resolves the current Staff member/organization itself (never
 * accepts organizationId as a parameter), permits any Staff role already
 * allowed to create a Contract (canApplyContractTemplates() — currently
 * every role), rejects a foreign-org id and an archived template
 * identically to "not found" (getActiveContractTemplateForApply's own
 * contract), and returns a plain, already-serializable prefill object.
 *
 * Creates nothing. Mutates nothing. No Contract row, no Activity row, no
 * Workflow Automation event — this function is a single read query plus
 * pure date arithmetic, nothing else. The `/contracts/new?templateId=<id>`
 * route calls this and hands the result to the existing, completely
 * unmodified ContractForm/createContract path — exactly the same
 * "read-only prefill, ordinary create action does the real write" shape
 * getInvoiceTemplateDefaults()/getQuoteTemplateDefaults() already
 * established.
 *
 * Deliberately never supplies contractNumber/clientId/projectId/
 * signatoryContactId/issueDate/effectiveDate/status — ContractTemplate
 * stores none of these (fixed Product decision; see ContractTemplate's
 * own schema doc comment). `/contracts/new` currently has no other
 * prefill mechanism of any kind to compose with (confirmed — no existing
 * `?clientId=`/`?projectId=` handling on that route today), so this
 * function's result is simply merged wholesale into ContractForm's own
 * `defaultValues`.
 *
 * `expiresAt` is always computed relative to `now` (standing in for the
 * NEW Contract's own issueDate, which defaults to "today" exactly like
 * every other new Contract) — never relative to effectiveDate, per the
 * approved Slice B spec's own fixed §9 "expiry = issueDate + offset,
 * never effectiveDate-relative" rule.
 *
 * `now` is always caller-supplied (never `new Date()` called internally)
 * so a test can assert the exact resulting `expiresAt` deterministically
 * — mirrors every other "one authoritative now" entry point in this app.
 */

/**
 * Only what a NEW Contract's own create form needs to prefill itself with
 * — deliberately never organizationId, createdByUserId, archivedAt, or
 * any other template-management metadata, and never any Contract-record
 * identity (Client/Project/signatory, contract number, status, issue/
 * effective date, snapshots): none of those can or should come from a
 * template (see ContractTemplate's own schema comment — Contract
 * Templates V1 are deliberately client/project/signatory-agnostic).
 */
export type ContractTemplateApplyDefaults = {
  title: string;
  body: string;
  /** "YYYY-MM-DD", matching the same date-only string shape Contract's own create form already expects for expiresAt — or null when the template has no defaultExpiryOffsetDays set. Already computed server-side from `now`'s own UTC calendar date; the caller never needs to re-derive it. */
  expiresAt: string | null;
  internalNotes: string | null;
};

export type GetContractTemplateDefaultsResult =
  | { ok: true; defaults: ContractTemplateApplyDefaults }
  | { ok: false; reason: "NOT_FOUND" };

export async function getContractTemplateDefaults(templateId: string, now: Date = new Date()): Promise<GetContractTemplateDefaultsResult> {
  const { organizationId, membership } = await getCurrentMembership();

  // Documented as always true today (see authorization.ts's own header
  // comment) -- called anyway so a future change to Contract-create
  // permissions is enforced here automatically, without this file
  // needing to change.
  if (!canApplyContractTemplates(membership.role)) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const template = await getActiveContractTemplateForApply(organizationId, templateId);
  if (!template) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const expiresAt = template.defaultExpiryOffsetDays != null ? formatDateOnly(addExpiryOffsetDays(now, template.defaultExpiryOffsetDays)) : null;

  return {
    ok: true,
    defaults: {
      title: template.title,
      body: template.body,
      expiresAt,
      internalNotes: template.internalNotes,
    },
  };
}
