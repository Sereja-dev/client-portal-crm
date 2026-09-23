import { describe, expect, it } from "vitest";
import { getAiAssistantSystemPrompt } from "@/lib/ai/system-prompt";
import { buildEffectiveSystemPrompt } from "@/lib/ai/temporal-context";

/**
 * AI Assistant — base system prompt, overdue-task status-filter rule.
 *
 * OFFLINE PROOF ONLY — this file proves the new instruction's literal
 * text exists in the Product runtime's own system prompt (and survives
 * into the effective, temporal-suffixed prompt every orchestrated turn
 * actually sends). It does NOT, and cannot, prove that a real provider
 * (OpenAI or Anthropic) actually changes its own tool-call behavior in
 * response to this instruction — Product has no deterministic planner
 * of its own; tool selection is entirely the model's own inference.
 * That can only be proven by a later live validation run (a bounded
 * subset targeting org-summary-03/task-03, see the overdue-query
 * hardening audit and scripts/ai-provider-eval/benchmark-version.ts's
 * own 1.8.0 History entry) — never by a test in this file.
 *
 * Uses this repo's own established prompt-assertion convention
 * (test/unit/ai/temporal-context.test.ts's own toContain(...) style)
 * — never a full-prompt snapshot, which would make every future,
 * unrelated prompt edit touch this file for no reason.
 */

describe("getAiAssistantSystemPrompt — overdue-task status-filter rule", () => {
  it("contains the exact new overdue instruction, verbatim", () => {
    const prompt = getAiAssistantSystemPrompt();
    expect(prompt).toContain(
      `When answering a question about overdue tasks, filter only by due date — never assume a specific status such as "to do" unless the user names one. A task that is already done is not overdue, regardless of its due date.`,
    );
  });

  it("includes the 'never assume a specific status unless named' protection", () => {
    const prompt = getAiAssistantSystemPrompt();
    expect(prompt).toContain(`never assume a specific status such as "to do" unless the user names one`);
  });

  it("includes the 'a done task is not overdue' protection", () => {
    const prompt = getAiAssistantSystemPrompt();
    expect(prompt).toContain("A task that is already done is not overdue, regardless of its due date.");
  });

  it("does not remove or alter any pre-existing rule (the prior 6 rules remain present, unchanged)", () => {
    const prompt = getAiAssistantSystemPrompt();
    expect(prompt).toContain("Only discuss the current organization.");
    expect(prompt).toContain("Get every business fact (clients, projects, tasks, invoices) from the tools provided to you.");
    expect(prompt).toContain("Never invent or guess a plausible-sounding fact to fill a gap.");
    expect(prompt).toContain("You cannot create, update, delete, send, archive, suspend, upload, or otherwise change anything.");
    expect(prompt).toContain("make clear it is a draft, not something that has been sent or applied anywhere.");
    expect(prompt).toContain("Never include a raw identifier, reference code, or database id in your answer.");
  });
});

describe("buildEffectiveSystemPrompt(getAiAssistantSystemPrompt()) — overdue rule survives temporal-suffix composition", () => {
  it("the effective (temporal-suffixed) prompt still contains the exact overdue instruction, unmodified", () => {
    const effective = buildEffectiveSystemPrompt({
      basePrompt: getAiAssistantSystemPrompt(),
      now: new Date("2026-09-20T05:00:00.000Z"),
      timezone: "UTC",
    });
    expect(effective).toContain(
      `When answering a question about overdue tasks, filter only by due date — never assume a specific status such as "to do" unless the user names one. A task that is already done is not overdue, regardless of its due date.`,
    );
  });

  it("the overdue rule appears before the appended temporal suffix (base prompt is never reordered)", () => {
    const effective = buildEffectiveSystemPrompt({
      basePrompt: getAiAssistantSystemPrompt(),
      now: new Date("2026-09-20T05:00:00.000Z"),
      timezone: "UTC",
    });
    const overdueRuleIndex = effective.indexOf("When answering a question about overdue tasks");
    const temporalSuffixIndex = effective.indexOf("Authoritative current date:");
    expect(overdueRuleIndex).toBeGreaterThan(-1);
    expect(temporalSuffixIndex).toBeGreaterThan(-1);
    expect(overdueRuleIndex).toBeLessThan(temporalSuffixIndex);
  });
});
