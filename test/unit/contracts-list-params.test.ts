import { describe, expect, it } from "vitest";
import { parseContractListParams } from "@/app/(dashboard)/contracts/query";

/**
 * Contract client-filter UUID fix — the existing `?client=` param, now
 * guarded at the same parse layer as `?project=` (see
 * ContractListParams.clientId's own doc comment). A genuine pre-existing
 * gap, reported during Documents Slice A and fixed on its own here —
 * never silently bundled into that slice.
 */
describe("parseContractListParams — client", () => {
  it("a well-formed UUID is preserved", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const result = parseContractListParams({ client: id });
    expect(result.clientId).toBe(id);
  });

  it("missing client remains absent (undefined)", () => {
    const result = parseContractListParams({});
    expect(result.clientId).toBeUndefined();
  });

  it("a malformed client string does not propagate — falls back to undefined, never reaching a later Prisma query unguarded", () => {
    const result = parseContractListParams({ client: "not-a-uuid" });
    expect(result.clientId).toBeUndefined();
  });

  it("malformed UUID-like garbage does not propagate", () => {
    const result = parseContractListParams({ client: "11111111-1111-1111-1111-11111111111Z" });
    expect(result.clientId).toBeUndefined();
  });

  it("an empty client value stays absent (undefined), matching the missing-param case", () => {
    const result = parseContractListParams({ client: "" });
    expect(result.clientId).toBeUndefined();
  });

  it("a malformed client does not affect the project filter, and vice versa", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    const malformedClientWellFormedProject = parseContractListParams({ client: "not-a-uuid", project: id });
    expect(malformedClientWellFormedProject.clientId).toBeUndefined();
    expect(malformedClientWellFormedProject.projectId).toBe(id);

    const wellFormedClientMalformedProject = parseContractListParams({ client: id, project: "not-a-uuid" });
    expect(wellFormedClientMalformedProject.clientId).toBe(id);
    expect(wellFormedClientMalformedProject.projectId).toBeUndefined();
  });
});

describe("parseContractListParams — project", () => {
  it("a well-formed UUID passes through", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const result = parseContractListParams({ project: id });
    expect(result.projectId).toBe(id);
  });

  it("a malformed (non-UUID) value falls back to undefined, never reaching a later Prisma query unguarded", () => {
    const result = parseContractListParams({ project: "not-a-uuid" });
    expect(result.projectId).toBeUndefined();
  });

  it("absent param stays undefined", () => {
    const result = parseContractListParams({});
    expect(result.projectId).toBeUndefined();
  });

  it("composes independently of the other params — status/client/archived are unaffected", () => {
    const result = parseContractListParams({
      project: "not-a-uuid",
      status: "SENT",
      client: "22222222-2222-2222-2222-222222222222",
      archived: "1",
    });
    expect(result.projectId).toBeUndefined();
    expect(result.status).toBe("SENT");
    expect(result.clientId).toBe("22222222-2222-2222-2222-222222222222");
    expect(result.archived).toBe(true);
  });
});
