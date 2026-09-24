import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Production Observability Priority 4 — bounded Client Error Boundary
 * consolidation. Proves the browser-console `console.error(error)`
 * behavior every error.tsx in this app already had is now routed
 * through exactly one shared implementation
 * (`useErrorBoundaryLogging` in src/components/ui/segment-error-state.tsx),
 * with zero change to rendered UI, copy, reset wiring, or document
 * structure, and with no new destination, mechanism, or dependency.
 *
 * This is a refactor of existing browser-console behavior only — it
 * does not create durable monitoring or operator visibility, and adds
 * no network call, beacon, mutation, or external SDK. See
 * segment-error-boundaries-adoption-contract.test.ts for the pre-
 * existing topology coverage this file extends,
 * segment-error-state.test.tsx/root-error-boundary.test.tsx for the
 * pre-existing render-level privacy coverage of the three boundaries
 * that already delegated to SegmentErrorState before this change, and
 * error-boundary-logging-hook.test.ts for the real-execution proof that
 * the shared hook itself calls console.error exactly once per Error
 * instance, unchanged — kept in its own file for the reason that file's
 * own header comment explains (mocking react's useEffect there must
 * never leak into this file's real-React SSR assertions).
 */

const SHARED_COMPONENT_PATH = "src/components/ui/segment-error-state.tsx";
const GLOBAL_ERROR_PATH = "src/app/global-error.tsx";
const AUTH_ERROR_PATH = "src/app/(auth)/error.tsx";
const DASHBOARD_ERROR_PATH = "src/app/(dashboard)/error.tsx";
const ANALYTICS_ERROR_PATH = "src/app/(dashboard)/(insights)/analytics/error.tsx";
const ROOT_ERROR_PATH = "src/app/error.tsx";
const PLATFORM_ADMIN_ERROR_PATH = "src/app/(platform-admin)/error.tsx";
const PORTAL_ERROR_PATH = "src/app/portal/(app)/error.tsx";

// The four boundaries this consolidation actually touches — each kept
// its own distinct visual markup/copy, only its logging changed.
const DIRECTLY_CONSOLIDATED_PATHS = [GLOBAL_ERROR_PATH, AUTH_ERROR_PATH, DASHBOARD_ERROR_PATH, ANALYTICS_ERROR_PATH];

// The three boundaries that already delegated to SegmentErrorState
// before this change — they must gain no logging of their own (that
// would double-log), since SegmentErrorState itself now calls the
// shared hook internally.
const DELEGATING_PATHS = [ROOT_ERROR_PATH, PLATFORM_ADMIN_ERROR_PATH, PORTAL_ERROR_PATH];

function readSource(path: string): string {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return readFileSync(path, "utf-8");
}

/** Strips /** block comments and // line comments so a doc comment merely mentioning "console.error(" in prose can never trip a check meant to catch a REAL call — same technique check-billing-security.mjs's own stripBlockComments() already establishes. */
function stripComments(source: string): string {
  return source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Source contract — every boundary routes logging through exactly one shared implementation", () => {
  it("the shared hook exists, is exported, and is a thin wrapper over the exact same useEffect/console.error pattern every boundary already used", () => {
    const source = readSource(SHARED_COMPONENT_PATH);
    expect(source).toMatch(/export function useErrorBoundaryLogging\(/);
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*console\.error\(error\);\s*\},\s*\[error\]\)/);
  });

  it("SegmentErrorState itself calls the shared hook, not its own inline useEffect/console.error", () => {
    const source = readSource(SHARED_COMPONENT_PATH);
    expect(source).toMatch(/useErrorBoundaryLogging\(error\)/);
    // Exactly one REAL console.error( call in the whole file — inside
    // the shared hook only, never duplicated for SegmentErrorState
    // itself. Comments stripped first (this file's own doc comments
    // mention "console.error(error)" in prose, which must never trip
    // this check).
    const consoleErrorCalls = stripComments(source).match(/console\.error\(/g) ?? [];
    expect(consoleErrorCalls).toHaveLength(1);
  });

  for (const path of DIRECTLY_CONSOLIDATED_PATHS) {
    it(`${path} imports and calls the shared hook, and has no console.error call of its own`, () => {
      const source = readSource(path);
      expect(source).toMatch(/import\s*\{\s*useErrorBoundaryLogging\s*\}\s*from\s*["']@\/components\/ui\/segment-error-state["']/);
      expect(source).toMatch(/useErrorBoundaryLogging\(error\)/);
      expect(source).not.toMatch(/console\.error\(/);
      expect(source).not.toMatch(/\buseEffect\b/);
    });
  }

  for (const path of DELEGATING_PATHS) {
    it(`${path} has no console.error/useEffect of its own — logging happens exactly once, inside SegmentErrorState`, () => {
      const source = readSource(path);
      expect(source).not.toMatch(/console\.error\(/);
      expect(source).not.toMatch(/useErrorBoundaryLogging/);
      expect(source).not.toMatch(/\buseEffect\b/);
    });
  }

  it("no boundary or the shared component introduces a network call, beacon, mutation, or external reporting SDK", () => {
    const allPaths = [SHARED_COMPONENT_PATH, ...DIRECTLY_CONSOLIDATED_PATHS, ...DELEGATING_PATHS];
    for (const path of allPaths) {
      const source = readSource(path);
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|axios|@sentry|bugsnag|datadog|new WebSocket/i);
      expect(source).not.toMatch(/"use server"/);
    }
  });
});

describe("Behavior — no boundary logs during server/static rendering (real, unmocked React)", () => {
  it("SegmentErrorState never calls console.error during renderToStaticMarkup", async () => {
    const { SegmentErrorState } = await import("@/components/ui/segment-error-state");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderToStaticMarkup(
      <SegmentErrorState error={new Error("ssr")} reset={() => {}} description="Test description." />,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("GlobalError never calls console.error during renderToStaticMarkup, and keeps its required <html>/<body> document structure", async () => {
    const { default: GlobalError } = await import("@/app/global-error");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<GlobalError error={new Error("ssr")} reset={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    expect(html).toContain("<html");
    expect(html).toContain("<body");
    spy.mockRestore();
  });

  it("AuthError never calls console.error during renderToStaticMarkup", async () => {
    const { default: AuthError } = await import("@/app/(auth)/error");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderToStaticMarkup(<AuthError error={new Error("ssr")} reset={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("DashboardError never calls console.error during renderToStaticMarkup", async () => {
    const { default: DashboardError } = await import("@/app/(dashboard)/error");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderToStaticMarkup(<DashboardError error={new Error("ssr")} reset={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("AnalyticsError never calls console.error during renderToStaticMarkup", async () => {
    const { default: AnalyticsError } = await import("@/app/(dashboard)/(insights)/analytics/error");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderToStaticMarkup(<AnalyticsError error={new Error("ssr")} reset={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("Behavior — rendered UI is byte-identical in shape and still excludes sensitive error content", () => {
  const MARKER_MESSAGE = "MARKER_MESSAGE_consolidation_9f2c";
  const MARKER_STACK = "MARKER_STACK_consolidation_at_/src/lib/prisma.ts:1";
  const MARKER_DIGEST = "MARKER_DIGEST_consolidation_abcd1234";
  const MARKER_CAUSE = "MARKER_CAUSE_consolidation_client_email@example.com";

  function makeSensitiveError(): Error & { digest?: string } {
    const cause = new Error(MARKER_CAUSE);
    const error = new Error(MARKER_MESSAGE, { cause }) as Error & { digest?: string };
    error.stack = MARKER_STACK;
    error.digest = MARKER_DIGEST;
    return error;
  }

  function expectNoSensitiveContent(html: string) {
    expect(html).not.toContain(MARKER_MESSAGE);
    expect(html).not.toContain(MARKER_STACK);
    expect(html).not.toContain(MARKER_DIGEST);
    expect(html).not.toContain(MARKER_CAUSE);
    expect(html).not.toMatch(/\{"message":|\{"stack":|\{"digest":/);
  }

  it("GlobalError renders its exact pre-existing heading/description/button and no sensitive content", async () => {
    const { default: GlobalError } = await import("@/app/global-error");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<GlobalError error={makeSensitiveError()} reset={() => {}} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("An unexpected error occurred. Please try again.");
    expect(html).toMatch(/<button[^>]*>[\s\S]*Try again[\s\S]*<\/button>/);
    expectNoSensitiveContent(html);
    vi.restoreAllMocks();
  });

  it("AuthError renders its exact pre-existing heading/description/button and no sensitive content", async () => {
    const { default: AuthError } = await import("@/app/(auth)/error");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<AuthError error={makeSensitiveError()} reset={() => {}} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Please try again.");
    expect(html).toMatch(/<button[^>]*>[\s\S]*Try again[\s\S]*<\/button>/);
    expectNoSensitiveContent(html);
    vi.restoreAllMocks();
  });

  it("DashboardError renders its exact pre-existing heading/description/button and no sensitive content", async () => {
    const { default: DashboardError } = await import("@/app/(dashboard)/error");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<DashboardError error={makeSensitiveError()} reset={() => {}} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("We couldn&#x27;t load this page. Please try again.");
    expect(html).toMatch(/<button[^>]*>[\s\S]*Try again[\s\S]*<\/button>/);
    expectNoSensitiveContent(html);
    vi.restoreAllMocks();
  });

  it("AnalyticsError renders its exact pre-existing heading/description/button and no sensitive content", async () => {
    const { default: AnalyticsError } = await import("@/app/(dashboard)/(insights)/analytics/error");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<AnalyticsError error={makeSensitiveError()} reset={() => {}} />);
    expect(html).toContain("Analytics is unavailable right now");
    expect(html).toContain("We couldn&#x27;t load your analytics data. Please try again.");
    expect(html).toMatch(/<button[^>]*>[\s\S]*Try again[\s\S]*<\/button>/);
    expectNoSensitiveContent(html);
    vi.restoreAllMocks();
  });
});

describe("Behavior — reset wiring is unchanged for every consolidated boundary", () => {
  it("each of the four directly-consolidated boundaries still wires its Try again control to call reset() and nothing else", () => {
    for (const path of DIRECTLY_CONSOLIDATED_PATHS) {
      const source = readSource(path);
      const onClickMatch = source.match(/onClick=\{([^}]*)\}/);
      expect(onClickMatch, `${path} should have exactly one onClick handler`).not.toBeNull();
      expect(onClickMatch![1].trim()).toMatch(/^\(\)\s*=>\s*reset\(\)$/);
    }
  });
});
