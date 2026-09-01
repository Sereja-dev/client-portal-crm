import { describe, expect, it } from "vitest";
import { isMutationLikeToolName, assertNotMutationLikeToolName, MUTATION_LIKE_NAME_FRAGMENTS } from "@/lib/ai/tools/mutation-guard";

describe("isMutationLikeToolName", () => {
  it("rejects every required forbidden fragment as its own tool name", () => {
    for (const fragment of MUTATION_LIKE_NAME_FRAGMENTS) {
      expect(isMutationLikeToolName(fragment)).toBe(true);
    }
  });

  it("catches every required fragment word from the task spec, embedded in a realistic camelCase name", () => {
    const examples = [
      "createInvoice",
      "updateClient",
      "deleteTask",
      "removeAttachment",
      "archiveProject",
      "sendInvoiceReminder",
      "inviteTeamMember",
      "suspendOrganization",
      "reactivateOrganization",
      "uploadAttachment",
      "writeActivityLog",
      "mutateOrganization",
      "executeBillingRun",
    ];
    for (const name of examples) {
      expect(isMutationLikeToolName(name)).toBe(true);
    }
  });

  it("catches forbidden fragments regardless of separator/casing convention", () => {
    expect(isMutationLikeToolName("send_invoice_reminder")).toBe(true);
    expect(isMutationLikeToolName("SEND-INVOICE-REMINDER")).toBe(true);
    expect(isMutationLikeToolName("Send Invoice Reminder")).toBe(true);
  });

  it("allows realistic read-only tool names", () => {
    const examples = ["searchClients", "getClientDetail", "searchProjects", "searchTasks", "searchInvoices", "getActivitySummary", "getAnalyticsSummary", "getOrganizationSummary"];
    for (const name of examples) {
      expect(isMutationLikeToolName(name)).toBe(false);
    }
  });

  it("does not false-positive on a word that merely contains a forbidden fragment as a substring, not a whole word boundary", () => {
    // "created" is a distinct whole word from "create" — a tool listing
    // records by creation date is not a mutation, and must not be rejected.
    expect(isMutationLikeToolName("getCreatedTasks")).toBe(false);
    expect(isMutationLikeToolName("listRecentlyUpdatedInvoices")).toBe(false);
  });
});

describe("assertNotMutationLikeToolName", () => {
  it("throws for a mutation-like name", () => {
    expect(() => assertNotMutationLikeToolName("createInvoice")).toThrow(/mutation-like/i);
  });

  it("does not throw for a read-only name", () => {
    expect(() => assertNotMutationLikeToolName("searchClients")).not.toThrow();
  });
});
