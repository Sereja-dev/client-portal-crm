import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Platform Admin dedicated hostname — protocol/host hardening review.
 *
 * Calls the real, exported `middleware` function from the project-root
 * middleware.ts directly, with a real `NextRequest` built by Next's own
 * `next/server` — never a mocked/duplicated copy of the routing logic.
 * `TEST_MODE` is toggled per test via `vi.resetModules()` + a fresh dynamic
 * import, since middleware.ts reads it as a module-level constant.
 *
 * Every "production-like" case here (TEST_MODE deleted) matches the real
 * admin-host-root condition and therefore returns immediately from inside
 * middleware() without ever calling updateSession() — so no real Supabase
 * client is constructed and no network call is attempted. A case that does
 * NOT match the admin-host-root condition is deliberately never exercised
 * here in the TEST_MODE-unset state (that would require a real Supabase
 * instance); the "everything else is unaffected" claim is covered instead
 * by the E2E suite (test/e2e/platform-admin-host-routing.spec.ts), which
 * always runs with TEST_MODE=1 already set by playwright.config.ts.
 */

async function loadMiddleware() {
  vi.resetModules();
  const mod = await import("../../middleware");
  return mod.middleware;
}

const ORIGINAL_TEST_MODE = process.env.TEST_MODE;

afterEach(() => {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.TEST_MODE;
  else process.env.TEST_MODE = ORIGINAL_TEST_MODE;
});

const PROD_LOCATION = "https://admin.aqenra.com/login?redirectTo=%2Fplatform-admin";

