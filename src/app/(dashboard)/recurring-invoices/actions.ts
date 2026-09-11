"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentMembership } from "@/lib/current-user";
import {
  createRecurringInvoice,
  updateRecurringInvoice,
  pauseRecurringInvoice,
  resumeRecurringInvoice,
  archiveRecurringInvoice,
  getRecurringInvoice,
} from "@/lib/recurring-invoices/recurring-invoices";
import { generateRecurringInvoiceOccurrence, isRecurringInvoiceDueToday } from "@/lib/recurring-invoices/generate";
import { decodeInvoiceLineItemsFormValue } from "@/lib/invoices/line-items-form";
import { withToast } from "@/lib/toast-url";
import type { RecurringInvoiceFormState } from "@/types";

/**
 * Recurring Invoices Phase 2A — Staff Server Action layer. Every action
 * resolves the authenticated staff member itself (getCurrentMembership())
 * and calls straight into the unchanged Phase 1 domain functions — no
 * authorization, claim, idempotency, or numbering logic is duplicated
 * here (see generateDueInvoiceAction's own header comment for that last
 * point specifically). Every mutator's own return value is translated
 * into a plain {error}/{fieldErrors} shape or a safe {ok,reason} result,
 * the same "Server Action returns/maps the domain result, never invents
 * its own check" convention every other Phase 2A this session already
 * established.
 */

const GENERIC_ERROR = "Something went wrong. Please try again.";
const LINE_ITEMS_MALFORMED_ERROR = "Line items could not be read. Please try again.";

function revalidateRecurringInvoicePaths(recurringInvoiceId?: string) {
  revalidatePath("/recurring-invoices");
  if (recurringInvoiceId) {
    revalidatePath(`/recurring-invoices/${recurringInvoiceId}`);
  }
}

/**
 * Every failure reason create/updateRecurringInvoice can return, mapped to
 * a safe, user-facing message — never a raw internal error string.
 * FORBIDDEN/INVALID_TARGET/NOT_FOUND are all genuinely unreachable through
 * this form's own well-behaved UI (the Client/Project selects only ever
 * offer same-org/same-client options, the page itself gates on role) —
 * handled explicitly anyway, per this app's existing "the boundary
 * enforces it independently of what the UI does or doesn't offer"
 * convention.
 */
function mapFailureToFormState(reason: string): RecurringInvoiceFormState {
  switch (reason) {
    case "FORBIDDEN":
      return { error: "You don't have permission to do that." };
    case "INVALID_TARGET":
      return { error: null, fieldErrors: { clientId: "Select a valid client and project." } };
    case "NOT_FOUND":
      return { error: "This recurring invoice is no longer available." };
    default:
      return { error: GENERIC_ERROR };
  }
}

function decodeLineItemsOrFormState(raw: FormDataEntryValue | null): { ok: true; lineItems: { description: string; quantity: string; unitPrice: string }[] } | { ok: false; state: RecurringInvoiceFormState } {
  const decoded = decodeInvoiceLineItemsFormValue(typeof raw === "string" ? raw : "");
  if (!decoded.ok) {
    return { ok: false, state: { error: null, fieldErrors: { lineItems: LINE_ITEMS_MALFORMED_ERROR } } };
  }
  return { ok: true, lineItems: decoded.lineItems };
}

export async function createRecurringInvoiceAction(
  _prevState: RecurringInvoiceFormState,
  formData: FormData,
): Promise<RecurringInvoiceFormState> {
  const { user, organizationId, membership } = await getCurrentMembership();

  const lineItemsResult = decodeLineItemsOrFormState(formData.get("lineItems"));
  if (!lineItemsResult.ok) {
    return lineItemsResult.state;
  }

  const result = await createRecurringInvoice(organizationId, { id: user.id, name: user.name, role: membership.role }, {
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    projectId: formData.get("projectId") || null,
    frequency: formData.get("frequency"),
    firstIssueDate: formData.get("firstIssueDate"),
    invoiceNumberPrefix: formData.get("invoiceNumberPrefix"),
    startingSequence: formData.get("startingSequence") || undefined,
    dueDateOffsetDays: formData.get("dueDateOffsetDays") || undefined,
    currency: formData.get("currency"),
    discountType: formData.get("discountType"),
    discountValue: formData.get("discountValue"),
    taxRatePercent: formData.get("taxRatePercent"),
    taxLabel: formData.get("taxLabel"),
    notes: formData.get("notes"),
    internalNotes: formData.get("internalNotes"),
    lineItems: lineItemsResult.lineItems,
  });

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: null, fieldErrors: result.fieldErrors };
    }
    return mapFailureToFormState(result.reason);
  }

  revalidateRecurringInvoicePaths();
  redirect(withToast(`/recurring-invoices/${result.recurringInvoice.id}`, "Recurring invoice created"));
}

