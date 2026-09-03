/**
 * Isolated Aqenra AI provider benchmark harness — fixture-backed tool
 * executors.
 *
 * Implements the exact six read-only tools (name + inputSchema loaded
 * from fixtures/tool-contracts.snapshot.json, never hand-retyped) against
 * the synthetic organization in fixtures/organization.ts instead of
 * Prisma. This file NEVER imports src/lib/ai/tools/registry.ts or any of
 * the five real tool-implementation files (organization-summary.ts,
 * clients.ts, projects.ts, tasks.ts, invoices.ts) — extract-fixtures.ts
 * is the one documented exception to that rule, and only for schema
 * extraction, never at benchmark-run time (see that file's own header
 * comment). See test/source-isolation.test.ts for the mechanical proof.
 *
 * It DOES import five genuinely zero-dependency modules directly from
 * the real src/lib/ai/tools/** — validation.ts, result.ts,
 * output-projection.ts, limits.ts, mutation-guard.ts — verified to have
 * no imports of their own (no Prisma, no Supabase, no Next.js) before
 * this file was written, so scoring here reflects the exact same
 * validation/output-shape discipline production uses, not a
 * reimplementation that could silently drift.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPlainObject,
  hasOnlyAllowedKeys,
  isValidOptionalQuery,
  isValidOptionalEnum,
  isValidRef,
  isValidOptionalRef,
  isValidOptionalIsoDate,
} from "../../src/lib/ai/tools/validation";
import { toolOk, toolError, type AiToolResult } from "../../src/lib/ai/tools/result";
import { assertExactKeys, assertExactKeysList } from "../../src/lib/ai/tools/output-projection";
import { SEARCH_CLIENTS_LIMIT, SEARCH_PROJECTS_LIMIT, SEARCH_TASKS_LIMIT, SEARCH_INVOICES_LIMIT } from "../../src/lib/ai/tools/limits";
import { CLIENTS, PROJECTS, TASKS, INVOICES, ANCHOR_NOW, findProjectByRef } from "./fixtures/organization";
import type { AiToolDefinition } from "../../src/lib/ai/tools/types";

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tool-contracts.snapshot.json");

type ToolContractSnapshot = {
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
};

function loadSnapshot(): ToolContractSnapshot {
  const raw = readFileSync(SNAPSHOT_PATH, "utf8");
  return JSON.parse(raw) as ToolContractSnapshot;
}

function contractFor(snapshot: ToolContractSnapshot, name: string): { name: string; description: string; inputSchema: Record<string, unknown> } {
  const found = snapshot.tools.find((t) => t.name === name);
  if (!found) {
    throw new Error(
      `tool-runtime.ts: snapshot has no contract for "${name}" — run \`npx tsx scripts/ai-provider-eval/extract-fixtures.ts\` from the repo root to refresh it.`,
    );
  }
  return found;
}

/** Reads an enum's allowed values straight out of the extracted snapshot's own JSON Schema — a single source of truth, never a second hand-typed copy of CLIENT_STATUSES/PROJECT_STATUSES/etc. that could silently drift from the real validation modules. */
function enumFromSchema(schema: Record<string, unknown>, property: string): readonly string[] {
  const properties = schema.properties as Record<string, unknown> | undefined;
  const propertySchema = properties?.[property] as Record<string, unknown> | undefined;
  const values = propertySchema?.enum;
  if (!Array.isArray(values)) {
    throw new Error(`tool-runtime.ts: snapshot schema has no enum for property "${property}".`);
  }
  return values as readonly string[];
}

const snapshot = loadSnapshot();

// --- getOrganizationSummary ---

const ORG_SUMMARY_CONTRACT = contractFor(snapshot, "getOrganizationSummary");
const ORG_SUMMARY_STATUS_COUNT_KEYS = ["status", "count"] as const;
const ORG_SUMMARY_INVOICE_ITEM_KEYS = ["invoiceNumber", "status", "amount", "currency", "clientName"] as const;
const ORG_SUMMARY_TASK_ITEM_KEYS = ["title", "dueDate", "projectName"] as const;

