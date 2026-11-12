import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Platform Admin dedicated hostname — protocol/host hardening review.
 *
 * Calls the real, exported `middleware` function from the project-root
 * middleware.ts directly, with a real `NextRequest` built by Next's own
 * `next/server` — never a mocked/duplicated copy of the routing logic.
 * `TEST_MODE` is toggled per test via `vi.resetModules()` + a fresh dynamic
 * import, since middleware.ts reads it as a module-level constant.
 *
 * REPAIR (CI-environment test-design fix). The previous version of this
 * file assumed that, with no NEXT_PUBLIC_SUPABASE_URL configured,
 * updateSession()'s fall-through branch would throw synchronously
 * ("Your project's URL and Key are required..."), and used that throw as
 * proof the admin-host rule did not short-circuit. Reproduced locally
 * with the exact placeholder values .github/workflows/ci-fast.yml sets at
 * job scope (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key — both harmless,
 * non-real, taken straight from the committed workflow file, never a real
 * credential): with those present, createServerClient() no longer throws
 * (a syntactically valid-looking URL/key is enough), and
 * updateRealSupabaseSession() never checks the result of its own
 * `await supabase.auth.getUser()` call at all — a failed network call
 * there resolves rather than throws (Supabase's own client fails soft),
 * so the whole thing settles to a plain `NextResponse.next()`. 8 of this
 * file's 19 tests failed under that exact CI-equivalent environment,
 * confirmed by running `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
 * NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key npx vitest run
 * test/unit/middleware-admin-host.test.ts` locally before this rewrite —
 * this file's own correctness must never again depend on whichever
 * Supabase env vars happen to be present or absent wherever it runs.
 *
 * Fix: updateSession (src/lib/supabase/middleware.ts) is now mocked as a
 * controlled, observable spy — exactly as suggested by the review. The
 * real, unmodified, exported `middleware` function is still the only
 * thing under test; only its one real dependency is replaced, so no
 * routing logic is duplicated here. Every assertion is now deterministic
 * in any environment (Supabase configured, misconfigured, or absent
 * entirely) and never depends on a network call, a thrown error from an
 * unrelated subsystem, or test execution order.
 */

const { updateSessionMock } = vi.hoisted(() => {
  return { updateSessionMock: vi.fn() };
});

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: updateSessionMock,
}));

/** A fresh, distinguishable sentinel per test — proven returned BY REFERENCE, never reconstructed by middleware.ts itself. */
function controlledUpdateSessionResponse(): NextResponse {
  return NextResponse.next({ headers: { "x-test-sentinel": "updateSession-controlled-response" } });
}

async function loadMiddleware() {
  vi.resetModules();
  const mod = await import("../../middleware");
  return mod.middleware;
}

const ORIGINAL_TEST_MODE = process.env.TEST_MODE;
const ORIGINAL_VERCEL = process.env.VERCEL;

beforeEach(() => {
  updateSessionMock.mockReset();
  // Defensively ensured absent before every test, regardless of the
  // ambient shell environment this suite happens to run in — the
  // TEST_MODE=1-only tests below must exercise the genuine "not on
  // Vercel" case unless a specific test explicitly sets VERCEL itself.
  delete process.env.VERCEL;
});

afterEach(() => {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.TEST_MODE;
  else process.env.TEST_MODE = ORIGINAL_TEST_MODE;
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
});

const PROD_LOCATION = "https://admin.aqenra.com/login?redirectTo=%2Fplatform-admin";

