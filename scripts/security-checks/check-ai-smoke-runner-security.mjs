import { readFileSync, existsSync } from "node:fs";
import { report } from "./lib.mjs";

// AQENRA — real OpenAI live smoke runner (scripts/ai-smoke/**) trust
// boundary. Same discipline as check-ai-assistant-security.mjs: a
// narrow, explicit, closed set of checks over exactly this runner's own
// two files plus the one package.json script that launches it — never a
// broad grep that would also reject a doc comment mentioning a forbidden
// word in prose (every content rule below runs on comment-stripped
// source).
//
// The runner exists to later prove the MERGED production OpenAI adapter
// (src/lib/ai/providers/openai.ts) works with synthetic data. These
// checks exist so a future edit cannot quietly turn it into something
// that: reimplements a second adapter, consumes a generic
// OPENAI_API_KEY, prints/enumerates secrets or the environment, reaches
// Prisma / Supabase / the app tool registry / orchestration, performs
// its own HTTP calls, exceeds the 3-request budget, or re-issues a
// failed call.

let ok = true;

const CORE_FILE = "scripts/ai-smoke/openai-smoke-core.ts";
const LIVE_FILE = "scripts/ai-smoke/openai-live.ts";
const PKG_FILE = "package.json";

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const coreRaw = readIfExists(CORE_FILE);
const liveRaw = readIfExists(LIVE_FILE);
const core = stripComments(coreRaw);
const live = stripComments(liveRaw);
const both = `${core}\n${live}`;

// 1. Both runner files exist.
ok = report("scripts/ai-smoke/openai-smoke-core.ts exists", coreRaw !== "", "") && ok;
ok = report("scripts/ai-smoke/openai-live.ts exists", liveRaw !== "", "") && ok;

// 2. The live entry imports the ONE merged production adapter — it must
// exercise the real runtime, never a copy.
ok = report(
  "openai-live.ts imports the merged production adapter (src/lib/ai/providers/openai)",
  /from\s*"(?:\.\.\/)+src\/lib\/ai\/providers\/openai"/.test(live),
  "",
) && ok;

// 3. Neither runner file imports the vendor SDK or constructs an OpenAI
// client itself — no second adapter, ever.
ok = report(
  "no runner file imports the \"openai\" SDK directly",
  !/from\s*"openai"/.test(both) && !/require\(\s*"openai"\s*\)/.test(both),
  "",
) && ok;
ok = report("no runner file constructs `new OpenAI(...)` itself", !/new\s+OpenAI\s*\(/.test(both), "") && ok;

// 4. Only openai-live.ts may touch the server-only adapter module; the
// core stays loadable in a plain unit test (no react-server condition,
// no server-only mock needed).
ok = report(
  "openai-smoke-core.ts never imports the server-only adapter (providers/openai) or the \"server-only\" marker",
  !/providers\/openai"/.test(core) && !/["']server-only["']/.test(core),
  "",
) && ok;

// 5. No generic OPENAI_API_KEY anywhere — only AQENRA_OPENAI_API_KEY
// (the underscore before OPENAI keeps it out of this negative class,
// same technique as check-ai-assistant-security.mjs rule 7).
ok = report(
  "no runner file reads a generic OPENAI_API_KEY (only AQENRA_OPENAI_API_KEY)",
  !/[^_A-Z]OPENAI_API_KEY\b/.test(both),
  "",
) && ok;

// 6. The opt-in gate: the core declares the exact env name, and the live
// entry evaluates the gate BEFORE it ever constructs the provider.
ok = report("openai-smoke-core.ts references the AQENRA_OPENAI_SMOKE opt-in", /AQENRA_OPENAI_SMOKE/.test(core), "") && ok;
const gateIdx = live.indexOf("evaluateGate(");
const constructIdx = live.indexOf("createOpenAiProvider(");
ok = report(
  "openai-live.ts evaluates the opt-in gate before constructing the provider",
  gateIdx !== -1 && constructIdx !== -1 && gateIdx < constructIdx,
  "",
) && ok;

// 7. No database / auth-service reach.
const dbPattern = /from\s*"[^"]*(?:\/lib\/prisma|generated\/prisma|\/lib\/supabase|@supabase\/)/;
ok = report("no runner file imports Prisma or Supabase", !dbPattern.test(both), "") && ok;

