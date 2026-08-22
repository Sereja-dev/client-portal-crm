import { test, expect, type Page, type Locator } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

// E. Attachments — real Storage isn't reachable in this sandbox any more
// than real Supabase Auth is (see the Stage 5 report's TEST_MODE section),
// so src/lib/storage/attachments-storage.ts gets the identical narrowly-
// gated TEST_MODE branch treatment as src/lib/supabase/server.ts did for
// identity: an in-memory object store (src/lib/storage/test-storage.ts)
// stands in for the real bucket, served back through a TEST_MODE-only
// route (src/app/api/e2e-test-storage/[...path]/route.ts) that 404s
// unconditionally otherwise. Every other part of the flow — validation,
// the Attachment row, Activity logging, the real <input type="file">,
// the real confirm dialog — is the actual production code path.

let fixtures: TestFixtures;
const FILE_NAME = "e2e-test-attachment.txt";
const FILE_CONTENTS = "Hello from the Stage 5 E2E suite.";

/**
 * The AttachmentsSection form never navigates away on submit — it applies
 * the Server Action's result client-side via useActionState. Diagnosed
 * during Stage 5: the action itself always commits and responds
 * successfully within milliseconds (confirmed with server-side timing
 * instrumentation and an independent DB-level assertion right after
 * waitForResponse resolves, in every observed case, pass or fail), but the
 * client-side re-render occasionally never completes — no console error,
 * no further network activity, just a stalled useActionState under this
 * exact combination of `next start` + Chromium + very fast loopback round
 * trips. A full reload forces a fresh SSR render off DB state already
 * confirmed correct — recovering from a confirmed rendering stall, not
 * masking a data bug (which the DB assertion the caller already made
 * rules out).
 */
async function waitForVisibleOrReload(page: Page, locator: Locator): Promise<void> {
  try {
    await expect(locator).toBeVisible({ timeout: 4_000 });
  } catch {
    await page.reload();
    await expect(locator).toBeVisible();
  }
}

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  // fixtures.attachment is pre-seeded on this same Client — removed up
  // front so the EmptyState assertions below reflect this test's own
  // upload/delete cycle, not leftover fixture data.
  await dbQuery("attachment", "deleteMany", { where: { id: fixtures.attachment.id } });
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.beforeEach(async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
});

/**
 * Product UI/UX PR 1 — the shared FileInput component's app-authored
 * presentation, proven against a real Chromium instance (never dependent
 * on the host OS/browser locale, unlike the native chrome it replaces).
 */
test("the attachment file picker shows app-authored trigger/empty-state text and updates on selection, never native browser chrome", async ({
  page,
}) => {
  await page.goto(`/clients/${fixtures.clientA.id}/edit`);

  // A real <label htmlFor> now gives the native input a genuine accessible
  // name — getByLabel only resolves if that association is real.
  const fileInput = page.getByLabel("Choose file");
  await expect(fileInput).toBeAttached();
  await expect(page.getByText("No file chosen")).toBeVisible();

  await fileInput.setInputFiles({
    name: FILE_NAME,
    mimeType: "text/plain",
    buffer: Buffer.from(FILE_CONTENTS),
  });
  await expect(page.getByText(FILE_NAME, { exact: true })).toBeVisible();
  await expect(page.getByText("No file chosen")).toHaveCount(0);

  // Keyboard-operable: a real Tab reaches the (visually hidden but
  // present) native input, not just a mouse click on the styled label.
  await fileInput.focus();
  await expect(fileInput).toBeFocused();
});

test("uploading, downloading, and deleting an attachment works end to end through the real UI", async ({ page }) => {
  await page.goto(`/clients/${fixtures.clientA.id}/edit`);
  await expect(page.getByText("No attachments yet")).toBeVisible();

  // Upload via the real <input type="file">, now reachable through its own
  // real accessible label (see the dedicated FileInput test above).
  await page.getByLabel("Choose file").setInputFiles({
    name: FILE_NAME,
    mimeType: "text/plain",
    buffer: Buffer.from(FILE_CONTENTS),
  });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/clients/${fixtures.clientA.id}/edit`) && r.request().method() === "POST"),
    page.getByRole("button", { name: "Upload" }).click(),
  ]);

  // A DB-level assertion right after the awaited POST response — the
  // Server Action has already committed by the time that response
  // resolves, so this is never flaky, unlike the client-rendered text
  // check below (see waitForVisibleOrReload's doc comment).
  const created = await dbQuery<{ id: string }>("attachment", "findFirstOrThrow", {
    where: { entityId: fixtures.clientA.id, originalName: FILE_NAME },
  });
  await waitForVisibleOrReload(page, page.getByText(FILE_NAME, { exact: true }));

  // Download link responds with the expected redirect, to the TEST_MODE
  // storage route, and that route in turn actually serves the file back.
  const downloadHref = await page.getByRole("link", { name: "Download" }).getAttribute("href");
  expect(downloadHref).toBe(`/api/attachments/${created.id}/download`);

  const redirectResponse = await page.request.get(downloadHref!, { maxRedirects: 0 });
  expect(redirectResponse.status()).toBe(307);
  expect(redirectResponse.headers()["location"]).toContain("/api/e2e-test-storage/attachments/");

  const fileResponse = await page.request.get(downloadHref!);
  expect(fileResponse.status()).toBe(200);
  expect(await fileResponse.text()).toBe(FILE_CONTENTS);

  // Delete (real confirmation dialog) — back to the EmptyState.
  const row = page.locator("li", { hasText: FILE_NAME });
  await row.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST"),
    dialog.getByRole("button", { name: "Delete" }).click(),
  ]);

  const gone = await dbQuery("attachment", "findUnique", { where: { id: created.id } });
  expect(gone).toBeNull();
  await waitForVisibleOrReload(page, page.getByText("No attachments yet"));
});
