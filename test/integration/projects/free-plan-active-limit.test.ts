import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createProjectAction } from "@/app/(dashboard)/projects/new/actions";
import { updateProjectAction } from "@/app/(dashboard)/projects/[id]/edit/actions";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Aqenra Free plan — real Server Action coverage of the active-project
 * limit (5 active projects per organization), proving the actual
 * createProjectAction/updateProjectAction write paths — not just the
 * underlying entitlements/enforcement functions already covered directly
 * in test/integration/billing/enforcement.test.ts.
 */

type Fixture = {
  owner: { id: string; email: string; name: string };
  org: { id: string; slug: string };
  client: { id: string; name: string };
  statusDefinitionIds: Record<"PLANNING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED", string>;
};

async function createFreePlanFixture(label: string): Promise<Fixture> {
  const runSuffix = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { id: randomUUID(), email: testEmail(`free-plan-proj-${label}`, "test.local", runSuffix), name: `Free Plan ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `Free Plan Org ${label}`, slug: testSlug(`free-plan-proj-${label}`, runSuffix) },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  await bootstrapOrganizationStatusDefinitions(prisma, org.id);

  const client = await prisma.client.create({
    data: { name: `Free Plan Client ${label}`, userId: owner.id, organizationId: org.id },
  });

  const definitions = await prisma.customStatusDefinition.findMany({
    where: { organizationId: org.id, entityType: "PROJECT", isSystem: true },
  });
  const statusDefinitionIds = Object.fromEntries(
    definitions.map((d) => [d.key.toUpperCase(), d.id]),
  ) as Fixture["statusDefinitionIds"];

  return { owner, org, client, statusDefinitionIds };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await prisma.project.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.client.delete({ where: { id: fixture.client.id } });
  await prisma.organization.delete({ where: { id: fixture.org.id } });
  await prisma.user.delete({ where: { id: fixture.owner.id } });
}

function buildProjectFormData(
  fixture: Fixture,
  fields: { name: string; status?: keyof Fixture["statusDefinitionIds"] },
): FormData {
  const status = fields.status ?? "PLANNING";
  const formData = new FormData();
  formData.set("name", fields.name);
  formData.set("clientId", fixture.client.id);
  formData.set("status", status);
  formData.set("statusDefinitionId", fixture.statusDefinitionIds[status]);
  return formData;
}

async function expectRedirect(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
}

const fixturesToClean: Fixture[] = [];
afterEach(async () => {
  resetAuthMock();
  while (fixturesToClean.length > 0) {
    const fixture = fixturesToClean.pop()!;
    await cleanupFixture(fixture);
  }
});

describe("createProjectAction — Aqenra Free plan active-project limit", () => {
  it("the 6th active project at the limit is rejected with the active-project message, not the generic project-limit message", async () => {
    const fixture = await createFreePlanFixture(`create-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    for (let i = 0; i < 5; i++) {
      await expectRedirect(
        createProjectAction({ error: null }, buildProjectFormData(fixture, { name: `Active ${i}`, status: "IN_PROGRESS" })),
      );
    }

    const result = await createProjectAction(
      { error: null },
      buildProjectFormData(fixture, { name: "Sixth Active", status: "IN_PROGRESS" }),
    );
    expect(result).toEqual({
      error: "Your plan's active-project limit has been reached. Complete or cancel an existing active project before activating another.",
    });

    const count = await prisma.project.count({ where: { organizationId: fixture.org.id } });
    expect(count).toBe(5); // the rejected 6th project was never created
  });

  it("creating a project directly as Completed or Cancelled never consumes an active slot, even already at the limit", async () => {
    const fixture = await createFreePlanFixture(`create-finished-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    for (let i = 0; i < 5; i++) {
      await expectRedirect(
        createProjectAction({ error: null }, buildProjectFormData(fixture, { name: `Active ${i}`, status: "IN_PROGRESS" })),
      );
    }

    await expectRedirect(
      createProjectAction({ error: null }, buildProjectFormData(fixture, { name: "Already Done", status: "COMPLETED" })),
    );

    const created = await prisma.project.findFirstOrThrow({ where: { name: "Already Done" } });
    expect(created.status).toBe("COMPLETED");
  });

  it("below the limit: a normal create succeeds and the message is accurate when later blocked", async () => {
    const fixture = await createFreePlanFixture(`create-under-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    await expectRedirect(
      createProjectAction({ error: null }, buildProjectFormData(fixture, { name: "First Project", status: "PLANNING" })),
    );
    const created = await prisma.project.findFirstOrThrow({ where: { name: "First Project" } });
    expect(created.status).toBe("PLANNING");
  });
});

