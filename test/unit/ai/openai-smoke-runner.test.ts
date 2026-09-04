import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "@/lib/ai/provider";
import type { AiCompleteOptions, AiProvider, AiRequest, AiResponse, AiUsage } from "@/lib/ai/provider";
import { MAX_OUTPUT_TOKENS, PROVIDER_CALL_TIMEOUT_MS } from "@/lib/ai/orchestration-limits";
import { readFileSync } from "node:fs";
import {
  MAX_PROVIDER_REQUESTS,
  PER_CALL_TIMEOUT_MS,
  SMOKE_API_KEY_ENV,
  SMOKE_MAX_OUTPUT_TOKENS,
  SMOKE_OPT_IN_ENV,
  SYNTHETIC_ACCOUNT_ID,
  SYNTHETIC_TOOL,
  SmokeBudgetExceededError,
  SmokeTimeoutError,
  callWithTimeout,
  categorizeError,
  createBudgetedProvider,
  evaluateGate,
  formatReport,
  gateRefusalMessage,
  runSmoke,
  validateSyntheticToolCall,
} from "../../../scripts/ai-smoke/openai-smoke-core";

// scripts/ai-smoke/openai-smoke-core.ts deliberately imports nothing
// server-only (only the vendor-neutral provider.ts contract + the
// fixed orchestration-limits constants), so — unlike every other
// test/unit/ai/* file — this suite needs no `vi.mock("server-only")`.
// The "no DB / no server-only" property is also asserted directly below.

type Behavior =
  | { type: "text"; text: string; usage?: Partial<AiUsage> }
  | { type: "toolCall"; toolName: string; args: unknown; usage?: Partial<AiUsage> }
  | { type: "reject"; error: unknown }
  | { type: "hang" };

function usageOf(partial?: Partial<AiUsage>): AiUsage {
  return { promptTokens: 10, completionTokens: 5, totalTokens: 15, ...partial };
}

function fakeProvider(behaviors: Behavior[]) {
  const calls: { request: AiRequest; signal?: AbortSignal }[] = [];
  const provider: AiProvider = {
    providerId: "openai",
    modelId: "fake-model",
    complete(request: AiRequest, options?: AiCompleteOptions): Promise<AiResponse> {
      const index = calls.length;
      calls.push({ request, signal: options?.signal });
      const behavior = behaviors[Math.min(index, behaviors.length - 1)]!;
      switch (behavior.type) {
        case "text":
          return Promise.resolve({ kind: "text", text: behavior.text, usage: usageOf(behavior.usage) });
        case "toolCall":
          return Promise.resolve({
            kind: "toolCall",
            call: { toolName: behavior.toolName, args: behavior.args },
            usage: usageOf(behavior.usage),
          });
        case "reject":
          return Promise.reject(behavior.error);
        case "hang":
          return new Promise<AiResponse>(() => {});
      }
    },
  };
  return { provider, calls };
}

const VALID_TOOL_CALL: Behavior = { type: "toolCall", toolName: SYNTHETIC_TOOL.name, args: { accountId: SYNTHETIC_ACCOUNT_ID } };

describe("openai smoke runner — evaluateGate", () => {
  it("refuses when the opt-in is missing", () => {
    expect(evaluateGate({})).toEqual({ ok: false, reason: "missing_opt_in" });
  });

  it("refuses unless the opt-in is exactly \"1\"", () => {
    for (const value of ["0", "true", "yes", "on", " 1", "1 "]) {
      expect(evaluateGate({ [SMOKE_OPT_IN_ENV]: value, [SMOKE_API_KEY_ENV]: "sk-fake" })).toEqual({
        ok: false,
        reason: "missing_opt_in",
      });
    }
  });

  it("refuses when opted in but the key env var is missing or blank", () => {
    expect(evaluateGate({ [SMOKE_OPT_IN_ENV]: "1" })).toEqual({ ok: false, reason: "missing_api_key" });
    expect(evaluateGate({ [SMOKE_OPT_IN_ENV]: "1", [SMOKE_API_KEY_ENV]: "   " })).toEqual({
      ok: false,
      reason: "missing_api_key",
    });
  });

  it("never falls back to a generic OPENAI_API_KEY", () => {
    expect(evaluateGate({ [SMOKE_OPT_IN_ENV]: "1", OPENAI_API_KEY: "sk-generic-should-be-ignored" })).toEqual({
      ok: false,
      reason: "missing_api_key",
    });
  });

  it("passes only when the opt-in is \"1\" and AQENRA_OPENAI_API_KEY is a non-empty string", () => {
    expect(evaluateGate({ [SMOKE_OPT_IN_ENV]: "1", [SMOKE_API_KEY_ENV]: "sk-fake-not-a-real-secret" })).toEqual({ ok: true });
  });

  it("gate refusal messages never contain a key value and say nothing was constructed", () => {
    for (const reason of ["missing_opt_in", "missing_api_key"] as const) {
      const message = gateRefusalMessage(reason);
      expect(message).toMatch(/no provider was constructed and no request was made/i);
      expect(message).not.toContain("sk-");
    }
  });
});

