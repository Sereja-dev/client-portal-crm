"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { FormLabel } from "@/components/ui/form-field";

export type InvoiceTemplatePickerOption = { id: string; name: string };

/**
 * Invoice Templates V1 — the "Use template" entry point on /invoices/new.
 * Mirrors src/components/quotes/quote-template-picker.tsx's own identical
 * shape exactly, with `?templateId=` as the query param (matching this
 * feature's own apply-link convention from the Settings management list
 * — `/invoices/new?templateId=<id>` — rather than Quote's own `?template=`).
 *
 * Shows ACTIVE templates only (the page passes only its own already-
 * filtered active list — this component never calls into any Invoice
 * Template domain function itself, so MEMBER visibility here is a plain
 * prop, never a reuse of canManageInvoiceTemplates). Hidden entirely when
 * there are zero active templates — never a disabled/empty dropdown.
 *
 * Navigates via full URL change (`router.push` to the same /invoices/new
 * route with `?templateId=<id>` set or cleared), preserving every OTHER
 * current search param unchanged — in particular, an existing `?clientId=`
 * prefill survives a template selection untouched (composition, see
 * new/page.tsx's own header comment).
 *
 * Deliberately a page reload/prefill, never a live mid-form overwrite —
 * this control is rendered as its own block ABOVE InvoiceForm in
 * new/page.tsx, never inside its `<form>`. Remounting InvoiceForm on
 * selection (via a `key` prop in new/page.tsx) is required for the
 * prefill to actually apply, matching QuoteForm's own identical
 * remount-on-template-change requirement.
 */
export function InvoiceTemplatePicker({ templates, selectedTemplateId }: { templates: InvoiceTemplatePickerOption[]; selectedTemplateId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (templates.length === 0) {
    return null;
  }

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set("templateId", next);
    } else {
      params.delete("templateId");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="border-border-default bg-surface-muted mb-6 rounded-md border p-4">
      <FormLabel htmlFor="template-picker">Start from a template</FormLabel>
      <Select id="template-picker" value={selectedTemplateId ?? ""} onChange={handleChange} className="mt-2 sm:max-w-sm">
        <option value="">— Start blank —</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </Select>
      <p className="text-text-muted mt-1 text-xs">
        Fills in the fields below from the template. Any client already selected on this page is kept.
      </p>
    </div>
  );
}
