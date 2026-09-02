import { prisma } from "@/lib/prisma";
import { INVOICE_STATUSES } from "@/lib/validation/invoice";
import { escapeLikePattern } from "@/lib/search/normalize-query";
import { isPlainObject, hasOnlyAllowedKeys, isValidOptionalQuery, isValidOptionalEnum } from "./validation";
import { assertExactKeysList } from "./output-projection";
import { toolError, toolOk, type AiToolResult } from "./result";
import { SEARCH_INVOICES_LIMIT } from "./limits";

/**
 * AI Assistant Batch 1B.2 — Tool 6: searchInvoices.
 *
 * The highest-sensitivity read domain in the first AI tool layer. A new,
 * independent, narrow Prisma reader under src/lib/ai/tools — not a reuse
 * of invoices/query.ts (clause-builder only; the real page.tsx runs an
 * `include`-based findMany that returns every Invoice column, including
 * internalNotes/issuerSnapshot/pdfStoragePath) and not a reuse of
 * search-invoices.ts either (kept independent for this tool's own trust
 * boundary, same reasoning as every other Batch 1B.1 tool's own doc
 * comment — and that module's own select omits amount/status/currency/
 * dueDate entirely, since it exists only to build a navigation link).
 *
 * Tenant scoping is the established triple defense-in-depth
 * search-invoices.ts itself already uses: Invoice.organizationId AND
 * project.organizationId AND client.organizationId, all required
 * simultaneously. An Invoice's Client/Project always belong to the same
 * organization in valid data, so this costs nothing on the happy path
 * and refuses to surface a row in the rare case those relations were
 * ever inconsistent — see the integration test that deliberately
 * constructs exactly that inconsistency.
 *
 * NO ref, NO id: unlike Client/Project/Task, this batch adds no invoice
 * detail tool at all (a deliberate, approved scope decision — see the
 * Batch 1B.2 plan's own reasoning), so there is nothing to chain a
 * reference to. `id` is never selected — Prisma's own `orderBy` operates
 * independently of `select`, so the deterministic id tie-break below
 * needs no `id` column in the projected output at all.
 *
 * CRITICAL financial-privacy invariant: this file's own `select` is the
 * one enforcement point for the entire hard-invariant field list the
 * approved plan names (notes, internalNotes, issuerSnapshot,
 * recipientSnapshot, lineItems, subtotal/discountType/discountValue/
 * discountAmount/taxRatePercent/taxLabel/taxAmount, issueDate, paidAt,
 * finalizedAt, pdfStoragePath, pdfGeneratedAt, documentVersion,
 * emailAttempts, and every field reachable only through those relations)
 * — none of them, and no relation carrying them, is ever selected.
 */

const SEARCH_INPUT_KEYS = ["query", "status"] as const;

export type InvoiceSearchItem = {
  invoiceNumber: string;
  status: string;
  amount: number;
  currency: string;
  dueDate: string | null;
  clientName: string;
  projectName: string;
};
const SEARCH_ITEM_KEYS = ["invoiceNumber", "status", "amount", "currency", "dueDate", "clientName", "projectName"] as const;

export type InvoiceSearchData = { results: InvoiceSearchItem[] };
export type InvoiceSearchOutput = AiToolResult<InvoiceSearchData>;

const TOOL_NAME = "searchInvoices";

function validateInput(rawInput: unknown): { query?: string; status?: string } | null {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, SEARCH_INPUT_KEYS)) return null;
  if (!isValidOptionalQuery(input.query)) return null;
  if (!isValidOptionalEnum(input.status, INVOICE_STATUSES)) return null;
  return { query: input.query as string | undefined, status: input.status as string | undefined };
}

export async function executeSearchInvoices(organizationId: string, rawInput: unknown): Promise<InvoiceSearchOutput> {
  const validated = validateInput(rawInput);
  if (!validated) {
    return toolError("invalid_input");
  }

  try {
    const trimmedQuery = validated.query?.trim();
    const rows = await prisma.invoice.findMany({
      where: {
        organizationId,
        project: { organizationId },
        client: { organizationId },
        ...(validated.status ? { status: validated.status as (typeof INVOICE_STATUSES)[number] } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { invoiceNumber: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } },
                { project: { name: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } } },
                { project: { client: { name: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      select: {
        invoiceNumber: true,
        status: true,
        amount: true,
        currency: true,
        dueDate: true,
        project: { select: { name: true, client: { select: { name: true } } } },
      },
      // Deterministic: dueDate ascending with nulls sorted last (a DRAFT
      // invoice often has no dueDate yet), then id ascending as a strict
      // tie-break — id is never selected above, but Prisma's own orderBy
      // is independent of select, so this needs no id column in the
      // projected output at all.
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: SEARCH_INVOICES_LIMIT,
    });

    const results = assertExactKeysList(
      rows.map(
        (row): InvoiceSearchItem => ({
          invoiceNumber: row.invoiceNumber,
          status: row.status,
          amount: Number(row.amount),
          currency: row.currency,
          dueDate: row.dueDate ? row.dueDate.toISOString() : null,
          clientName: row.project.client.name,
          projectName: row.project.name,
        }),
      ),
      SEARCH_ITEM_KEYS,
      TOOL_NAME,
    ) as InvoiceSearchItem[];

    return toolOk({ results });
  } catch {
    return toolError("unavailable");
  }
}

export const SEARCH_INVOICES_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 100, description: "Optional text to match against invoice number, project name, or client name." },
    status: { type: "string", enum: INVOICE_STATUSES, description: "Optional invoice status filter." },
  },
  additionalProperties: false,
} as const;

export const SEARCH_INVOICES_DESCRIPTION =
  "Searches the current organization's invoices by invoice number/project/client name and optional status. Returns up to 10 matches, soonest due date first (invoices with no due date last). Never includes notes, internal notes, line items, or any payment/provider details.";