describe("openai smoke runner — provider-request budget", () => {
  it("MAX_PROVIDER_REQUESTS is 3", () => {
    expect(MAX_PROVIDER_REQUESTS).toBe(3);
  });

  it("createBudgetedProvider rejects the call past the ceiling and never delegates it", async () => {
    const { provider: inner, calls } = fakeProvider([{ type: "text", text: "ok" }]);
    const budgeted = createBudgetedProvider(inner, 3);
    const request = { systemPrompt: "", messages: [], tools: [], maxOutputTokens: 8, timeoutMs: 10 } satisfies AiRequest;

    await budgeted.provider.complete(request);
    await budgeted.provider.complete(request);
    await budgeted.provider.complete(request);
    await expect(budgeted.provider.complete(request)).rejects.toBeInstanceOf(SmokeBudgetExceededError);

    expect(budgeted.count()).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it("a whole run can never issue more than 3 billed provider requests", async () => {
    // A passes (1 request); B asks for a tool (request 2, valid) then asks
    // for a tool again instead of answering (request 3) -> B fails. No 4th.
    const { provider, calls } = fakeProvider([
      { type: "text", text: "The synthetic smoke check is working." },
      VALID_TOOL_CALL,
      VALID_TOOL_CALL,
    ]);
    const report = await runSmoke(provider);

    expect(calls).toHaveLength(3);
    expect(report.totalProviderRequests).toBe(3);
    expect(report.totalProviderRequests).toBeLessThanOrEqual(MAX_PROVIDER_REQUESTS);
    expect(report.classification).toBe("FAIL");
    expect(report.scenarios[1]?.failureCategory).toBe("unexpected_tool_call");
  });
});

describe("openai smoke runner — failure handling never re-issues a call", () => {
  it("a provider rejection in scenario A fails the run immediately with a normalized category and one call only", async () => {
    const { provider, calls } = fakeProvider([{ type: "reject", error: new AiProviderError("rate_limited") }]);
    const report = await runSmoke(provider);

    expect(calls).toHaveLength(1);
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0]).toMatchObject({ scenario: "A", status: "FAIL", failureCategory: "provider_rate_limited" });
    expect(report.classification).toBe("FAIL");
  });

  it("categorizeError maps every AiProviderError kind and unknown throws without leaking a message", () => {
    expect(categorizeError(new AiProviderError("timeout"))).toBe("provider_timeout");
    expect(categorizeError(new AiProviderError("rate_limited"))).toBe("provider_rate_limited");
    expect(categorizeError(new AiProviderError("unavailable"))).toBe("provider_unavailable");
    expect(categorizeError(new AiProviderError("invalid_request"))).toBe("provider_invalid_request");
    expect(categorizeError(new AiProviderError("unknown"))).toBe("provider_unknown_error");
    expect(categorizeError(new SmokeTimeoutError())).toBe("smoke_timeout");
    expect(categorizeError(new SmokeBudgetExceededError())).toBe("budget_exceeded");
    expect(categorizeError(new Error("raw secret sk-leak in message"))).toBe("unknown");
  });
});

