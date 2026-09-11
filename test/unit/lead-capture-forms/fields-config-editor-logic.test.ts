import { describe, expect, it } from "vitest";
import {
  toFieldRows,
  applyVisibilityChange,
  applyRequiredChange,
  applyLabelChange,
  moveFieldRow,
  serializeFieldRows,
} from "@/components/lead-capture-forms/fields-config-editor-logic";
import { defaultLeadCaptureFormFieldsConfig } from "@/lib/lead-capture-forms/fields";

/**
 * Public Lead Capture Forms Phase 2A — FieldsConfigEditor's own pure
 * state-transition logic (Test items 5, 6, 7, 8). This repo has no DOM/
 * component-interaction test harness (see fields-config-editor-logic.ts's
 * own doc comment), so these are exercised directly as plain functions
 * rather than via simulated clicks/changes on a rendered component.
 */

describe("toFieldRows", () => {
  it("orders rows by each field's own stored order", () => {
    const config = defaultLeadCaptureFormFieldsConfig();
    const rows = toFieldRows(config);
    expect(rows.map((r) => r.key)).toEqual(["name", "company", "email", "phone", "message"]);
  });
});

describe("5. applyVisibilityChange — Staff can change field visibility", () => {
  it("toggles visible for exactly the targeted row", () => {
    const rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    const next = applyVisibilityChange(rows, 1, false); // company
    expect(next[1].visible).toBe(false);
    expect(next[0].visible).toBe(true); // name untouched
    expect(next[2].visible).toBe(true); // email untouched
  });
});

describe("6. applyRequiredChange — Staff can change required flags", () => {
  it("toggles required for exactly the targeted row", () => {
    const rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    const next = applyRequiredChange(rows, 2, true); // email
    expect(next[2].required).toBe(true);
    expect(next[1].required).toBe(false); // company untouched
  });
});

describe("7. hidden + required invalid state is rejected (prevented client-side)", () => {
  it("turning Visible off also clears Required in the same update", () => {
    const rows = applyRequiredChange(toFieldRows(defaultLeadCaptureFormFieldsConfig()), 2, true); // email required
    expect(rows[2]).toMatchObject({ visible: true, required: true });

    const next = applyVisibilityChange(rows, 2, false);
    expect(next[2]).toMatchObject({ visible: false, required: false });
  });

  it("turning Visible back on does not silently re-require the field", () => {
    let rows = applyRequiredChange(toFieldRows(defaultLeadCaptureFormFieldsConfig()), 2, true);
    rows = applyVisibilityChange(rows, 2, false);
    rows = applyVisibilityChange(rows, 2, true);
    expect(rows[2]).toMatchObject({ visible: true, required: false });
  });

  it("serializeFieldRows can never produce a hidden+required entry after only using applyVisibilityChange/applyRequiredChange", () => {
    let rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    rows = applyRequiredChange(rows, 3, true); // phone required
    rows = applyVisibilityChange(rows, 3, false); // then hidden
    const serialized = serializeFieldRows(rows);
    expect(serialized.phone).toEqual({ visible: false, required: false, order: 3, label: null });
  });
});

describe("8. moveFieldRow — Staff can reorder fields", () => {
  it("swaps two adjacent rows on move up/down", () => {
    const rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    const movedUp = moveFieldRow(rows, 2, "up"); // email up, swaps with company
    expect(movedUp.map((r) => r.key)).toEqual(["name", "email", "company", "phone", "message"]);

    const movedDown = moveFieldRow(rows, 1, "down"); // company down, swaps with email
    expect(movedDown.map((r) => r.key)).toEqual(["name", "email", "company", "phone", "message"]);
  });

  it("is a no-op past either end", () => {
    const rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    expect(moveFieldRow(rows, 0, "up")).toBe(rows);
    expect(moveFieldRow(rows, rows.length - 1, "down")).toBe(rows);
  });

  it("serializeFieldRows reflects the new order after a move", () => {
    const rows = moveFieldRow(toFieldRows(defaultLeadCaptureFormFieldsConfig()), 4, "up"); // message up, swaps with phone
    const serialized = serializeFieldRows(rows);
    expect(serialized.message.order).toBe(3);
    expect(serialized.phone.order).toBe(4);
  });
});

describe("applyLabelChange", () => {
  it("updates only the targeted row's label", () => {
    const rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    const next = applyLabelChange(rows, 2, "Work email");
    expect(next[2].label).toBe("Work email");
    expect(next[1].label).toBe("");
  });
});

describe("serializeFieldRows", () => {
  it("serializes a blank label as null (use the default label)", () => {
    const rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    const serialized = serializeFieldRows(rows);
    expect(serialized.name.label).toBeNull();
  });

  it("trims a label before serializing, and blank-after-trim also becomes null", () => {
    let rows = toFieldRows(defaultLeadCaptureFormFieldsConfig());
    rows = applyLabelChange(rows, 2, "  Work email  ");
    expect(serializeFieldRows(rows).email.label).toBe("Work email");

    rows = applyLabelChange(rows, 2, "   ");
    expect(serializeFieldRows(rows).email.label).toBeNull();
  });
});
