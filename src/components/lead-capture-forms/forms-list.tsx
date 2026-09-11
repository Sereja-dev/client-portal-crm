"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { ArchiveFormButton, UnarchiveFormButton, ActivateToggleButton, CopyPublicLinkButton } from "./form-row-actions";

// Same base+variant classes as Button's own "primary"/"secondary" — a
// plain `<Link>` styled to match, since Button itself renders a real
// `<button>` with no polymorphic/asChild support (see e.g. leads/page.tsx's
// own identical PRIMARY_LINK_CLASSES for this exact same reasoning).
const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";
const SECONDARY_LINK_CLASSES =
  "border-border-strong bg-surface text-text-primary inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

export type LeadCaptureFormRow = {
  id: string;
  name: string;
  title: string;
  isActive: boolean;
  archivedAt: Date | null;
  publicToken: string;
  archiveAction: () => Promise<void>;
  unarchiveAction: () => Promise<void>;
  toggleActiveAction: () => Promise<void>;
};

/**
 * One form's own table row. Split out from LeadCaptureFormsList
 * specifically so it's renderable (and testable — see
 * test/unit/lead-capture-forms/forms-list-render.test.tsx) independently
 * of the parent's own "show archived" toggle state, which
 * `renderToStaticMarkup` can't simulate clicking (this repo has no DOM/
 * component-interaction harness — see fields-config-editor-logic.ts's own
 * doc comment for the fuller story).
 */
export function LeadCaptureFormTableRow({ form }: { form: LeadCaptureFormRow }) {
  const isLive = form.isActive && form.archivedAt === null;

  return (
    <TableRow>
      <TableCell emphasis>
        <div className="flex flex-col">
          <span>{form.name}</span>
          <span className="text-text-muted text-xs font-normal">{form.title}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={form.isActive ? "ACTIVE" : "INACTIVE"} />
          {form.archivedAt !== null && <StatusBadge status="ARCHIVED" />}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        {isLive ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CopyPublicLinkButton publicToken={form.publicToken} />
            <a href={`/forms/${form.publicToken}`} target="_blank" rel="noopener noreferrer" className={ACTION_LINK_CLASSES}>
              Open public form
            </a>
          </div>
        ) : (
          <span className="text-text-muted text-xs">
            {form.archivedAt !== null ? "Archived — link disabled" : "Inactive — link disabled"}
          </span>
        )}
      </TableCell>
      <TableCell align="right">
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {form.archivedAt === null && (
            <>
              <Link href={`/settings/lead-capture-forms/${form.id}`} className={ACTION_LINK_CLASSES}>
                Edit
              </Link>
              <ActivateToggleButton action={form.toggleActiveAction} name={form.name} isActive={form.isActive} />
              <ArchiveFormButton action={form.archiveAction} name={form.name} />
            </>
          )}
          {form.archivedAt !== null && <UnarchiveFormButton action={form.unarchiveAction} name={form.name} />}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Public Lead Capture Forms Phase 2A (Staff UI) — the organization's own
 * forms list. Mirrors custom-statuses/definitions-list.tsx's own exact
 * shape: local "show archived" toggle (both lists fetched once by the
 * parent Server Component), same empty states, same responsive
 * hidden-column strategy. Create/Edit are full pages
 * (/settings/lead-capture-forms/new and .../[id]), not dialogs — unlike
 * Custom Statuses/Fields, a form's metadata + 5-row Fields table is
 * genuinely form-sized content, the same reasoning /leads/new and
 * /clients/[id]/edit already use full pages instead of a modal.
 */
export function LeadCaptureFormsList({ forms }: { forms: LeadCaptureFormRow[] }) {
  const [showArchived, setShowArchived] = useState(false);

  const activeForms = forms.filter((f) => f.archivedAt === null);
  const archivedForms = forms.filter((f) => f.archivedAt !== null);
  const visibleForms = showArchived ? archivedForms : activeForms;

  return (
    <div>
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(archivedForms.length > 0 || showArchived) && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {showArchived ? "Show active" : `Show archived (${archivedForms.length})`}
            </button>
          )}
        </div>
        {activeForms.length > 0 && !showArchived && (
          <Link href="/settings/lead-capture-forms/new" className={SECONDARY_LINK_CLASSES}>
            Create form
          </Link>
        )}
      </div>

      {visibleForms.length === 0 ? (
        showArchived ? (
          <EmptyState title="No archived forms" description="Archived lead capture forms will appear here." />
        ) : (
          <EmptyState
            title="No lead capture forms yet"
            description="Create a public form to start collecting leads from your website."
            action={
              <Link href="/settings/lead-capture-forms/new" className={PRIMARY_LINK_CLASSES}>
                Create form
              </Link>
            }
          />
        )
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Form</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="hidden sm:table-cell">Public link</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visibleForms.map((form) => (
              <LeadCaptureFormTableRow key={form.id} form={form} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
