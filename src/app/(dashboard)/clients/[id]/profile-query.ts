import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveSystemStatusDefinition } from "@/lib/custom-statuses/resolution";
import { SYSTEM_STATUS_KEYS } from "@/lib/custom-statuses/constants";
import { getTimelineForEntity } from "@/lib/timeline/timeline";
import type { TimelineNoteActor } from "@/lib/timeline/notes";
import type { CustomStatusColor } from "@/generated/prisma/enums";

/**
 * Client Profile Hub V1 — bounded, tenant-scoped reads for the Hub's
 * Overview health strip and each relationship tab. Every function here
 * takes `organizationId` + `clientId` together (never `clientId` alone)
 * so a foreign-org id can never leak rows, mirroring every other
 * Client-scoped query already in this app (contacts.ts, the edit page's
 * own `client.findFirst`, etc.).
 *
 * Deliberately NOT one `prisma.$transaction([...])` batch — the proven
 * Leads Pipeline P2028 incident (a shared transaction wrapping
 * independent bounded reads exceeded its own 5s timeout in Production)
 * is exactly the shape to avoid here. `fetchClientHealth`'s own four
 * reads are genuinely independent aggregates sharing only the same
 * already-authorized organizationId/clientId context, so a plain
 * `Promise.all` — never a shared transaction — is both correct and
 * sufficient. Each tab's own fetch function is called by the page ONLY
 * when that tab is the one being rendered — never all five up front.
 */

// Same literal set Reports' and Dashboard's own canonical "unpaid
// invoice" queries already use — reused as a local copy, matching the
// established convention of each module defining its own copy of this
// tuple rather than importing a shared export (see dashboard/query.ts's
// own identical local constant).
const UNPAID_INVOICE_STATUSES = ["DRAFT", "SENT", "OVERDUE"] as const;

// A generous bound for a single relationship tab's own row list — large
// enough that a normal Client's history renders in full, small enough to
// keep worst-case query/render cost bounded. Each tab links out to its
// own existing, properly-paginated list page (pre-filtered by this
// Client where that list page already supports it) for anything beyond
// this bound, the same "bounded preview, dedicated list page has the
// rest" discipline the Leads Pipeline board's own PIPELINE_STAGE_CARD_BOUND
// already established.
export const CLIENT_TAB_ROW_BOUND = 20;

export type ClientHealth = {
  unpaidInvoiceCount: number;
  openTaskCount: number;
  activeProjectCount: number;
  lastActivityAt: Date | null;
};

/**
 * The four Overview health signals, each using this app's own existing
 * canonical semantic (never a newly-invented one):
 *  - unpaid invoices: `UNPAID_INVOICE_STATUSES` (Reports/Dashboard), a
 *    count only — never a cross-currency amount sum.
 *  - open tasks: `status != DONE`, scoped through Task.project.clientId
 *    (Task has no direct Client relation at all).
 *  - active projects: `status = IN_PROGRESS` (the system PROJECT
 *    definition, with the same statusDefinitionId-or-legacy-fallback
 *    Dashboard's own activeProjectsWhere already uses) — never
 *    PLANNING/ON_HOLD.
 *  - last activity: the newest item from the same bounded, merged
 *    Activity+TimelineNote timeline the Activity tab itself renders
 *    (getTimelineForEntity) — never a second, independently-invented
 *    "last interaction" timestamp.
 */
export async function fetchClientHealth(
  organizationId: string,
  clientId: string,
  actor: TimelineNoteActor,
): Promise<ClientHealth> {
  const inProgressDefinition = await resolveSystemStatusDefinition(
    organizationId,
    "PROJECT",
    SYSTEM_STATUS_KEYS.PROJECT_IN_PROGRESS,
  );
  const activeProjectsWhere = inProgressDefinition
    ? {
        organizationId,
        clientId,
        OR: [{ statusDefinitionId: inProgressDefinition.id }, { statusDefinitionId: null, status: "IN_PROGRESS" as const }],
      }
    : { organizationId, clientId, status: "IN_PROGRESS" as const };

  const [unpaidInvoiceCount, openTaskCount, activeProjectCount, timeline] = await Promise.all([
    prisma.invoice.count({
      where: { organizationId, clientId, status: { in: [...UNPAID_INVOICE_STATUSES] } },
    }),
    prisma.task.count({
      where: { status: { not: "DONE" }, project: { organizationId, clientId } },
    }),
    prisma.project.count({ where: activeProjectsWhere }),
    getTimelineForEntity(organizationId, "CLIENT", clientId, actor),
  ]);

  const lastActivityAt = timeline.ok && timeline.items.length > 0 ? timeline.items[0].createdAt : null;

  return { unpaidInvoiceCount, openTaskCount, activeProjectCount, lastActivityAt };
}

