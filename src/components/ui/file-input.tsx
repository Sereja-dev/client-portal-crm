"use client";

import { useEffect, useRef, useState, type ChangeEvent, type AriaAttributes } from "react";

/**
 * Product UI/UX PR 1 — a reusable, app-authored, accessible file picker.
 * Replaces the two production `<input type="file">` usages
 * (AttachmentUploadForm, LogoUploadForm) that previously relied on the
 * browser's own native trigger/placeholder text — on Safari/macOS that
 * text is localized to the OS locale (e.g. Russian), so it could appear
 * inside an otherwise all-English product. This component renders every
 * user-visible string itself, in React, so it is never subject to host
 * locale.
 *
 * Pattern: a real native `<input type="file">`, visually hidden via the
 * established `sr-only` convention (never `display:none`, never
 * `aria-hidden` — it stays focusable and in the accessibility tree),
 * paired with a real `<label htmlFor>` styled to look like the app's
 * existing secondary-button surface. A `<label htmlFor>` associated with
 * an input is natively clickable/keyboard-activatable with no JS handler
 * of its own — clicking or Enter/Space-activating the label opens the
 * real native file dialog, and the label's own text becomes the input's
 * accessible name. The label is never itself a second interactive element
 * (no nested `<button>`) — exactly one tab stop (the native input) exists.
 *
 * Tailwind's `peer`/`peer-focus-visible:` variants apply this app's
 * standard `focus-visible:ring-2 ring-black` treatment to the visible
 * label the moment the native input receives real keyboard focus — no
 * `onFocus`/`onBlur` state needed.
 *
 * The selected filename (or the "No file chosen" empty state) is rendered
 * entirely by React from `input.files[0].name` into an `aria-live="polite"`
 * region, so a screen reader announces a selection change and a sighted
 * user sees an app-authored string, never native chrome.
 *
 * Uncontrolled by design: this component never reads or writes the native
 * input's `value` — the browser owns the real FileList, exactly like the
 * two callers' own pre-existing `useActionState`/FormData submission
 * already assumed. A native `reset` event on the owning `<form>` (fired by
 * both a real reset control and a programmatic `formRef.current?.reset()`
 * call, e.g. AttachmentUploadForm's own post-success effect) is listened
 * for directly so the displayed filename returns to the empty state in
 * lockstep with the browser's own FileList clearing — React never
 * receives a change event for a native form reset, so without this
 * listener the two would silently drift apart.
 */
export type FileInputProps = {
  id: string;
  name: string;
  /** Visible, app-authored trigger text — e.g. "Choose file", "Choose logo". Also becomes the native input's accessible name via the associated <label>. */
  triggerLabel: string;
  /** App-authored empty-state text, shown until a file is selected. */
  emptyLabel?: string;
  accept?: string;
  required?: boolean;
  disabled?: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
  "aria-describedby"?: string;
};

export function FileInput({
  id,
  name,
  triggerLabel,
  emptyLabel = "No file chosen",
  accept,
  required = false,
  disabled = false,
  onChange,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: FileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const handleReset = () => setFileName(null);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, []);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setFileName(event.target.files?.[0]?.name ?? null);
    onChange?.(event);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        id={id}
        type="file"
        name={name}
        accept={accept}
        required={required}
        disabled={disabled}
        onChange={handleChange}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={`inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-black peer-focus-visible:ring-offset-2 ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-50"
        }`}
      >
        {triggerLabel}
      </label>
      <span aria-live="polite" className="text-sm text-gray-600">
        {fileName ?? emptyLabel}
      </span>
    </div>
  );
}
