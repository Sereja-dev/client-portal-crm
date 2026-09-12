import "server-only";

/**
 * Tags V1 Phase 1 — the one place a proposed tag name is trimmed and its
 * deterministic `normalizedName` derived (trim + lowercase — see Tag's
 * own schema doc comment for why this, and not a stored `name`, is the
 * real DB-enforced duplicate-prevention key). Called by both createTag
 * and renameTag so the two never independently reimplement this rule.
 */

// Same order-of-magnitude "bounded free-text field" convention every
// other short label in this app already uses (e.g. CustomStatusDefinition/
// CustomFieldDefinition's own label, which has no explicit cap either,
// but every genuinely user-typed short field in this codebase — Lead.name,
// Client.name — caps around this range).
export const TAG_NAME_MAX_LENGTH = 100;

export type NormalizedTagName = { name: string; normalizedName: string };

export type NormalizeTagNameResult = { ok: true; value: NormalizedTagName } | { ok: false; error: string };

export function normalizeTagName(raw: unknown): NormalizeTagNameResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a tag name." };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, error: "Enter a tag name." };
  }
  if (name.length > TAG_NAME_MAX_LENGTH) {
    return { ok: false, error: `Must be ${TAG_NAME_MAX_LENGTH} characters or fewer.` };
  }
  // Deliberately a plain .toLowerCase() — no locale-specific casing, no
  // Unicode normalization beyond what JS's own default lowercase already
  // does. Simple, deterministic, and matches this codebase's own existing
  // case-insensitive-duplicate precedent (findDuplicateOrganizationClientByEmail),
  // which uses the identical plain-lowercase comparison.
  return { ok: true, value: { name, normalizedName: name.toLowerCase() } };
}