describe("openai smoke runner — synthetic tool-call validation", () => {
  it("accepts exactly the expected name + args shape + value", () => {
    expect(validateSyntheticToolCall({ toolName: SYNTHETIC_TOOL.name, args: { accountId: SYNTHETIC_ACCOUNT_ID } })).toEqual({
      ok: true,
    });
  });

  it("rejects a wrong tool name", () => {
    expect(validateSyntheticToolCall({ toolName: "deleteEverything", args: { accountId: SYNTHETIC_ACCOUNT_ID } })).toEqual({
      ok: false,
      category: "tool_name_mismatch",
    });
  });

  it("rejects non-object args, an unexpected arg key, and the malformed-arguments marker", () => {
    expect(validateSyntheticToolCall({ toolName: SYNTHETIC_TOOL.name, args: "nope" })).toMatchObject({ ok: false });
    expect(
      validateSyntheticToolCall({ toolName: SYNTHETIC_TOOL.name, args: { accountId: SYNTHETIC_ACCOUNT_ID, extra: 1 } }),
    ).toEqual({ ok: false, category: "tool_args_invalid" });
    expect(validateSyntheticToolCall({ toolName: SYNTHETIC_TOOL.name, args: { __malformedArguments: true } })).toEqual({
      ok: false,
      category: "tool_args_invalid",
    });
  });

  it("rejects a disallowed accountId value distinctly from a shape error", () => {
    expect(validateSyntheticToolCall({ toolName: SYNTHETIC_TOOL.name, args: { accountId: "acct_real_customer" } })).toEqual({
      ok: false,
      category: "tool_args_value_not_allowed",
    });
  });
});