// 8. No app orchestration / tool-registry / provider-factory import —
// the runner is standalone synthetic-data only, it never boots the
// application's DB-backed tools or its orchestrator.
const appWiringPattern = /from\s*"[^"]*(?:\/orchestrate"|tools\/registry"|providers\/provider-factory"|\/request-context")/;
ok = report(
  "no runner file imports orchestrate / tools-registry / provider-factory / request-context",
  !appWiringPattern.test(both),
  "",
) && ok;

// 9. The adapter is the only thing allowed to perform an HTTP request —
// the runner itself makes none.
const networkPattern = /\bfetch\s*\(|https?\.request\s*\(|new\s+WebSocket\s*\(|XMLHttpRequest|new\s+EventSource\s*\(/;
ok = report("no runner file performs its own network call (fetch/http.request/WebSocket/EventSource)", !networkPattern.test(both), "") && ok;

// 10. Never enumerate the environment.
const envEnumPattern = /Object\.(keys|entries|values)\s*\(\s*process\.env|\.\.\.process\.env|JSON\.stringify\s*\(\s*process\.env|for\s*\([^)]*\bin\s+process\.env/;
ok = report("no runner file enumerates process.env", !envEnumPattern.test(both), "") && ok;

// 11. Hard request budget: every numeric assignment to
// MAX_PROVIDER_REQUESTS is exactly 3 — the declaration, and no in-place
// bump to 4+ anywhere.
const budgetAssignments = [...core.matchAll(/MAX_PROVIDER_REQUESTS\s*=\s*(\d+)/g)].map((m) => m[1]);
ok = report(
  "openai-smoke-core.ts fixes MAX_PROVIDER_REQUESTS to exactly 3 (no in-place bump)",
  budgetAssignments.length >= 1 && budgetAssignments.every((v) => v === "3"),
  budgetAssignments.join(", "),
) && ok;

// 12. No re-issue / re-attempt logic — a failed billed call is never
// sent again by the runner (comment-stripped, so a doc comment could not
// even use the word).
ok = report("no runner file contains retry/re-attempt logic", !/\bretr(?:y|ies|ied|ying)\b/i.test(both), "") && ok;

// 13. Real AbortController + signal wiring on every provider call.
ok = report(
  "openai-smoke-core.ts wires a real AbortController + signal + abort() into each provider call",
  /new\s+AbortController\s*\(\)/.test(core) && /signal:\s*controller\.signal/.test(core) && /controller\.abort\s*\(\)/.test(core),
  "",
) && ok;

// 14. Model / request configuration is NOT duplicated here — it must
// come entirely from the merged adapter.
ok = report(
  "no runner file hardcodes the model id or adapter request config (gpt-5.6-luna / reasoning_effort / parallel_tool_calls)",
  !/gpt-5\.6-luna/.test(both) && !/reasoning_effort/.test(both) && !/parallel_tool_calls/.test(both),
  "",
) && ok;

// 15. Smoke output-token cap is bounded by the application ceiling, not
// an independent free number.
ok = report(
  "openai-smoke-core.ts bounds SMOKE_MAX_OUTPUT_TOKENS by the app's MAX_OUTPUT_TOKENS",
  /SMOKE_MAX_OUTPUT_TOKENS\s*=\s*Math\.min\([^)]*MAX_OUTPUT_TOKENS/.test(core),
  "",
) && ok;

// 16. The operator command exists, launches the entry file, and pins the
// react-server export condition (so `import "server-only"` is a no-op
// rather than a throw).
let pkg = {};
try {
  pkg = JSON.parse(readIfExists(PKG_FILE));
} catch {
  pkg = {};
}
const smokeScript = pkg.scripts?.["ai:smoke:openai"] ?? "";
ok = report(
  'package.json "ai:smoke:openai" launches scripts/ai-smoke/openai-live.ts with --conditions=react-server',
  /--conditions=react-server/.test(smokeScript) && /scripts\/ai-smoke\/openai-live\.ts/.test(smokeScript),
  smokeScript,
) && ok;

// 17. The core never prints anything other than through its own return
// values — it holds no console.* at all (the entry point does the
// printing, and only of formatReport()/gateRefusalMessage() output).
ok = report("openai-smoke-core.ts contains no console.* call", !/console\.(log|error|warn|info|debug)\s*\(/.test(core), "") && ok;

process.exit(ok ? 0 : 1);
