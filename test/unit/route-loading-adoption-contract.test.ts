import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product UI/UX PR 4 — source-contract coverage for the new route
 * `loading.tsx` files (Product UI/UX Design Investigation, finding F5).
 *
 * This file proves three things directly from source, never by
 * assumption:
 *  1. exactly the intended routes received a new `loading.tsx` — no more,
 *     no fewer;
 *  2. every new `loading.tsx` is a pure, server-renderable presentation
 *     file — no hooks/effects/fetch/Prisma/Server Action/client directive,
 *     no timers/random/Date/env-driven behavior;
 *  3. the routes F5 did NOT name, and the segments this task's own scope
 *     forbids (login/signup/reset flows, Platform Admin, creation forms,
 *     Invoice duplicate, cron/API routes, Portal invoice/project detail),
 *     received nothing.
 */

const INTENDED_NEW_LOADING_FILES = [
  "src/app/(dashboard)/clients/[id]/edit/loading.tsx",
  "src/app/(dashboard)/projects/[id]/edit/loading.tsx",
  "src/app/(dashboard)/tasks/[id]/edit/loading.tsx",
  "src/app/(dashboard)/invoices/[id]/edit/loading.tsx",
  "src/app/(dashboard)/team/loading.tsx",
  "src/app/(dashboard)/settings/company/loading.tsx",
  "src/app/(dashboard)/settings/domain/loading.tsx",
  "src/app/(dashboard)/settings/notifications/loading.tsx",
  "src/app/(dashboard)/settings/payment/loading.tsx",
  "src/app/portal/(app)/profile/loading.tsx",
];

// Every route this task must NOT add a loading.tsx to — either because
// F5 never named it, or because this task's own forbidden-scope list
// excludes it (auth flows, Platform Admin, creation forms, Invoice
// duplicate, cron/API routes, Portal invoice/project detail, and any
// route-group root, which would silently blanket unrelated siblings).
const FORBIDDEN_NEW_LOADING_FILES = [
  "src/app/(auth)/login/loading.tsx",
  "src/app/(auth)/signup/loading.tsx",
  "src/app/(auth)/forgot-password/loading.tsx",
  "src/app/(auth)/reset-password/loading.tsx",
  // Platform Admin Users' own loading.tsx was forbidden here because, at
  // the time this list was written, Users was a synchronous placeholder
  // shell with no async work at all — a loading.tsx would have been
  // dead code. A later PR (#127) replaced the shell with a real,
  // DB-backed paginated read (listUsers()), and a subsequent PR added
  // the loading state itself once that async work existed. That
  // original rationale no longer applies, so this entry is
  // intentionally removed here — not an oversight, and not a weakening
  // of any other entry in this list.
  "src/app/(dashboard)/clients/new/loading.tsx",
  "src/app/(dashboard)/projects/new/loading.tsx",
  "src/app/(dashboard)/tasks/new/loading.tsx",
  "src/app/(dashboard)/invoices/new/loading.tsx",
  "src/app/(dashboard)/invoices/[id]/duplicate/loading.tsx",
  "src/app/(dashboard)/invoices/[id]/loading.tsx",
  "src/app/(dashboard)/clients/[id]/loading.tsx",
  "src/app/(dashboard)/projects/[id]/loading.tsx",
  "src/app/(dashboard)/tasks/[id]/loading.tsx",
  "src/app/portal/(app)/invoices/[id]/loading.tsx",
  "src/app/portal/(app)/projects/[id]/loading.tsx",
  "src/app/(dashboard)/loading.tsx",
  "src/app/portal/(app)/loading.tsx",
  "src/app/(platform-admin)/loading.tsx",
];

// Segment error.tsx boundaries (PR #96) that must survive this PR
// untouched — a new loading.tsx must never replace or remove one.
const EXISTING_ERROR_BOUNDARIES = [
  "src/app/(platform-admin)/error.tsx",
  "src/app/(auth)/error.tsx",
  "src/app/(dashboard)/error.tsx",
  "src/app/portal/(app)/error.tsx",
  "src/app/(dashboard)/(insights)/analytics/error.tsx",
];

