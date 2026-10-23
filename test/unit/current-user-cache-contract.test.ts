import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Navigation Performance Slice B — source-contract proxy, matching this
 * repo's own established reasoning (see button-variant-contract.test.ts's
 * header comment, and session-stability.test.ts's identical note for
 * getVerifiedAuthUser()): React.cache()'s actual dedup effect requires a
 * Server Component render boundary that doesn't exist in this bare
 * Vitest environment, so it can't be behaviorally asserted here. This
 * file instead proves the one thing a render-less harness safely can:
 * the intended cache() boundary is actually in the source, on exactly
 * the two functions the audit identified as the proven layout+page
 * duplication (getCurrentUserOrganization/getCurrentMembership) — never
 * on getOrCreateUser() itself, which must keep tolerating concurrent
 * cross-request calls (see that function's own doc comment).
 */
const source = readFileSync("src/lib/current-user.ts", "utf8");

describe("current-user.ts — Navigation Performance Slice B cache() boundary", () => {
  it("imports cache from react", () => {
    expect(source).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*"react"/);
  });

  it("wraps getCurrentUserOrganization in cache()", () => {
    expect(source).toMatch(/export const getCurrentUserOrganization = cache\(async \(currentPath\?: string\) => \{/);
  });

  it("wraps getCurrentMembership in cache()", () => {
    expect(source).toMatch(/export const getCurrentMembership = cache\(async \(currentPath\?: string\) => \{/);
  });

  it("never wraps getOrCreateUser in cache() — it must keep tolerating concurrent cross-request provisioning races", () => {
    expect(source).toMatch(/export async function getOrCreateUser\(currentPath\?: string\) \{/);
    expect(source).not.toMatch(/export const getOrCreateUser = cache\(/);
  });

  it("never wraps resolveActiveOrganizationId in cache() — this slice's cache boundary is the outer composite functions only", () => {
    expect(source).not.toMatch(/resolveActiveOrganizationId = cache\(/);
  });
});
