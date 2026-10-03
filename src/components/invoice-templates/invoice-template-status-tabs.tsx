import Link from "next/link";
import {
  INVOICE_TEMPLATE_STATUS_TABS,
  buildInvoiceTemplatesStatusHref,
  type InvoiceTemplateStatusTab,
} from "@/app/(dashboard)/settings/invoice-templates/view-params";

const TAB_CLASSES =
  "focus-visible:ring-focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const TAB_LABELS: Record<InvoiceTemplateStatusTab, string> = {
  active: "Active",
  archived: "Archived",
};

/**
 * Invoice Templates V1 — the Active/Archived segmented control. Plain
 * `<Link>`-based, no client-side state — mirrors
 * src/components/quote-templates/quote-template-status-tabs.tsx's own
 * identical shape exactly.
 */
export function InvoiceTemplateStatusTabs({ status }: { status: InvoiceTemplateStatusTab }) {
  return (
    <div
      role="group"
      aria-label="Template status"
      className="border-border-default bg-surface mt-6 flex gap-1 overflow-x-auto rounded-lg border p-1"
    >
      {INVOICE_TEMPLATE_STATUS_TABS.map((tab) => {
        const active = tab === status;
        return (
          <Link
            key={tab}
            href={buildInvoiceTemplatesStatusHref(tab)}
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
