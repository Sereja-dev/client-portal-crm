import type { Metadata } from "next";
import { formatStatusLabel } from "@/lib/format";
import { DetailSection, Field } from "@/components/platform-admin/detail-section";
import {
  getFailureMonitoringSummary,
  type InvoiceEmailFailureBucket,
  type WebhookFailureBucket,
} from "@/lib/platform-admin/queries/failure-monitoring";
import {
  getAiAssistantMonitoringSummary,
  type AiAssistantOutcomeBucket,
} from "@/lib/platform-admin/queries/ai-assistant-monitoring";

export const metadata: Metadata = {
  title: "Observability — Platform Admin",
};

const ANOMALY_LABEL = "Not recorded (data anomaly)";

function formatCategoryLabel(value: string | null): string {
  return value === null ? ANOMALY_LABEL : formatStatusLabel(value);
}

/**
 * §9 of docs/production-observability-runbook.md — the read-only
 * Platform Admin equivalent of that document's own manual SQL, §6.
 * Every number below is a database-side or in-memory aggregate only
 * (see failure-monitoring.ts's own header comment) — this page never
 * receives, renders, or has access to a single row's id, invoiceId,
 * recipientEmail, providerEventId, organizationId, or any other
 * identifier. There is no retry/resend/resolve/dismiss/acknowledge/
 * delete/inspect-row/export/filter control anywhere on this page —
 * consistent with check-platform-admin-security.mjs's "no actions.ts
 * anywhere under src/app/(platform-admin)" check, which this route
 * keeps passing by construction (there is no actions.ts here to add).
 */
export default async function PlatformAdminObservabilityPage() {
  const summary = await getFailureMonitoringSummary();
  const aiSummary = await getAiAssistantMonitoringSummary();

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Observability</h1>
          <span className="bg-surface-muted text-text-secondary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
            Read-only
          </span>
        </div>
        <p className="text-text-secondary mt-1 text-sm">
          A read-only, aggregate-only view of durable billing webhook, invoice email, and PDF archive-reconciliation
          failures already recorded in the database — nothing on this page can retry, resend, resolve, or otherwise
          change any record. Generated at page load; no filter or wider window is available. Most figures below
          cover the last 7 days — the PDF archive reconciliation section is the one exception (see its own note).
        </p>
      </div>

      <DetailSection id="webhook-failures" title="Billing webhook failures by reason">
        <SectionIntro>
          A permanent, classified failure the webhook route itself never retries automatically — each of these
          requires investigation, not a resend of the same event.
        </SectionIntro>
        <FailureBucketList
          buckets={summary.webhookFailuresByCode}
          getLabel={(bucket) => formatCategoryLabel(bucket.failureCode)}
          emptyMessage="No failed billing webhook events in the last 7 days."
        />
      </DetailSection>

      <DetailSection id="webhook-stale-pending" title="Stale billing webhook processing">
        <SectionIntro>
          A webhook event that started processing over an hour ago and never reached a terminal state — usually
          means processing was interrupted; worth investigating separately from a classified failure above.
        </SectionIntro>
        <SingleCount
          count={summary.webhookStalePendingCount}
          label="stale pending webhook event"
          emptyMessage="No stale pending billing webhook events in the last 7 days."
        />
      </DetailSection>

      <DetailSection id="invoice-email-failures" title="Invoice email delivery failures and unknown outcomes">
        <SectionIntro>
          Only the latest email attempt per invoice counts here — an invoice whose most recent attempt succeeded is
          never shown, even if an earlier attempt failed.{" "}
          <strong className="text-text-primary font-semibold">
            An &ldquo;Unknown&rdquo; outcome means delivery is genuinely ambiguous — never resend blindly; use the
            invoice&rsquo;s own acknowledged-retry flow instead.
          </strong>
        </SectionIntro>
        <InvoiceEmailFailureList
          buckets={summary.invoiceEmailFailuresByStatusAndReason}
          emptyMessage="No invoice emails with a failed or unknown latest outcome in the last 7 days."
        />
      </DetailSection>

      <DetailSection id="invoice-email-stale-pending" title="Stale invoice email attempts">
        <SectionIntro>
          The latest attempt for an invoice is still Pending well past the point a real provider response would have
          arrived — its settlement is missing, not necessarily failed. Investigate; nothing here mutates it.
        </SectionIntro>
        <SingleCount
          count={summary.invoiceEmailStalePendingCount}
          label="stale pending invoice email attempt"
          emptyMessage="No stale pending invoice email attempts in the last 7 days."
        />
      </DetailSection>

      <DetailSection id="pdf-archive-reconciliation" title="PDF archive reconciliation">
        <SectionIntro>
          The daily archive-reconciliation job already retries these automatically — these two figures cover only
          what is left over: an archive object that has exhausted automatic cleanup retries, or one whose internal
          claim state is inconsistent (a data-integrity anomaly). Unlike every section above, these are not windowed
          to 7 days — they reflect the current backlog.{" "}
          <strong className="text-text-primary font-semibold">
            This does not cover PDF rendering, oversized-PDF, or snapshot/logo failures — those remain visible only
            in Vercel&rsquo;s own bounded diagnostic log events (see the runbook). A zero count here is not proof the
            invoice/PDF subsystem overall is healthy.
          </strong>
        </SectionIntro>
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          <SingleCount
            count={summary.pdfArchiveManualReviewPendingCount}
            label="manual-review-pending PDF archive object"
            emptyMessage="No PDF archive objects pending manual review."
          />
          <SingleCount
            count={summary.pdfArchiveInconsistentClaimStateCount}
            label="claim-inconsistent PDF archive object"
            emptyMessage="No PDF archive objects with an inconsistent claim state."
          />
        </div>
      </DetailSection>

      <DetailSection id="ai-assistant" title="AI Assistant">
        <SectionIntro>
          Bounded orchestration-turn telemetry only — AI Production Monitoring V1 (see the runbook). A rejected
          request never reaches this table at all: the pre-auth availability check and the post-auth rate limit both
          return before a turn ever starts, so neither can appear here, by construction, not merely by convention.
          Rate-limit saturation has no durable monitoring yet; see the note below.
        </SectionIntro>

        <h3 className="text-text-primary text-sm font-semibold">Current status</h3>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="AI Assistant" value={aiSummary.liveStatus.available ? "Available" : "Unavailable"} />
          <Field label="Configuration" value={formatStatusLabel(aiSummary.liveStatus.configStatus)} />
          <Field label="Provider" value={aiSummary.liveStatus.provider ?? "—"} />
          <Field label="Model" value={aiSummary.liveStatus.model ?? "—"} />
        </dl>

        <h3 className="text-text-primary mt-6 text-sm font-semibold">Recent turns (last 7 days)</h3>
        {aiSummary.turnAggregates.totalTurns === 0 ? (
          <p className="text-text-secondary mt-3 text-sm">No AI Assistant turns recorded in the last 7 days.</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Total turns" value={aiSummary.turnAggregates.totalTurns} />
              <Field
                label="Success rate"
                value={`${aiSummary.turnAggregates.successRatePct}% (${aiSummary.turnAggregates.successCount}/${aiSummary.turnAggregates.totalTurns})`}
              />
              <Field label="Average latency" value={`${aiSummary.turnAggregates.averageLatencyMs} ms`} />
              <Field label="Ref-leak guard events" value={aiSummary.turnAggregates.refLeakCount} />
              <Field label="Input tokens" value={aiSummary.turnAggregates.totalInputTokens} />
              <Field label="Output tokens" value={aiSummary.turnAggregates.totalOutputTokens} />
              <Field label="Provider calls" value={aiSummary.turnAggregates.totalProviderCalls} />
              <Field label="Tool calls" value={aiSummary.turnAggregates.totalToolCalls} />
            </dl>

            <h4 className="text-text-secondary mt-5 text-xs font-medium">Outcome breakdown</h4>
            <OutcomeBucketList buckets={aiSummary.turnAggregates.outcomeBreakdown} />
          </>
        )}

        <p className="text-text-muted mt-4 text-xs">
          Durable AI rate-limit saturation monitoring is deferred to the separately tracked rate-limiter durability /
          bounded-counter design. Tool-level failure breakdown and per-tenant monitoring are not implemented in this
          V1. AI quality/benchmark results are a separate diagnostic system (scripts/ai-provider-eval/) and are never
          Production telemetry — nothing above reflects that system.
        </p>
      </DetailSection>

      <p className="text-text-muted text-xs">
        For the exact SQL behind these figures, a fallback manual check, and known limitations (short Vercel log
        retention, no automated alerting), see{" "}
        <code className="bg-surface-muted text-text-secondary rounded px-1 py-0.5">docs/production-observability-runbook.md</code> in this
        repository.
      </p>
    </div>
  );
}

function SectionIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-text-secondary mb-4 text-sm">{children}</p>;
}

function OutcomeBucketList({ buckets }: { buckets: AiAssistantOutcomeBucket[] }) {
  if (buckets.length === 0) {
    return <p className="text-text-secondary mt-2 text-sm">No turns in this window.</p>;
  }
  return (
    <ul className="divide-border-default border-border-default mt-2 divide-y rounded-md border">
      {buckets.map((bucket) => (
        <li key={bucket.outcome} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="text-text-primary">{formatStatusLabel(bucket.outcome)}</span>
          <span className="text-text-primary font-medium tabular-nums">{bucket.count}</span>
        </li>
      ))}
    </ul>
  );
}

function FailureBucketList({
  buckets,
  getLabel,
  emptyMessage,
}: {
  buckets: WebhookFailureBucket[];
  getLabel: (bucket: WebhookFailureBucket) => string;
  emptyMessage: string;
}) {
  if (buckets.length === 0) {
    return <p className="text-text-secondary text-sm">{emptyMessage}</p>;
  }
  return (
    <ul className="divide-border-default border-border-default divide-y rounded-md border">
      {buckets.map((bucket) => (
        <li key={bucket.failureCode ?? "null"} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="text-text-primary">{getLabel(bucket)}</span>
          <span className="text-text-primary font-medium tabular-nums">{bucket.count}</span>
        </li>
      ))}
    </ul>
  );
}

function InvoiceEmailFailureList({
  buckets,
  emptyMessage,
}: {
  buckets: InvoiceEmailFailureBucket[];
  emptyMessage: string;
}) {
  if (buckets.length === 0) {
    return <p className="text-text-secondary text-sm">{emptyMessage}</p>;
  }
  return (
    <ul className="divide-border-default border-border-default divide-y rounded-md border">
      {buckets.map((bucket) => (
        <li
          key={`${bucket.status}|${bucket.failureReason ?? "null"}`}
          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
        >
          <span className="text-text-primary">
            {formatStatusLabel(bucket.status)}
            <span className="text-text-muted"> — {formatCategoryLabel(bucket.failureReason)}</span>
          </span>
          <span className="text-text-primary font-medium tabular-nums">{bucket.count}</span>
        </li>
      ))}
    </ul>
  );
}

function SingleCount({ count, label, emptyMessage }: { count: number; label: string; emptyMessage: string }) {
  if (count === 0) {
    return <p className="text-text-secondary text-sm">{emptyMessage}</p>;
  }
  return (
    <p className="text-text-primary text-2xl font-semibold tabular-nums">
      {count} <span className="text-text-secondary text-sm font-normal">{count === 1 ? label : `${label}s`}</span>
    </p>
  );
}
