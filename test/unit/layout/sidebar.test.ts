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
});
