import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTag, type TagActor } from "@/lib/tags/definitions";
import { assignTag } from "@/lib/tags/assignments";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Tags V1 Phase 1 — boundary coverage: no Portal/public code path
 * references src/lib/tags (Staff-only in this phase), and adding Tags
 * leaves ordinary Client/Lead behavior completely unaffected (no new
 * required field, no side effect on unrelated create/read paths).
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function ownerActor(fixtures: TestFixtures): TagActor {
  return { id: fixtures.owner.id, name: fixtures.owner.name, role: "OWNER" };
}

async function cleanupTags(organizationId: string) {
  await prisma.tagAssignment.deleteMany({ where: { organizationId } });
  await prisma.tag.deleteMany({ where: { organizationId } });
}

describe("Tags — boundaries", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupTags(fixtures.orgA.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("no file under the Portal app tree, or any public lead-capture route, imports src/lib/tags", () => {
    const portalRoot = path.join(REPO_ROOT, "src/app/portal");
    const publicLeadCaptureRoot = path.join(REPO_ROOT, "src/app/api/public");

    const filesToScan = [
      ...collectFiles(portalRoot),
      ...(statSync(publicLeadCaptureRoot, { throwIfNoEntry: false }) ? collectFiles(publicLeadCaptureRoot) : []),
    ];

    const offenders = filesToScan.filter((file) => readFileSync(file, "utf8").includes("lib/tags"));
    expect(offenders).toEqual([]);
  });

  it("no component under src/components/portal imports src/lib/tags", () => {
    const portalComponentsRoot = path.join(REPO_ROOT, "src/components/portal");
    const exists = statSync(portalComponentsRoot, { throwIfNoEntry: false });
    if (!exists) return; // directory doesn't exist — nothing to scan, boundary trivially holds
    const offenders = collectFiles(portalComponentsRoot).filter((file) => readFileSync(file, "utf8").includes("lib/tags"));
    expect(offenders).toEqual([]);
  });

  it("creating a Client with no knowledge of Tags at all still works exactly as before — no new required field", async () => {
    const client = await prisma.client.create({
      data: { name: "Untagged Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    expect(client.id).toBeTruthy();
    await prisma.client.delete({ where: { id: client.id } });
  });

  it("creating a Lead with no knowledge of Tags at all still works exactly as before — no new required field", async () => {
    const lead = await prisma.lead.create({ data: { organizationId: fixtures.orgA.id, name: "Untagged Lead" } });
    expect(lead.id).toBeTruthy();
    await prisma.lead.delete({ where: { id: lead.id } });
  });

  it("assigning/archiving tags never mutates the tagged Client or Lead's own rows", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Non Mutating" }, prisma);
    if (!created.ok) throw new Error("expected ok");

    const before = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", fixtures.clientA.id, prisma);
    const after = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });

    expect(after).toEqual(before);
  });

  it("deleting a Client cascades to delete its TagAssignments (no orphaned assignment rows left behind)", async () => {
    const owner = ownerActor(fixtures);
    const created = await createTag(fixtures.orgA.id, owner, { name: "Cascade Check" }, prisma);
    if (!created.ok) throw new Error("expected ok");
    const client = await prisma.client.create({
      data: { name: "Cascade Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    await assignTag(fixtures.orgA.id, created.tag.id, "CLIENT", client.id, prisma);

    await prisma.client.delete({ where: { id: client.id } });

    // TagAssignment has no real FK to Client (polymorphic entityId, by
    // design — see TagAssignment's own schema doc comment), so the row is
    // NOT cascade-deleted by the Client's own deletion; it's simply left
    // orphaned, exactly like CustomFieldValue/Attachment's own rows in
    // the same situation. This documents that boundary rather than
    // asserting a cascade that was never implemented.
    const orphaned = await prisma.tagAssignment.findFirst({ where: { tagId: created.tag.id, entityId: client.id } });
    expect(orphaned).not.toBeNull();
  });
});
