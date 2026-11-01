import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getTotalPages, type RawSearchParams } from "@/lib/list-params";
import {
  GROWTH_PERIOD_DAYS,
  getGrowthSummary,
  listRegistrations,
  parseGrowthParams,
  type RegistrationRow,
} from "@/lib/platform-admin/queries/growth";
import { formatUtcDateTime } from "@/lib/platform-admin/format-utc";
import { GrowthStatCard } from "@/components/platform-admin/growth-stat-card";
import { GrowthTrendChart } from "@/components/platform-admin/growth-trend-chart";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { SearchFilterBar } from "@/components/list/search-filter-bar";
import { Pagination } from "@/components/list/pagination";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { WebsiteTrafficSection, WebsiteTrafficSkeleton } from "./website-traffic-section";

export const metadata: Metadata = {
  title: "Growth — Platform Admin",
};

const BASE_PATH = "/platform-admin/growth";

const SORT_OPTIONS = [
  { value: "firstAttemptedAt:desc", label: "Newest signup first" },
  { value: "firstAttemptedAt:asc", label: "Oldest signup first" },
  { value: "lastAttemptedAt:desc", label: "Latest attempt first" },
  { value: "attemptCount:desc", label: "Most attempts" },
  { value: "email:asc", label: "Email (A–Z)" },
];

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const ORIGIN_LABELS: Record<RegistrationRow["origin"], string> = {
  STANDALONE: "Own sign-up",
  INVITED: "Invitation",
  UNKNOWN: "Unknown",
};

function RegistrationStatusBadge({ row }: { row: RegistrationRow }) {
  if (row.status === "ACTIVATED") return <StatusBadge status="ACTIVATED" label="Activated" tone="success" />;
  if (row.status === "NO_APP_ACCOUNT") {
    return <StatusBadge status="NO_APP_ACCOUNT" label="Signup recorded, no app account" tone="warning" />;
  }
  return <StatusBadge status="ACCOUNT_NOT_FOUND" label="Account not found" tone="neutral" />;
}

