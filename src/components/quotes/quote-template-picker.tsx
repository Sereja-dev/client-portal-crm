"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { FormLabel } from "@/components/ui/form-field";

export type QuoteTemplatePickerOption = { id: string; name: string };

/**
 * Quote Templates Phase 2 (Section F/S) — the "Use template" entry point
 * on /quotes/new. Shows ACTIVE templates only (the page passes only its
 * own already-filtered active list — Section U: this component never
 * calls into any Quote Template domain function itself, so MEMBER
 * visibility here is a plain prop, never a reuse of
 * canManageQuoteTemplates). Hidden entirely when there are zero active
 * templates (Section T) — never a disabled/empty dropdown.
 *
 * Navigates via full URL change (`router.push` to the same /quotes/new
 * route with `?template=<id>` set or cleared), preserving every OTHER
 * current search param unchanged (Section R) — this page has no
 * existing lead/client query-param entry point today (verified directly:
 * no other page in this app links to /quotes/new with any query string),
 * but this still generically keeps whatever is already on the URL rather
 * than assuming today's empty set forever.
 *
 * Deliberately a page reload/prefill, never a live mid-form overwrite
 * (Section V's own explicit instruction) — this control is rendered as
 * its own block ABOVE QuoteForm in new/page.tsx, never inside its
 * `<form>`, so choosing a template is visually and structurally a
 * "starting point" decision made before filling in details, not a
 * switch that silently discards a field someone already typed. No
 * dirty-form confirmation subsystem was added on top of that
 * positioning — the spec's own explicit instruction was not to build
 * one unless actually needed, and placing this above the form's own
 * fields is the chosen mitigation instead (see that page's own comment
 * for the full reasoning, including why remounting QuoteForm on
 * selection is itself required for the prefill to actually apply).
 */
export function QuoteTemplatePicker({ templates, selectedTemplateId }: { templates: QuoteTemplatePickerOption[]; selectedTemplateId?: string }) {
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
      params.set("template", next);
    } else {
      params.delete("template");
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
        Fills in the fields below from the template. Any lead or client already selected on this page is kept.
      </p>
    </div>
  );
}
