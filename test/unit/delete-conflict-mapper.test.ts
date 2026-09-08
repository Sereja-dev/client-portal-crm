import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// delete-conflict-mapper.ts imports the real "server-only" marker package,
// which throws unless resolved under Next's own "react-server" condition —
// a guard this plain unit test process doesn't provide. Neutralizing the
// marker here doesn't touch mapDeleteRestrictError's own logic at all; see
// test/unit/cron-auth.test.ts's own identical header comment for the same
// pattern.
vi.mock("server-only", () => ({}));

const { mapDeleteRestrictError } = await import("@/lib/delete-conflict-mapper");

/**
 * Post-Hardening Residual Code Audit (P2), extended by Quotes / Estimates
 * Phase 2. Real, constructible `Prisma.PrismaClientKnownRequestError`
 * instances (not a mock of any business logic), shaped exactly as
 * empirically confirmed against a real Postgres RESTRICT violation
 * triggered directly in this repo before writing this classifier (see
 * delete-conflict-mapper.ts's own header comment) — the same "prove the
 * negative cases without weakening the classifier" discipline current-
 * user-p2003-classifier.test.ts already establishes for its own,
 * unrelated P2003 classifier.
 *
 * `childTable`/`fkField` build the cause's own `message`/`detail`
 * strings in the same cross-checked shape extractRestrictChildTable()
 * requires — omit them (pass `withChildTableSignal: false`) to get the
 * bare, pre-Quotes-Phase-2 shape (code only, no message/detail) for the
 * tests that specifically prove that under-specified shape now fails
 * closed to UNRECOGNIZED rather than being guessed at.
 */

function realRestrictViolation(
  meta: { modelName?: string; causeCode?: string; childTable?: string; fkField?: string } = {},
) {
  const { modelName, causeCode = "23001", childTable, fkField = "clientId" } = meta;
  const cause: Record<string, unknown> = { code: causeCode };
  if (childTable) {
    cause.message = `update or delete on table "${modelName}" violates foreign key constraint "${childTable}_${fkField}_fkey" on table "${childTable}"`;
    cause.detail = `Key (id)=(11111111-1111-1111-1111-111111111111) is referenced from table "${childTable}".`;
  }
  return new Prisma.PrismaClientKnownRequestError("mock restrict violation", {
    code: "P2039",
    clientVersion: "test",
    meta: { modelName, driverAdapterError: { cause } },
  });
}

describe("mapDeleteRestrictError", () => {
  it("recognizes the exact real Client-blocked-by-Invoice shape", () => {
    const err = realRestrictViolation({ modelName: "Client", childTable: "Invoice" });
    expect(mapDeleteRestrictError(err, "Client")).toBe("HAS_DEPENDENT_INVOICES");
  });

  it("recognizes the exact real Client-blocked-by-Quote shape", () => {
    const err = realRestrictViolation({ modelName: "Client", childTable: "Quote" });
    expect(mapDeleteRestrictError(err, "Client")).toBe("HAS_DEPENDENT_QUOTES");
  });

  it("recognizes the exact real Project-blocked-by-Invoice shape", () => {
    const err = realRestrictViolation({ modelName: "Project", childTable: "Invoice", fkField: "projectId" });
    expect(mapDeleteRestrictError(err, "Project")).toBe("HAS_DEPENDENT_INVOICES");
  });

  it("never returns HAS_DEPENDENT_QUOTES for a Project-targeted violation (Quote has no projectId at all)", () => {
    const err = realRestrictViolation({ modelName: "Project", childTable: "Quote", fkField: "projectId" });
    expect(mapDeleteRestrictError(err, "Project")).toBe("UNRECOGNIZED");
  });

  it("does not misclassify a restrict violation against a different model than the one requested", () => {
    const err = realRestrictViolation({ modelName: "Project", childTable: "Invoice", fkField: "projectId" });
    expect(mapDeleteRestrictError(err, "Client")).toBe("UNRECOGNIZED");
  });

  it("does not misclassify a P2039 with the right model but a different underlying Postgres error code", () => {
    const err = realRestrictViolation({ modelName: "Client", childTable: "Invoice", causeCode: "23505" }); // unique_violation, not restrict_violation
    expect(mapDeleteRestrictError(err, "Client")).toBe("UNRECOGNIZED");
  });

  it("fails closed to UNRECOGNIZED when the cause carries no message/detail child-table signal at all (never guesses)", () => {
    const err = realRestrictViolation({ modelName: "Client" });
    expect(mapDeleteRestrictError(err, "Client")).toBe("UNRECOGNIZED");
  });

  it("fails closed to UNRECOGNIZED when the message's constraint-name prefix disagrees with the detail's own table name", () => {
    const err = new Prisma.PrismaClientKnownRequestError("mock restrict violation", {
      code: "P2039",
      clientVersion: "test",
      meta: {
        modelName: "Client",
        driverAdapterError: {
          cause: {
            code: "23001",
            message: 'update or delete on table "Client" violates foreign key constraint "Quote_clientId_fkey" on table "Quote"',
            detail: 'Key (id)=(11111111-1111-1111-1111-111111111111) is referenced from table "Invoice".',
          },
        },
      },
    });
    expect(mapDeleteRestrictError(err, "Client")).toBe("UNRECOGNIZED");
  });

  it("does not misclassify a different Prisma error code entirely (e.g. P2025, not found)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("mock not found", {
      code: "P2025",
      clientVersion: "test",
      meta: { modelName: "Client" },
    });
    expect(mapDeleteRestrictError(err, "Client")).toBe("UNRECOGNIZED");
  });

  it("does not misclassify a malformed/missing meta shape", () => {
    expect(mapDeleteRestrictError(realRestrictViolation({}), "Client")).toBe("UNRECOGNIZED");
    expect(
      mapDeleteRestrictError(
        new Prisma.PrismaClientKnownRequestError("no meta", { code: "P2039", clientVersion: "test" }),
        "Client",
      ),
    ).toBe("UNRECOGNIZED");
  });

  it("never classifies a non-Prisma error as a dependent-invoices conflict", () => {
    expect(mapDeleteRestrictError(new Error("some other failure"), "Client")).toBe("UNRECOGNIZED");
    expect(mapDeleteRestrictError("a string", "Project")).toBe("UNRECOGNIZED");
    expect(mapDeleteRestrictError(null, "Client")).toBe("UNRECOGNIZED");
    expect(mapDeleteRestrictError(undefined, "Project")).toBe("UNRECOGNIZED");
  });
});
