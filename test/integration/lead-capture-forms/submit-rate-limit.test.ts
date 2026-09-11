import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { submitLeadCaptureFormAction } from "@/app/forms/[token]/actions";
import { createLeadCaptureForm } from "@/lib/lead-capture-forms/forms";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { checkRateLimit, LEAD_CAPTURE_SUBMIT_LIMIT, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * 15. Public Lead Capture Forms, Phase 1 — rate limiting on the public
 * submission Server Action. Same file-local mocking convention as
 * test/integration/leads/create-rate-limit.test.ts's own header comment:
 * only checkRateLimit() itself is replaced, so this proves the action's
 * real wiring (which config, which identifier) without exhausting the
 * real in-memory bucket.
 */
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const mockedCheckRateLimit = vi.mocked(checkRateLimit);

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("submitLeadCaptureFormAction — rate limiting", () => {
  let fixtures: TestFixtures;
  let publicToken: string;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    const created = await createLeadCaptureForm(fixtures.orgA.id, { name: "Form", title: "Title" });
    if (!created.ok) throw new Error("expected ok");
    publicToken = created.form.publicToken;
  });

  beforeEach(() => {
    mockedCheckRateLimit.mockReset().mockReturnValue({ limited: false });
  });

  afterEach(async () => {
    await prisma.lead.deleteMany({ where: { organizationId: fixtures.orgA.id } });
  });

  afterAll(async () => {
    await prisma.leadCaptureForm.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  it("a request below the limit succeeds — the lead is created normally", async () => {
    const result = await submitLeadCaptureFormAction(publicToken, { error: null }, formData({ name: "Jane" }));
    expect(result.success).toBe(true);
    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } })).toBe(1);
  });

  it("a request above the limit is rejected, and no Lead row is created", async () => {
    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });

    const result = await submitLeadCaptureFormAction(publicToken, { error: null }, formData({ name: "Jane" }));

    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(await prisma.lead.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("uses LEAD_CAPTURE_SUBMIT_LIMIT specifically, keyed by request IP", async () => {
    await submitLeadCaptureFormAction(publicToken, { error: null }, formData({ name: "Jane" }));

    expect(mockedCheckRateLimit).toHaveBeenCalledWith(LEAD_CAPTURE_SUBMIT_LIMIT, expect.any(String));
  });

  it("the rate limit is checked before any database read — a limited request never even resolves the token", async () => {
    mockedCheckRateLimit.mockReturnValue({ limited: true, message: RATE_LIMIT_MESSAGE });

    // An invalid token would otherwise surface as the generic
    // "not available" error — proving the rate-limit branch fires first
    // shows it short-circuits before that lookup ever runs.
    const result = await submitLeadCaptureFormAction("00000000-0000-0000-0000-000000000000", { error: null }, formData({ name: "Jane" }));

    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
  });
});