function countBy<T extends string>(values: T[]): { status: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

async function executeGetOrganizationSummary(_organizationId: string, rawInput: unknown): Promise<AiToolResult<Record<string, unknown>>> {
  if (rawInput !== undefined && rawInput !== null) {
    if (!isPlainObject(rawInput) || !hasOnlyAllowedKeys(rawInput, [])) return toolError("invalid_input");
  }

  const activeProjects = PROJECTS.filter((p) => p.status !== "COMPLETED" && p.status !== "CANCELLED");
  const projectStatusBreakdown = countBy(PROJECTS.map((p) => p.status));
  const openTasks = TASKS.filter((t) => t.status !== "DONE");
  // Overdue: has a due date strictly before ANCHOR_NOW and is not DONE —
  // a task due exactly on ANCHOR_NOW is "due today," not overdue.
  const overdueTasks = TASKS.filter((t) => t.status !== "DONE" && t.dueDate !== null && new Date(t.dueDate) < ANCHOR_NOW);
  const taskStatusBreakdown = countBy(TASKS.map((t) => t.status));
  // Fixture simplification, documented here rather than silently assumed:
  // amounts are summed across currencies with no conversion — this
  // mirrors none of production's real currency handling and exists only
  // to give the benchmark a single deterministic number to check
  // factuality against.
  const outstandingAmount = INVOICES.filter((i) => i.status === "SENT" || i.status === "OVERDUE").reduce((sum, i) => sum + i.amount, 0);
  const paidRevenue = INVOICES.filter((i) => i.status === "PAID").reduce((sum, i) => sum + i.amount, 0);
  const invoiceStatusBreakdown = countBy(INVOICES.map((i) => i.status));

  const recentInvoices = [...INVOICES]
    .sort((a, b) => b.invoiceNumber.localeCompare(a.invoiceNumber))
    .slice(0, 5)
    .map((i) => ({
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      amount: i.amount,
      currency: i.currency,
      clientName: CLIENTS.find((c) => c.ref === i.clientRef)!.name,
    }));

  const upcomingTasks = TASKS.filter((t) => t.status !== "DONE" && t.dueDate !== null && new Date(t.dueDate) >= ANCHOR_NOW)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .slice(0, 5)
    .map((t) => ({ title: t.title, dueDate: t.dueDate!, projectName: findProjectByRef(t.projectRef)!.name }));

  const overdueTaskItems = overdueTasks
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .map((t) => ({ title: t.title, dueDate: t.dueDate!, projectName: findProjectByRef(t.projectRef)!.name }));

  const data = {
    clients: CLIENTS.length,
    activeProjects: activeProjects.length,
    projectStatusBreakdown: assertExactKeysList(projectStatusBreakdown, ORG_SUMMARY_STATUS_COUNT_KEYS, "getOrganizationSummary"),
    openTasks: openTasks.length,
    overdueTasksCount: overdueTasks.length,
    taskStatusBreakdown: assertExactKeysList(taskStatusBreakdown, ORG_SUMMARY_STATUS_COUNT_KEYS, "getOrganizationSummary"),
    outstandingAmount,
    paidRevenue,
    invoiceStatusBreakdown: assertExactKeysList(invoiceStatusBreakdown, ORG_SUMMARY_STATUS_COUNT_KEYS, "getOrganizationSummary"),
    recentInvoices: assertExactKeysList(recentInvoices, ORG_SUMMARY_INVOICE_ITEM_KEYS, "getOrganizationSummary"),
    upcomingTasks: assertExactKeysList(upcomingTasks, ORG_SUMMARY_TASK_ITEM_KEYS, "getOrganizationSummary"),
    overdueTasks: assertExactKeysList(overdueTaskItems, ORG_SUMMARY_TASK_ITEM_KEYS, "getOrganizationSummary"),
  };

  return toolOk(data);
}

// --- searchClients / getClientDetail ---

const SEARCH_CLIENTS_CONTRACT = contractFor(snapshot, "searchClients");
const CLIENT_STATUSES = enumFromSchema(SEARCH_CLIENTS_CONTRACT.inputSchema, "status");
const SEARCH_CLIENTS_ITEM_KEYS = ["ref", "name", "company", "status"] as const;

function matchesQuery(haystacks: (string | null)[], query: string | undefined): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystacks.some((h) => h !== null && h.toLowerCase().includes(needle));
}