describe("middleware — admin hostname root, production mode (TEST_MODE unset)", () => {
  async function prodRedirectFor(headers: Record<string, string>) {
    delete process.env.TEST_MODE;
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/", { headers });
    return middleware(req);
  }

  it("the ordinary case: exact admin hostname, no forwarded headers at all", async () => {
    const res = await prodRedirectFor({ host: "admin.aqenra.com" });
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
  });

  it("never downgrades to http even when x-forwarded-proto explicitly says http", async () => {
    const res = await prodRedirectFor({ host: "admin.aqenra.com", "x-forwarded-proto": "http" });
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
  });

  it("is unaffected by a malformed, comma-separated, or injection-shaped x-forwarded-proto value", async () => {
    const res = await prodRedirectFor({
      host: "admin.aqenra.com",
      "x-forwarded-proto": "http, javascript://evil, HTTPS ",
    });
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
  });

  it("is unaffected by a nonstandard port on the Host header", async () => {
    const res = await prodRedirectFor({ host: "admin.aqenra.com:9999" });
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
  });

  it("is unaffected by mixed case in the Host header", async () => {
    const res = await prodRedirectFor({ host: "ADMIN.AQENRA.COM" });
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
  });

  it("an embedded path/query/backslash/fragment in the raw Host value still resolves to the real hostname and redirects to the fixed literal", async () => {
    for (const host of [
      "admin.aqenra.com/evil",
      "admin.aqenra.com?x=1",
      "admin.aqenra.com\\evil.com",
      "admin.aqenra.com#@evil.com",
    ]) {
      const res = await prodRedirectFor({ host });
      expect(res?.status, `host=${host}`).toBe(307);
      expect(res?.headers.get("location"), `host=${host}`).toBe(PROD_LOCATION);
    }
  });

  it("userinfo-swap: evil.com@admin.aqenra.com resolves to the real host (admin.aqenra.com) and is still only the fixed literal", async () => {
    const res = await prodRedirectFor({ host: "evil.com@admin.aqenra.com" });
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
  });

  /**
   * Every case in this block is a case where the admin-host-root rule must
   * NOT fire. In this bare unit environment (no NEXT_PUBLIC_SUPABASE_URL
   * configured), middleware()'s only other branch — updateSession(), real
   * Supabase mode — throws synchronously ("Your project's URL and Key are
   * required...") the moment it's reached. That thrown error is therefore
   * itself the proof that the admin-host rule did not short-circuit: if it
   * had matched, middleware() would have returned a redirect and never
   * reached updateSession() at all. This is the real, unmodified
   * updateSession() throwing for an unrelated, expected reason — not a
   * mock standing in for "rule didn't fire."
   */
  async function expectRuleDidNotFire(headers: Record<string, string>) {
    await expect(prodRedirectFor(headers)).rejects.toThrow(/URL and Key are required/);
  }

  it("reverse userinfo-swap: admin.aqenra.com@evil.com resolves to evil.com as the real host and does NOT match", async () => {
    await expectRuleDidNotFire({ host: "admin.aqenra.com@evil.com" });
  });

  it("a deceptive suffix never matches", async () => {
    await expectRuleDidNotFire({ host: "admin.aqenra.com.attacker.example" });
  });

  it("a deceptive prefix never matches", async () => {
    await expectRuleDidNotFire({ host: "not-admin.aqenra.com" });
  });

  it("a trailing dot (absolute DNS name) does not match — a safe false negative, never a false positive", async () => {
    await expectRuleDidNotFire({ host: "admin.aqenra.com." });
  });

  it("a well-formed IPv6 literal never matches", async () => {
    await expectRuleDidNotFire({ host: "[::1]:8080" });
  });

  it("a malformed IPv6 literal is safely ignored (parsed as null), never throws from parseHostHeader itself", async () => {
    // The rejection here comes from updateSession()'s own, unrelated
    // Supabase-config check — proving parseHostHeader() returned null
    // cleanly (so the rule fell through) rather than letting the malformed
    // IPv6 literal's URL-parse failure escape uncaught.
    await expectRuleDidNotFire({ host: "[::1" });
  });

  it("surrounding whitespace in the raw Host header matches once trimmed by the Headers implementation itself", async () => {
    // Verified empirically: the Fetch-API Headers object `request.headers`
    // wraps around already trims optional surrounding whitespace from a
    // header value (standard HTTP header-field-value handling) before
    // parseHostHeader() ever sees it, so "  admin.aqenra.com  " is received
    // here as the clean "admin.aqenra.com" and legitimately matches. A raw
    // `new URL("http://  admin.aqenra.com  /")` does throw on its own
    // (confirmed separately) — parseHostHeader()'s try/catch still covers
    // that path defensively, it just isn't reachable through a real
    // Headers object in practice.
    const res = await prodRedirectFor({ host: "  admin.aqenra.com  " });
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
  });

  it("a missing Host header is safely ignored, never throws from parseHostHeader itself", async () => {
    delete process.env.TEST_MODE;
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/");
    req.headers.delete("host");
    await expect(middleware(req)).rejects.toThrow(/URL and Key are required/);
  });

  it("a non-root path on the exact admin hostname never redirects from this rule (no broader host policy)", async () => {
    delete process.env.TEST_MODE;
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/platform-admin", { headers: { host: "admin.aqenra.com" } });
    await expect(middleware(req)).rejects.toThrow(/URL and Key are required/);
  });
});

describe("middleware — admin hostname root, TEST_MODE=1 (local/E2E only)", () => {
  async function testModeRedirectFor(headers: Record<string, string>) {
    process.env.TEST_MODE = "1";
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/", { headers });
    return middleware(req);
  }

  it("uses http:// and the exact matched host:port — never the production https literal", async () => {
    const res = await testModeRedirectFor({ host: "admin.aqenra.com:3100" });
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe("http://admin.aqenra.com:3100/login?redirectTo=%2Fplatform-admin");
  });

  it("without a port, redirects to the bare hostname over http", async () => {
    const res = await testModeRedirectFor({ host: "admin.aqenra.com" });
    expect(res?.headers.get("location")).toBe("http://admin.aqenra.com/login?redirectTo=%2Fplatform-admin");
  });

  it("is still exact-match only — a deceptive suffix never matches in TEST_MODE either", async () => {
    // TEST_MODE's own updateSession() short-circuits to a plain
    // NextResponse.next() (status 200, no Location) rather than throwing —
    // so "the rule didn't fire" is asserted directly here, unlike the
    // production-mode cases above.
    const res = await testModeRedirectFor({ host: "admin.aqenra.com.attacker.example" });
    expect(res?.status).toBe(200);
    expect(res?.headers.get("location")).toBeNull();
  });
});
