"use client";

import { useActionState, useId, useRef, useState } from "react";
import { useToast } from "@/components/toast/toast-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOM_FIELD_LABEL_MAX_LENGTH } from "@/lib/validation/custom-field";
import type { CustomFieldOptionFormState } from "@/types";

export type OptionRow = {
  id: string;
  label: string;
  archivedAt: Date | null;
  renameAction: (
    prevState: CustomFieldOptionFormState,
    formData: FormData,
  ) => Promise<CustomFieldOptionFormState>;
  archiveAction: () => Promise<void>;
  unarchiveAction: () => Promise<void>;
  moveUpAction: () => Promise<void>;
  moveDownAction: () => Promise<void>;
};

const initialFormState: CustomFieldOptionFormState = { error: null };

/**
 * Custom Fields Phase 2A (Section J/K) — SELECT option management,
 * embedded inside EditDefinitionDialog for a SELECT definition. Active
 * options first (position order), then an optional "Show archived"
 * toggle — same shape as ContactsList's own archived-toggle (Section
 * O's "optionally visible via Show archived"). Renaming an option is an
 * inline text-input swap within the row (no nested dialog inside the
 * already-open Edit dialog — two stacked native <dialog> backdrops would
 * be confusing UX for what's really a one-field edit).
 *
 * `value` (the option's own stable machine identity) is never shown or
 * editable here at all — Section J: "do not expose editable machine
 * value by default." Renaming only ever touches `label`.
 */
export function OptionManager({
  options,
  addOptionAction,
}: {
  options: OptionRow[];
  addOptionAction: (
    prevState: CustomFieldOptionFormState,
    formData: FormData,
  ) => Promise<CustomFieldOptionFormState>;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const activeOptions = options.filter((o) => o.archivedAt === null);
  const archivedOptions = options.filter((o) => o.archivedAt !== null);
  const visibleOptions = showArchived ? archivedOptions : activeOptions;

  return (
    <div className="border-border-default mt-2 rounded-md border">
      <div className="border-border-default flex items-center justify-between border-b px-3 py-2">
        <p className="text-text-secondary text-xs font-medium">Options</p>
        {(archivedOptions.length > 0 || showArchived) && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-xs font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {showArchived ? "Show active" : `Show archived (${archivedOptions.length})`}
          </button>
        )}
      </div>

      {visibleOptions.length === 0 ? (
        <p className="text-text-muted px-3 py-3 text-xs">
          {showArchived ? "No archived options." : "No options yet — add one below."}
        </p>
      ) : (
        <ul className="divide-border-subtle divide-y">
          {visibleOptions.map((option, index) => (
            <OptionListItem
              key={option.id}
              option={option}
              isFirst={index === 0}
              isLast={index === visibleOptions.length - 1}
              showMoveControls={!showArchived}
            />
          ))}
        </ul>
      )}

      {!showArchived && (
        <div className="px-3 py-2">
          <AddOptionForm action={addOptionAction} />
        </div>
      )}
    </div>
  );
}

function OptionListItem({
  option,
  isFirst,
  isLast,
  showMoveControls,
}: {
  option: OptionRow;
  isFirst: boolean;
  isLast: boolean;
  showMoveControls: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleArchiveToggle() {
    setPending(true);
    try {
      if (option.archivedAt === null) {
        await option.archiveAction();
        showToast(`${option.label} archived`);
      } else {
        await option.unarchiveAction();
        showToast(`${option.label} restored`);
      }
    } catch {
      showToast(`Failed to update ${option.label}.`, "error");
    } finally {
      setPending(false);
    }
  }

  async function handleMove(action: () => Promise<void>) {
    setPending(true);
    try {
      await action();
    } catch {
      showToast(`Failed to move ${option.label}.`, "error");
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <li className="px-3 py-2">
        <RenameOptionForm option={option} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="text-text-primary min-w-0 truncate text-sm">{option.label}</span>
      <span className="flex shrink-0 items-center gap-3">
        {showMoveControls && (
          <span className="inline-flex items-center gap-0.5">
            <button
              type="button"
              disabled={isFirst || pending}
              onClick={() => handleMove(option.moveUpAction)}
              aria-label={`Move ${option.label} up`}
              className="text-text-secondary hover:text-text-primary rounded px-1 text-xs transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={isLast || pending}
              onClick={() => handleMove(option.moveDownAction)}
              aria-label={`Move ${option.label} down`}
              className="text-text-secondary hover:text-text-primary rounded px-1 text-xs transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↓
            </button>
          </span>
        )}
        {option.archivedAt === null ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(true)}
              className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-xs font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={handleArchiveToggle}
              className="text-danger focus-visible:ring-danger rounded text-xs font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Archive
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={handleArchiveToggle}
            className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-xs font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Unarchive
          </button>
        )}
      </span>
    </li>
  );
}

function RenameOptionForm({ option, onDone }: { option: OptionRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(async (prevState: CustomFieldOptionFormState, formData: FormData) => {
    const result = await option.renameAction(prevState, formData);
    if (result.error === null && !result.fieldErrors) {
      onDone();
    }
    return result;
  }, initialFormState);
  const uid = useId();
  const inputId = `${uid}-rename`;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        Option label
      </label>
      <Input
        id={inputId}
        name="label"
        defaultValue={option.label}
        required
        maxLength={CUSTOM_FIELD_LABEL_MAX_LENGTH}
        aria-invalid={!!state.fieldErrors?.label}
        className="text-sm"
        autoFocus
      />
      <Button type="submit" loading={pending} className="shrink-0 px-3 py-1.5 text-xs">
        Save
      </Button>
      <button
        type="button"
        onClick={onDone}
        className="text-text-secondary hover:text-text-primary shrink-0 text-xs font-medium"
      >
        Cancel
      </button>
      {state.fieldErrors?.label && (
        <p role="alert" className="text-danger text-xs">
          {state.fieldErrors.label}
        </p>
      )}
    </form>
  );
}

function AddOptionForm({
  action,
}: {
  action: (
    prevState: CustomFieldOptionFormState,
    formData: FormData,
  ) => Promise<CustomFieldOptionFormState>;
}) {
  const [state, formAction, pending] = useActionState(async (prevState: CustomFieldOptionFormState, formData: FormData) => {
    const result = await action(prevState, formData);
    if (result.error === null && !result.fieldErrors && formRef.current) {
      formRef.current.reset();
    }
    return result;
  }, initialFormState);
  const uid = useId();
  const inputId = `${uid}-add-option`;
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        New option label
      </label>
      <Input
        id={inputId}
        name="label"
        placeholder="Add option…"
        required
        maxLength={CUSTOM_FIELD_LABEL_MAX_LENGTH}
        aria-invalid={!!state.fieldErrors?.label}
        className="text-sm"
      />
      <Button type="submit" variant="secondary" loading={pending} className="shrink-0 px-3 py-1.5 text-xs">
        Add
      </Button>
      {state.fieldErrors?.label && (
        <p role="alert" className="text-danger text-xs">
          {state.fieldErrors.label}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-danger text-xs">
          {state.error}
        </p>
      )}
    </form>
  );
}
