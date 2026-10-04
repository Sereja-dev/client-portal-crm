"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { FormLabel } from "@/components/ui/form-field";

export type ContractTemplatePickerOption = { id: string; name: string };

/**
 * Contract Templates V1 — the "Use template" entry point on
 * /contracts/new. Mirrors
 * src/components/invoices/invoice-template-picker.tsx's own identical
 * shape exactly, with `?templateId=` as the query param (matching this
 * feature's own apply-link convention from the Settings management list
 * — `/contracts/new?templateId=<id>`).
 *
 * Shows ACTIVE templates only (the page passes only its own already-
 * filtered active list — this component never calls into any Contract
 * Template domain function itself, so visibility here is a plain prop,
 * never a reuse of canManageContractTemplates). Hidden entirely when
 * there are zero active templates — never a disabled/empty dropdown.
 *
 * Navigates via full URL change (`router.push` to the same /contracts/new
 * route with `?templateId=<id>` set or cleared), preserving every OTHER
 * current search param unchanged. Unlike the Invoice/Quote equivalents,
 * /contracts/new currently has no other prefill param (no `?clientId=`/
 * `?projectId=`) to preserve, but the same-shape URLSearchParams merge is
 * kept anyway so this still behaves correctly if one is ever added.
 *
 * Deliberately a page reload/prefill, never a live mid-form overwrite —
 * this control is rendered as its own block ABOVE ContractForm in
 * new/page.tsx, never inside its `<form>`. Remounting ContractForm on
 * selection (via a `key` prop in new/page.tsx) is required for the
 * prefill to actually apply, matching InvoiceTemplatePicker's own
 * identical remount-on-template-change requirement.
 */
export function ContractTemplatePicker({ templates, selectedTemplateId }: { templates: ContractTemplatePickerOption[]; selectedTemplateId?: string }) {
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
        Fills in the title, body, default expiry, and internal notes below. Client, Project, and signatory are
        always chosen separately below — a template never sets them.
      </p>
    </div>
  );
}
