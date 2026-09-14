import "server-only";
import { prisma } from "@/lib/prisma";
import type { QuoteTemplate, QuoteTemplateItem } from "@/generated/prisma/client";
import { isUuid } from "@/lib/validation/lead";
import type { PrismaClientOrTx } from "./types";

/**
 * Quote Templates Phase 1 — read-side queries needed by a future Phase 2
 * Settings UI (list/manage) and the apply-prefill helper (apply.ts). No
 * UI exists yet; these are plain, org-scoped domain functions only.
 *
 * Every lookup by id first checks isUuid() and returns null immediately
 * for a malformed id — never lets a non-UUID string reach the database
 * layer, where it would otherwise surface as a driver-level error rather
 * than the same "not found" every foreign-org/nonexistent id already
 * produces. A malformed id, a foreign-org id, and a genuinely nonexistent
 * id are therefore all indistinguishable from each other, matching this
 * codebase's universal "a foreign-org id is indistinguishable from a
 * nonexistent one" doctrine.
 */

export type QuoteTemplateWithItems = QuoteTemplate & { items: QuoteTemplateItem[] };

const ITEMS_IN_POSITION_ORDER = { items: { orderBy: { position: "asc" as const } } };

export type ListQuoteTemplatesOptions = {
  /** Defaults to excluding archived rows — same convention as listTags/listCustomFieldDefinitions/listWorkflowAutomations. */
  includeArchived?: boolean;
};

/** Deterministic order: name asc, then id asc as a stable tie-break (createdAt can collide at the same millisecond under concurrent creates; id never does). No pagination/search in V1 — see the architecture audit's own §28 scale estimate (tens to low hundreds of templates per organization). */
export async function listQuoteTemplates(
  organizationId: string,
  options: ListQuoteTemplatesOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<QuoteTemplate[]> {
  return client.quoteTemplate.findMany({
    where: { organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

/** For management (edit/duplicate/archive/restore) — returned regardless of archived state, since a management UI must still be able to view/restore an archived template. Includes items in position order. */
export async function getQuoteTemplateForManagement(
  organizationId: string,
  templateId: string,
  client: PrismaClientOrTx = prisma,
): Promise<QuoteTemplateWithItems | null> {
  if (!isUuid(templateId)) return null;
  return client.quoteTemplate.findFirst({
    where: { id: templateId, organizationId },
    include: ITEMS_IN_POSITION_ORDER,
  });
}

/**
 * For apply/prefill only — ACTIVE (archivedAt: null) exclusively. An
 * archived template is never returned here, even by a direct, otherwise-
 * valid, same-organization id — this is the one enforcement point
 * apply.ts's own getQuoteTemplateDefaults() relies on for "applying an
 * archived template must fail server-side."
 */
export async function getActiveQuoteTemplateForApply(
  organizationId: string,
  templateId: string,
  client: PrismaClientOrTx = prisma,
): Promise<QuoteTemplateWithItems | null> {
  if (!isUuid(templateId)) return null;
  return client.quoteTemplate.findFirst({
    where: { id: templateId, organizationId, archivedAt: null },
    include: ITEMS_IN_POSITION_ORDER,
  });
}
