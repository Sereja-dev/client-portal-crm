import Link from "next/link";
import { CUSTOM_FIELD_ENTITY_TABS, ENTITY_TYPE_LABELS, buildCustomFieldsHref } from "@/app/(dashboard)/settings/custom-fields/view-params";
import type { CustomFieldEntityType } from "@/generated/prisma/enums";

const TAB_CLASSES =
  "focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Custom Fields Phase 2A (Section C) — the CLIENT/LEAD/PROJECT entity
 * selector. Plain `<Link>`-based segmented control, no client-side state
 * at all — mirrors leads/page.tsx's own ViewToggle exactly (same
 * `?param=` + `aria-current="page"` + focus-visible pattern), so this
 * needs no "use client" directive.
 */
export function EntityTabs({ entityType }: { entityType: CustomFieldEntityType }) {
  return (
    <div
      role="group"
      aria-label="Custom field entity"
      className="border-border-default bg-surface mt-6 flex gap-1 overflow-x-auto rounded-lg border p-1"
    >
      {CUSTOM_FIELD_ENTITY_TABS.map((tab) => {
        const active = tab === entityType;
        return (
          <Link
            key={tab}
            href={buildCustomFieldsHref(tab)}
            aria-current={active ? "page" : undefined}
            className={`${TAB_CLASSES} whitespace-nowrap ${active ? "bg-accent text-white" : "text-text-secondary hover:bg-[var(--hover)]"}`}
          >
            {ENTITY_TYPE_LABELS[tab]}
          </Link>
        );
      })}
    </div>
  );
}
