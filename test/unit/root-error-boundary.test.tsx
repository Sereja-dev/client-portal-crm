import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootError from "@/app/error";

/**
 * Stability Correction — F2 (missing root-level error boundary for
 * exceptions thrown inside nested async layouts).
 *
 * Confirmed against this repo's own installed Next.js 16.2.12 docs
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-
 * conventions/error.md): "error.js wraps loading.js, not-found.js,
 * page.js, and nested layout.js files in a React error boundary. It does
 * not wrap the layout.js ... above it in the same segment. To handle
 * errors in the root layout, use global-error.js." A root-level
 * `src/app/error.tsx` therefore wraps every NESTED layout beneath it —
 * (dashboard)/layout.tsx, (platform-admin)/layout.tsx, and
 * portal/(app)/layout.tsx — closing exactly the disclosed gap those three
 * layouts' own async auth/tenant work previously had no boundary for,
 * without claiming to catch a failure in src/app/layout.tsx itself
 * (global-error.tsx remains that one's only boundary) and without
 * replacing (auth)/error.tsx, (dashboard)/error.tsx,
 * (dashboard)/(insights)/analytics/error.tsx, (platform-admin)/error.tsx, or
 * portal/(app)/error.tsx — Next.js always prefers the nearest, most
 * specific matching boundary, so each of those keeps catching everything
 * inside its own pages exactly as before.
 */

describe("src/app/error.tsx — real render, F2", () => {
  it("is a real Client Component (source has the \"use client\" directive)", () => {
    const source = readFileSync("src/app/error.tsx", "utf-8");
    expect(source).toMatch(/^"use client";/);
  });

  it("renders a real accessible alert region with a heading and a Try again control, using the existing shared error-state system", () => {
    const html = renderToStaticMarkup(
      <RootError error={Object.assign(new Error("mock"), { digest: "mock-digest" })} reset={() => {}} />,
    );
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/<h[12][^>]*>/);
    expect(html).toContain("Try again");
  });

  it("never renders the error's message, stack, cause, or digest — even when they contain identifiable marker strings", () => {
    const markerError = Object.assign(
      new Error("MARKER_MESSAGE_should_never_render_9f3a"),
      { digest: "MARKER_DIGEST_should_never_render_2b71", cause: "MARKER_CAUSE_should_never_render_1c88" },
    );
    markerError.stack = "MARKER_STACK_should_never_render_5e02";

    const html = renderToStaticMarkup(<RootError error={markerError} reset={() => {}} />);

    expect(html).not.toContain("MARKER_MESSAGE_should_never_render_9f3a");
    expect(html).not.toContain("MARKER_DIGEST_should_never_render_2b71");
    expect(html).not.toContain("MARKER_CAUSE_should_never_render_1c88");
    expect(html).not.toContain("MARKER_STACK_should_never_render_5e02");
  });

  it("renders no reload/navigation/form/fetch/mutation control — only the one Try again button", () => {
    const html = renderToStaticMarkup(<RootError error={new Error("mock")} reset={() => {}} />);
    const buttonMatches = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttonMatches).toHaveLength(1);
    expect(html).not.toMatch(/<form\b|<a\s+href/);
  });

  it("reuses the existing shared SegmentErrorState component (no broadened/new API)", () => {
    const source = readFileSync("src/app/error.tsx", "utf-8");
    expect(source).toMatch(/import\s*\{\s*SegmentErrorState\s*\}\s*from\s*["']@\/components\/ui\/segment-error-state["']/);
    expect(source).toMatch(/<SegmentErrorState\b/);
  });
});

describe("src/app/error.tsx — topology contract, F2", () => {
  it("exists at the exact root location, sibling to layout.tsx and global-error.tsx", () => {
    expect(existsSync("src/app/error.tsx")).toBe(true);
    expect(existsSync("src/app/layout.tsx")).toBe(true);
    expect(existsSync("src/app/global-error.tsx")).toBe(true);
  });

  it("is not placed inside (auth), (dashboard), (platform-admin), or portal — those keep their own more-specific boundaries", () => {
    expect(existsSync("src/app/(auth)/error.tsx")).toBe(true);
    expect(existsSync("src/app/(dashboard)/error.tsx")).toBe(true);
    expect(existsSync("src/app/(dashboard)/(insights)/analytics/error.tsx")).toBe(true);
    expect(existsSync("src/app/(platform-admin)/error.tsx")).toBe(true);
    expect(existsSync("src/app/portal/(app)/error.tsx")).toBe(true);
    // The new boundary is exactly one file, at exactly one location — no
    // second copy was placed inside any route group.
    expect(existsSync("src/app/(auth)/error.tsx")).toBe(true);
    expect(existsSync("src/app/(dashboard)/error.tsx")).toBe(true);
  });

  it("global-error.tsx remains present and untouched by this correction", () => {
    const source = readFileSync("src/app/global-error.tsx", "utf-8");
    expect(source).toMatch(/^"use client";/);
    expect(source).toContain("<html");
  });
});
