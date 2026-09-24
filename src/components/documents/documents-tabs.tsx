import { SectionTabs, type SectionTab } from "@/components/navigation/section-tabs";

/**
 * Section Consolidation §2/§7 — Documents' own tab set. Contracts is the
 * only genuinely-existing Documents surface today (the read-only audit's
 * own §H/§U conclusion — Templates stays under Settings, no document
 * library exists to link) — this still renders the same section-tab
 * shell language as Finance/Work/Insights so Contracts visibly belongs
 * to the Documents business zone, exactly as the locked spec requests,
 * without inventing a second destination to fill it out. Mounted
 * directly on /contracts only (never on /contracts/new,
 * /contracts/[id], or /contracts/[id]/edit — those stay exactly as
 * they already are).
 *
 * `buildDocumentsTabs` is exported as a pure function (mirroring
 * sidebar.tsx's own buildSidebarGroups()) so its shape is directly
 * unit-testable.
 */
export function buildDocumentsTabs(): SectionTab[] {
  return [{ label: "Contracts", href: "/contracts" }];
}

export function DocumentsTabs() {
  return <SectionTabs label="Documents" tabs={buildDocumentsTabs()} />;
}