function Utc({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{formatUtcDateTime(date)}</time>;
}

/**
 * Platform Admin Growth V1, Slice B. Signup recording started with the
 * November 1, 2026 release and no backfill has been run, so signup
 * figures cover the recording period only while Staff-account figures
 * (Prisma User rows) cover all time — see queries/growth.ts for the exact
 * definitions. The page states this up front rather than letting a zero
 * read as "nobody registered". All timestamps are UTC.
 */
export default async function PlatformAdminGrowthPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = parseGrowthParams(await searchParams);
  const [summary, directory] = await Promise.all([getGrowthSummary(params, new Date()), listRegistrations(params)]);
  const totalPages = getTotalPages(directory.total);
  const hasSearch = Boolean(params.q);
  const { signups, accounts, inPeriod } = summary;

  const periodHref = (days: number) => {
    const usp = new URLSearchParams({ period: String(days), sort: params.sortCombined });
    if (params.q) usp.set("q", params.q);
    return `${BASE_PATH}?${usp.toString()}`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Growth</h1>
        <p className="text-text-secondary mt-1 text-sm">
          Staff sign-ups and activated accounts. All times are UTC.
        </p>
      </div>

      <div role="note" className={`${CARD_SURFACE_CLASSES} p-4 text-sm`}>
        <p className="text-text-primary font-medium">What these numbers cover</p>
        <ul className="text-text-secondary mt-2 list-disc space-y-1 pl-5">
          <li>
            Signup recording started with the {summary.recording.startedDay} (UTC) release and no historical backfill
            has been run. Signup figures describe the recording period only; a zero before it is not evidence that
            nobody registered.
          </li>
          <li>
            Staff accounts come from the account records themselves and cover all time. Whether an account&apos;s email
            was confirmed is not queried here, so no confirmation time is shown.
          </li>
          <li>
            A signup identity is one sign-up email identity. Recorded attempts count only attempts that reached an
            identity, so they can undercount. A workspace is an organization, not a person.
          </li>
        </ul>
      </div>

      <section aria-labelledby="signup-heading">
        <h2 id="signup-heading" className="text-text-primary text-lg font-semibold tracking-tight">
          Signup identities (recording period)
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <GrowthStatCard
            label="Recorded signup identities"
            value={signups.identities}
            hint={summary.recording.earliestRecordedAt ? `Earliest: ${formatUtcDateTime(summary.recording.earliestRecordedAt)}` : "None recorded yet"}
          />
          <GrowthStatCard
            label={signups.statusComplete ? "Activated" : "Activated (at least)"}
            value={signups.activated}
            hint="Identities with a Staff account"
          />
          <GrowthStatCard
            label={signups.statusComplete ? "Pending" : "Pending (at most)"}
            value={signups.pending}
            hint="Signup recorded, no Staff account yet"
          />
          <GrowthStatCard label="Recorded attempts" value={signups.recordedAttempts} hint="Lower bound; counts recorded attempts only" />
        </div>
        {!signups.statusComplete ? (
          <p className="text-text-muted mt-3 text-xs">
            More pending identities than can be cross-checked in one read, so Activated is a lower bound and Pending an
            upper bound.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="accounts-heading">
        <h2 id="accounts-heading" className="text-text-primary text-lg font-semibold tracking-tight">
          Staff accounts (all time)
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-xl">
          <GrowthStatCard label="Staff accounts" value={accounts.staffAccounts} hint="Activated accounts, by account creation" />
          <GrowthStatCard
            label="Without a recorded signup"
            value={accounts.withoutRecordedSignup ?? "Unknown"}
            hint="Created before recording began, or the record failed to write"
          />
        </div>
      </section>

      <section aria-labelledby="period-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="period-heading" className="text-text-primary text-lg font-semibold tracking-tight">
            Last {summary.period.days} UTC days
          </h2>
          <nav aria-label="Period" className="flex gap-2">
            {GROWTH_PERIOD_DAYS.map((days) => (
              <Link
                key={days}
                href={periodHref(days)}
                aria-current={days === summary.period.days ? "page" : undefined}
                className={`focus-visible:ring-focus-ring rounded-md border px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                  days === summary.period.days
                    ? "border-accent bg-accent text-white"
                    : "border-border-default text-text-secondary hover:border-border-strong"
                }`}
              >
                {days} days
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-text-muted mt-1 text-xs">
          {formatUtcDateTime(summary.period.startsAt)} up to now. Today is a partial day.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <GrowthStatCard label="New signup identities" value={inPeriod.newSignupIdentities} hint="First recorded in this period" />
          <GrowthStatCard label="New Staff accounts" value={inPeriod.newStaffAccounts} hint="Accounts created in this period" />
          <GrowthStatCard label="Workspaces created" value={inPeriod.workspacesCreated} hint="Organizations, not people" />
        </div>
        {summary.period.predatesRecording ? (
          <p className="text-text-muted mt-3 text-xs">
            Part of this period is before signup recording began on {summary.recording.startedDay}; those days show no
            signup data (a gap), not zero.
          </p>
        ) : null}

        <div className={`${CARD_SURFACE_CLASSES} mt-4 p-4`}>
          {summary.trend ? (
            <>
              <GrowthTrendChart points={summary.trend} />
              <details className="mt-3">
                <summary className="text-text-secondary cursor-pointer text-sm">Daily values (UTC)</summary>
                <div className="mt-2 max-h-72 overflow-auto">
                  <table className="divide-border-default min-w-full divide-y text-xs">
                    <thead>
                      <tr>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-left font-medium">Day</th>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-right font-medium">Signup identities</th>
                        <th scope="col" className="text-text-secondary px-2 py-1 text-right font-medium">Activated accounts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border-default divide-y">
                      {summary.trend.map((point) => (
                        <tr key={point.date}>
                          <th scope="row" className="text-text-primary px-2 py-1 text-left font-normal">{point.date}</th>
                          <td className="text-text-primary px-2 py-1 text-right">{point.signups ?? "not recorded"}</td>
                          <td className="text-text-primary px-2 py-1 text-right">{point.accounts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p className="text-text-secondary text-sm">
              Too many events in this period to chart. The counts above are exact; choose a shorter period for the
              daily chart.
            </p>
          )}
        </div>
      </section>

      <Suspense fallback={<WebsiteTrafficSkeleton />}>
        <WebsiteTrafficSection periodDays={params.periodDays} />
      </Suspense>

      <section aria-labelledby="directory-heading">
        <h2 id="directory-heading" className="text-text-primary text-lg font-semibold tracking-tight">
          Registration directory
        </h2>
        <p className="text-text-secondary mt-1 text-sm">
          {directory.total} recorded {directory.total === 1 ? "signup identity" : "signup identities"}
          {hasSearch ? " matching your search" : ""}. One row per identity.
        </p>

        <SearchFilterBar
          basePath={BASE_PATH}
          searchValue={params.q}
          searchPlaceholder="Search by email"
          sort={{ value: params.sortCombined, options: SORT_OPTIONS }}
          hasActiveParams={hasSearch}
          hiddenFields={[{ name: "period", value: String(params.periodDays) }]}
          clearHref={`${BASE_PATH}?period=${params.periodDays}`}
        />

        {directory.total === 0 ? (
          hasSearch ? (
            <EmptyState
              title="No matching signups"
              description={`No recorded signup identity matches "${params.q}".`}
              action={
                <Link href={`${BASE_PATH}?period=${params.periodDays}`} className={PRIMARY_LINK_CLASSES}>
                  Clear search
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No signups recorded yet"
              description="Staff signups are recorded from the November 1, 2026 release on. Earlier registrations are not in this list."
            />
          )
        ) : (
          <>
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Origin</TableHeaderCell>
                  <TableHeaderCell>First recorded</TableHeaderCell>
                  <TableHeaderCell>Latest recorded</TableHeaderCell>
                  <TableHeaderCell>Attempts</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Workspaces</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {directory.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell emphasis className="wrap-anywhere">
                      {row.email}
                    </TableCell>
                    <TableCell>{ORIGIN_LABELS[row.origin]}</TableCell>
                    <TableCell>
                      <Utc date={row.firstAttemptedAt} />
                    </TableCell>
                    <TableCell>
                      <Utc date={row.lastAttemptedAt} />
                    </TableCell>
                    <TableCell>{row.attemptCount}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <RegistrationStatusBadge row={row} />
                        {row.accountCreatedAt ? (
                          <p className="text-text-muted text-xs">
                            Account created <Utc date={row.accountCreatedAt} />
                          </p>
                        ) : null}
                        {row.recordedActivationAt ? (
                          <p className="text-text-muted text-xs">
                            Activation recorded <Utc date={row.recordedActivationAt} />
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.workspaces.length === 0 ? (
                        <span className="text-text-muted">None</span>
                      ) : (
                        <ul className="space-y-1.5">
                          {row.workspaces.map((workspace) => (
                            <li key={workspace.organizationId} className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/platform-admin/organizations/${workspace.organizationId}`}
                                className="text-text-primary focus-visible:ring-focus-ring wrap-anywhere rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                              >
                                {workspace.name}
                              </Link>
                              <StatusBadge status={workspace.role} />
                            </li>
                          ))}
                          {row.workspaceCount > row.workspaces.length ? (
                            <li className="text-text-muted text-xs">+{row.workspaceCount - row.workspaces.length} more</li>
                          ) : null}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              basePath={BASE_PATH}
              params={{
                period: String(params.periodDays),
                ...(params.q ? { q: params.q } : {}),
                sort: params.sortCombined,
              }}
              page={params.page}
              totalPages={totalPages}
            />
          </>
        )}
      </section>
    </div>
  );
}
