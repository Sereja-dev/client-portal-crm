/**
 * AQENRA — real OpenAI live smoke runner (shared core).
 *
 * Operator-only. This module holds every decision the smoke runner makes
 * EXCEPT constructing the real provider — the opt-in gate, the two
 * synthetic scenarios, the hard provider-request budget, the per-call
 * abort/timeout wiring, the normalized failure taxonomy, and the
 * sanitized report formatter. It is deliberately transport-agnostic: it
 * only ever talks to the vendor-neutral `AiProvider` shape from
 * src/lib/ai/provider.ts, so the offline test suite
 * (test/unit/ai/openai-smoke-runner.test.ts) exercises all of this logic
 * against an injected fake provider with zero network access.
 *
 * The one file that imports the real merged adapter
 * (src/lib/ai/providers/openai.ts) is the thin entry point
 * scripts/ai-smoke/openai-live.ts — never this module. This module
 * imports NOTHING that touches Prisma, Supabase, the app tool registry,
 * or orchestration; it must stay loadable in a plain unit test without a
 * database.
 *
 * Not a benchmark, not production enablement. See
 * docs/ai-assistant-openai-smoke.md.
 */

import { AiProviderError } from "../../src/lib/ai/provider";
import type {
  AiCompleteOptions,
  AiProvider,
  AiRequest,
  AiResponse,
  AiToolCall,
  AiToolSpec,
  AiUsage,
} from "../../src/lib/ai/provider";
import { MAX_OUTPUT_TOKENS, PROVIDER_CALL_TIMEOUT_MS } from "../../src/lib/ai/orchestration-limits";

// --- Operator opt-in ---------------------------------------------------

/** The explicit operator opt-in. Must be exactly "1"; anything else means "do not run". */
export const SMOKE_OPT_IN_ENV = "AQENRA_OPENAI_SMOKE";

/**
 * The real OpenAI key env var — the SAME one the merged production
 * adapter reads (src/lib/ai/providers/openai-config.ts). This runner
 * never reads a generic `OPENAI_API_KEY`, and never inspects the value's
 * prefix, length, hash, or content — only its boolean presence.
 */
export const SMOKE_API_KEY_ENV = "AQENRA_OPENAI_API_KEY";

/**
 * Hard ceiling on ACTUAL billed provider requests for one whole smoke
 * run: scenario A costs 1, scenario B costs 2, nothing else is ever
 * issued. Enforced structurally (each scenario makes a fixed number of
 * calls) AND centrally by the budgeted provider wrapper below.
 */
export const MAX_PROVIDER_REQUESTS = 3;

/**
 * Per-call wall-clock ceiling. Never looser than the application's own
 * per-provider-call timeout — `Math.min` keeps this correct even if the
 * app constant is lowered later.
 */
export const PER_CALL_TIMEOUT_MS = Math.min(15_000, PROVIDER_CALL_TIMEOUT_MS);

/**
 * Output-token ceiling for smoke requests. Deliberately far below — and
 * asserted to never exceed — the application's own MAX_OUTPUT_TOKENS
 * (1024): the smoke only needs a sentence back, and a smaller cap keeps
 * the (already tiny) cost lower still.
 */
export const SMOKE_MAX_OUTPUT_TOKENS = Math.min(256, MAX_OUTPUT_TOKENS);

/**
 * Local, static pricing used ONLY to turn the SDK's already-returned
 * token usage into an approximate dollar figure for the report. Mirrors
 * the numbers in scripts/ai-provider-eval/pricing.ts (that harness is
 * isolated and intentionally NOT imported here). Reverify against
 * first-party OpenAI pricing before relying on the figure.
 */
export const OPENAI_SMOKE_PRICING = {
  snapshotDate: "2026-09-03",
  inputPerMillionUsd: 0.2,
  outputPerMillionUsd: 1.2,
} as const;

// --- Synthetic, hard-coded test data --------------------------------

