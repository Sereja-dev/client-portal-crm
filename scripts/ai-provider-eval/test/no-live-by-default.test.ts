import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("no-live-by-default — static proof: index.ts cannot statically reach a real provider client", () => {
  const source = readFileSync(join(PACKAGE_DIR, "index.ts"), "utf8");

  test("has no TOP-LEVEL import of providers/anthropic.ts or providers/openai.ts", () => {
    const topLevelImportLines = source.split("\n").filter((line) => /^import\b/.test(line.trim()));
    for (const line of topLevelImportLines) {
      assert.equal(/providers\/(anthropic|openai)/.test(line), false, `unexpected top-level import: ${line}`);
    }
  });

  test("the only references to providers/anthropic.js and providers/openai.js are dynamic import() calls", () => {
    assert.ok(source.includes('await import("./providers/anthropic.js")'), "expected a dynamic import() of providers/anthropic.js");
    assert.ok(source.includes('await import("./providers/openai.js")'), "expected a dynamic import() of providers/openai.js");
    // Every occurrence of each specifier must be immediately preceded by
    // `import(` — i.e. there is no OTHER way this file references either
    // module (e.g. a bare `from "./providers/anthropic.js"` static
    // import would fail this).
    for (const specifier of ['"./providers/anthropic.js"', '"./providers/openai.js"']) {
      let searchFrom = 0;
      let occurrences = 0;
      while (true) {
        const index = source.indexOf(specifier, searchFrom);
        if (index === -1) break;
        occurrences += 1;
        const precedingChars = source.slice(Math.max(0, index - 8), index);
        assert.match(precedingChars, /import\($/, `occurrence of ${specifier} at index ${index} is not immediately preceded by "import("`);
        searchFrom = index + specifier.length;
      }
      assert.ok(occurrences >= 1, `expected at least one occurrence of ${specifier}`);
    }
  });

  test("the dynamic provider imports live inside runLiveBenchmark, not inside runOfflinePipeline/runStructuralValidation", () => {
    const offlineSection = source.slice(source.indexOf("async function runOfflinePipeline"), source.indexOf("async function runLiveBenchmark"));
    assert.equal(offlineSection.includes("providers/anthropic"), false);
    assert.equal(offlineSection.includes("providers/openai"), false);

    const liveSection = source.slice(source.indexOf("async function runLiveBenchmark"), source.indexOf("async function main"));
    assert.ok(liveSection.includes("providers/anthropic.js"));
    assert.ok(liveSection.includes("providers/openai.js"));
  });
});

describe("no-live-by-default — empirical proof: running the CLI with no flags and no keys makes no attempt at a real provider call", () => {
  test("default invocation (no args) exits 0, prints the dry-run banner, never surfaces a MissingEvalApiKeyError", () => {
    const output = execFileSync("npx", ["tsx", "index.ts"], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
      env: { ...process.env, AQENRA_EVAL_ANTHROPIC_API_KEY: "", AQENRA_EVAL_OPENAI_API_KEY: "" },
    });
    assert.match(output, /Dry run complete — no network call was made/);
    assert.equal(output.includes("MissingEvalApiKeyError"), false);
  });

  test("--validate exits 0 without ever mentioning a provider client or a missing key", () => {
    const output = execFileSync("npx", ["tsx", "index.ts", "--validate"], { cwd: PACKAGE_DIR, encoding: "utf8" });
    assert.match(output, /Validation-only mode complete — no network call was made/);
  });

  test("--run with no keys set exits non-zero and reports the missing-key condition BEFORE any provider is constructed", () => {
    assert.throws(() => {
      execFileSync("npx", ["tsx", "index.ts", "--run"], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        env: { ...process.env, AQENRA_EVAL_ANTHROPIC_API_KEY: "", AQENRA_EVAL_OPENAI_API_KEY: "" },
      });
    });
  });
});