describe("middleware — admin hostname root, production mode (TEST_MODE unset)", () => {
  async function prodRedirectFor(headers: Record<string, string>) {
    delete process.env.TEST_MODE;
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/", { headers });
    return middleware(req);
  }

  /**
   * For every case where the admin-host rule must fire: the redirect is
   * returned, and updateSession (the real dependency, mocked) is never
   * even called — proving the rule short-circuits rather than merely
   * "also" producing the right final answer alongside a real session
   * refresh.
   */
  function expectRedirectAndNoUpdateSessionCall(res: NextResponse | undefined) {
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
    expect(updateSessionMock).not.toHaveBeenCalled();
  }

  /**
   * For every case where the rule must NOT fire: updateSession (the
   * mocked dependency) is called exactly once, with the real request, and
   * middleware() returns that controlled response completely unchanged
   * (strict reference equality) — proving middleware() genuinely
   * delegates rather than independently reconstructing a response that
   * happens to look the same.
   */
  async function expectRuleDidNotFire(headers: Record<string, string>) {
    const sentinel = controlledUpdateSessionResponse();
    updateSessionMock.mockResolvedValueOnce(sentinel);
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/", { headers });
    const res = await middleware(req);
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
    expect(updateSessionMock).toHaveBeenCalledWith(req);
    expect(res).toBe(sentinel);
  }

  it("the ordinary case: exact admin hostname, no forwarded headers at all", async () => {
    expectRedirectAndNoUpdateSessionCall(await prodRedirectFor({ host: "admin.aqenra.com" }));
  });

  it("never downgrades to http even when x-forwarded-proto explicitly says http", async () => {
    const res = await prodRedirectFor({ host: "admin.aqenra.com", "x-forwarded-proto": "http" });
    expectRedirectAndNoUpdateSessionCall(res);
  });

  it("is unaffected by a malformed, comma-separated, or injection-shaped x-forwarded-proto value", async () => {
    const res = await prodRedirectFor({
      host: "admin.aqenra.com",
      "x-forwarded-proto": "http, javascript://evil, HTTPS ",
    });
    expectRedirectAndNoUpdateSessionCall(res);
  });

  it("is unaffected by a nonstandard port on the Host header", async () => {
    expectRedirectAndNoUpdateSessionCall(await prodRedirectFor({ host: "admin.aqenra.com:9999" }));
  });

  it("is unaffected by mixed case in the Host header", async () => {
    expectRedirectAndNoUpdateSessionCall(await prodRedirectFor({ host: "ADMIN.AQENRA.COM" }));
  });

  it("an embedded path/query/backslash/fragment in the raw Host value still resolves to the real hostname and redirects to the fixed literal", async () => {
    for (const host of [
      "admin.aqenra.com/evil",
      "admin.aqenra.com?x=1",
      "admin.aqenra.com\\evil.com",
      "admin.aqenra.com#@evil.com",
    ]) {
      updateSessionMock.mockReset();
      expectRedirectAndNoUpdateSessionCall(await prodRedirectFor({ host }));
    }
  });

  it("userinfo-swap: evil.com@admin.aqenra.com resolves to the real host (admin.aqenra.com) and is still only the fixed literal", async () => {
    expectRedirectAndNoUpdateSessionCall(await prodRedirectFor({ host: "evil.com@admin.aqenra.com" }));
  });

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

  it("a malformed IPv6 literal is safely ignored by parseHostHeader (parsed as null), never throws", async () => {
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
    expectRedirectAndNoUpdateSessionCall(await prodRedirectFor({ host: "  admin.aqenra.com  " }));
  });

  it("a missing Host header falls through to updateSession, never throws from parseHostHeader itself", async () => {
    const sentinel = controlledUpdateSessionResponse();
    updateSessionMock.mockResolvedValueOnce(sentinel);
    delete process.env.TEST_MODE;
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/");
    req.headers.delete("host");
    const res = await middleware(req);
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
    expect(res).toBe(sentinel);
  });

  it("a non-root path on the exact admin hostname never redirects from this rule (no broader host policy)", async () => {
    const sentinel = controlledUpdateSessionResponse();
    updateSessionMock.mockResolvedValueOnce(sentinel);
    delete process.env.TEST_MODE;
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/platform-admin", { headers: { host: "admin.aqenra.com" } });
    const res = await middleware(req);
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
    expect(updateSessionMock).toHaveBeenCalledWith(req);
    expect(res).toBe(sentinel);
  });
});

describe("middleware — admin hostname root, TEST_MODE=1 (local/E2E only)", () => {
  async function testModeRedirectFor(headers: Record<string, string>) {
    process.env.TEST_MODE = "1";
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/", { headers });
    return middleware(req);
  }

  it("uses http:// and the exact matched host:port — never the production https literal, and updateSession is never called", async () => {
    const res = await testModeRedirectFor({ host: "admin.aqenra.com:3100" });
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe("http://admin.aqenra.com:3100/login?redirectTo=%2Fplatform-admin");
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it("without a port, redirects to the bare hostname over http", async () => {
    const res = await testModeRedirectFor({ host: "admin.aqenra.com" });
    expect(res?.headers.get("location")).toBe("http://admin.aqenra.com/login?redirectTo=%2Fplatform-admin");
  });

  it("is still exact-match only — a deceptive suffix never matches in TEST_MODE either, and falls through to the mocked updateSession", async () => {
    const sentinel = controlledUpdateSessionResponse();
    updateSessionMock.mockResolvedValueOnce(sentinel);
    const res = await testModeRedirectFor({ host: "admin.aqenra.com.attacker.example" });
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
    expect(res).toBe(sentinel);
  });
});

describe("middleware — admin hostname root, TEST_MODE=1 but on Vercel infrastructure (hypothetical misconfiguration)", () => {
  /**
   * Finding 2 follow-up. check-no-test-mode.mjs can only prove TEST_MODE
   * is absent from this repository's own committed config — it has no
   * visibility into Vercel's actual Production environment variables. If
   * TEST_MODE were ever set there too, this second, independent signal
   * (`VERCEL`, a Vercel-documented system variable set on every real
   * Vercel deployment, never set by this project's own committed config
   * or by playwright.config.ts's webServer — confirmed directly) still
   * keeps this one redirect on the fixed https literal. This does not
   * retroactively prove the TEST_MODE branch "can never" fire in
   * Production in general — only that THIS specific redirect stays safe
   * even under that specific hypothetical.
   */
  it("TEST_MODE=1 alongside VERCEL set: still the fixed https literal, never http, and updateSession is never called", async () => {
    process.env.TEST_MODE = "1";
    process.env.VERCEL = "1";
    const middleware = await loadMiddleware();
    const req = new NextRequest("http://127.0.0.1/", { headers: { host: "admin.aqenra.com:3100" } });
    const res = await middleware(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe(PROD_LOCATION);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });
});
