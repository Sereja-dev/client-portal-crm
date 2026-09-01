/**
 * AI Assistant Batch 1A — the generic tool contract shape every later
 * business-data tool (a future, separate batch) implements. No business
 * tool exists yet: this file defines only the shape, never a concrete
 * Client/Project/Task/Invoice/Activity/Analytics reader (see this
 * batch's own explicit "no business queries" scope).
 */

/**
 * One server-side-executable tool the model may request by name. `name`
 * must pass assertNotMutationLikeToolName() (mutation-guard.ts) — enforced
 * at registration time by registry.ts's own registerAiTool(), not
 * something a tool author can opt out of.
 *
 * `execute` takes `organizationId` as an explicit, separate first
 * parameter — never folded into `TInput` — so it is structurally
 * impossible for a tool's own JSON-schema-described input (the part the
 * model can influence) to also be where organization scoping comes from.
 * Every future tool's `execute` must derive its Prisma `where` clause from
 * this parameter alone, mirroring how every existing query.ts file in
 * this codebase already takes organizationId as a plain, caller-supplied
 * argument rather than re-deriving it from anything request-shaped.
 */
export type AiToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  /** A JSON Schema object describing TInput's shape — never `{}`/unconstrained (see the future data-tools batch's own per-tool schemas). */
  inputSchema: Record<string, unknown>;
  execute: (organizationId: string, input: TInput) => Promise<TOutput>;
};
