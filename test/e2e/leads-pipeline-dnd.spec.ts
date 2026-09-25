import { test, expect, type BrowserContext, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Leads Pipeline V1 (Section 5-12, 31, 32) — real-browser coverage for
 * cross-stage drag & drop on the desktop Pipeline board. Mirrors
 * test/e2e/leads-pipeline.spec.ts's own established fixture/locator
 * technique exactly (bootstrapLeadStatuses, desktopColumn/moveToSelect
 * helpers) — this file only adds what that one doesn't cover: real
 * pointer-driven drag gestures, the LOST-drop-opens-dialog flow, a
 * converted Lead's own undraggable state, a rejected-move reconciling
 * back to real server state, and proof that DnD never regresses the
 * existing accessible fallback.
 */

async function setActiveOrg(context: BrowserContext, baseURL: string, organizationId: string): Promise<void> {
  await context.addCookies([
    {
      name: "active_organization_id",
      value: organizationId,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function actAsMember(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await setActiveOrg(context, baseURL, organizationId);
}

const NAME_PREFIX = "E2E-DnD-Lead";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

// Byte-for-byte copy of leads-pipeline.spec.ts's own bootstrapLeadStatuses.
async function bootstrapLeadStatuses(organizationId: string): Promise<void> {
  await dbQuery("customStatusDefinition", "createMany", {
    data: [
      { organizationId, entityType: "LEAD", key: "new", label: "New", color: "NEUTRAL", position: 0, isDefault: true, isSystem: true },
      { organizationId, entityType: "LEAD", key: "contacted", label: "Contacted", color: "INFO", position: 1, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "qualified", label: "Qualified", color: "INFO", position: 2, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "proposal", label: "Proposal", color: "INFO", position: 3, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "won", label: "Won", color: "SUCCESS", position: 4, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "lost", label: "Lost", color: "DANGER", position: 5, isDefault: false, isSystem: true },
    ],
  });
}

// Same technique leads-pipeline.spec.ts's own desktopColumn() already
// establishes and documents at length — see that file for the full
// reasoning (both the desktop board and the mobile switcher are always
// in the DOM; only the desktop board renders a <h2>).
function desktopColumn(page: Page, label: string) {
  return page.locator("section").filter({ has: page.locator("h2", { hasText: new RegExp(`^${label}`) }) });
}

/**
 * Scopes to LeadPipelineBoard's own `<div className="md:hidden">`
 * wrapper around MobileStageSwitcher — needed because the very same
 * Lead's card also always exists in the DOM inside the (CSS-hidden, not
 * DOM-absent) desktop board, which — unlike the mobile switcher — DOES
 * render a real drag handle (dndEnabled is a render-time prop, not a
 * viewport-conditional one); an unscoped query would match that one
 * instead.
 */
function mobileSwitcher(page: Page) {
  return page.locator("div.md\\:hidden");
}

function moveToSelect(column: Locator, name: string) {
  return column.getByLabel(`Change ${name}'s status`);
}

function dragHandle(column: Locator, name: string) {
  return column.getByLabel(`Drag ${name} to a different stage`);
}

/**
 * DesktopBoard's own real scrollable row — `<div className="hidden
 * md:block"><DesktopBoard .../></div>` and DesktopBoard's own return is
 * directly `<div className="flex items-start gap-4 overflow-x-auto
 * pb-2">`, so this direct-child selector resolves to exactly that one
 * element. Deliberately NOT a bare `.overflow-x-auto` class selector —
 * confirmed directly during this feature's own development that other,
 * unrelated elements elsewhere on this page (e.g. inside the sidebar)
 * also carry that utility class and a bare selector can silently match
 * the wrong one.
 */
function boardRow(page: Page): Locator {
  return page.locator(".hidden.md\\:block > .overflow-x-auto");
}

async function readBoardMetrics(page: Page): Promise<{ scrollWidth: number; scrollLeft: number; clientWidth: number }> {
  return boardRow(page).evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    scrollLeft: el.scrollLeft,
    clientWidth: el.clientWidth,
  }));
}

/**
 * A real pointer-driven drag from one column to another. Deliberately
 * NOT Playwright's own built-in `locator.dragTo()` — that performs a
 * single instantaneous mouse jump from source to target, which does not
 * reliably activate dnd-kit's own PointerSensor (its activation-distance
 * constraint and internal drag state machine need real, successive
 * `pointermove` events to recognize an actual drag gesture, not one
 * synchronous jump). Multiple intermediate `mouse.move` steps plus a
 * short pause before release mirror how a real user's own drag
 * naturally arrives at the target.
 *
 * The dashboard content column is capped at max-w-7xl (Section layout.tsx),
 * so DesktopBoard's own row (overflow-x-auto) is genuinely narrower than
 * its 6+ columns regardless of the test viewport's own width — New and a
 * later column (Lost, or a custom column past it) are never both
 * on-screen at once without scrolling. DndContext's default `autoScroll`
 * (never disabled here — a real, wanted enhancement for exactly this
 * layout, not something this test should turn off) scrolls that row
 * whenever the pointer sits near its edge.
 *
 * A later column's own pre-drag `boundingBox()` can report an x well
 * PAST the real viewport's own width (getBoundingClientRect is a plain
 * layout position, not clamped to what's actually on-screen) — feeding
 * that raw, off-viewport coordinate straight into `page.mouse.move`
 * confirmed directly to make dnd-kit's autoscroll compute a huge,
 * effectively-unbounded "distance past the edge" and scroll the row at
 * runaway speed, never converging. The approach move below is clamped to
 * just inside the real viewport first — a realistic "hovering near the
 * edge" position — so autoscroll runs at its own normal, bounded speed
 * and the row's own live position settles once Lost/Nurture actually
 * scrolls into view; only then does one final corrective move land on
 * its now on-screen, stable center before dropping.
 */
async function dragCardToColumn(page: Page, handle: Locator, targetColumn: Locator): Promise<void> {
  const sourceBox = await handle.boundingBox();
  const initialTargetBox = await targetColumn.boundingBox();
  const viewport = page.viewportSize();
  if (!sourceBox || !initialTargetBox || !viewport) {
    throw new Error("dragCardToColumn: missing bounding box for source/target, or no viewport");
  }
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const EDGE_MARGIN = 20;
  const approachX = Math.min(initialTargetBox.x + initialTargetBox.width / 2, viewport.width - EDGE_MARGIN);
  const approachY = Math.min(initialTargetBox.y + initialTargetBox.height / 2, viewport.height - EDGE_MARGIN);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // A small, deliberate first move past the 8px activation-distance
  // constraint, its own real event, before the longer traversal to the
  // target — a single big jump can otherwise arrive as one pointermove
  // whose activation and "now dragging" recognition race each other.
  await page.mouse.move(startX + 15, startY + 15, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.move(approachX, approachY, { steps: 20 });

  let previousBox = await targetColumn.boundingBox();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await page.waitForTimeout(150);
    const liveBox = await targetColumn.boundingBox();
    if (
      previousBox &&
      liveBox &&
      Math.abs(liveBox.x - previousBox.x) < 1 &&
      Math.abs(liveBox.y - previousBox.y) < 1
    ) {
      break;
    }
    previousBox = liveBox;
  }

  const finalBox = previousBox ?? initialTargetBox;
  await page.mouse.move(finalBox.x + finalBox.width / 2, finalBox.y + finalBox.height / 2, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

let fixtures: TestFixtures;

test.describe("Leads Pipeline — drag & drop (desktop)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    await bootstrapLeadStatuses(fixtures.orgA.id);
  });

  test.afterAll(async () => {
    await dbQuery("lead", "deleteMany", { where: { name: { startsWith: NAME_PREFIX } } });
    await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id, isSystem: false } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("normal move: dragging a card from New to Contacted persists via the real server action, and the select still works afterward", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline");

    await dragCardToColumn(page, dragHandle(desktopColumn(page, "New"), name), desktopColumn(page, "Contacted"));

    await expect(page.getByText("Status updated")).toBeVisible();
    await expect(desktopColumn(page, "Contacted").getByText(name)).toBeVisible();
    await expect(desktopColumn(page, "New").getByText(name)).toHaveCount(0);

    const lead = await dbQuery<{ stage: string }>("lead", "findFirstOrThrow", { where: { name } });
    expect(lead.stage).toBe("CONTACTED");

    // The existing accessible <select> fallback is still fully present
    // and functional on the now-moved card (Section 7/32) — DnD never
    // replaces it.
    const movedCard = desktopColumn(page, "Contacted").locator("li", { hasText: name });
    await moveToSelect(movedCard, name).selectOption({ label: "Qualified" });
    await expect(page.getByText("Status updated")).toBeVisible();
    await expect(desktopColumn(page, "Qualified").getByText(name)).toBeVisible();
  });

  test("same-stage drop is a no-op: no mutation, no toast, the card stays exactly where it was", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline");

    await dragCardToColumn(page, dragHandle(desktopColumn(page, "New"), name), desktopColumn(page, "New"));

    await expect(page.getByText("Status updated")).toHaveCount(0);
    await expect(desktopColumn(page, "New").getByText(name)).toBeVisible();

    const lead = await dbQuery<{ stage: string }>("lead", "findFirstOrThrow", { where: { name } });
    expect(lead.stage).toBe("NEW");
  });

  test("dragging onto LOST opens the existing lost-reason dialog without mutating anything; Cancel leaves the Lead unchanged", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline");

    await dragCardToColumn(page, dragHandle(desktopColumn(page, "New"), name), desktopColumn(page, "Lost"));

    await expect(page.getByRole("heading", { name: "Mark lead lost" })).toBeVisible();
    // No mutation yet (Section 10 — step 3): the card is still in New,
    // still visible there, while the dialog is open.
    await expect(desktopColumn(page, "New").getByText(name)).toBeVisible();

    // Scoped for the same reason as the confirm-flow test below — every
    // card's own (closed) MarkLeadLostDialog is in the DOM too.
    await page.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();
    await expect(desktopColumn(page, "New").getByText(name)).toBeVisible();
    await expect(desktopColumn(page, "Lost").getByText(name)).toHaveCount(0);

    const lead = await dbQuery<{ stage: string; lostReason: string | null }>("lead", "findFirstOrThrow", { where: { name } });
    expect(lead.stage).toBe("NEW");
    expect(lead.lostReason).toBeNull();
  });

  test("dragging onto LOST, then confirming with a reason, moves the Lead to LOST and persists that reason via the existing markLeadLostAction", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline");

    await dragCardToColumn(page, dragHandle(desktopColumn(page, "New"), name), desktopColumn(page, "Lost"));
    await expect(page.getByRole("heading", { name: "Mark lead lost" })).toBeVisible();

    // Every rendered card (desktop AND mobile copies, for every Lead this
    // whole describe block has created so far — cleanup only runs in
    // afterAll) mounts its own MarkLeadLostDialog, so an unscoped
    // getByLabel matches every one of those closed dialogs' own "Reason"
    // textarea too (a plain <dialog>, not conditionally unmounted when
    // closed — same always-in-DOM pattern this file's own mobileSwitcher
    // comment already documents for cards). `dialog[open]` narrows to the
    // one dialog actually open right now — LeadPipelineBoard's own,
    // opened by requestMarkLost above.
    await page.locator("dialog[open]").getByLabel("Reason (optional)").fill("Budget cut");
    await page.locator("dialog[open]").getByRole("button", { name: "Mark lost" }).click();

    await expect(page.getByText("Lead marked lost")).toBeVisible();
    await expect(desktopColumn(page, "Lost").getByText(name)).toBeVisible();

    const lead = await dbQuery<{ stage: string; lostReason: string | null }>("lead", "findFirstOrThrow", { where: { name } });
    expect(lead.stage).toBe("LOST");
    expect(lead.lostReason).toBe("Budget cut");
  });

  test("a converted Lead has no drag handle at all and cannot be dragged", async ({ page }) => {
    const client = await dbQuery<{ id: string }>("client", "create", {
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const name = uniqueName();
    await dbQuery("lead", "create", {
      data: {
        name,
        organizationId: fixtures.orgA.id,
        stage: "WON",
        convertedClientId: client.id,
        convertedAt: new Date().toISOString(),
      },
    });
    await page.goto("/leads?view=pipeline");

    const wonCard = desktopColumn(page, "Won").locator("li", { hasText: name });
    await expect(wonCard).toBeVisible();
    await expect(dragHandle(desktopColumn(page, "Won"), name)).toHaveCount(0);

    await dbQuery("client", "deleteMany", { where: { id: client.id } });
  });

  test("a rejected move (target status archived mid-flight) reconciles the board to real server state, never leaving the card stranded", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    const customDef = await dbQuery<{ id: string; key: string }>("customStatusDefinition", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: `${NAME_PREFIX.toLowerCase()}-custom-${randomUUID().slice(0, 6)}`,
        label: "Nurture",
        position: 6,
        isDefault: false,
        isSystem: false,
      },
    });

    await page.goto("/leads?view=pipeline");
    await expect(desktopColumn(page, "Nurture")).toBeVisible();

    // Archive the target status right before the drop — assignLeadStatusDefinitionAction's
    // own real "status_archived" rejection path (Section 9/11/26).
    await dbQuery("customStatusDefinition", "update", {
      where: { id: customDef.id },
      data: { archivedAt: new Date().toISOString() },
    });

    await dragCardToColumn(page, dragHandle(desktopColumn(page, "New"), name), desktopColumn(page, "Nurture"));

    await expect(page.getByText("This status is archived and can't be assigned.")).toBeVisible();
    // Reconciled to real server state: the Lead never actually moved.
    await expect(desktopColumn(page, "New").getByText(name)).toBeVisible();

    const lead = await dbQuery<{ statusDefinitionId: string | null }>("lead", "findFirstOrThrow", { where: { name } });
    expect(lead.statusDefinitionId).not.toBe(customDef.id);

    await dbQuery("customStatusDefinition", "deleteMany", { where: { id: customDef.id } });
  });

  test("accessibility fallback: the native stage <select> remains fully present and keyboard-usable on every card, DnD or not", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline");

    const card = desktopColumn(page, "New").locator("li", { hasText: name });
    const select = moveToSelect(card, name);
    await expect(select).toBeVisible();
    await select.focus();
    await expect(select).toBeFocused();
    await select.selectOption({ label: "Contacted" });
    await expect(page.getByText("Status updated")).toBeVisible();
    await expect(desktopColumn(page, "Contacted").getByText(name)).toBeVisible();
  });

  test("mobile (390px): the single-stage switcher still uses the plain accessible select, never drag & drop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline&stageView=NEW");

    // The mobile switcher never enables DnD (Section 12) — no drag
    // handle at all there, only the select. Scoped to the mobile
    // switcher's own DOM subtree — the same Lead's desktop-board card
    // (always present too, just CSS-hidden) does have a real handle.
    await expect(mobileSwitcher(page).getByLabel(`Drag ${name} to a different stage`)).toHaveCount(0);
    const select = mobileSwitcher(page).getByLabel(`Change ${name}'s status`);
    await expect(select).toBeVisible();
    await select.selectOption({ label: "Contacted" });
    await expect(page.getByText("Status updated")).toBeVisible();
  });

  test("a normal organization with real columns still renders the Pipeline board's own stage nav (not the empty-column fallback)", async ({ page }) => {
    // A small adjacent contrast check for the empty-column test below —
    // fixtures.orgA (this file's own shared org) is bootstrapped in
    // beforeAll, so this is the "columns.length > 0" side of the same
    // branch. The exhaustive "normal Pipeline renders" case is already
    // covered at length by leads-pipeline.spec.ts's own suite.
    //
    // Creates its own Lead rather than relying on any earlier test in
    // this file having left one behind — this test must pass whether run
    // alone, filtered, or in any order (Section 8): with zero Leads,
    // page.tsx's own top-level "No leads yet" EmptyState would intercept
    // before LeadPipelineBoard ever mounts, which is a different branch
    // entirely from the one this test means to exercise.
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/leads?view=pipeline&stageView=NEW");
    await expect(mobileSwitcher(page).getByRole("navigation", { name: "Pipeline stage" })).toBeVisible();
    await expect(mobileSwitcher(page).getByText("No leads", { exact: true })).toHaveCount(0);
  });

  test("Escape cancels an in-flight drag: the DragOverlay copy clears, the Lead's stage is unchanged in the database, no dialog or toast fires, and the select remains usable afterward", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline");

    // LeadPipelineCardPreview (LeadPipelineBoard's own <DragOverlay>
    // content) is the only <li> anywhere on this page carrying
    // `shadow-lg` — CARD_SURFACE_CLASSES itself has no shadow utility
    // (src/components/ui/surface.ts) — so this is real DOM evidence that
    // a second, moving copy of the card exists, not an inference from
    // internal React state.
    const overlayCard = page.locator("li.shadow-lg", { hasText: name });
    await expect(overlayCard).toHaveCount(0);

    const handle = dragHandle(desktopColumn(page, "New"), name);
    const box = await handle.boundingBox();
    if (!box) throw new Error("missing bounding box for the drag handle");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Past the 8px activation-distance constraint — the same real
    // pointer-activation gesture dragCardToColumn's own helper uses,
    // confirmed (see that helper's own header comment) to reliably
    // activate dnd-kit's PointerSensor.
    await page.mouse.move(startX + 40, startY + 10, { steps: 10 });
    await page.waitForTimeout(150);

    // The overlay is genuinely active mid-drag.
    await expect(overlayCard).toHaveCount(1);

    // dnd-kit's own AbstractPointerSensor (the shared base class behind
    // PointerSensor/MouseSensor/TouchSensor — confirmed directly in
    // node_modules/@dnd-kit/core) attaches a document-level keydown
    // listener the instant a pointer gesture starts tracking, calling
    // its own handleCancel() on Escape — this is real, built-in dnd-kit
    // behavior for a pointer-initiated drag, not something specific to
    // KeyboardSensor.
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(150);

    // The overlay copy is gone — back to exactly zero.
    await expect(overlayCard).toHaveCount(0);
    await expect(desktopColumn(page, "New").getByText(name)).toBeVisible();

    // No mutation of any kind — checked directly against the database.
    const lead = await dbQuery<{ stage: string; lostReason: string | null; statusDefinitionId: string | null }>(
      "lead",
      "findFirstOrThrow",
      { where: { name } },
    );
    expect(lead.stage).toBe("NEW");
    expect(lead.lostReason).toBeNull();

    // No LOST dialog, no success/error toast — the cancelled gesture
    // triggered handleDragEnd/handleDragStart's own state cleanup only,
    // never a mutation path.
    await expect(page.getByRole("heading", { name: "Mark lead lost" })).toHaveCount(0);
    await expect(page.getByText("Status updated")).toHaveCount(0);
    await expect(page.getByText("Lead marked lost")).toHaveCount(0);

    // The native select remains fully usable afterward.
    const card = desktopColumn(page, "New").locator("li", { hasText: name });
    await moveToSelect(card, name).selectOption({ label: "Contacted" });
    await expect(page.getByText("Status updated")).toBeVisible();
    await expect(desktopColumn(page, "Contacted").getByText(name)).toBeVisible();
  });

  test("the desktop board's own scrollWidth stays bounded during a real drag toward a distant column — the DragOverlay fix's own regression guard", async ({ page }) => {
    const name = uniqueName();
    await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
    await page.goto("/leads?view=pipeline");

    const baseline = await readBoardMetrics(page);
    // A small, real layout tolerance — the isOver column's own ring-2
    // styling (box-shadow-based, not a layout-affecting border) and
    // ordinary sub-pixel rounding account for at most a few pixels; the
    // original, now-fixed defect grew scrollWidth from 1808 to 3768+ —
    // thousands of pixels, monotonically, never settling, with the
    // pointer held stationary between polls (empirically confirmed
    // during this feature's own development — see git history). This
    // bound is nowhere close to loose enough to let that regression pass.
    const TOLERANCE_PX = 40;

    const handle = dragHandle(desktopColumn(page, "New"), name);
    const box = await handle.boundingBox();
    const targetBox = await desktopColumn(page, "Lost").boundingBox();
    const viewport = page.viewportSize();
    if (!box || !targetBox || !viewport) {
      throw new Error("missing bounding box for source/target, or no viewport");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const EDGE_MARGIN = 20;
    const approachX = Math.min(targetBox.x + targetBox.width / 2, viewport.width - EDGE_MARGIN);
    const approachY = Math.min(targetBox.y + targetBox.height / 2, viewport.height - EDGE_MARGIN);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 15, startY + 15, { steps: 5 });
    await page.waitForTimeout(100);
    // A single approach move toward the far column, then the pointer is
    // held stationary for the whole polling loop below — deliberately
    // NOT re-aimed on every poll (leads-pipeline-dnd.spec.ts's own
    // dragCardToColumn helper does that, for a different purpose): the
    // original defect reproduced with a stationary pointer, autoscroll
    // running entirely on its own, so that is exactly what this
    // regression guard needs to reproduce it if it ever returns.
    await page.mouse.move(approachX, approachY, { steps: 20 });

    let maxObservedWidth = baseline.scrollWidth;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await page.waitForTimeout(150);
      const metrics = await readBoardMetrics(page);
      maxObservedWidth = Math.max(maxObservedWidth, metrics.scrollWidth);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(baseline.scrollWidth + TOLERANCE_PX);
    }

    // Cancel rather than drop — this test's only concern is the scroll
    // geometry invariant, not a successful mutation (already covered by
    // the LOST/normal-move tests above).
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(200);

    const afterDrop = await readBoardMetrics(page);
    expect(afterDrop.scrollWidth).toBeLessThanOrEqual(baseline.scrollWidth + TOLERANCE_PX);

    // No page-level phantom horizontal overflow either.
    const documentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(documentOverflow).toBeLessThanOrEqual(1);

    // Deliberate: the measured evidence this regression guard is built
    // on, kept visible in test output rather than only in this file's
    // own comments.
    console.log(
      `[scrollWidth regression guard] baseline=${baseline.scrollWidth} max-during-drag=${maxObservedWidth} after-cancel=${afterDrop.scrollWidth} tolerance=${TOLERANCE_PX}`,
    );

    const lead = await dbQuery<{ stage: string }>("lead", "findFirstOrThrow", { where: { name } });
    expect(lead.stage).toBe("NEW");
  });
});

