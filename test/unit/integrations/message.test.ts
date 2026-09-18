import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildSlackMessage, escapeSlackMrkdwn } from "@/lib/integrations/message";

describe("integrations/message", () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://app.aqenra.test";
  });
  afterEach(() => {
    process.env.APP_BASE_URL = originalAppBaseUrl;
  });

  describe("escapeSlackMrkdwn", () => {
    it("escapes &, <, > in that order", () => {
      expect(escapeSlackMrkdwn("A & B")).toBe("A &amp; B");
      expect(escapeSlackMrkdwn("<tag>")).toBe("&lt;tag&gt;");
      expect(escapeSlackMrkdwn("<!channel>")).toBe("&lt;!channel&gt;");
    });

    it("does not double-escape an already-escaped ampersand", () => {
      // & is escaped first, then < and > — "&lt;" input becomes "&amp;lt;",
      // never re-interpreted as a real < afterwards.
      expect(escapeSlackMrkdwn("&lt;")).toBe("&amp;lt;");
    });
  });

  describe("buildSlackMessage", () => {
    it("builds a LEAD_CREATED message with a deep link", () => {
      const text = buildSlackMessage({
        eventKey: "LEAD_CREATED",
        entityType: "LEAD",
        entityId: "lead-1",
        metadata: { name: "Jane Doe" },
      });
      expect(text).toBe("[Aqenra] New lead: Jane Doe\nOpen in Aqenra: https://app.aqenra.test/leads/lead-1/edit");
    });

    it("builds a CLIENT_CREATED message", () => {
      const text = buildSlackMessage({
        eventKey: "CLIENT_CREATED",
        entityType: "CLIENT",
        entityId: "client-1",
        metadata: { name: "Acme Co" },
      });
      expect(text).toContain("[Aqenra] New client: Acme Co");
      expect(text).toContain("/clients/client-1/edit");
    });

    it("builds an INVOICE_SENT message from invoiceNumber", () => {
      const text = buildSlackMessage({
        eventKey: "INVOICE_SENT",
        entityType: "INVOICE",
        entityId: "inv-1",
        metadata: { invoiceNumber: "INV-0042", from: "DRAFT", to: "SENT" },
      });
      expect(text).toContain("[Aqenra] Invoice sent: INV-0042");
      expect(text).toContain("/invoices/inv-1/edit");
    });

    it("builds a CONTRACT_ACCEPTED message", () => {
      const text = buildSlackMessage({
        eventKey: "CONTRACT_ACCEPTED",
        entityType: "CONTRACT",
        entityId: "contract-1",
        metadata: { name: "MSA 2026", from: "SENT", to: "ACCEPTED" },
      });
      expect(text).toContain("[Aqenra] Contract signed: MSA 2026");
      expect(text).toContain("/contracts/contract-1");
    });

    it("returns null when the required metadata field is missing", () => {
      const text = buildSlackMessage({ eventKey: "LEAD_CREATED", entityType: "LEAD", entityId: "lead-1", metadata: {} });
      expect(text).toBeNull();
    });

    it("escapes a <!channel> injection attempt in a Lead name", () => {
      const text = buildSlackMessage({
        eventKey: "LEAD_CREATED",
        entityType: "LEAD",
        entityId: "lead-1",
        metadata: { name: "<!channel> urgent" },
      });
      expect(text).toContain("&lt;!channel&gt; urgent");
      expect(text).not.toContain("<!channel>");
    });

    it("escapes a <@USER> mention injection attempt", () => {
      const text = buildSlackMessage({
        eventKey: "LEAD_CREATED",
        entityType: "LEAD",
        entityId: "lead-1",
        metadata: { name: "<@U12345> hi" },
      });
      expect(text).toContain("&lt;@U12345&gt; hi");
    });

    it("escapes bare &, <, > characters", () => {
      const text = buildSlackMessage({
        eventKey: "LEAD_CREATED",
        entityType: "LEAD",
        entityId: "lead-1",
        metadata: { name: "Smith & Sons < 5 > 3" },
      });
      expect(text).toContain("Smith &amp; Sons &lt; 5 &gt; 3");
    });

    it("truncates an extremely long name to the 200-char field cap", () => {
      const longName = "A".repeat(500);
      const text = buildSlackMessage({
        eventKey: "LEAD_CREATED",
        entityType: "LEAD",
        entityId: "lead-1",
        metadata: { name: longName },
      });
      expect(text).not.toBeNull();
      const firstLine = text!.split("\n")[0];
      // "[Aqenra] New lead: " (19 chars) + at most 200 chars of name.
      expect(firstLine.length).toBeLessThanOrEqual(19 + 200);
      expect(firstLine).toContain("…");
    });

    it("collapses newline/control characters into a single line", () => {
      const text = buildSlackMessage({
        eventKey: "LEAD_CREATED",
        entityType: "LEAD",
        entityId: "lead-1",
        metadata: { name: "Line1\nLine2\tTabbed" },
      });
      const firstLine = text!.split("\n")[0];
      expect(firstLine).toBe("[Aqenra] New lead: Line1 Line2 Tabbed");
    });

    it("never includes raw Activity metadata fields beyond the safe ones used", () => {
      const text = buildSlackMessage({
        eventKey: "INVOICE_SENT",
        entityType: "INVOICE",
        entityId: "inv-1",
        metadata: { invoiceNumber: "INV-1", amount: 999999, internalSecret: "do-not-leak" },
      });
      expect(text).not.toContain("999999");
      expect(text).not.toContain("do-not-leak");
    });
  });
});
