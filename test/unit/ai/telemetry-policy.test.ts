import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

/**
 * AI Production Monitoring V1 — direct, isolated unit coverage for
 * telemetry-policy.ts, mirroring test/unit/archive-compensation.test.ts's
 * own "@/lib/prisma mocked before import, no real database touched"
 * shape exactly (this file belongs to vitest.config.mts's own unit
 * suite, no PGlite harness). The end-to-end, real-Prisma proof for
 * successful persistence and genuine write-failure classification lives
 * in test/integration/ai/telemetry-policy-integration.test.ts; this
 * file's own job is narrower: prove the exact input-shaping/validation
 * contract and the exact best-effort failure-isolation behavior,
 * independent of any real database.
 *
 * telemetry-policy.ts imports the real "server-only" marker package —
 * see test/unit/ai/orchestrate.test.ts's own identical, already-
 * established precedent for why this needs neutralizing here.
 */
vi.mock("server-only", () => ({}));

const createMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAssistantTurnTelemetry: {
      create: createMock,
    },
  },
}));

const { recordAiAssistantTurnTelemetry } = await import("@/lib/ai/telemetry-policy");
type AiTurnTelemetryInput = Parameters<typeof recordAiAssistantTurnTelemetry>[0];

const BASE_INPUT: AiTurnTelemetryInput = {
  provider: "openai",
  model: "gpt-5.6-luna",
  outcome: "SUCCESS",
  latencyMs: 1234,
  providerCalls: 2,
  toolCalls: 1,
  toolNames: ["searchClients"],
  inputTokens: 100,
  outputTokens: 50,
  correlationId: "11111111-1111-1111-1111-111111111111",
};

describe("recordAiAssistantTurnTelemetry — success row shape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    createMock.mockReset();
  });

  it("writes exactly the given fields, unchanged, for a SUCCESS outcome", async () => {
    createMock.mockResolvedValueOnce({ id: "row-1" });
    const result = await recordAiAssistantTurnTelemetry(BASE_INPUT);
    expect(result).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      data: {
        provider: "openai",
        model: "gpt-5.6-luna",
        outcome: "SUCCESS",
        latencyMs: 1234,
        providerCalls: 2,
        toolCalls: 1,
        toolNames: ["searchClients"],
        inputTokens: 100,
        outputTokens: 50,
        correlationId: "11111111-1111-1111-1111-111111111111",
      },
    });
  });

  it.each(["LIMIT_EXCEEDED", "TIMEOUT", "PROVIDER_ERROR", "INVALID_RESPONSE", "EMPTY_ANSWER", "REF_LEAK"] as const)(
    "persists the %s outcome exactly as given",
    async (outcome) => {
      createMock.mockResolvedValueOnce({ id: "row-x" });
      await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, outcome });
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ outcome }) }));
    },
  );

  it("preserves provider/model exactly", async () => {
    createMock.mockResolvedValueOnce({ id: "row-2" });
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, provider: "mock", model: "mock" });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ provider: "mock", model: "mock" }) }));
  });

  it("preserves latencyMs exactly", async () => {
    createMock.mockResolvedValueOnce({ id: "row-3" });
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, latencyMs: 9999 });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ latencyMs: 9999 }) }));
  });

  it("preserves providerCalls/toolCalls exactly", async () => {
    createMock.mockResolvedValueOnce({ id: "row-4" });
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, providerCalls: 6, toolCalls: 5 });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ providerCalls: 6, toolCalls: 5 }) }));
  });

  it("preserves inputTokens/outputTokens exactly", async () => {
    createMock.mockResolvedValueOnce({ id: "row-5" });
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, inputTokens: 777, outputTokens: 888 });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ inputTokens: 777, outputTokens: 888 }) }));
  });

  it("preserves a bounded, ordered toolNames array exactly", async () => {
    createMock.mockResolvedValueOnce({ id: "row-6" });
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, toolNames: ["searchTasks", "getClientDetail"] });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ toolNames: ["searchTasks", "getClientDetail"] }) }));
  });

  it("accepts an empty toolNames array (a text-only turn with no tool call)", async () => {
    createMock.mockResolvedValueOnce({ id: "row-7" });
    const result = await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, toolNames: [] });
    expect(result).toBe(true);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ toolNames: [] }) }));
  });

  it("preserves correlationId exactly", async () => {
    createMock.mockResolvedValueOnce({ id: "row-8" });
    await recordAiAssistantTurnTelemetry({ ...BASE_INPUT, correlationId: "deadbeef-dead-beef-dead-beefdeadbeef" });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ correlationId: "deadbeef-dead-beef-dead-beefdeadbeef" }) }));
  });
});

