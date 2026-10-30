import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FEEDBACK_WIDGET_POSITION_KEY,
  getStoredPositionServerSnapshot,
  getStoredPositionSnapshot,
  parseStoredPosition,
  readStoredPosition,
  rememberPosition,
  resetStoredPositionCacheForTests,
  serializePosition,
  writeStoredPosition,
} from "@/components/feedback-widget/position-storage";

type FakeStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> };

function installStorage(overrides: Partial<FakeStorage> = {}): FakeStorage {
  const data = new Map<string, string>();
  const storage: FakeStorage = {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    ...overrides,
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  return storage;
}

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeEach(() => resetStoredPositionCacheForTests());
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("parseStoredPosition", () => {
  it("accepts a well-formed position", () => {
    expect(parseStoredPosition('{"version":1,"right":24,"bottom":88}')).toEqual({ right: 24, bottom: 88 });
  });

  it.each([
    ["nothing stored", null],
    ["empty string", ""],
    ["not JSON", "not json"],
    ["a JSON scalar", "42"],
    ["JSON null", "null"],
    ["wrong version", '{"version":2,"right":24,"bottom":88}'],
    ["missing version", '{"right":24,"bottom":88}'],
    ["missing coordinate", '{"version":1,"right":24}'],
    ["string coordinate", '{"version":1,"right":"24","bottom":88}'],
    ["negative coordinate", '{"version":1,"right":-1,"bottom":88}'],
    ["absurdly large coordinate", '{"version":1,"right":99999,"bottom":88}'],
    ["null coordinate", '{"version":1,"right":null,"bottom":88}'],
  ])("treats %s as no stored position", (_label, raw) => {
    expect(parseStoredPosition(raw)).toBeNull();
  });

  it("ignores extra keys rather than carrying them forward", () => {
    expect(parseStoredPosition('{"version":1,"right":1,"bottom":2,"email":"a@b.c"}')).toEqual({ right: 1, bottom: 2 });
  });
});

describe("serializePosition", () => {
  it("writes only a version and the two coordinates, rounded", () => {
    const parsed = JSON.parse(serializePosition({ right: 24.4, bottom: 88.6 }));
    expect(Object.keys(parsed).sort()).toEqual(["bottom", "right", "version"]);
    expect(parsed).toEqual({ version: 1, right: 24, bottom: 89 });
  });
});

describe("read / write against browser storage", () => {
  it("round-trips a position under the documented key", () => {
    const storage = installStorage();
    expect(writeStoredPosition({ right: 40, bottom: 120 })).toBe(true);
    expect(storage.data.has(FEEDBACK_WIDGET_POSITION_KEY)).toBe(true);
    expect(readStoredPosition()).toEqual({ right: 40, bottom: 120 });
  });

  it("stores nothing but the position", () => {
    const storage = installStorage();
    writeStoredPosition({ right: 1, bottom: 2 });
    expect([...storage.data.keys()]).toEqual([FEEDBACK_WIDGET_POSITION_KEY]);
  });

  it("a blocked or throwing storage reads as 'nothing stored' and a write reports failure instead of throwing", () => {
    installStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(readStoredPosition()).toBeNull();
    expect(writeStoredPosition({ right: 1, bottom: 2 })).toBe(false);
  });

  it("with no localStorage at all (SSR) reads as nothing stored", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    expect(readStoredPosition()).toBeNull();
    expect(writeStoredPosition({ right: 1, bottom: 2 })).toBe(false);
  });
});

describe("useSyncExternalStore snapshots", () => {
  it("the server snapshot is always null so hydration matches the server markup", () => {
    installStorage();
    writeStoredPosition({ right: 40, bottom: 120 });
    expect(getStoredPositionServerSnapshot()).toBeNull();
  });

  it("the client snapshot is read once and stays referentially stable across renders", () => {
    installStorage();
    writeStoredPosition({ right: 40, bottom: 120 });
    const first = getStoredPositionSnapshot();
    expect(first).toEqual({ right: 40, bottom: 120 });
    expect(getStoredPositionSnapshot()).toBe(first);
  });

  it("rememberPosition updates the snapshot and persists", () => {
    const storage = installStorage();
    rememberPosition({ right: 10.2, bottom: 20.7 });
    expect(getStoredPositionSnapshot()).toEqual({ right: 10, bottom: 21 });
    expect(parseStoredPosition(storage.data.get(FEEDBACK_WIDGET_POSITION_KEY) ?? null)).toEqual({ right: 10, bottom: 21 });
  });
});
