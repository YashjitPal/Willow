import { describe, expect, it, vi } from "vite-plus/test";

import { arrivedRowIds, createRowMotionStore, cubicBezier, leftRowBlocks } from "./rowMotion";

describe("arrivedRowIds", () => {
  it("counts rows after one the last render had", () => {
    expect(arrivedRowIds(["user", "reply", "work", "answer"], new Set(["user", "reply"]))).toEqual([
      "work",
      "answer",
    ]);
  });

  it("counts a row coming back, as a live row does each time it shows", () => {
    expect(arrivedRowIds(["user", "live"], new Set(["user"]))).toEqual(["live"]);
  });

  it("takes rows above every row it had for history loading in", () => {
    expect(arrivedRowIds(["older", "old", "latest", "new"], new Set(["latest"]))).toEqual(["new"]);
  });

  it("finds nothing arriving in a list it knew nothing of", () => {
    expect(arrivedRowIds(["a", "b"], new Set())).toEqual([]);
  });
});

describe("leftRowBlocks", () => {
  const rows = ["fold", "a", "b", "answer", "c"].map((id) => ({ id }));

  it("groups the rows that left by the rows around them", () => {
    expect(leftRowBlocks(rows, new Set(["fold", "answer"]))).toEqual([
      { rows: [{ id: "a" }, { id: "b" }], afterId: "fold", beforeId: "answer" },
      { rows: [{ id: "c" }], afterId: "answer", beforeId: null },
    ]);
  });

  it("finds nothing when every row stays", () => {
    expect(leftRowBlocks(rows, new Set(rows.map((row) => row.id)))).toEqual([]);
  });
});

describe("cubicBezier", () => {
  it("follows Codex's enter curve, quick out of the start and long into the end", () => {
    const ease = cubicBezier(0.19, 1, 0.22, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.25)).toBeGreaterThan(0.6);
    expect(ease(0.5)).toBeGreaterThan(ease(0.25));
    expect(ease(0.75)).toBeLessThanOrEqual(1);
  });

  it("is the identity on the linear curve", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
    expect(linear(0.8)).toBeCloseTo(0.8, 4);
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
