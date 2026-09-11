import { formatStatusLabel } from "@/lib/format";

export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger" | "muted";

// Design System Phase 2 — the raw Tailwind palette colors above are
// replaced with the existing semantic success/warning/danger/info tokens
// (globals.css), each already paired as a "-subtle" background + its own
// readable foreground for both Light and Dark. neutral/muted have no
// dedicated brand-color pair (they represent "no particular status", not
// a semantic state) so they use the existing surface/text scale instead —
// neutral a shade more prominent than muted, preserving their existing
// relative ordering (bg-gray-100/text-gray-700 read stronger than
// bg-gray-200/text-gray-500 did not; the two were already close — muted
// is kept the quieter of the two via surface-recessed + text-muted vs.
// neutral's surface-muted + text-secondary).
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-surface-muted text-text-secondary",
  info: "bg-info-subtle text-info",
  warning: "bg-warning-subtle text-warning",
  success: "bg-success-subtle text-success",
  danger: "bg-danger-subtle text-danger",
  muted: "bg-surface-recessed text-text-muted",
};

// Shared across ClientStatus, ProjectStatus, TaskStatus, TaskPriority,
// InvoiceStatus, Membership Role, and InvitationStatus so the same word
// always renders in the same color everywhere (e.g. IN_PROGRESS and
// CANCELLED mean the same thing on both Project and Task/Invoice, so they
// share one entry).
export const STATUS_TONES: Record<string, StatusTone> = {
  LEAD: "neutral",
  ACTIVE: "success",
  INACTIVE: "muted",
  ARCHIVED: "muted",

  PLANNING: "neutral",
  IN_PROGRESS: "info",
  ON_HOLD: "warning",
  COMPLETED: "success",
  CANCELLED: "danger",

  TODO: "neutral",
  IN_REVIEW: "warning",
  DONE: "success",

  DRAFT: "neutral",
  SENT: "info",
  PAID: "success",
  OVERDUE: "danger",

  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",

  OWNER: "success",
  ADMIN: "info",
  MEMBER: "neutral",

  PENDING: "warning",
  ACCEPTED: "success",
  REVOKED: "danger",
  EXPIRED: "muted",

  // Billing & Subscriptions (Subscription.status / OrganizationEntitlements
  // .subscriptionStatus) — ACTIVE above is already shared with these.
  TRIALING: "info",
  PAST_DUE: "warning",
  CANCELED: "danger",
  INCOMPLETE: "warning",
  UNPAID: "danger",
  LEGACY: "neutral",

  // Onboarding checklist step statuses (src/lib/onboarding/progress.ts).
  // COMPLETE/SKIPPED share tone with the equivalent-meaning values above
  // (DONE/EXPIRED); NOT_STARTED/NOT_APPLICABLE are new, onboarding-only
  // values not shared with any other model's status set.
  NOT_STARTED: "neutral",
  COMPLETE: "success",
  SKIPPED: "muted",
  NOT_APPLICABLE: "muted",

  // Customer Setup Wizard (Stage 6.2) — DomainVerificationStatus.
  // PENDING already shares tone with the values above; VERIFIED is new.
  VERIFIED: "success",

  // Sale-Ready Phase C, PR3.2 (Organization Explorer) —
  // OrganizationLifecycleStatus and AccessMode. PAID/EXPIRED/CANCELED/
  // LEGACY/ARCHIVED above are already exactly right and deliberately
  // reused unchanged (CANCELED keeps the same "danger" tone its existing
  // Subscription.status usage already has elsewhere — this is genuinely
  // the same underlying concept, not a coincidence). SUSPENDED gets its
  // own "warning" tone rather than reusing CANCELED's "danger" — the two
  // are kept classified as distinct business states on purpose (see
  // classifyOrganizationLifecycle's own doc comment), and giving them the
  // same color would visually erase that distinction at a glance.
  TRIAL: "info",
  SUSPENDED: "warning",
  FULL_ACCESS: "success",
  LIMITED_WRITES: "warning",
  READ_ONLY: "danger",

  // Leads / Sales Pipeline Phase 3 — LeadStage. NEW mirrors PLANNING/
  // TODO/DRAFT's own "just started" neutral tone; CONTACTED/QUALIFIED/
  // PROPOSAL share the same "in motion" info tone IN_PROGRESS/SENT
  // already use elsewhere (the stage's own label text, not color, is
  // what distinguishes them — see this file's own "no color-only
  // semantics" precedent for status pairs that already share a tone);
  // WON/LOST reuse the same success/danger tones every other terminal-
  // outcome pair in this map already does (COMPLETED/CANCELLED,
  // ACCEPTED/REVOKED). No collision with ClientStatus's own LEAD entry
  // above — that's a Client.status value ("LEAD" meaning "an unqualified
  // Client record"), a completely different concept from a Lead's own
  // stage.
  NEW: "neutral",
  CONTACTED: "info",
  QUALIFIED: "info",
  PROPOSAL: "info",
  WON: "success",
  LOST: "danger",

  // Quotes / Estimates Phase 3 (Staff UI) — QuoteStatus's own two values
  // not already covered above (DRAFT/SENT are shared with Invoice's own
  // identical-meaning values, same reasoning as every other shared entry
  // in this map). APPROVED mirrors WON/ACCEPTED/COMPLETED's own "positive
  // terminal outcome" success tone; DECLINED mirrors LOST/REVOKED/
  // CANCELLED's own "negative terminal outcome" danger tone. CONVERTED is
  // a derived-only Quote state (see src/lib/quotes/status.ts) that
  // deliberately shares APPROVED's success tone — every converted Quote
  // was necessarily approved first, so this is still the same positive
  // outcome, not a new one — distinguished from a plain APPROVED badge by
  // its own label text alone (see quote-status-badge.tsx), the same
  // "color shared, label text is what actually distinguishes them"
  // precedent this map already uses for NEW/PLANNING/TODO/DRAFT sharing
  // neutral. EXPIRED (also derived-only) is NOT added here — it already
  // exists above (Invitation's own EXPIRED entry) with exactly the right
  // "muted" tone for a lapsed-but-not-actively-rejected state.
  APPROVED: "success",
  DECLINED: "danger",
  CONVERTED: "success",

  // Client Requests / Tickets Phase 2A — ClientRequestStatus's own three
  // values not already covered above (IN_PROGRESS is shared with Project/
  // Task's own identical-meaning value). OPEN mirrors PENDING's own
  // "needs attention" warning tone; WAITING_ON_CLIENT is a normal,
  // non-urgent holding state (neutral); RESOLVED mirrors DONE/COMPLETED's
  // own positive-outcome success tone; CLOSED mirrors ARCHIVED/EXPIRED's
  // own "wound down, no longer active" muted tone — never CANCELLED's own
  // danger tone, since closing a ticket isn't a negative outcome.
  OPEN: "warning",
  WAITING_ON_CLIENT: "neutral",
  RESOLVED: "success",
  CLOSED: "muted",

  // ClientRequestPriority's own NORMAL value (LOW/HIGH/URGENT already
  // shared with TaskPriority above) — mirrors MEDIUM's own "ordinary, no
  // special attention" info tone at the equivalent tier.
  NORMAL: "info",

  // Recurring Invoices Phase 2A — RecurringInvoiceStatus's own PAUSED
  // value (ACTIVE/ARCHIVED already shared with ClientStatus's identical-
  // meaning values above). Mirrors ON_HOLD's own "temporarily inactive,
  // not a terminal/negative outcome" warning tone at the equivalent tier.
  PAUSED: "warning",
};

// Custom Statuses Phase 2A (Section P) — `tone` is an optional override
// for a caller that already resolved presentation from a
// CustomStatusDefinition (see src/lib/custom-statuses/presentation.ts's
// own resolveStatusPresentation): when supplied, it wins outright and
// `status` is used only as this badge's own DOM/test hook, never for a
// second STATUS_TONES lookup. Omitted, this is byte-identical to before —
// every pre-existing caller that only ever passed `status`/`label`.
export function StatusBadge({ status, label, tone: toneOverride }: { status: string; label?: string; tone?: StatusTone }) {
  const tone = toneOverride ?? STATUS_TONES[status] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label ?? formatStatusLabel(status)}
    </span>
  );
}
