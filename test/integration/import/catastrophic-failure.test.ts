import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { uploadImportFileAction, previewImportAction, executeImportAction } from "@/lib/import/server-actions";
import { createLeadCore } from "@/lib/leads/create-core";
import { createClientCore } from "@/lib/clients/create-core";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";

/**
 * CSV Import partial-failure fix — the deterministic, controlled
 * reproduction the pre-push review asked for. Same real-module-mocking
 * technique already established in test/integration/clients/create.test.ts
 * and test/integration/invoices/issue.test.ts (wrap the REAL
 * implementation in vi.fn() so every other call in this file, and every
 * other test file, still calls straight through unchanged; force exactly
 * one call to reject with an unexpected Error, never a known/expected
 * rejection type). This is deliberately not a flaky real DB-outage test:
 * the failure point is exact and repeatable every run.
 *
 * createClientCore and createLeadCore share the exact same execute-loop/
 * outer-catch machinery in src/lib/import/server-actions.ts — only the
 * Lead test below exercises that shared mechanism end-to-end (imported +
 * an ordinary failed row + a catastrophic row + never-reached rows). The
 * Client-only "skipped" outcome is NOT reachable via Lead at all (no
 * dedup rule exists for Lead), so a second, shorter test below proves
 * specifically that a skipped count also survives a catastrophic failure
 * correctly — the one meaningfully entity-specific case Section 8 of the
 * fix task calls out.
 */

vi.mock("@/lib/leads/create-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads/create-core")>();
  return { ...actual, createLeadCore: vi.fn(actual.createLeadCore) };
});

vi.mock("@/lib/clients/create-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/create-core")>();
  return { ...actual, createClientCore: vi.fn(actual.createClientCore) };
});

function csvFile(content: string, name: string): File {
  return new File([content], name, { type: "text/csv" });
}

