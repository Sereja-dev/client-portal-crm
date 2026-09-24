import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product UI/UX PR 2 — proves the two new segment-scoped error boundaries
 * exist at the correct App Router locations, are Client Components
 * accepting the real `{ error, reset }` contract, delegate to the shared
 * SegmentErrorState presentation with segment-appropriate copy, and never
 * directly render raw error content themselves. Also proves this PR does
 * not accidentally introduce a broader (root/global/dashboard-wide)
 * boundary, and leaves every pre-existing error.tsx/global-error.tsx
 * untouched.
 *
 * Source-contract only, same repo-wide precedent as
 * file-input-contract.test.ts's own header comment explains (no DOM/
 * component-interaction harness in this repo) — never imports/renders
 * either boundary file itself; `segment-error-state.test.tsx` covers real
 * rendering of the shared presentation component both boundaries adopt.
 */

const PLATFORM_ADMIN_ERROR_PATH = "src/app/(platform-admin)/error.tsx";
const PORTAL_ERROR_PATH = "src/app/portal/(app)/error.tsx";
const SHARED_COMPONENT_PATH = "src/components/ui/segment-error-state.tsx";

const ROOT_ERROR_PATH = "src/app/error.tsx";
const GLOBAL_ERROR_PATH = "src/app/global-error.tsx";
const DASHBOARD_ERROR_PATH = "src/app/(dashboard)/error.tsx";
const ANALYTICS_ERROR_PATH = "src/app/(dashboard)/(insights)/analytics/error.tsx";
const AUTH_ERROR_PATH = "src/app/(auth)/error.tsx";

