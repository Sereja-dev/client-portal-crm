import { describe, expect, it, beforeEach } from "vitest";
import {
  buildSavedViewsStorageKey,
  parseSavedViewsStorage,
  readSavedViews,
  saveNewSavedView,
  renameSavedView,
  deleteSavedView,
  isValidSavedViewName,
  normalizeSavedViewName,
  SAVED_VIEWS_MAX_PER_SCOPE,
  SAVED_VIEW_NAME_MAX_LENGTH,
  SAVED_VIEWS_STORAGE_VERSION,
  type SavedView,
} from "@/lib/saved-views/storage";

/**
 * Tables Improvement Slice D1 — focused coverage for the one module that
 * owns the entire Saved Views storage contract. This repo's vitest
 * config runs unit tests under `environment: "node"` (no jsdom) — there
 * is no real browser `localStorage` global here, so each test installs
 * its own minimal in-memory stand-in on `globalThis.localStorage`
 * (restored fresh in `beforeEach`), matching this module's own
 * documented contract exactly (`getItem`/`setItem`, nothing else
 * assumed) rather than reaching for a dependency this repo doesn't use.
 */

class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

let fakeStorage: FakeLocalStorage;

beforeEach(() => {
  fakeStorage = new FakeLocalStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: fakeStorage,
    configurable: true,
    writable: true,
  });
});

const ORG = "org-1";
const USER = "user-1";

describe("buildSavedViewsStorageKey", () => {
  it("is deterministic -- the same inputs always produce the same key", () => {
    expect(buildSavedViewsStorageKey(ORG, USER, "invoices")).toBe(buildSavedViewsStorageKey(ORG, USER, "invoices"));
  });

  it("includes organization identity -- two different orgs never collide", () => {
    expect(buildSavedViewsStorageKey("org-a", USER, "invoices")).not.toBe(buildSavedViewsStorageKey("org-b", USER, "invoices"));
  });

  it("includes user identity -- two different users never collide", () => {
    expect(buildSavedViewsStorageKey(ORG, "user-a", "invoices")).not.toBe(buildSavedViewsStorageKey(ORG, "user-b", "invoices"));
  });

  it("includes surface identity -- invoices and contracts never collide, even for the same org/user", () => {
    expect(buildSavedViewsStorageKey(ORG, USER, "invoices")).not.toBe(buildSavedViewsStorageKey(ORG, USER, "contracts"));
  });

  it("carries the format version in the key itself", () => {
    expect(buildSavedViewsStorageKey(ORG, USER, "invoices")).toContain(`v${SAVED_VIEWS_STORAGE_VERSION}`);
  });
});