test.describe("Leads Pipeline — MobileStageSwitcher empty-column guard (isolated organization)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  // Deliberately its own describe block with its own isolated
  // organization (created directly via dbQuery, mirroring
  // analytics-ui.spec.ts's own established "brand-new empty org"
  // pattern — never fixtures.orgA/orgB, and never bootstrapped): the
  // guarded state this test needs (zero LEAD CustomStatusDefinition
  // rows) must never leak into — or be corrupted by — the shared
  // fixtures.orgA every other test in this file bootstraps and relies
  // on having real columns.
  test("an organization with no LEAD status definitions AND an active filter renders the guarded empty-column fallback, never a crash", async ({
    page,
    context,
    baseURL,
  }) => {
    const runId = randomUUID().slice(0, 8);
    const org = await dbQuery<{ id: string }>("organization", "create", {
      data: { name: `E2E-DnD-EmptyColumns-${runId}`, slug: `e2e-dnd-empty-columns-${runId}` },
    });
    await dbQuery("membership", "create", { data: { userId: fixtures.owner.id, organizationId: org.id, role: "OWNER" } });

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    try {
      await actAsMember(context, baseURL!, fixtures.owner, org.id);
      await page.setViewportSize({ width: 390, height: 844 });
      // hasActiveParams === true (a real `q`) is required so the
      // page-level "No leads yet" EmptyState (leads/page.tsx's own
      // `grandTotal === 0 && !hasActiveParams` gate) does NOT intercept
      // before LeadPipelineBoard ever mounts — the read-only audit's own
      // Section B finding: without an active filter, that outer gate
      // reaches first and MobileStageSwitcher's own guard is never
      // exercised at all. `columns.length === 0` follows purely from
      // this being a brand-new org bootstrapped nowhere near
      // bootstrapOrganizationStatusDefinitions (src/lib/current-user.ts) —
      // never from the filter itself.
      await page.goto("/leads?view=pipeline&q=anything");

      // Not the dashboard error boundary (src/app/(dashboard)/error.tsx's
      // own exact copy) — a real, successful render, not a crash.
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await expect(page.getByText("We couldn't load this page. Please try again.")).toHaveCount(0);

      // The guarded fallback itself, scoped to the mobile switcher's own
      // subtree (the desktop board, always in the DOM too, renders
      // nothing at all for an empty columns array — no competing match).
      await expect(mobileSwitcher(page).getByText("No leads", { exact: true })).toBeVisible();

      // No fabricated stage: the guard's early return happens before the
      // stage-switcher <nav aria-label="Pipeline stage"> is ever reached,
      // so no nav — real or invented — renders at all.
      await expect(mobileSwitcher(page).getByRole("navigation", { name: "Pipeline stage" })).toHaveCount(0);

      expect(pageErrors, `unexpected uncaught page error(s): ${pageErrors.map((e) => e.message).join("; ")}`).toHaveLength(0);
    } finally {
      await dbQuery("membership", "deleteMany", { where: { organizationId: org.id } });
      await dbQuery("organization", "delete", { where: { id: org.id } });
    }
  });
});
