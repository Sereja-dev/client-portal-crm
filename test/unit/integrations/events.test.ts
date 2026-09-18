import { describe, it, expect } from "vitest";
import { matchIntegrationEvent, isIntegrationEventKey, EVENT_KEYS } from "@/lib/integrations/events";

describe("integrations/events", () => {
  it("has exactly the 4 locked V1 event keys", () => {
    expect([...EVENT_KEYS].sort()).toEqual(
      ["CLIENT_CREATED", "CONTRACT_ACCEPTED", "INVOICE_SENT", "LEAD_CREATED"].sort(),
    );
  });

  it("matches LEAD / CREATED", () => {
    expect(matchIntegrationEvent({ entityType: "LEAD", action: "CREATED", metadata: {} })).toBe("LEAD_CREATED");
  });

  it("matches CLIENT / CREATED", () => {
    expect(matchIntegrationEvent({ entityType: "CLIENT", action: "CREATED", metadata: {} })).toBe("CLIENT_CREATED");
  });

  it("matches INVOICE / STATUS_CHANGED with to === SENT", () => {
    expect(
      matchIntegrationEvent({ entityType: "INVOICE", action: "STATUS_CHANGED", metadata: { from: "DRAFT", to: "SENT" } }),
    ).toBe("INVOICE_SENT");
  });

  it("does NOT match INVOICE / STATUS_CHANGED for a different transition (SENT -> PAID)", () => {
    expect(
      matchIntegrationEvent({ entityType: "INVOICE", action: "STATUS_CHANGED", metadata: { from: "SENT", to: "PAID" } }),
    ).toBeNull();
  });

  it("does NOT match INVOICE / STATUS_CHANGED for SENT -> OVERDUE", () => {
    expect(
      matchIntegrationEvent({ entityType: "INVOICE", action: "STATUS_CHANGED", metadata: { from: "SENT", to: "OVERDUE" } }),
    ).toBeNull();
  });

  it("matches CONTRACT / STATUS_CHANGED with to === ACCEPTED", () => {
    expect(
      matchIntegrationEvent({ entityType: "CONTRACT", action: "STATUS_CHANGED", metadata: { from: "SENT", to: "ACCEPTED" } }),
    ).toBe("CONTRACT_ACCEPTED");
  });

  it("does NOT match CONTRACT / STATUS_CHANGED for a different transition (ACCEPTED -> TERMINATED)", () => {
    expect(
      matchIntegrationEvent({
        entityType: "CONTRACT",
        action: "STATUS_CHANGED",
        metadata: { from: "ACCEPTED", to: "TERMINATED" },
      }),
    ).toBeNull();
  });

  it("does not match an unsupported entity/action pair", () => {
    expect(matchIntegrationEvent({ entityType: "TASK", action: "CREATED", metadata: {} })).toBeNull();
    expect(matchIntegrationEvent({ entityType: "CALENDAR_EVENT", action: "CREATED", metadata: {} })).toBeNull();
    expect(matchIntegrationEvent({ entityType: "CLIENT_REQUEST", action: "CREATED", metadata: {} })).toBeNull();
  });

  it("does not match CONTRACT / CREATED (only the ACCEPTED status transition matters)", () => {
    expect(matchIntegrationEvent({ entityType: "CONTRACT", action: "CREATED", metadata: { name: "x" } })).toBeNull();
  });

  it("isIntegrationEventKey narrows correctly", () => {
    expect(isIntegrationEventKey("LEAD_CREATED")).toBe(true);
    expect(isIntegrationEventKey("NOT_A_REAL_KEY")).toBe(false);
  });
});
