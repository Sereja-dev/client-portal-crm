import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLeadAction } from "@/app/(dashboard)/leads/actions";
import { createClientAction } from "@/app/(dashboard)/clients/new/actions";
import { createContract, sendContract, acceptContractByStaff, acceptContractByPortal } from "@/lib/contracts/service";
import { saveSlackWebhook } from "@/lib/integrations/connection";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { actAs, setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal } from "../../support/navigation-mock";
import { actorFor, contractInput, cleanupContracts } from "../contracts/helpers";
import { resetSlackMock, setSlackSendSuccess, capturedSends } from "../../support/slack-mock";

/**
 * Integrations V1 (Slack Incoming Webhook only, locked spec §40). Proves
 * the four real business-mutation hook sites — not just
 * enqueueIntegrationDelivery()'s own matching logic in isolation — by
 * calling the REAL, unmodified Server Actions/domain functions
 * (createLeadAction, createClientAction, acceptContractByStaff,
 * acceptContractByPortal) end-to-end against fixtures.orgA, with a real
 * Slack connection already CONNECTED for that organization.
 *
 * INVOICE_SENT's own hook (src/lib/invoices/pdf/issue-invoice.ts) is
 * deliberately NOT re-exercised here — issueInvoice() requires a much
 * heavier fixture/DI harness (seeded draft invoice, Storage upload/PDF
 * render dependency injection) that already has its own dedicated,
 * extensive test file (test/integration/invoices/issue.test.ts). Its
 * enqueue call is instead verified by (a) this suite's own
 * matchIntegrationEvent unit/integration coverage of the exact
 * INVOICE/STATUS_CHANGED + metadata.to === "SENT" shape issue-invoice.ts
 * writes, and (b) direct code review of the hook site itself — an
 * explicitly disclosed, narrower scope for this one call site rather than
 * a silently-skipped one.
 */
async function connectSlackForOrg(organizationId: string, actorId: string): Promise<void> {
  const result = await saveSlackWebhook({
    organizationId,
    actorId,
    actorName: "Owner",
    webhookUrl: "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX",
    label: null,
  });
  if (!result.ok) throw new Error("fixture: failed to connect Slack");
}

describe("Integrations — real business-mutation hook sites", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  beforeEach(async () => {
    resetSlackMock();
    setSlackSendSuccess();
    await connectSlackForOrg(fixtures.orgA.id, fixtures.owner.id);
    resetSlackMock(); // Clear the connect-time test send capture.
    setSlackSendSuccess();
  });

  afterEach(async () => {
    resetAuthMock();
    await prisma.integrationDelivery.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await prisma.integrationConnection.deleteMany({ where: { organizationId: fixtures.orgA.id } });
  });

  afterAll(async () => {
    // This suite's own Lead/Client rows (and the CustomStatusDefinition
    // rows bootstrapAll's own beforeAll seeded) aren't part of
    // seedTestData()'s own known fixture graph — cleaned up explicitly
    // here, before cleanupTestData(fixtures) tries to delete
    // fixtures.orgA itself, since Client.statusDefinitionId's own FK
    // would otherwise block that deletion (the same deferred-FK
    // discipline this repo's own migration headers document).
    await prisma.lead.deleteMany({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Integrations Hook" } } });
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, name: { startsWith: "Integrations Hook" } } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  it("LEAD_CREATED: createLeadAction enqueues and delivers a Slack notification", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await createLeadAction({ name: "Integrations Hook Lead" });
    expect(result.ok).toBe(true);

    const deliveries = await prisma.integrationDelivery.findMany({ where: { organizationId: fixtures.orgA.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].eventKey).toBe("LEAD_CREATED");
    expect(deliveries[0].status).toBe("DELIVERED");
    expect(capturedSends[0]?.text).toContain("New lead: Integrations Hook Lead");
  });

  it("CLIENT_CREATED: createClientAction enqueues and delivers a Slack notification", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const statusDefinition = await prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType: "CLIENT", isSystem: true },
    });
    const formData = new FormData();
    formData.set("name", "Integrations Hook Client");
    formData.set("email", `hook-client-${Date.now()}@test.local`);
    formData.set("statusDefinitionId", statusDefinition.id);

    let caught: unknown;
    try {
      await createClientAction({ error: null }, formData);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);

    const deliveries = await prisma.integrationDelivery.findMany({ where: { organizationId: fixtures.orgA.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].eventKey).toBe("CLIENT_CREATED");
    expect(deliveries[0].status).toBe("DELIVERED");
    expect(capturedSends[0]?.text).toContain("New client: Integrations Hook Client");
  });

  describe("CONTRACT_ACCEPTED", () => {
    let contractIds: string[] = [];

    afterEach(async () => {
      await cleanupContracts(contractIds);
      contractIds = [];
    });

    it("acceptContractByStaff enqueues and delivers a Slack notification", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { title: "Hook Staff MSA" }));
      if (!created.ok) throw new Error("fixture setup failed");
      contractIds.push(created.contract.id);
      await sendContract(fixtures.orgA.id, created.contract.id, owner);

      const result = await acceptContractByStaff(fixtures.orgA.id, created.contract.id, owner);
      expect(result.ok).toBe(true);

      const deliveries = await prisma.integrationDelivery.findMany({ where: { organizationId: fixtures.orgA.id } });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].eventKey).toBe("CONTRACT_ACCEPTED");
      expect(deliveries[0].status).toBe("DELIVERED");
      expect(capturedSends[0]?.text).toContain("Contract signed: Hook Staff MSA");
    });

    it("acceptContractByPortal (client-side signature) ALSO enqueues and delivers — matched purely on the Activity shape, not the actor", async () => {
      const owner = actorFor(fixtures.owner, "OWNER");
      const created = await createContract(fixtures.orgA.id, owner, contractInput(fixtures.clientA.id, { title: "Hook Portal MSA" }));
      if (!created.ok) throw new Error("fixture setup failed");
      contractIds.push(created.contract.id);
      await sendContract(fixtures.orgA.id, created.contract.id, owner);

      setMockAuthUser({ id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      const result = await acceptContractByPortal(created.contract.id);
      expect(result.ok).toBe(true);

      const deliveries = await prisma.integrationDelivery.findMany({ where: { organizationId: fixtures.orgA.id } });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].eventKey).toBe("CONTRACT_ACCEPTED");
      expect(deliveries[0].status).toBe("DELIVERED");
      expect(capturedSends[0]?.text).toContain("Contract signed: Hook Portal MSA");
    });
  });
});