describe("parseSavedViewsStorage -- defensive parse", () => {
  it("missing key (null) -> []", () => {
    expect(parseSavedViewsStorage(null)).toEqual([]);
  });

  it("corrupted JSON -> []", () => {
    expect(parseSavedViewsStorage("{not valid json")).toEqual([]);
  });

  it("unsupported version -> []", () => {
    expect(parseSavedViewsStorage(JSON.stringify({ version: 2, views: [] }))).toEqual([]);
  });

  it("malformed root (a bare array, not {version, views}) -> []", () => {
    expect(parseSavedViewsStorage(JSON.stringify([{ id: "1" }]))).toEqual([]);
  });

  it("malformed root (views is not an array) -> []", () => {
    expect(parseSavedViewsStorage(JSON.stringify({ version: 1, views: "nope" }))).toEqual([]);
  });

  it("a malformed INDIVIDUAL entry is skipped, not fatal to the whole list", () => {
    const valid: SavedView = { id: "v1", name: "Good view", params: { q: "acme" }, createdAt: "2026-01-01T00:00:00.000Z" };
    const raw = JSON.stringify({
      version: 1,
      views: [valid, { id: "v2" /* missing name/params/createdAt */ }, { not: "even close" }],
    });
    expect(parseSavedViewsStorage(raw)).toEqual([valid]);
  });

  it("an entry whose params contains a non-string value is skipped", () => {
    const raw = JSON.stringify({
      version: 1,
      views: [{ id: "v1", name: "Bad params", params: { q: 123 }, createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    expect(parseSavedViewsStorage(raw)).toEqual([]);
  });
});

describe("readSavedViews", () => {
  it("returns [] when nothing has ever been saved for this scope", () => {
    expect(readSavedViews(ORG, USER, "invoices")).toEqual([]);
  });

  it("a localStorage read failure (getItem throws) is handled -- returns [] rather than throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      },
      configurable: true,
      writable: true,
    });
    expect(() => readSavedViews(ORG, USER, "invoices")).not.toThrow();
    expect(readSavedViews(ORG, USER, "invoices")).toEqual([]);
  });
});

describe("saveNewSavedView", () => {
  it("name is trimmed before being stored", () => {
    const result = saveNewSavedView(ORG, USER, "invoices", "  Overdue clients  ", { status: "OVERDUE" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created.name).toBe("Overdue clients");
  });

  it("empty name (after trim) is rejected", () => {
    const result = saveNewSavedView(ORG, USER, "invoices", "   ", {});
    expect(result).toEqual({ ok: false, reason: "invalid-name" });
  });

  it("a name over 60 characters is rejected", () => {
    const result = saveNewSavedView(ORG, USER, "invoices", "x".repeat(61), {});
    expect(result).toEqual({ ok: false, reason: "invalid-name" });
  });

  it("a name of exactly 60 characters is accepted (boundary)", () => {
    const result = saveNewSavedView(ORG, USER, "invoices", "x".repeat(60), {});
    expect(result.ok).toBe(true);
  });

  it("duplicate names are allowed -- views are identified by id, never name", () => {
    const first = saveNewSavedView(ORG, USER, "invoices", "My view", { q: "a" });
    const second = saveNewSavedView(ORG, USER, "invoices", "My view", { q: "b" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.created.id).not.toBe(second.created.id);
      expect(readSavedViews(ORG, USER, "invoices")).toHaveLength(2);
    }
  });

  it("valid 20th view is accepted", () => {
    for (let i = 0; i < 19; i++) {
      saveNewSavedView(ORG, USER, "invoices", `View ${i}`, {});
    }
    const result = saveNewSavedView(ORG, USER, "invoices", "View 19", {});
    expect(result.ok).toBe(true);
    expect(readSavedViews(ORG, USER, "invoices")).toHaveLength(20);
  });

  it("21st view is rejected without overwriting any existing view", () => {
    for (let i = 0; i < SAVED_VIEWS_MAX_PER_SCOPE; i++) {
      saveNewSavedView(ORG, USER, "invoices", `View ${i}`, {});
    }
    const before = readSavedViews(ORG, USER, "invoices");
    const result = saveNewSavedView(ORG, USER, "invoices", "One too many", {});
    expect(result).toEqual({ ok: false, reason: "limit-reached" });
    expect(readSavedViews(ORG, USER, "invoices")).toEqual(before);
  });

  it("a localStorage write failure is handled -- returns write-failed, never throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("quota", "QuotaExceededError");
        },
      },
      configurable: true,
      writable: true,
    });
    expect(() => saveNewSavedView(ORG, USER, "invoices", "Won't persist", {})).not.toThrow();
    expect(saveNewSavedView(ORG, USER, "invoices", "Won't persist", {})).toEqual({ ok: false, reason: "write-failed" });
  });

  it("params are stored verbatim, including an already-stale value (e.g. a foreign-org Contract client id) -- never dropped or rewritten", () => {
    const result = saveNewSavedView(ORG, USER, "contracts", "Stale client view", { client: "00000000-0000-0000-0000-000000000000" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created.params).toEqual({ client: "00000000-0000-0000-0000-000000000000" });
  });
});

