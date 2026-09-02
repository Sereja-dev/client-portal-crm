import { getDashboardAnalytics } from "@/app/(dashboard)/dashboard/query";
import { DEFAULT_DASHBOARD_PERIOD } from "@/lib/dashboard/period";
import { isPlainObject, hasOnlyAllowedKeys } from "./validation";
import { assertExactKeysList } from "./output-projection";
import { toolError, toolOk, type AiToolResult } from "./result";

/**
 * AI Assistant Batch 1B.1 — Tool 1: getOrganizationSummary.
 *
 * A thin AI-safe adapter over the existing, already-safe Dashboard read
 * layer (src/app/(dashboard)/dashboard/query.ts's own getDashboardAnalytics())
 * — reused entirely unmodified (Implementation Architecture Option A from
 * the approved plan: its returned shape is already the "pre-computed
 * aggregate" the architecture prefers). This file only maps that existing
 * return value into a narrower, AI-specific output type; it introduces no
 * new Prisma query of its own and no business-logic change.
 *
 * `period` is fixed to DEFAULT_DASHBOARD_PERIOD ("30d") — never
 * model-controlled, matching this tool's own approved "model input: empty
 * object" contract exactly. `now` is resolved server-side at call time,
 * never accepted as input.
 *
 * Every row-level `id` DashboardAnalytics itself carries (recentInvoices,
 * upcomingTasks, overdueTasks) is deliberately dropped here — a summary
 * tool needs no ref/chaining id at all (see the approved plan's own "No
 * id/ref is needed for summary rows").
 *
 * recentInvoices intentionally omits `dueDate`: DashboardAnalytics's own
 * RecentInvoice type does not expose it (only createdAt), and this tool
 * must not modify dashboard/query.ts to add it — see this batch's own
 * "zero modification to existing domain query files" scope gate.
 * createdAt itself is also omitted — the approved field list for this
 * tool names invoiceNumber/status/amount/currency/clientName/dueDate
 * only, and createdAt was not requested.
 */

export type OrganizationSummaryStatusCount = { status: string; count: number };
const STATUS_COUNT_KEYS = ["status", "count"] as const;

export type OrganizationSummaryInvoiceItem = {
  invoiceNumber: string;
  status: string;
  amount: number;
  currency: string;
  clientName: string;
};
const INVOICE_ITEM_KEYS = ["invoiceNumber", "status", "amount", "currency", "clientName"] as const;

export type OrganizationSummaryTaskItem = { title: string; dueDate: string; projectName: string };
const TASK_ITEM_KEYS = ["title", "dueDate", "projectName"] as const;

export type OrganizationSummaryData = {
  clients: number;
  activeProjects: number;
  projectStatusBreakdown: OrganizationSummaryStatusCount[];
  openTasks: number;
  overdueTasksCount: number;
  taskStatusBreakdown: OrganizationSummaryStatusCount[];
  outstandingAmount: number;
  paidRevenue: number;
  invoiceStatusBreakdown: OrganizationSummaryStatusCount[];
  recentInvoices: OrganizationSummaryInvoiceItem[];
  upcomingTasks: OrganizationSummaryTaskItem[];
  overdueTasks: OrganizationSummaryTaskItem[];
};

export type OrganizationSummaryOutput = AiToolResult<OrganizationSummaryData>;

const TOOL_NAME = "getOrganizationSummary";

/** Empty object only — this tool takes no model-controlled input at all. */
function validate(rawInput: unknown): boolean {
  if (rawInput === undefined || rawInput === null) return true;
  return isPlainObject(rawInput) && hasOnlyAllowedKeys(rawInput, []);
}

export async function executeGetOrganizationSummary(
  organizationId: string,
  rawInput: unknown,
): Promise<OrganizationSummaryOutput> {
  if (!validate(rawInput)) {
    return toolError("invalid_input");
  }

  try {
    const analytics = await getDashboardAnalytics({
      organizationId,
      period: DEFAULT_DASHBOARD_PERIOD,
      now: new Date(),
    });

    const data: OrganizationSummaryData = {
      clients: analytics.kpis.totalClients,
      activeProjects: analytics.kpis.activeProjects,
      projectStatusBreakdown: assertExactKeysList(
        analytics.breakdowns.projectStatus.map((s) => ({ status: s.status, count: s.count })),
        STATUS_COUNT_KEYS,
        TOOL_NAME,
      ) as OrganizationSummaryStatusCount[],
      openTasks: analytics.kpis.openTasks,
      overdueTasksCount: analytics.kpis.overdueTasksCount,
      taskStatusBreakdown: assertExactKeysList(
        analytics.breakdowns.taskStatus.map((s) => ({ status: s.status, count: s.count })),
        STATUS_COUNT_KEYS,
        TOOL_NAME,
      ) as OrganizationSummaryStatusCount[],
      outstandingAmount: analytics.kpis.outstandingAmount,
      paidRevenue: analytics.kpis.paidRevenue,
      invoiceStatusBreakdown: assertExactKeysList(
        analytics.breakdowns.invoiceStatus.map((s) => ({ status: s.status, count: s.count })),
        STATUS_COUNT_KEYS,
        TOOL_NAME,
      ) as OrganizationSummaryStatusCount[],
      recentInvoices: assertExactKeysList(
        analytics.recentInvoices.map(
          (invoice): OrganizationSummaryInvoiceItem => ({
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            amount: invoice.amount,
            currency: invoice.currency,
            clientName: invoice.clientName,
          }),
        ),
        INVOICE_ITEM_KEYS,
        TOOL_NAME,
      ) as OrganizationSummaryInvoiceItem[],
      upcomingTasks: assertExactKeysList(
        analytics.upcomingTasks.map(
          (task): OrganizationSummaryTaskItem => ({
            title: task.title,
            dueDate: task.dueDate.toISOString(),
            projectName: task.projectName,
          }),
        ),
        TASK_ITEM_KEYS,
        TOOL_NAME,
      ) as OrganizationSummaryTaskItem[],
      overdueTasks: assertExactKeysList(
        analytics.overdueTasks.map(
          (task): OrganizationSummaryTaskItem => ({
            title: task.title,
            dueDate: task.dueDate.toISOString(),
            projectName: task.projectName,
          }),
        ),
        TASK_ITEM_KEYS,
        TOOL_NAME,
      ) as OrganizationSummaryTaskItem[],
    };

    return toolOk(data);
  } catch {
    // Never the raw error/stack/database detail — see result.ts's own
    // doc comment on the "unavailable" category.
    return toolError("unavailable");
  }
}

export const GET_ORGANIZATION_SUMMARY_INPUT_SCHEMA = {
  type: "object",
  description: "Takes no arguments.",
  properties: {},
  additionalProperties: false,
} as const;

export const GET_ORGANIZATION_SUMMARY_DESCRIPTION =
  "Returns a summary of the current organization's business state: client/project/task/invoice counts and status breakdowns, recent invoices, and upcoming/overdue tasks. Takes no arguments.";
