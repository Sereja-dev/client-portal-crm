import { describe, expect, it, vi } from "vitest";

// pipeline-query.ts's own dependency chain (custom-statuses/definitions.ts,
// calendar-events/queries.ts) imports "server-only" — every existing unit
// test that reaches a server-only module mocks it out the same way (see
// test/integration/setup-mocks.ts's own comment on this exact convention).
vi.mock("server-only", () => ({}));

import { PIPELINE_COLUMN_QUERY_CONCURRENCY, runWithBoundedConcurrency } from "@/app/(dashboard)/leads/pipeline-query";

/**
 * Leads Pipeline P2028 remediation — `runWithBoundedConcurrency` is the
 * replacement for the per-column `prisma.$transaction([...])` batch that
 * crashed Production (Prisma P2028: a 10-column org's own 10 sequential
 * reads inside one transaction exceeded its 5000ms timeout — see
 * pipeline-query.ts's own `PIPELINE_COLUMN_QUERY_CONCURRENCY` comment).
 *
 * Deliberately tested here as a pure function, independent of Prisma/DB:
 * every assertion below is driven by manually-resolved deferred promises,
 * never wall-clock sleeps, so peak-concurrency and ordering are
 * deterministic rather than timing-dependent.
 */

/** A promise plus its own resolve/reject, so a test can control exactly when a "worker" completes. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets already-queued microtasks (e.g. a worker's own `.then`/loop continuation) run before the next assertion. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runWithBoundedConcurrency", () => {
  it("PIPELINE_COLUMN_QUERY_CONCURRENCY is the documented cap of 5", () => {
    expect(PIPELINE_COLUMN_QUERY_CONCURRENCY).toBe(5);
  });

  it("empty input resolves immediately to an empty array, no worker ever invoked", async () => {
    let invoked = 0;
    const result = await runWithBoundedConcurrency(0, 5, async (i) => {
      invoked += 1;
      return i;
    });
    expect(result).toEqual([]);
    expect(invoked).toBe(0);
  });

  it("fewer items than the cap: every item still runs, all concurrently", async () => {
    const controls = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];

    const resultPromise = runWithBoundedConcurrency(3, 5, async (i) => {
      started.push(i);
      return controls[i].promise;
    });

    await flushMicrotasks();
    // All 3 (< cap of 5) must have started immediately — no queuing needed.
    expect(started.sort()).toEqual([0, 1, 2]);

    controls[2].resolve("c");
    controls[0].resolve("a");
    controls[1].resolve("b");

    const result = await resultPromise;
    // Order preserved by input index, not by resolution order.
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("more items than the cap: peak in-flight never exceeds the cap, and later work only begins as slots free", async () => {
    const CAP = 3;
    const TOTAL = 8;
    const controls = Array.from({ length: TOTAL }, () => deferred<number>());
    let inFlight = 0;
    let peak = 0;
    const startedOrder: number[] = [];

    const resultPromise = runWithBoundedConcurrency(TOTAL, CAP, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      startedOrder.push(i);
      try {
        return await controls[i].promise;
      } finally {
        inFlight -= 1;
      }
    });

    await flushMicrotasks();
    // Exactly CAP workers claimed the first CAP indices; nothing beyond
    // the cap has started yet, regardless of how many items remain.
    expect(startedOrder.slice().sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(inFlight).toBe(CAP);
    expect(peak).toBe(CAP);

    // Free exactly one slot — only one new index should start, not a burst.
    controls[0].resolve(0);
    await flushMicrotasks();
    expect(inFlight).toBe(CAP);
    expect(peak).toBe(CAP); // never exceeded, even after a slot freed and was reclaimed
    expect(startedOrder).toContain(3);

    // Drain the rest.
    for (let i = 1; i < TOTAL; i++) {
      controls[i].resolve(i);
      await flushMicrotasks();
    }

    const result = await resultPromise;
    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBeLessThanOrEqual(CAP);
    expect(inFlight).toBe(0);
  });

  it("one worker rejecting fails the whole operation, preserving the original error, without retrying it", async () => {
    let callCountForIndex1 = 0;
    const boom = new Error("injected worker failure");

    await expect(
      runWithBoundedConcurrency(3, 5, async (i) => {
        if (i === 1) {
          callCountForIndex1 += 1;
          throw boom;
        }
        return i;
      }),
    ).rejects.toBe(boom);

    expect(callCountForIndex1).toBe(1);
  });

  it("after a failure, no new work is claimed, but already-in-flight work still completes (Promise.all-like semantics)", async () => {
    const controlFor0 = deferred<number>();
    let index2Started = false;

    const resultPromise = runWithBoundedConcurrency(3, 2, async (i) => {
      if (i === 0) return controlFor0.promise;
      if (i === 1) throw new Error("injected failure at index 1");
      index2Started = true;
      return i;
    });

    // Cap is 2: workers claim indices 0 and 1 immediately. Index 1 fails
    // right away; index 0 is still pending (its own deferred promise).
    await flushMicrotasks();
    // Index 2 must not have started — no free worker claimed it, since
    // the worker that finished index 1 sees `failed` already set.
    expect(index2Started).toBe(false);

    controlFor0.resolve(0);
    await expect(resultPromise).rejects.toThrow("injected failure at index 1");
    expect(index2Started).toBe(false);
  });
});
