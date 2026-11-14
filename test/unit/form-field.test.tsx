import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormField, FormErrorMessage, describedByIds } from "@/components/ui/form-field";

/**
 * Forms Helper-Text Accessibility remediation — real-render coverage for
 * `FormField`'s new optional `description` support and the shared
 * `describedByIds` composer every migrated field (and the future Quote
 * Valid-until helper) uses instead of its own bespoke
 * `aria-describedby` ternary.
 */
describe("FormField — description support", () => {
  it("renders a description paragraph with a stable id and the exact existing helper-text classes", () => {
    const html = renderToStaticMarkup(
      <FormField label="Due date offset (days)" htmlFor="dueDateOffsetDays" description="Leave blank for no due date.">
        <input id="dueDateOffsetDays" />
      </FormField>,
    );
    expect(html).toContain('id="dueDateOffsetDays-description"');
    expect(html).toContain('class="text-text-muted mt-1 text-xs"');
    expect(html).toContain("Leave blank for no due date.");
  });

  it("renders no description paragraph at all when description is absent", () => {
    const html = renderToStaticMarkup(
      <FormField label="Currency" htmlFor="currency">
        <input id="currency" />
      </FormField>,
    );
    expect(html).not.toContain("-description");
  });

  it("renders no description paragraph when description is explicitly undefined (the conditional-helper-absent case)", () => {
    const html = renderToStaticMarkup(
      <FormField label="Frequency" htmlFor="frequency" description={undefined}>
        <input id="frequency" />
      </FormField>,
    );
    expect(html).not.toContain("-description");
  });
});

describe("FormField — existing behavior is unchanged", () => {
  it("still renders the label, the required marker, and the control exactly as before", () => {
    const html = renderToStaticMarkup(
      <FormField label="Legal company name" htmlFor="legalName" required>
        <input id="legalName" />
      </FormField>,
    );
    expect(html).toContain("Legal company name");
    expect(html).toContain('for="legalName"');
    expect(html).toContain("*"); // required marker
    expect(html).toContain('id="legalName"');
  });

  it("still renders the error paragraph with its own existing id and role, in the same position relative to description", () => {
    const html = renderToStaticMarkup(
      <FormField label="Tax rate (%)" htmlFor="taxRatePercent" error="Enter a tax rate between 0 and 100." description="Some helper.">
        <input id="taxRatePercent" />
      </FormField>,
    );
    expect(html).toContain('id="taxRatePercent-error"');
    expect(html).toContain('role="alert"');
    // Sky-Blue/Grayscale Theme Redesign V1 — Light's --danger is now
    // literal black, the same value as --accent, so the error paragraph
    // gained a non-color cue (an XCircleIcon) and bold weight to stay
    // distinguishable from ordinary text, per the owner's "do not convey
    // state through color alone" instruction. The class list grew
    // accordingly (flex layout + font-semibold) alongside the icon.
    expect(html).toContain('class="text-danger mt-1 flex items-start gap-1 text-sm font-semibold"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("<span>Enter a tax rate between 0 and 100.</span>");

    // Description renders before the error paragraph, matching every
    // existing ad-hoc helper's own established placement.
    const descriptionIndex = html.indexOf("taxRatePercent-description");
    const errorIndex = html.indexOf("taxRatePercent-error");
    expect(descriptionIndex).toBeGreaterThan(-1);
    expect(descriptionIndex).toBeLessThan(errorIndex);
  });

  it("renders no error paragraph when error is absent, same as before this change", () => {
    const html = renderToStaticMarkup(
      <FormField label="Notes" htmlFor="notes">
        <input id="notes" />
      </FormField>,
    );
    expect(html).not.toContain("-error");
  });
});

describe("FormErrorMessage — the shared standalone top-level error renderer", () => {
  it("renders role=alert, the icon, and the message, with the caller's own classes appended after the owned color/layout classes", () => {
    const html = renderToStaticMarkup(
      <FormErrorMessage className="mt-1 text-sm">Something went wrong.</FormErrorMessage>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("<span>Something went wrong.</span>");
    // Word-boundary presence, not full-string equality (matches this
    // repo's own established pattern in form-control-classes.test.ts) —
    // resilient to future class reordering.
    for (const expected of ["text-danger", "flex", "items-start", "gap-1", "font-semibold", "mt-1", "text-sm"]) {
      expect(html).toMatch(new RegExp(`(^|"|\\s)${expected}(\\s|")`));
    }
  });

  it("renders no id attribute when none is passed", () => {
    const html = renderToStaticMarkup(<FormErrorMessage>Required.</FormErrorMessage>);
    expect(html).not.toContain(" id=");
  });

  it("renders the given id exactly, for a caller whose control's aria-describedby references it", () => {
    const html = renderToStaticMarkup(<FormErrorMessage id="email-error">Invalid email.</FormErrorMessage>);
    expect(html).toContain('id="email-error"');
  });
});

describe("describedByIds", () => {
  it("returns the single id when only a description applies", () => {
    expect(describedByIds("field-description", undefined)).toBe("field-description");
  });

  it("returns both ids, description first, space-separated, when both apply", () => {
    expect(describedByIds("field-description", "field-error")).toBe("field-description field-error");
  });

  it("returns only the error id when the description is conditionally absent", () => {
    expect(describedByIds(undefined, "field-error")).toBe("field-error");
  });

  it("returns undefined when neither applies", () => {
    expect(describedByIds(undefined, undefined)).toBeUndefined();
  });

  it("treats a false value (a falsy conditional expression) the same as undefined", () => {
    expect(describedByIds(false, "field-error")).toBe("field-error");
    expect(describedByIds(false, false)).toBeUndefined();
  });
});
