"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/toast/toast-provider";
import { useSavedViews } from "@/components/list/use-saved-views";
import {
  normalizeSavedViewName,
  isValidSavedViewName,
  SAVED_VIEW_NAME_MAX_LENGTH,
  SAVED_VIEWS_MAX_PER_SCOPE,
  type SavedViewSurface,
} from "@/lib/saved-views/storage";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

type FormMode = "idle" | "saving" | "renaming";

/**
 * Tables Improvement Slice D1 — the one shared Saved Views UI, used
 * identically by Invoices and Contracts (and, per locked spec §47, no
 * other surface in this slice). Fully generic: it knows nothing about
 * which URL params a surface persists — `currentParams` (for Save) and
 * `buildApplyHref` (for Apply) are both supplied by a thin, surface-
 * specific "use client" wrapper (e.g. `InvoiceSavedViews`,
 * `ContractSavedViews`) so this component never imports a surface's own
 * query.ts, and a Server Component page never has to pass a function
 * prop across the Server/Client boundary (not serializable) — only the
 * wrapper, already a Client Component, does that hand-off.
 *
 * Lifecycle only: Save / Apply / Rename / Delete (locked spec §2) — no
 * "currently applied view" tracking, no dirty state, no default/
 * favorite, no auto-apply on load (locked spec §20/§22). `selectedId`
 * below is PURELY "which saved view is the Rename/Delete/Apply controls
 * currently pointed at" — not a claim that the page's current URL state
 * matches it.
 */
