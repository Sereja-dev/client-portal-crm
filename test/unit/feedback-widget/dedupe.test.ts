import { beforeEach, describe, expect, it } from "vitest";
import { claimSubmission, contentFingerprint, resetSubmissionDedupeForTests } from "@/lib/feedback-widget/dedupe";

beforeEach(() => resetSubmissionDedupeForTests());

const scope = { userId: "user-1", kind: "bug" as const };

describe("claimSubmission", () => {
  it("lets the first submission through and rejects the same form instance again", () => {
    const keys = { submissionId: "form-instance-1", fingerprint: contentFingerprint(["a", "b"]) };
    expect(claimSubmission(scope, keys).duplicate).toBe(false);
    expect(claimSubmission(scope, keys).duplicate).toBe(true);
  });

  it("rejects identical content even from a different form instance (e.g. a second tab)", () => {
    const fingerprint = contentFingerprint(["Title", "Same description"]);
    expect(claimSubmission(scope, { submissionId: "tab-one-id", fingerprint }).duplicate).toBe(false);
    expect(claimSubmission(scope, { submissionId: "tab-two-id", fingerprint }).duplicate).toBe(true);
  });

  it("rejects the same form instance even if the text was edited slightly", () => {
    expect(claimSubmission(scope, { submissionId: "same-form-id", fingerprint: contentFingerprint(["v1"]) }).duplicate).toBe(false);
    expect(claimSubmission(scope, { submissionId: "same-form-id", fingerprint: contentFingerprint(["v2"]) }).duplicate).toBe(true);
  });

  it("works without a submission id, using content alone", () => {
    const fingerprint = contentFingerprint(["only content"]);
    expect(claimSubmission(scope, { submissionId: null, fingerprint }).duplicate).toBe(false);
    expect(claimSubmission(scope, { submissionId: null, fingerprint }).duplicate).toBe(true);
  });

  it("is scoped per user and per kind — another user or the other tab is never blocked", () => {
    const keys = { submissionId: "shared-id-1", fingerprint: contentFingerprint(["x"]) };
    expect(claimSubmission(scope, keys).duplicate).toBe(false);
    expect(claimSubmission({ userId: "user-2", kind: "bug" }, keys).duplicate).toBe(false);
    expect(claimSubmission({ userId: "user-1", kind: "support" }, keys).duplicate).toBe(false);
  });

  it("releases the claim when asked, so a retry after a failed send goes through", () => {
    const keys = { submissionId: "retry-id-1", fingerprint: contentFingerprint(["retry me"]) };
    const first = claimSubmission(scope, keys);
    expect(first.duplicate).toBe(false);
    if (!first.duplicate) first.release();
    expect(claimSubmission(scope, keys).duplicate).toBe(false);
  });

  it("expires claims after the window", () => {
    const keys = { submissionId: "ttl-id-1", fingerprint: contentFingerprint(["ttl"]) };
    const t0 = 1_000_000;
    expect(claimSubmission(scope, keys, t0).duplicate).toBe(false);
    expect(claimSubmission(scope, keys, t0 + 5 * 60 * 1000).duplicate).toBe(true);
    expect(claimSubmission(scope, keys, t0 + 11 * 60 * 1000).duplicate).toBe(false);
  });
});

describe("contentFingerprint", () => {
  it("ignores case and whitespace differences but not content, and keeps field boundaries", () => {
    expect(contentFingerprint(["Hello   World", "x"])).toBe(contentFingerprint(["hello world", "X"]));
    expect(contentFingerprint(["ab", "c"])).not.toBe(contentFingerprint(["a", "bc"]));
    expect(contentFingerprint(["one"])).not.toBe(contentFingerprint(["two"]));
  });
});
