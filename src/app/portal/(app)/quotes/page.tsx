import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalQuotes } from "@/lib/client-portal/queries";
import { formatCurrency } from "@/lib/format";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { deriveQuoteStatusDisplay } from "@/lib/quotes/status-display";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

/**
 * Quotes / Estimates Phase 4 (Client Portal approval/decline) §D. Shows
 * only this Portal Client's own SENT/APPROVED/DECLINED Quotes
 * (getPortalQuotes already excludes DRAFT and archived — see its own doc
 * comment) — DRAFT never appears here, matching Invoice's own identical
 * "never visible" rule, and there is no archive-visibility toggle on this
 * list (unlike the Staff one), matching every other Portal list in this
 * app.
 */
export default async function PortalQuotesPage() {
  const { clientId, organizationId } = await getCurrentPortalUser();
  const quotes = await getPortalQuotes(clientId, organizationId);

  return (
    <div>
      <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Quotes</h1>
      <p className="text-text-muted mt-1 text-sm">
        {quotes.length} {quotes.length === 1 ? "quote" : "quotes"}
      </p>

      {quotes.length === 0 ? (
        <EmptyState title="No quotes" description="Quotes will appear here once your team sends you one." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Quote #</TableHeaderCell>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Issue date</TableHeaderCell>
              <TableHeaderCell>Valid until</TableHeaderCell>
              <TableHeaderCell>Total</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {quotes.map((quote) => {
              const { key, label } = deriveQuoteStatusDisplay(quote);
              return (
                <TableRow key={quote.id}>
                  <TableCell emphasis>
                    <Link
                      href={`/portal/quotes/${quote.id}`}
                      className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    >
                      {quote.number}
                    </Link>
                  </TableCell>
                  <TableCell>{quote.title ?? "—"}</TableCell>
                  <TableCell>{formatDateOnlyForDisplay(quote.issueDate)}</TableCell>
                  <TableCell>{quote.validUntil ? formatDateOnlyForDisplay(quote.validUntil) : "—"}</TableCell>
                  <TableCell>{formatCurrency(quote.total, quote.currency)}</TableCell>
                  <TableCell>
                    <StatusBadge status={key} label={label} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
