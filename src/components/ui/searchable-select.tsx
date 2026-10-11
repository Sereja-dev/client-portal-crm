"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formControlClasses } from "@/components/ui/form-control-classes";

export type SearchableSelectOption = { value: string; label: string };

/**
 * The exact matching rule this primitive's own typing-to-filter uses —
 * exported so a caller-specific layer (or a focused unit test) can assert
 * on it directly without needing a real DOM/jsdom to drive a text input.
 * Deterministic, client-side, case-insensitive substring matching against
 * both `value` and `label` — a blank query matches everything.
 */
export function matchesSearchableOption(option: SearchableSelectOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return option.value.toLowerCase().includes(q) || option.label.toLowerCase().includes(q);
}

/**
 * Forms Improvement Slice A1 — the one shared, dependency-free accessible
 * combobox primitive this slice introduces (no Radix/Headless UI/cmdk/
 * downshift/react-select is installed in this repo — confirmed via a
 * package.json inspection before writing this file; nothing is added
 * here). Deliberately NOT a general headless-component API: this knows
 * nothing about currencies, financial data, or any particular form — it
 * only knows about a flat `{ value, label }[]` option list, a selected
 * value, search text, and keyboard/pointer selection. Domain-specific
 * option sourcing/ordering (e.g. popular currencies first) belongs one
 * layer up, in a caller-specific wrapper (see
 * src/components/invoices/currency-select.tsx), never inside this file.
 *
 * Supports BOTH of this codebase's existing two calling conventions for a
 * form control, matching Input/Select/Textarea's own established dual
 * mode:
 *   - controlled: pass `value` + `onChange` (Invoice/Recurring Invoice/
 *     Quote forms already hold the current currency in React state).
 *   - uncontrolled: pass `defaultValue` only (Company Settings' own
 *     existing `key={fieldDefault(...)}` remount-on-change pattern,
 *     preserved verbatim at the call site — this component just needs to
 *     own its own internal state like a plain `<input defaultValue>`
 *     would, so that same remount trick keeps working unchanged).
 *
 * Submission compatibility (Forms Improvement Slice A1 §6): when `name`
 * is passed, a `type="hidden"` input carries that exact name/value so an
 * existing `FormData`-based Server Action keeps receiving
 * `formData.get(name)` unchanged — the visible, user-facing text input
 * here is never itself named, so there is never a duplicate/conflicting
 * `name` on the form. Omit `name` entirely for a caller that reads
 * `value`/`onChange` directly instead of FormData (e.g. QuoteForm, which
 * builds its own typed payload rather than submitting a native form).
 *
 * Accessibility: the ARIA 1.2 "select-only" combobox pattern — a single
 * text input (`role="combobox"`, `aria-expanded`, `aria-controls`,
 * `aria-autocomplete="list"`, `aria-activedescendant`) paired with a
 * `role="listbox"` popup of `role="option"` items. Real DOM focus never
 * leaves the input (Tab therefore can never get trapped inside the
 * popup); Arrow Up/Down move a *virtual* highlight via
 * `aria-activedescendant`, Enter commits the highlighted option, Escape
 * closes without committing, and clicking/tapping an option (via
 * `onMouseDown` + `preventDefault`, not `onClick` — see the inline
 * comment on why) commits it without the input ever losing focus first.
 * Typing filters the option list by whatever `matches` the caller
 * supplies; a value can only ever become selected through an explicit
 * Enter/click on a real option — free-typed text alone never commits
 * (so an unsupported value can never slip into the field this way).
 */
export function SearchableSelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  options,
  disabled = false,
  required = false,
  placeholder = "Search…",
  emptyMessage = "No matches",
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  /** Present only for a caller that submits this field via native FormData — see this module's own header comment. */
  name?: string;
  /** Controlled mode — mutually exclusive with `defaultValue`; pair with `onChange`. */
  value?: string;
  /** Uncontrolled mode — mirrors `<input defaultValue>`/`<select defaultValue>`; pair with a remount `key` at the call site if the effective default can change later (see Company Settings' own existing pattern). */
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: readonly SearchableSelectOption[];
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = isControlled ? (value ?? "") : internalValue;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `${id}-listbox`;

  const selected = options.find((option) => option.value === currentValue) ?? null;

  const filtered = useMemo(
    () => options.filter((option) => matchesSearchableOption(option, query)),
    [options, query],
  );

  // Closes on a click/tap anywhere outside this widget that never moves
  // real focus (e.g. a tap on a non-focusable page area) — the `onBlur`
  // handler below alone doesn't cover that case, since blur only fires
  // when focus actually moves to another element.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function commit(nextValue: string) {
    if (!isControlled) setInternalValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function openList() {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(filtered.findIndex((option) => option.value === currentValue));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (filtered.length === 0 ? -1 : Math.min(index + 1, filtered.length - 1)));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => (filtered.length === 0 ? -1 : Math.max(index - 1, 0)));
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          commit(filtered[activeIndex].value);
        }
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        setQuery("");
        break;
      default:
        break;
    }
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    // Only close when focus is actually leaving the whole widget — a
    // focus move between the input and (hypothetically) another element
    // inside this same root must never close it.
    if (rootRef.current && event.relatedTarget && rootRef.current.contains(event.relatedTarget as Node)) {
      return;
    }
    setOpen(false);
    setQuery("");
  }

  const invalid = ariaInvalid === true || ariaInvalid === "true";
  const displayValue = open ? query : (selected?.label ?? "");
  const activeOption = activeIndex >= 0 && activeIndex < filtered.length ? filtered[activeIndex] : undefined;
  // No native <select> here means no disabled "— Select a currency —"
  // placeholder <option> either (the old control's own way of guiding a
  // genuinely-empty field, e.g. an organization with no Company Profile
  // row saved yet — see getCompanyProfile()'s own `currency: null`
  // fallback). The HTML `placeholder` attribute only ever shows through
  // when the field's own value is the empty string, so reusing the same
  // `placeholder` text for both the open-search hint and this closed-
  // empty state is safe and never shadows a real selected value.
  const showPlaceholder = displayValue === "";

  return (
    <div ref={rootRef} className="relative" onBlur={handleBlur}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${id}-option-${activeOption.value}` : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={showPlaceholder ? placeholder : undefined}
        className={formControlClasses(invalid)}
        value={displayValue}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {name && <input type="hidden" name={name} value={currentValue} />}
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={placeholder}
          className="border-border-strong bg-surface absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border py-1 text-sm shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="text-text-muted px-3 py-2">{emptyMessage}</li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-option-${option.value}`}
                role="option"
                aria-selected={option.value === currentValue}
                className={`cursor-pointer px-3 py-2 ${
                  index === activeIndex ? "bg-accent text-white" : "text-text-primary hover:bg-surface-muted"
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  // mousedown (not click): fires before this input would
                  // otherwise blur-and-close the popup, so the commit
                  // always happens — see this module's own header comment.
                  event.preventDefault();
                  commit(option.value);
                }}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
