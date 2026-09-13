import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platform-admin/authorization";
import { getOrganizationDetail } from "@/lib/platform-admin/queries/organization-detail";
import { listOrganizations, parseOrganizationListParams } from "@/lib/platform-admin/queries/organizations";
import { listUsers, parseUserListParams } from "@/lib/platform-admin/queries/users";
import { getPlatformDashboardData } from "@/lib/platform-admin/queries/platform-dashboard";
import { getFailureMonitoringSummary } from "@/lib/platform-admin/queries/failure-monitoring";
import PlatformAdminConfigurationPage from "@/app/(platform-admin)/platform-admin/configuration/page";
import * as platformBillingConfig from "@/lib/billing/platform-billing-config";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";

/**
 * PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT (PASS_WITH_FINDING)
 * correction. Root cause: Next.js renders layouts and pages in parallel
 * by default (node_modules/next/dist/docs/01-app/01-getting-started/
 * 06-fetching-data.md, "Parallel data fetching") — the shared
 * (platform-admin)/layout.tsx's own requirePlatformAdmin() call protects
 * the final HTTP response, but does not stop a data-reader's own Prisma
 * calls from executing first. Deterministically reproduced against the
 * real compiled app (see the investigation's own report): an
 * unauthenticated or non-admin request to a real organization id still
 * executed the full Prisma read, even though the final response was
 * always a clean redirect.
 *
 * This file proves the fix at the layer Vitest genuinely can: real
 * Prisma call counts, against the real (test) Postgres, for every
 * protected reader, across every identity this investigation named.
 *
 * EVIDENCE BOUNDARY (disclosed honestly, matching this repo's own
 * existing precedent in test/integration/organization-setup/
 * session-stability.test.ts): React.cache()'s request-local
 * deduplication — "one real check per request, shared by the layout and
 * every reader" — only actually takes effect inside a real Next.js
 * request-scoped render. It does NOT dedupe across separate calls in
 * this bare Vitest environment (verified empirically in that same prior
 * investigation). What this file proves instead: (1) the functional
 * redirect/allow behavior of the now-cached requirePlatformAdmin() is
 * unchanged, and (2) every protected reader performs zero underlying
 * Prisma calls for both unauthorized identities, and its intended real
 * work exactly once for an allowlisted identity. Cross-call-site,
 * same-request cache deduplication is a route-level (E2E) claim,
 * covered separately in test/e2e/platform-admin-organizations.spec.ts's
 * own regression coverage — never re-claimed here as something this file
 * itself demonstrated.
 */

const PLATFORM_ADMIN_TEST_EMAIL = "platform-admin-execution-auth-test@example.com";
const NON_ADMIN_TEST_EMAIL = "not-a-platform-admin-execution-auth-test@example.com";
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await seedTestData();
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_TEST_EMAIL;
});

afterEach(() => {
  resetAuthMock();
  vi.restoreAllMocks();
});

function asUnauthenticated() {
  setMockAuthUser(null);
}

function asNonAdmin() {
  setMockAuthUser({ id: randomUUID(), email: NON_ADMIN_TEST_EMAIL });
}

function asPlatformAdmin() {
  setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
}

