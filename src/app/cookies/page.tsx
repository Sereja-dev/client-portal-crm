import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { getPlatformLegalConfig } from "@/lib/legal/platform-config";
import { LegalBackButton } from "@/components/legal/legal-back-button";

export const metadata: Metadata = {
  title: `Cookie Policy — ${siteConfig.name}`,
};

type StorageRow = {
  name: string;
  type: string;
  purpose: string;
  setBy: string;
  retention: string;
  control: string;
};

/**
 * Privacy & Cookie Policy Improvement, Slice 2. Every row here is a
 * cookie or browser-storage item independently verified against this
 * app's current source (see this feature's own design-checkpoint report)
 * — never a name, provider, or retention period invented for the table.
 * TEST_MODE-only identity cookies and the dormant Paddle checkout script
 * are deliberately excluded: neither is ever reachable by a real visitor
 * (TEST_MODE is never set in any committed config or real deployment;
 * Paddle's script never loads without a live billing token, which is
 * unset by default), so there is nothing truthful to disclose about them
 * to the people this page is actually for.
 */
const STORAGE_ROWS: StorageRow[] = [
  {
    name: "Authentication session",
    type: "Cookie (essential)",
    purpose: "Keeps you signed in and verifies each request is really you.",
    setBy: "Aqenra, via our authentication provider (Supabase Auth)",
    retention: "Managed by our authentication provider's own session configuration, not set independently by this cookie's own code",
    control: "Signing out, or clearing cookies in your browser, ends the session",
  },
  {
    name: "active_organization_id",
    type: "Cookie",
    purpose: "Remembers which workspace (Organization) you're currently working in, for staff accounts that belong to more than one.",
    setBy: "Aqenra",
    retention: "1 year",
    control: "Resets automatically if you switch workspaces or sign out; also cleared by clearing cookies in your browser",
  },
  {
    name: "aqenra_theme",
    type: "Cookie",
    purpose: "Remembers your light/dark display preference.",
    setBy: "Aqenra",
    retention: "1 year",
    control: "Change your theme preference in-app, or clear cookies in your browser",
  },
  {
    name: "Saved views",
    type: "Browser-local storage",
    purpose: "Remembers filter and sort views you've explicitly chosen to save on list pages.",
    setBy: "Aqenra",
    retention: "Until you delete the saved view, or clear your browser's site data",
    control: "Delete the saved view from the relevant list page, or clear site data in your browser",
  },
  {
    name: "Table column preferences",
    type: "Browser-local storage",
    purpose: "Remembers which table columns you've chosen to hide on list pages.",
    setBy: "Aqenra",
    retention: "Until you change it, or clear your browser's site data",
    control: "Re-show the column in-app, or clear site data in your browser",
  },
  {
    name: "Recent searches",
    type: "Browser-local storage",
    purpose: "Remembers up to 6 of your most recently selected search results, so you can quickly return to them.",
    setBy: "Aqenra",
    retention: "Rolling — only the most recent 6 entries are kept, until cleared or replaced",
    control: "Clear site data in your browser",
  },
  {
    name: "Public-beta notice dismissal",
    type: "Browser-local storage",
    purpose: "Remembers that you dismissed the public-beta notice, so it doesn't reappear.",
    setBy: "Aqenra",
    retention: "Until you clear it",
    control: "Clear site data in your browser",
  },
];

