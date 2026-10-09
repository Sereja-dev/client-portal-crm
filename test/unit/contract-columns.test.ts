import { describe, expect, it, beforeEach } from "vitest";
import {
  CONTRACT_COLUMNS,
  CONTRACT_COLUMN_IDS,
  CONTRACT_MANDATORY_COLUMN_IDS,
} from "@/app/(dashboard)/contracts/columns";
import {
  buildTableColumnsStorageKey,
  readHiddenColumnIds,
  writeHiddenColumnIds,
  normalizeHiddenColumnIds,
} from "@/lib/table-columns/storage";

/**
 * Tables Improvement Slice E2 — focused, incremental coverage proving
 * Contracts' own adoption of the shared E1 table-columns primitive,
 * without re-deriving that primitive's own already-exhaustive generic
 * coverage (table-columns-storage.test.ts, use-table-columns.test.tsx —
 * untouched by this slice). This file proves two things specifically:
 * (1) `columns.ts`'s own CONTRACT_COLUMNS metadata is correctly shaped
 * (right mandatory/optional split, no stray/missing id, checkbox never
 * present), and (2) the shared storage module genuinely isolates the
 * new "contracts" surface from "invoices" at the namespace level.
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

describe("CONTRACT_COLUMNS metadata shape", () => {
  it("has exactly the seven expected stable ids, in canonical order", () => {
    expect(CONTRACT_COLUMN_IDS).toEqual(["contractNumber", "title", "client", "project", "status", "issueDate", "actions"]);
  });

  it("marks exactly contractNumber/status/actions mandatory", () => {
    expect(CONTRACT_MANDATORY_COLUMN_IDS).toEqual(["contractNumber", "status", "actions"]);
  });

  it("marks exactly title/client/project/issueDate optional", () => {
    const optional = CONTRACT_COLUMNS.filter((c) => !c.mandatory).map((c) => c.id);
    expect(optional).toEqual(["title", "client", "project", "issueDate"]);
  });

  it("never includes a checkbox/selection-control id -- the bulk-selection column is not a customizable column", () => {
    for (const id of CONTRACT_COLUMN_IDS) {
      expect(id.toLowerCase()).not.toMatch(/checkbox|select/);
    }
  });

  it("every column has a non-empty label", () => {
    for (const column of CONTRACT_COLUMNS) {
      expect(column.label.length).toBeGreaterThan(0);
    }
  });
});

describe("Contract column visibility (via normalizeHiddenColumnIds, using the real CONTRACT_COLUMN_IDS/CONTRACT_MANDATORY_COLUMN_IDS)", () => {
  function visibleIds(hidden: string[]): string[] {
    const normalized = new Set(normalizeHiddenColumnIds(hidden, CONTRACT_COLUMN_IDS, CONTRACT_MANDATORY_COLUMN_IDS));
    return CONTRACT_COLUMN_IDS.filter((id) => !normalized.has(id));
  }

  it("all columns visible by default", () => {
    expect(visibleIds([])).toEqual([...CONTRACT_COLUMN_IDS]);
  });

  it("hide Title", () => {
    expect(visibleIds(["title"])).toEqual(CONTRACT_COLUMN_IDS.filter((id) => id !== "title"));
  });

  it("hide Client", () => {
    expect(visibleIds(["client"])).toEqual(CONTRACT_COLUMN_IDS.filter((id) => id !== "client"));
  });

  it("hide Project", () => {
    expect(visibleIds(["project"])).toEqual(CONTRACT_COLUMN_IDS.filter((id) => id !== "project"));
  });

  it("hide Issue date", () => {
    expect(visibleIds(["issueDate"])).toEqual(CONTRACT_COLUMN_IDS.filter((id) => id !== "issueDate"));
  });

  it("mandatory contractNumber remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["contractNumber"])).toContain("contractNumber");
  });

  it("mandatory status remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["status"])).toContain("status");
  });

  it("mandatory actions remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["actions"])).toContain("actions");
  });

  it("an unknown Contract column id is ignored -- never hides an unrelated real column", () => {
    expect(visibleIds(["notARealContractColumn"])).toEqual([...CONTRACT_COLUMN_IDS]);
  });

  it("reset (empty hiddenIds) restores all Contract data columns after a previously-hidden state", () => {
    expect(visibleIds(["title", "client", "project", "issueDate"])).not.toEqual([...CONTRACT_COLUMN_IDS]);
    expect(visibleIds([])).toEqual([...CONTRACT_COLUMN_IDS]);
  });

  it("hiding every optional column at once leaves exactly the three mandatory ones", () => {
    expect(visibleIds(["title", "client", "project", "issueDate"])).toEqual(["contractNumber", "status", "actions"]);
  });
});

describe("contracts surface namespace isolation from invoices", () => {
  const ORG = "org-e2";
  const USER = "user-e2";

  it("builds a distinct storage key for contracts vs invoices", () => {
    const contractsKey = buildTableColumnsStorageKey(ORG, USER, "contracts");
    const invoicesKey = buildTableColumnsStorageKey(ORG, USER, "invoices");
    expect(contractsKey).not.toBe(invoicesKey);
    expect(contractsKey).toBe(`aqenra:table-columns:v1:${ORG}:${USER}:contracts`);
  });

  it("a hidden-column preference written for contracts is not visible when read back for invoices, and vice versa", () => {
    writeHiddenColumnIds(ORG, USER, "contracts", ["project"]);
    writeHiddenColumnIds(ORG, USER, "invoices", ["project"]);

    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);

    // Changing one surface's stored value never touches the other's.
    writeHiddenColumnIds(ORG, USER, "contracts", []);
    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual([]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);
  });

  it("Invoice's own mandatory/optional set is unaffected by Contracts existing as a second surface -- both are independently normalized against their own known/mandatory id sets", () => {
    // A raw "project" hidden-id, normalized against Contract's own sets,
    // stays hidden (project is optional for Contracts); the exact same
    // raw value normalized against Invoice's own distinct id set (which
    // this file does not import, by design -- Invoice's own tests cover
    // Invoice's own normalization) would be evaluated independently.
    // This test only asserts Contracts' own normalization is self-
    // contained and does not implicitly depend on any Invoice constant.
    const result = normalizeHiddenColumnIds(["project"], CONTRACT_COLUMN_IDS, CONTRACT_MANDATORY_COLUMN_IDS);
    expect(result).toEqual(["project"]);
  });
});