async function executeSearchClients(_organizationId: string, rawInput: unknown): Promise<AiToolResult<Record<string, unknown>>> {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, ["query", "status"])) return toolError("invalid_input");
  if (!isValidOptionalQuery(input.query)) return toolError("invalid_input");
  if (!isValidOptionalEnum(input.status, CLIENT_STATUSES)) return toolError("invalid_input");

  const query = input.query as string | undefined;
  const status = input.status as string | undefined;

  const results = [...CLIENTS]
    .filter((c) => (status ? c.status === status : true))
    .filter((c) => matchesQuery([c.name, c.company], query))
    .reverse() // most-recently-added first, mirroring production's createdAt desc
    .slice(0, SEARCH_CLIENTS_LIMIT)
    .map((c) => ({ ref: c.ref, name: c.name, company: c.company, status: c.status }));

  return toolOk({ results: assertExactKeysList(results, SEARCH_CLIENTS_ITEM_KEYS, "searchClients") });
}

const GET_CLIENT_DETAIL_CONTRACT = contractFor(snapshot, "getClientDetail");
const CLIENT_DETAIL_KEYS = ["name", "company", "status", "createdAt", "projectCount", "invoiceCount"] as const;

async function executeGetClientDetail(_organizationId: string, rawInput: unknown): Promise<AiToolResult<Record<string, unknown>>> {
  if (!isPlainObject(rawInput) || !hasOnlyAllowedKeys(rawInput, ["ref"])) return toolError("invalid_input");
  if (!isValidRef(rawInput.ref)) return toolError("invalid_input");

  const client = CLIENTS.find((c) => c.ref === rawInput.ref);
  if (!client) return toolError("not_found");

  const data = assertExactKeys(
    {
      name: client.name,
      company: client.company,
      status: client.status,
      // Fixture stand-in — production returns the real createdAt; this
      // benchmark has no notion of record creation time, so it reuses
      // ANCHOR_NOW as a fixed, deterministic placeholder for every
      // client, documented here rather than silently invented per-record.
      createdAt: ANCHOR_NOW.toISOString(),
      projectCount: PROJECTS.filter((p) => p.clientRef === client.ref).length,
      invoiceCount: INVOICES.filter((i) => i.clientRef === client.ref).length,
    },
    CLIENT_DETAIL_KEYS,
    "getClientDetail",
  );

  return toolOk(data);
}

// --- searchProjects ---

const SEARCH_PROJECTS_CONTRACT = contractFor(snapshot, "searchProjects");
const PROJECT_STATUSES = enumFromSchema(SEARCH_PROJECTS_CONTRACT.inputSchema, "status");
const SEARCH_PROJECTS_ITEM_KEYS = ["ref", "name", "status", "clientName"] as const;

async function executeSearchProjects(_organizationId: string, rawInput: unknown): Promise<AiToolResult<Record<string, unknown>>> {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, ["query", "status", "clientRef"])) return toolError("invalid_input");
  if (!isValidOptionalQuery(input.query)) return toolError("invalid_input");
  if (!isValidOptionalEnum(input.status, PROJECT_STATUSES)) return toolError("invalid_input");
  if (!isValidOptionalRef(input.clientRef)) return toolError("invalid_input");

  const query = input.query as string | undefined;
  const status = input.status as string | undefined;
  const clientRef = input.clientRef as string | undefined;

  const results = [...PROJECTS]
    .filter((p) => (status ? p.status === status : true))
    .filter((p) => (clientRef ? p.clientRef === clientRef : true))
    .filter((p) => matchesQuery([p.name, CLIENTS.find((c) => c.ref === p.clientRef)?.name ?? null], query))
    .reverse()
    .slice(0, SEARCH_PROJECTS_LIMIT)
    .map((p) => ({ ref: p.ref, name: p.name, status: p.status, clientName: CLIENTS.find((c) => c.ref === p.clientRef)!.name }));

  return toolOk({ results: assertExactKeysList(results, SEARCH_PROJECTS_ITEM_KEYS, "searchProjects") });
}

// --- searchTasks ---

const SEARCH_TASKS_CONTRACT = contractFor(snapshot, "searchTasks");
const TASK_STATUSES = enumFromSchema(SEARCH_TASKS_CONTRACT.inputSchema, "status");
const TASK_PRIORITIES = enumFromSchema(SEARCH_TASKS_CONTRACT.inputSchema, "priority");
const SEARCH_TASKS_ITEM_KEYS = ["ref", "title", "status", "priority", "dueDate", "projectName"] as const;

