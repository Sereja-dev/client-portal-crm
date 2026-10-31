import { describe, expect, it } from "vitest";
import { UNAVAILABLE, buildBugDiagnostics, sanitizeRoute, sanitizeUserAgent } from "@/lib/feedback-widget/diagnostics";

describe("sanitizeRoute — path only, never query or fragment", () => {
  it("keeps a normal path", () => {
    expect(sanitizeRoute("/clients/abc-123/edit")).toBe("/clients/abc-123/edit");
  });

  it("strips the query string and fragment (search terms and filters can hold private text)", () => {
    expect(sanitizeRoute("/clients?q=Jane+Doe+jane%40example.com&status=active")).toBe("/clients");
    expect(sanitizeRoute("/invoices#note=secret")).toBe("/invoices");
    expect(sanitizeRoute("/leads/view?token=abc#frag")).toBe("/leads/view");
  });

  it.each(["", "clients", "//evil.example.com/path", "https://evil.example.com/x", "/path with space", "/a\nb", "/<script>", "/" + "a".repeat(250), null, undefined, 42, {}])(
    "reports %j as unavailable rather than passing it through",
    (value) => {
      expect(sanitizeRoute(value)).toBe(UNAVAILABLE);
    },
  );
});

describe("sanitizeUserAgent", () => {
  it("keeps a normal user agent", () => {
    expect(sanitizeUserAgent("Mozilla/5.0 (Macintosh) Chrome/120.0")).toBe("Mozilla/5.0 (Macintosh) Chrome/120.0");
  });

  it("removes control characters and bounds the length", () => {
    expect(sanitizeUserAgent("Agent\r\nInjected: header\u0000")).toBe("AgentInjected: header");
    expect(sanitizeUserAgent("a".repeat(1000))).toHaveLength(300);
  });

  it("reports missing or empty values as unavailable", () => {
    expect(sanitizeUserAgent(null)).toBe(UNAVAILABLE);
    expect(sanitizeUserAgent("   ")).toBe(UNAVAILABLE);
    expect(sanitizeUserAgent(undefined)).toBe(UNAVAILABLE);
  });
});

describe("buildBugDiagnostics", () => {
  const NOW = new Date("2026-11-02T10:00:00.000Z");

  it("builds exactly the documented four fields, with the server's own timestamp", () => {
    const result = buildBugDiagnostics({ route: "/projects/p1?x=1", viewportWidth: "1280", viewportHeight: "720" }, { userAgent: "UA/1.0", now: NOW });
    expect(result).toEqual({ route: "/projects/p1", submittedAt: "2026-11-02T10:00:00.000Z", userAgent: "UA/1.0", viewport: "1280 × 720" });
    expect(Object.keys(result).sort()).toEqual(["route", "submittedAt", "userAgent", "viewport"]);
  });

  it("never trusts a client-supplied timestamp or extra fields", () => {
    const hostile = { route: "/x", viewportWidth: "10", viewportHeight: "10", submittedAt: "1999-01-01", cookie: "sid=1", token: "abc" } as Record<string, unknown>;
    const result = buildBugDiagnostics(hostile, { userAgent: "UA", now: NOW });
    expect(result.submittedAt).toBe(NOW.toISOString());
    expect(JSON.stringify(result)).not.toMatch(/sid=1|abc|1999/);
  });

  it.each([["0", "100"], ["abc", "100"], ["-5", "100"], ["100000", "100"], ["1e3", "100"], ["", ""], [undefined, undefined]])(
    "reports an invalid viewport (%j × %j) as unavailable",
    (w, h) => {
      expect(buildBugDiagnostics({ route: "/x", viewportWidth: w, viewportHeight: h }, { userAgent: "UA", now: NOW }).viewport).toBe(UNAVAILABLE);
    },
  );
});
