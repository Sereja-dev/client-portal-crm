import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobileFilterDisclosure } from "@/components/list/mobile-filter-disclosure";

/**
 * Mobile Improvement Slice B1 — the shared disclosure primitive's own
 * dedicated test. Presentation only: proves the summary label and the
 * `open` attribute both follow `activeCount` exactly, children render
 * unchanged, and no extra markup/class is specific to any one surface
 * (SearchFilterBar/Contracts own the actual field content).
 */
describe("MobileFilterDisclosure", () => {
  it("activeCount 0 -> summary reads 'Filter' and the <details> is closed", () => {
    const html = renderToStaticMarkup(
      <MobileFilterDisclosure activeCount={0}>
        <div>field</div>
      </MobileFilterDisclosure>,
    );
    expect(html).toContain(">Filter<");
    expect(html).not.toContain("Filter (");
    expect(html).toMatch(/<details class="[^"]*"(?!\s+open)/);
  });

  it("activeCount 1 -> summary reads 'Filter (1)' and the <details> is open", () => {
    const html = renderToStaticMarkup(
      <MobileFilterDisclosure activeCount={1}>
        <div>field</div>
      </MobileFilterDisclosure>,
    );
    expect(html).toContain("Filter (1)");
    expect(html).toMatch(/<details[^>]*\sopen(?:="")?[^>]*>/);
  });

  it("activeCount 4 -> summary reads 'Filter (4)'", () => {
    const html = renderToStaticMarkup(
      <MobileFilterDisclosure activeCount={4}>
        <div>field</div>
      </MobileFilterDisclosure>,
    );
    expect(html).toContain("Filter (4)");
  });

  it("renders children unchanged, inside the content wrapper", () => {
    const html = renderToStaticMarkup(
      <MobileFilterDisclosure activeCount={0}>
        <div data-testid="status-field">Status field</div>
        <div data-testid="client-field">Client field</div>
      </MobileFilterDisclosure>,
    );
    expect(html).toContain("Status field");
    expect(html).toContain("Client field");
    expect(html).toContain("mobile-filter-disclosure-content");
  });

  it("carries the dedicated mobile-filter-disclosure class the globals.css rule targets", () => {
    const html = renderToStaticMarkup(
      <MobileFilterDisclosure activeCount={0}>
        <div>field</div>
      </MobileFilterDisclosure>,
    );
    expect(html).toContain("mobile-filter-disclosure");
  });

  it("the summary carries md:hidden — never visible at desktop widths", () => {
    const html = renderToStaticMarkup(
      <MobileFilterDisclosure activeCount={0}>
        <div>field</div>
      </MobileFilterDisclosure>,
    );
    expect(html).toMatch(/<summary class="[^"]*\bmd:hidden\b[^"]*"/);
  });
});
