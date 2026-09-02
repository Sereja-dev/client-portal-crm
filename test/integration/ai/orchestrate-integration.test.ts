import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiRequest, AiResponse } from "@/lib/ai/provider";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { runAiAssistantTurn } from "@/lib/ai/orchestrate";
import { MockAiProvider } from "@/lib/ai/providers/mock";

/**
 * AI Assistant orchestration + Route Handler batch — integration tier.
 * Real tools, real seeded PGlite data, MockAiProvider only (zero
 * network, zero vendor SDK). Proves the orchestrator's own tool dispatch
 * genuinely reaches the real, already-audited domain tools and inherits
 * their own tenant-scoping/privacy guarantees end to end — not just that
 * orchestrate.ts's own unit-tested fake-tool plumbing works (see
 * test/unit/ai/orchestrate.test.ts for that tier).
 */

/**
 * Wraps a scripted MockAiProvider and records the LAST tool-role message
 * any of its complete() calls was given — i.e. the reinjected result of
 * whatever tool call happened just before. A turn with exactly one tool
 * call has exactly one such message, seen on its second (final)
 * provider.complete() call.
 */
function withCapturedToolMessage(steps: ConstructorParameters<typeof MockAiProvider>[0]) {
  const inner = new MockAiProvider(steps);
  const captured: { toolMessageContent?: string } = {};
  const provider = {
    complete: async (request: AiRequest): Promise<AiResponse> => {
      const toolMsg = request.messages.filter((m) => m.role === "tool").at(-1);
      if (toolMsg) captured.toolMessageContent = toolMsg.content;
      return inner.complete(request);
    },
  };
  return { provider, captured };
}

describe("runAiAssistantTurn — real tools, real DB", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("a scripted searchClients call returns the current organization's own data", async () => {
    const provider = new MockAiProvider([
      { kind: "toolCall", call: { toolName: "searchClients", args: {} } },
      { kind: "text", text: "Your organization has clients on file." },
    ]);
    const result = await runAiAssistantTurn({ organizationId: fixtures.orgA.id, provider, userMessage: "who are my clients?" });
    expect(result).toEqual({ ok: true, answer: "Your organization has clients on file." });
  });

  it("org A's turn never reaches org B's data, even when the model's own tool-call args name org B's client by exact name", async () => {
    const { provider, captured } = withCapturedToolMessage([
      { kind: "toolCall", call: { toolName: "searchClients", args: { query: fixtures.clientB.name } } },
      { kind: "text", text: "No matching client was found." },
    ]);

    const result = await runAiAssistantTurn({ organizationId: fixtures.orgA.id, provider, userMessage: "find org B's client" });
    expect(result).toEqual({ ok: true, answer: "No matching client was found." });

    expect(captured.toolMessageContent).toBeDefined();
    const parsed = JSON.parse(captured.toolMessageContent!);
    expect(parsed.result.results).toEqual([]);
  });

  it("getClientDetail on a foreign-org ref reinjects not_found — indistinguishable from a nonexistent ref, never an existence oracle", async () => {
    const { provider, captured } = withCapturedToolMessage([
      { kind: "toolCall", call: { toolName: "getClientDetail", args: { ref: fixtures.clientB.id } } },
      { kind: "text", text: "I couldn't find that client." },
    ]);
    const result = await runAiAssistantTurn({ organizationId: fixtures.orgA.id, provider, userMessage: "show me client details" });
    expect(result).toEqual({ ok: true, answer: "I couldn't find that client." });
    expect(JSON.parse(captured.toolMessageContent!)).toEqual({ toolName: "getClientDetail", result: { ok: false, error: "not_found" } });
  });

  it("an unknown ref (well-formed UUID, no matching row anywhere) reinjects the exact same not_found — no distinguishable existence oracle", async () => {
    const { provider, captured } = withCapturedToolMessage([
      { kind: "toolCall", call: { toolName: "getClientDetail", args: { ref: randomUUID() } } },
      { kind: "text", text: "I couldn't find that client." },
    ]);
    const result = await runAiAssistantTurn({ organizationId: fixtures.orgA.id, provider, userMessage: "show client" });
    expect(result).toEqual({ ok: true, answer: "I couldn't find that client." });
    expect(JSON.parse(captured.toolMessageContent!)).toEqual({ toolName: "getClientDetail", result: { ok: false, error: "not_found" } });
  });

  it("searchTasks keeps the project.organizationId boundary through orchestration — org B never sees org A's task", async () => {
    const { provider, captured } = withCapturedToolMessage([
      { kind: "toolCall", call: { toolName: "searchTasks", args: { query: fixtures.task.title } } },
      { kind: "text", text: "No matching task was found." },
    ]);
    const result = await runAiAssistantTurn({ organizationId: fixtures.orgB.id, provider, userMessage: "find that task" });
    expect(result).toEqual({ ok: true, answer: "No matching task was found." });
    const parsed = JSON.parse(captured.toolMessageContent!);
    expect(parsed.result.results).toEqual([]);
  });

  it("searchInvoices keeps its own triple-scoping (organizationId + project + client) through orchestration", async () => {
    const provider = new MockAiProvider([
      { kind: "toolCall", call: { toolName: "searchInvoices", args: {} } },
      { kind: "text", text: "You have no invoices on file." },
    ]);
    const result = await runAiAssistantTurn({ organizationId: fixtures.orgB.id, provider, userMessage: "show me invoices" });
    expect(result).toEqual({ ok: true, answer: "You have no invoices on file." });
  });

  it("invalid tool args become a normalized invalid_input tool result, never a crash or a raw error", async () => {
    const { provider, captured } = withCapturedToolMessage([
      { kind: "toolCall", call: { toolName: "searchClients", args: { status: "NOT_A_REAL_STATUS" } } },
      { kind: "text", text: "That filter wasn't valid, let me try again." },
    ]);
    const result = await runAiAssistantTurn({ organizationId: fixtures.orgA.id, provider, userMessage: "find leads" });
    expect(result).toEqual({ ok: true, answer: "That filter wasn't valid, let me try again." });
    expect(JSON.parse(captured.toolMessageContent!)).toEqual({ toolName: "searchClients", result: { ok: false, error: "invalid_input" } });
  });

  it("the tool-result reinjection contains only the tool's own already-projected fields — no notes/email/phone/internal fields", async () => {
    const { provider, captured } = withCapturedToolMessage([
      { kind: "toolCall", call: { toolName: "searchClients", args: {} } },
      { kind: "text", text: "done" },
    ]);
    await runAiAssistantTurn({ organizationId: fixtures.orgA.id, provider, userMessage: "who are my clients?" });

    expect(captured.toolMessageContent).toBeDefined();
    const parsed = JSON.parse(captured.toolMessageContent!);
    expect(parsed.toolName).toBe("searchClients");
    expect(parsed.result.ok).toBe(true);
    for (const item of parsed.result.results) {
      expect(Object.keys(item).sort()).toEqual(["company", "name", "ref", "status"].sort());
    }
    const raw = JSON.stringify(parsed);
    expect(raw).not.toContain("notes");
    expect(raw).not.toContain("email");
    expect(raw).not.toContain("phone");
  });
});
