import { describe, expect, it } from "vitest";
import { formControlClasses } from "@/components/ui/form-control-classes";

/**
 * Accessibility Improvement A3+A5 — a direct class-contract test for the
 * one shared builder Input/Select/Textarea/SearchableSelect all call.
 * Asserts class *presence/absence* (word-boundary matches) rather than
 * full-string equality, so this stays resilient to future additive
 * class reordering and only fails if one of the specific guarantees
 * below actually regresses.
 */

function hasClass(classString: string, className: string): boolean {
  return new RegExp(`(^|\\s)${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(classString);
}

describe("formControlClasses()", () => {
  describe("valid (invalid=false)", () => {
    const classes = formControlClasses(false);

    it("uses the dedicated --border-form-control resting border, not --border-strong", () => {
      expect(hasClass(classes, "border-border-form-control")).toBe(true);
      expect(hasClass(classes, "border-border-strong")).toBe(false);
    });

    it("gates both the ring and the border-color swap on focus-visible:, never a mixed focus:/focus-visible: pair", () => {
      expect(hasClass(classes, "focus-visible:ring-2")).toBe(true);
      expect(hasClass(classes, "focus-visible:ring-offset-2")).toBe(true);
      expect(hasClass(classes, "focus-visible:border-accent")).toBe(true);
      expect(hasClass(classes, "focus-visible:ring-accent")).toBe(true);

      expect(hasClass(classes, "focus:ring-1")).toBe(false);
      expect(hasClass(classes, "focus:border-accent")).toBe(false);
      expect(hasClass(classes, "focus:ring-accent")).toBe(false);
    });

    it("never carries the invalid (danger) branch's classes", () => {
      expect(hasClass(classes, "border-danger")).toBe(false);
      expect(hasClass(classes, "focus-visible:border-danger")).toBe(false);
      expect(hasClass(classes, "focus-visible:ring-danger")).toBe(false);
    });
  });

  describe("invalid (invalid=true)", () => {
    const classes = formControlClasses(true);

    it("uses the danger border, and gates both the ring and border-color swap on focus-visible:", () => {
      expect(hasClass(classes, "border-danger")).toBe(true);
      expect(hasClass(classes, "focus-visible:border-danger")).toBe(true);
      expect(hasClass(classes, "focus-visible:ring-danger")).toBe(true);

      expect(hasClass(classes, "focus:border-danger")).toBe(false);
      expect(hasClass(classes, "focus:ring-danger")).toBe(false);
    });

    it("never carries the valid branch's resting border or accent focus classes", () => {
      expect(hasClass(classes, "border-border-form-control")).toBe(false);
      expect(hasClass(classes, "border-border-strong")).toBe(false);
      expect(hasClass(classes, "focus-visible:border-accent")).toBe(false);
      expect(hasClass(classes, "focus-visible:ring-accent")).toBe(false);
    });
  });

  describe("preserved, untouched by this slice", () => {
    const classes = formControlClasses(false);
    const preserved = [
      "mt-1",
      "block",
      "w-full",
      "rounded-md",
      "bg-surface",
      "px-3",
      "py-2",
      "text-sm",
      "text-text-primary",
      "shadow-sm",
      "placeholder:text-text-muted",
      "disabled:cursor-not-allowed",
      "disabled:bg-surface-muted",
    ];

    it.each(preserved)("still includes %s", (className) => {
      expect(hasClass(classes, className)).toBe(true);
    });

    it("still includes the disabled text color (arbitrary-value class, checked as a literal substring)", () => {
      expect(classes).toContain("disabled:text-[var(--disabled)]");
    });

    it("never reintroduces a bare focus:outline class removal — focus:outline-none stays, it is not itself part of this slice's change", () => {
      expect(hasClass(classes, "focus:outline-none")).toBe(true);
    });
  });
});
