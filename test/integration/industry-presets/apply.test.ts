import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyIndustryPreset } from "@/lib/industry-presets/apply";
import { previewIndustryPreset } from "@/lib/industry-presets/preview";
import { getOrganizationOnboardingProgress } from "@/lib/onboarding/progress";
import { skipOnboardingStepAction } from "@/lib/onboarding/actions";
import { createTag } from "@/lib/tags/definitions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import type { IndustryPresetActor } from "@/lib/industry-presets/authorization";

// Same technique test/integration/comments/create.test.ts already
// established for forcing a real, unexpected mid-transaction failure:
// wrap the real createTag so it can be made to reject exactly once,
// while every other call still runs its real implementation.
vi.mock("@/lib/tags/definitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tags/definitions")>();
  return { ...actual, createTag: vi.fn(actual.createTag) };
});

/**
 * Industry Presets V1 — integration coverage (locked spec §17.B, 21
 * required cases). Exercises the real domain functions
 * (applyIndustryPreset/previewIndustryPreset) directly, against a real
 * (PGlite-backed) database, using seedTestData's own orgA/orgB/owner/
 * admin/member fixtures for role and tenant-isolation coverage.
 */

async function actorFor(fixtures: TestFixtures, who: "owner" | "admin" | "member"): Promise<IndustryPresetActor> {
  const user = fixtures[who];
  const role = who === "owner" ? "OWNER" : who === "admin" ? "ADMIN" : "MEMBER";
  return { id: user.id, name: user.name, role };
}

/**
 * Same technique test/integration/invoices/invoice-number-organization-
 * uniqueness.test.ts's own "real concurrent creates" test already
 * establishes for this exact PGlite-backed harness: two overlapping
 * callers (launched without awaiting one before the other) race a real
 * unique-index insert. This harness's own pg.Pool is capped at max: 1
 * (src/lib/prisma.ts), so the two calls' actual database transactions
 * are physically serialized on that one connection, not genuinely
 * overlapping -- the database-level mutual-exclusion guarantee itself
 * comes from PostgreSQL's own unique-constraint semantics, not from
 * anything observable here. Polling for the eventual end state (rather
 * than asserting it immediately) tolerates that serialization/queueing
 * settling a moment after a promise resolves. A poll timeout is never
 * itself treated as success -- whatever was last observed is asserted
 * explicitly by the caller.
 */
async function pollUntilStable<T>(
  check: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2000,
  intervalMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (predicate(value)) return value;
    } catch {
      // Retried below.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}

async function cleanupPresetArtifacts(organizationId: string) {
  await prisma.presetApplication.deleteMany({ where: { organizationId } });
  await prisma.customFieldOption.deleteMany({ where: { definition: { organizationId } } });
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId } });
  await prisma.customStatusDefinition.deleteMany({ where: { organizationId, isSystem: false } });
  await prisma.tagAssignment.deleteMany({ where: { organizationId } });
  await prisma.tag.deleteMany({ where: { organizationId } });
  await prisma.organizationOnboardingStep.deleteMany({ where: { organizationId, step: "INDUSTRY_PRESET" } });
}