describe("updateProjectAction — Aqenra Free plan active-project limit", () => {
  async function createActiveProjects(fixture: Fixture, count: number, namePrefix: string): Promise<void> {
    for (let i = 0; i < count; i++) {
      await expectRedirect(
        createProjectAction(
          { error: null },
          buildProjectFormData(fixture, { name: `${namePrefix} ${i}`, status: "IN_PROGRESS" }),
        ),
      );
    }
  }

  it("reactivating a Completed project at the limit is rejected, and the project stays Completed", async () => {
    const fixture = await createFreePlanFixture(`update-reactivate-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    await createActiveProjects(fixture, 5, "Active");
    await expectRedirect(
      createProjectAction({ error: null }, buildProjectFormData(fixture, { name: "Finished One", status: "COMPLETED" })),
    );
    const finished = await prisma.project.findFirstOrThrow({ where: { name: "Finished One" } });

    const result = await updateProjectAction(
      finished.id,
      { error: null },
      buildProjectFormData(fixture, { name: "Finished One", status: "IN_PROGRESS" }),
    );
    expect(result).toEqual({
      error: "Your plan's active-project limit has been reached. Complete or cancel an existing active project before activating another.",
    });

    const unchanged = await prisma.project.findUniqueOrThrow({ where: { id: finished.id } });
    expect(unchanged.status).toBe("COMPLETED");
  });

  it("completing an active project is always allowed, even already at the limit — it only ever frees a slot", async () => {
    const fixture = await createFreePlanFixture(`update-complete-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    await createActiveProjects(fixture, 5, "Active");
    const toComplete = await prisma.project.findFirstOrThrow({ where: { name: "Active 0" } });

    await expectRedirect(
      updateProjectAction(toComplete.id, { error: null }, buildProjectFormData(fixture, { name: "Active 0", status: "COMPLETED" })),
    );
    const updated = await prisma.project.findUniqueOrThrow({ where: { id: toComplete.id } });
    expect(updated.status).toBe("COMPLETED");
  });

  it("moving between two already-active statuses never needs the limit check, even at the limit", async () => {
    const fixture = await createFreePlanFixture(`update-active-to-active-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    await createActiveProjects(fixture, 5, "Active");
    const toMove = await prisma.project.findFirstOrThrow({ where: { name: "Active 0" } });

    await expectRedirect(
      updateProjectAction(toMove.id, { error: null }, buildProjectFormData(fixture, { name: "Active 0", status: "ON_HOLD" })),
    );
    const updated = await prisma.project.findUniqueOrThrow({ where: { id: toMove.id } });
    expect(updated.status).toBe("ON_HOLD");
  });

  it("a non-status edit (renaming) on an already-finished project is never blocked by the active-project check", async () => {
    const fixture = await createFreePlanFixture(`update-rename-finished-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    await createActiveProjects(fixture, 5, "Active");
    await expectRedirect(
      createProjectAction({ error: null }, buildProjectFormData(fixture, { name: "To Rename", status: "COMPLETED" })),
    );
    const finished = await prisma.project.findFirstOrThrow({ where: { name: "To Rename" } });

    await expectRedirect(
      updateProjectAction(finished.id, { error: null }, buildProjectFormData(fixture, { name: "Renamed", status: "COMPLETED" })),
    );
    const updated = await prisma.project.findUniqueOrThrow({ where: { id: finished.id } });
    expect(updated.name).toBe("Renamed");
    expect(updated.status).toBe("COMPLETED");
  });

  it("completed/cancelled project history remains fully readable at the limit — never hidden, never deleted", async () => {
    const fixture = await createFreePlanFixture(`update-history-${randomUUID().slice(0, 8)}`);
    fixturesToClean.push(fixture);
    actAs(fixture.owner, fixture.org.id);

    await createActiveProjects(fixture, 5, "Active");
    await expectRedirect(
      createProjectAction({ error: null }, buildProjectFormData(fixture, { name: "Old Finished Work", status: "COMPLETED" })),
    );

    const allProjects = await prisma.project.findMany({ where: { organizationId: fixture.org.id } });
    expect(allProjects).toHaveLength(6);
    expect(allProjects.some((p) => p.name === "Old Finished Work" && p.status === "COMPLETED")).toBe(true);
  });
});
