/**
 * Quotes / Estimates Phase 3 (Staff UI) §M/§N — the single place that
 * decides what a Quote's own target (Lead or Client) displays as, so the
 * list page and the read-only view never re-derive this independently
 * and risk disagreeing (same "one shared helper" discipline
 * quote-status-badge.tsx already established for status).
 *
 * A Quote's own durable invariant (Quote's schema comment, §B of this
 * phase's own task spec): clientId set means this Quote's CURRENT,
 * invoiceable target is that Client — whether it was created directly
 * against one, or reached this state later because the Lead it was
 * originally attached to converted. leadId, once set, is never cleared,
 * even after that happens — so a reconciled Quote can carry both. This
 * helper's own `type` always reflects the CURRENT target (CLIENT
 * whenever clientId is set, even if leadId also is) — that's the
 * actionable, "who do I invoice" fact a compact list row needs. The
 * original Lead is never hidden, though: `originLead` is populated
 * whenever leadId is set, regardless of `type`, so a caller that wants to
 * show "originally from Lead X" (the read-only view always does, per §G)
 * has that context without a second query.
 */

export type QuoteTargetDisplayInput = {
  leadId: string | null;
  clientId: string | null;
  lead: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
};

export type QuoteTargetDisplay = {
  type: "LEAD" | "CLIENT";
  name: string;
  href: string;
  /** Set whenever leadId is present, regardless of `type` — see this module's own header comment. */
  originLead: { id: string; name: string; href: string } | null;
};

export function deriveQuoteTargetDisplay(quote: QuoteTargetDisplayInput): QuoteTargetDisplay {
  const originLead =
    quote.leadId && quote.lead ? { id: quote.lead.id, name: quote.lead.name, href: `/leads/${quote.lead.id}/edit` } : null;

  if (quote.clientId && quote.client) {
    return { type: "CLIENT", name: quote.client.name, href: `/clients/${quote.client.id}/edit`, originLead };
  }

  // Quote's own durable invariant: never both null. If clientId/client
  // isn't the current target, leadId/lead must be — this branch never
  // silently falls through to a placeholder.
  return {
    type: "LEAD",
    name: quote.lead?.name ?? "—",
    href: quote.leadId ? `/leads/${quote.leadId}/edit` : "#",
    originLead,
  };
}
