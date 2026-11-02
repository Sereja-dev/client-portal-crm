import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DashboardActions } from "@/components/dashboard/dashboard-actions";

// First-Time User Experience V2, Slice D -- the three header actions swap to
// the secondary link appearance only while the onboarding card is rendered;
// labels, hrefs and availability never change.

const LINKS = [
  { label: "Add client", href: "/clients/new" },
  { label: "Create invoice", href: "/invoices/new" },
  { label: "View overdue tasks", href: "/tasks?overdue=true" },
];

function anchors(html: string): { href: string; className: string; text: string }[] {
  return [...html.matchAll(/<a class="([^"]*)" href="([^"]*)">([^<]*)<\/a>/g)].map((m) => ({
    href: m[2].replace(/&amp;/g, "&"),
    className: m[1],
    text: m[3],
  }));
}

describe("DashboardActions hierarchy", () => {
  it("default / omitted prop: the exact current primary appearance", () => {
    for (const html of [renderToStaticMarkup(<DashboardActions />), renderToStaticMarkup(<DashboardActions demotedDuringOnboarding={false} />)]) {
      const found = anchors(html);
      expect(found.map((a) => [a.text, a.href])).toEqual(LINKS.map((l) => [l.label, l.href]));
      for (const a of found) {
        expect(a.className).toContain("bg-accent");
        expect(a.className).toContain("text-white");
        expect(a.className).not.toContain("border-border-strong");
      }
    }
  });

  it("demoted while onboarding is visible: secondary appearance, same size, labels and hrefs unchanged", () => {
    const found = anchors(renderToStaticMarkup(<DashboardActions demotedDuringOnboarding />));
    expect(found.map((a) => [a.text, a.href])).toEqual(LINKS.map((l) => [l.label, l.href]));
    for (const a of found) {
      expect(a.className).toMatch(/(^| )border( |$)/); // has a border
      expect(a.className).toContain("border-border-strong");
      expect(a.className).toContain("bg-surface");
      expect(a.className).toContain("text-text-primary");
      expect(a.className).not.toContain("bg-accent");
      expect(a.className).not.toContain("text-white");
      // Same box model as primary: click target and wrapping are preserved.
      expect(a.className).toContain("px-4 py-2 text-sm font-medium");
      // Keyboard focus ring preserved.
      expect(a.className).toContain("focus-visible:ring-2");
    }
  });

  it("all three actions stay present in both states (nothing hidden)", () => {
    expect(anchors(renderToStaticMarkup(<DashboardActions demotedDuringOnboarding />))).toHaveLength(3);
    expect(anchors(renderToStaticMarkup(<DashboardActions />))).toHaveLength(3);
  });
});

describe("Dashboard page wiring", () => {
  const page = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");

  it("passes the SAME shouldRenderOnboardingCard decision the card itself uses", () => {
    expect(page).toContain('import { shouldRenderOnboardingCard } from "@/components/onboarding/should-render-card"');
    expect(page).toMatch(/shouldRenderOnboardingCard\(\{\s*isComplete: onboardingProgress\.isComplete,\s*isDismissed: isOnboardingDismissed,\s*\}\)/);
    expect(page).toContain("<DashboardActions demotedDuringOnboarding={onboardingCardVisible} />");
    expect(readFileSync("src/components/onboarding/onboarding-card.tsx", "utf8")).toContain(
      "shouldRenderOnboardingCard({ isComplete: progress.isComplete, isDismissed })",
    );
  });
});
