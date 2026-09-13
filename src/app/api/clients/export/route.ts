import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-user";
import { checkRateLimit, CLIENT_EXPORT_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { canExportData } from "@/lib/export/authorization";
import { buildCsvDocument, csvTextCell } from "@/lib/csv/serialize";
import { resolveStatusPresentation } from "@/lib/custom-statuses/presentation";
import { getTagsForEntities } from "@/lib/tags/list-query";
import { parseClientListParams, buildClientWhere, buildClientOrderBy } from "@/app/(dashboard)/clients/query";

const FORBIDDEN_MESSAGE = "Only the organization owner or an admin can export data.";

const CSV_HEADER = [
  "ID",
  "Name",
  "Company",
  "Email",
  "Phone",
  "Status",
  "Notes",
  "Billing Legal Name",
  "Tax ID",
  "Street Address",
  "City",
  "State",
  "Postal Code",
  "Country",
  "Tags",
  "Created At",
  "Updated At",
];

/**
 * CSV Import/Export Phase 1 — Client export. Mirrors
 * src/app/api/invoices/[id]/pdf/route.ts's own structure (auth -> rate
 * limit -> scoped query -> generated response), the one existing
 * precedent in this app for a Route-Handler-generated file download.
 *
 * organizationId is always getCurrentMembership()'s own server-resolved
 * value — the query string is only ever parsed for the same list-filter
 * params the Clients list page itself supports (q/status/tag), through
 * the exact same parseClientListParams/buildClientWhere the list page
 * uses (Section C of the read-only audit: "reuse the exact filter
 * semantics, never a second approximate implementation"). Pagination
 * (page/sort's own take/skip) is never applied here — every row matching
 * the filters is exported, never just the current page.
 *
 * Custom Fields are deliberately NOT included in this phase — see this
 * feature's own commit message / the implementation report for why
 * (no existing batched "values for many entities" reader exists;
 * building one is a real architectural addition, not a reuse, and was
 * explicitly deferred rather than adding N+1 queries or a new read
 * layer inside this phase).
 */
export async function GET(request: Request) {
  const { user, organizationId, membership } = await getCurrentMembership();

  if (!canExportData(membership.role)) {
    return new NextResponse(FORBIDDEN_MESSAGE, { status: 403 });
  }

  const limitCheck = checkRateLimit(CLIENT_EXPORT_LIMIT, user.id);
  if (limitCheck.limited) {
    return new NextResponse(RATE_LIMIT_MESSAGE, { status: 429 });
  }

  const url = new URL(request.url);
  const searchParams: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    searchParams[key] = value;
  }
  const listParams = parseClientListParams(searchParams);

  const where = await buildClientWhere(organizationId, listParams);
  const orderBy = buildClientOrderBy(listParams);

  // No skip/take — every matching row is exported, never just the
  // current list page (Section C/N of the read-only audit).
  const clients = await prisma.client.findMany({
    where,
    orderBy,
    include: { statusDefinition: { select: { label: true, color: true } } },
  });

  // Tags V2 — one batched read for every exported Client's own current
  // tag assignments, never one query per row (Section H of the audit:
  // "avoid N+1 queries for tags").
  const tagsByClientId = await getTagsForEntities(
    organizationId,
    "CLIENT",
    clients.map((c) => c.id),
  );

  const rows: string[][] = [CSV_HEADER];
  for (const client of clients) {
    const statusLabel = resolveStatusPresentation(client.statusDefinition, client.status).label;
    const tagNames = (tagsByClientId.get(client.id) ?? []).map((t) => t.name).join(", ");

    rows.push([
      csvTextCell(client.id),
      csvTextCell(client.name),
      csvTextCell(client.company),
      csvTextCell(client.email),
      csvTextCell(client.phone),
      csvTextCell(statusLabel),
      csvTextCell(client.notes),
      csvTextCell(client.billingLegalName),
      csvTextCell(client.taxId),
      csvTextCell(client.streetAddress),
      csvTextCell(client.city),
      csvTextCell(client.state),
      csvTextCell(client.postalCode),
      csvTextCell(client.country),
      csvTextCell(tagNames),
      csvTextCell(client.createdAt.toISOString()),
      csvTextCell(client.updatedAt.toISOString()),
    ]);
  }

  const csv = buildCsvDocument(rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="clients.csv"',
      // A per-organization, per-role-gated export must never be cached
      // by a shared/intermediate cache — same discipline the Invoice PDF
      // route's own redirect response already applies.
      "Cache-Control": "private, no-store",
    },
  });
}
