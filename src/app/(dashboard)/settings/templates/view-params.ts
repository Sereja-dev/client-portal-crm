import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";

/**
 * Quote Templates Phase 2 (Settings UI) — which lifecycle state the list
 * page currently shows, driven by `?status=`. Mirrors Custom Fields'
 * own parseCustomFieldEntityTypeParam exactly: an invalid/missing value
 * always falls back safely to "active" rather than throwing — this is a
 * pure UI-mode concern, never security-relevant (listQuoteTemplates
 * itself is independently organization-scoped regardless of which tab
 * is showing, and the archived tab is management-only exactly like the
 * active one — see page.tsx's own role gate).
 */

export const QUOTE_TEMPLATE_STATUS_TABS = ["active", "archived"] as const;
export type QuoteTemplateStatusTab = (typeof QUOTE_TEMPLATE_STATUS_TABS)[number];

const DEFAULT_STATUS_TAB: QuoteTemplateStatusTab = "active";

export function parseQuoteTemplateStatusParam(searchParams: RawSearchParams): QuoteTemplateStatusTab {
  return parseEnumParam(searchParams.status, QUOTE_TEMPLATE_STATUS_TABS) ?? DEFAULT_STATUS_TAB;
}

/** Builds a /settings/templates?status=... href — omits the param entirely for the default ("active") tab, matching buildCustomFieldsHref's own "canonical URL has no redundant default param" convention. */
export function buildTemplatesStatusHref(status: QuoteTemplateStatusTab): string {
  return status === DEFAULT_STATUS_TAB ? "/settings/templates" : `/settings/templates?status=${status}`;
}
