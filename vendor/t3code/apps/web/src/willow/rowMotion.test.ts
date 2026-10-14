import { describe, expect, it, vi } from "vite-plus/test";

import { createRowMotionStore, takeArrivedRowIds } from "./rowMotion";

describe("takeArrivedRowIds", () => {
  it("counts rows after a known one as arrived and remembers them", () => {
    const known = new Set(["user", "reply"]);
    expect(takeArrivedRowIds(["user", "reply", "work", "answer"], known)).toEqual([
      "work",
      "answer",
    ]);
    expect([...known]).toEqual(["user", "reply", "work", "answer"]);
    // Seen once, a row never arrives again, however often the list remounts it.
    expect(takeArrivedRowIds(["user", "reply", "work", "answer"], known)).toEqual([]);
  });

  it("takes rows above every known one for history loading in", () => {
    const known = new Set(["latest"]);
    expect(takeArrivedRowIds(["older", "old", "latest", "new"], known)).toEqual(["new"]);
    expect(known.has("older")).toBe(true);
  });

  it("finds nothing arriving in a list it knew nothing of", () => {
    const known = new Set<string>();
    expect(takeArrivedRowIds(["a", "b"], known)).toEqual([]);
    expect(known.size).toBe(2);
  });
});

describe("createRowMotionStore", () => {
  it("flags rows, clears them, and tells its subscribers", () => {
    const store = createRowMotionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(["a", "b"], "fold-exit");
    expect(store.get("a")).toBe("fold-exit");
    expect(store.get("b")).toBe("fold-exit");
    store.set(["a"], undefined);
    expect(store.get("a")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.set(["b"], undefined);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