describe("route loading adoption — exactly the intended routes, no more, no fewer", () => {
  it.each(INTENDED_NEW_LOADING_FILES)("%s exists", (path) => {
    expect(existsSync(path), `expected ${path} to exist`).toBe(true);
  });

  it.each(FORBIDDEN_NEW_LOADING_FILES)("%s was NOT added", (path) => {
    expect(existsSync(path), `expected ${path} to NOT exist`).toBe(false);
  });

  it("the pre-existing settings/billing/loading.tsx was not duplicated or removed", () => {
    expect(existsSync("src/app/(dashboard)/settings/billing/loading.tsx")).toBe(true);
  });

  it.each(EXISTING_ERROR_BOUNDARIES)("existing segment error boundary %s still exists (never replaced by a loading.tsx)", (path) => {
    expect(existsSync(path), `expected ${path} to still exist`).toBe(true);
  });
});

describe("every new loading.tsx is a pure, server-renderable presentation file", () => {
  it.each(INTENDED_NEW_LOADING_FILES)("%s has a default export and no client directive", (path) => {
    const source = readFileSync(path, "utf-8");
    expect(source).toMatch(/export default function \w+/);
    expect(source).not.toMatch(/"use client"/);
    expect(source).not.toMatch(/"use server"/);
  });

  it.each(INTENDED_NEW_LOADING_FILES)("%s has no hooks, effects, fetch, Prisma, Server Action, or auth/tenant import", (path) => {
    const source = readFileSync(path, "utf-8");
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(source).not.toMatch(/useEffect|useState/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/from ["']@\/lib\/prisma["']/);
    expect(source).not.toMatch(/from ["']@\/lib\/current-user["']/);
    expect(source).not.toMatch(/from ["']@\/lib\/current-portal-user["']/);
    expect(source).not.toMatch(/actions["']/);
  });

  it.each(INTENDED_NEW_LOADING_FILES)("%s has no timer, random, current-time, or environment-driven trigger", (path) => {
    const source = readFileSync(path, "utf-8");
    expect(source).not.toMatch(/setTimeout|setInterval|Math\.random|new Date\(\)|process\.env/);
  });

  it.each(INTENDED_NEW_LOADING_FILES)("%s renders exactly one RouteLoadingAnnouncement (one clear loading status per page boundary)", (path) => {
    const source = readFileSync(path, "utf-8");
    const occurrences = (source.match(/<RouteLoadingAnnouncement\b/g) ?? []).length;
    expect(occurrences, `${path}: expected exactly one RouteLoadingAnnouncement`).toBe(1);
  });

  // @/components/ui/surface (CARD_SURFACE_CLASSES) added post-F5, by the
  // Aqenra Round 3 Design System wrap-up: settings/domain/loading.tsx's
  // one card box needed the same opaque-surface treatment its own real
  // page already uses, and no raw-light fallback exists for it. It is
  // just as inert as the two originally-approved specifiers below — a
  // single exported string constant, zero imports of its own, zero
  // hooks/effects/fetch/Prisma/Server Action/timer/random/Date/env — so
  // permitting it here preserves this contract's actual protective
  // intent (no behavioral/runtime-heavy import in a loading boundary)
  // rather than merely its original literal wording.
  const ALLOWED_LOADING_IMPORT_SPECIFIERS = [
    "@/components/ui/page-loading",
    "@/components/ui/skeleton",
    "@/components/ui/surface",
  ];

  it.each(INTENDED_NEW_LOADING_FILES)(
    "%s imports its shared skeleton pieces only from an approved static UI module (page-loading, skeleton, or surface)",
    (path) => {
      const source = readFileSync(path, "utf-8");
      const importLines = source.match(/^import .+$/gm) ?? [];
      for (const line of importLines) {
        const fromMatch = line.match(/from\s+["']([^"']+)["']/);
        expect(fromMatch).not.toBeNull();
        const specifier = fromMatch![1];
        expect(
          ALLOWED_LOADING_IMPORT_SPECIFIERS.includes(specifier),
          `${path}: unexpected import "${specifier}"`,
        ).toBe(true);
      }
    },
  );
});