function formDataWithFile(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

describe("CSV Import — catastrophic mid-run failure", () => {
  let fixtures: TestFixtures;
  const createdLeadIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdImportJobIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  afterEach(async () => {
    resetAuthMock();
    vi.mocked(createLeadCore).mockReset();
    vi.mocked(createClientCore).mockReset();
    if (createdLeadIds.length > 0) {
      await prisma.activity.deleteMany({ where: { entityType: "LEAD", entityId: { in: createdLeadIds } } });
      await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
      createdLeadIds.length = 0;
    }
    if (createdClientIds.length > 0) {
      await prisma.clientContact.deleteMany({ where: { clientId: { in: createdClientIds } } });
      await prisma.activity.deleteMany({ where: { entityType: "CLIENT", entityId: { in: createdClientIds } } });
      await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
      createdClientIds.length = 0;
    }
    if (createdImportJobIds.length > 0) {
      await prisma.importJob.deleteMany({ where: { id: { in: createdImportJobIds } } });
      createdImportJobIds.length = 0;
    }
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("Lead: rows 1 imports, row 2 fails validation, row 3 imports, row 4 crashes catastrophically, row 5 is never reached — rows 1&3 persist, job FAILED with truthful partial counts, rawContent cleared, replay rejected, no duplicate on replay", async () => {
    const actual = await vi.importActual<typeof import("@/lib/leads/create-core")>("@/lib/leads/create-core");
    vi.mocked(createLeadCore)
      .mockImplementationOnce(actual.createLeadCore) // row 1 (call #1) — genuinely created
      .mockImplementationOnce(actual.createLeadCore) // row 3 (call #2) — genuinely created
      .mockRejectedValueOnce(new Error("Simulated catastrophic infrastructure failure — connection lost")); // row 4 (call #3)

    const suffix = randomUUID().slice(0, 8);
    actAs(fixtures.owner, fixtures.orgA.id);
    // Row 2 is a genuinely empty (but present) Name cell — a validation
    // failure, never reaching createLeadCore at all (skip_empty_lines
    // only skips a truly blank CSV line, not a quoted-empty cell).
    const csv = `Name\r\nOk-1-${suffix}\r\n""\r\nOk-2-${suffix}\r\nCrash-${suffix}\r\nNever-${suffix}\r\n`;
    const uploadResult = await uploadImportFileAction("LEAD", formDataWithFile(csvFile(csv, "leads.csv")));
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;
    createdImportJobIds.push(uploadResult.importJobId);
    expect(uploadResult.totalRows).toBe(5);

    const preview = await previewImportAction(uploadResult.importJobId, "LEAD", [{ columnIndex: 0, field: "name" }]);
    expect(preview.ok).toBe(true);

    const exec = await executeImportAction(uploadResult.importJobId, "LEAD");
    expect(exec.ok).toBe(false);
    if (exec.ok || exec.reason !== "execution_failed") throw new Error("expected execution_failed");
    expect(exec.status).toBe("FAILED");
    expect(exec.totalRows).toBe(5);
    expect(exec.importedCount).toBe(2);
    expect(exec.skippedCount).toBe(0);
    expect(exec.failedCount).toBe(1);
    // unprocessed = totalRows - imported - skipped - failed = 2 (the
    // crash row itself, and the never-reached row after it) — neither
    // is fabricated as a "failed" row.
    expect(exec.totalRows - exec.importedCount - exec.skippedCount - exec.failedCount).toBe(2);

    // Never a raw stack/error-message leak to the client.
    expect(exec.failureReason).not.toMatch(/simulated|infrastructure|connection lost|Error:|at\s+\S+:\d+/i);
    expect(exec.failureReason.length).toBeGreaterThan(0);

    const importedRows = exec.rowDetails.filter((r) => r.outcome === "imported");
    const failedRows = exec.rowDetails.filter((r) => r.outcome === "failed");
    expect(importedRows).toHaveLength(2);
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0].row).toBe(3); // row 2 is the header-relative row number for the empty-Name CSV row
    // The crash row (row 5, 1-indexed from header) never appears in
    // rowDetails at all — neither as imported nor as a fabricated failure.
    expect(exec.rowDetails.some((r) => r.row === 5)).toBe(false);
    expect(exec.rowDetails.some((r) => r.row === 6)).toBe(false);

    // Database: rows 1 and 3 genuinely committed; the crash row and the
    // never-reached row never exist at all.
    const created = await prisma.lead.findMany({
      where: { organizationId: fixtures.orgA.id, name: { in: [`Ok-1-${suffix}`, `Ok-2-${suffix}`, `Crash-${suffix}`, `Never-${suffix}`] } },
    });
    createdLeadIds.push(...created.map((l) => l.id));
    expect(created.map((l) => l.name).sort()).toEqual([`Ok-1-${suffix}`, `Ok-2-${suffix}`].sort());

    // ImportJob row itself — the actual persisted defect fix.
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: uploadResult.importJobId } });
    expect(job.status).toBe("FAILED");
    expect(job.importedCount).toBe(2);
    expect(job.skippedCount).toBe(0);
    expect(job.failedCount).toBe(1);
    expect(job.rawContent).toBeNull(); // never retained past a terminal state, even on this path
    expect(job.mappingJson).not.toBeNull(); // mapping itself is fine to keep — it's not raw file content
    expect(job.rowResultsJson).not.toBeNull();
    const storedRowResults = job.rowResultsJson as unknown as { row: number; outcome: string }[];
    expect(storedRowResults.filter((r) => r.outcome === "imported")).toHaveLength(2);
    expect(storedRowResults.filter((r) => r.outcome === "failed")).toHaveLength(1);

    // Replay is rejected — the same job can never execute twice, and no
    // duplicate Lead is ever created by attempting it.
    const replay = await executeImportAction(uploadResult.importJobId, "LEAD");
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe("already_processed");

    const afterReplayCount = await prisma.lead.count({
      where: { organizationId: fixtures.orgA.id, name: { in: [`Ok-1-${suffix}`, `Ok-2-${suffix}`] } },
    });
    expect(afterReplayCount).toBe(2); // unchanged — no re-import happened
  });

  it("Client: a skipped (duplicate-email) row's count survives a later catastrophic failure the same way an imported row's does", async () => {
    const actualCore = await vi.importActual<typeof import("@/lib/clients/create-core")>("@/lib/clients/create-core");
    vi.mocked(createClientCore)
      .mockImplementationOnce(actualCore.createClientCore) // row 1 (call #1) — genuinely created
      .mockRejectedValueOnce(new Error("Simulated catastrophic failure")); // row 3 (call #2) — the only other row that reaches createClientCore; row 2 is skipped before ever calling it

    const suffix = randomUUID().slice(0, 8);
    const existingEmail = `dup-${suffix}@example.com`;
    const existing = await prisma.client.create({
      data: { name: `Existing-${suffix}`, email: existingEmail, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    createdClientIds.push(existing.id);

    actAs(fixtures.owner, fixtures.orgA.id);
    const csv = `Name,Email\r\nOk-1-${suffix},ok1-${suffix}@example.com\r\nDup-${suffix},${existingEmail}\r\nCrash-${suffix},crash-${suffix}@example.com\r\n`;
    const uploadResult = await uploadImportFileAction("CLIENT", formDataWithFile(csvFile(csv, "clients.csv")));
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;
    createdImportJobIds.push(uploadResult.importJobId);

    const mapping = [{ columnIndex: 0, field: "name" }, { columnIndex: 1, field: "email" }];
    const preview = await previewImportAction(uploadResult.importJobId, "CLIENT", mapping);
    expect(preview.ok).toBe(true);

    const exec = await executeImportAction(uploadResult.importJobId, "CLIENT");
    expect(exec.ok).toBe(false);
    if (exec.ok || exec.reason !== "execution_failed") throw new Error("expected execution_failed");
    expect(exec.status).toBe("FAILED");
    expect(exec.importedCount).toBe(1);
    expect(exec.skippedCount).toBe(1); // the duplicate-email row's count is preserved, not lost
    expect(exec.failedCount).toBe(0);

    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: uploadResult.importJobId } });
    expect(job.skippedCount).toBe(1);
    expect(job.importedCount).toBe(1);
    expect(job.rawContent).toBeNull();

    const created = await prisma.client.findMany({
      where: { organizationId: fixtures.orgA.id, name: { in: [`Ok-1-${suffix}`, `Crash-${suffix}`] } },
    });
    createdClientIds.push(...created.map((c) => c.id));
    expect(created.map((c) => c.name)).toEqual([`Ok-1-${suffix}`]); // only the genuinely-imported row exists
  });
});
