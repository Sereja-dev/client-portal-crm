/**
 * Section F — stable machine identity, derived once from a label at
 * creation time and never auto-changed when the label is edited
 * afterward (see updateCustomFieldDefinition/renameCustomFieldOption's
 * own comments in definitions.ts/options.ts). Lower-case, machine-safe,
 * no arbitrary user-defined SQL-like names: only [a-z0-9_], collapsed and
 * trimmed, exactly the same "reject anything else at the validation
 * layer" discipline src/lib/validation/lead.ts's own parseLeadValue
 * already uses for its own field.
 *
 * Deliberately its own file, NOT `server-only` (unlike key.ts, which
 * re-exports this and adds the DB-dependent collision-check functions
 * that must never run client-side): Custom Fields Phase 2A's own Create
 * dialog imports this exact function directly to render a live,
 * cosmetic "Internal key" preview as Staff types a label — the preview
 * is display-only and never trusted as the real key (the real key is
 * always re-derived, and deduplicated, server-side by
 * deriveUniqueCustomFieldDefinitionKey), but it must still be byte-
 * identical to the server's own slugifier, so it is imported, never
 * duplicated.
 */
const MAX_KEY_LENGTH = 64;

export function slugifyCustomFieldIdentifier(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/g, "");

  // A label with no machine-safe characters at all (e.g. all emoji/
  // punctuation) would otherwise derive an empty string, which can never
  // be a valid key — "field" is the same kind of honest, obviously-
  // generic fallback ClientContact's own backfill migration uses for its
  // "no email" case (see that migration's own header comment).
  return slug.length > 0 ? slug : "field";
}