/** The exact synthetic account id the model is told to pass. Fictional; not a UUID; not tied to any real record. */
export const SYNTHETIC_ACCOUNT_ID = "acct_synthetic_000";

/**
 * One clearly-fake, read-only tool. No mutation verbs, no real domain
 * name, no customer content. Its only purpose is to prove the
 * provider tool-call round-trip:
 *   real OpenAI request
 *   -> provider tool-call response
 *   -> normalized AiToolCall (validated here)
 *   -> hard-coded synthetic tool result fed back
 *   -> real OpenAI continuation
 *   -> normalized final text response.
 */
export const SYNTHETIC_TOOL: AiToolSpec = {
  name: "getSyntheticAccountSummary",
  description:
    "TEST-ONLY synthetic tool for transport smoke-testing. Returns a fixed, fictional account summary. Not connected to any real data, database, or customer. Read-only.",
  inputSchema: {
    type: "object",
    properties: {
      accountId: {
        type: "string",
        enum: [SYNTHETIC_ACCOUNT_ID],
        description: `The synthetic account id. Always "${SYNTHETIC_ACCOUNT_ID}".`,
      },
    },
    required: ["accountId"],
    additionalProperties: false,
  },
};

/** Deterministic, hard-coded. Never derived from a database or any live source. */
export const SYNTHETIC_TOOL_RESULT = {
  accountId: SYNTHETIC_ACCOUNT_ID,
  displayName: "Synthetic Smoke Account",
  status: "active",
  openProjects: 2,
} as const;

const SYNTHETIC_SYSTEM_PROMPT =
  "You are a smoke-test fixture. Answer with a single short plain sentence. Do not include identifiers, code, or markdown.";

const SCENARIO_A_USER_MESSAGE =
  "Reply with exactly the sentence: The synthetic smoke check is working.";

const SCENARIO_B_USER_MESSAGE = `Call the getSyntheticAccountSummary tool with accountId "${SYNTHETIC_ACCOUNT_ID}", then tell me the account status in one short sentence.`;

// --- Failure taxonomy (normalized; never carries a raw message) -----

export type SmokeFailureCategory =
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_invalid_request"
  | "provider_unknown_error"
  | "smoke_timeout"
  | "budget_exceeded"
  | "unexpected_tool_call"
  | "unexpected_text_response"
  | "empty_text_response"
  | "tool_name_mismatch"
  | "tool_args_invalid"
  | "tool_args_value_not_allowed"
  | "malformed_response"
  | "unknown";

export class SmokeTimeoutError extends Error {
  constructor() {
    super("smoke per-call timeout");
    this.name = "SmokeTimeoutError";
  }
}

export class SmokeBudgetExceededError extends Error {
  constructor() {
    super("smoke provider-request budget exceeded");
    this.name = "SmokeBudgetExceededError";
  }
}

/** Maps any thrown value to a single normalized category — never the raw message/stack/SDK object. */
export function categorizeError(err: unknown): SmokeFailureCategory {
  if (err instanceof SmokeTimeoutError) return "smoke_timeout";
  if (err instanceof SmokeBudgetExceededError) return "budget_exceeded";
  if (err instanceof AiProviderError) {
    switch (err.kind) {
      case "timeout":
        return "provider_timeout";
      case "rate_limited":
        return "provider_rate_limited";
      case "unavailable":
        return "provider_unavailable";
      case "invalid_request":
        return "provider_invalid_request";
      default:
        return "provider_unknown_error";
    }
  }
  return "unknown";
}

// --- Opt-in gate ---------------------------------------------------

export type GateResult = { ok: true } | { ok: false; reason: "missing_opt_in" | "missing_api_key" };

/**
 * Pure: decides whether the smoke may run at all, from a plain env bag.
 *   - opt-in must be exactly "1" (not "0", "true", "yes", or unset)
 *   - key must be a non-empty string in SMOKE_API_KEY_ENV specifically
 *   - a generic OPENAI_API_KEY is never consulted
 * The value is never inspected beyond "non-empty after trim".
 */
