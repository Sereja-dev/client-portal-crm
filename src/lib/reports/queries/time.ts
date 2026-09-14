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
 * direct column on TimeEntry itself) is the sole tenant boundary applied
 * here — Project/Client are looked up purely for display names, never
 * re-scoped by their own (legacy-nullable) organizationId. This matches
 * this app's own established precedent exactly:
 * src/lib/time-entries/entries.ts's TIME_ENTRY_DISPLAY_INCLUDE already
 * joins `project: { select: { id, name } }` with no additional
 * organizationId filter on the joined Project, relying on the domain
 * layer's own write-time guarantee that a TimeEntry's projectId always
 * belongs to the same organization as the entry itself.
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
    where: { id: { in: projectIds } },
    select: { id: true, client: { select: { id: true, name: true } } },
  });
  const clientByProjectId = new Map(projects.map((p) => [p.id, p.client]));

  const minutesByClient = new Map<string, { name: string; minutes: number }>();
  for (const row of grouped) {
    const client = clientByProjectId.get(row.projectId as string);
    // Defensive only — Project.clientId is required (never null), so
    // every found Project always carries a Client; this guards solely
    // against a projectId whose Project row itself no longer exists
    // (never expected, since TimeEntry.projectId is SetNull on Project
    // deletion, not left dangling — but never assumed silently).
    if (!client) continue;
    const minutes = row._sum.durationMinutes ?? 0;
    const existing = minutesByClient.get(client.id);
    minutesByClient.set(client.id, { name: client.name, minutes: (existing?.minutes ?? 0) + minutes });
  }

  return Array.from(minutesByClient.entries())
    .map(([clientId, v]) => ({ clientId, clientName: v.name, totalMinutes: v.minutes }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.clientId.localeCompare(b.clientId));
}
