import { prisma } from "@/lib/prisma";
import { computeMatchTier, sortRanked } from "./ranking";
import { buildInvoiceResultUrl } from "./result-links";
import { escapeLikePattern } from "./normalize-query";
import type { SearchResult } from "./types";

/**
 * Global Search Stage 2 (docs/search-architecture.md §2/§5/§8). Scoped by
 * `organizationId` (Invoice's own column) as the sole tenant boundary —
 * Quotes / Estimates Phase 2.3 (Invoice / Project Coupling Audit) removed
 * the `project: { organizationId }`/`client: { organizationId }`
 * defense-in-depth filters this used to also require: a project-less
 * Invoice has no Project relation to match, so that filter would have
 * silently excluded it from every search result.
 *
 * Searches `invoiceNumber`, `Client.name` (Invoice's own direct relation
 * — never routed through Project), and `Project.name` (only present for
 * an Invoice that has one). `notes` is never searched or selected: it is
 * explicit free-text the design doc's §8 names as never returned.
 */
export async function searchInvoices(params: {
  organizationId: string;
  query: string;
  candidateLimit: number;
  resultLimit: number;
}): Promise<SearchResult[]> {
  const escaped = escapeLikePattern(params.query);

  const rows = await prisma.invoice.findMany({
    where: {
      organizationId: params.organizationId,
      OR: [
        { invoiceNumber: { contains: escaped, mode: "insensitive" } },
        { client: { name: { contains: escaped, mode: "insensitive" } } },
        { project: { name: { contains: escaped, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      invoiceNumber: true,
      createdAt: true,
      client: { select: { name: true } },
      project: { select: { name: true } },
    },
    take: params.candidateLimit,
    orderBy: { createdAt: "desc" },
  });

  const ranked = sortRanked(
    rows.map((row) => ({
      id: row.id,
      recencyKey: row.createdAt.toISOString(),
      tier: computeMatchTier({
        query: params.query,
        primary: row.invoiceNumber,
        secondary: row.project ? `${row.project.name} ${row.client.name}` : row.client.name,
      }),
      row,
    })),
  );

  return ranked
    .slice(0, params.resultLimit)
    .map((entry): SearchResult | null => {
      const url = buildInvoiceResultUrl(entry.row.id);
      if (!url) return null;
      return {
        type: "INVOICE",
        id: entry.row.id,
        title: `Invoice #${entry.row.invoiceNumber}`,
        subtitle: entry.row.project ? `${entry.row.project.name} · ${entry.row.client.name}` : entry.row.client.name,
        preview: null,
        url,
      };
    })
    .filter((result): result is SearchResult => result !== null);
}
