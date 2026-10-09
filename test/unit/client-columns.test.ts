import { describe, expect, it, beforeEach } from "vitest";
import { CLIENT_COLUMNS, CLIENT_COLUMN_IDS, CLIENT_MANDATORY_COLUMN_IDS } from "@/app/(dashboard)/clients/columns";
import {
  buildTableColumnsStorageKey,
  readHiddenColumnIds,
  writeHiddenColumnIds,
  normalizeHiddenColumnIds,
} from "@/lib/table-columns/storage";

/**
 * Tables Improvement Slice E3B — focused, incremental coverage proving
 * Clients' own adoption of the shared E1/E2/E3A table-columns
 * primitive, without re-deriving that primitive's own already-
 * exhaustive generic coverage (table-columns-storage.test.ts,
 * use-table-columns.test.tsx — untouched by this slice). This file
 * proves two things specifically: (1) `columns.ts`'s own
 * CLIENT_COLUMNS metadata is correctly shaped (right mandatory/
 * optional split, no stray/missing id, no bulk-selection id — Clients
 * has none), and (2) the shared storage module genuinely isolates the
 * new "clients" surface from "invoices"/"contracts"/"quotes" at the
 * namespace level.
 */

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

describe("CLIENT_COLUMNS metadata shape", () => {
  it("has exactly the eight expected stable ids, in canonical order", () => {
    expect(CLIENT_COLUMN_IDS).toEqual(["name", "company", "email", "phone", "status", "tags", "createdAt", "actions"]);
  });

  it("marks exactly name/status/actions mandatory", () => {
    expect(CLIENT_MANDATORY_COLUMN_IDS).toEqual(["name", "status", "actions"]);
  });

  it("marks exactly company/email/phone/tags/createdAt optional", () => {
    const optional = CLIENT_COLUMNS.filter((c) => !c.mandatory).map((c) => c.id);
    expect(optional).toEqual(["company", "email", "phone", "tags", "createdAt"]);
  });

  it("never includes a checkbox/selection-control id -- Clients has no bulk selection at all", () => {
    for (const id of CLIENT_COLUMN_IDS) {
      expect(id.toLowerCase()).not.toMatch(/checkbox|select/);
    }
  });

  it("every column has a non-empty label", () => {
    for (const column of CLIENT_COLUMNS) {
      expect(column.label.length).toBeGreaterThan(0);
    }
  });
});

describe("Client column visibility (via normalizeHiddenColumnIds, using the real CLIENT_COLUMN_IDS/CLIENT_MANDATORY_COLUMN_IDS)", () => {
  function visibleIds(hidden: string[]): string[] {
    const normalized = new Set(normalizeHiddenColumnIds(hidden, CLIENT_COLUMN_IDS, CLIENT_MANDATORY_COLUMN_IDS));
    return CLIENT_COLUMN_IDS.filter((id) => !normalized.has(id));
  }

  it("all columns visible by default", () => {
    expect(visibleIds([])).toEqual([...CLIENT_COLUMN_IDS]);
  });

  it("hide Company", () => {
    expect(visibleIds(["company"])).toEqual(CLIENT_COLUMN_IDS.filter((id) => id !== "company"));
  });

  it("hide Email", () => {
    expect(visibleIds(["email"])).toEqual(CLIENT_COLUMN_IDS.filter((id) => id !== "email"));
  });

  it("hide Phone", () => {
    expect(visibleIds(["phone"])).toEqual(CLIENT_COLUMN_IDS.filter((id) => id !== "phone"));
  });

  it("hide Tags", () => {
    expect(visibleIds(["tags"])).toEqual(CLIENT_COLUMN_IDS.filter((id) => id !== "tags"));
  });

  it("hide Created", () => {
    expect(visibleIds(["createdAt"])).toEqual(CLIENT_COLUMN_IDS.filter((id) => id !== "createdAt"));
  });

  it("mandatory name remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["name"])).toContain("name");
  });

  it("mandatory status remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["status"])).toContain("status");
  });

  it("mandatory actions remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["actions"])).toContain("actions");
  });

  it("an unknown Client column id is ignored -- never hides an unrelated real column", () => {
    expect(visibleIds(["notARealClientColumn"])).toEqual([...CLIENT_COLUMN_IDS]);
  });

  it("reset (empty hiddenIds) restores all Client data columns after a previously-hidden state", () => {
    expect(visibleIds(["company", "email", "phone", "tags", "createdAt"])).not.toEqual([...CLIENT_COLUMN_IDS]);
    expect(visibleIds([])).toEqual([...CLIENT_COLUMN_IDS]);
  });

  it("hiding every optional column at once leaves exactly the three mandatory ones", () => {
    expect(visibleIds(["company", "email", "phone", "tags", "createdAt"])).toEqual(["name", "status", "actions"]);
  });
});

describe("clients surface namespace isolation from invoices/contracts/quotes", () => {
  const ORG = "org-e3b";
  const USER = "user-e3b";

  it("builds a distinct storage key for clients vs invoices vs contracts vs quotes", () => {
    const clientsKey = buildTableColumnsStorageKey(ORG, USER, "clients");
    const invoicesKey = buildTableColumnsStorageKey(ORG, USER, "invoices");
    const contractsKey = buildTableColumnsStorageKey(ORG, USER, "contracts");
    const quotesKey = buildTableColumnsStorageKey(ORG, USER, "quotes");
    expect(clientsKey).not.toBe(invoicesKey);
    expect(clientsKey).not.toBe(contractsKey);
    expect(clientsKey).not.toBe(quotesKey);
    expect(clientsKey).toBe(`aqenra:table-columns:v1:${ORG}:${USER}:clients`);
  });

  it("a hidden-column preference written for clients is not visible when read back for invoices/contracts/quotes, and vice versa", () => {
    writeHiddenColumnIds(ORG, USER, "clients", ["phone"]);
    writeHiddenColumnIds(ORG, USER, "invoices", ["project"]);
    writeHiddenColumnIds(ORG, USER, "contracts", ["project"]);
    writeHiddenColumnIds(ORG, USER, "quotes", ["title"]);

    expect(readHiddenColumnIds(ORG, USER, "clients")).toEqual(["phone"]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "quotes")).toEqual(["title"]);

    // Changing one surface's stored value never touches the others.
    writeHiddenColumnIds(ORG, USER, "clients", []);
    expect(readHiddenColumnIds(ORG, USER, "clients")).toEqual([]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "quotes")).toEqual(["title"]);
  });

  it("Client's own mandatory/optional set is unaffected by Invoice/Contract/Quote existing as other surfaces -- all four are independently normalized against their own known/mandatory id sets", () => {
    // A raw "phone" hidden-id, normalized against Client's own sets,
    // stays hidden (phone is optional for Clients); this test only
    // asserts Clients' own normalization is self-contained and does not
    // implicitly depend on any Invoice/Contract/Quote constant.
    const result = normalizeHiddenColumnIds(["phone"], CLIENT_COLUMN_IDS, CLIENT_MANDATORY_COLUMN_IDS);
    expect(result).toEqual(["phone"]);
  });
});