export function evaluateGate(env: Record<string, string | undefined>): GateResult {
  if (env[SMOKE_OPT_IN_ENV] !== "1") {
    return { ok: false, reason: "missing_opt_in" };
  }
  const key = env[SMOKE_API_KEY_ENV];
  if (typeof key !== "string" || key.trim().length === 0) {
    return { ok: false, reason: "missing_api_key" };
  }
  return { ok: true };
}

// --- Budgeted provider wrapper -----------------------------------

export type BudgetedProvider = {
  provider: AiProvider;
  /** Count of provider.complete() calls actually started (a started-but-failed call still counts). */
  count(): number;
};

/**
 * Wraps a provider so that the (max)-th call is the last one ever
 * allowed: the very next call throws SmokeBudgetExceededError BEFORE
 * delegating, so a real billed request can never be issued past the
 * budget. Increments before delegating, so a call that starts and then
 * throws is still counted. Contains no re-issue / re-attempt logic of
 * any kind — one settled outcome per call.
 */
export function createBudgetedProvider(inner: AiProvider, max: number = MAX_PROVIDER_REQUESTS): BudgetedProvider {
  let started = 0;
  const provider: AiProvider = {
    providerId: inner.providerId,
    modelId: inner.modelId,
    complete(request: AiRequest, options?: AiCompleteOptions): Promise<AiResponse> {
      if (started >= max) {
        return Promise.reject(new SmokeBudgetExceededError());
      }
      started += 1;
      return inner.complete(request, options);
    },
  };
  return { provider, count: () => started };
}

// --- Per-call abort + timeout -----------------------------------

/**
 * One provider call, bounded by a real AbortController: the same timer
 * that loses the Promise.race also aborts the signal handed to the
 * adapter, so a cooperative adapter cancels its in-flight HTTP request
 * rather than leaking it. Mirrors
 * src/lib/ai/orchestrate.ts::callProviderWithTimeout. The timer is
 * always cleared. Exactly one settled outcome — a response or a thrown
 * error — per invocation; the call is never issued a second time.
 */
export async function callWithTimeout(
  provider: AiProvider,
  request: AiRequest,
  timeoutMs: number = PER_CALL_TIMEOUT_MS,
): Promise<AiResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SmokeTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider.complete(request, { signal: controller.signal }), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// --- Response validation --------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ToolCallValidation = { ok: true } | { ok: false; category: SmokeFailureCategory };

/**
 * Validates a normalized AiToolCall against SYNTHETIC_TOOL: exact tool
 * name, object args, no malformed-arguments marker, only the one allowed
 * key, string type, and the one allowed value.
 */
export function validateSyntheticToolCall(call: AiToolCall): ToolCallValidation {
  if (call.toolName !== SYNTHETIC_TOOL.name) {
    return { ok: false, category: "tool_name_mismatch" };
  }
  if (!isPlainObject(call.args)) {
    return { ok: false, category: "tool_args_invalid" };
  }
  if ("__malformedArguments" in call.args) {
    return { ok: false, category: "tool_args_invalid" };
  }
  const keys = Object.keys(call.args);
  if (keys.some((k) => k !== "accountId")) {
    return { ok: false, category: "tool_args_invalid" };
  }
  if (typeof call.args.accountId !== "string") {
    return { ok: false, category: "tool_args_invalid" };
  }
  if (call.args.accountId !== SYNTHETIC_ACCOUNT_ID) {
    return { ok: false, category: "tool_args_value_not_allowed" };
  }
  return { ok: true };
}

// --- Scenarios --------------------------------------------------

export type ScenarioName = "A" | "B";

export type ScenarioResult = {
  scenario: ScenarioName;
  label: string;
  status: "PASS" | "FAIL";
  providerRequests: number;
  usage: AiUsage;
  failureCategory?: SmokeFailureCategory;
};

