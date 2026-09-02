/**
 * AI Assistant Batch 1B.1 — a defensive, runtime, exact-key assertion
 * every tool's own mapper output passes through before being returned.
 *
 * The PRIMARY privacy control is each tool's own narrow Prisma `select`
 * and hand-written mapper/output TYPE — neither has a property for a
 * forbidden field (Client.email/notes, Project.description/budget,
 * Task.description/assignee, etc.) in the first place, so there is
 * nothing to "leak" through the type system in ordinary use. This
 * function is defense-in-depth against a future accidental `...row`
 * spread regression (a mapper that starts with `{ ...row, ... }` instead
 * of naming every field explicitly) — the same "runtime check as a
 * backstop to the type system, not a substitute for it" discipline
 * src/lib/ai/logging-policy.ts's own logAiAssistantEvent() already
 * established in Batch 1A.
 */
export function assertExactKeys<T extends object>(value: T, allowedKeys: readonly (keyof T)[], toolName: string): T {
  const allowedSet = new Set<string>(allowedKeys as readonly string[]);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(
        `${toolName}: output contains unexpected field "${key}" — only ${[...allowedSet].join(", ")} may ever be returned.`,
      );
    }
  }
  return value;
}

/** Same assertion, applied to every item of a list-shaped result — used by every search-style tool on its own `results` array. */
export function assertExactKeysList<T extends object>(values: readonly T[], allowedKeys: readonly (keyof T)[], toolName: string): readonly T[] {
  for (const value of values) {
    assertExactKeys(value, allowedKeys, toolName);
  }
  return values;
}
