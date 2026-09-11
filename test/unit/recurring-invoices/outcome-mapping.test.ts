import { describe, expect, it, vi } from "vitest";

// process-due-recurring-invoices.ts imports the real "server-only" marker
// package (transitively, via generate.ts), which throws outside Next's
// own build — see test/unit/cron-auth.test.ts's own header comment for
// the identical precedent.
vi.mock("server-only", () => ({}));

import { mapGenerationOutcomeToSummaryBucket } from "@/lib/recurring-invoices/jobs/process-due-recurring-invoices";

/**
 * Recurring Invoices Phase 2B-1 — the generator-outcome -> summary-bucket
 * mapping (test items 10-16). Covers every outcome
 * generateRecurringInvoiceOccurrence can return, including the three
 * (not_active/not_found/invalid_occurrence_date) that a real end-to-end
 * integration test can't deterministically force without an artificial
 * race — see this function's own doc comment for why.
 */
describe("mapGenerationOutcomeToSummaryBucket", () => {
  it("10. generated -> generated", () => {
    expect(mapGenerationOutcomeToSummaryBucket("generated")).toBe("generated");
  });
  it("11. skipped_completed -> skipped", () => {
    expect(mapGenerationOutcomeToSummaryBucket("skipped_completed")).toBe("skipped");
  });
  it("12. skipped_claimed -> skipped", () => {
    expect(mapGenerationOutcomeToSummaryBucket("skipped_claimed")).toBe("skipped");
  });
  it("13. not_active -> skipped", () => {
    expect(mapGenerationOutcomeToSummaryBucket("not_active")).toBe("skipped");
  });
  it("14. not_found -> skipped", () => {
    expect(mapGenerationOutcomeToSummaryBucket("not_found")).toBe("skipped");
  });
  it("15. invalid_occurrence_date -> skipped", () => {
    expect(mapGenerationOutcomeToSummaryBucket("invalid_occurrence_date")).toBe("skipped");
  });
  it("16. failed -> failed", () => {
    expect(mapGenerationOutcomeToSummaryBucket("failed")).toBe("failed");
  });
});