const ZERO_USAGE: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function baseRequest(overrides: Partial<AiRequest>): AiRequest {
  return {
    systemPrompt: SYNTHETIC_SYSTEM_PROMPT,
    messages: [],
    tools: [],
    maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
    timeoutMs: PER_CALL_TIMEOUT_MS,
    ...overrides,
  };
}

/** Scenario A — one billed request, expect a normalized non-empty text response. */
export async function runScenarioA(provider: AiProvider): Promise<ScenarioResult> {
  const label = "no-tool";
  let usage: AiUsage = ZERO_USAGE;
  try {
    const response = await callWithTimeout(
      provider,
      baseRequest({ messages: [{ role: "user", content: SCENARIO_A_USER_MESSAGE }] }),
    );
    if (response.kind === "toolCall") {
      return { scenario: "A", label, status: "FAIL", providerRequests: 1, usage, failureCategory: "unexpected_tool_call" };
    }
    usage = response.usage;
    if (typeof response.text !== "string" || response.text.trim().length === 0) {
      return { scenario: "A", label, status: "FAIL", providerRequests: 1, usage, failureCategory: "empty_text_response" };
    }
    return { scenario: "A", label, status: "PASS", providerRequests: 1, usage };
  } catch (err) {
    return { scenario: "A", label, status: "FAIL", providerRequests: 1, usage, failureCategory: categorizeError(err) };
  }
}

/**
 * Scenario B — up to two billed requests:
 *   1. supply SYNTHETIC_TOOL, expect a normalized tool call, validate it
 *   2. feed the hard-coded synthetic result back, expect a final text answer
 * Structurally never more than two calls; no continuation loop.
 */
export async function runScenarioB(provider: AiProvider): Promise<ScenarioResult> {
  const label = "tool-call";
  let requests = 0;
  let usage: AiUsage = ZERO_USAGE;
  try {
    requests = 1;
    const first = await callWithTimeout(
      provider,
      baseRequest({ messages: [{ role: "user", content: SCENARIO_B_USER_MESSAGE }], tools: [SYNTHETIC_TOOL] }),
    );
    if (first.kind === "text") {
      return {
        scenario: "B",
        label,
        status: "FAIL",
        providerRequests: requests,
        usage: first.usage,
        failureCategory: "unexpected_text_response",
      };
    }
    usage = first.usage;
    const validation = validateSyntheticToolCall(first.call);
    if (!validation.ok) {
      return { scenario: "B", label, status: "FAIL", providerRequests: requests, usage, failureCategory: validation.category };
    }

    requests = 2;
    const second = await callWithTimeout(
      provider,
      baseRequest({
        messages: [
          { role: "user", content: SCENARIO_B_USER_MESSAGE },
          { role: "assistant", content: JSON.stringify({ toolName: first.call.toolName, args: first.call.args }) },
          { role: "tool", content: JSON.stringify({ toolName: SYNTHETIC_TOOL.name, result: SYNTHETIC_TOOL_RESULT }) },
        ],
        tools: [SYNTHETIC_TOOL],
      }),
    );
    if (second.kind === "toolCall") {
      return { scenario: "B", label, status: "FAIL", providerRequests: requests, usage, failureCategory: "unexpected_tool_call" };
    }
    usage = addUsage(usage, second.usage);
    if (typeof second.text !== "string" || second.text.trim().length === 0) {
      return { scenario: "B", label, status: "FAIL", providerRequests: requests, usage, failureCategory: "empty_text_response" };
    }
    return { scenario: "B", label, status: "PASS", providerRequests: requests, usage };
  } catch (err) {
    return {
      scenario: "B",
      label,
      status: "FAIL",
      providerRequests: Math.max(requests, 1),
      usage,
      failureCategory: categorizeError(err),
    };
  }
}

// --- Whole-run orchestration + report --------------------------

