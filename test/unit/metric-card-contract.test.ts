import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Visual Design Improvement V3 — source-contract proxy for MetricCard's
 * icon support and elevation upgrade (no DOM/component-rendering harness
 * exists in this repo — see button-variant-contract.test.ts's own header
 * comment for the same reasoning; Link from next/link specifically has no
 * established renderToStaticMarkup precedent anywhere in this codebase,
 * so this follows the dominant source-contract convention rather than
 * being the first to attempt that).
 */

const source = readFileSync("src/components/dashboard/metric-card.tsx", "utf8");
const dashboardPageSource = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");

describe("MetricCard — icon prop is optional and additive", () => {
  it("icon is typed optional — Portal/Platform Admin call sites that never pass it still compile and render unchanged", () => {
    expect(source).toMatch(/icon\?\s*:\s*\(props:\s*IconProps\)\s*=>\s*React\.ReactElement/);
  });

  it("the icon container only renders when icon is provided — a guarded conditional, never an empty/placeholder container", () => {
    expect(source).toMatch(/\{Icon\s*&&\s*\(/);
  });

  it("the icon container uses accent-subtle/accent tokens only — never a different literal or semantic color per metric", () => {
    const containerMatch = source.match(/<span className="([^"]*)">/);
    expect(containerMatch).not.toBeNull();
    const classes = containerMatch![1];
    expect(classes).toContain("bg-accent-subtle");
    expect(classes).toContain("text-accent");
    // Never a semantic status color (success/warning/danger) — Outstanding
    // Invoices being non-zero is not equivalent to overdue (NeedsAttention
    // already carries that urgency elsewhere).
    expect(classes).not.toMatch(/\b(bg|text)-(success|warning|danger)\b/);
  });

  it("label/value/hint rendering is unchanged — same text tokens, same size scale", () => {
    expect(source).toContain("text-text-muted text-xs font-medium tracking-wide uppercase");
    expect(source).toContain("text-text-primary mt-2 text-2xl font-semibold tracking-tight sm:text-3xl");
    expect(source).toContain("text-text-muted mt-1 text-xs");
  });
});

describe("MetricCard — elevation wired to the existing --aqenra-shadow tokens, no new tokens invented", () => {
  it("resting shadow uses --aqenra-shadow-sm; hover uses the stronger --aqenra-shadow-md", () => {
    expect(source).toContain("shadow-[var(--aqenra-shadow-sm)]");
    expect(source).toContain("hover:shadow-[var(--aqenra-shadow-md)]");
    // Never the old plain Tailwind hover:shadow-sm with no resting shadow at all.
    expect(source).not.toMatch(/\bhover:shadow-sm\b/);
  });

  it("CARD_SURFACE_CLASSES (existing surface/border primitive) is still the base — not reimplemented", () => {
    expect(source).toMatch(/import\s*\{\s*CARD_SURFACE_CLASSES\s*\}\s*from\s*"@\/components\/ui\/surface"/);
    expect(source).toMatch(/\$\{CARD_SURFACE_CLASSES\}/);
  });
});

describe("Dashboard — all five KPI cards now provide a meaningful icon, data semantics unchanged", () => {
  it("imports exactly the five chosen icons from the existing icon system, no new icon added", () => {
    expect(dashboardPageSource).toMatch(
      /import\s*\{\s*ClientsIcon,\s*WorkIcon,\s*CheckIcon,\s*DocumentsIcon,\s*FinanceIcon\s*\}\s*from\s*"@\/components\/ui\/icons"/,
    );
  });

  it("each of the five MetricCard usages passes icon=, and no new label/value/hint/href text changed", () => {
    const cardBlocksMatch = dashboardPageSource.match(/<MetricCard[\s\S]*?\/>/g);
    expect(cardBlocksMatch).not.toBeNull();
    const cards = cardBlocksMatch!.filter((block) => block.includes("href="));
    expect(cards.length).toBe(5);
    for (const card of cards) {
      expect(card).toMatch(/icon=\{(ClientsIcon|WorkIcon|CheckIcon|DocumentsIcon|FinanceIcon)\}/);
    }
    // Existing data bindings/copy untouched.
    expect(dashboardPageSource).toContain('label="Clients" value={analytics.kpis.totalClients} href="/clients"');
    expect(dashboardPageSource).toContain(
      'label="Active projects" value={analytics.kpis.activeProjects} href="/projects"',
    );
    expect(dashboardPageSource).toContain('label="Open tasks" value={analytics.kpis.openTasks} href="/tasks"');
    expect(dashboardPageSource).toContain('label="Outstanding invoices"');
    expect(dashboardPageSource).toContain('label="Revenue"');
  });

  it("Outstanding Invoices gets the same neutral icon treatment as every other card — no conditional warning styling based on amount/count", () => {
    const outstandingBlock = dashboardPageSource.match(/<MetricCard\s+label="Outstanding invoices"[\s\S]*?\/>/);
    expect(outstandingBlock).not.toBeNull();
    expect(outstandingBlock![0]).not.toMatch(/warning|danger|success/i);
  });
});
