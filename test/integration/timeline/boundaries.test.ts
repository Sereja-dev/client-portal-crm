import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Communication Timeline Phase 2 — structural boundary coverage,
 * mirroring test/integration/tags/boundaries.test.ts's own exact
 * approach: no file under the Portal app tree or Portal components tree
 * ever imports src/lib/timeline or src/components/timeline (Staff-only
 * in this phase, by construction, not by convention alone).
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

describe("Communication Timeline — boundaries", () => {
  it("no file under the Portal app tree, or any public lead-capture route, imports src/lib/timeline or src/components/timeline", () => {
    const portalRoot = path.join(REPO_ROOT, "src/app/portal");
    const publicLeadCaptureRoot = path.join(REPO_ROOT, "src/app/api/public");

    const filesToScan = [
      ...collectFiles(portalRoot),
      ...(statSync(publicLeadCaptureRoot, { throwIfNoEntry: false }) ? collectFiles(publicLeadCaptureRoot) : []),
    ];

    const offenders = filesToScan.filter((file) => {
      const content = readFileSync(file, "utf8");
      return content.includes("lib/timeline") || content.includes("components/timeline");
    });
    expect(offenders).toEqual([]);
  });

  it("no component under src/components/portal imports src/lib/timeline or src/components/timeline", () => {
    const portalComponentsRoot = path.join(REPO_ROOT, "src/components/portal");
    const exists = statSync(portalComponentsRoot, { throwIfNoEntry: false });
    if (!exists) return; // directory doesn't exist — nothing to scan, boundary trivially holds

    const offenders = collectFiles(portalComponentsRoot).filter((file) => {
      const content = readFileSync(file, "utf8");
      return content.includes("lib/timeline") || content.includes("components/timeline");
    });
    expect(offenders).toEqual([]);
  });

  it("no Client Portal client-portal component imports src/lib/timeline or src/components/timeline", () => {
    const clientPortalRoot = path.join(REPO_ROOT, "src/components/client-portal");
    const exists = statSync(clientPortalRoot, { throwIfNoEntry: false });
    if (!exists) return;

    const offenders = collectFiles(clientPortalRoot).filter((file) => {
      const content = readFileSync(file, "utf8");
      return content.includes("lib/timeline") || content.includes("components/timeline");
    });
    expect(offenders).toEqual([]);
  });
});
