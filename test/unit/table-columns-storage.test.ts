import { describe, expect, it, beforeEach } from "vitest";
import {
  TABLE_COLUMNS_STORAGE_VERSION,
  buildTableColumnsStorageKey,
  parseTableColumnsStorage,
  readHiddenColumnIds,
  writeHiddenColumnIds,
  normalizeHiddenColumnIds,
  type TableColumnsSurface,
} from "@/lib/table-columns/storage";

/**
 * Tables Improvement Slice E1 — exhaustive coverage of the Column
 * Customization storage contract, mirroring
 * `saved-views-storage.test.ts`'s own identical shape and technique: a
 * minimal in-memory `Storage` stand-in installed on
 * `globalThis.localStorage` (this repo's one unit-test harness runs in
 * vitest's `environment: "node"`, no real `window`/`localStorage` at
 * all), so this file exercises the real read/write/defensive-parse
 * logic directly rather than mocking the module's own functions.
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

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_A = "user-a";
const USER_B = "user-b";
const SURFACE: TableColumnsSurface = "invoices";
const KNOWN = ["invoiceNumber", "project", "client", "amount", "status", "dueDate", "createdAt", "actions"];
const MANDATORY = ["invoiceNumber", "status", "actions"];

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

describe("buildTableColumnsStorageKey", () => {
  it("builds the exact documented key shape", () => {
    expect(buildTableColumnsStorageKey(ORG_A, USER_A, SURFACE)).toBe(
      `aqenra:table-columns:v1:${ORG_A}:${USER_A}:${SURFACE}`,
    );
  });

  it("produces distinct keys for distinct org/user/surface", () => {
    const keys = new Set([
      buildTableColumnsStorageKey(ORG_A, USER_A, SURFACE),
      buildTableColumnsStorageKey(ORG_B, USER_A, SURFACE),
      buildTableColumnsStorageKey(ORG_A, USER_B, SURFACE),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("parseTableColumnsStorage", () => {
  it("returns [] for null (missing key)", () => {
    expect(parseTableColumnsStorage(null)).toEqual([]);
  });

  it("returns [] for invalid JSON", () => {
    expect(parseTableColumnsStorage("{not json")).toEqual([]);
  });

  it("returns [] for a malformed root (array instead of object)", () => {
    expect(parseTableColumnsStorage("[]")).toEqual([]);
  });

  it("returns [] for a malformed root (primitive)", () => {
    expect(parseTableColumnsStorage('"hello"')).toEqual([]);
  });

  it("returns [] for the wrong version", () => {
    expect(parseTableColumnsStorage(JSON.stringify({ version: 2, hiddenIds: ["project"] }))).toEqual([]);
  });

  it("returns [] when hiddenIds is missing or not an array", () => {
    expect(parseTableColumnsStorage(JSON.stringify({ version: TABLE_COLUMNS_STORAGE_VERSION }))).toEqual([]);
    expect(
      parseTableColumnsStorage(JSON.stringify({ version: TABLE_COLUMNS_STORAGE_VERSION, hiddenIds: "project" })),
    ).toEqual([]);
  });

  it("parses a valid payload", () => {
    expect(
      parseTableColumnsStorage(JSON.stringify({ version: TABLE_COLUMNS_STORAGE_VERSION, hiddenIds: ["project", "amount"] })),
    ).toEqual(["project", "amount"]);
  });

  it("drops non-string entries individually rather than invalidating the whole array", () => {
    expect(
      parseTableColumnsStorage(
        JSON.stringify({ version: TABLE_COLUMNS_STORAGE_VERSION, hiddenIds: ["project", 42, null, "amount"] }),
      ),
    ).toEqual(["project", "amount"]);
  });
});

describe("readHiddenColumnIds / writeHiddenColumnIds", () => {
  it("round-trips a written value", () => {
    writeHiddenColumnIds(ORG_A, USER_A, SURFACE, ["project", "amount"]);
    expect(readHiddenColumnIds(ORG_A, USER_A, SURFACE)).toEqual(["project", "amount"]);
  });

  it("returns [] when nothing has been written yet", () => {
    expect(readHiddenColumnIds(ORG_A, USER_A, SURFACE)).toEqual([]);
  });

  it("isolates by organizationId", () => {
    writeHiddenColumnIds(ORG_A, USER_A, SURFACE, ["project"]);
    expect(readHiddenColumnIds(ORG_B, USER_A, SURFACE)).toEqual([]);
  });

  it("isolates by userId", () => {
    writeHiddenColumnIds(ORG_A, USER_A, SURFACE, ["project"]);
    expect(readHiddenColumnIds(ORG_A, USER_B, SURFACE)).toEqual([]);
  });

  it("returns [] when localStorage.getItem throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
      configurable: true,
    });
    expect(readHiddenColumnIds(ORG_A, USER_A, SURFACE)).toEqual([]);
  });

  it("reports write-failed when localStorage.setItem throws, without crashing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
      configurable: true,
    });
    expect(writeHiddenColumnIds(ORG_A, USER_A, SURFACE, ["project"])).toEqual({ ok: false, reason: "write-failed" });
  });

  it("reports ok:true on a successful write", () => {
    expect(writeHiddenColumnIds(ORG_A, USER_A, SURFACE, ["project"])).toEqual({ ok: true });
  });
});

describe("normalizeHiddenColumnIds", () => {
  it("returns an empty array unchanged", () => {
    expect(normalizeHiddenColumnIds([], KNOWN, MANDATORY)).toEqual([]);
  });

  it("preserves a valid optional hidden id", () => {
    expect(normalizeHiddenColumnIds(["project"], KNOWN, MANDATORY)).toEqual(["project"]);
  });

  it("drops an unknown id", () => {
    expect(normalizeHiddenColumnIds(["project", "notARealColumn"], KNOWN, MANDATORY)).toEqual(["project"]);
  });

  it("drops a mandatory id even if present in the raw stored array (hand-edited localStorage)", () => {
    expect(normalizeHiddenColumnIds(["invoiceNumber", "project"], KNOWN, MANDATORY)).toEqual(["project"]);
    expect(normalizeHiddenColumnIds(["status"], KNOWN, MANDATORY)).toEqual([]);
    expect(normalizeHiddenColumnIds(["actions"], KNOWN, MANDATORY)).toEqual([]);
  });

  it("de-duplicates ids", () => {
    expect(normalizeHiddenColumnIds(["project", "project", "amount"], KNOWN, MANDATORY)).toEqual(["project", "amount"]);
  });

  it("handles a combination of unknown + mandatory + duplicate + valid ids in one call", () => {
    expect(
      normalizeHiddenColumnIds(
        ["project", "bogus", "invoiceNumber", "project", "amount", "status"],
        KNOWN,
        MANDATORY,
      ),
    ).toEqual(["project", "amount"]);
  });

  it("reset/default state: normalizing [] always yields []", () => {
    expect(normalizeHiddenColumnIds([], KNOWN, MANDATORY)).toEqual([]);
  });
});
