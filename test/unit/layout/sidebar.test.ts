import { describe, expect, it } from "vitest";
import { buildSidebarLinks } from "@/components/layout/sidebar";

/** Recurring Invoices Phase 2A — Sidebar role gating (test items 41/42). */

describe("buildSidebarLinks", () => {
  it("41. a MEMBER never gets the Recurring Invoices link", () => {
    const links = buildSidebarLinks("MEMBER");
    expect(links.some((link) => link.href === "/recurring-invoices")).toBe(false);
  });

  it("42. OWNER and ADMIN both get the Recurring Invoices link", () => {
    expect(buildSidebarLinks("OWNER").some((link) => link.href === "/recurring-invoices")).toBe(true);
    expect(buildSidebarLinks("ADMIN").some((link) => link.href === "/recurring-invoices")).toBe(true);
  });

  it("every other existing link is unaffected by role", () => {
    const memberLinks = buildSidebarLinks("MEMBER").map((l) => l.href);
    const ownerLinks = buildSidebarLinks("OWNER").map((l) => l.href);
    expect(memberLinks).toEqual(ownerLinks.filter((href) => href !== "/recurring-invoices"));
  });

  // Contracts Phase 2 (Staff UI) — visible to every role, immediately
  // after Invoices, never role-gated (locked architecture §I).
  it("Contracts is visible to every role, immediately after Invoices", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      const links = buildSidebarLinks(role);
      const invoicesIndex = links.findIndex((l) => l.href === "/invoices");
      const contractsIndex = links.findIndex((l) => l.href === "/contracts");
      expect(contractsIndex).toBeGreaterThan(-1);
      expect(contractsIndex).toBe(invoicesIndex + 1);
      expect(links[contractsIndex].label).toBe("Contracts");
    }
  });

  // Reports Phase 2 — un-role-gated in the sidebar, exactly like
  // Analytics: every role sees the link; MEMBER's actual block happens
  // server-side, on the page itself (ReportsAccessDenied), never here.
  it("Reports is visible to every role, immediately after Analytics, exactly like Analytics' own sidebar visibility", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      const links = buildSidebarLinks(role);
      const analyticsIndex = links.findIndex((l) => l.href === "/analytics");
      const reportsIndex = links.findIndex((l) => l.href === "/reports");
      expect(reportsIndex).toBeGreaterThan(-1);
      expect(reportsIndex).toBe(analyticsIndex + 1);
      expect(links[reportsIndex].label).toBe("Reports");
    }
  });
});
