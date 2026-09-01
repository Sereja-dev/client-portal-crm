import type { AiToolDefinition } from "./types";
import { assertNotMutationLikeToolName } from "./mutation-guard";

/**
 * AI Assistant Batch 1A — the closed tool registry. Deliberately empty in
 * this batch: no Client/Project/Task/Invoice/Activity/Analytics/Dashboard
 * reader exists yet (see this batch's own explicit scope gate and
 * scripts/security-checks/check-ai-assistant-security.mjs's "no Prisma
 * import in AI tools" rule, which this file itself satisfies — it imports
 * nothing from @/generated/prisma or @/lib/prisma). A future, separate
 * batch calls registerAiTool() once per reviewed, narrow business-data
 * tool; nothing here is a placeholder/dummy tool invented to populate
 * this list early — an empty registry is the correct, honest state for a
 * PR that adds zero business-data access.
 *
 * "Closed allowlist" here means: the only way a tool becomes callable is
 * a module-level registerAiTool() call in this file (or a file this file
 * imports and calls) — there is no dynamic registration path, no
 * "register from config/env," and no way for orchestration code (a
 * future batch) to invoke anything by name that isn't in this exact,
 * reviewed list. getRegisteredAiTools() returns a frozen, defensively
 * copied array so a caller can never mutate the registry after the fact.
 */

const registeredTools = new Map<string, AiToolDefinition>();

/**
 * Registers one tool. Throws (rather than silently overwriting or
 * ignoring) on a mutation-like name or a duplicate — both are treated as
 * a programming error that must fail loudly at module-load time, not a
 * runtime condition to route around.
 */
export function registerAiTool(tool: AiToolDefinition): void {
  assertNotMutationLikeToolName(tool.name);
  if (registeredTools.has(tool.name)) {
    throw new Error(`AI tool "${tool.name}" is already registered.`);
  }
  registeredTools.set(tool.name, tool);
}

export function getRegisteredAiTools(): readonly AiToolDefinition[] {
  return Object.freeze([...registeredTools.values()]);
}

export function getAiToolByName(name: string): AiToolDefinition | undefined {
  return registeredTools.get(name);
}

// Batch 1A registers zero tools. Nothing below this line yet — a future
// batch adds e.g. `registerAiTool(searchClientsTool)` here, one call per
// reviewed business-data tool.