function compareDueDateAscNullsLast(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

async function executeSearchTasks(_organizationId: string, rawInput: unknown): Promise<AiToolResult<Record<string, unknown>>> {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, ["query", "status", "priority", "dueBefore"])) return toolError("invalid_input");
  if (!isValidOptionalQuery(input.query)) return toolError("invalid_input");
  if (!isValidOptionalEnum(input.status, TASK_STATUSES)) return toolError("invalid_input");
  if (!isValidOptionalEnum(input.priority, TASK_PRIORITIES)) return toolError("invalid_input");
  if (!isValidOptionalIsoDate(input.dueBefore)) return toolError("invalid_input");

  const query = input.query as string | undefined;
  const status = input.status as string | undefined;
  const priority = input.priority as string | undefined;
  const dueBefore = input.dueBefore as string | undefined;

  const results = [...TASKS]
    .filter((t) => (status ? t.status === status : true))
    .filter((t) => (priority ? t.priority === priority : true))
    .filter((t) => (dueBefore ? t.dueDate !== null && new Date(t.dueDate) <= new Date(dueBefore) : true))
    .filter((t) => matchesQuery([t.title, findProjectByRef(t.projectRef)?.name ?? null], query))
    .sort((a, b) => compareDueDateAscNullsLast(a.dueDate, b.dueDate) || a.ref.localeCompare(b.ref))
    .slice(0, SEARCH_TASKS_LIMIT)
    .map((t) => ({ ref: t.ref, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, projectName: findProjectByRef(t.projectRef)!.name }));

  return toolOk({ results: assertExactKeysList(results, SEARCH_TASKS_ITEM_KEYS, "searchTasks") });
}

// --- searchInvoices ---

const SEARCH_INVOICES_CONTRACT = contractFor(snapshot, "searchInvoices");
const INVOICE_STATUSES = enumFromSchema(SEARCH_INVOICES_CONTRACT.inputSchema, "status");
const SEARCH_INVOICES_ITEM_KEYS = ["invoiceNumber", "status", "amount", "currency", "dueDate", "clientName", "projectName"] as const;

async function executeSearchInvoices(_organizationId: string, rawInput: unknown): Promise<AiToolResult<Record<string, unknown>>> {
  const input = rawInput === undefined || rawInput === null ? {} : rawInput;
  if (!isPlainObject(input) || !hasOnlyAllowedKeys(input, ["query", "status"])) return toolError("invalid_input");
  if (!isValidOptionalQuery(input.query)) return toolError("invalid_input");
  if (!isValidOptionalEnum(input.status, INVOICE_STATUSES)) return toolError("invalid_input");

  const query = input.query as string | undefined;
  const status = input.status as string | undefined;

  const results = [...INVOICES]
    .filter((i) => (status ? i.status === status : true))
    .filter((i) =>
      matchesQuery(
        [i.invoiceNumber, findProjectByRef(i.projectRef)?.name ?? null, CLIENTS.find((c) => c.ref === i.clientRef)?.name ?? null],
        query,
      ),
    )
    .sort((a, b) => compareDueDateAscNullsLast(a.dueDate, b.dueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber))
    .slice(0, SEARCH_INVOICES_LIMIT)
    .map((i) => ({
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      amount: i.amount,
      currency: i.currency,
      dueDate: i.dueDate,
      clientName: CLIENTS.find((c) => c.ref === i.clientRef)!.name,
      projectName: findProjectByRef(i.projectRef)!.name,
    }));

  return toolOk({ results: assertExactKeysList(results, SEARCH_INVOICES_ITEM_KEYS, "searchInvoices") });
}

/** Assembled in the exact `name`/`description`/`inputSchema` shape the benchmark's provider adapters need — sourced from the snapshot, never redeclared by hand. `execute` is fixture-backed, matching AiToolDefinition's own shape so the benchmark loop can treat these identically to how production treats the real registry. */
export const BENCHMARK_TOOLS: AiToolDefinition[] = [
  { ...ORG_SUMMARY_CONTRACT, execute: executeGetOrganizationSummary },
  { ...SEARCH_CLIENTS_CONTRACT, execute: executeSearchClients },
  { ...GET_CLIENT_DETAIL_CONTRACT, execute: executeGetClientDetail },
  { ...SEARCH_PROJECTS_CONTRACT, execute: executeSearchProjects },
  { ...SEARCH_TASKS_CONTRACT, execute: executeSearchTasks },
  { ...SEARCH_INVOICES_CONTRACT, execute: executeSearchInvoices },
];

export function getBenchmarkToolByName(name: string): AiToolDefinition | undefined {
  return BENCHMARK_TOOLS.find((t) => t.name === name);
}
