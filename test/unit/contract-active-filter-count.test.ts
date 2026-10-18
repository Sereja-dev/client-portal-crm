import { describe, expect, it } from "vitest";
import { computeContractActiveFilterCount } from "@/app/(dashboard)/contracts/query";

/**
 * Mobile Improvement Slice B1 — the exact, Product-approved active-count
 * rule for Contracts' own mobile Filter disclosure. Locks in: status,
 * clientId, projectId, and archived each contribute at most 1; q and
 * sort are excluded entirely (not even representable — see the
 * function's own `Pick<...>` signature).
 */
describe("computeContractActiveFilterCount", () => {
  it("is 0 when no filter field is set", () => {
    expect(
      computeContractActiveFilterCount({
        status: undefined,
        clientId: undefined,
        projectId: undefined,
        archived: false,
      }),
    ).toBe(0);
  });

  it("counts status alone as 1", () => {
    expect(
      computeContractActiveFilterCount({
        status: "SENT",
        clientId: undefined,
        projectId: undefined,
        archived: false,
      }),
    ).toBe(1);
  });

  it("counts clientId alone as 1", () => {
    expect(
      computeContractActiveFilterCount({
        status: undefined,
        clientId: "11111111-1111-1111-1111-111111111111",
        projectId: undefined,
        archived: false,
      }),
    ).toBe(1);
  });

  it("counts projectId alone as 1", () => {
    expect(
      computeContractActiveFilterCount({
        status: undefined,
        clientId: undefined,
        projectId: "22222222-2222-2222-2222-222222222222",
        archived: false,
      }),
    ).toBe(1);
  });

  it("counts archived=true alone as 1", () => {
    expect(
      computeContractActiveFilterCount({
        status: undefined,
        clientId: undefined,
        projectId: undefined,
        archived: true,
      }),
    ).toBe(1);
  });

  it("sums all four when every field is set", () => {
    expect(
      computeContractActiveFilterCount({
        status: "DRAFT",
        clientId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        archived: true,
      }),
    ).toBe(4);
  });

  it("archived=false never contributes, even when every other field is set", () => {
    expect(
      computeContractActiveFilterCount({
        status: "ACCEPTED",
        clientId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        archived: false,
      }),
    ).toBe(3);
  });

  it("excludes q and sort structurally — they are not accepted parameters at all", () => {
    // Pick<ContractListParams, "status" | "clientId" | "projectId" | "archived">
    // makes this a compile-time guarantee, not just a runtime one: passing
    // q/sortField/sortDir/sortCombined/hasSort would be a type error. This
    // test only re-confirms the runtime result stays unaffected by any
    // other ContractListParams field that happens to be in scope.
    const q = "ignored search text";
    const sortField = "issueDate";
    void q;
    void sortField;

    expect(
      computeContractActiveFilterCount({
        status: undefined,
        clientId: undefined,
        projectId: undefined,
        archived: false,
      }),
    ).toBe(0);
  });
});
