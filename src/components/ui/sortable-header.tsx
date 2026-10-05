import Link from "next/link";
import { TableHeaderCell } from "@/components/ui/table";

export type SortableHeaderDirection = "asc" | "desc";

/**
 * Tables Improvement Slice A — exposes EXISTING server-side sorting
 * (readiness audit §R/§S: every list already has a safe, allowlisted
 * `parseSortParam`/`buildXOrderBy` pipeline, surfaced today only through
 * a `<select>` dropdown) through a clickable desktop `<th>`, without
 * building a generic column-definition framework and without ever
 * accepting an arbitrary database field name itself.
 *
 * Deliberately dumb: this component never knows what "amount" or
 * "dueDate" mean, never constructs a Prisma `orderBy`, and never
 * validates a field against an allowlist — the caller (Invoice's own
 * page, reading its own already-reviewed `INVOICE_SORT_FIELDS`
 * allowlist) is the only place that authority lives, exactly matching
 * `SearchFilterBar`'s own "this component decides what to show, never
 * what's safe to query" precedent. `href` is a plain, already-built
 * string — this component does not touch `URLSearchParams` itself.
 *
 * Delegates its own `<th>` rendering to `TableHeaderCell` (passing
 * `ariaSort` straight through) rather than hand-rolling a second `<th>`
 * implementation, so a sortable and a non-sortable header in the same
 * `<tr>` are byte-identical in every way except the interactive content
 * inside.
 */
export function SortableHeader({
  label,
  href,
  direction,
  align = "left",
}: {
  label: string;
  /** Already-built target href (e.g. `/invoices?sort=dueDate:asc&status=SENT`) — see this component's own header comment on why this primitive never builds it itself. */
  href: string;
  /** `undefined`/`null` — this column is not the current sort key. Never fabricate a direction for an unsorted column (WAI-ARIA: omit aria-sort rather than assert "none" on a column that isn't even sortable-by-the-current-request). */
  direction?: SortableHeaderDirection | null;
  align?: "left" | "right";
}) {
  const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined;
  // "not sorted" is the one direction value this component DOES assert
  // for a column that IS sortable but isn't the current key — WAI-ARIA
  // permits `aria-sort="none"` for exactly this case, distinct from
  // omitting the attribute entirely (which this component reserves for
  // a column that was never sortable at all, via TableHeaderCell's own
  // default `ariaSort={undefined}`).
  const resolvedAriaSort = direction ? ariaSort : "none";

  return (
    <TableHeaderCell align={align} ariaSort={resolvedAriaSort}>
      <Link
        href={href}
        className={`text-text-muted hover:text-text-primary focus-visible:ring-focus-ring inline-flex items-center gap-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[10px] leading-none">
          {direction === "asc" ? "▲" : direction === "desc" ? "▼" : "⇅"}
        </span>
        <span className="sr-only">
          {direction === "asc" ? ", sorted ascending" : direction === "desc" ? ", sorted descending" : ", not sorted"}
        </span>
      </Link>
    </TableHeaderCell>
  );
}