function readBoundarySource(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist yet`);
  }
  return readFileSync(path, "utf-8");
}

describe("Platform Admin segment error boundary", () => {
  it("exists at the correct sibling-to-layout location", () => {
    expect(existsSync(PLATFORM_ADMIN_ERROR_PATH)).toBe(true);
  });

  it("is a Client Component ('use client')", () => {
    const source = readBoundarySource(PLATFORM_ADMIN_ERROR_PATH);
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("accepts the real Next.js error-boundary contract: error and reset", () => {
    const source = readBoundarySource(PLATFORM_ADMIN_ERROR_PATH);
    expect(source).toMatch(/error\s*:\s*Error\s*&\s*\{\s*digest\?:\s*string\s*\}/);
    expect(source).toMatch(/reset\s*:\s*\(\)\s*=>\s*void/);
  });

  it("delegates rendering to the shared SegmentErrorState component, passing error and reset through unchanged", () => {
    const source = readBoundarySource(PLATFORM_ADMIN_ERROR_PATH);
    expect(source).toMatch(/import\s*\{\s*SegmentErrorState\s*\}\s*from\s*["']@\/components\/ui\/segment-error-state["']/);
    expect(source).toMatch(/<SegmentErrorState[\s\S]*?error=\{error\}[\s\S]*?\/>/);
    expect(source).toMatch(/<SegmentErrorState[\s\S]*?reset=\{reset\}[\s\S]*?\/>/);
  });

  it("passes a Platform-Admin-appropriate description, never a generic placeholder shared verbatim with Portal", () => {
    const source = readBoundarySource(PLATFORM_ADMIN_ERROR_PATH);
    expect(source).toMatch(/description=["'].*Platform Admin.*["']/);
  });

  it("never itself renders error.message/.stack/.cause/.digest or an auth/tenant identifier", () => {
    const source = readBoundarySource(PLATFORM_ADMIN_ERROR_PATH);
    expect(source).not.toMatch(/error\.(message|stack|cause|digest)\b/);
    expect(source).not.toMatch(/organizationId|clientId|invoiceId|userId/);
  });

  it("embeds no production-only error trigger, debug route, query flag, or environment flag", () => {
    const source = readBoundarySource(PLATFORM_ADMIN_ERROR_PATH);
    expect(source).not.toMatch(/searchParams|process\.env|throw new Error\(/);
  });
});

describe("Client Portal segment error boundary", () => {
  it("exists at the correct sibling-to-layout location", () => {
    expect(existsSync(PORTAL_ERROR_PATH)).toBe(true);
  });

  it("is a Client Component ('use client')", () => {
    const source = readBoundarySource(PORTAL_ERROR_PATH);
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("accepts the real Next.js error-boundary contract: error and reset", () => {
    const source = readBoundarySource(PORTAL_ERROR_PATH);
    expect(source).toMatch(/error\s*:\s*Error\s*&\s*\{\s*digest\?:\s*string\s*\}/);
    expect(source).toMatch(/reset\s*:\s*\(\)\s*=>\s*void/);
  });

  it("delegates rendering to the shared SegmentErrorState component, passing error and reset through unchanged", () => {
    const source = readBoundarySource(PORTAL_ERROR_PATH);
    expect(source).toMatch(/import\s*\{\s*SegmentErrorState\s*\}\s*from\s*["']@\/components\/ui\/segment-error-state["']/);
    expect(source).toMatch(/<SegmentErrorState[\s\S]*?error=\{error\}[\s\S]*?\/>/);
    expect(source).toMatch(/<SegmentErrorState[\s\S]*?reset=\{reset\}[\s\S]*?\/>/);
  });

  it("never itself renders error.message/.stack/.cause/.digest or an auth/tenant identifier", () => {
    const source = readBoundarySource(PORTAL_ERROR_PATH);
    expect(source).not.toMatch(/error\.(message|stack|cause|digest)\b/);
    expect(source).not.toMatch(/organizationId|clientId|invoiceId|userId|portalUserId/);
  });

  it("embeds no production-only error trigger, debug route, query flag, or environment flag", () => {
    const source = readBoundarySource(PORTAL_ERROR_PATH);
    expect(source).not.toMatch(/searchParams|process\.env|throw new Error\(/);
  });
});

describe("Shared SegmentErrorState component — reset wiring and scope", () => {
  it("exists, is a Client Component, and wires the Try again control to call reset() and nothing else", () => {
    const source = readBoundarySource(SHARED_COMPONENT_PATH);
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
    const onClickMatch = source.match(/onClick=\{([^}]*)\}/);
    expect(onClickMatch).not.toBeNull();
    expect(onClickMatch![1].trim()).toMatch(/^\(\)\s*=>\s*reset\(\)$/);
    // Never a full reload, a submitted form, or cross-tenant navigation.
    expect(source).not.toMatch(/window\.location|location\.reload|router\.push|router\.replace|<form/);
  });

  it("uses console.error(error) only — the same pre-existing convention every other error.tsx in this repo already uses, not a new logging mechanism", () => {
    const source = readBoundarySource(SHARED_COMPONENT_PATH);
    expect(source).toMatch(/console\.error\(error\)/);
    expect(source).not.toMatch(/console\.(log|debug|warn)\(/);
  });

  it("never introduces a new dependency — imports only from react and this repo's own modules", () => {
    const source = readBoundarySource(SHARED_COMPONENT_PATH);
    const importLines = source.match(/^import .+$/gm) ?? [];
    for (const line of importLines) {
      const fromMatch = line.match(/from\s+["']([^"']+)["']/);
      expect(fromMatch).not.toBeNull();
      const specifier = fromMatch![1];
      expect(specifier === "react" || specifier.startsWith("@/") || specifier.startsWith(".")).toBe(true);
    }
  });
});

describe("Scope — no broader boundary introduced by PR 2 itself; presentation stays untouched by later corrections", () => {
  // Corrected by the later Stability Correction (F2): PR 2 itself
  // introduced no root-level boundary — true at the time this file was
  // written — but a root src/app/error.tsx was since added, deliberately
  // and separately, to close a disclosed gap (an exception thrown inside
  // a nested layout, e.g. (dashboard)/layout.tsx, had no boundary of its
  // own beyond the chrome-less global-error.tsx). This test now proves
  // that root boundary exists and is the same SegmentErrorState-based
  // class of boundary as this PR's own two — not a correctness regression
  // of PR 2's own claim, which was accurate for its own unchanged scope.
  it("a root-level error.tsx exists (added later, by the Stability Correction) and delegates to the same shared SegmentErrorState presentation", () => {
    expect(existsSync(ROOT_ERROR_PATH)).toBe(true);
    const source = readBoundarySource(ROOT_ERROR_PATH);
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
    expect(source).toMatch(/import\s*\{\s*SegmentErrorState\s*\}\s*from\s*["']@\/components\/ui\/segment-error-state["']/);
  });

  // Corrected again by Production Observability Priority 4: these four
  // boundaries' *presentation* (their own distinct JSX/copy) is still
  // exactly what PR 2 left it as — never migrated to render
  // <SegmentErrorState> itself, which is what these assertions actually
  // check. Their *logging* did change (each now calls the shared
  // useErrorBoundaryLogging hook instead of its own inline
  // useEffect/console.error) — see error-boundary-logging-consolidation
  // .test.tsx and error-boundary-logging-hook.test.ts for that coverage.
  // "Untouched" below means presentation-untouched, not diff-untouched.
  it("global-error.tsx keeps its own <html>/<body> full-page presentation — never migrated to render SegmentErrorState itself", () => {
    const source = readBoundarySource(GLOBAL_ERROR_PATH);
    expect(source).toMatch(/export default function GlobalError/);
    expect(source).toMatch(/<html lang="en">/);
    expect(source).not.toMatch(/<SegmentErrorState/);
  });

  it("the pre-existing (dashboard), (dashboard)/analytics, and (auth) error boundaries keep their own distinct presentation — never migrated to render SegmentErrorState itself", () => {
    for (const path of [DASHBOARD_ERROR_PATH, ANALYTICS_ERROR_PATH, AUTH_ERROR_PATH]) {
      const source = readBoundarySource(path);
      expect(source).not.toMatch(/<SegmentErrorState/);
    }
  });
});
