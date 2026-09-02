import { prisma } from "@/lib/prisma";
import { PROJECT_STATUSES } from "@/lib/validation/project";
import { escapeLikePattern } from "@/lib/search/normalize-query";
import { isPlainObject, hasOnlyAllowedKeys, isValidOptionalQuery, isValidOptionalEnum, isValidOptionalRef } from "./validation";
import { assertExactKeysList } from "./output-projection";
import { toolError, toolOk, type AiToolResult } from "./result";
import { SEARCH_PROJECTS_LIMIT } from "./limits";

/**
 * AI Assistant Batch 1B.1 — Tool 4: searchProjects.
 *
 * New, independent, narrow Prisma reader — not a reuse of
 * projects/query.ts (clause-builder only; the real page.tsx runs an
 * unselected findMany) and not a reuse of search-projects.ts (kept
 * independent for the same reasoning as clients.ts's own doc comment).
 *
 * `clientRef` is supported: it can be resolved safely without becoming
 * an existence oracle. It is applied only as an additional predicate
 * *inside* the already organizationId-scoped `where` — a `clientRef`
 * naming a client in another organization (or a nonexistent one) simply
 * matches zero of this organization's own projects, which is exactly the
 * same "no match" empty-results shape any other unmatched filter already
 * produces. Nothing here performs a separate "does this client exist"
 * check that could distinguish that case from an ordinary empty result.
 *
 * description/budget are never selected or returned — no detail tool
 * exists for Projects in Batch 1B.1 (see the approved plan's own
 * per-domain field contract).
 */

const SEARCH_INPUT_KEYS = ["query", "status", "clientRef"] as const;

export type ProjectSearchItem = { ref: string; name: string; status: string; clientName: string };
const SEARCH_ITEM_KEYS = ["ref", "name", "status", "clientName"] as const;

export type ProjectSearchData = { results: ProjectSearchItem[] };
export type ProjectSearchOutput = AiToolResult<ProjectSearchData>;

const TOOL_NAME = "searchProjects";

function validateInput(rawInput: unknown): { query?: string; status?: string; clientRef?: string } | null {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, SEARCH_INPUT_KEYS)) return null;
  if (!isValidOptionalQuery(input.query)) return null;
  if (!isValidOptionalEnum(input.status, PROJECT_STATUSES)) return null;
  if (!isValidOptionalRef(input.clientRef)) return null;
  return {
    query: input.query as string | undefined,
    status: input.status as string | undefined,
    clientRef: input.clientRef as string | undefined,
  };
}

export async function executeSearchProjects(organizationId: string, rawInput: unknown): Promise<ProjectSearchOutput> {
  const validated = validateInput(rawInput);
  if (!validated) {
    return toolError("invalid_input");
  }

  try {
    const trimmedQuery = validated.query?.trim();
    const rows = await prisma.project.findMany({
      where: {
        organizationId,
        ...(validated.status ? { status: validated.status as (typeof PROJECT_STATUSES)[number] } : {}),
        ...(validated.clientRef ? { clientId: validated.clientRef } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { name: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } },
                { client: { name: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, status: true, client: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SEARCH_PROJECTS_LIMIT,
    });

    const results = assertExactKeysList(
      rows.map((row): ProjectSearchItem => ({ ref: row.id, name: row.name, status: row.status, clientName: row.client.name })),
      SEARCH_ITEM_KEYS,
      TOOL_NAME,
    ) as ProjectSearchItem[];

    return toolOk({ results });
  } catch {
    return toolError("unavailable");
  }
}

export const SEARCH_PROJECTS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 100, description: "Optional text to match against project or client name." },
    status: { type: "string", enum: PROJECT_STATUSES, description: "Optional project status filter." },
    clientRef: { type: "string", description: "Optional client reference (from searchClients) to filter by." },
  },
  additionalProperties: false,
} as const;

export const SEARCH_PROJECTS_DESCRIPTION =
  "Searches the current organization's projects by name/client name, optional status, and optional client reference. Returns up to 10 matches, most recently created first.";
