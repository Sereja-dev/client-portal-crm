/**
 * Forms Improvement Slice C1a — a small, dependency-free structural
 * equality check for plain form-snapshot values: primitives, `null`,
 * plain objects, and arrays. This is the one piece of shared logic every
 * form's own dirty-state comparison (current normalized snapshot vs its
 * initial baseline snapshot) is built on — see each form's own
 * `buildDirtySnapshot`-style function for what actually goes into one of
 * these snapshots.
 *
 * Deliberately narrow: no cycle detection, no class-instance/`Map`/`Set`
 * support, no function comparison. Every snapshot this is ever called
 * with is a plain, JSON-shaped object built fresh from React state
 * strings/booleans/arrays-of-plain-objects — nothing else is ever
 * compared. Array order matters (a `Object.is`-style recursive walk, not
 * a set comparison) because line-item order is itself Product-
 * significant (Forms Improvement Slice C1a's own readiness audit, §25).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
  }

  return false;
}
