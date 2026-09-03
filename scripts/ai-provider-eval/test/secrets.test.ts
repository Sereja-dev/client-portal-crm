import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAnthropicEvalApiKey, getOpenAiEvalApiKey, hasAnthropicEvalApiKey, hasOpenAiEvalApiKey, redactPotentialSecrets, MissingEvalApiKeyError } from "../secrets.js";

const ENV_KEYS = ["AQENRA_EVAL_ANTHROPIC_API_KEY", "AQENRA_EVAL_OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("secrets.ts — reads only the AQENRA_EVAL_* names, never a generic fallback", () => {
  test("throws MissingEvalApiKeyError when AQENRA_EVAL_ANTHROPIC_API_KEY is unset, even if ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-some-unrelated-developer-key";
    assert.throws(() => getAnthropicEvalApiKey(), MissingEvalApiKeyError);
  });

  test("throws MissingEvalApiKeyError when AQENRA_EVAL_OPENAI_API_KEY is unset, even if OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-some-unrelated-developer-key";
    assert.throws(() => getOpenAiEvalApiKey(), MissingEvalApiKeyError);
  });

  test("the thrown error message never contains the value of an unrelated key that happens to be set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-appear-in-any-message";
    try {
      getAnthropicEvalApiKey();
      assert.fail("expected a throw");
    } catch (err) {
      assert.equal((err as Error).message.includes("should-never-appear"), false);
    }
  });

  test("returns the value once AQENRA_EVAL_ANTHROPIC_API_KEY is set", () => {
    process.env.AQENRA_EVAL_ANTHROPIC_API_KEY = "sk-ant-test-value";
    assert.equal(getAnthropicEvalApiKey(), "sk-ant-test-value");
  });

  test("hasAnthropicEvalApiKey/hasOpenAiEvalApiKey report presence without throwing", () => {
    assert.equal(hasAnthropicEvalApiKey(), false);
    assert.equal(hasOpenAiEvalApiKey(), false);
    process.env.AQENRA_EVAL_ANTHROPIC_API_KEY = "sk-ant-test";
    assert.equal(hasAnthropicEvalApiKey(), true);
  });
});

describe("secrets.ts — redaction", () => {
  test("replaces a live key value wherever it appears in a string", () => {
    process.env.AQENRA_EVAL_ANTHROPIC_API_KEY = "sk-ant-secretvalue123";
    const text = `Error calling provider with key sk-ant-secretvalue123 in header.`;
    const redacted = redactPotentialSecrets(text);
    assert.equal(redacted.includes("sk-ant-secretvalue123"), false);
    assert.ok(redacted.includes("[REDACTED_ANTHROPIC_KEY]"));
  });

  test("leaves ordinary text untouched when no key is set", () => {
    const text = "Nothing sensitive here.";
    assert.equal(redactPotentialSecrets(text), text);
  });
});
