import { formatCurrency } from "@/lib/format";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { ReportsTopClient } from "@/lib/reports/queries/financial";

/** Reports Phase 2 — read-only ranking table, fed exactly getTopClientsByPaidRevenue()'s own already-currency-scoped, already-capped-at-5 result (Phase 1). Never re-sorts, re-filters, or re-aggregates. */
export function ReportsTopClientsTable({ topClients, currency }: { topClients: readonly ReportsTopClient[]; currency: string | null }) {
  return (
    <section aria-labelledby="reports-top-clients-heading" className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 id="reports-top-clients-heading" className="text-text-primary text-base font-semibold">
        Top Clients
      </h2>
      <p className="text-text-muted mt-1 text-sm">By paid revenue in the selected period</p>

      {topClients.length === 0 ? (
        <p className="text-text-muted mt-4 text-sm">No paid invoices in this period.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border-default border-b text-left">
                <th scope="col" className="text-text-muted py-2 pr-4 font-medium">
                  Client
                </th>
                <th scope="col" className="text-text-muted py-2 pr-4 font-medium">
                  Paid revenue
                </th>
                <th scope="col" className="text-text-muted py-2 font-medium">
                  Invoices
                </th>
              </tr>
            </thead>
            <tbody className="divide-border-default divide-y">
              {topClients.map((client) => (
                <tr key={client.clientId}>
                  <td className="text-text-primary py-2 pr-4 font-medium whitespace-nowrap">{client.clientName}</td>
                  <td className="text-text-primary py-2 pr-4 whitespace-nowrap">
                    {currency ? formatCurrency(client.paidAmount, currency) : client.paidAmount}
                  </td>
                  <td className="text-text-secondary py-2">{client.paidInvoiceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
