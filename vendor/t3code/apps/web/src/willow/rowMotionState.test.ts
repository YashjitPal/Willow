import { describe, expect, it } from "vite-plus/test";

import { GROUP_TOGGLE, TURN_FOLD_CLOSE, TURN_FOLD_OPEN } from "./rowMotion";
import { initialRowMotionState, nextRowMotionState, withGhostRows } from "./rowMotionState";

const row = (id: string, kind = "work") => ({ id, kind });
const ids = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map((each) => each.id);

describe("nextRowMotionState", () => {
  it("fades in a row that arrives while the turn runs", () => {
    const start = initialRowMotionState("thread", [row("user", "message")], null);
    const next = nextRowMotionState(start, [row("user", "message"), row("read")], "thread", null);
    expect(next.change?.arrived).toEqual(["read"]);
    expect(next.change?.left).toEqual([]);
  });

  it("grows the rows a disclosure opens instead of fading them", () => {
    const start = initialRowMotionState("thread", [row("fold", "turn-fold"), row("answer")], null);
    const next = nextRowMotionState(
      start,
      [row("fold", "turn-fold"), row("read"), row("edit"), row("answer")],
      "thread",
      { serial: 1, kind: "open", preset: TURN_FOLD_OPEN },
    );
    expect(next.change?.arrived).toEqual([]);
    expect(next.change?.opened).toEqual({ rowIds: ["read", "edit"], preset: TURN_FOLD_OPEN });
  });

  it("keeps the rows a closing disclosure hides as ghosts, back where they were", () => {
    const open = [row("fold", "turn-fold"), row("read"), row("edit"), row("answer")];
    const start = initialRowMotionState("thread", open, null);
    const closed = [row("fold", "turn-fold"), row("answer")];
    const next = nextRowMotionState(start, closed, "thread", {
      serial: 1,
      kind: "close",
      preset: GROUP_TOGGLE,
    });
    expect(next.change?.left.map((block) => ids(block.rows))).toEqual([["read", "edit"]]);
    expect(next.change?.left[0]?.preset).toBe(GROUP_TOGGLE);
    expect(ids(withGhostRows(closed, next.ghosts))).toEqual(["fold", "read", "edit", "answer"]);
  });

  it("folds a settling turn's work away under its new Worked for, which does not fade", () => {
    const live = [
      row("user", "message"),
      row("working-indicator-row", "working"),
      row("read"),
      row("answer", "message"),
    ];
    const start = initialRowMotionState("thread", live, null);
    const settled = [row("user", "message"), row("turn-fold:run", "turn-fold"), row("answer")];
    const next = nextRowMotionState(start, settled, "thread", null);
    expect(next.change?.arrived).toEqual([]);
    expect(next.change?.left.map((block) => ids(block.rows))).toEqual([["read"]]);
    expect(next.change?.left[0]?.preset).toBe(TURN_FOLD_CLOSE);
    expect(ids(withGhostRows(settled, next.ghosts))).toEqual([
      "user",
      "turn-fold:run",
      "read",
      "answer",
    ]);
  });

  it("uses a toggle's motion once, and lets rows coming back stop leaving", () => {
    const open = [row("fold", "turn-fold"), row("read"), row("answer")];
    const close = { serial: 1, kind: "close" as const, preset: TURN_FOLD_CLOSE };
    const closed = nextRowMotionState(
      initialRowMotionState("thread", open, null),
      [row("fold", "turn-fold"), row("answer")],
      "thread",
      close,
    );
    const reopened = nextRowMotionState(closed, open, "thread", {
      serial: 2,
      kind: "open",
      preset: TURN_FOLD_OPEN,
    });
    expect(reopened.ghosts).toEqual([]);
    expect(reopened.change?.opened?.rowIds).toEqual(["read"]);
    // The same toggle seen again is not a second close.
    const again = nextRowMotionState(reopened, [row("fold", "turn-fold")], "thread", close);
    expect(again.change?.left).toEqual([]);
  });

  it("starts afresh in another thread", () => {
    const start = initialRowMotionState("one", [row("user", "message")], null);
    const next = nextRowMotionState(start, [row("other", "message")], "two", null);
    expect(next.change).toBeNull();
    expect(next.ghosts).toEqual([]);
  });
});
