import { describe, expect, it } from "vitest";
import { runTeardownStages } from "../global-setup";

/**
 * Shared harness transplant (pg-pool + PGliteSocket hardening reconciled
 * onto current main) — dedicated regression coverage for global-setup.
 * ts's own runTeardownStages(), the generic error-composition helper
 * teardown() now uses to run three independent stages in order (the
 * grants final-verifier, the shared-database shutdown, and the
 * PGliteSocket detach-error check), preserving every stage's own
 * failure and never letting a later stage's failure mask an earlier
 * one. Exercises all eight pass/fail combinations across the three
 * stages without booting a database or socket server — each stage here
 * is a synthetic function that either resolves or rejects with a
 * distinctly-named Error, standing in for the real verifier/stop/
 * detach-check calls.
 */

function ok(): () => Promise<void> {
  return () => Promise.resolve();
}

function fail(label: string): () => Promise<void> {
  return () => Promise.reject(new Error(label));
}

function messagesOf(error: unknown): string[] {
  expect(error).toBeInstanceOf(AggregateError);
  return (error as AggregateError).errors.map((e: unknown) => (e as Error).message);
}

describe("runTeardownStages", () => {
  it("1. all three stages pass: resolves", async () => {
    await expect(runTeardownStages([ok(), ok(), ok()])).resolves.toBeUndefined();
  });

  it("2. verifier alone fails: surfaces that original error unwrapped", async () => {
    await expect(runTeardownStages([fail("VERIFIER"), ok(), ok()])).rejects.toThrow("VERIFIER");
  });

  it("3. stop alone fails: surfaces that original error unwrapped", async () => {
    await expect(runTeardownStages([ok(), fail("STOP"), ok()])).rejects.toThrow("STOP");
  });

  it("4. detach-check alone fails: surfaces that original error unwrapped", async () => {
    await expect(runTeardownStages([ok(), ok(), fail("DETACH")])).rejects.toThrow("DETACH");
  });

  it("5. verifier + stop fail: both preserved", async () => {
    let caught: unknown;
    try {
      await runTeardownStages([fail("VERIFIER"), fail("STOP"), ok()]);
    } catch (err) {
      caught = err;
    }
    expect(messagesOf(caught)).toEqual(["VERIFIER", "STOP"]);
  });

  it("6. verifier + detach-check fail: both preserved", async () => {
    let caught: unknown;
    try {
      await runTeardownStages([fail("VERIFIER"), ok(), fail("DETACH")]);
    } catch (err) {
      caught = err;
    }
    expect(messagesOf(caught)).toEqual(["VERIFIER", "DETACH"]);
  });

  it("7. stop + detach-check fail: both preserved", async () => {
    let caught: unknown;
    try {
      await runTeardownStages([ok(), fail("STOP"), fail("DETACH")]);
    } catch (err) {
      caught = err;
    }
    expect(messagesOf(caught)).toEqual(["STOP", "DETACH"]);
  });

  it("8. all three fail: all three preserved, in order, none masking another", async () => {
    let caught: unknown;
    try {
      await runTeardownStages([fail("VERIFIER"), fail("STOP"), fail("DETACH")]);
    } catch (err) {
      caught = err;
    }
    expect(messagesOf(caught)).toEqual(["VERIFIER", "STOP", "DETACH"]);
    expect((caught as AggregateError).message).toMatch(/^VERIFIER/);
  });
});
