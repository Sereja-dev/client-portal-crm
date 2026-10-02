import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Grants whole-suite final verifier (narrow test-architecture fix) —
 * proves the invocation lives at the correct lifecycle boundary without
 * relying on brittle line-number assertions: a plain substring/ordering
 * check against each file's own source text, which stays correct across
 * ordinary edits (added comments, reformatted whitespace, additional
 * helpers) and only breaks if the actual architectural fact it checks
 * changes.
 *
 * Required facts (see this repo's own grants-final-verifier audit report
 * for the full empirical proof of why this is the correct boundary):
 *   1. test/integration/global-setup.ts imports and calls
 *      assertIntegrationDbClean.
 *   2. That call happens before the stopTestDatabase() call, inside
 *      teardown().
 *   3. test/integration/security/grants.test.ts no longer contains the
 *      whole-suite cleanup assertion (or its false "runs last
 *      alphabetically" assumption).
 */

const REPO_ROOT = `${__dirname}/../../..`;

function readSource(relativePath: string): string {
  return readFileSync(`${REPO_ROOT}/${relativePath}`, "utf8");
}

describe("grants final-verifier architecture contract", () => {
  it("global-setup.ts invokes assertIntegrationDbClean before stopTestDatabase() inside teardown()", () => {
    const source = readSource("test/integration/global-setup.ts");

    expect(source).toMatch(/import\s*\{[^}]*assertIntegrationDbClean[^}]*\}\s*from\s*["']\.\.\/support\/assert-integration-db-clean["']/);

    const teardownMatch = source.match(/export async function teardown\(\)[^{]*\{([\s\S]*)\n\}/);
    expect(teardownMatch).not.toBeNull();
    const teardownBody = teardownMatch![1];

    const verifierCallIndex = teardownBody.indexOf("assertIntegrationDbClean(");
    const stopCallIndex = teardownBody.indexOf("stopTestDatabase(");

    expect(verifierCallIndex).toBeGreaterThanOrEqual(0);
    expect(stopCallIndex).toBeGreaterThanOrEqual(0);
    expect(verifierCallIndex).toBeLessThan(stopCallIndex);
  });

  it("grants.test.ts no longer contains the whole-suite cleanup assertion or its false ordering assumption", () => {
    const source = readSource("test/integration/security/grants.test.ts");

    expect(source).not.toMatch(/whole-suite cleanup/);
    expect(source).not.toMatch(/runs last alphabetically/);
    expect(source).not.toMatch(/portalDownloadRequests:\s*0/);
  });
});
