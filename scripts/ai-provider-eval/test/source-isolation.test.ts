import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mechanical proof of this package's own central isolation invariant
 * (see extract-fixtures.ts's and tool-runtime.ts's own header comments):
 * every runtime file under scripts/ai-provider-eval/ — EXCEPT
 * extract-fixtures.ts, the one documented exception — must never import
 * Prisma, Supabase, any src/app/** route/UI file, or the real tool
 * registry/implementation modules.
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED_DIRS = new Set(["node_modules", "results"]);
const DOCUMENTED_EXCEPTION_FILES = new Set(["extract-fixtures.ts"]);

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...walk(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Mirrors scripts/security-checks/check-ai-assistant-security.mjs's own stripComments() — a doc comment discussing "prisma." or "getRegisteredAiTools" in prose must never trip a real call-site/import check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const FORBIDDEN_FRAGMENTS = [
  "@/lib/prisma",
  "@/generated/prisma",
  "supabase",
  "src/app",
  "/api/ai/assistant",
  "provider-factory",
  "orchestrate", // matches both orchestrate.ts and orchestrate (no false-positive risk: no legitimate specifier in this package contains this substring otherwise)
  "request-context",
  "logging-policy",
  "tools/registry",
  "tools/organization-summary",
  "tools/clients",
  "tools/projects",
  "tools/tasks",
  "tools/invoices",
];

describe("source-isolation — runtime files never reach app/Prisma/Supabase internals", () => {
  const allFiles = walk(PACKAGE_DIR);
  const runtimeFiles = allFiles.filter((f) => !DOCUMENTED_EXCEPTION_FILES.has(relative(PACKAGE_DIR, f)));

  test("found a non-trivial number of runtime .ts files to check (sanity check on the walk itself)", () => {
    assert.ok(runtimeFiles.length >= 10, `expected at least 10 files, found ${runtimeFiles.length}`);
  });

  for (const file of runtimeFiles) {
    const relPath = relative(PACKAGE_DIR, file);
    test(`${relPath} never imports a forbidden app/Prisma/Supabase module`, () => {
      const source = readFileSync(file, "utf8");
      const specifiers = importSpecifiers(source);
      for (const specifier of specifiers) {
        for (const forbidden of FORBIDDEN_FRAGMENTS) {
          assert.equal(specifier.includes(forbidden), false, `${relPath} imports "${specifier}", which contains forbidden fragment "${forbidden}"`);
        }
      }
    });
  }

  test("extract-fixtures.ts (the one documented exception) legitimately imports the real registry — and ONLY that, no Prisma import of its own beyond the transitive chain", () => {
    const source = readFileSync(join(PACKAGE_DIR, "extract-fixtures.ts"), "utf8");
    assert.match(source, /from\s+["']\.\.\/\.\.\/src\/lib\/ai\/tools\/registry["']/);
    // Never a direct Prisma import, and never a direct execute() call —
    // comment-stripped first, since this file's own doc comment
    // legitimately DISCUSSES "prisma." and "execute()" in prose (the
    // exact same doc-comment-vs-real-code distinction
    // check-ai-assistant-security.mjs's own stripComments() exists for).
    const stripped = stripComments(source);
    const specifiers = importSpecifiers(source);
    assert.equal(specifiers.some((s) => s.includes("@/lib/prisma") || s.includes("@/generated/prisma")), false);
    assert.equal(/\.execute\(/.test(stripped), false);
    assert.equal(/prisma\./.test(stripped), false);
  });

  test("no runtime file (excluding the documented exception and this test file's own self-reference) actually CALLS getRegisteredAiTools", () => {
    const SELF = join(PACKAGE_DIR, "test", "source-isolation.test.ts");
    for (const file of runtimeFiles) {
      if (file === SELF) continue; // this file legitimately names the identifier in its own assertions/strings above
      const source = stripComments(readFileSync(file, "utf8"));
      assert.equal(/getRegisteredAiTools\s*\(/.test(source), false, `${relative(PACKAGE_DIR, file)} calls getRegisteredAiTools(...)`);
    }
  });
});
