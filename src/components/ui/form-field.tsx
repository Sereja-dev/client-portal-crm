import { ReactNode } from "react";
import { XCircleIcon } from "@/components/ui/icons";

export function FormLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-text-secondary block text-sm font-medium">
      {children}
      {required && (
        <span className="text-danger ml-0.5" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

/**
 * Forms Helper-Text Accessibility remediation — before this prop
 * existed, every field that wanted explanatory copy below its control
 * rendered its own ad-hoc `<p className="text-text-muted mt-1 text-xs">`
 * directly as a sibling of `children`, with no `id` at all — so nothing
 * in the control's own `aria-describedby` could ever reference it.
 * Sighted users could see the text; a screen-reader user tabbing to the
 * control never heard it. `description` fixes that at the one place
 * every field in every form already shares: `FormField` itself now owns
 * rendering that paragraph, with a stable, predictable
 * `${htmlFor}-description` id, in the exact same visual position and
 * with the exact same classes the ad-hoc copies already used — nothing
 * about how the page looks changes.
 *
 * `FormField` cannot inject that id into `children` itself (the control
 * is already-constructed JSX by the time it arrives here, and cloning
 * it to patch in a prop is exactly the kind of invasive rewrite this
 * repair avoids) — so the caller still passes its own control's
 * `aria-describedby` explicitly, same as every field already does for
 * the error id below. `describedByIds` (this module's other new export)
 * is the one shared place that composition logic lives, so no call site
 * needs its own bespoke ternary for it.
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  error,
  description,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <FormLabel htmlFor={htmlFor} required={required}>
        {label}
      </FormLabel>
      {children}
      {description && <p id={`${htmlFor}-description`} className="text-text-muted mt-1 text-xs">{description}</p>}
      {error && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-danger mt-1 flex items-start gap-1 text-sm font-semibold"
        >
          {/*
            Sky-Blue/Grayscale Theme Redesign V1 — Light's --danger is now
            literal black, identical to ordinary body text color-wise, so
            this message needs a non-color cue of its own (not just
            StatusBadge's): a leading icon plus bold weight, matching the
            same vocabulary StatusBadge's own danger tone now uses.
          */}
          <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Forms Helper-Text Accessibility remediation — the one shared
 * `aria-describedby` composer every migrated field uses instead of its
 * own bespoke ternary. Accepts whatever ids currently apply (a
 * conditional description's own id only when that description is
 * actually rendered this render, an error id only when `fieldErrors.x`
 * is currently set) and drops every falsy entry before joining — never
 * a dangling reference to a paragraph that isn't in the DOM, never an
 * empty `aria-describedby=""` when nothing applies.
 */
export function describedByIds(...ids: (string | null | undefined | false)[]): string | undefined {
  const joined = ids.filter((id): id is string => Boolean(id)).join(" ");
  return joined.length > 0 ? joined : undefined;
}

/**
 * Sky-Blue/Grayscale Theme Redesign V1 (correction pass) — the one
 * shared renderer for a standalone `role="alert"` error message that is
 * NOT wrapped in `FormField` (a form's own top-level submission error,
 * e.g. `{state.error && <p role="alert" className="text-danger text-sm">
 * {state.error}</p>}`). Every one of those call sites was safe while
 * Light's --danger was a dedicated red; it is now literal black, the
 * same color as an ordinary heading or typed input value, so the
 * message needs the same non-color cue `FormField`'s own per-field
 * error already carries: a leading icon plus bold weight. `className`
 * is for the caller's own pre-existing spacing/size classes only
 * (`mt-1`, `mb-3`, `text-xs`, etc. — whatever it already had besides
 * `text-danger`, which this component always owns itself).
 */
export function FormErrorMessage({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} role="alert" className={`text-danger flex items-start gap-1 font-semibold ${className}`.trim()}>
      <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
