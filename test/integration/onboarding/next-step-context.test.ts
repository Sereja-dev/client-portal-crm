import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role, type ClientStatus, type ProjectStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { buildVisibleOnboardingProgress } from "@/lib/onboarding/visible-progress";
import { resolveOnboardingCtaHref } from "@/lib/onboarding/next-step-context";
import type { OnboardingRawSignals } from "@/lib/onboarding/progress";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testSlug } from "../../support/run-id";

// First-Time User Experience V2, Slice C against the real (PGlite) database:
// organization scoping, eligibility applied BEFORE take: 2, cross-tenant
// isolation, and the "no query when not applicable" guarantee.

let fixtures: TestFixtures;
const orgIds: string[] = [];

function signals(overrides: Partial<OnboardingRawSignals> = {}): OnboardingRawSignals {
  return {
    hasClient: true,
    hasProject: false,
    hasTask: false,
    hasInvoice: false,
    hasSecondMember: false,
    hasPortalUser: false,
    hasCompanyProfile: true,
    hasPaymentDetails: false,
    hasDomainSettings: false,
    hasPresetApplication: false,
    actedStepKeys: new Set(),
    ...overrides,
  };
}

const projectStep = () => buildVisibleOnboardingProgress(signals(), Role.OWNER);
const taskStep = () => buildVisibleOnboardingProgress(signals({ hasProject: true }), Role.OWNER);

async function newOrg(label: string) {
  const org = await prisma.organization.create({ data: { name: `Ctx ${label}`, slug: testSlug(`ctx-${label}-${randomUUID().slice(0, 6)}`) } });
  orgIds.push(org.id);
  return org.id;
}

async function addClient(organizationId: string, status: ClientStatus) {
  return prisma.client.create({
    data: { name: `Ctx-${randomUUID().slice(0, 6)}`, organizationId, userId: fixtures.owner.id, status },
  });
}

async function addProject(organizationId: string, clientId: string, status: ProjectStatus) {
  return prisma.project.create({
    data: { name: `Ctx-${randomUUID().slice(0, 6)}`, organizationId, clientId, ownerId: fixtures.owner.id, status },
  });
}

beforeAll(async () => {
  fixtures = await seedTestData();
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.client.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await cleanupTestData(fixtures);
});

const href = (organizationId: string, progress = projectStep(), isDismissed = false) =>
  resolveOnboardingCtaHref({ organizationId, progress, isDismissed });

describe("Create first project — eligible Client resolution", () => {
  it("exactly one eligible client -> its id", async () => {
    const org = await newOrg("one");
    const client = await addClient(org, "LEAD");
    expect(await href(org)).toBe(`/projects/new?clientId=${client.id}`);
  });

  it("eligibility is applied BEFORE take: 2 — archived clients never crowd out the single eligible one", async () => {
    const org = await newOrg("crowd");
    await addClient(org, "ARCHIVED");
    await addClient(org, "ARCHIVED");
    await addClient(org, "ARCHIVED");
    const eligible = await addClient(org, "ACTIVE");
    expect(await href(org)).toBe(`/projects/new?clientId=${eligible.id}`);
  });

  it("only archived clients -> generic; two eligible (plus archived) -> generic; INACTIVE and LEAD stay eligible", async () => {
    const onlyArchived = await newOrg("arch");
    await addClient(onlyArchived, "ARCHIVED");
    expect(await href(onlyArchived)).toBeNull();

    const two = await newOrg("two");
    await addClient(two, "ACTIVE");
    await addClient(two, "INACTIVE");
    await addClient(two, "ARCHIVED");
    expect(await href(two)).toBeNull();

    const inactive = await newOrg("inactive");
    const only = await addClient(inactive, "INACTIVE");
    expect(await href(inactive)).toBe(`/projects/new?clientId=${only.id}`);
  });

  it("is organization-scoped: another organization's single client is never used", async () => {
    const mine = await newOrg("mine");
    const theirs = await newOrg("theirs");
    await addClient(theirs, "ACTIVE");
    expect(await href(mine)).toBeNull();
    const own = await addClient(mine, "ACTIVE");
    expect(await href(mine)).toBe(`/projects/new?clientId=${own.id}`);
    expect(await href(theirs)).not.toContain(own.id);
  });
});

describe("Create first task — eligible Project resolution", () => {
  it("exactly one eligible project -> its id, no from=project", async () => {
    const org = await newOrg("p1");
    const client = await addClient(org, "ACTIVE");
    const project = await addProject(org, client.id, "IN_PROGRESS");
    const result = await href(org, taskStep());
    expect(result).toBe(`/tasks/new?projectId=${project.id}`);
    expect(result).not.toContain("from=");
  });

  it("COMPLETED and CANCELLED projects are excluded before take: 2; PLANNING and ON_HOLD stay eligible", async () => {
    const org = await newOrg("p2");
    const client = await addClient(org, "ACTIVE");
    await addProject(org, client.id, "COMPLETED");
    await addProject(org, client.id, "CANCELLED");
    await addProject(org, client.id, "COMPLETED");
    const eligible = await addProject(org, client.id, "ON_HOLD");
    expect(await href(org, taskStep())).toBe(`/tasks/new?projectId=${eligible.id}`);

    const two = await newOrg("p3");
    const c2 = await addClient(two, "ACTIVE");
    await addProject(two, c2.id, "PLANNING");
    await addProject(two, c2.id, "ON_HOLD");
    expect(await href(two, taskStep())).toBeNull();

    const none = await newOrg("p4");
    const c3 = await addClient(none, "ACTIVE");
    await addProject(none, c3.id, "COMPLETED");
    expect(await href(none, taskStep())).toBeNull();
  });

  it("is organization-scoped", async () => {
    const mine = await newOrg("pm");
    const theirs = await newOrg("pt");
    const c = await addClient(theirs, "ACTIVE");
    await addProject(theirs, c.id, "IN_PROGRESS");
    expect(await href(mine, taskStep())).toBeNull();
  });
});

describe("no query when not applicable", () => {
  let clientSpy: ReturnType<typeof vi.spyOn>;
  let projectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clientSpy = vi.spyOn(prisma.client, "findMany");
    projectSpy = vi.spyOn(prisma.project, "findMany");
  });

  it("dismissed, complete, and other next steps run no candidate query; an applicable step runs exactly one bounded query", async () => {
    const org = await newOrg("spy");
    await addClient(org, "ACTIVE");
    clientSpy.mockClear();

    await href(org, projectStep(), true);
    await href(org, buildVisibleOnboardingProgress(signals({ hasProject: true, hasTask: true, hasSecondMember: true }), Role.OWNER));
    await href(org, buildVisibleOnboardingProgress(signals({ hasClient: false }), Role.OWNER));
    expect(clientSpy).not.toHaveBeenCalled();
    expect(projectSpy).not.toHaveBeenCalled();

    await href(org, projectStep());
    expect(clientSpy).toHaveBeenCalledTimes(1);
    expect(clientSpy.mock.calls[0][0]).toMatchObject({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true }, take: 2 });
    expect(projectSpy).not.toHaveBeenCalled();
  });
});
