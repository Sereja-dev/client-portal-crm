import { formatTrackedDuration } from "@/lib/reports/format";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { ReportsClientTime } from "@/lib/reports/queries/time";

/**
 * Reports Phase 2 — not a billing report: this table shows tracked TIME
 * only, never a monetary value (TimeEntry has no rate field anywhere in
 * this schema). Rows only ever include time mapped through Project ->
 * Client (Phase 1's own getTimeByClient) — the overall Tracked hours KPI
 * on this same page can be larger, since it also includes projectless/
 * unmapped entries this table structurally cannot attribute to any
 * Client; the note below makes that explicit rather than leaving the two
 * numbers to silently disagree.
 */
export function ReportsTimeByClientTable({ timeByClient }: { timeByClient: readonly ReportsClientTime[] }) {
  return (
    <section aria-labelledby="reports-time-by-client-heading" className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 id="reports-time-by-client-heading" className="text-text-primary text-base font-semibold">
        Time by Client
      </h2>
      <p className="text-text-muted mt-1 text-sm">Tracked time in the selected period</p>

      {timeByClient.length === 0 ? (
        <p className="text-text-muted mt-4 text-sm">No tracked time in this period.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border-default border-b text-left">
                  <th scope="col" className="text-text-muted py-2 pr-4 font-medium">
                    Client
                  </th>
                  <th scope="col" className="text-text-muted py-2 font-medium">
                    Tracked time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border-default divide-y">
                {timeByClient.map((client) => (
                  <tr key={client.clientId}>
                    <td className="text-text-primary py-2 pr-4 font-medium whitespace-nowrap">{client.clientName}</td>
                    <td className="text-text-primary py-2 whitespace-nowrap">{formatTrackedDuration(client.totalMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-text-muted mt-3 text-xs">Total tracked time may include entries not assigned to a client.</p>
        </>
      )}
    </section>
  );
}
