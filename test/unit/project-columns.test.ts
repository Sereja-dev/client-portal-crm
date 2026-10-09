import { describe, expect, it, beforeEach } from "vitest";
import { PROJECT_COLUMNS, PROJECT_COLUMN_IDS, PROJECT_MANDATORY_COLUMN_IDS } from "@/app/(dashboard)/projects/columns";
import {
  buildTableColumnsStorageKey,
  readHiddenColumnIds,
  writeHiddenColumnIds,
  normalizeHiddenColumnIds,
} from "@/lib/table-columns/storage";

/**
 * Tables Improvement Slice E3C — focused, incremental coverage proving
 * Projects' own adoption of the shared E1/E2/E3A/E3B table-columns
 * primitive, without re-deriving that primitive's own already-
 * exhaustive generic coverage (table-columns-storage.test.ts,
 * use-table-columns.test.tsx — untouched by this slice). This file
 * proves two things specifically: (1) `columns.ts`'s own
 * PROJECT_COLUMNS metadata is correctly shaped (right mandatory/
 * optional split, no stray/missing id, no bulk-selection id — Projects
 * has none), and (2) the shared storage module genuinely isolates the
 * new "projects" surface from "invoices"/"contracts"/"quotes"/
 * "clients" at the namespace level.
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

describe("PROJECT_COLUMNS metadata shape", () => {
  it("has exactly the seven expected stable ids, in canonical order", () => {
    expect(PROJECT_COLUMN_IDS).toEqual(["name", "client", "status", "startDate", "endDate", "createdAt", "actions"]);
  });

  it("marks exactly name/status/actions mandatory", () => {
    expect(PROJECT_MANDATORY_COLUMN_IDS).toEqual(["name", "status", "actions"]);
  });

  it("marks exactly client/startDate/endDate/createdAt optional", () => {
    const optional = PROJECT_COLUMNS.filter((c) => !c.mandatory).map((c) => c.id);
    expect(optional).toEqual(["client", "startDate", "endDate", "createdAt"]);
  });

  it("never includes a checkbox/selection-control id -- Projects has no bulk selection at all", () => {
    for (const id of PROJECT_COLUMN_IDS) {
      expect(id.toLowerCase()).not.toMatch(/checkbox|select/);
    }
  });

  it("every column has a non-empty label", () => {
    for (const column of PROJECT_COLUMNS) {
      expect(column.label.length).toBeGreaterThan(0);
    }
  });
});

describe("Project column visibility (via normalizeHiddenColumnIds, using the real PROJECT_COLUMN_IDS/PROJECT_MANDATORY_COLUMN_IDS)", () => {
  function visibleIds(hidden: string[]): string[] {
    const normalized = new Set(normalizeHiddenColumnIds(hidden, PROJECT_COLUMN_IDS, PROJECT_MANDATORY_COLUMN_IDS));
    return PROJECT_COLUMN_IDS.filter((id) => !normalized.has(id));
  }

  it("all columns visible by default", () => {
    expect(visibleIds([])).toEqual([...PROJECT_COLUMN_IDS]);
  });

  it("hide Client", () => {
    expect(visibleIds(["client"])).toEqual(PROJECT_COLUMN_IDS.filter((id) => id !== "client"));
  });

  it("hide Start date", () => {
    expect(visibleIds(["startDate"])).toEqual(PROJECT_COLUMN_IDS.filter((id) => id !== "startDate"));
  });

  it("hide End date", () => {
    expect(visibleIds(["endDate"])).toEqual(PROJECT_COLUMN_IDS.filter((id) => id !== "endDate"));
  });

  it("hide Created", () => {
    expect(visibleIds(["createdAt"])).toEqual(PROJECT_COLUMN_IDS.filter((id) => id !== "createdAt"));
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

  it("an unknown Project column id is ignored -- never hides an unrelated real column", () => {
    expect(visibleIds(["notARealProjectColumn"])).toEqual([...PROJECT_COLUMN_IDS]);
  });

  it("reset (empty hiddenIds) restores all Project data columns after a previously-hidden state", () => {
    expect(visibleIds(["client", "startDate", "endDate", "createdAt"])).not.toEqual([...PROJECT_COLUMN_IDS]);
    expect(visibleIds([])).toEqual([...PROJECT_COLUMN_IDS]);
  });

  it("hiding every optional column at once leaves exactly the three mandatory ones", () => {
    expect(visibleIds(["client", "startDate", "endDate", "createdAt"])).toEqual(["name", "status", "actions"]);
  });
});

describe("projects surface namespace isolation from invoices/contracts/quotes/clients", () => {
  const ORG = "org-e3c";
  const USER = "user-e3c";

  it("builds a distinct storage key for projects vs invoices vs contracts vs quotes vs clients", () => {
    const projectsKey = buildTableColumnsStorageKey(ORG, USER, "projects");
    const invoicesKey = buildTableColumnsStorageKey(ORG, USER, "invoices");
    const contractsKey = buildTableColumnsStorageKey(ORG, USER, "contracts");
    const quotesKey = buildTableColumnsStorageKey(ORG, USER, "quotes");
    const clientsKey = buildTableColumnsStorageKey(ORG, USER, "clients");
    expect(projectsKey).not.toBe(invoicesKey);
    expect(projectsKey).not.toBe(contractsKey);
    expect(projectsKey).not.toBe(quotesKey);
    expect(projectsKey).not.toBe(clientsKey);
    expect(projectsKey).toBe(`aqenra:table-columns:v1:${ORG}:${USER}:projects`);
  });

  it("a hidden-column preference written for projects is not visible when read back for invoices/contracts/quotes/clients, and vice versa", () => {
    writeHiddenColumnIds(ORG, USER, "projects", ["client"]);
    writeHiddenColumnIds(ORG, USER, "invoices", ["project"]);
    writeHiddenColumnIds(ORG, USER, "contracts", ["project"]);
    writeHiddenColumnIds(ORG, USER, "quotes", ["title"]);
    writeHiddenColumnIds(ORG, USER, "clients", ["phone"]);

    expect(readHiddenColumnIds(ORG, USER, "projects")).toEqual(["client"]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "quotes")).toEqual(["title"]);
    expect(readHiddenColumnIds(ORG, USER, "clients")).toEqual(["phone"]);

    // Changing one surface's stored value never touches the others.
    writeHiddenColumnIds(ORG, USER, "projects", []);
    expect(readHiddenColumnIds(ORG, USER, "projects")).toEqual([]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "quotes")).toEqual(["title"]);
    expect(readHiddenColumnIds(ORG, USER, "clients")).toEqual(["phone"]);
  });

  it("Project's own mandatory/optional set is unaffected by Invoice/Contract/Quote/Client existing as other surfaces -- all five are independently normalized against their own known/mandatory id sets", () => {
    // A raw "client" hidden-id, normalized against Project's own sets,
    // stays hidden (client is optional for Projects); this test only
    // asserts Projects' own normalization is self-contained and does
    // not implicitly depend on any Invoice/Contract/Quote/Client
    // constant.
    const result = normalizeHiddenColumnIds(["client"], PROJECT_COLUMN_IDS, PROJECT_MANDATORY_COLUMN_IDS);
    expect(result).toEqual(["client"]);
  });
});
