import { prisma } from "@/lib/prisma";
import { CLIENT_STATUSES } from "@/lib/validation/client";
import { escapeLikePattern } from "@/lib/search/normalize-query";
import { isPlainObject, hasOnlyAllowedKeys, isValidOptionalQuery, isValidOptionalEnum, isValidRef } from "./validation";
import { assertExactKeys, assertExactKeysList } from "./output-projection";
import { toolError, toolOk, type AiToolResult } from "./result";
import { SEARCH_CLIENTS_LIMIT } from "./limits";

/**
 * AI Assistant Batch 1B.1 — Tool 2 (searchClients) and Tool 3
 * (getClientDetail).
 *
 * Both are new, independent, narrow Prisma readers under src/lib/ai/tools
 * — not a reuse of clients/query.ts (that module's buildClientWhere/
 * buildClientOrderBy only build Prisma clauses; the real page.tsx runs an
 * unselected findMany that returns every Client column, confirmed unsafe
 * to reuse during Batch 1B planning) and not a reuse of
 * src/lib/search/search-clients.ts either (that module's own field
 * selection includes `email`, approved for Search's own scope but not
 * this tool's — see this file's own doc comments below for why email is
 * excluded here). Zero modification to either existing file.
 *
 * CRITICAL: Client.notes is never selected or returned by either tool in
 * this batch — a deliberate, explicit security refinement for Batch
 * 1B.1's own "zero free-text business content" requirement. It may be
 * reconsidered for a future, separate, purpose-specific tool once the
 * orchestration layer's own prompt-injection defenses are further along.
 */

const SEARCH_INPUT_KEYS = ["query", "status"] as const;

export type ClientSearchItem = { ref: string; name: string; company: string | null; status: string };
const SEARCH_ITEM_KEYS = ["ref", "name", "company", "status"] as const;

export type ClientSearchData = { results: ClientSearchItem[] };
export type ClientSearchOutput = AiToolResult<ClientSearchData>;

const SEARCH_TOOL_NAME = "searchClients";

function validateSearchInput(rawInput: unknown): { query?: string; status?: string } | null {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, SEARCH_INPUT_KEYS)) return null;
  if (!isValidOptionalQuery(input.query)) return null;
  if (!isValidOptionalEnum(input.status, CLIENT_STATUSES)) return null;
  return { query: input.query as string | undefined, status: input.status as string | undefined };
}

export async function executeSearchClients(organizationId: string, rawInput: unknown): Promise<ClientSearchOutput> {
  const validated = validateSearchInput(rawInput);
  if (!validated) {
    return toolError("invalid_input");
  }

  try {
    const trimmedQuery = validated.query?.trim();
    const rows = await prisma.client.findMany({
      where: {
        organizationId,
        ...(validated.status ? { status: validated.status as (typeof CLIENT_STATUSES)[number] } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { name: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } },
                { company: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, company: true, status: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SEARCH_CLIENTS_LIMIT,
    });

    const results = assertExactKeysList(
      rows.map((row): ClientSearchItem => ({ ref: row.id, name: row.name, company: row.company, status: row.status })),
      SEARCH_ITEM_KEYS,
      SEARCH_TOOL_NAME,
    ) as ClientSearchItem[];

    return toolOk({ results });
  } catch {
    return toolError("unavailable");
  }
}

export const SEARCH_CLIENTS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 100, description: "Optional text to match against client name/company." },
    status: { type: "string", enum: CLIENT_STATUSES, description: "Optional client status filter." },
  },
  additionalProperties: false,
} as const;

export const SEARCH_CLIENTS_DESCRIPTION =
  "Searches the current organization's clients by name/company and optional status. Returns up to 10 matches, most recently created first.";

// --- getClientDetail ---

const DETAIL_INPUT_KEYS = ["ref"] as const;

export type ClientDetailData = {
  name: string;
  company: string | null;
  status: string;
  createdAt: string;
  projectCount: number;
  invoiceCount: number;
};
const DETAIL_KEYS = ["name", "company", "status", "createdAt", "projectCount", "invoiceCount"] as const;

export type ClientDetailOutput = AiToolResult<ClientDetailData>;

const DETAIL_TOOL_NAME = "getClientDetail";

function validateDetailInput(rawInput: unknown): { ref: string } | null {
  if (!isPlainObject(rawInput) || !hasOnlyAllowedKeys(rawInput, DETAIL_INPUT_KEYS)) return null;
  if (!isValidRef(rawInput.ref)) return null;
  return { ref: rawInput.ref };
}

/**
 * A malformed ref, a well-formed-but-nonexistent ref, and a well-formed
 * ref belonging to another organization all produce the exact same
 * "not_found" — findFirst's own {id, organizationId} compound where
 * clause means a foreign-org row is structurally invisible to this
 * query, never a distinguishable "exists but denied" case. No existence
 * oracle.
 */
export async function executeGetClientDetail(organizationId: string, rawInput: unknown): Promise<ClientDetailOutput> {
  const validated = validateDetailInput(rawInput);
  if (!validated) {
    return toolError("invalid_input");
  }

  try {
    const row = await prisma.client.findFirst({
      where: { id: validated.ref, organizationId },
      select: {
        name: true,
        company: true,
        status: true,
        createdAt: true,
        _count: { select: { projects: true, invoices: true } },
      },
    });

    if (!row) {
      return toolError("not_found");
    }

    const data = assertExactKeys(
      {
        name: row.name,
        company: row.company,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        projectCount: row._count.projects,
        invoiceCount: row._count.invoices,
      },
      DETAIL_KEYS,
      DETAIL_TOOL_NAME,
    );

    return toolOk(data);
  } catch {
    return toolError("unavailable");
  }
}

export const GET_CLIENT_DETAIL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    ref: { type: "string", description: "An opaque record reference returned by searchClients." },
  },
  required: ["ref"],
  additionalProperties: false,
} as const;

export const GET_CLIENT_DETAIL_DESCRIPTION =
  "Returns structured detail for one client, given a ref from searchClients: name, company, status, created date, and project/invoice counts.";
