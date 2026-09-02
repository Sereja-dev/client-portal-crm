import { describe, expect, it } from "vitest";
import { executeSearchClients, executeGetClientDetail, SEARCH_CLIENTS_INPUT_SCHEMA, GET_CLIENT_DETAIL_INPUT_SCHEMA } from "@/lib/ai/tools/clients";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const REAL_UUID = "22222222-2222-2222-2222-222222222222";

describe("executeSearchClients — input validation (no DB success required)", () => {
  it("rejects an unknown key: organizationId", async () => {
    expect(await executeSearchClients(ORG_ID, { organizationId: "foreign" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: userId", async () => {
    expect(await executeSearchClients(ORG_ID, { userId: "x" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: limit", async () => {
    expect(await executeSearchClients(ORG_ID, { limit: 1000 })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: where", async () => {
    expect(await executeSearchClients(ORG_ID, { where: { organizationId: "x" } })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown key: select", async () => {
    expect(await executeSearchClients(ORG_ID, { select: { email: true, notes: true } })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an oversized query", async () => {
    expect(await executeSearchClients(ORG_ID, { query: "a".repeat(101) })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an invalid status enum", async () => {
    expect(await executeSearchClients(ORG_ID, { status: "BOGUS_STATUS" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a non-object input", async () => {
    expect(await executeSearchClients(ORG_ID, "clients")).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a nested arbitrary object as query", async () => {
    expect(await executeSearchClients(ORG_ID, { query: { $ne: null } })).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("executeGetClientDetail — input validation", () => {
  it("rejects missing ref", async () => {
    expect(await executeGetClientDetail(ORG_ID, {})).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a malformed ref", async () => {
    expect(await executeGetClientDetail(ORG_ID, { ref: "not-a-uuid" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects an unknown extra key alongside a valid ref", async () => {
    expect(await executeGetClientDetail(ORG_ID, { ref: REAL_UUID, organizationId: "foreign" })).toEqual({ ok: false, error: "invalid_input" });
  });
  it("rejects a SQL-injection-shaped ref", async () => {
    expect(await executeGetClientDetail(ORG_ID, { ref: "' OR 1=1 --" })).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("Batch 1B.1 client tools — schema declarations", () => {
  it("searchClients schema forbids additional properties and never declares email/phone/notes", () => {
    expect(SEARCH_CLIENTS_INPUT_SCHEMA.additionalProperties).toBe(false);
    const keys = Object.keys(SEARCH_CLIENTS_INPUT_SCHEMA.properties);
    expect(keys).toEqual(["query", "status"]);
  });
  it("getClientDetail schema forbids additional properties and only requires ref", () => {
    expect(GET_CLIENT_DETAIL_INPUT_SCHEMA.additionalProperties).toBe(false);
    expect(GET_CLIENT_DETAIL_INPUT_SCHEMA.required).toEqual(["ref"]);
    expect(Object.keys(GET_CLIENT_DETAIL_INPUT_SCHEMA.properties)).toEqual(["ref"]);
  });
});
