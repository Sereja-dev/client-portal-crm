import type { AiToolDefinition } from "./types";
import { assertNotMutationLikeToolName } from "./mutation-guard";
import {
  executeGetOrganizationSummary,
  GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA,
  GET_ORGANIZATION_SUMMARY_DESCRIPTION,
} from "./organization-summary";
import {
  executeSearchClients,
  SEARCH_CLIENTS_INPUT_SCHEMA,
  SEARCH_CLIENTS_DESCRIPTION,
  executeGetClientDetail,
  GET_CLIENT_DETAIL_INPUT_SCHEMA,
  GET_CLIENT_DETAIL_DESCRIPTION,
} from "./clients";
import { executeSearchProjects, SEARCH_PROJECTS_INPUT_SCHEMA, SEARCH_PROJECTS_DESCRIPTION } from "./projects";
import { executeSearchTasks, SEARCH_TASKS_INPUT_SCHEMA, SEARCH_TASKS_DESCRIPTION } from "./tasks";

/**
 * AI Assistant Batch 1A + 1B.1 — the closed tool registry. Batch 1A left
 * this empty by design (no business-data reader existed yet); Batch 1B.1
 * adds exactly the five reviewed, narrow, read-only domain tools below —
 * no sixth tool, no invoice/Activity/Analytics/Team tool (all explicitly
 * deferred, see the approved Batch 1B plan's own batch-boundary
 * decision), and nothing here is a placeholder — every registered tool
 * is a real, tested, read-only reader.
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

// Batch 1B.1 — exactly five read-only domain tools, low-sensitivity only
// (no invoices, no free-text business content beyond a bounded record
// name/title — see each tool module's own doc comment).
registerAiTool({
  name: "getOrganizationSummary",
  description: GET_ORGANIZATION_SUMMARY_DESCRIPTION,
  inputSchema: GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA,
  execute: executeGetOrganizationSummary,
});
registerAiTool({
  name: "searchClients",
  description: SEARCH_CLIENTS_DESCRIPTION,
  inputSchema: SEARCH_CLIENTS_INPUT_SCHEMA,
  execute: executeSearchClients,
});
registerAiTool({
  name: "getClientDetail",
  description: GET_CLIENT_DETAIL_DESCRIPTION,
  inputSchema: GET_CLIENT_DETAIL_INPUT_SCHEMA,
  execute: executeGetClientDetail,
});
registerAiTool({
  name: "searchProjects",
  description: SEARCH_PROJECTS_DESCRIPTION,
  inputSchema: SEARCH_PROJECTS_INPUT_SCHEMA,
  execute: executeSearchProjects,
});
registerAiTool({
  name: "searchTasks",
  description: SEARCH_TASKS_DESCRIPTION,
  inputSchema: SEARCH_TASKS_INPUT_SCHEMA,
  execute: executeSearchTasks,
});
