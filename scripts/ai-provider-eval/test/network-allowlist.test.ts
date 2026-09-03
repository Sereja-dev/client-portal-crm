import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertAllowedProviderHost, getAllowedHosts, DisallowedNetworkHostError } from "../network-allowlist.js";

describe("network-allowlist.ts — mechanical outbound host guard (no network traffic sent by these tests)", () => {
  test("allows the exact Anthropic API host", () => {
    assert.doesNotThrow(() => assertAllowedProviderHost("https://api.anthropic.com"));
  });

  test("allows the exact OpenAI API host (with its default /v1 path)", () => {
    assert.doesNotThrow(() => assertAllowedProviderHost("https://api.openai.com/v1"));
  });

  test("rejects an arbitrary, non-allowlisted host", () => {
    assert.throws(() => assertAllowedProviderHost("https://evil.example.com"), DisallowedNetworkHostError);
  });

  test("rejects a Supabase-shaped URL", () => {
    assert.throws(() => assertAllowedProviderHost("https://some-project.supabase.co"), DisallowedNetworkHostError);
  });

  test("rejects a plain-HTTP (non-TLS) version of an otherwise-allowed host", () => {
    assert.throws(() => assertAllowedProviderHost("http://api.anthropic.com"), DisallowedNetworkHostError);
  });

  test("rejects a malformed URL rather than throwing an unrelated error", () => {
    assert.throws(() => assertAllowedProviderHost("not a url at all"), DisallowedNetworkHostError);
  });

  test("rejects a lookalike host (subdomain/suffix trick)", () => {
    assert.throws(() => assertAllowedProviderHost("https://api.anthropic.com.evil.example.com"), DisallowedNetworkHostError);
    assert.throws(() => assertAllowedProviderHost("https://notapi.anthropic.com"), DisallowedNetworkHostError);
  });

  test("getAllowedHosts() exposes exactly the two approved hosts, nothing else", () => {
    assert.deepEqual([...getAllowedHosts()].sort(), ["api.anthropic.com", "api.openai.com"]);
  });
});