async function catchRedirect(fn: () => Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

describe("requirePlatformAdmin — functional behavior unchanged by the cache() wrap", () => {
  it("unauthenticated redirects to /login", async () => {
    asUnauthenticated();
    const signal = await catchRedirect(() => requirePlatformAdmin());
    expect(signal.url).toBe("/login?reason=session_expired");
  });

  it("authenticated non-admin redirects to /dashboard", async () => {
    asNonAdmin();
    const signal = await catchRedirect(() => requirePlatformAdmin());
    expect(signal.url).toBe("/dashboard");
  });

  it("allowlisted admin resolves, never redirects", async () => {
    asPlatformAdmin();
    await expect(requirePlatformAdmin()).resolves.toEqual({ email: PLATFORM_ADMIN_TEST_EMAIL });
  });
});

describe("getOrganizationDetail — execution-level guard", () => {
  it("unauthenticated: zero Prisma calls, redirects to /login, for an invalid (non-UUID) id", async () => {
    asUnauthenticated();
    const spy = vi.spyOn(prisma.organization, "findUnique");
    const signal = await catchRedirect(() => getOrganizationDetail("definitely-invalid-test-id", new Date()));
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(spy).not.toHaveBeenCalled();
  });

  it("unauthenticated: zero Prisma calls, redirects to /login, for a real, valid organization id", async () => {
    asUnauthenticated();
    const spy = vi.spyOn(prisma.organization, "findUnique");
    const signal = await catchRedirect(() => getOrganizationDetail(fixtures.orgA.id, new Date()));
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(spy).not.toHaveBeenCalled();
  });

  it("authenticated non-admin: zero Prisma calls, redirects to /dashboard, for an invalid (non-UUID) id", async () => {
    asNonAdmin();
    const spy = vi.spyOn(prisma.organization, "findUnique");
    const signal = await catchRedirect(() => getOrganizationDetail("definitely-invalid-test-id", new Date()));
    expect(signal.url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("authenticated non-admin: zero Prisma calls, redirects to /dashboard, for a real, valid organization id", async () => {
    asNonAdmin();
    const spy = vi.spyOn(prisma.organization, "findUnique");
    const signal = await catchRedirect(() => getOrganizationDetail(fixtures.orgA.id, new Date()));
    expect(signal.url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("allowlisted admin: the real reader still executes exactly once and returns real data for a valid id", async () => {
    asPlatformAdmin();
    const spy = vi.spyOn(prisma.organization, "findUnique");
    const detail = await getOrganizationDetail(fixtures.orgA.id, new Date());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(detail?.organization.id).toBe(fixtures.orgA.id);
  });

  it("allowlisted admin: existing not-found behavior (null, no throw) is unchanged for a nonexistent valid-shaped id", async () => {
    asPlatformAdmin();
    const detail = await getOrganizationDetail(randomUUID(), new Date());
    expect(detail).toBeNull();
  });
});

describe("listOrganizations — execution-level guard", () => {
  const params = parseOrganizationListParams({});

  it("unauthenticated: zero Prisma calls, redirects to /login", async () => {
    asUnauthenticated();
    const spy = vi.spyOn(prisma, "$transaction");
    const signal = await catchRedirect(() => listOrganizations(params, new Date()));
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(spy).not.toHaveBeenCalled();
  });

  it("authenticated non-admin: zero Prisma calls, redirects to /dashboard", async () => {
    asNonAdmin();
    const spy = vi.spyOn(prisma, "$transaction");
    const signal = await catchRedirect(() => listOrganizations(params, new Date()));
    expect(signal.url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("allowlisted admin: the real reader still executes and returns real data", async () => {
    asPlatformAdmin();
    const spy = vi.spyOn(prisma, "$transaction");
    const result = await listOrganizations(params, new Date());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.total).toBeGreaterThan(0);
  });
});

describe("listUsers — execution-level guard", () => {
  const params = parseUserListParams({});

  it("unauthenticated: zero Prisma calls, redirects to /login", async () => {
    asUnauthenticated();
    const spy = vi.spyOn(prisma, "$transaction");
    const signal = await catchRedirect(() => listUsers(params));
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(spy).not.toHaveBeenCalled();
  });

  it("authenticated non-admin: zero Prisma calls, redirects to /dashboard", async () => {
    asNonAdmin();
    const spy = vi.spyOn(prisma, "$transaction");
    const signal = await catchRedirect(() => listUsers(params));
    expect(signal.url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("allowlisted admin: the real reader still executes and returns real data", async () => {
    asPlatformAdmin();
    const spy = vi.spyOn(prisma, "$transaction");
    const result = await listUsers(params);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.total).toBeGreaterThan(0);
  });
});

describe("getPlatformDashboardData — execution-level guard (platform-wide aggregate)", () => {
  it("unauthenticated: zero Prisma calls, redirects to /login", async () => {
    asUnauthenticated();
    const spy = vi.spyOn(prisma.organization, "count");
    const signal = await catchRedirect(() => getPlatformDashboardData(new Date()));
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(spy).not.toHaveBeenCalled();
  });

  it("authenticated non-admin: zero Prisma calls, redirects to /dashboard", async () => {
    asNonAdmin();
    const spy = vi.spyOn(prisma.organization, "count");
    const signal = await catchRedirect(() => getPlatformDashboardData(new Date()));
    expect(signal.url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("allowlisted admin: the real reader still executes and returns real data", async () => {
    asPlatformAdmin();
    const data = await getPlatformDashboardData(new Date());
    expect(data.kpis.organizations).toBeGreaterThan(0);
  });
});

describe("getFailureMonitoringSummary — execution-level guard", () => {
  it("unauthenticated: zero Prisma calls (including the reused PDF archive-reconciliation counters), redirects to /login", async () => {
    asUnauthenticated();
    const spy = vi.spyOn(prisma.webhookEvent, "groupBy");
    // Invoice/PDF diagnostics research follow-up — countManualReviewPending()/
    // countInconsistentClaimState() (reused verbatim from reconcile-archive-
    // objects.ts) must never execute for an unauthorized caller either.
    const archiveSpy = vi.spyOn(prisma.invoicePdfArchiveObject, "count");
    const signal = await catchRedirect(() => getFailureMonitoringSummary(new Date()));
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(spy).not.toHaveBeenCalled();
    expect(archiveSpy).not.toHaveBeenCalled();
  });

  it("authenticated non-admin: zero Prisma calls (including the reused PDF archive-reconciliation counters), redirects to /dashboard", async () => {
    asNonAdmin();
    const spy = vi.spyOn(prisma.webhookEvent, "groupBy");
    const archiveSpy = vi.spyOn(prisma.invoicePdfArchiveObject, "count");
    const signal = await catchRedirect(() => getFailureMonitoringSummary(new Date()));
    expect(signal.url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
    expect(archiveSpy).not.toHaveBeenCalled();
  });

  it("allowlisted admin: the real reader still executes and returns real data, including both reused PDF archive-reconciliation counters", async () => {
    asPlatformAdmin();
    const spy = vi.spyOn(prisma.webhookEvent, "groupBy");
    // Exactly two calls: countManualReviewPending() and
    // countInconsistentClaimState() each issue their own
    // prisma.invoicePdfArchiveObject.count() — never a combined/reimplemented
    // query.
    const archiveSpy = vi.spyOn(prisma.invoicePdfArchiveObject, "count");
    await getFailureMonitoringSummary(new Date());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(archiveSpy).toHaveBeenCalledTimes(2);
  });
});

describe("Configuration page — execution-level guard (page-level exception, per the audit's own design)", () => {
  // getPlatformBranding()/getPlatformLegalConfig() are shared with fully
  // public pages (/privacy, /terms, the footer) and cannot be guarded
  // directly (see the page's own doc comment) — the guard lives in the
  // page component itself instead. getPlatformBillingConfig() is the one
  // async, single-caller reader among the six; spying on it directly
  // proves the page never reaches any of its six readers when
  // unauthorized.
  it("unauthenticated: zero calls to the billing config reader, redirects to /login", async () => {
    asUnauthenticated();
    const spy = vi.spyOn(platformBillingConfig, "getPlatformBillingConfig");
    const signal = await catchRedirect(() => PlatformAdminConfigurationPage());
    expect(signal.url).toBe("/login?reason=session_expired");
    expect(spy).not.toHaveBeenCalled();
  });

  it("authenticated non-admin: zero calls to the billing config reader, redirects to /dashboard", async () => {
    asNonAdmin();
    const spy = vi.spyOn(platformBillingConfig, "getPlatformBillingConfig");
    const signal = await catchRedirect(() => PlatformAdminConfigurationPage());
    expect(signal.url).toBe("/dashboard");
    expect(spy).not.toHaveBeenCalled();
  });

  it("allowlisted admin: the page still renders, calling the billing config reader exactly once", async () => {
    asPlatformAdmin();
    const spy = vi.spyOn(platformBillingConfig, "getPlatformBillingConfig");
    await PlatformAdminConfigurationPage();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

afterAll(async () => {
  await cleanupTestData(fixtures);
  if (ORIGINAL_PLATFORM_ADMIN_EMAILS === undefined) {
    delete process.env.PLATFORM_ADMIN_EMAILS;
  } else {
    process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
  }
});