export type SmokeReport = {
  provider: string;
  model: string;
  scenarios: ScenarioResult[];
  totalProviderRequests: number;
  budget: number;
  usage: AiUsage;
  approxCostUsd: number;
  pricingSnapshotDate: string;
  classification: "PASS" | "FAIL";
};

export function estimateCostUsd(usage: AiUsage): number {
  return (
    (usage.promptTokens / 1_000_000) * OPENAI_SMOKE_PRICING.inputPerMillionUsd +
    (usage.completionTokens / 1_000_000) * OPENAI_SMOKE_PRICING.outputPerMillionUsd
  );
}

/**
 * Runs scenario A, then (only if A passed) scenario B, against a single
 * budgeted view of the provider. Stops at the first failing scenario —
 * a failed scenario is never run again. Total billed requests can never
 * exceed MAX_PROVIDER_REQUESTS.
 */
export async function runSmoke(inner: AiProvider): Promise<SmokeReport> {
  const budgeted = createBudgetedProvider(inner, MAX_PROVIDER_REQUESTS);
  const scenarios: ScenarioResult[] = [];

  const a = await runScenarioA(budgeted.provider);
  scenarios.push(a);
  if (a.status === "PASS") {
    const b = await runScenarioB(budgeted.provider);
    scenarios.push(b);
  }

  const usage = scenarios.reduce<AiUsage>((acc, s) => addUsage(acc, s.usage), ZERO_USAGE);
  const classification: "PASS" | "FAIL" = scenarios.every((s) => s.status === "PASS") ? "PASS" : "FAIL";

  return {
    provider: inner.providerId ?? "unknown",
    model: inner.modelId ?? "unknown",
    scenarios,
    totalProviderRequests: budgeted.count(),
    budget: MAX_PROVIDER_REQUESTS,
    usage,
    approxCostUsd: estimateCostUsd(usage),
    pricingSnapshotDate: OPENAI_SMOKE_PRICING.snapshotDate,
    classification,
  };
}

/**
 * The ONLY thing the runner ever prints on the happy path: fixed, safe
 * metadata. No prompt text, no model answer, no tool arguments, no tool
 * result payload, no key, no SDK object, no headers, no request id, no
 * stack. Token counts and the model identity string are metadata, not
 * content (same classification as src/lib/ai/logging-policy.ts).
 */
export function formatReport(report: SmokeReport): string {
  const lines: string[] = [];
  lines.push("AQENRA OPENAI LIVE SMOKE — sanitized result");
  lines.push(`provider: ${report.provider}`);
  lines.push(`model: ${report.model}`);
  for (const s of report.scenarios) {
    const u = `tokens(p/c/t)=${s.usage.promptTokens}/${s.usage.completionTokens}/${s.usage.totalTokens}`;
    const fail = s.failureCategory ? `  failure=${s.failureCategory}` : "";
    lines.push(`scenario ${s.scenario} (${s.label}): ${s.status}  requests=${s.providerRequests}  ${u}${fail}`);
  }
  lines.push(`total provider requests: ${report.totalProviderRequests} (hard max ${report.budget})`);
  lines.push(
    `approx cost: ~$${report.approxCostUsd.toFixed(6)} USD (pricing snapshot ${report.pricingSnapshotDate}; reverify before relying on this)`,
  );
  lines.push(`classification: ${report.classification}`);
  return lines.join("\n");
}

/** Human-readable, safe one-liner for a gate refusal. Never mentions the key value. */
export function gateRefusalMessage(reason: "missing_opt_in" | "missing_api_key"): string {
  if (reason === "missing_opt_in") {
    return `Refusing to run: set ${SMOKE_OPT_IN_ENV}=1 to explicitly opt in to a minimal billed OpenAI smoke test. No provider was constructed and no request was made.`;
  }
  return `Refusing to run: ${SMOKE_API_KEY_ENV} is not set (or empty). Export it in your shell first. No generic key fallback is consulted. No provider was constructed and no request was made.`;
}