describe("recordAiAssistantTurnTelemetry — closed input shape (no bypass possible)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    createMock.mockReset();
  });

  it("has no organizationId field possible — a bypassing caller is rejected at runtime", async () => {
    const withOrgId = { ...BASE_INPUT, organizationId: "some-org-id" } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withOrgId)).rejects.toThrow(/unexpected field "organizationId"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("has no userId field possible", async () => {
    const withUserId = { ...BASE_INPUT, userId: "some-user-id" } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withUserId)).rejects.toThrow(/unexpected field "userId"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("has no prompt field possible", async () => {
    const withPrompt = { ...BASE_INPUT, prompt: "what the user typed" } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withPrompt)).rejects.toThrow(/unexpected field "prompt"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("has no response field possible", async () => {
    const withResponse = { ...BASE_INPUT, response: "the assistant's answer" } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withResponse)).rejects.toThrow(/unexpected field "response"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("has no tool args/results field possible (toolArgs)", async () => {
    const withToolArgs = { ...BASE_INPUT, toolArgs: { q: "x" } } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withToolArgs)).rejects.toThrow(/unexpected field "toolArgs"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("has no tool args/results field possible (toolResult)", async () => {
    const withToolResult = { ...BASE_INPUT, toolResult: { rows: [] } } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withToolResult)).rejects.toThrow(/unexpected field "toolResult"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary metadata spread", async () => {
    const withMetadata = { ...BASE_INPUT, metadata: { anything: "goes" } } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withMetadata)).rejects.toThrow(/unexpected field "metadata"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a raw provider error object smuggled in", async () => {
    const withRawError = { ...BASE_INPUT, rawError: new Error("boom") } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withRawError)).rejects.toThrow(/unexpected field "rawError"/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an outcome outside the closed 7-value set", async () => {
    const withBadOutcome = { ...BASE_INPUT, outcome: "SOMETHING_ELSE" } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withBadOutcome)).rejects.toThrow(/"outcome" must be one of/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a negative count field", async () => {
    const withNegative = { ...BASE_INPUT, latencyMs: -1 } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withNegative)).rejects.toThrow(/"latencyMs" must be a finite, non-negative integer/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a non-integer count field", async () => {
    const withFraction = { ...BASE_INPUT, toolCalls: 1.5 } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withFraction)).rejects.toThrow(/"toolCalls" must be a finite, non-negative integer/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a non-array toolNames", async () => {
    const withBadToolNames = { ...BASE_INPUT, toolNames: "searchClients" } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withBadToolNames)).rejects.toThrow(/"toolNames" must be an array/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string entry inside toolNames", async () => {
    const withBadEntry = { ...BASE_INPUT, toolNames: ["searchClients", 42] } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withBadEntry)).rejects.toThrow(/every "toolNames" entry must be a non-empty string/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an empty correlationId", async () => {
    const withEmptyCorrelation = { ...BASE_INPUT, correlationId: "" } as unknown as AiTurnTelemetryInput;
    await expect(recordAiAssistantTurnTelemetry(withEmptyCorrelation)).rejects.toThrow(/"correlationId" must be a non-empty string/i);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("recordAiAssistantTurnTelemetry — best-effort persistence failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    createMock.mockReset();
  });

  it("returns false, never throws, on a genuine Prisma write failure — and logs only the fixed sanitized message plus a bounded classification", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    createMock.mockRejectedValueOnce(prismaError);

    const result = await recordAiAssistantTurnTelemetry(BASE_INPUT);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("[ai-monitoring] Failed to record AI assistant turn telemetry.", {
      classification: "known_error",
    });
  });

  it("classifies a non-Prisma throw as unexpected", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createMock.mockRejectedValueOnce(new Error("connection reset"));

    const result = await recordAiAssistantTurnTelemetry(BASE_INPUT);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("[ai-monitoring] Failed to record AI assistant turn telemetry.", {
      classification: "unexpected",
    });
  });

  it("never logs the raw thrown error, its message, or any identifier from the input", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createMock.mockRejectedValueOnce(new Error("connection to db-secret-host-01 refused"));

    await recordAiAssistantTurnTelemetry(BASE_INPUT);

    const loggedArgs = consoleErrorSpy.mock.calls.flat().map((arg) => JSON.stringify(arg));
    expect(loggedArgs).toHaveLength(2);
    expect(loggedArgs.join(" ")).not.toContain("db-secret-host-01");
    expect(loggedArgs.join(" ")).not.toContain(BASE_INPUT.correlationId);
  });

  it("never rethrows — the caller's own await resolves normally", async () => {
    createMock.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAiAssistantTurnTelemetry(BASE_INPUT)).resolves.toBe(false);
  });
});