describe("Industry Presets V1 — apply/preview integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgB.id);
  });

  afterEach(async () => {
    vi.mocked(createTag).mockClear();
    resetAuthMock();
    await cleanupPresetArtifacts(fixtures.orgA.id);
    await cleanupPresetArtifacts(fixtures.orgB.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("1. applies to an org with only normal system statuses -> preset statuses/fields/options/tags created, PresetApplication created", async () => {
    const owner = await actorFor(fixtures, "owner");
    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(result.ok).toBe(true);
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");

    expect(result.summary.addedStatuses).toHaveLength(6);
    expect(result.summary.skippedStatuses).toHaveLength(0);
    expect(result.summary.addedFields).toHaveLength(6);
    expect(result.summary.skippedFields).toHaveLength(0);
    expect(result.summary.addedTags).toHaveLength(4);
    expect(result.summary.skippedTags).toHaveLength(0);

    const application = await prisma.presetApplication.findUnique({
      where: { organizationId: fixtures.orgA.id },
    });
    expect(application).not.toBeNull();
    expect(application?.presetKey).toBe("freelancer");
    expect(application?.presetVersion).toBe(1);
    expect(application?.appliedByUserId).toBe(owner.id);

    const statuses = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, isSystem: false },
    });
    expect(statuses).toHaveLength(6);
    expect(statuses.every((s) => !s.isDefault)).toBe(true);

    const selectField = await prisma.customFieldDefinition.findFirst({
      where: { organizationId: fixtures.orgA.id, key: "preferred_contact_method" },
    });
    expect(selectField).not.toBeNull();
    const options = await prisma.customFieldOption.findMany({ where: { definitionId: selectField!.id } });
    expect(options.map((o) => o.value)).toEqual(["email", "phone", "messaging"]);

    const tags = await prisma.tag.findMany({ where: { organizationId: fixtures.orgA.id } });
    expect(tags.map((t) => t.name).sort()).toEqual(["One-off", "Priority", "Referral", "Retainer"]);
  });

  it("2. an existing status conflict is skipped -- no key_2 duplicate", async () => {
    const owner = await actorFor(fixtures, "owner");
    // Pre-seed an exact-key conflict.
    await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "negotiation",
        label: "Negotiation (pre-existing)",
        position: 100,
        isSystem: false,
        isDefault: false,
      },
    });

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");
    expect(result.summary.skippedStatuses.some((s) => s.key === "negotiation")).toBe(true);
    expect(result.summary.addedStatuses.some((s) => s.key === "negotiation")).toBe(false);

    const negotiationRows = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: { startsWith: "negotiation" } },
    });
    expect(negotiationRows).toHaveLength(1);
    expect(negotiationRows[0].label).toBe("Negotiation (pre-existing)");
  });

  it("3. an existing ARCHIVED status conflict is still skipped -- never restored", async () => {
    const owner = await actorFor(fixtures, "owner");
    const archived = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "PROJECT",
        key: "revisions",
        label: "Revisions (archived)",
        position: 100,
        isSystem: false,
        isDefault: false,
        archivedAt: new Date(),
      },
    });

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");
    expect(result.summary.skippedStatuses.some((s) => s.key === "revisions")).toBe(true);

    const stillArchived = await prisma.customStatusDefinition.findUnique({ where: { id: archived.id } });
    expect(stillArchived?.archivedAt).not.toBeNull();
    const revisionsRows = await prisma.customStatusDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "PROJECT", key: "revisions" },
    });
    expect(revisionsRows).toHaveLength(1);
  });

  it("4. an existing custom-field conflict is skipped -- no duplicate", async () => {
    const owner = await actorFor(fixtures, "owner");
    await prisma.customFieldDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "budget",
        label: "Budget (pre-existing)",
        fieldType: "NUMBER",
        required: false,
        position: 100,
      },
    });

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");
    expect(result.summary.skippedFields.some((f) => f.key === "budget")).toBe(true);

    const budgetRows = await prisma.customFieldDefinition.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", key: "budget" },
    });
    expect(budgetRows).toHaveLength(1);
    expect(budgetRows[0].label).toBe("Budget (pre-existing)");
  });

  it("5. an existing ARCHIVED custom-field conflict is skipped", async () => {
    const owner = await actorFor(fixtures, "owner");
    const archived = await prisma.customFieldDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "PROJECT",
        key: "project_type",
        label: "Project Type (archived)",
        fieldType: "TEXT",
        required: false,
        position: 100,
        archivedAt: new Date(),
      },
    });

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");
    expect(result.summary.skippedFields.some((f) => f.key === "project_type")).toBe(true);

    const stillArchived = await prisma.customFieldDefinition.findUnique({ where: { id: archived.id } });
    expect(stillArchived?.archivedAt).not.toBeNull();
  });

  it("6. an existing tag with the same normalized name is skipped", async () => {
    const owner = await actorFor(fixtures, "owner");
    await createTag(fixtures.orgA.id, owner, { name: "retainer" }, prisma);

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");
    expect(result.summary.skippedTags.some((t) => t.name === "Retainer")).toBe(true);

    const retainerTags = await prisma.tag.findMany({ where: { organizationId: fixtures.orgA.id, normalizedName: "retainer" } });
    expect(retainerTags).toHaveLength(1);
    expect(retainerTags[0].name).toBe("retainer");
  });

  it("7. an existing ARCHIVED tag conflict is skipped -- never restored", async () => {
    const owner = await actorFor(fixtures, "owner");
    const created = await createTag(fixtures.orgA.id, owner, { name: "One-off" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    await prisma.tag.update({ where: { id: created.tag.id }, data: { archivedAt: new Date() } });

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");
    expect(result.summary.skippedTags.some((t) => t.name === "One-off")).toBe(true);

    const stillArchived = await prisma.tag.findUnique({ where: { id: created.tag.id } });
    expect(stillArchived?.archivedAt).not.toBeNull();
  });

  it("8. mixed conflicts -- safe items created, conflicts skipped, summary is truthful", async () => {
    const owner = await actorFor(fixtures, "owner");
    await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "negotiation",
        label: "Negotiation",
        position: 100,
        isSystem: false,
        isDefault: false,
      },
    });
    await createTag(fixtures.orgA.id, owner, { name: "Priority" }, prisma);

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!result.ok || result.alreadyApplied) throw new Error("expected a fresh apply");
    expect(result.summary.skippedStatuses.map((s) => s.key)).toEqual(["negotiation"]);
    expect(result.summary.addedStatuses).toHaveLength(5);
    expect(result.summary.skippedTags.map((t) => t.name)).toEqual(["Priority"]);
    expect(result.summary.addedTags).toHaveLength(3);
    expect(result.summary.addedFields).toHaveLength(6);
    expect(result.summary.skippedFields).toHaveLength(0);
  });

  it("9. same-preset replay: a second apply creates nothing, only one PresetApplication, row counts unchanged", async () => {
    const owner = await actorFor(fixtures, "owner");
    const first = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!first.ok || first.alreadyApplied) throw new Error("expected a fresh apply");

    const statusCountBefore = await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
    const fieldCountBefore = await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgA.id } });
    const tagCountBefore = await prisma.tag.count({ where: { organizationId: fixtures.orgA.id } });

    const second = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.alreadyApplied).toBe(true);

    const applications = await prisma.presetApplication.findMany({ where: { organizationId: fixtures.orgA.id } });
    expect(applications).toHaveLength(1);
    expect(await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, isSystem: false } })).toBe(statusCountBefore);
    expect(await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgA.id } })).toBe(fieldCountBefore);
    expect(await prisma.tag.count({ where: { organizationId: fixtures.orgA.id } })).toBe(tagCountBefore);
  });

  it("10. applying a different preset after one is already applied is blocked, creates nothing", async () => {
    const owner = await actorFor(fixtures, "owner");
    const first = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    if (!first.ok || first.alreadyApplied) throw new Error("expected a fresh apply");

    const statusCountBefore = await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, isSystem: false } });

    const second = await applyIndustryPreset(fixtures.orgA.id, owner, "creative_agency");
    expect(second.ok).toBe(false);
    if (second.ok || second.reason !== "PRESET_SWITCH_NOT_SUPPORTED") throw new Error("expected a switch rejection");
    expect(second.existingPresetKey).toBe("freelancer");

    expect(await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, isSystem: false } })).toBe(statusCountBefore);
    const applications = await prisma.presetApplication.findMany({ where: { organizationId: fixtures.orgA.id } });
    expect(applications).toHaveLength(1);
    expect(applications[0].presetKey).toBe("freelancer");
  });

  it("11. an unknown preset key is rejected, creates nothing", async () => {
    const owner = await actorFor(fixtures, "owner");
    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "not_a_real_preset");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("UNKNOWN_PRESET");
    expect(await prisma.presetApplication.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("12. OWNER can apply", async () => {
    const owner = await actorFor(fixtures, "owner");
    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(result.ok).toBe(true);
  });

  it("13. ADMIN can apply", async () => {
    const admin = await actorFor(fixtures, "admin");
    const result = await applyIndustryPreset(fixtures.orgA.id, admin, "freelancer");
    expect(result.ok).toBe(true);
  });

  it("14. MEMBER cannot apply", async () => {
    const member = await actorFor(fixtures, "member");
    const result = await applyIndustryPreset(fixtures.orgA.id, member, "freelancer");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("FORBIDDEN");
    expect(await prisma.presetApplication.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("15. tenant isolation -- applying to Org A changes zero rows in Org B", async () => {
    const owner = await actorFor(fixtures, "owner");
    const orgBStatusCountBefore = await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgB.id } });
    const orgBFieldCountBefore = await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgB.id } });
    const orgBTagCountBefore = await prisma.tag.count({ where: { organizationId: fixtures.orgB.id } });

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(result.ok).toBe(true);

    expect(await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgB.id } })).toBe(orgBStatusCountBefore);
    expect(await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgB.id } })).toBe(orgBFieldCountBefore);
    expect(await prisma.tag.count({ where: { organizationId: fixtures.orgB.id } })).toBe(orgBTagCountBefore);
    expect(await prisma.presetApplication.count({ where: { organizationId: fixtures.orgB.id } })).toBe(0);
  });

  it("16. transaction rollback: a forced real mid-apply failure rolls back the PresetApplication row itself (inserted first) along with every already-written status/field/option/tag", async () => {
    const owner = await actorFor(fixtures, "owner");
    vi.mocked(createTag).mockRejectedValueOnce(new Error("simulated failure"));

    await expect(applyIndustryPreset(fixtures.orgA.id, owner, "freelancer")).rejects.toThrow("simulated failure");

    expect(await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id, isSystem: false } })).toBe(0);
    expect(await prisma.customFieldDefinition.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
    expect(await prisma.customFieldOption.count({ where: { definition: { organizationId: fixtures.orgA.id } } })).toBe(0);
    expect(await prisma.tag.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
    expect(await prisma.presetApplication.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("17. status defaults are unchanged -- LEAD's default remains the system NEW definition", async () => {
    const owner = await actorFor(fixtures, "owner");
    const leadDefaultBefore = await prisma.customStatusDefinition.findFirst({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", isDefault: true },
    });
    expect(leadDefaultBefore?.isSystem).toBe(true);
    expect(leadDefaultBefore?.key).toBe("new");

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(result.ok).toBe(true);

    const leadDefaultAfter = await prisma.customStatusDefinition.findFirst({
      where: { organizationId: fixtures.orgA.id, entityType: "LEAD", isDefault: true },
    });
    expect(leadDefaultAfter?.id).toBe(leadDefaultBefore?.id);
    expect(leadDefaultAfter?.key).toBe("new");
    expect(leadDefaultAfter?.isSystem).toBe(true);
  });

  it("18. no Workflow side effects -- zero WorkflowAutomation rows, zero WorkflowAutomationRun rows", async () => {
    const owner = await actorFor(fixtures, "owner");
    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(result.ok).toBe(true);

    expect(await prisma.workflowAutomation.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
    expect(await prisma.workflowAutomationRun.count({ where: { workflowAutomation: { organizationId: fixtures.orgA.id } } })).toBe(0);
  });

  it("19. no Activity side effects attributable to preset application", async () => {
    const owner = await actorFor(fixtures, "owner");
    const activityCountBefore = await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } });

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(result.ok).toBe(true);

    expect(await prisma.activity.count({ where: { organizationId: fixtures.orgA.id } })).toBe(activityCountBefore);
  });

  it("20. onboarding completion: applying a preset makes INDUSTRY_PRESET complete", async () => {
    const owner = await actorFor(fixtures, "owner");
    const before = await getOrganizationOnboardingProgress(fixtures.orgA.id);
    expect(before.steps.find((s) => s.key === "INDUSTRY_PRESET")?.status).toBe("NOT_STARTED");

    const result = await applyIndustryPreset(fixtures.orgA.id, owner, "freelancer");
    expect(result.ok).toBe(true);

    const after = await getOrganizationOnboardingProgress(fixtures.orgA.id);
    const step = after.steps.find((s) => s.key === "INDUSTRY_PRESET");
    expect(step?.status).toBe("COMPLETE");
    expect(step?.completionSource).toBe("computed");
  });

  it("21. onboarding skip: the existing skip mechanism marks INDUSTRY_PRESET skipped without creating a PresetApplication", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const skipResult = await skipOnboardingStepAction("INDUSTRY_PRESET");
    expect(skipResult).toEqual({ ok: true });

    const progress = await getOrganizationOnboardingProgress(fixtures.orgA.id);
    const step = progress.steps.find((s) => s.key === "INDUSTRY_PRESET");
    expect(step?.status).toBe("SKIPPED");
    expect(step?.completionSource).toBe("skipped");
    expect(await prisma.presetApplication.count({ where: { organizationId: fixtures.orgA.id } })).toBe(0);
  });

  it("22. concurrent SAME-preset apply: exactly one succeeds, the other resolves idempotently, no raw Prisma error escapes, no duplicate configuration", async () => {
    const owner = await actorFor(fixtures, "owner");

    // Two overlapping callers -- neither call is awaited before the
    // other starts (same technique test/integration/invoices/invoice-
    // number-organization-uniqueness.test.ts's own "real concurrent
    // creates" test uses). This harness's pg.Pool max: 1 (src/lib/
    // prisma.ts) physically serializes the two calls' actual database
    // transactions, so this does not exercise genuine PostgreSQL lock
    // contention between overlapping transactions -- it validates the
    // application's own race-path classification: both callers can
    // reach the point of attempting the singleton PresetApplication
    // insert, and the loser's real P2002 against
    // PresetApplication.organizationId's own @unique index must still
    // resolve to a truthful product-level result, never a raw error.
    // The "at most one row per organization" guarantee itself comes
    // from that unique constraint (Postgres enforces it unconditionally
    // regardless of how many rows race to insert), not from anything
    // this test can directly observe under this harness.
    const [a, b] = await Promise.allSettled([
      applyIndustryPreset(fixtures.orgA.id, owner, "freelancer"),
      applyIndustryPreset(fixtures.orgA.id, owner, "freelancer"),
    ]);

    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    if (a.status !== "fulfilled" || b.status !== "fulfilled") throw new Error("expected no raw error");
    const results = [a.value, b.value];

    const succeeded = results.filter((r) => r.ok && !r.alreadyApplied);
    const idempotent = results.filter((r) => r.ok && r.alreadyApplied);
    expect(succeeded).toHaveLength(1);
    expect(idempotent).toHaveLength(1);

    const applications = await pollUntilStable(
      () => prisma.presetApplication.findMany({ where: { organizationId: fixtures.orgA.id } }),
      (rows) => rows.length === 1,
    );
    expect(applications).toHaveLength(1);
    expect(applications[0].presetKey).toBe("freelancer");

    // Exactly one preset's worth of configuration survives -- no
    // duplicate/suffixed rows from the loser (it never got past the
    // first insert, so it never wrote any).
    const statuses = await pollUntilStable(
      () => prisma.customStatusDefinition.findMany({ where: { organizationId: fixtures.orgA.id, isSystem: false } }),
      (rows) => rows.length === 6,
    );
    expect(statuses).toHaveLength(6);
    expect(new Set(statuses.map((s) => s.key)).size).toBe(6);
    const tags = await prisma.tag.findMany({ where: { organizationId: fixtures.orgA.id } });
    expect(tags).toHaveLength(4);
  });

  it("23. concurrent DIFFERENT-preset apply: exactly one wins, the other returns PRESET_SWITCH_NOT_SUPPORTED naming the real winner, zero configuration unique to the losing preset survives", async () => {
    const owner = await actorFor(fixtures, "owner");

    // Two overlapping callers, same PGlite max: 1 caveat as test 22
    // above (see that test's own comment) -- this validates race-path
    // classification for two DIFFERENT presets, not genuine PostgreSQL
    // lock contention.
    const [a, b] = await Promise.allSettled([
      applyIndustryPreset(fixtures.orgA.id, owner, "freelancer"),
      applyIndustryPreset(fixtures.orgA.id, owner, "creative_agency"),
    ]);

    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    if (a.status !== "fulfilled" || b.status !== "fulfilled") throw new Error("expected no raw error");
    const results = [a.value, b.value];

    const succeeded = results.filter((r) => r.ok && !r.alreadyApplied);
    const blocked = results.filter((r) => !r.ok && r.reason === "PRESET_SWITCH_NOT_SUPPORTED");
    expect(succeeded).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    // Deliberately does not assume which preset wins -- concurrent
    // scheduling is nondeterministic (locked spec §7); the loser's own
    // existingPresetKey must simply name whichever preset actually won.
    const winnerKey = succeeded[0].ok && !succeeded[0].alreadyApplied ? succeeded[0].summary.presetKey : null;
    if (!blocked[0].ok && blocked[0].reason === "PRESET_SWITCH_NOT_SUPPORTED") {
      expect(blocked[0].existingPresetKey).toBe(winnerKey);
    }

    const applications = await pollUntilStable(
      () => prisma.presetApplication.findMany({ where: { organizationId: fixtures.orgA.id } }),
      (rows) => rows.length === 1,
    );
    expect(applications).toHaveLength(1);
    expect(applications[0].presetKey).toBe(winnerKey);

    // Representative items that exist in exactly ONE of the two presets
    // (never both), so their presence/absence unambiguously proves which
    // preset's configuration survived: freelancer-only LEAD status
    // "discovery_scheduled" vs. creative_agency-only LEAD status
    // "brief_received"; freelancer-only tag "One-off" vs. creative_agency
    // -only tag "UI/UX".
    const freelancerOnlyStatus = await prisma.customStatusDefinition.findFirst({
      where: { organizationId: fixtures.orgA.id, key: "discovery_scheduled" },
    });
    const creativeOnlyStatus = await prisma.customStatusDefinition.findFirst({
      where: { organizationId: fixtures.orgA.id, key: "brief_received" },
    });
    const freelancerOnlyTag = await prisma.tag.findFirst({ where: { organizationId: fixtures.orgA.id, name: "One-off" } });
    const creativeOnlyTag = await prisma.tag.findFirst({ where: { organizationId: fixtures.orgA.id, name: "UI/UX" } });

    if (winnerKey === "freelancer") {
      expect(freelancerOnlyStatus).not.toBeNull();
      expect(freelancerOnlyTag).not.toBeNull();
      expect(creativeOnlyStatus).toBeNull();
      expect(creativeOnlyTag).toBeNull();
    } else {
      expect(creativeOnlyStatus).not.toBeNull();
      expect(creativeOnlyTag).not.toBeNull();
      expect(freelancerOnlyStatus).toBeNull();
      expect(freelancerOnlyTag).toBeNull();
    }
  });

  it("preview: server-derived, no writes -- shows ADD for a fresh org and SKIP for a real conflict", async () => {
    const owner = await actorFor(fixtures, "owner");
    await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "negotiation",
        label: "Negotiation",
        position: 100,
        isSystem: false,
        isDefault: false,
      },
    });

    const before = await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id } });
    const result = await previewIndustryPreset(fixtures.orgA.id, "freelancer", owner.role);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.preview.statuses.find((s) => s.key === "negotiation")?.decision).toBe("SKIP");
    expect(result.preview.statuses.find((s) => s.key === "follow_up")?.decision).toBe("ADD");
    expect(result.preview.canApply).toBe(true);
    expect(result.preview.alreadyApplied).toBe(false);
    // No writes -- the pre-seeded conflict row is the only row present.
    expect(await prisma.customStatusDefinition.count({ where: { organizationId: fixtures.orgA.id } })).toBe(before);
  });

  it("preview: MEMBER sees canApply: false; unknown preset key is rejected", async () => {
    const member = await actorFor(fixtures, "member");
    const result = await previewIndustryPreset(fixtures.orgA.id, "freelancer", member.role);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.preview.canApply).toBe(false);

    const unknown = await previewIndustryPreset(fixtures.orgA.id, "not_a_real_preset", member.role);
    expect(unknown.ok).toBe(false);
  });
});
