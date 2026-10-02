import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Project Hub V1 — bounded, tenant-scoped reads for the Hub's Overview
 * health strip and each relationship tab. Mirrors Client Profile Hub's own
 * `profile-query.ts` architecture exactly (see that file's own header
 * comment, and the read-only audit's own §L/§R): every function here
 * takes `organizationId` + `projectId` together (never `projectId` alone),
 * and this is deliberately NOT one `prisma.$transaction([...])` batch —
 * the same Leads Pipeline P2028 incident precedent Client Hub's own
 * comment cites applies identically here: `fetchProjectHealth`'s own four
 * reads are genuinely independent aggregates sharing only the same
 * already-authorized organizationId/projectId context, so a plain
 * `Promise.all` — never a shared transaction — is both correct and
 * sufficient. Each tab's own fetch function is called by the page ONLY
 * when that tab is the one being rendered — never all five up front.
 */

/**
 * A generous bound for a single relationship tab's own row list —
 * identical reasoning to Client Hub's own CLIENT_TAB_ROW_BOUND: large
 * enough that a normal Project's history renders in full, small enough to
 * keep worst-case query/render cost bounded. Each tab links out to its
 * own existing, properly-paginated list page (pre-filtered by this
 * Project where that list page already supports it) for anything beyond
 * this bound.
 */
export const PROJECT_TAB_ROW_BOUND = 20;

export type ProjectHealth = {
  openTaskCount: number;
  overdueTaskCount: number;
  /** Sum of non-archived TimeEntry.durationMinutes for this Project — never a Decimal/money value, integer minutes only (TimeEntry's own established convention). */
  trackedMinutes: number;
  invoiceCount: number;
};

/**
 * The four Overview health signals, each using this app's own existing
 * canonical semantic (never a newly-invented one):
 *  - open/overdue tasks: scoped through Task.projectId together with the
 *    required `project: { organizationId }` relation — read-only audit's
 *    own §E/§H finding: `Task.organizationId` itself is a nullable,
 *    never-backfilled denormalized column (added by migration
 *    20260731055411_add_multi_tenant_schema with no backfill UPDATE, so
 *    every Task created before that migration permanently has it NULL),
 *    unlike `Invoice.organizationId` (required, explicitly backfilled by
 *    20260911090000_repair_invoice_organization_scope) or
 *    `TimeEntry.organizationId` (required from the start — never nullable
 *    at all). A direct `Task.organizationId` equality filter therefore
 *    silently excludes genuine historical rows. `Task.projectId` is
 *    required and reliable, and `page.tsx` has already validated this
 *    exact Project belongs to `organizationId` before either function
 *    below is ever called — but these functions are also tested and used
 *    independently of that page (see profile-query.test.ts's own header
 *    comment), so the tenant boundary is kept self-contained here too, via
 *    the Project relation rather than Task's own unreliable column.
 *  - overdue: the exact same `status != DONE && dueDate < now` rule
 *    `tasks/query.ts`'s own `buildTaskWhere` and `dashboard/query.ts`
 *    both already establish — never a second, invented definition.
 *  - tracked time: sum of non-archived TimeEntry.durationMinutes — a
 *    count/sum only, never a money value; billable/non-billable are not
 *    distinguished in this one aggregate (the Time tab's own rows show
 *    each entry's own billable flag). `TimeEntry.organizationId` has no
 *    historical-nullability gap, so this stays a direct column filter.
 *  - invoices: a count only — never a cross-currency amount sum (Section
 *    13's own explicit invariant, identical to Client Hub's own
 *    fetchClientInvoices comment). `Invoice.organizationId` was already
 *    backfilled for every pre-existing row, so this too stays a direct
 *    column filter.
 */
export async function fetchProjectHealth(
  organizationId: string,
  projectId: string,
  now: Date,
): Promise<ProjectHealth> {
  const [openTaskCount, overdueTaskCount, timeAgg, invoiceCount] = await Promise.all([
    prisma.task.count({
      where: { projectId, project: { organizationId }, status: { not: "DONE" } },
    }),
    prisma.task.count({
      where: { projectId, project: { organizationId }, status: { not: "DONE" }, dueDate: { lt: now } },
    }),
    prisma.timeEntry.aggregate({
      where: { organizationId, projectId, archivedAt: null },
      _sum: { durationMinutes: true },
    }),
    prisma.invoice.count({ where: { organizationId, projectId } }),
  ]);

  return {
    openTaskCount,
    overdueTaskCount,
    trackedMinutes: timeAgg._sum.durationMinutes ?? 0,
    invoiceCount,
  };
}

export type ProjectTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  assignee: { id: string; name: string } | null;
};

/**
 * Scoped via `projectId` + the required `project: { organizationId }`
 * relation, not `Task.organizationId` directly — see `fetchProjectHealth`'s
 * own doc comment immediately above for the exact, proven reason (a
 * nullable, never-backfilled column that would otherwise silently hide
 * genuine historical Tasks from this tab).
 */
export async function fetchProjectTasks(organizationId: string, projectId: string): Promise<ProjectTaskRow[]> {
  return prisma.task.findMany({
    where: { projectId, project: { organizationId } },
    orderBy: [{ createdAt: "desc" }],
    take: PROJECT_TAB_ROW_BOUND,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      assignee: { select: { id: true, name: true } },
    },
  });
}

export type ProjectTimeEntryRow = {
  id: string;
  workDate: Date;
  durationMinutes: number;
  billable: boolean;
  description: string | null;
  user: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
};

/**
 * Non-archived only (`archivedAt: null`) — matching the health strip's own
 * aggregate above and the existing Time page's own default view, never a
 * second, more permissive filter that would show archived entries here
 * but not in the total.
 */
export async function fetchProjectTimeEntries(
  organizationId: string,
  projectId: string,
): Promise<ProjectTimeEntryRow[]> {
  return prisma.timeEntry.findMany({
    where: { organizationId, projectId, archivedAt: null },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    take: PROJECT_TAB_ROW_BOUND,
    select: {
      id: true,
      workDate: true,
      durationMinutes: true,
      billable: true,
      description: true,
      user: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } },
    },
  });
}

export type ProjectInvoiceRow = {
  id: string;
  invoiceNumber: string;
  status: string;
  amount: import("@/generated/prisma/client").Prisma.Decimal;
  currency: string;
  issueDate: Date;
  dueDate: Date | null;
};

/** Each row's own `amount`/`currency` are always kept together — never summed across rows into one mixed-currency total (Section 13's own explicit invariant, identical to Client Hub's own fetchClientInvoices comment). */
export async function fetchProjectInvoices(organizationId: string, projectId: string): Promise<ProjectInvoiceRow[]> {
  return prisma.invoice.findMany({
    where: { organizationId, projectId },
    orderBy: [{ createdAt: "desc" }],
    take: PROJECT_TAB_ROW_BOUND,
    select: { id: true, invoiceNumber: true, status: true, amount: true, currency: true, issueDate: true, dueDate: true },
  });
}
