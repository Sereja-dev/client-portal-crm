import { notFound } from "next/navigation";
import { TEST_MODE } from "@/lib/test-mode";
import { FreeBetaBanner } from "@/components/dashboard/free-beta-banner";

/**
 * Free Public Beta — Welcome Banner. TEST_MODE-only E2E verification
 * surface, the exact same pattern src/app/test-only/theme/page.tsx
 * already establishes (see that file's own doc comment for the full
 * reasoning) — needed because FREE_BETA_MODE is not set anywhere in
 * this repo's shared Playwright webServer.env (playwright.config.ts),
 * and test code cannot mutate the already-spawned `next start`
 * process's own env after the fact (the same constraint that file's own
 * comment documents for TEST_MODE). This route lets Playwright exercise
 * the real FreeBetaBanner component — hydration, dismissal,
 * persistence, per-user isolation, accessibility, responsive behavior —
 * deterministically, entirely independent of whatever FREE_BETA_MODE
 * actually resolves to for the real Dashboard page (which the existing
 * Dashboard E2E suite already covers for the Free-Beta-OFF case, since
 * that's this repo's own real, current E2E environment — see
 * dashboard-redesign.spec.ts's own "Free Beta" describe block).
 *
 * Gated on the exact same flag as every other TEST_MODE surface — with
 * TEST_MODE unset (every real deployment, including this repo's own
 * Vercel Production, which never sets it — see scripts/security-checks/
 * check-no-test-mode.mjs), this 404s unconditionally before rendering
 * anything, so there is nothing here for a normal Production visit to
 * ever reach.
 *
 * `force-dynamic` for the identical reason the Theme harness needs it:
 * without it, this page is eligible for static prerendering, which
 * would bake in whatever TEST_MODE value was present at BUILD time
 * forever, ignoring the RUNTIME env the E2E webServer actually sets.
 *
 * `userId` is an optional query param, defaulting to a fixed test
 * constant — present only so a cross-user-isolation E2E test can visit
 * this same route twice with two different values and assert each
 * resolves its own independent dismissal state in a real browser, never
 * client input trusted for anything beyond a localStorage key scope on
 * a route that only exists under TEST_MODE in the first place.
 */
export const dynamic = "force-dynamic";

const DEFAULT_TEST_USER_ID = "e2e-test-free-beta-banner-user";

export default async function FreeBetaBannerTestOnlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!TEST_MODE) {
    notFound();
  }

  const { userId } = await searchParams;
  const resolvedUserId = typeof userId === "string" && userId.length > 0 ? userId : DEFAULT_TEST_USER_ID;

  return <FreeBetaBanner userId={resolvedUserId} />;
}
