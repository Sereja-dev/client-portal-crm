import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";

/**
 * Invoice Templates V1 (Settings UI) — which lifecycle state the list
 * page currently shows, driven by `?status=`. Mirrors
 * src/app/(dashboard)/settings/templates/view-params.ts's own identical
 * shape exactly: an invalid/missing value always falls back safely to
 * "active" rather than throwing — this is a pure UI-mode concern, never
 * security-relevant (listInvoiceTemplates itself is independently
 * organization-scoped regardless of which tab is showing, and the
 * archived tab is management-only exactly like the active one — see
 * page.tsx's own role gate).
 */

export const INVOICE_TEMPLATE_STATUS_TABS = ["active", "archived"] as const;
export type InvoiceTemplateStatusTab = (typeof INVOICE_TEMPLATE_STATUS_TABS)[number];

const DEFAULT_STATUS_TAB: InvoiceTemplateStatusTab = "active";

export function parseInvoiceTemplateStatusParam(searchParams: RawSearchParams): InvoiceTemplateStatusTab {
  return parseEnumParam(searchParams.status, INVOICE_TEMPLATE_STATUS_TABS) ?? DEFAULT_STATUS_TAB;
}

/** Builds a /settings/invoice-templates?status=... href — omits the param entirely for the default ("active") tab, matching buildTemplatesStatusHref's own "canonical URL has no redundant default param" convention. */
export function buildInvoiceTemplatesStatusHref(status: InvoiceTemplateStatusTab): string {
  return status === DEFAULT_STATUS_TAB ? "/settings/invoice-templates" : `/settings/invoice-templates?status=${status}`;
}
