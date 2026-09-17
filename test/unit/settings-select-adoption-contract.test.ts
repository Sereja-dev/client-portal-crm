import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product UI/UX PR 5 (Design Investigation finding F4): `company-profile-
 * form.tsx`'s Currency and Time zone controls were two raw `<select>`
 * elements that hand-copied the shared `Select` primitive's className but
 * omitted its invalid-state (red border) branch — a validation error on
 * either field showed no visual cue, unlike every `Input`-based field on
 * the same form. This file proves, from source, that both controls now
 * adopt the shared `Select` component instead of duplicating its
 * className, while every behavior-relevant prop (id, name, defaultValue,
 * aria-invalid, required) and the option-generation logic are byte-for-
 * byte preserved.
 */

const SOURCE_PATH = "src/app/(dashboard)/settings/company/company-profile-form.tsx";

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf-8");
}

describe("company-profile-form.tsx — Currency/Time zone adopt the shared Select primitive", () => {
  it("imports Select from the shared ui/select module", () => {
    const source = readSource();
    expect(source).toMatch(/import\s*\{\s*Select\s*\}\s*from\s*["']@\/components\/ui\/select["']/);
  });

  it("no longer contains a raw <select element", () => {
    const source = readSource();
    expect(source).not.toMatch(/<select\b/);
  });

  it("renders exactly two <Select components (Currency, Time zone)", () => {
    const source = readSource();
    const occurrences = (source.match(/<Select\b/g) ?? []).length;
    expect(occurrences).toBe(2);
  });

  it("the Currency control keeps its exact id/name/defaultValue/aria-invalid/required contract", () => {
    const source = readSource();
    const block = source.slice(source.indexOf("Currency"), source.indexOf("Time zone"));
    expect(block).toMatch(/<Select/);
    expect(block).toMatch(/id="currency"/);
    expect(block).toMatch(/name="currency"/);
    // Company Profile Failed-Validation Form State Preservation --
    // defaultValue (and key, checked by a later assertion below) now
    // prefer the just-submitted value on a rejected save, falling back
    // to the persisted profile only when no failed submission exists.
    expect(block).toMatch(/defaultValue=\{fieldDefault\(state\.values\?\.currency, profile\.currency\)\}/);
    expect(block).toMatch(/aria-invalid=\{!!state\.fieldErrors\?\.currency\}/);
    expect(block).toMatch(/\brequired\b/);
    expect(block).toMatch(/currencies\.map/);
  });

  it("the Time zone control keeps its exact id/name/defaultValue/aria-invalid/required contract", () => {
    const source = readSource();
    const block = source.slice(source.indexOf("Time zone"), source.indexOf("</fieldset>"));
    expect(block).toMatch(/<Select/);
    expect(block).toMatch(/id="timezone"/);
    expect(block).toMatch(/name="timezone"/);
    // Company Profile Failed-Validation Form State Preservation -- see
    // the Currency control's own identical comment above.
    expect(block).toMatch(/defaultValue=\{fieldDefault\(state\.values\?\.timezone, profile\.timezone\)\}/);
    expect(block).toMatch(/aria-invalid=\{!!state\.fieldErrors\?\.timezone\}/);
    expect(block).toMatch(/\brequired\b/);
    expect(block).toMatch(/timezones\.map/);
  });

  it("neither <Select> call site duplicates the shared component's own className (no hand-copied border/focus classes)", () => {
    const source = readSource();
    // The old raw <select> elements each carried their own long className
    // string; the shared Select primitive supplies this now, so the call
    // site itself should carry no className prop at all.
    const selectBlocks = source.match(/<Select[^>]*>/g) ?? [];
    expect(selectBlocks.length).toBe(2);
    for (const block of selectBlocks) {
      expect(block).not.toMatch(/className=/);
    }
  });

  it("both FormField labels (Currency, Time zone) remain correctly associated via htmlFor", () => {
    const source = readSource();
    expect(source).toMatch(/<FormField label="Currency" htmlFor="currency"/);
    expect(source).toMatch(/<FormField label="Time zone" htmlFor="timezone"/);
  });
});
