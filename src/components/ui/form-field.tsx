import { ReactNode } from "react";

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
          className="text-danger mt-1 text-sm"
        >
          {error}
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
