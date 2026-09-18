import { describe, it, expect, beforeEach, vi } from "vitest";

// src/lib/integrations/crypto.ts imports the real "server-only" marker
// package, which throws outside Next's own build — same reasoning
// test/unit/invoice-pdf-logo.test.ts's own identical mock documents.
vi.mock("server-only", () => ({}));

import {
  encryptCredential,
  decryptCredential,
  IntegrationCredentialCryptoError,
  CURRENT_CREDENTIAL_KEY_VERSION,
} from "@/lib/integrations/crypto";

const VALID_KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 2).toString("base64");
const CTX = { organizationId: "org-1", provider: "SLACK_INCOMING_WEBHOOK" };
const PLAINTEXT = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX";

describe("integrations/crypto", () => {
  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY_V1 = VALID_KEY;
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY_V2;
  });

  it("round-trips a plaintext value", () => {
    const { ciphertext, keyVersion } = encryptCredential(PLAINTEXT, CTX);
    expect(keyVersion).toBe(CURRENT_CREDENTIAL_KEY_VERSION);
    expect(decryptCredential(ciphertext, keyVersion, CTX)).toBe(PLAINTEXT);
  });

  it("produces different ciphertext for the same plaintext across two encryptions (random IV)", () => {
    const first = encryptCredential(PLAINTEXT, CTX);
    const second = encryptCredential(PLAINTEXT, CTX);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("never contains the plaintext substring in the ciphertext", () => {
    const { ciphertext } = encryptCredential(PLAINTEXT, CTX);
    expect(ciphertext).not.toContain(PLAINTEXT);
    expect(ciphertext).not.toContain("hooks.slack.com");
  });

  it("rejects a tampered ciphertext body", () => {
    const { ciphertext, keyVersion } = encryptCredential(PLAINTEXT, CTX);
    const parts = ciphertext.split(".");
    // Flip the ciphertext segment (index 2) — corrupt one base64 char.
    const corrupted = parts[2].slice(0, -2) + (parts[2].at(-2) === "A" ? "B" : "A") + parts[2].slice(-1);
    const tampered = [parts[0], parts[1], corrupted, parts[3]].join(".");
    expect(() => decryptCredential(tampered, keyVersion, CTX)).toThrow(IntegrationCredentialCryptoError);
  });

  it("rejects a tampered auth tag", () => {
    const { ciphertext, keyVersion } = encryptCredential(PLAINTEXT, CTX);
    const parts = ciphertext.split(".");
    const corrupted = parts[3].slice(0, -2) + (parts[3].at(-2) === "A" ? "B" : "A") + parts[3].slice(-1);
    const tampered = [parts[0], parts[1], parts[2], corrupted].join(".");
    expect(() => decryptCredential(tampered, keyVersion, CTX)).toThrow(IntegrationCredentialCryptoError);
  });

  it("rejects decryption under the wrong key", () => {
    const { ciphertext, keyVersion } = encryptCredential(PLAINTEXT, CTX);
    process.env.INTEGRATIONS_ENCRYPTION_KEY_V1 = OTHER_KEY;
    expect(() => decryptCredential(ciphertext, keyVersion, CTX)).toThrow(IntegrationCredentialCryptoError);
  });

  it("rejects an unsupported key version", () => {
    const { ciphertext } = encryptCredential(PLAINTEXT, CTX);
    expect(() => decryptCredential(ciphertext, 2, CTX)).toThrow(IntegrationCredentialCryptoError);
  });

  it("rejects decryption under the wrong organizationId AAD", () => {
    const { ciphertext, keyVersion } = encryptCredential(PLAINTEXT, CTX);
    expect(() => decryptCredential(ciphertext, keyVersion, { ...CTX, organizationId: "org-2" })).toThrow(
      IntegrationCredentialCryptoError,
    );
  });

  it("rejects decryption under the wrong provider AAD", () => {
    const { ciphertext, keyVersion } = encryptCredential(PLAINTEXT, CTX);
    expect(() => decryptCredential(ciphertext, keyVersion, { ...CTX, provider: "OTHER_PROVIDER" })).toThrow(
      IntegrationCredentialCryptoError,
    );
  });

  it("rejects a malformed ciphertext payload", () => {
    expect(() => decryptCredential("not-a-real-ciphertext", 1, CTX)).toThrow(IntegrationCredentialCryptoError);
    expect(() => decryptCredential("v1.only.two", 1, CTX)).toThrow(IntegrationCredentialCryptoError);
    expect(() => decryptCredential("v2.aaaa.bbbb.cccc", 1, CTX)).toThrow(IntegrationCredentialCryptoError);
  });

  it("rejects a misconfigured key (wrong decoded length)", () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY_V1 = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptCredential(PLAINTEXT, CTX)).toThrow(IntegrationCredentialCryptoError);
  });

  it("rejects a missing key", () => {
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY_V1;
    expect(() => encryptCredential(PLAINTEXT, CTX)).toThrow(IntegrationCredentialCryptoError);
  });

  it("never includes the key, plaintext, or ciphertext in a thrown error's message", () => {
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY_V1;
    try {
      encryptCredential(PLAINTEXT, CTX);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IntegrationCredentialCryptoError);
      const message = (err as Error).message;
      expect(message).not.toContain(PLAINTEXT);
      expect(message).not.toContain(VALID_KEY);
    }
  });
});
