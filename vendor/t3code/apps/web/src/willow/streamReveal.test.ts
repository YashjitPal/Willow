import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  nextStreamingRevealDelayMs,
  nextStreamingRevealLength,
  reconcileStreamingReveal,
  useStreamReveal,
} from "./streamReveal";

describe("useStreamReveal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const renderReveal = async (text: string, streaming: boolean) => {
    const seen: string[] = [];
    function Probe(props: { text: string; streaming: boolean }) {
      const { shown, revealing } = useStreamReveal(props.text, props.streaming);
      seen.push(`${revealing ? "revealing" : "settled"}:${shown}`);
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(createElement(Probe, { text, streaming }));
    });
    const update = (next: string, nextStreaming: boolean) =>
      act(async () => {
        renderer?.update(createElement(Probe, { text: next, streaming: nextStreaming }));
      });
    return { seen, update };
  };

  it("shows a streaming reply a sentence at a time, then catches up once it ends", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", {});
    vi.useFakeTimers();
    const { seen, update } = await renderReveal("", true);
    await update("One sentence. Two arrives", true);
    expect(seen.at(-1)).toBe("revealing:");
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(seen.at(-1)).toBe("revealing:One sentence. ");
    await update("One sentence. Two arrives", false);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(seen.at(-1)).toBe("settled:One sentence. Two arrives");
  });

  it("shows what a reply already had when its row mounts", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", {});
    const { seen } = await renderReveal("Already here. And more", true);
    expect(seen.at(-1)).toBe("revealing:Already here. And more");
  });
});

const nextStep = (source: string, visible: string) =>
  source.slice(0, nextStreamingRevealLength(source, visible.length));

describe("a streaming reply's reveal", () => {
  it("shows a whole sentence once one has arrived", () => {
    expect(nextStep("First sentence here. Second one is still", "")).toBe("First sentence here. ");
    expect(nextStep("One.\n\nTwo is on its way", "")).toBe("One.\n\n");
  });

  it("shows a few words of a sentence still arriving, more the longer the backlog", () => {
    expect(nextStep("words keep coming without any end yet", "")).toBe(
      "words keep coming without ",
    );
    expect(nextStep("two words", "")).toBe("two words");
    const backlog = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
    expect(nextStep(backlog, "").split(" ").filter(Boolean)).toHaveLength(12);
  });

  it("goes on from what is shown", () => {
    const source = "Shown already. Next sentence. Then more";
    expect(nextStep(source, "Shown already. ")).toBe("Shown already. Next sentence. ");
    expect(nextStep(source, source)).toBe(source);
  });

  it("waits 50 to 320ms, longer the more a step adds", () => {
    expect(nextStreamingRevealDelayMs("Hi.", 0)).toBe(50);
    expect(nextStreamingRevealDelayMs("First sentence here. Second", 0)).toBe(70);
    expect(nextStreamingRevealDelayMs(`${"long ".repeat(200)}.`, 0)).toBe(320);
  });

  it("keeps what is shown while the reply grows and starts over when it is replaced", () => {
    expect(reconcileStreamingReveal("Hello", "Hello world")).toBe("Hello");
    expect(reconcileStreamingReveal("Hello world", "Hello")).toBe("Hello");
    expect(reconcileStreamingReveal("Hello", "Goodbye")).toBe("");
  });
});