export function SavedViewsControl({
  organizationId,
  userId,
  surface,
  currentParams,
  buildApplyHref,
}: {
  organizationId: string;
  userId: string;
  surface: SavedViewSurface;
  /** The current page's already-parsed, already-allowlisted canonical params (built server-side by the page itself) — never re-derived from window.location here (locked spec §11). */
  currentParams: Record<string, string>;
  /** Pure per-surface href builder — reads only that surface's own fixed allowlist, silently ignoring any other key a stored view might contain (locked spec §9). */
  buildApplyHref: (params: Record<string, string>) => string;
}) {
  const { views, atLimit, save, rename, remove } = useSavedViews(organizationId, userId, surface);
  const { showToast } = useToast();
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<FormMode>("idle");
  const [nameInput, setNameInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const deleteDialogRef = useRef<ConfirmDialogHandle>(null);
  const selectId = useId();
  const saveInputId = useId();
  const renameInputId = useId();

  const effectiveSelectedId = views.some((view) => view.id === selectedId) ? selectedId : views[0]?.id ?? "";
  const selectedView = views.find((view) => view.id === effectiveSelectedId) ?? null;
  const trimmedNameInput = normalizeSavedViewName(nameInput);
  const nameInputIsValid = isValidSavedViewName(trimmedNameInput);

  function openSaveForm(): void {
    setNameInput("");
    setFormError(null);
    setMode("saving");
  }

  function openRenameForm(): void {
    if (!selectedView) return;
    setNameInput(selectedView.name);
    setFormError(null);
    setMode("renaming");
  }

  function closeForm(): void {
    setMode("idle");
    setFormError(null);
  }

  function handleSaveSubmit(event: FormEvent): void {
    event.preventDefault();
    const result = save(nameInput, currentParams);
    if (!result.ok) {
      setFormError(saveErrorMessage(result.reason));
      return;
    }
    setSelectedId(result.view.id);
    setMode("idle");
    showToast(`Saved "${result.view.name}"`);
  }

  function handleRenameSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!selectedView) return;
    const result = rename(selectedView.id, nameInput);
    if (!result.ok) {
      setFormError(result.reason === "invalid-name" ? saveErrorMessage("invalid-name") : "Couldn't rename this view on this device.");
      return;
    }
    setMode("idle");
    showToast("View renamed");
  }

  function handleDeleteConfirm(): void {
    if (!selectedView) return;
    const { id, name } = selectedView;
    const result = remove(id);
    if (!result.ok) {
      showToast("Couldn't delete this view on this device", "error");
      return;
    }
    setSelectedId("");
    showToast(`Deleted "${name}"`);
  }

  return (
    <div role="group" aria-label="Saved views" className="mt-3 flex flex-wrap items-end gap-2">
      {views.length > 0 && mode === "idle" && (
        <>
          <div>
            <label htmlFor={selectId} className="text-text-secondary sr-only">
              Saved views
            </label>
            <Select
              id={selectId}
              value={effectiveSelectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-0 w-44 py-1.5 text-sm"
            >
              {views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </Select>
          </div>

          {selectedView && (
            <Link href={buildApplyHref(selectedView.params)} className={PRIMARY_LINK_CLASSES}>
              Apply
            </Link>
          )}

          <button
            type="button"
            onClick={openRenameForm}
            disabled={!selectedView}
            // An explicit aria-label distinct from the plain visible
            // "Rename" text -- this trigger and ConfirmDialog's own
            // generic "Cancel"/"Delete" buttons below both live inside
            // this same `role="group"`, so a bare accessible name of
            // "Rename"/"Delete" alone wouldn't disambiguate the trigger
            // from the dialog's own controls once it's open.
            aria-label="Rename saved view"
            className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => deleteDialogRef.current?.open()}
            disabled={!selectedView}
            aria-label="Delete saved view"
            className="text-danger focus-visible:ring-danger rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete
          </button>
        </>
      )}

      {mode === "idle" && (
        <button
          type="button"
          onClick={openSaveForm}
          className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2"
        >
          Save current view
        </button>
      )}

      {mode === "saving" && (
        <form onSubmit={handleSaveSubmit} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={saveInputId} className="text-text-secondary block text-xs font-medium">
              View name
            </label>
            <Input
              id={saveInputId}
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              maxLength={SAVED_VIEW_NAME_MAX_LENGTH}
              autoFocus
              className="text-sm"
              aria-invalid={formError ? "true" : undefined}
            />
          </div>
          <Button type="submit" disabled={!nameInputIsValid} className="px-3 py-1.5 text-xs">
            Save
          </Button>
          <button type="button" onClick={closeForm} aria-label="Cancel saved view form" className="text-text-secondary hover:text-text-primary text-xs font-medium">
            Cancel
          </button>
          {formError && (
            <p role="alert" className="text-danger text-xs">
              {formError}
            </p>
          )}
        </form>
      )}

      {mode === "renaming" && selectedView && (
        <form onSubmit={handleRenameSubmit} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={renameInputId} className="text-text-secondary block text-xs font-medium">
              View name
            </label>
            <Input
              id={renameInputId}
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              maxLength={SAVED_VIEW_NAME_MAX_LENGTH}
              autoFocus
              className="text-sm"
              aria-invalid={formError ? "true" : undefined}
            />
          </div>
          <Button type="submit" disabled={!nameInputIsValid} className="px-3 py-1.5 text-xs">
            Save
          </Button>
          <button type="button" onClick={closeForm} aria-label="Cancel saved view form" className="text-text-secondary hover:text-text-primary text-xs font-medium">
            Cancel
          </button>
          {formError && (
            <p role="alert" className="text-danger text-xs">
              {formError}
            </p>
          )}
        </form>
      )}

      {atLimit && mode === "idle" && (
        <p className="text-text-muted text-xs">{SAVED_VIEWS_MAX_PER_SCOPE} saved views is the limit for this list.</p>
      )}

      <ConfirmDialog
        ref={deleteDialogRef}
        title="Delete saved view"
        description={
          selectedView
            ? `Delete "${selectedView.name}"? This only removes it from your browser on this device — nothing else changes.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}

function saveErrorMessage(reason: "invalid-name" | "limit-reached" | "write-failed"): string {
  switch (reason) {
    case "invalid-name":
      return `Enter a name up to ${SAVED_VIEW_NAME_MAX_LENGTH} characters.`;
    case "limit-reached":
      return `You already have ${SAVED_VIEWS_MAX_PER_SCOPE} saved views for this list — delete one before saving another.`;
    case "write-failed":
      return "Couldn't save this view on this device — your filters are unaffected.";
  }
}
