import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getPricingFreshnessWarning, PRICING_SNAPSHOT_DATE, PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS } from "../pricing.js";

describe("pricing.ts — getPricingFreshnessWarning (Finding 4 — warning only, never a refusal)", () => {
  test("returns null when 'now' is exactly the snapshot date", () => {
    assert.equal(getPricingFreshnessWarning(new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00.000Z`)), null);
  });

  test("returns null when 'now' is within the threshold", () => {
    const withinThreshold = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00.000Z`);
    withinThreshold.setUTCDate(withinThreshold.getUTCDate() + PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS);
    assert.equal(getPricingFreshnessWarning(withinThreshold), null);
  });

  test("returns a loud, descriptive warning string once past the threshold", () => {
    const pastThreshold = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00.000Z`);
    pastThreshold.setUTCDate(pastThreshold.getUTCDate() + PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS + 1);
    const warning = getPricingFreshnessWarning(pastThreshold);
    assert.notEqual(warning, null);
    assert.match(warning!, new RegExp(`${PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS} days`));
    assert.match(warning!, /reverif/i);
    assert.match(warning!, /official/i);
  });

  test("warning is proportional — a far-future date names a large, correct day count", () => {
    const farFuture = new Date(`${PRICING_SNAPSHOT_DATE}T00:00:00.000Z`);
    farFuture.setUTCDate(farFuture.getUTCDate() + 400);
    const warning = getPricingFreshnessWarning(farFuture);
    assert.match(warning!, /400 days/);
  });

  test("never throws and never refuses (returns a string or null only — no exception, no process.exit)", () => {
    assert.doesNotThrow(() => getPricingFreshnessWarning(new Date("2099-01-01T00:00:00.000Z")));
  });

  test("threshold is documented as exactly 30 days unless deliberately changed", () => {
    assert.equal(PRICING_FRESHNESS_WARNING_THRESHOLD_DAYS, 30);
  });
});
