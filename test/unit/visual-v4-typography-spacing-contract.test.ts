import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Visual Design Improvement V4 — source-contract proxy for the three
 * migrated surfaces (Dashboard sub-components, Clients, Invoices). No
 * DOM/component-rendering harness exists for pages/components with
 * usePathname()/data-fetching/server-component dependencies in this repo
 * — see button-variant-contract.test.ts's own header comment for the
 * same reasoning.
 */

const needsAttentionSource = readFileSync("src/components/dashboard/needs-attention.tsx", "utf8");
const todaySectionSource = readFileSync("src/components/dashboard/today-section.tsx", "utf8");
const recentActivitySource = readFileSync("src/components/dashboard/recent-activity.tsx", "utf8");
const dashboardPageSource = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");
const clientsPageSource = readFileSync("src/app/(dashboard)/clients/page.tsx", "utf8");
const invoicesPageSource = readFileSync("src/app/(dashboard)/invoices/page.tsx", "utf8");

describe("Dashboard sub-components — SectionTitle adopted where heading semantics are already correct", () => {
  it("NeedsAttention renders <SectionTitle>, never a literal <h2> with the old ad hoc classes", () => {
    expect(needsAttentionSource).toMatch(/import\s*\{\s*SectionTitle\s*\}\s*from\s*"@\/components\/ui\/page-section"/);
    expect(needsAttentionSource).toMatch(/<SectionTitle>Needs attention<\/SectionTitle>/);
    expect(needsAttentionSource).not.toMatch(/<h2 className="text-text-primary text-lg font-semibold tracking-tight">/);
  });

  it("TodaySection renders <SectionTitle>, never a literal <h2> with the old ad hoc classes", () => {
    expect(todaySectionSource).toMatch(/import\s*\{\s*SectionTitle\s*\}\s*from\s*"@\/components\/ui\/page-section"/);
    expect(todaySectionSource).toMatch(/<SectionTitle>Today<\/SectionTitle>/);
    expect(todaySectionSource).not.toMatch(/<h2 className="text-text-primary text-lg font-semibold tracking-tight">/);
  });

  it("the h3 sub-headings INSIDE NeedsAttention/TodaySection (legitimately one level below their own SectionTitle) are untouched — only the top-level section heading migrated, not the whole typography scale", () => {
    expect(needsAttentionSource).toContain('<h3 className="text-text-primary text-sm font-semibold">{title}</h3>');
    expect(todaySectionSource).toContain('<h3 className="text-text-primary mb-4 text-sm font-semibold">Tasks due today</h3>');
    expect(todaySectionSource).toContain("Today&rsquo;s events");
  });

  it("RecentActivity is a top-level Dashboard sibling of Needs attention/Today and now shares their own SectionTitle — Production manual smoke found its previous standalone text-sm h2 (correct semantic level, but a third, independently-sized visual treatment) inconsistent with its two true h2 siblings; adopting SectionTitle gives all three the same deliberate tier, never a literal <h3> regression", () => {
    expect(recentActivitySource).toMatch(/import\s*\{\s*SectionTitle\s*\}\s*from\s*"@\/components\/ui\/page-section"/);
    expect(recentActivitySource).toMatch(/<SectionTitle>Recent activity<\/SectionTitle>/);
    expect(recentActivitySource).not.toMatch(/<h3[^>]*>Recent activity<\/h3>/);
    expect(recentActivitySource).not.toMatch(/<h2 className="text-text-primary text-sm font-semibold">Recent activity<\/h2>/);
  });

  it("RecentActivity's surrounding card surface, 'View all activity' link, and activity-list rendering are all untouched by the heading change", () => {
    expect(recentActivitySource).toMatch(/className=\{`p-6 \$\{CARD_SURFACE_CLASSES\}`\}/);
    expect(recentActivitySource).toContain('href="/activity"');
    expect(recentActivitySource).toContain("View all activity");
    expect(recentActivitySource).toContain("No activity yet.");
  });
});

