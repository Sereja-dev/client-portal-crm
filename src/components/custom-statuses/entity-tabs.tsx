import Link from "next/link";
import {
  CUSTOM_STATUS_ENTITY_TABS,
  ENTITY_TYPE_LABELS,
  buildCustomStatusesHref,
} from "@/app/(dashboard)/settings/custom-statuses/view-params";
import type { CustomStatusEntityType } from "@/generated/prisma/enums";

const TAB_CLASSES =
  "focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Custom Statuses Phase 2B (Section C) — the CLIENT/LEAD/PROJECT entity
 * selector. Byte-for-byte mirror of custom-fields/entity-tabs.tsx's own
 * exact shape (plain `<Link>`-based segmented control, no client state).
 */
export function EntityTabs({ entityType }: { entityType: CustomStatusEntityType }) {
  return (
    <div
      role="group"
      aria-label="Custom status entity"
      className="border-border-default bg-surface mt-6 flex gap-1 overflow-x-auto rounded-lg border p-1"
    >
      {CUSTOM_STATUS_ENTITY_TABS.map((tab) => {
        const active = tab === entityType;
        return (
          <Link
            key={tab}
            href={buildCustomStatusesHref(tab)}
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
