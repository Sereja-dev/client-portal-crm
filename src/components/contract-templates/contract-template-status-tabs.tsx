import Link from "next/link";
import {
  CONTRACT_TEMPLATE_STATUS_TABS,
  buildContractTemplatesStatusHref,
  type ContractTemplateStatusTab,
} from "@/app/(dashboard)/settings/contract-templates/view-params";

const TAB_CLASSES =
  "focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const TAB_LABELS: Record<ContractTemplateStatusTab, string> = {
  active: "Active",
  archived: "Archived",
};

/**
 * Contract Templates V1 — the Active/Archived segmented control. Plain
 * `<Link>`-based, no client-side state — mirrors
 * src/components/invoice-templates/invoice-template-status-tabs.tsx's own
 * identical shape exactly.
 */
export function ContractTemplateStatusTabs({ status }: { status: ContractTemplateStatusTab }) {
  return (
    <div
      role="group"
      aria-label="Template status"
      className="border-border-default bg-surface mt-6 flex gap-1 overflow-x-auto rounded-lg border p-1"
    >
      {CONTRACT_TEMPLATE_STATUS_TABS.map((tab) => {
        const active = tab === status;
        return (
          <Link
            key={tab}
            href={buildContractTemplatesStatusHref(tab)}
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
