import "server-only";

/**
 * Contracts Phase 1 — the persisted Snapshot V1 contract, directly
 * modeled on src/lib/invoices/pdf/snapshot-types.ts's own already-proven
 * InvoiceIssuerSnapshotV1/InvoiceRecipientSnapshotV1 pattern (see this
 * phase's own architecture-lock report §5/§10 for why that pattern, not
 * a fresh design, was reused). This module is pure with respect to I/O:
 * the builder functions accept already-fetched plain data (never a
 * Prisma model object, never a database call of their own), and the
 * parser functions accept `unknown` (never trust stored JSON merely
 * because a database wrote it) and never throw.
 *
 * Deliberately NOT a direct reuse of InvoiceIssuerSnapshotV1 itself —
 * that type carries payment instructions and a logo content-hash
 * provenance record, both irrelevant to a Contract (this phase has no
 * PDF, no logo rendering, and payment/banking details have nothing to do
 * with who the contracting parties were) and a Contract-specific narrower
 * type is a deliberately smaller, purpose-built shape rather than an
 * accidental grab-bag of Invoice-only fields (locked architecture §10).
 *
 * Written exactly once, at SEND (never at acceptance, never rebuilt on a
 * later Client/OrganizationProfile/ClientContact edit) — see
 * src/lib/contracts/service.ts's own sendContract().
 */

export type ContractAddressV1 = {
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type ContractOrganizationSnapshotV1 = {
  schemaVersion: 1;
  legalName: string;
  address: ContractAddressV1;
  country: string | null;
  taxId: string | null;
  supportEmail: string | null;
  phone: string | null;
  website: string | null;
};

export type ContractClientSnapshotV1 = {
  schemaVersion: 1;
  billingName: string;
  email: string | null;
  address: ContractAddressV1;
  country: string | null;
  taxId: string | null;
};

/** Only the identity fields needed to show who the intended signatory was — never data this app doesn't already store (locked architecture §10: "do not invent personal/legal data"). */
export type ContractSignatorySnapshotV1 = {
  schemaVersion: 1;
  name: string;
  email: string | null;
  role: string | null;
};

export type ParsedContractOrganizationSnapshot =
  | { ok: true; snapshot: ContractOrganizationSnapshotV1 }
  | { ok: false; reason: "UNKNOWN_SCHEMA_VERSION" | "MALFORMED" };

export type ParsedContractClientSnapshot =
  | { ok: true; snapshot: ContractClientSnapshotV1 }
  | { ok: false; reason: "UNKNOWN_SCHEMA_VERSION" | "MALFORMED" };

export type ParsedContractSignatorySnapshot =
  | { ok: true; snapshot: ContractSignatorySnapshotV1 }
  | { ok: false; reason: "UNKNOWN_SCHEMA_VERSION" | "MALFORMED" };

// ---------------------------------------------------------------------------
// Builders — deterministic, no I/O. Callers pass already-fetched plain data;
// none of these functions performs a database call of their own.
// ---------------------------------------------------------------------------

/**
 * Legal name fallback rule, identical to buildIssuerSnapshotV1's own:
 * `OrganizationProfile.legalName` when a profile row exists, else
 * `Organization.name` (always present). Never null, never a fabricated
 * placeholder.
 */
export function buildContractOrganizationSnapshotV1(input: {
  organizationName: string;
  profile: {
    legalName: string | null;
    country: string | null;
    taxId: string | null;
    supportEmail: string | null;
    phone: string | null;
    website: string | null;
    streetAddress: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null;
}): ContractOrganizationSnapshotV1 {
  const { profile } = input;
  return {
    schemaVersion: 1,
    legalName: profile?.legalName ?? input.organizationName,
    address: {
      streetAddress: profile?.streetAddress ?? null,
      city: profile?.city ?? null,
      state: profile?.state ?? null,
      postalCode: profile?.postalCode ?? null,
    },
    country: profile?.country ?? null,
    taxId: profile?.taxId ?? null,
    supportEmail: profile?.supportEmail ?? null,
    phone: profile?.phone ?? null,
    website: profile?.website ?? null,
  };
}

/**
 * Billing name fallback rule, identical to buildRecipientSnapshotV1's
 * own: `billingLegalName ?? company ?? name` — `Client.name` is a
 * required column, so this is never null.
 */
export function buildContractClientSnapshotV1(client: {
  billingLegalName: string | null;
  company: string | null;
  name: string;
  email: string | null;
  taxId: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}): ContractClientSnapshotV1 {
  return {
    schemaVersion: 1,
    billingName: client.billingLegalName ?? client.company ?? client.name,
    email: client.email ?? null,
    address: {
      streetAddress: client.streetAddress ?? null,
      city: client.city ?? null,
      state: client.state ?? null,
      postalCode: client.postalCode ?? null,
    },
    country: client.country ?? null,
    taxId: client.taxId ?? null,
  };
}

export function buildContractSignatorySnapshotV1(contact: {
  name: string;
  email: string | null;
  role: string | null;
}): ContractSignatorySnapshotV1 {
  return {
    schemaVersion: 1,
    name: contact.name,
    email: contact.email ?? null,
    role: contact.role ?? null,
  };
}

// ---------------------------------------------------------------------------
// Strict parsers — accept `unknown`, never throw, reject unrecognized shapes
// (including unexpected keys) rather than silently ignoring them.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(obj).every((key) => allowedSet.has(key));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const ADDRESS_KEYS = ["streetAddress", "city", "state", "postalCode"] as const;

function parseAddress(value: unknown): ContractAddressV1 | null {
  if (!isPlainObject(value)) return null;
  if (!hasExactKeys(value, ADDRESS_KEYS)) return null;
  if (!ADDRESS_KEYS.every((key) => isNullableString(value[key]))) return null;
  return {
    streetAddress: value.streetAddress as string | null,
    city: value.city as string | null,
    state: value.state as string | null,
    postalCode: value.postalCode as string | null,
  };
}

const ORGANIZATION_KEYS = [
  "schemaVersion",
  "legalName",
  "address",
  "country",
  "taxId",
  "supportEmail",
  "phone",
  "website",
] as const;

export function parseContractOrganizationSnapshot(raw: unknown): ParsedContractOrganizationSnapshot {
  if (!isPlainObject(raw)) return { ok: false, reason: "MALFORMED" };
  if (raw.schemaVersion !== 1) {
    return { ok: false, reason: raw.schemaVersion === undefined ? "MALFORMED" : "UNKNOWN_SCHEMA_VERSION" };
  }
  if (!hasExactKeys(raw, ORGANIZATION_KEYS)) return { ok: false, reason: "MALFORMED" };
  if (!isNonEmptyString(raw.legalName)) return { ok: false, reason: "MALFORMED" };

  const address = parseAddress(raw.address);
  if (address === null) return { ok: false, reason: "MALFORMED" };

  if (
    !isNullableString(raw.country) ||
    !isNullableString(raw.taxId) ||
    !isNullableString(raw.supportEmail) ||
    !isNullableString(raw.phone) ||
    !isNullableString(raw.website)
  ) {
    return { ok: false, reason: "MALFORMED" };
  }

  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      legalName: raw.legalName,
      address,
      country: raw.country,
      taxId: raw.taxId,
      supportEmail: raw.supportEmail,
      phone: raw.phone,
      website: raw.website,
    },
  };
}