export type ClientProjectRow = {
  id: string;
  name: string;
  status: string;
  statusDefinition: { label: string; color: CustomStatusColor | null } | null;
  startDate: Date | null;
  endDate: Date | null;
};

export async function fetchClientProjects(organizationId: string, clientId: string): Promise<ClientProjectRow[]> {
  return prisma.project.findMany({
    where: { organizationId, clientId },
    orderBy: [{ createdAt: "desc" }],
    take: CLIENT_TAB_ROW_BOUND,
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      statusDefinition: { select: { label: true, color: true } },
    },
  });
}

export type ClientTaskRow = {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
};

/**
 * Tasks are never directly related to Client — always through
 * Task.projectId -> Project.clientId. Scoping by
 * `project: { organizationId, clientId }` together keeps this
 * tenant-safe (a cross-org Project id can never match) without a
 * separate, redundant membership/organization re-check per row.
 */
export async function fetchClientTasks(organizationId: string, clientId: string): Promise<ClientTaskRow[]> {
  return prisma.task.findMany({
    where: { project: { organizationId, clientId } },
    orderBy: [{ createdAt: "desc" }],
    take: CLIENT_TAB_ROW_BOUND,
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
    },
  });
}

export type ClientInvoiceRow = {
  id: string;
  invoiceNumber: string;
  status: string;
  amount: import("@/generated/prisma/client").Prisma.Decimal;
  currency: string;
  issueDate: Date;
  dueDate: Date | null;
};

/** Each row's own `amount`/`currency` are always kept together — never summed across rows into one mixed-currency total (Section 13's own explicit invariant). */
export async function fetchClientInvoices(organizationId: string, clientId: string): Promise<ClientInvoiceRow[]> {
  return prisma.invoice.findMany({
    where: { organizationId, clientId },
    orderBy: [{ createdAt: "desc" }],
    take: CLIENT_TAB_ROW_BOUND,
    select: { id: true, invoiceNumber: true, status: true, amount: true, currency: true, issueDate: true, dueDate: true },
  });
}

export type ClientQuoteRow = {
  id: string;
  number: string;
  title: string | null;
  status: import("@/lib/validation/quote").QuoteStatusValue;
  convertedInvoiceId: string | null;
  total: import("@/generated/prisma/client").Prisma.Decimal;
  currency: string;
  issueDate: Date;
  validUntil: Date | null;
};

/**
 * Each row's own `total`/`currency` are always kept together — never
 * summed across rows (Section 14's own explicit invariant).
 * `convertedInvoiceId` is selected only so the caller can reuse the
 * existing canonical `deriveQuoteStatusDisplay`/`QuoteStatusBadge` (the
 * same CONVERTED/EXPIRED derivation the Quotes list and read-only view
 * already use) rather than re-deriving a second, divergent status label.
 */
export async function fetchClientQuotes(organizationId: string, clientId: string): Promise<ClientQuoteRow[]> {
  return prisma.quote.findMany({
    where: { organizationId, clientId },
    orderBy: [{ createdAt: "desc" }],
    take: CLIENT_TAB_ROW_BOUND,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      convertedInvoiceId: true,
      total: true,
      currency: true,
      issueDate: true,
      validUntil: true,
    },
  });
}

export type ClientContractRow = {
  id: string;
  contractNumber: string;
  title: string;
  status: import("@/generated/prisma/enums").ContractStatus;
  archivedAt: Date | null;
  effectiveDate: Date | null;
  expiresAt: Date | null;
  signatoryContact: { id: string; name: string } | null;
};

/**
 * Archived Contracts are included, never silently hidden — matching the
 * existing Contracts list page's own convention (archivedAt is
 * orthogonal to status; an archived Contract still renders, truthfully
 * labeled "Archived" by the caller, exactly like /contracts already
 * does).
 */
export async function fetchClientContracts(organizationId: string, clientId: string): Promise<ClientContractRow[]> {
  return prisma.contract.findMany({
    where: { organizationId, clientId },
    orderBy: [{ createdAt: "desc" }],
    take: CLIENT_TAB_ROW_BOUND,
    select: {
      id: true,
      contractNumber: true,
      title: true,
      status: true,
      archivedAt: true,
      effectiveDate: true,
      expiresAt: true,
      signatoryContact: { select: { id: true, name: true } },
    },
  });
}
