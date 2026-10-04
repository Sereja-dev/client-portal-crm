import { parseEnumParam, type RawSearchParams } from "@/lib/list-params";

/**
 * Contract Templates V1 (Settings UI) — which lifecycle state the list
 * page currently shows, driven by `?status=`. Mirrors
 * src/app/(dashboard)/settings/invoice-templates/view-params.ts's own
 * identical shape exactly: an invalid/missing value always falls back
 * safely to "active" rather than throwing — this is a pure UI-mode
 * concern, never security-relevant (listContractTemplates itself is
 * independently organization-scoped regardless of which tab is showing,
 * and the archived tab is management-only exactly like the active one —
 * see page.tsx's own role gate).
 */

export const CONTRACT_TEMPLATE_STATUS_TABS = ["active", "archived"] as const;
export type ContractTemplateStatusTab = (typeof CONTRACT_TEMPLATE_STATUS_TABS)[number];

const DEFAULT_STATUS_TAB: ContractTemplateStatusTab = "active";

export function parseContractTemplateStatusParam(searchParams: RawSearchParams): ContractTemplateStatusTab {
  return parseEnumParam(searchParams.status, CONTRACT_TEMPLATE_STATUS_TABS) ?? DEFAULT_STATUS_TAB;
}

/** Builds a /settings/contract-templates?status=... href — omits the param entirely for the default ("active") tab, matching buildInvoiceTemplatesStatusHref's own "canonical URL has no redundant default param" convention. */
export function buildContractTemplatesStatusHref(status: ContractTemplateStatusTab): string {
  return status === DEFAULT_STATUS_TAB ? "/settings/contract-templates" : `/settings/contract-templates?status=${status}`;
}
