import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-user";
import { checkRateLimit, LEAD_EXPORT_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { canExportData } from "@/lib/export/authorization";
import { buildCsvDocument, csvTextCell, csvNumberCell } from "@/lib/csv/serialize";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { formatStatusLabel } from "@/lib/format";
import { getTagsForEntities } from "@/lib/tags/list-query";
import { parseLeadListParams, buildLeadWhere, buildLeadOrderBy } from "@/app/(dashboard)/leads/query";

const FORBIDDEN_MESSAGE = "Only the organization owner or an admin can export data.";

const CSV_HEADER = [
  "ID",
  "Name",
  "Company",
  "Email",
  "Phone",
  "Source",
  "Stage",
  "Value",
  "Notes",
  "Assignee",
  "Tags",
  "Archived",
  "Created At",
  "Updated At",
];

/**
 * CSV Import/Export Phase 1 — Lead export. Mirrors clients/export's own
 * structure exactly (see that route's own doc comment for the full
 * "why"). The one Lead-specific filter, `archived`, defaults to false
 * inside parseLeadListParams — so an export with no `?archived=1` query
 * param exports only active Leads, exactly matching what the Leads list
 * page itself shows by default; passing the same query string the list
 * page's own "Archived" filter view uses exports the archived set
 * instead, never both silently at once.
 *
 * Lead.value is exported via csvNumberCell (a genuinely numeric column,
 * never neutralized for formula injection — see serialize.ts's own doc
 * comment) as a plain decimal, not a currency-formatted string — the
 * more re-importable, spreadsheet-native representation.
 */
export async function GET(request: Request) {
  const { user, organizationId, membership } = await getCurrentMembership();

  if (!(await canExportData(organizationId, membership.role))) {
    return new NextResponse(FORBIDDEN_MESSAGE, { status: 403 });
  }

  const limitCheck = checkRateLimit(LEAD_EXPORT_LIMIT, user.id);
  if (limitCheck.limited) {
    return new NextResponse(RATE_LIMIT_MESSAGE, { status: 429 });
  }

  const url = new URL(request.url);
  const searchParams: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    searchParams[key] = value;
  }
  const listParams = parseLeadListParams(searchParams);

  const where = await buildLeadWhere(organizationId, listParams);
  const orderBy = buildLeadOrderBy(listParams);

  // No skip/take — every matching row is exported, never just the
  // current list page.
  const leads = await prisma.lead.findMany({
    where,
    orderBy,
    include: {
      assignedTo: { select: { name: true } },
      statusDefinition: { select: { label: true, color: true } },
    },
  });

  const tagsByLeadId = await getTagsForEntities(
    organizationId,
    "LEAD",
    leads.map((l) => l.id),
  );

  const rows: string[][] = [CSV_HEADER];
  for (const lead of leads) {
    const stageLabel = resolveStatusPresentation(lead.statusDefinition, lead.stage).label;
    const tagNames = (tagsByLeadId.get(lead.id) ?? []).map((t) => t.name).join(", ");

    rows.push([
      csvTextCell(lead.id),
      csvTextCell(lead.name),
      csvTextCell(lead.company),
      csvTextCell(lead.email),
      csvTextCell(lead.phone),
      csvTextCell(lead.source ? formatStatusLabel(lead.source) : null),
      csvTextCell(stageLabel),
      csvNumberCell(lead.value !== null ? Number(lead.value) : null),
      csvTextCell(lead.notes),
      csvTextCell(lead.assignedTo?.name ?? null),
      csvTextCell(tagNames),
      csvTextCell(lead.archivedAt !== null ? "Yes" : "No"),
      csvTextCell(lead.createdAt.toISOString()),
      csvTextCell(lead.updatedAt.toISOString()),
    ]);
  }

  const csv = buildCsvDocument(rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leads.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