describe("renameSavedView", () => {
  it("preserves id, params, and createdAt -- only name changes", () => {
    const created = saveNewSavedView(ORG, USER, "invoices", "Original", { q: "acme" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = created.created;

    const renamed = renameSavedView(ORG, USER, "invoices", before.id, "  Renamed  ");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const after = renamed.views.find((v) => v.id === before.id);
    expect(after).toEqual({ ...before, name: "Renamed" });
  });

  it("empty name (after trim) is rejected", () => {
    const created = saveNewSavedView(ORG, USER, "invoices", "Original", {});
    if (!created.ok) throw new Error("setup failed");
    const result = renameSavedView(ORG, USER, "invoices", created.created.id, "   ");
    expect(result).toEqual({ ok: false, reason: "invalid-name" });
  });

  it("name over 60 characters is rejected", () => {
    const created = saveNewSavedView(ORG, USER, "invoices", "Original", {});
    if (!created.ok) throw new Error("setup failed");
    const result = renameSavedView(ORG, USER, "invoices", created.created.id, "x".repeat(61));
    expect(result).toEqual({ ok: false, reason: "invalid-name" });
  });

  it("renaming a nonexistent id fails with not-found, without touching storage", () => {
    saveNewSavedView(ORG, USER, "invoices", "Real view", {});
    const before = readSavedViews(ORG, USER, "invoices");
    const result = renameSavedView(ORG, USER, "invoices", "nonexistent-id", "New name");
    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(readSavedViews(ORG, USER, "invoices")).toEqual(before);
  });

  it("duplicate names remain allowed after a rename", () => {
    const a = saveNewSavedView(ORG, USER, "invoices", "A", {});
    saveNewSavedView(ORG, USER, "invoices", "B", {});
    if (!a.ok) throw new Error("setup failed");
    const result = renameSavedView(ORG, USER, "invoices", a.created.id, "B");
    expect(result.ok).toBe(true);
  });
});

describe("deleteSavedView", () => {
  it("removes only the selected id, leaving every other view byte-identical", () => {
    const a = saveNewSavedView(ORG, USER, "invoices", "A", { q: "a" });
    const b = saveNewSavedView(ORG, USER, "invoices", "B", { q: "b" });
    if (!a.ok || !b.ok) throw new Error("setup failed");

    const result = deleteSavedView(ORG, USER, "invoices", a.created.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.views).toEqual([b.created]);
  });

  it("deleting a nonexistent id is a no-op success, not an error", () => {
    saveNewSavedView(ORG, USER, "invoices", "A", {});
    const before = readSavedViews(ORG, USER, "invoices");
    const result = deleteSavedView(ORG, USER, "invoices", "nonexistent-id");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.views).toEqual(before);
  });

  it("a localStorage write failure during delete is handled -- returns write-failed, never throws", () => {
    const a = saveNewSavedView(ORG, USER, "invoices", "A", {});
    if (!a.ok) throw new Error("setup failed");
    const realSetItem = fakeStorage.setItem.bind(fakeStorage);
    fakeStorage.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(() => deleteSavedView(ORG, USER, "invoices", a.created.id)).not.toThrow();
    expect(deleteSavedView(ORG, USER, "invoices", a.created.id)).toEqual({ ok: false, reason: "write-failed" });
    fakeStorage.setItem = realSetItem;
  });
});

describe("normalizeSavedViewName / isValidSavedViewName", () => {
  it("trims leading/trailing whitespace", () => {
    expect(normalizeSavedViewName("  hello  ")).toBe("hello");
  });

  it("a whitespace-only name normalizes to empty and is invalid", () => {
    expect(isValidSavedViewName(normalizeSavedViewName("   "))).toBe(false);
  });

  it("accepts a name right at the max length", () => {
    expect(isValidSavedViewName("x".repeat(SAVED_VIEW_NAME_MAX_LENGTH))).toBe(true);
  });

  it("rejects one character past the max length", () => {
    expect(isValidSavedViewName("x".repeat(SAVED_VIEW_NAME_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("namespace isolation at the data layer", () => {
  it("a view saved under one user is invisible under a different user in the same org/surface", () => {
    saveNewSavedView(ORG, "user-a", "invoices", "User A's view", {});
    expect(readSavedViews(ORG, "user-b", "invoices")).toEqual([]);
    expect(readSavedViews(ORG, "user-a", "invoices")).toHaveLength(1);
  });

  it("a view saved under one organization is invisible under a different organization for the same user/surface", () => {
    saveNewSavedView("org-a", USER, "invoices", "Org A's view", {});
    expect(readSavedViews("org-b", USER, "invoices")).toEqual([]);
    expect(readSavedViews("org-a", USER, "invoices")).toHaveLength(1);
  });

  it("a view saved under one surface is invisible under the other surface for the same org/user", () => {
    saveNewSavedView(ORG, USER, "invoices", "Invoice view", {});
    expect(readSavedViews(ORG, USER, "contracts")).toEqual([]);
    expect(readSavedViews(ORG, USER, "invoices")).toHaveLength(1);
  });
});
