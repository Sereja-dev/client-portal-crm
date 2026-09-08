/**
 * Quotes / Estimates Phase 2.2 — TRANSITIONAL compile-safety layer only.
 *
 * prisma/schema.prisma's own Invoice.projectId/project comment explains
 * the staged rollout this bridges: the schema now permits a null
 * Project (migration 20260922090000_make_invoice_project_optional), but
 * every write path the currently deployed application actually has
 * (createInvoiceAction/updateInvoiceAction/duplicate — Quote -> Invoice
 * conversion does not exist yet) still always supplies a real, verified
 * Project. No code path can produce a null value before Phase 2.3 ships
 * its own full null-safe sweep (Client-required/Project-optional forms,
 * Dashboard/Portal/Search/AI/PDF adapted to a real "no project" state).
 *
 * This module exists ONLY to let already-correct, unmodified call sites
 * keep compiling against Prisma's now-nullable generated types, by
 * asserting today's real runtime invariant explicitly instead of
 * scattering ad hoc non-null assertions (`!`) across ~14 files. It
 * changes no query, no filter, no display, no authorization — every
 * call site using this helper is expected to be REMOVED by Phase 2.3's
 * own sweep once a null Project becomes a real, handled product state,
 * not kept long-term. Grep for `requireInvoiceProject`/
 * `requireInvoiceProjectId` to find every site.
 *
 * Mirrors this codebase's own existing "module-internal, never exposed
 * to a user, thrown on a should-be-unreachable state" convention (see
 * `LedgerTransitionInvariantError` in src/lib/invoices/pdf/issue-
 * invoice.ts and legacy-archive-invoice.ts) rather than inventing a new
 * error framework — exported here (unlike those two) only because this
 * one invariant is asserted from many independent modules (Dashboard,
 * Portal, Search, the AI assistant, PDF issuance, the Invoice CRUD
 * actions/pages), not from a single module's own top-level try/catch.
 * Callers must never catch this and forward its `.message` to any
 * client-visible field (a Server Action result, an API response, a
 * rendered error string) — letting it propagate uncaught, like any other
 * genuinely unreachable invariant failure, is the correct and only
 * intended handling.
 */
export class InvoiceProjectInvariantError extends Error {
  constructor(context: string) {
    super(
      `Invariant violated: Invoice.project was unexpectedly null (${context}). Every Invoice the current application creates always has a Project — this should be unreachable before Phase 2.3.`,
    );
    this.name = "InvoiceProjectInvariantError";
  }
}

/**
 * Narrows a possibly-null Invoice.project relation value (or any object
 * shape selected off it, e.g. `{ name: string }`) back to its non-null
 * type. `context` is a short, static, human-readable label identifying
 * the call site (e.g. "dashboard overdue invoices list") — included only
 * in the thrown error's own message for server-side log readability,
 * never derived from user input.
 */
export function requireInvoiceProject<T>(project: T | null, context: string): T {
  if (project === null) {
    throw new InvoiceProjectInvariantError(context);
  }
  return project;
}

/**
 * Same contract as requireInvoiceProject, for the sites that only ever
 * select the bare `projectId` scalar (never the full relation) and
 * still need a plain `string`.
 */
export function requireInvoiceProjectId(projectId: string | null, context: string): string {
  if (projectId === null) {
    throw new InvoiceProjectInvariantError(context);
  }
  return projectId;
}
