import { prisma } from "@/lib/prisma";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/validation/task";
import { escapeLikePattern } from "@/lib/search/normalize-query";
import {
  isPlainObject,
  hasOnlyAllowedKeys,
  isValidOptionalQuery,
  isValidOptionalEnum,
  isValidOptionalIsoDate,
} from "./validation";
import { assertExactKeysList } from "./output-projection";
import { toolError, toolOk, type AiToolResult } from "./result";
import { SEARCH_TASKS_LIMIT } from "./limits";

/**
 * AI Assistant Batch 1B.1 — Tool 5: searchTasks.
 *
 * New, independent, narrow Prisma reader — not a reuse of tasks/query.ts
 * (clause-builder only) or search-tasks.ts (kept independent, same
 * reasoning as clients.ts/projects.ts's own doc comments).
 *
 * Scoped through `project: { organizationId }`, NEVER `Task.organizationId`
 * directly — Task.organizationId is a nullable, denormalized convenience
 * column (see prisma/schema.prisma's own comment on it), and every other
 * Task query in this codebase (buildTaskWhere, search-tasks.ts,
 * getDashboardAnalytics's own task queries) already scopes through the
 * Project relation instead. Following any other convention here would
 * risk a Task whose own `organizationId` column happens to be null (a
 * state the schema explicitly allows) being silently excluded or scoped
 * inconsistently with the rest of the app.
 *
 * description/assignee (name or email) are never selected or returned —
 * no assignee PII and no free-text description ships in Batch 1B.1 (see
 * the approved plan's own per-domain field contract).
 */

const SEARCH_INPUT_KEYS = ["query", "status", "priority", "dueBefore"] as const;

export type TaskSearchItem = { ref: string; title: string; status: string; priority: string; dueDate: string | null; projectName: string };
const SEARCH_ITEM_KEYS = ["ref", "title", "status", "priority", "dueDate", "projectName"] as const;

export type TaskSearchData = { results: TaskSearchItem[] };
export type TaskSearchOutput = AiToolResult<TaskSearchData>;

const TOOL_NAME = "searchTasks";

function validateInput(
  rawInput: unknown,
): { query?: string; status?: string; priority?: string; dueBefore?: string } | null {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, SEARCH_INPUT_KEYS)) return null;
  if (!isValidOptionalQuery(input.query)) return null;
  if (!isValidOptionalEnum(input.status, TASK_STATUSES)) return null;
  if (!isValidOptionalEnum(input.priority, TASK_PRIORITIES)) return null;
  if (!isValidOptionalIsoDate(input.dueBefore)) return null;
  return {
    query: input.query as string | undefined,
    status: input.status as string | undefined,
    priority: input.priority as string | undefined,
    dueBefore: input.dueBefore as string | undefined,
  };
}

export async function executeSearchTasks(organizationId: string, rawInput: unknown): Promise<TaskSearchOutput> {
  const validated = validateInput(rawInput);
  if (!validated) {
    return toolError("invalid_input");
  }

  try {
    const trimmedQuery = validated.query?.trim();
    const rows = await prisma.task.findMany({
      where: {
        project: { organizationId },
        ...(validated.status ? { status: validated.status as (typeof TASK_STATUSES)[number] } : {}),
        ...(validated.priority ? { priority: validated.priority as (typeof TASK_PRIORITIES)[number] } : {}),
        ...(validated.dueBefore ? { dueDate: { lte: new Date(validated.dueBefore) } } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { title: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } },
                { project: { name: { contains: escapeLikePattern(trimmedQuery), mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: { id: true, title: true, status: true, priority: true, dueDate: true, project: { select: { name: true } } },
      // Deterministic: dueDate ascending with nulls sorted last (a task
      // with no due date is never more "urgent" than one that has one),
      // then id as a strict tie-break for equal dueDate values.
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: SEARCH_TASKS_LIMIT,
    });

    const results = assertExactKeysList(
      rows.map(
        (row): TaskSearchItem => ({
          ref: row.id,
          title: row.title,
          status: row.status,
          priority: row.priority,
          dueDate: row.dueDate ? row.dueDate.toISOString() : null,
          projectName: row.project.name,
        }),
      ),
      SEARCH_ITEM_KEYS,
      TOOL_NAME,
    ) as TaskSearchItem[];

    return toolOk({ results });
  } catch {
    return toolError("unavailable");
  }
}

export const SEARCH_TASKS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 100, description: "Optional text to match against task title or project name." },
    status: { type: "string", enum: TASK_STATUSES, description: "Optional task status filter." },
    priority: { type: "string", enum: TASK_PRIORITIES, description: "Optional task priority filter." },
    dueBefore: { type: "string", format: "date-time", description: "Optional ISO date; only tasks due on or before this date are returned." },
  },
  additionalProperties: false,
} as const;

export const SEARCH_TASKS_DESCRIPTION =
  "Searches the current organization's tasks by title/project name, optional status, priority, and due-before date. Returns up to 15 matches, soonest due date first (tasks with no due date last).";
