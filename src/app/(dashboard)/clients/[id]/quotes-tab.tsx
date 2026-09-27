import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import { formatCurrency } from "@/lib/format";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import type { ClientQuoteRow } from "./profile-query";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString() : "—";
}

/** Each row's own total is formatted in that quote's own currency — never summed across rows (Section 14's own explicit invariant). */
export function ClientQuotesTab({ clientId, quotes }: { clientId: string; quotes: ClientQuoteRow[] }) {
  if (quotes.length === 0) {
    return (
      <EmptyState
        title="No quotes yet"
        description="Quotes for this client will appear here."
        action={
          <Link href={`/quotes/new?clientId=${clientId}`} className={PRIMARY_LINK_CLASSES}>
            Create quote
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Quote #</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Issued</TableHeaderCell>
              <TableHeaderCell>Valid until</TableHeaderCell>
              <TableHeaderCell align="right">Total</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {quotes.map((quote) => (
              <TableRow key={quote.id}>
                <TableCell emphasis>
                  <Link href={`/quotes/${quote.id}/edit`} className={ACTION_LINK_CLASSES}>
                    {quote.number}
                  </Link>
                </TableCell>
                <TableCell>
                  <QuoteStatusBadge quote={quote} />
                </TableCell>
                <TableCell>{formatDate(quote.issueDate)}</TableCell>
                <TableCell>{formatDate(quote.validUntil)}</TableCell>
                <TableCell align="right">{formatCurrency(Number(quote.total), quote.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordCardList>
        {quotes.map((quote) => (
          <RecordCard key={quote.id}>
            <RecordCardField
              label="Quote #"
              value={
                <Link href={`/quotes/${quote.id}/edit`} className={ACTION_LINK_CLASSES}>
                  {quote.number}
                </Link>
              }
              emphasis
            />
            <RecordCardField label="Status" value={<QuoteStatusBadge quote={quote} />} />
            <RecordCardField label="Issued" value={formatDate(quote.issueDate)} />
            <RecordCardField label="Valid until" value={formatDate(quote.validUntil)} />
            <RecordCardField label="Total" value={formatCurrency(Number(quote.total), quote.currency)} />
          </RecordCard>
        ))}
      </RecordCardList>
    </>
  );
}
