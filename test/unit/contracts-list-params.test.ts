import { describe, expect, it } from "vitest";
import { parseContractListParams } from "@/app/(dashboard)/contracts/query";

/**
 * Documents Slice A — the Contracts list's new `?project=` param, tested
 * at the parse layer (the real validation boundary — see
 * ContractListParams.projectId's own doc comment for why this guard
 * lives here and not inside listContracts() itself, mirroring
 * tasks/query.ts's own identical ?projectId= convention).
 */
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