export async function updateRecurringInvoiceAction(
  recurringInvoiceId: string,
  _prevState: RecurringInvoiceFormState,
  formData: FormData,
): Promise<RecurringInvoiceFormState> {
  const { user, organizationId, membership } = await getCurrentMembership();

  const lineItemsResult = decodeLineItemsOrFormState(formData.get("lineItems"));
  if (!lineItemsResult.ok) {
    return lineItemsResult.state;
  }

  const result = await updateRecurringInvoice(organizationId, recurringInvoiceId, { id: user.id, name: user.name, role: membership.role }, {
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    projectId: formData.get("projectId") || null,
    invoiceNumberPrefix: formData.get("invoiceNumberPrefix"),
    dueDateOffsetDays: formData.get("dueDateOffsetDays") || undefined,
    currency: formData.get("currency"),
    discountType: formData.get("discountType"),
    discountValue: formData.get("discountValue"),
    taxRatePercent: formData.get("taxRatePercent"),
    taxLabel: formData.get("taxLabel"),
    notes: formData.get("notes"),
    internalNotes: formData.get("internalNotes"),
    lineItems: lineItemsResult.lineItems,
  });

  if (!result.ok) {
    if (result.reason === "VALIDATION") {
      return { error: null, fieldErrors: result.fieldErrors };
    }
    return mapFailureToFormState(result.reason);
  }

  revalidateRecurringInvoicePaths(recurringInvoiceId);
  redirect(withToast(`/recurring-invoices/${recurringInvoiceId}`, "Recurring invoice updated"));
}

export type LifecycleActionResult = { ok: true } | { ok: false; reason: string };

export async function pauseRecurringInvoiceAction(recurringInvoiceId: string): Promise<LifecycleActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await pauseRecurringInvoice(organizationId, recurringInvoiceId, { id: user.id, name: user.name, role: membership.role });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  revalidateRecurringInvoicePaths(recurringInvoiceId);
  return { ok: true };
}

export async function resumeRecurringInvoiceAction(recurringInvoiceId: string): Promise<LifecycleActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await resumeRecurringInvoice(organizationId, recurringInvoiceId, { id: user.id, name: user.name, role: membership.role });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  revalidateRecurringInvoicePaths(recurringInvoiceId);
  return { ok: true };
}

export async function archiveRecurringInvoiceAction(recurringInvoiceId: string): Promise<LifecycleActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const result = await archiveRecurringInvoice(organizationId, recurringInvoiceId, { id: user.id, name: user.name, role: membership.role });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  revalidateRecurringInvoicePaths(recurringInvoiceId);
  return { ok: true };
}

export type GenerateDueInvoiceActionResult =
  | { ok: true; outcome: "generated"; invoiceId: string }
  | { ok: true; outcome: "skipped_completed" }
  | { ok: true; outcome: "skipped_claimed" }
  | { ok: true; outcome: "failed" }
  | { ok: false; reason: string };

/**
 * The manual "Generate due invoice" trigger — a thin wrapper only.
 * Everything that actually decides correctness/idempotency
 * (claim/reclaim, numbering retry/exhaustion, exactly-once generation)
 * lives exclusively in the unchanged Phase 1 generateRecurringInvoiceOccurrence().
 * This action performs exactly three things: (1) re-verify OWNER/ADMIN +
 * org scope via getRecurringInvoice() (never trusts the page's own
 * rendering decision), (2) re-verify ACTIVE + due "today" via the exact
 * same isRecurringInvoiceDueToday() the domain layer's own
 * isValidOccurrenceDate() uses internally (never a second, independently
 * maintained copy of that date math) — a safe, cheap pre-check that lets
 * a stale button click fail with a clear reason rather than reaching the
 * generator at all, and (3) resolves `now` exactly once and calls
 * generateRecurringInvoiceOccurrence() with the schedule's own CURRENT
 * nextIssueDate as occurrenceDate. It never claims, never retries
 * numbering, never writes to RecurringInvoiceOccurrence directly.
 */
export async function generateDueInvoiceAction(recurringInvoiceId: string): Promise<GenerateDueInvoiceActionResult> {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const readResult = await getRecurringInvoice(organizationId, recurringInvoiceId, actor);
  if (!readResult.ok) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  const schedule = readResult.recurringInvoice;
  if (!schedule) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const now = new Date();

  if (schedule.status !== "ACTIVE") {
    return { ok: false, reason: "NOT_ACTIVE" };
  }
  if (!isRecurringInvoiceDueToday(schedule.nextIssueDate, now)) {
    return { ok: false, reason: "NOT_DUE" };
  }

  const generation = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, now);

  revalidateRecurringInvoicePaths(recurringInvoiceId);

  switch (generation.outcome) {
    case "generated":
      revalidatePath("/invoices");
      return { ok: true, outcome: "generated", invoiceId: generation.invoiceId };
    case "skipped_completed":
      return { ok: true, outcome: "skipped_completed" };
    case "skipped_claimed":
      return { ok: true, outcome: "skipped_claimed" };
    case "failed":
      return { ok: true, outcome: "failed" };
    // not_active/not_found/invalid_occurrence_date — structurally
    // unreachable given the pre-checks above (same ACTIVE+due state was
    // just verified moments earlier), handled explicitly anyway per this
    // app's own "the boundary enforces it independently of the UI"
    // convention, never a raw internal outcome string surfaced.
    default:
      return { ok: false, reason: "NOT_ELIGIBLE" };
  }
}
