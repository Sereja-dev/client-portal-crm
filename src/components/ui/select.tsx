import type { ComponentProps } from "react";
import { formControlClasses } from "@/components/ui/form-control-classes";

/**
 * `ComponentProps<"select">` (not `SelectHTMLAttributes<HTMLSelectElement>`)
 * — the former includes `ref` in its type (React 19 accepts `ref` as a
 * plain prop on function components, no `forwardRef` needed), which the
 * latter doesn't. Needed by recovery-phone-settings.tsx's own country-
 * selector fix (see that file's own doc comment) to imperatively
 * re-assert the select's value after a native `form.reset()`.
 */
export function Select({
  className = "",
  "aria-invalid": ariaInvalid,
  ...props
}: ComponentProps<"select">) {
  const invalid = ariaInvalid === true || ariaInvalid === "true";
  return (
    <select
      aria-invalid={ariaInvalid}
      className={`${formControlClasses(invalid)} ${className}`}
      {...props}
    />
  );
}
