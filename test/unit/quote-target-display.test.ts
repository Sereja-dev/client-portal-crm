import { describe, expect, it } from "vitest";
import { deriveQuoteTargetDisplay } from "@/lib/quotes/target-display";

/**
 * Aqenra Quotes Phase 3 (Staff UI) §M/§N — the single source of truth for
 * a Quote's own target display, covering the durable invariant from the
 * task's own §B: leadId is never cleared once set, so a Quote created
 * directly against a Client (leadId null) is a genuinely different case
 * from a reconciled Lead-origin Quote (both ids set) — this suite pins
 * both, plus the still-unconverted Lead-only case.
 */
describe("deriveQuoteTargetDisplay", () => {
  it("a direct Client quote (leadId null): type CLIENT, correct href, no originLead", () => {
    const result = deriveQuoteTargetDisplay({
      leadId: null,
      clientId: "client-1",
      lead: null,
      client: { id: "client-1", name: "Acme Inc" },
    });
    expect(result).toEqual({
      type: "CLIENT",
      name: "Acme Inc",
      href: "/clients/client-1/edit",
      originLead: null,
    });
  });

  it("an unconverted Lead quote (clientId null): type LEAD, correct href", () => {
    const result = deriveQuoteTargetDisplay({
      leadId: "lead-1",
      clientId: null,
      lead: { id: "lead-1", name: "Jane Doe" },
      client: null,
    });
    expect(result).toEqual({
      type: "LEAD",
      name: "Jane Doe",
      href: "/leads/lead-1/edit",
      originLead: { id: "lead-1", name: "Jane Doe", href: "/leads/lead-1/edit" },
    });
  });

  it("a reconciled Lead-origin quote (both ids set): CURRENT type is CLIENT, but originLead still preserves the Lead — never silently dropped (§B/§G)", () => {
    const result = deriveQuoteTargetDisplay({
      leadId: "lead-1",
      clientId: "client-1",
      lead: { id: "lead-1", name: "Jane Doe" },
      client: { id: "client-1", name: "Acme Inc" },
    });
    expect(result.type).toBe("CLIENT");
    expect(result.name).toBe("Acme Inc");
    expect(result.href).toBe("/clients/client-1/edit");
    expect(result.originLead).toEqual({ id: "lead-1", name: "Jane Doe", href: "/leads/lead-1/edit" });
  });
});