const CLIENT_KEYS = ["schemaVersion", "billingName", "email", "address", "country", "taxId"] as const;

export function parseContractClientSnapshot(raw: unknown): ParsedContractClientSnapshot {
  if (!isPlainObject(raw)) return { ok: false, reason: "MALFORMED" };
  if (raw.schemaVersion !== 1) {
    return { ok: false, reason: raw.schemaVersion === undefined ? "MALFORMED" : "UNKNOWN_SCHEMA_VERSION" };
  }
  if (!hasExactKeys(raw, CLIENT_KEYS)) return { ok: false, reason: "MALFORMED" };
  if (!isNonEmptyString(raw.billingName)) return { ok: false, reason: "MALFORMED" };
  if (!isNullableString(raw.email) || !isNullableString(raw.country) || !isNullableString(raw.taxId)) {
    return { ok: false, reason: "MALFORMED" };
  }

  const address = parseAddress(raw.address);
  if (address === null) return { ok: false, reason: "MALFORMED" };

  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      billingName: raw.billingName,
      email: raw.email,
      address,
      country: raw.country,
      taxId: raw.taxId,
    },
  };
}

const SIGNATORY_KEYS = ["schemaVersion", "name", "email", "role"] as const;

export function parseContractSignatorySnapshot(raw: unknown): ParsedContractSignatorySnapshot {
  if (!isPlainObject(raw)) return { ok: false, reason: "MALFORMED" };
  if (raw.schemaVersion !== 1) {
    return { ok: false, reason: raw.schemaVersion === undefined ? "MALFORMED" : "UNKNOWN_SCHEMA_VERSION" };
  }
  if (!hasExactKeys(raw, SIGNATORY_KEYS)) return { ok: false, reason: "MALFORMED" };
  if (!isNonEmptyString(raw.name)) return { ok: false, reason: "MALFORMED" };
  if (!isNullableString(raw.email) || !isNullableString(raw.role)) return { ok: false, reason: "MALFORMED" };

  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      name: raw.name,
      email: raw.email,
      role: raw.role,
    },
  };
}
