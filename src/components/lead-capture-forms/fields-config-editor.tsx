"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import type { ResolvedLeadCaptureFormFieldsConfig } from "@/lib/lead-capture-forms/fields";
import {
  toFieldRows,
  applyVisibilityChange,
  applyRequiredChange,
  applyLabelChange,
  moveFieldRow,
  serializeFieldRows,
  defaultFieldLabel,
} from "./fields-config-editor-logic";

/**
 * Public Lead Capture Forms Phase 2A — the "Fields" section of the
 * create/edit form. Manages the 5 fixed V1 fields' own visible/required/
 * label/order state locally (state transitions live in
 * fields-config-editor-logic.ts, split out so they're unit-testable —
 * see that file's own doc comment), then serializes it into one hidden
 * JSON input (`fieldsConfig`) the Server Action parses with `JSON.parse`
 * and hands straight to createLeadCaptureForm/updateLeadCaptureForm's own
 * existing `fieldsConfig` input — the exact same shape
 * validateLeadCaptureFormFieldsConfigInput already validates, reused as-is
 * (Section: "reuse existing validation").
 *
 * Enforces "a hidden field can't be required" client-side (Section:
 * "UI should prevent invalid combinations before submit") by coupling
 * the two checkboxes: unchecking Visible always also unchecks and
 * disables Required for that row (applyVisibilityChange). Server
 * validation (validateLeadCaptureFormFieldsConfigInput) remains the
 * authoritative check — this is a UX convenience, not the security
 * boundary.
 *
 * `name` is always visible+required (see fields.ts's own
 * resolveLeadCaptureFormFieldsConfig comment: the created Lead can never
 * omit it) — its own row's checkboxes are shown checked and disabled
 * rather than hidden entirely, so it's still visible in the ordering and
 * label-override UI, just not togglable.
 */
export function FieldsConfigEditor({ defaultConfig }: { defaultConfig: ResolvedLeadCaptureFormFieldsConfig }) {
  const [rows, setRows] = useState(() => toFieldRows(defaultConfig));

  const serialized = JSON.stringify(serializeFieldRows(rows));

  return (
    <div>
      <input type="hidden" name="fieldsConfig" value={serialized} />
      <div className="border-border-default overflow-x-auto rounded-lg border">
        <table className="divide-border-default min-w-full divide-y text-sm">
          <thead className="bg-surface-recessed">
            <tr>
              <th scope="col" className="text-text-muted px-3 py-2 text-left font-medium">
                Field
              </th>
              <th scope="col" className="text-text-muted px-3 py-2 text-left font-medium">
                Visible
              </th>
              <th scope="col" className="text-text-muted px-3 py-2 text-left font-medium">
                Required
              </th>
              <th scope="col" className="text-text-muted px-3 py-2 text-left font-medium">
                Label override
              </th>
              <th scope="col" className="text-text-muted px-3 py-2 text-right font-medium">
                Order
              </th>
            </tr>
          </thead>
          <tbody className="divide-border-default divide-y">
            {rows.map((row, index) => {
              const isName = row.key === "name";
              const rowId = `field-${row.key}`;
              const label = defaultFieldLabel(row.key);
              return (
                <tr key={row.key}>
                  <td className="text-text-primary px-3 py-2 font-medium whitespace-nowrap">
                    {label}
                    {isName && <span className="text-text-muted ml-1 text-xs font-normal">(always on)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      id={`${rowId}-visible`}
                      type="checkbox"
                      checked={row.visible}
                      disabled={isName}
                      onChange={(e) => setRows((current) => applyVisibilityChange(current, index, e.target.checked))}
                      aria-label={`${label} visible`}
                      className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      id={`${rowId}-required`}
                      type="checkbox"
                      checked={row.required}
                      disabled={isName || !row.visible}
                      onChange={(e) => setRows((current) => applyRequiredChange(current, index, e.target.checked))}
                      aria-label={`${label} required`}
                      className="border-border-strong accent-accent focus-visible:ring-focus-ring h-4 w-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`${label} label override`}
                      value={row.label}
                      onChange={(e) => setRows((current) => applyLabelChange(current, index, e.target.value))}
                      placeholder={label}
                      maxLength={100}
                      className="w-full min-w-[10rem]"
                    />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => setRows((current) => moveFieldRow(current, index, "up"))}
                        aria-label={`Move ${label} up`}
                        className="text-text-secondary focus-visible:ring-focus-ring hover:text-text-primary rounded px-1.5 py-0.5 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === rows.length - 1}
                        onClick={() => setRows((current) => moveFieldRow(current, index, "down"))}
                        aria-label={`Move ${label} down`}
                        className="text-text-secondary focus-visible:ring-focus-ring hover:text-text-primary rounded px-1.5 py-0.5 text-sm transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-text-muted mt-2 text-xs">
        Hidden fields can&apos;t be required — unchecking Visible also clears Required. Name is
        always shown and required, since every lead needs one.
      </p>
    </div>
  );
}
