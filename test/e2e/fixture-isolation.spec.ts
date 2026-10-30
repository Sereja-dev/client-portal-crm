import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Regression: one spec's leftovers must never poison later specs.
 *
 * Root cause this guards (CI: 96 of 145 spec files never ran): every seeded
 * graph used the same CI run id, so its emails were identical. When a request
 * still carrying a test session reached the app after a spec's afterAll had
 * deleted the users, the app's own getOrCreateUser() upsert re-created the
 * deleted owner — same email, no organization — and the NEXT spec's seed failed
 * with "Unique constraint failed on the fields: (email)", as did every spec
 * after it.
 *
 * This reproduces that request on purpose (the real session cookie, after the
 * users are gone) instead of relying on a timing race.
 */

async function actAsOwner(context: BrowserContext, baseURL: string, fixtures: TestFixtures): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

const userRow = (id: string) => dbQuery<{ id: string } | null>("user", "findUnique", { where: { id }, select: { id: true } });

test("a late request after cleanup cannot poison the next seed, and cleanup converges", async ({ page, context, baseURL }) => {
  const created: TestFixtures[] = [];
  try {
    const first = await seedE2EFixtures();
    created.push(first);
    await actAsOwner(context, baseURL!, first);
    await page.goto("/dashboard");
    await expect(page.getByText("Test Org A").first()).toBeVisible();

    // What a spec's afterAll does…
    await cleanupTestData(first);
    expect(await userRow(first.owner.id)).toBeNull();

    // …and a late request with the still-valid session cookie, as in CI.
    await page.goto("/dashboard");
    test.info().annotations.push({
      type: "owner re-created by the late request",
      description: String((await userRow(first.owner.id)) !== null),
    });

    // The next spec's seed used to fail here with a unique-email violation.
    const second = await seedE2EFixtures();
    created.push(second);
    expect(second.owner.email).not.toBe(first.owner.email);
    expect(second.orgA.slug).not.toBe(first.orgA.slug);

    // Cleaning the first graph again removes whatever the late request left,
    // and never touches the second graph.
    await cleanupTestData(first);
    expect(await userRow(first.owner.id)).toBeNull();
    expect(await userRow(second.owner.id)).not.toBeNull();
    expect(await dbQuery<number>("organization", "count", { where: { id: { in: [second.orgA.id, second.orgB.id] } } })).toBe(2);
  } finally {
    for (const fixtures of created) await cleanupTestData(fixtures);
  }
});

test("seeding twice in a row (a retried file re-seeding before cleanup) does not collide", async () => {
  const created: TestFixtures[] = [];
  try {
    created.push(await seedE2EFixtures());
    created.push(await seedE2EFixtures());
    expect(created[0].owner.email).not.toBe(created[1].owner.email);
    expect(created[0].invoice.invoiceNumber).not.toBe(created[1].invoice.invoiceNumber);
  } finally {
    for (const fixtures of created) await cleanupTestData(fixtures);
  }
});