describe("openai smoke runner — per-call abort + timeout", () => {
  it("aborts the signal handed to the adapter and rejects with SmokeTimeoutError when a call hangs", async () => {
    const { provider, calls } = fakeProvider([{ type: "hang" }]);
    const request = { systemPrompt: "", messages: [], tools: [], maxOutputTokens: 8, timeoutMs: 15 } satisfies AiRequest;

    await expect(callWithTimeout(provider, request, 15)).rejects.toBeInstanceOf(SmokeTimeoutError);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it("the per-call timeout is never looser than the application's own provider-call timeout", () => {
    expect(PER_CALL_TIMEOUT_MS).toBeLessThanOrEqual(PROVIDER_CALL_TIMEOUT_MS);
    expect(PER_CALL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("openai smoke runner — request shape stays within application ceilings", () => {
  it("SMOKE_MAX_OUTPUT_TOKENS never exceeds the app's MAX_OUTPUT_TOKENS", () => {
    expect(SMOKE_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    expect(SMOKE_MAX_OUTPUT_TOKENS).toBeGreaterThan(0);
  });

  it("every request the runner builds carries the bounded maxOutputTokens and a per-call timeout", async () => {
    const { provider, calls } = fakeProvider([
      { type: "text", text: "The synthetic smoke check is working." },
      VALID_TOOL_CALL,
      { type: "text", text: "The account status is active." },
    ]);
    await runSmoke(provider);
    expect(calls).toHaveLength(3);
    for (const { request } of calls) {
      expect(request.maxOutputTokens).toBe(SMOKE_MAX_OUTPUT_TOKENS);
      expect(request.maxOutputTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
      expect(request.timeoutMs).toBe(PER_CALL_TIMEOUT_MS);
    }
    // Only scenario B's calls carry the synthetic tool; scenario A carries none.
    expect(calls[0]?.request.tools).toEqual([]);
    expect(calls[1]?.request.tools).toEqual([SYNTHETIC_TOOL]);
  });
});

describe("openai smoke runner — happy path + sanitized report", () => {
  it("PASS when A returns text and B does tool-call -> synthetic result -> final text", async () => {
    const { provider } = fakeProvider([
      { type: "text", text: "The synthetic smoke check is working.", usage: { promptTokens: 30, completionTokens: 8, totalTokens: 38 } },
      { ...VALID_TOOL_CALL, usage: { promptTokens: 40, completionTokens: 6, totalTokens: 46 } },
      { type: "text", text: "The account status is active.", usage: { promptTokens: 55, completionTokens: 9, totalTokens: 64 } },
    ]);

    const report = await runSmoke(provider);

    expect(report.classification).toBe("PASS");
    expect(report.scenarios.map((s) => s.status)).toEqual(["PASS", "PASS"]);
    expect(report.totalProviderRequests).toBe(3);
    expect(report.usage.totalTokens).toBe(38 + 46 + 64);
    expect(report.approxCostUsd).toBeGreaterThan(0);
    expect(report.pricingSnapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("scenario A getting a tool call fails fast and scenario B is not run", async () => {
    const { provider, calls } = fakeProvider([VALID_TOOL_CALL]);
    const report = await runSmoke(provider);
    expect(calls).toHaveLength(1);
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0]).toMatchObject({ scenario: "A", status: "FAIL", failureCategory: "unexpected_tool_call" });
  });

  it("formatReport emits only safe metadata — never prompt text, model answers, tool args, tool results, or a key", async () => {
    const SECRET_ANSWER = "ANSWER-LEAK-51c1c1c1 and uuid 11111111-1111-1111-1111-111111111111";
    const INJECTED_ARG = "PROMPT-INJECTION-LEAK";
    const { provider } = fakeProvider([
      { type: "text", text: SECRET_ANSWER },
      { type: "toolCall", toolName: SYNTHETIC_TOOL.name, args: { accountId: SYNTHETIC_ACCOUNT_ID, injected: INJECTED_ARG } },
    ]);

    const report = await runSmoke(provider);
    const output = formatReport(report);

    expect(output).not.toContain("ANSWER-LEAK");
    expect(output).not.toContain(INJECTED_ARG);
    expect(output).not.toContain("11111111-1111-1111-1111-111111111111");
    expect(output).not.toContain(SYNTHETIC_ACCOUNT_ID);
    expect(output).not.toContain("Synthetic Smoke Account");
    expect(output).not.toContain("Reply with exactly the sentence");
    expect(output).not.toMatch(/sk-[A-Za-z0-9]/);
    // What it SHOULD contain: fixed labels + counts only.
    expect(output).toContain("classification: FAIL");
    expect(output).toContain("total provider requests: 2 (hard max 3)");
    // An unexpected arg key is rejected at request 1 — the 2nd billed call is never spent.
    expect(output).toContain("scenario B (tool-call): FAIL  requests=1  tokens(p/c/t)=10/5/15  failure=tool_args_invalid");
  });
});

describe("openai smoke runner — no database / server-only dependency", () => {
  const CORE_SOURCE = readFileSync("scripts/ai-smoke/openai-smoke-core.ts", "utf8");
  const LIVE_SOURCE = readFileSync("scripts/ai-smoke/openai-live.ts", "utf8");
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("the core imports nothing server-only, Prisma, Supabase, the tool registry, or orchestration", () => {
    for (const forbidden of [
      '"server-only"',
      "@/lib/prisma",
      "generated/prisma",
      "@/lib/supabase",
      "@supabase/",
      "tools/registry",
      "/orchestrate\"",
      "provider-factory",
      "providers/openai\"",
    ]) {
      expect(CORE_SOURCE).not.toContain(forbidden);
    }
  });

  it("the live entry's only src/lib/ai import is the merged adapter (plus the local core)", () => {
    const specifiers = [...LIVE_SOURCE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    const aiImports = specifiers.filter((s) => s.includes("src/lib/ai") || s.includes("/lib/ai/"));
    expect(aiImports).toEqual(["../../src/lib/ai/providers/openai"]);
  });

  it("neither runner file reads a generic OPENAI_API_KEY or constructs its own OpenAI client", () => {
    for (const source of [CORE_SOURCE, LIVE_SOURCE]) {
      const code = stripComments(source);
      // No generic-key *read* of any shape (comment prose may still discuss it).
      expect(code).not.toMatch(/process\.env\.OPENAI_API_KEY\b/);
      expect(code).not.toMatch(/env\.OPENAI_API_KEY\b/);
      expect(code).not.toMatch(/\[["']OPENAI_API_KEY["']\]/);
      expect(code).not.toMatch(/new\s+OpenAI\s*\(/);
    }
  });
});

describe("openai smoke runner — spies confirm nothing is logged from the core", () => {
  it("runSmoke never calls console.* itself (the entry point owns all printing)", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const { provider } = fakeProvider([
        { type: "text", text: "The synthetic smoke check is working." },
        VALID_TOOL_CALL,
        { type: "text", text: "The account status is active." },
      ]);
      await runSmoke(provider);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
