import { getWebsiteTraffic, type WebsiteTrafficResult } from "@/lib/platform-admin/queries/website-traffic";
import { GrowthStatCard } from "@/components/platform-admin/growth-stat-card";
import { TrafficTrendChart } from "@/components/platform-admin/traffic-trend-chart";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Website Traffic V1. Rendered inside its own <Suspense> on the Growth page,
 * and getWebsiteTraffic() never throws (every failure is a typed result), so
 * an analytics outage can only change THIS section — never the registration
 * cards, chart or directory next to it. Traffic and Staff registrations are
 * different data sources and are never combined here: no conversion rate is
 * computed, because daily-hashed visitors on aqenra.com and signups on
 * app.aqenra.com carry no shared attribution.
 */

const UNAVAILABLE_COPY: Record<Extract<WebsiteTrafficResult, { status: "unavailable" }>["reason"], string> = {
  auth_failed: "Vercel rejected the analytics access token. Check the token and its scope.",
  rate_limited: "Vercel is rate limiting analytics requests. Try again in a few minutes.",
  timeout: "Vercel Web Analytics did not respond in time.",
  upstream_error: "Vercel Web Analytics is temporarily unavailable.",
  invalid_response: "Vercel Web Analytics returned a response that could not be read.",
  unsupported_range: "Vercel did not accept this date range (it may be outside the plan's reporting window).",
  plan_limit: "Vercel reports that this data is not available on the current plan.",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD_SURFACE_CLASSES} p-4`}>
      <p className="text-text-primary text-sm font-medium">{title}</p>
      <div className="text-text-secondary mt-1 text-sm">{children}</div>
    </div>
  );
}

export function WebsiteTrafficSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-4 w-48" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}

export async function WebsiteTrafficSection({ periodDays }: { periodDays: number }) {
  const result = await getWebsiteTraffic({ periodDays }, new Date());

  return (
    <section aria-labelledby="traffic-heading">
      <h2 id="traffic-heading" className="text-text-primary text-lg font-semibold tracking-tight">
        Website traffic
      </h2>
      <p className="text-text-muted mt-1 text-xs">
        Source: Vercel Web Analytics · Site: aqenra.com · Days are UTC · Separate from Staff registrations
      </p>

      <div className="mt-4">
        {result.status === "disabled" ? (
          <Panel title="Website traffic is not enabled">
            Collection and the connection to Vercel Web Analytics have not been switched on, so no traffic data
            exists. Nothing is estimated or backfilled.
          </Panel>
        ) : result.status === "not_configured" ? (
          <Panel title="Website traffic is not configured">
            It is switched on but missing configuration: {result.missing.join(", ")}.
          </Panel>
        ) : result.status === "not_started" ? (
          <Panel title="Collection has not started yet">Collection is set to start on {result.collectionStart} (UTC).</Panel>
        ) : result.status === "unavailable" ? (
          <Panel title="Website traffic is temporarily unavailable">
            {UNAVAILABLE_COPY[result.reason]} Staff registration figures above are not affected.
          </Panel>
        ) : (
          <div className="space-y-4">
            <p className="text-text-muted text-xs">
              Collection started {result.collectionStart} (UTC); there is no data before that date, and none is
              backfilled.
            </p>
            {result.period.clippedToReportingWindow ? (
              <p className="text-text-muted text-xs">
                Outside the reporting window: Vercel provides only the last {result.period.reportingWindowDays} days
                on the current plan, so this {result.period.requestedDays}-day view shows{" "}
                {result.period.shownDays}.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <GrowthStatCard
                label="Page views"
                value={result.totals.pageViews}
                hint={`Last ${result.period.shownDays} UTC days. Page views are not people.`}
              />
              <GrowthStatCard
                label="Average daily visitors"
                value={result.totals.averageDailyVisitors ?? "Not yet"}
                hint="Mean of completed UTC days. Not unique people over the period."
              />
              <GrowthStatCard
                label="Busiest day"
                value={result.totals.busiestDay ? result.totals.busiestDay.visitors : "None"}
                hint={result.totals.busiestDay ? `${result.totals.busiestDay.date} (daily visitors)` : "No visitors recorded in this period"}
              />
            </div>

            {result.totals.trackedDays > 0 && result.totals.pageViews === 0 ? (
              <p className="text-text-muted text-xs">
                No page views were recorded in this period. If you expected traffic, check that Web Analytics is
                enabled for the website.
              </p>
            ) : null}

            <div className={`${CARD_SURFACE_CLASSES} p-4`}>
              <TrafficTrendChart points={result.points} />
              <p className="text-text-muted mt-2 text-xs">
                Daily visitors are counted per UTC day from a daily-resetting identifier without cookies, so a
                returning person is counted again on each day they visit. Bot filtering relies on user agents, and
                blockers can under-count.
              </p>
              <details className="mt-3">
                <summary className="text-text-secondary cursor-pointer text-sm">Daily values (UTC)</summary>
                <div className="mt-2 max-h-72 overflow-auto">
                  <table className="divide-border-default min-w-full divide-y text-xs">
                    <thead>
                      <tr>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-left font-medium">Day</th>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-right font-medium">Daily visitors</th>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-right font-medium">Page views</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border-default divide-y">
                      {result.points.map((point) => (
                        <tr key={point.date}>
                          <th scope="row" className="text-text-primary px-2 py-1 text-left font-normal">{point.date}</th>
                          <td className="text-text-primary px-2 py-1 text-right">{point.visitors ?? "not collected"}</td>
                          <td className="text-text-primary px-2 py-1 text-right">{point.pageViews ?? "not collected"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>

            <div className={`${CARD_SURFACE_CLASSES} p-4`}>
              <p className="text-text-primary text-sm font-medium">Top referrers</p>
              {result.referrers === null ? (
                <p className="text-text-secondary mt-1 text-sm">Referrers are temporarily unavailable.</p>
              ) : result.referrers.length === 0 ? (
                <p className="text-text-secondary mt-1 text-sm">No referrers recorded in this period.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="divide-border-default min-w-full divide-y text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-left font-medium">Referring site</th>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-right font-medium">Page views</th>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-right font-medium">Daily visitors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border-default divide-y">
                      {result.referrers.map((referrer, index) => (
                        <tr key={`${referrer.hostname ?? "direct"}-${index}`}>
                          <th scope="row" className="text-text-primary wrap-anywhere px-2 py-1 text-left font-normal">
                            {referrer.hostname ?? "Direct or unknown"}
                          </th>
                          <td className="text-text-primary px-2 py-1 text-right">{referrer.pageViews}</td>
                          <td className="text-text-primary px-2 py-1 text-right">{referrer.visitors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
