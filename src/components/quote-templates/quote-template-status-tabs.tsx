import Link from "next/link";
import { QUOTE_TEMPLATE_STATUS_TABS, buildTemplatesStatusHref, type QuoteTemplateStatusTab } from "@/app/(dashboard)/settings/templates/view-params";

const TAB_CLASSES =
  "focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const TAB_LABELS: Record<QuoteTemplateStatusTab, string> = {
  active: "Active",
  archived: "Archived",
};

/**
 * Quote Templates Phase 2 (Section B) — the Active/Archived segmented
 * control. Plain `<Link>`-based, no client-side state — mirrors
 * src/components/custom-fields/entity-tabs.tsx's own exact shape (same
 * `?param=` + `aria-current="page"` + focus-visible pattern), so this
 * needs no "use client" directive either.
 */
export function QuoteTemplateStatusTabs({ status }: { status: QuoteTemplateStatusTab }) {
  return (
    <div
      role="group"
      aria-label="Template status"
      className="border-border-default bg-surface mt-6 flex gap-1 overflow-x-auto rounded-lg border p-1"
    >
      {QUOTE_TEMPLATE_STATUS_TABS.map((tab) => {
        const active = tab === status;
        return (
          <Link
            key={tab}
            href={buildTemplatesStatusHref(tab)}
            aria-current={active ? "page" : undefined}
            className={`${TAB_CLASSES} whitespace-nowrap ${active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"}`}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
    </div>
  );
}
