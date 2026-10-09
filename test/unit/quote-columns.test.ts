import { describe, expect, it, beforeEach } from "vitest";
import { QUOTE_COLUMNS, QUOTE_COLUMN_IDS, QUOTE_MANDATORY_COLUMN_IDS } from "@/app/(dashboard)/quotes/columns";
import {
  buildTableColumnsStorageKey,
  readHiddenColumnIds,
  writeHiddenColumnIds,
  normalizeHiddenColumnIds,
} from "@/lib/table-columns/storage";

/**
 * Tables Improvement Slice E3A — focused, incremental coverage proving
 * Quotes' own adoption of the shared E1/E2 table-columns primitive,
 * without re-deriving that primitive's own already-exhaustive generic
 * coverage (table-columns-storage.test.ts, use-table-columns.test.tsx —
 * untouched by this slice). This file proves two things specifically:
 * (1) `columns.ts`'s own QUOTE_COLUMNS metadata is correctly shaped
 * (right mandatory/optional split, no stray/missing id, no bulk-
 * selection id — Quotes has none), and (2) the shared storage module
 * genuinely isolates the new "quotes" surface from "invoices" and
 * "contracts" at the namespace level.
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

describe("QUOTE_COLUMNS metadata shape", () => {
  it("has exactly the eight expected stable ids, in canonical order", () => {
    expect(QUOTE_COLUMN_IDS).toEqual([
      "quoteNumber",
      "target",
      "title",
      "status",
      "total",
      "issueDate",
      "validUntil",
      "actions",
    ]);
  });

  it("marks exactly quoteNumber/status/actions mandatory", () => {
    expect(QUOTE_MANDATORY_COLUMN_IDS).toEqual(["quoteNumber", "status", "actions"]);
  });

  it("marks exactly target/title/total/issueDate/validUntil optional", () => {
    const optional = QUOTE_COLUMNS.filter((c) => !c.mandatory).map((c) => c.id);
    expect(optional).toEqual(["target", "title", "total", "issueDate", "validUntil"]);
  });

  it("never includes a checkbox/selection-control id -- Quotes has no bulk selection at all", () => {
    for (const id of QUOTE_COLUMN_IDS) {
      expect(id.toLowerCase()).not.toMatch(/checkbox|select/);
    }
  });

  it("every column has a non-empty label", () => {
    for (const column of QUOTE_COLUMNS) {
      expect(column.label.length).toBeGreaterThan(0);
    }
  });
});

describe("Quote column visibility (via normalizeHiddenColumnIds, using the real QUOTE_COLUMN_IDS/QUOTE_MANDATORY_COLUMN_IDS)", () => {
  function visibleIds(hidden: string[]): string[] {
    const normalized = new Set(normalizeHiddenColumnIds(hidden, QUOTE_COLUMN_IDS, QUOTE_MANDATORY_COLUMN_IDS));
    return QUOTE_COLUMN_IDS.filter((id) => !normalized.has(id));
  }

  it("all columns visible by default", () => {
    expect(visibleIds([])).toEqual([...QUOTE_COLUMN_IDS]);
  });

  it("hide Target", () => {
    expect(visibleIds(["target"])).toEqual(QUOTE_COLUMN_IDS.filter((id) => id !== "target"));
  });

  it("hide Title", () => {
    expect(visibleIds(["title"])).toEqual(QUOTE_COLUMN_IDS.filter((id) => id !== "title"));
  });

  it("hide Total", () => {
    expect(visibleIds(["total"])).toEqual(QUOTE_COLUMN_IDS.filter((id) => id !== "total"));
  });

  it("hide Issue date", () => {
    expect(visibleIds(["issueDate"])).toEqual(QUOTE_COLUMN_IDS.filter((id) => id !== "issueDate"));
  });

  it("hide Valid until", () => {
    expect(visibleIds(["validUntil"])).toEqual(QUOTE_COLUMN_IDS.filter((id) => id !== "validUntil"));
  });

  it("mandatory quoteNumber remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["quoteNumber"])).toContain("quoteNumber");
  });

  it("mandatory status remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["status"])).toContain("status");
  });

  it("mandatory actions remains visible even if present in stored hiddenIds", () => {
    expect(visibleIds(["actions"])).toContain("actions");
  });

  it("an unknown Quote column id is ignored -- never hides an unrelated real column", () => {
    expect(visibleIds(["notARealQuoteColumn"])).toEqual([...QUOTE_COLUMN_IDS]);
  });

  it("reset (empty hiddenIds) restores all Quote data columns after a previously-hidden state", () => {
    expect(visibleIds(["target", "title", "total", "issueDate", "validUntil"])).not.toEqual([...QUOTE_COLUMN_IDS]);
    expect(visibleIds([])).toEqual([...QUOTE_COLUMN_IDS]);
  });

  it("hiding every optional column at once leaves exactly the three mandatory ones", () => {
    expect(visibleIds(["target", "title", "total", "issueDate", "validUntil"])).toEqual([
      "quoteNumber",
      "status",
      "actions",
    ]);
  });
});

describe("quotes surface namespace isolation from invoices and contracts", () => {
  const ORG = "org-e3a";
  const USER = "user-e3a";

  it("builds a distinct storage key for quotes vs invoices vs contracts", () => {
    const quotesKey = buildTableColumnsStorageKey(ORG, USER, "quotes");
    const invoicesKey = buildTableColumnsStorageKey(ORG, USER, "invoices");
    const contractsKey = buildTableColumnsStorageKey(ORG, USER, "contracts");
    expect(quotesKey).not.toBe(invoicesKey);
    expect(quotesKey).not.toBe(contractsKey);
    expect(quotesKey).toBe(`aqenra:table-columns:v1:${ORG}:${USER}:quotes`);
  });

  it("a hidden-column preference written for quotes is not visible when read back for invoices or contracts, and vice versa", () => {
    writeHiddenColumnIds(ORG, USER, "quotes", ["title"]);
    writeHiddenColumnIds(ORG, USER, "invoices", ["project"]);
    writeHiddenColumnIds(ORG, USER, "contracts", ["project"]);

    expect(readHiddenColumnIds(ORG, USER, "quotes")).toEqual(["title"]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual(["project"]);

    // Changing one surface's stored value never touches the others.
    writeHiddenColumnIds(ORG, USER, "quotes", []);
    expect(readHiddenColumnIds(ORG, USER, "quotes")).toEqual([]);
    expect(readHiddenColumnIds(ORG, USER, "invoices")).toEqual(["project"]);
    expect(readHiddenColumnIds(ORG, USER, "contracts")).toEqual(["project"]);
  });

  it("Quote's own mandatory/optional set is unaffected by Invoice/Contract existing as other surfaces -- all three are independently normalized against their own known/mandatory id sets", () => {
    // A raw "title" hidden-id, normalized against Quote's own sets,
    // stays hidden (title is optional for Quotes); this test only
    // asserts Quotes' own normalization is self-contained and does not
    // implicitly depend on any Invoice/Contract constant.
    const result = normalizeHiddenColumnIds(["title"], QUOTE_COLUMN_IDS, QUOTE_MANDATORY_COLUMN_IDS);
    expect(result).toEqual(["title"]);
  });
});
