import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportsPeriodRange } from "../period";

/**
 * SUM(TimeEntry.durationMinutes) for every non-archived entry whose
 * `workDate` falls in [range.start, range.end) — every entry counts here
 * regardless of whether it has a Project/Task/User link (all three are
 * nullable — see TimeEntry's own schema comment). This is the canonical
 * "Tracked hours" KPI's source of truth; the internal/report model unit
 * is integer minutes, never a derived monetary value (TimeEntry has no
 * rate field anywhere in this schema).
 */
export async function getTrackedMinutes(organizationId: string, range: ReportsPeriodRange): Promise<number> {
  const result = await prisma.timeEntry.aggregate({
    where: { organizationId, archivedAt: null, workDate: { gte: range.start, lt: range.end } },
    _sum: { durationMinutes: true },
  });
  return result._sum.durationMinutes ?? 0;
}

export type ReportsClientTime = { clientId: string; clientName: string; totalMinutes: number };

/**
 * Time by Client: TimeEntry -> Project -> Client, non-archived entries
 * only, `workDate` within range. `TimeEntry.organizationId` (a required,
 * direct column on TimeEntry itself) scopes the aggregate below, exactly
 * as before this hardening pass.
 *
 * Tenant hardening (Phase 1 hardening audit): unlike the aggregate above,
 * nothing at the database level ties a TimeEntry's `projectId` to a
 * Project in the SAME organization — that invariant is enforced only by
 * the domain layer at write time (src/lib/time-entries/entries.ts), never
 * by a Prisma/Postgres FK, since Project's own `organizationId` is the
 * legacy-nullable column (see prisma/schema.prisma's own header comment
 * on Client/Project/Task). The follow-up Project lookup below therefore
 * REQUIRES both `Project.organizationId === organizationId` AND
 * `Project.client.organizationId === organizationId` directly in the
 * Prisma `where` (a relation filter on `client`, not a post-fetch JS
 * filter) — so a corrupt or future-invalid cross-tenant Project/Client
 * relation can never surface another organization's Project or Client
 * identity here, even though no currently-shipped write path can
 * actually produce one. The same equality check also excludes a legacy
 * row whose own `organizationId` is null on either side (null never
 * equals a real UUID) — a null-organizationId Project/Client is
 * therefore NEVER surfaced in this organization-specific table, by the
 * same "safety wins" rule, even though a real TimeEntry points at it.
 *
 * That TimeEntry's own minutes are NOT lost from Reports as a whole: they
 * still count in `getTrackedMinutes()`'s own total above, which is scoped
 * purely by the TimeEntry row's own (reliable, non-nullable)
 * organizationId and has no Project/Client dependency at all. Only this
 * function's own per-Client breakdown excludes it — the existing
 * `if (!client) continue` guard below now also naturally absorbs this
 * case, with no change to its own logic.
 *
 * Two bounded queries, never N+1: an aggregate `groupBy` on TimeEntry (by
 * projectId), then one batched `findMany` on Project (with its Client)
 * for the winning project ids.
 *
 * Semantic note (deliberate, not an oversight): an entry with no
 * `projectId` cannot be attributed to any Client and is excluded from
 * this function's own result — it is still counted in
 * `getTrackedMinutes()`'s own total above, which has no such
 * requirement. "Tracked hours" and "Time by Client" can therefore
 * legitimately disagree on total minutes when unassigned entries exist;
 * that gap is intentional, not a bug (see this module's own tests).
 * Every Client returned here actually has tracked time in this period —
 * there is no fixed top-N cap (unlike Top Clients by paid revenue, which
 * the approved Phase 1 design explicitly caps at 5); the realistic
 * number of distinct Clients with logged time in one period is already
 * naturally small.
 */
export async function getTimeByClient(organizationId: string, range: ReportsPeriodRange): Promise<ReportsClientTime[]> {
  const grouped = await prisma.timeEntry.groupBy({
    by: ["projectId"],
    where: {
      organizationId,
      archivedAt: null,
      workDate: { gte: range.start, lt: range.end },
      projectId: { not: null },
    },
    _sum: { durationMinutes: true },
  });

  if (grouped.length === 0) return [];

  const projectIds = grouped.map((g) => g.projectId as string);
  const projects = await prisma.project.findMany({
    where: {
      id: { in: projectIds },
      organizationId,
      client: { organizationId },
    },
    select: { id: true, client: { select: { id: true, name: true } } },
  });
  const clientByProjectId = new Map(projects.map((p) => [p.id, p.client]));

  const minutesByClient = new Map<string, { name: string; minutes: number }>();
  for (const row of grouped) {
    const client = clientByProjectId.get(row.projectId as string);
    // A miss here now covers two cases, both deliberately excluded: (1)
    // the pre-existing defensive case — a projectId whose Project row no
    // longer exists at all (never expected, since TimeEntry.projectId is
    // SetNull on Project deletion, not left dangling); (2) the hardened
    // case this audit added — a Project/Client that failed the
    // organizationId match above (cross-tenant or legacy-null). Neither
    // is ever assumed away silently.
    if (!client) continue;
    const minutes = row._sum.durationMinutes ?? 0;
    const existing = minutesByClient.get(client.id);
    minutesByClient.set(client.id, { name: client.name, minutes: (existing?.minutes ?? 0) + minutes });
  }

  return Array.from(minutesByClient.entries())
    .map(([clientId, v]) => ({ clientId, clientName: v.name, totalMinutes: v.minutes }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.clientId.localeCompare(b.clientId));
}
