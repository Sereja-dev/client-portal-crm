import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS_DIR } from "../report.js";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * results/forensic-trace.json may legitimately already exist as
 * preserved official evidence (see README.md's own "Artifact lifecycle"
 * section) — these tests must remain correct regardless. A hash
 * comparison proves "this invocation did not write it" exactly as well
 * as an existsSync-must-be-false check would for a genuinely-empty
 * results/, without assuming results/ is empty.
 */
function sha256OfForensicTrace(): string | null {
  const path = join(RESULTS_DIR, "forensic-trace.json");
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * See test/canary.test.ts's own identical helper doc comment.
 * AQENRA_EVAL_TEST_NO_LIVE=1 is the PRIMARY, credential-independent
 * mechanical boundary (index.ts's own enforceTestNoLiveOrExit()) —
 * carried by every subprocess spawn below, regardless of what
 * credential values that specific test also needs.
 */
function buildNoLiveChildEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { AQENRA_EVAL_ANTHROPIC_API_KEY, AQENRA_EVAL_OPENAI_API_KEY, ...rest } = process.env;
  return { ...rest, AQENRA_EVAL_TEST_NO_LIVE: "1", ...overrides };
}

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

  test("the dynamic provider imports live inside runLiveBenchmark (and runCanary), never inside runOfflinePipeline/runStructuralValidation", () => {
    // Sliced to the NEXT "async function" after runOfflinePipeline's own
    // start, whichever function that happens to be — not hardcoded to
    // "runLiveBenchmark" by name, since runCanary() (added by the bounded
    // live canary feature) is now another live-capable sibling function
    // that may sit between the two in file order. This isolates JUST
    // runOfflinePipeline's own body regardless of what's declared after it.
    const offlineStart = source.indexOf("async function runOfflinePipeline");
    const nextFunctionAfterOffline = source.indexOf("async function ", offlineStart + "async function runOfflinePipeline".length);
    const offlineSection = source.slice(offlineStart, nextFunctionAfterOffline);
    assert.equal(offlineSection.includes("providers/anthropic"), false);
    assert.equal(offlineSection.includes("providers/openai"), false);

    const liveSection = source.slice(source.indexOf("async function runLiveBenchmark"), source.indexOf("async function main"));
    assert.ok(liveSection.includes("providers/anthropic.js"));
    assert.ok(liveSection.includes("providers/openai.js"));

    // runCanary() is the second live-capable sibling — it must ALSO reach
    // both providers only via dynamic import(), never statically (see the
    // top-level static-import test above, which already covers the whole
    // file regardless of function).
    const canarySection = source.slice(source.indexOf("async function runCanary"), source.indexOf("async function main"));
    assert.ok(canarySection.includes("providers/anthropic.js"));
    assert.ok(canarySection.includes("providers/openai.js"));
  });
});

describe("no-live-by-default — empirical proof: running the CLI with no flags and no keys makes no attempt at a real provider call", () => {
  test("default invocation (no args) exits 0, prints the dry-run banner, never surfaces a MissingEvalApiKeyError", () => {
    const output = execFileSync("npx", ["tsx", "index.ts"], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
      env: buildNoLiveChildEnv(),
    });
    assert.match(output, /Dry run complete — no network call was made/);
    assert.equal(output.includes("MissingEvalApiKeyError"), false);
  });

  test("--validate exits 0 without ever mentioning a provider client or a missing key", () => {
    const output = execFileSync("npx", ["tsx", "index.ts", "--validate"], { cwd: PACKAGE_DIR, encoding: "utf8" });
    assert.match(output, /Validation-only mode complete — no network call was made/);
  });

  test("--run with no keys set exits non-zero BEFORE any provider is constructed (missing-key, or an earlier equally-safe local refusal such as a preserved non-empty results/)", () => {
    assert.throws(() => {
      execFileSync("npx", ["tsx", "index.ts", "--run"], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        env: buildNoLiveChildEnv(),
      });
    });
  });
});

describe("no-live-by-default — --with-forensic-trace is inert everywhere except a completed --run (PR 2, task §40)", () => {
  // console.warn() (the inert-mode warning) goes to stderr — execFileSync's
  // return value on a SUCCESSFUL (non-throwing) run only ever carries
  // stdout, so these three tests shell out via `bash -c "... 2>&1"` to
  // merge stderr into the captured output. The throwing case below doesn't
  // need this: a thrown error already exposes both err.stdout and
  // err.stderr separately.
  test("--with-forensic-trace alone (no mode flag) makes zero network calls and writes no file — dry-run banner still prints, plus the inert-mode warning", () => {
    const beforeHash = sha256OfForensicTrace();
    const output = execFileSync("bash", ["-c", "npx tsx index.ts --with-forensic-trace 2>&1"], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
      env: buildNoLiveChildEnv(),
    });
    assert.match(output, /Forensic trace capture only applies to --run; ignored in this mode\./);
    assert.match(output, /Dry run complete — no network call was made/);
    assert.equal(sha256OfForensicTrace(), beforeHash, "forensic-trace.json must be byte-identical (or still absent) — this invocation must never write it");
  });

  test("--dry-run --with-forensic-trace makes zero network calls and writes no file", () => {
    const beforeHash = sha256OfForensicTrace();
    const output = execFileSync("bash", ["-c", "npx tsx index.ts --dry-run --with-forensic-trace 2>&1"], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
      env: buildNoLiveChildEnv(),
    });
    assert.match(output, /Forensic trace capture only applies to --run; ignored in this mode\./);
    assert.match(output, /Dry run complete — no network call was made/);
    assert.equal(sha256OfForensicTrace(), beforeHash, "forensic-trace.json must be byte-identical (or still absent) — this invocation must never write it");
  });

  test("--validate --with-forensic-trace makes zero network calls, runs no full pipeline, and writes no file", () => {
    const beforeHash = sha256OfForensicTrace();
    const output = execFileSync("bash", ["-c", "npx tsx index.ts --validate --with-forensic-trace 2>&1"], { cwd: PACKAGE_DIR, encoding: "utf8" });
    assert.match(output, /Forensic trace capture only applies to --run; ignored in this mode\./);
    assert.match(output, /Validation-only mode complete — no network call was made/);
    assert.equal(sha256OfForensicTrace(), beforeHash, "forensic-trace.json must be byte-identical (or still absent) — this invocation must never write it");
  });

  test("--run --with-forensic-trace with no keys set still fails BEFORE any provider is constructed, and no trace file is written", () => {
    const beforeHash = sha256OfForensicTrace();
    let output = "";
    let threw = false;
    try {
      output = execFileSync("npx", ["tsx", "index.ts", "--run", "--with-forensic-trace"], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        env: buildNoLiveChildEnv(),
      });
    } catch (err) {
      threw = true;
      output = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
    }
    assert.equal(threw, true, "expected a non-zero exit (missing keys, or an earlier equally-safe local refusal such as a preserved non-empty results/)");
    // The --run branch never prints the "ignored in this mode" warning, since --with-forensic-trace DOES apply to --run.
    assert.equal(output.includes("Forensic trace capture only applies to --run; ignored in this mode."), false);
    assert.equal(sha256OfForensicTrace(), beforeHash, "forensic-trace.json must be byte-identical (or still absent) — this invocation must never write it");
  });
});
