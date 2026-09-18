import "server-only";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §6). Central, sole place any Integrations
 * credential is ever encrypted or decrypted -- no other module reaches
 * into `node:crypto` for this purpose. Direct AES-256-GCM (not envelope
 * encryption): no KMS exists anywhere in this codebase (confirmed via a
 * full repo search during the architecture lock), and V1's volume (at
 * most one credential per organization) doesn't justify envelope's added
 * complexity for a benefit V1 can't cash in.
 *
 * Ciphertext format, versioned and self-describing:
 *   v1.<base64 iv>.<base64 ciphertext>.<base64 authTag>
 * "v1" here is the ciphertext FORMAT version (this module's own wire
 * shape) -- independent of `keyVersion` below, which records which
 * INTEGRATIONS_ENCRYPTION_KEY_V{n} master key encrypted a given value.
 * The two version concepts are deliberately kept separate: the format
 * could change in the future without forcing a key rotation, and a key
 * rotation never needs a format change.
 *
 * AAD (Additional Authenticated Data) binds `organizationId` and
 * `provider` into the GCM authentication -- a ciphertext value can never
 * successfully decrypt if the caller supplies a different
 * organizationId/provider than it was encrypted under, even if the raw
 * ciphertext bytes were somehow copied into another row. This is a
 * native cryptographic guarantee (GCM's own tag verification), not
 * custom application logic -- see test/unit/integrations/crypto.test.ts
 * for the "wrong org AAD -> fail" / "wrong provider AAD -> fail" proofs.
 *
 * Fails closed on every malformed/mismatched input (missing/misconfigured
 * key, malformed base64, wrong decoded length, malformed ciphertext,
 * unsupported version, auth failure, wrong AAD) with a single safe,
 * non-identifying error -- never a plaintext fallback, never logs the
 * key, webhook URL, ciphertext, auth tag, or raw provider response.
 */

const CIPHERTEXT_FORMAT_VERSION = "v1";
const IV_LENGTH_BYTES = 12; // 96-bit GCM nonce, NIST-recommended.
const KEY_LENGTH_BYTES = 32; // AES-256.
const AUTH_TAG_LENGTH_BYTES = 16; // Native GCM tag length.

/** The single active version new encryptions are written under. Bump alongside adding a new INTEGRATIONS_ENCRYPTION_KEY_V{n} env var when rotating (see this module's own header comment) -- old versions stay in KEY_BY_VERSION below so existing rows can still be decrypted. */
export const CURRENT_CREDENTIAL_KEY_VERSION = 1;

export class IntegrationCredentialCryptoError extends Error {
  constructor(reason: string) {
    // `reason` is always one of this module's own fixed, non-identifying
    // strings below -- never anything derived from the plaintext,
    // ciphertext, or key material.
    super(`Integration credential crypto failed: ${reason}`);
    this.name = "IntegrationCredentialCryptoError";
  }
}

function loadKey(version: number): Buffer {
  const envVarName = `INTEGRATIONS_ENCRYPTION_KEY_V${version}`;
  const raw = process.env[envVarName];
  if (!raw) {
    throw new IntegrationCredentialCryptoError(`missing_key_version_${version}`);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new IntegrationCredentialCryptoError("malformed_key_encoding");
  }
  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new IntegrationCredentialCryptoError("invalid_key_length");
  }
  return decoded;
}

/**
 * Small, explicit registry rather than an ad hoc `process.env` read at
 * every call site (locked spec §6: "Do not read env ad hoc throughout
 * the feature") -- only version 1 exists in V1; a future rotation adds a
 * new case here, never replaces this one.
 */
function keyForVersion(version: number): Buffer {
  if (version === 1) return loadKey(1);
  throw new IntegrationCredentialCryptoError(`unsupported_key_version_${version}`);
}

export type CredentialAadContext = { organizationId: string; provider: string };

/** Stable, deterministic encoding -- always exactly these two fields in this order, so the same (organizationId, provider) pair always produces byte-identical AAD on both encrypt and decrypt. */
function buildAad(context: CredentialAadContext): Buffer {
  return Buffer.from(JSON.stringify({ organizationId: context.organizationId, provider: context.provider }), "utf8");
}

export type EncryptedCredential = { ciphertext: string; keyVersion: number };

/** Encrypts under CURRENT_CREDENTIAL_KEY_VERSION. Throws IntegrationCredentialCryptoError if the current key is missing/malformed -- never silently falls back to storing plaintext. */
export function encryptCredential(plaintext: string, context: CredentialAadContext): EncryptedCredential {
  const keyVersion = CURRENT_CREDENTIAL_KEY_VERSION;
  const key = keyForVersion(keyVersion);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const aad = buildAad(context);

  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const ciphertext = [
    CIPHERTEXT_FORMAT_VERSION,
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(".");

  return { ciphertext, keyVersion };
}

/**
 * Decrypts a value previously produced by encryptCredential. `keyVersion`
 * must be the row's own stored `credentialKeyVersion` (never assumed to
 * be CURRENT_CREDENTIAL_KEY_VERSION) -- this is what makes decrypt still
 * work for a row encrypted under an older, no-longer-active key version,
 * as long as that version's env var is still configured (see this
 * module's own header comment on key-rotation readiness).
 */
export function decryptCredential(ciphertext: string, keyVersion: number, context: CredentialAadContext): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4) {
    throw new IntegrationCredentialCryptoError("malformed_ciphertext_shape");
  }
  const [formatVersion, ivB64, dataB64, tagB64] = parts;
  if (formatVersion !== CIPHERTEXT_FORMAT_VERSION) {
    throw new IntegrationCredentialCryptoError("unsupported_ciphertext_format_version");
  }

  let iv: Buffer;
  let data: Buffer;
  let authTag: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64");
    data = Buffer.from(dataB64, "base64");
    authTag = Buffer.from(tagB64, "base64");
  } catch {
    throw new IntegrationCredentialCryptoError("malformed_ciphertext_encoding");
  }
  if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES || data.length === 0) {
    throw new IntegrationCredentialCryptoError("malformed_ciphertext_lengths");
  }

  const key = keyForVersion(keyVersion);
  const aad = buildAad(context);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    // Node's createDecipheriv/final() throws on ANY tamper, wrong key, or
    // wrong AAD mismatch -- deliberately not distinguished further here
    // (the same "one generic failure" discipline requireCronAuth's own
    // doc comment already documents for a different timing-safety
    // reason): a caller must never be able to tell "wrong key" apart from
    // "wrong AAD" apart from "tampered ciphertext" from the outside.
    throw new IntegrationCredentialCryptoError("decryption_failed");
  }
}
