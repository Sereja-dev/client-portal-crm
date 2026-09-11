import { AutoSubmitSelect } from "@/components/list/auto-submit-select";
import { Button } from "@/components/ui/button";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import Link from "next/link";

/**
 * Recurring Invoices Phase 2A — status/client filter bar. Mirrors
 * TimeEntryFilterBar's own exact shape (plain `method="GET"` form,
 * AutoSubmitSelect for both selects) — the established, idiomatic
 * query-param filter pattern this session's own Phase 2 readiness
 * assessment identified as the better precedent over a useRouter-based
 * filter component.
 */
export function RecurringInvoiceFilterBar({
  status,
  clientId,
  clients,
  hasActiveFilters,
}: {
  status: string;
  clientId: string;
  clients: { id: string; name: string }[];
  hasActiveFilters: boolean;
}) {
  return (
    <form method="GET" action="/recurring-invoices" className={`mt-6 flex flex-wrap items-end gap-4 p-4 ${CARD_SURFACE_CLASSES}`}>
      <div className="w-40">
        <label htmlFor="status" className="text-text-secondary block text-sm font-medium">
          Status
        </label>
        <AutoSubmitSelect id="status" name="status" defaultValue={status}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="ARCHIVED">Archived</option>
        </AutoSubmitSelect>
      </div>

      <div className="w-56">
        <label htmlFor="clientId" className="text-text-secondary block text-sm font-medium">
          Client
        </label>
        <AutoSubmitSelect id="clientId" name="clientId" defaultValue={clientId}>
          <option value="">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </AutoSubmitSelect>
      </div>

      <Button type="submit" variant="secondary">
        Filter
      </Button>

      {hasActiveFilters && (
        <Link href="/recurring-invoices" className={ACTION_LINK_CLASSES}>
          Clear filters
        </Link>
      )}
    </form>
  );
}
