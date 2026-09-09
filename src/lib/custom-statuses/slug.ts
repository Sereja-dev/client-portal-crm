/**
 * Section S — stable machine key, derived once from a label at creation
 * time and never auto-changed when the label is edited afterward. Byte-
 * identical logic to Custom Fields' own slugifyCustomFieldIdentifier
 * (src/lib/custom-fields/slug.ts) — the same "lower-case, machine-safe,
 * [a-z0-9_] only" rule applies to a status definition's key for the
 * identical reason. Deliberately its own small pure module (not
 * re-exported from Custom Fields) — these are two independent features
 * that happen to share a slugification rule, not a shared dependency
 * that should couple their release cycles together.
 */
const MAX_KEY_LENGTH = 64;

export function slugifyCustomStatusIdentifier(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/g, "");

  // A label with no machine-safe characters at all would otherwise
  // derive an empty string, which can never be a valid key — "status" is
  // the same kind of honest, obviously-generic fallback Custom Fields'
  // own slugifier uses ("field") for the identical edge case.
  return slug.length > 0 ? slug : "status";
}
