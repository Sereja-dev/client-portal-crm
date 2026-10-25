import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OrganizationUnavailablePage from "@/app/organization-unavailable/page";

/**
 * Support Email UX Cleanup — proves the real runtime behavior of the new
 * "Contact support" mailto link, not just the source shape (see
 * staff-auth-theme-tokens.test.ts for the existing source-regex coverage
 * of this same page, which this file deliberately doesn't duplicate).
 *
 * `OrganizationUnavailablePage` is a plain, synchronous function
 * component — no `async`, no `cookies()`/`headers()`, no other
 * Next.js-specific Server Component primitive — so it can be called
 * directly and rendered with `react-dom/server`'s `renderToStaticMarkup`
 * in plain Node, no Next.js runtime or jsdom required. `getPlatformLegalConfig()`
 * reads `process.env` fresh on every call (see platform-config.ts's own
 * `trimmedEnv()`), so this needs no `vi.resetModules()`/dynamic-import
 * dance — just set the env var before each render.
 */

const ORIGINAL_SUPPORT_EMAIL = process.env.PLATFORM_SUPPORT_EMAIL;
const ORIGINAL_FROM_EMAIL = process.env.INVITATION_FROM_EMAIL;

function restoreEnv() {
  if (ORIGINAL_SUPPORT_EMAIL === undefined) delete process.env.PLATFORM_SUPPORT_EMAIL;
  else process.env.PLATFORM_SUPPORT_EMAIL = ORIGINAL_SUPPORT_EMAIL;
  if (ORIGINAL_FROM_EMAIL === undefined) delete process.env.INVITATION_FROM_EMAIL;
  else process.env.INVITATION_FROM_EMAIL = ORIGINAL_FROM_EMAIL;
}

afterEach(restoreEnv);

describe("/organization-unavailable — support mailto link", () => {
  it("renders a real mailto: link to the explicitly configured PLATFORM_SUPPORT_EMAIL", () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";
    delete process.env.INVITATION_FROM_EMAIL;

    const html = renderToStaticMarkup(OrganizationUnavailablePage());

    expect(html).toContain('href="mailto:support@aqenra.com"');
    expect(html).toContain("support@aqenra.com");
    expect(html).toContain("Workspace unavailable");
  });

  it("falls back to extracting the address from INVITATION_FROM_EMAIL when PLATFORM_SUPPORT_EMAIL is unset — the exact same canonical fallback Privacy's §9 and Terms' §10 already rely on, not a second config layer", () => {
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    process.env.INVITATION_FROM_EMAIL = "Aqenra <no-reply@aqenra.com>";

    const html = renderToStaticMarkup(OrganizationUnavailablePage());

    expect(html).toContain('href="mailto:no-reply@aqenra.com"');
  });

  it("renders the original plain-text copy, with NO mailto link at all, when no support email resolves from any source", () => {
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    delete process.env.INVITATION_FROM_EMAIL;

    const html = renderToStaticMarkup(OrganizationUnavailablePage());

    expect(html).toContain("This workspace is currently unavailable. Contact support.");
    expect(html).not.toContain("mailto:");
  });

  it("never produces mailto:undefined or mailto:null — a whitespace-only INVITATION_FROM_EMAIL is treated as absent, same as getPlatformLegalConfig()'s own trimmedEnv() contract", () => {
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    process.env.INVITATION_FROM_EMAIL = "   ";

    const html = renderToStaticMarkup(OrganizationUnavailablePage());

    expect(html).not.toContain("mailto:undefined");
    expect(html).not.toContain("mailto:null");
    expect(html).not.toContain("mailto:");
  });

  it("still renders inside the fixed-dark AuthShell — top-right Sign in action present, no form, no mutation control", () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "support@aqenra.com";

    const html = renderToStaticMarkup(OrganizationUnavailablePage());

    expect(html).toContain("auth-shell");
    expect(html).toMatch(/>Sign in</);
    expect(html).not.toContain("<form");
  });
});
