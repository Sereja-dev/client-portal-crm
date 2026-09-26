import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { onRequestError } from "../../instrumentation";

/**
 * TEMPORARY Leads Pipeline Production RSC diagnostic — Production
 * Observability Correction (Leads Pipeline V1 investigation). Deleted
 * alongside instrumentation.ts once the one controlled Production
 * capture this diagnostic exists for has happened — see that file's own
 * header comment.
 */

const MARKER = "AQENRA_LEADS_PIPELINE_RSC_DIAGNOSTIC";

function leadsRscContext(overrides: Partial<Parameters<typeof onRequestError>[2]> = {}) {
  return {
    routerKind: "App Router" as const,
    routePath: "/leads",
    routeType: "render" as const,
    renderSource: "react-server-components" as const,
    revalidateReason: undefined,
    ...overrides,
  };
}

function requestStub() {
  return { path: "/leads?view=pipeline&q=secret-search-term", method: "GET", headers: {} };
}

describe("instrumentation.ts onRequestError — temporary Leads Pipeline RSC diagnostic", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // Test A — unrelated route.
  it("A. emits nothing for a synthetic error on an unrelated route", () => {
    const error = new Error("some other page broke");
    onRequestError(error, requestStub(), leadsRscContext({ routePath: "/clients" }));
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  // Test B — Leads route but not an RSC render.
  it("B. emits nothing for a Leads-path error that is not a React Server Components render", () => {
    const error = new Error("a Leads Route Handler failed, not a page render");
    onRequestError(error, requestStub(), leadsRscContext({ routeType: "route", renderSource: undefined }));
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    const serverRenderingError = new Error("server-rendering, not RSC");
    onRequestError(error, requestStub(), leadsRscContext({ renderSource: "server-rendering" }));
    void serverRenderingError;
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  // Test C — genuine Leads RSC error.
  it("C. emits exactly one diagnostic line for a synthetic Leads RSC error, with name/message/stack/digest represented", () => {
    const error = new Error("fetchLeadPipelineColumns threw unexpectedly") as Error & { digest?: string };
    error.digest = "123456789";
    onRequestError(error, requestStub(), leadsRscContext());

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = consoleErrorSpy.mock.calls[0][0] as string;
    expect(logged.startsWith(MARKER)).toBe(true);
    expect(logged).toContain("fetchLeadPipelineColumns threw unexpectedly");
    expect(logged).toContain("Error");
    expect(logged).toContain("123456789");
  });

  // Test D — privacy sanitizer.
  it("D. redacts fake email/UUID/credential-URL/JWT/token-assignment values while keeping useful non-sensitive text", () => {
    const fakeUuid = "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789";
    const fakeEmail = "definitely-real-person@example.com";
    const fakeCredentialUrl = "postgres://realuser:realpassword123@db.example.internal:5432/prod";
    const fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzYWZha2VzaWduYXR1cmU";
    const fakeTokenAssignment = 'apiKey: "sk-live-totally-real-secret-value-123456"';

    const error = new Error(
      `Prisma error while resolving user ${fakeUuid} <${fakeEmail}> via ${fakeCredentialUrl} bearer=${fakeJwt} config=${fakeTokenAssignment}. Root cause: invalid input for enum LeadStage.`,
    );
    onRequestError(error, requestStub(), leadsRscContext());

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = consoleErrorSpy.mock.calls[0][0] as string;

    expect(logged).not.toContain(fakeUuid);
    expect(logged).not.toContain(fakeEmail);
    expect(logged).not.toContain("realpassword123");
    expect(logged).not.toContain(fakeJwt);
    expect(logged).not.toContain("sk-live-totally-real-secret-value-123456");
    expect(logged).toContain("[REDACTED]");
    // Useful, non-sensitive diagnostic wording survives.
    expect(logged).toContain("invalid input for enum LeadStage");
    expect(logged.startsWith(MARKER)).toBe(true);
  });

  // Test E — bounded output.
  it("E. keeps the emitted message and stack within their intended length bounds for very large input", () => {
    const hugeMessage = "x".repeat(10_000);
    const hugeStack = "at someFunction (/app/src/very/long/path.ts:1:1)\n".repeat(500);
    const error = new Error(hugeMessage);
    error.stack = hugeStack;
    onRequestError(error, requestStub(), leadsRscContext());

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = consoleErrorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(logged.slice(MARKER.length + 1));
    expect(parsed.message.length).toBeLessThanOrEqual(2001); // + ellipsis char
    expect(parsed.stack.length).toBeLessThanOrEqual(4001);
  });

  // Test F — payload allowlist (no arbitrary enumerable fields survive).
  it("F. never includes arbitrary enumerable error fields (meta/query/headers/customerData) in the emitted output", () => {
    const error = new Error("boom") as Error & Record<string, unknown>;
    error.meta = { rawQueryValue: "SELECT * FROM leads WHERE email = 'someone@example.com'" };
    error.query = { q: "super-secret-search-term" };
    error.headers = { cookie: "session=abc123; active_organization_id=xyz" };
    error.customerData = { name: "Real Customer Name", email: "customer@example.com" };

    onRequestError(error, requestStub(), leadsRscContext());

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = consoleErrorSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain("rawQueryValue");
    expect(logged).not.toContain("SELECT * FROM leads");
    expect(logged).not.toContain("super-secret-search-term");
    expect(logged).not.toContain("session=abc123");
    expect(logged).not.toContain("active_organization_id");
    expect(logged).not.toContain("Real Customer Name");
    expect(logged).not.toContain("customer@example.com");
    const parsed = JSON.parse(logged.slice(MARKER.length + 1));
    expect(Object.keys(parsed).sort()).toEqual(["digest", "marker", "message", "name", "stack"]);
  });

  // Test G — observation semantics: calling the hook never throws or
  // transforms/mutates the supplied error, and never returns a value
  // Next could mistake for a replacement/handling signal.
  it("G. never throws, never mutates the supplied error, and returns undefined (observation-only)", () => {
    const error = new Error("original message");
    const originalMessage = error.message;
    const originalStack = error.stack;

    let result: void | Promise<void> = undefined;
    expect(() => {
      result = onRequestError(error, requestStub(), leadsRscContext());
    }).not.toThrow();

    expect(error.message).toBe(originalMessage);
    expect(error.stack).toBe(originalStack);
    expect(result).toBeUndefined();
  });
});