export default function CookiePolicyPage() {
  const config = getPlatformLegalConfig();

  return (
    // `w-full` — this <main> is a direct flex-item child of the root
    // layout's <body className="flex flex-col"> (src/app/layout.tsx),
    // with `align-items` at its default ("normal", which computes as
    // `stretch` here). With `width: auto` (no `w-full`), that stretch
    // only ever acted as a lower bound: once the table below
    // (min-w-[640px], inside its own overflow-x-auto wrapper) needed
    // more room than the mobile viewport, <main>'s own auto-width
    // still grew to fit it — confirmed by direct measurement, and
    // confirmed NOT fixable by `min-width: 0` alone (tested; had zero
    // effect) — so the whole page scrolled horizontally instead of the
    // table scrolling locally within its wrapper. `w-full` gives
    // <main> a definite width instead of `auto`, which removes that
    // ambiguity: it is now exactly the stretched/container width
    // (max-w-3xl still caps it on desktop, unchanged), and the
    // overflow-x-auto wrapper inside it becomes the real horizontal
    // scroll boundary (confirmed Production defect, measured and
    // fixed — see this feature's own mobile-overflow diagnostic).
    // /privacy and /terms share this same <main> shape but have no
    // content wide enough to trigger the same latent condition, so
    // they're left unchanged.
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <LegalBackButton />

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary">Cookie Policy</h1>
      <p className="mt-2 text-sm text-text-muted">Effective {config.cookiePolicyEffectiveDate}</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-text-secondary">
        <section>
          <h2 className="text-lg font-semibold text-text-primary">1. What this policy covers</h2>
          <p className="mt-3">
            This Cookie Policy explains the cookies and browser-local storage {config.legalName} uses on{" "}
            {siteConfig.name} (the &ldquo;Service&rdquo;). It supplements, and should be read alongside, our{" "}
            <a
              href="/privacy"
              className="rounded font-medium text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
            >
              Privacy Policy
            </a>
            , which explains what personal data we collect and why.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">2. Cookies and browser storage, explained</h2>
          <p className="mt-3">
            Cookies are small pieces of text a website asks your browser to store and send back on later visits.
            Browser-local storage (such as <code className="text-text-primary">localStorage</code>) works
            differently: it stays on your device, and is not automatically attached to every request your browser
            sends to our servers the way a cookie is. That said, browser-local storage is still readable by the
            code running on a page, so it is not something no application code could ever read or send anywhere
            &mdash; it simply isn&rsquo;t sent automatically with ordinary page requests the way cookies are.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">3. Cookies and storage we use</h2>
          <p className="mt-3">
            The table below lists every cookie and browser-storage item the Service currently uses. We do not use
            any cookie or browser-storage technology beyond what is listed here.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border-default">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border-default bg-surface">
                  <th scope="col" className="px-3 py-2 font-semibold text-text-primary">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-text-primary">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-text-primary">
                    Purpose
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-text-primary">
                    Set by
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-text-primary">
                    Retention
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-text-primary">
                    Your controls
                  </th>
                </tr>
              </thead>
              <tbody>
                {STORAGE_ROWS.map((row) => (
                  <tr key={row.name} className="border-b border-border-default last:border-b-0">
                    <td className="px-3 py-2 font-medium text-text-primary">{row.name}</td>
                    <td className="px-3 py-2">{row.type}</td>
                    <td className="px-3 py-2">{row.purpose}</td>
                    <td className="px-3 py-2">{row.setBy}</td>
                    <td className="px-3 py-2">{row.retention}</td>
                    <td className="px-3 py-2">{row.control}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4">
            The authentication session cookie and the <code className="text-text-primary">active_organization_id</code>{" "}
            cookie are necessary for the Service to work &mdash; without them, you cannot stay signed in or use a
            multi-workspace account correctly. The remaining items (your theme preference, saved views, column
            preferences, recent searches, and the public-beta notice) only ever store a choice you made yourself,
            and exist to remember that choice for you. We have not independently assessed, and do not claim, that
            every item above is legally exempt from consent requirements in every jurisdiction; where that
            matters to you, please seek your own advice.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">4. Analytics and advertising</h2>
          <p className="mt-3">
            As of this policy&rsquo;s effective date, we do not use any analytics, advertising, or marketing
            cookies, trackers, or pixels on the Service. If this changes, we will update this policy first, and
            where legally required, ask for your consent before any such technology runs.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">5. Service providers</h2>
          <p className="mt-3">
            We do not share the cookies or browser-storage data described above with advertising or analytics
            companies. Our infrastructure providers (see our Privacy Policy, Section 4) may incidentally process
            cookie data as part of operating the servers the Service runs on, under their own data-protection
            terms with us.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">6. Your controls</h2>
          <p className="mt-3">
            Most of the preference items above can be changed or cleared directly in the Service, as described in
            the table. You can also clear cookies and site data for the Service at any time through your
            browser&rsquo;s own settings; doing so will sign you out and reset every preference listed above to
            its default. We do not currently offer a separate in-app cookie-preference center beyond the
            individual controls listed in the table.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">7. Changes to this policy</h2>
          <p className="mt-3">
            If we introduce a new cookie, tracker, or similar technology &mdash; including analytics, advertising,
            or a live payment-checkout integration &mdash; we will update this policy to describe it before it is
            enabled, and will ask for your consent first if the technology is not necessary to operate the
            Service. If we make a material change to this policy, we will update the effective date above.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">8. Contact us</h2>
          <p className="mt-3">
            {config.supportEmail ? (
              <>
                Questions about this policy can be sent to{" "}
                <a
                  href={`mailto:${config.supportEmail}`}
                  className="rounded font-medium text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                >
                  {config.supportEmail}
                </a>
                .
              </>
            ) : (
              <>
                To ask a question about this policy, contact your Organization&rsquo;s administrator, or reach us
                through the channel we used to communicate with you.
              </>
            )}{" "}
            This policy is interpreted under the laws applicable in {config.jurisdiction}.
          </p>
        </section>
      </div>
    </main>
  );
}
