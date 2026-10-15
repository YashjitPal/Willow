import { describe, expect, it } from "vite-plus/test";

import { createStreamWords } from "./streamWords";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: { offset: number } };
};

const text = (value: string, offset: number): HastNode => ({
  type: "text",
  value,
  position: { start: { offset } },
});
const element = (tagName: string, offset: number, children: HastNode[]): HastNode => ({
  type: "element",
  tagName,
  properties: {},
  children,
  position: { start: { offset } },
});
const root = (...children: HastNode[]): HastNode => ({ type: "root", children });

/**
 * Each fading word, with the delay it was given (none means Willow's base 150ms); inline code or
 * a link fading as one shows as its tag.
 */
function fadingWords(node: HastNode, found: string[] = []): string[] {
  for (const child of node.children ?? []) {
    const className = child.properties?.className;
    if (Array.isArray(className) && className.includes("willow-stream-word")) {
      const style = child.properties?.style;
      const inner = child.children?.[0];
      found.push(
        `${inner?.value ?? `<${inner?.tagName}>`}${typeof style === "string" ? ` (${style})` : ""}`,
      );
    } else {
      fadingWords(child, found);
    }
  }
  return found;
}

const twoItems = () =>
  root(
    element("ul", 0, [
      element("li", 0, [element("p", 2, [text("one two", 2)])]),
      element("li", 10, [element("p", 12, [text("three", 12)])]),
    ]),
  );

describe("createStreamWords", () => {
  it("staggers blocks that begin together by 120ms, a list item's paragraph with it", () => {
    const words = createStreamWords();
    const tree = twoItems();
    words.transform(tree, "- one two\n- three", 1000);
    expect(fadingWords(tree)).toEqual(["one", "two", "three (animation-delay: 270ms)"]);
  });

  it("keeps a block's delay for later words, and starts the next step's blocks at 150ms", () => {
    const words = createStreamWords();
    words.transform(twoItems(), "- one two\n- three", 1000);
    const later = root(
      element("ul", 0, [
        element("li", 0, [element("p", 2, [text("one two", 2)])]),
        element("li", 10, [element("p", 12, [text("three four", 12)])]),
        element("li", 23, [element("p", 25, [text("five", 25)])]),
      ]),
    );
    words.transform(later, "- one two\n- three four\n- five", 1100);
    expect(fadingWords(later)).toEqual([
      "one",
      "two",
      "three (animation-delay: 270ms)",
      "four (animation-delay: 270ms)",
      "five",
    ]);
  });

  it("gives a code block its turn though its words are left alone", () => {
    const words = createStreamWords();
    const tree = root(
      element("p", 0, [text("Run it:", 0)]),
      element("pre", 9, [element("code", 9, [text("npm test", 13)])]),
      element("p", 27, [text("Done.", 27)]),
    );
    words.transform(tree, "Run it:\n\n```\nnpm test\n```\n\nDone.", 1000);
    expect(fadingWords(tree)).toEqual(["Run", "it:", "Done. (animation-delay: 390ms)"]);
  });

  it("fades inline code and a link as one word, leaving their insides to their renderers", () => {
    const words = createStreamWords();
    const tree = root(
      element("p", 0, [
        text("Run ", 0),
        element("code", 4, [text("npm test", 5)]),
        text(" or read ", 14),
        element("a", 23, [text("the docs", 24)]),
      ]),
    );
    words.transform(tree, "Run `npm test` or read [the docs](https://nodejs.org)", 1000);
    expect(fadingWords(tree)).toEqual(["Run", "<code>", "or", "read", "<a>"]);
  });

  it("does not fade a shown word again when the markdown rebuilds it", () => {
    const words = createStreamWords();
    // "**Ada" is text until its closer arrives, then strong, its word now at 5 rather than 3.
    words.transform(root(element("p", 0, [text("Hi **Ada", 0)])), "Hi **Ada", 1000);
    const later = root(
      element("p", 0, [text("Hi ", 0), element("strong", 3, [text("Ada", 5)]), text(" there", 10)]),
    );
    words.transform(later, "Hi **Ada** there", 1100);
    expect(fadingWords(later)).toEqual(["Hi", "there"]);
  });

  it("gives a new list item's marker its words' delay, then lets it go", () => {
    const words = createStreamWords();
    const tree = twoItems();
    words.transform(tree, "- one two\n- three", 1000);
    const items = (node: HastNode) => node.children?.[0]?.children ?? [];
    expect(items(tree).map((item) => item.properties?.style)).toEqual([
      "--willow-stream-delay: 150ms",
      "--willow-stream-delay: 270ms",
    ]);
    const later = twoItems();
    words.transform(later, "- one two\n- three", 2000);
    expect(items(later).map((item) => item.properties?.dataWillowStreamItem)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("returns faded words to text and waits for the last one to finish", () => {
    const words = createStreamWords();
    words.transform(twoItems(), "- one two\n- three", 1000);
    expect(words.settleIn(1000)).toBe(270 + 610);

    // 150 + 610ms in, the first item has faded in and the second, 120ms behind, has not.
    const later = twoItems();
    words.transform(later, "- one two\n- three", 1000 + 761);
    expect(fadingWords(later)).toEqual(["three (animation-delay: 270ms)"]);
    expect(words.settleIn(1000 + 880)).toBe(0);
  });
});
