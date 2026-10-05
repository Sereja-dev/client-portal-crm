import { SectionTabs, type SectionTab } from "@/components/navigation/section-tabs";

/**
 * Documents Slice D — Documents' own tab set, expanded from the single
 * Contracts destination to the full approved V1 IA: Contracts, Contract
 * Templates, Files, Accepted documents, in that order. Quote Templates
 * stays excluded (locked spec §2, unchanged) — it remains a Settings-
 * only page (/settings/templates), never duplicated here.
 *
 * Contract Templates appears here even though its page physically lives
 * under /settings/ — mirroring FinanceTabs' own identical "Billing"
 * precedent (src/components/finance/finance-tabs.tsx) exactly: this is
 * a navigational destination only, never rendered *on*
 * /settings/contract-templates itself (that page keeps rendering only
 * SettingsNav, completely unchanged — see settings/contract-templates/
 * page.tsx, untouched by this slice).
 *
 * Mounted directly on /contracts, /files, and /documents/accepted (never
 * on /contracts/new, /contracts/[id], /contracts/[id]/edit,
 * /contracts/[id]/preview, or /settings/contract-templates — those stay
 * exactly as they already are).
 *
 * `buildDocumentsTabs` is exported as a pure function (mirroring
 * sidebar.tsx's own buildSidebarGroups()) so its shape is directly
 * unit-testable.
 */
export function buildDocumentsTabs(): SectionTab[] {
  return [
    { label: "Contracts", href: "/contracts" },
    { label: "Contract Templates", href: "/settings/contract-templates" },
    { label: "Files", href: "/files" },
    { label: "Accepted documents", href: "/documents/accepted" },
  ];
}

export function DocumentsTabs() {
  return <SectionTabs label="Documents" tabs={buildDocumentsTabs()} />;
}