describe("Dashboard page — h1, KPI cards, CTA row, and data semantics all unchanged by V4", () => {
  it("h1 still uses the original, already-consistent page-title treatment", () => {
    expect(dashboardPageSource).toMatch(
      /className="text-text-primary focus:ring-focus-ring rounded text-2xl font-semibold tracking-tight focus:outline-none focus:ring-2 focus:ring-offset-2"/,
    );
  });

  it("the outer page wrapper is still space-y-8, unchanged — Dashboard already matched the convention before V4", () => {
    expect(dashboardPageSource).toContain('<div className="space-y-8">');
  });

  it("all five KPI cards (V3's own icon work) are still present with their exact data bindings", () => {
    expect(dashboardPageSource).toContain('icon={ClientsIcon}');
    expect(dashboardPageSource).toContain('icon={WorkIcon}');
    expect(dashboardPageSource).toContain('icon={CheckIcon}');
    expect(dashboardPageSource).toContain('icon={DocumentsIcon}');
    expect(dashboardPageSource).toContain('icon={FinanceIcon}');
  });
});

describe("Clients page — spacing convention applied, no section heading invented on a flat operational list", () => {
  it("imports and applies both shared spacing constants", () => {
    expect(clientsPageSource).toMatch(
      /import\s*\{\s*PAGE_SECTION_STACK_CLASSES,\s*PAGE_SUBSECTION_STACK_CLASSES\s*\}\s*from\s*"@\/components\/ui\/page-section"/,
    );
    expect(clientsPageSource).toContain("<div className={PAGE_SECTION_STACK_CLASSES}>");
    expect(clientsPageSource).toContain("<div className={PAGE_SUBSECTION_STACK_CLASSES}>");
  });

  it("h1 is unchanged — still the original page-title treatment, never replaced or restyled", () => {
    expect(clientsPageSource).toMatch(
      /<h1 className="text-text-primary text-2xl font-semibold tracking-tight">\s*Clients\s*<\/h1>/,
    );
  });

  it("no SectionTitle/<h2> was invented on this page — it stays a flat operational list, matching the brief's own explicit caution", () => {
    expect(clientsPageSource).not.toMatch(/SectionTitle/);
    expect(clientsPageSource).not.toMatch(/<h2\b/);
  });

  it("Saved Views, Columns control, and SearchFilterBar are all still present and unchanged, just regrouped under the new sub-section wrapper", () => {
    expect(clientsPageSource).toContain("<ClientSavedViews");
    expect(clientsPageSource).toContain("<ColumnVisibilityControl columns={CLIENT_COLUMNS} />");
    expect(clientsPageSource).toContain("<SearchFilterBar");
  });
});

describe("Invoices page — spacing convention applied below FinanceTabs, not conflicting with its own existing margin", () => {
  it("imports and applies both shared spacing constants", () => {
    expect(invoicesPageSource).toMatch(
      /import\s*\{\s*PAGE_SECTION_STACK_CLASSES,\s*PAGE_SUBSECTION_STACK_CLASSES\s*\}\s*from\s*"@\/components\/ui\/page-section"/,
    );
    expect(invoicesPageSource).toContain("<div className={PAGE_SECTION_STACK_CLASSES}>");
    expect(invoicesPageSource).toContain("<div className={PAGE_SUBSECTION_STACK_CLASSES}>");
  });

  it("PAGE_SECTION_STACK_CLASSES wraps content starting AFTER FinanceTabs, never FinanceTabs itself — avoiding any ambiguity with SectionTabs' own existing mb-6", () => {
    const financeTabsIndex = invoicesPageSource.indexOf("<FinanceTabs");
    const sectionStackIndex = invoicesPageSource.indexOf("<div className={PAGE_SECTION_STACK_CLASSES}>");
    expect(financeTabsIndex).toBeGreaterThan(-1);
    expect(sectionStackIndex).toBeGreaterThan(financeTabsIndex);
  });

  it("h1 is unchanged — still the original page-title treatment", () => {
    expect(invoicesPageSource).toMatch(
      /<h1 className="text-text-primary text-2xl font-semibold tracking-tight">\s*Invoices\s*<\/h1>/,
    );
  });

  it("no SectionTitle/<h2> was invented on this page either", () => {
    expect(invoicesPageSource).not.toMatch(/SectionTitle/);
    expect(invoicesPageSource).not.toMatch(/<h2\b/);
  });

  it("QuickFilterChips, Saved Views, Columns control, and SearchFilterBar are all still present and unchanged, just regrouped under the new sub-section wrapper", () => {
    expect(invoicesPageSource).toContain("<QuickFilterChips");
    expect(invoicesPageSource).toContain("<InvoiceSavedViews");
    expect(invoicesPageSource).toContain("<ColumnVisibilityControl columns={INVOICE_COLUMNS} />");
    expect(invoicesPageSource).toContain("<SearchFilterBar");
  });
});
