import { useEffect, useState } from "react";

/*
 * A streaming reply's words arrive as Willow's do (platform/ui StreamingMarkdown, `smd-w`): each
 * new word fades in, 610ms ease-out from 150ms after it lands (markdown.css). Only words still
 * fading are elements; the rest stay text. Each fading word is its own element name, so
 * react-markdown's sibling keys (`name-count`) keep pointing at the same word while older words
 * return to text, and a word the markdown rebuilds under a new parent after it has faded in (a
 * closing `**`, a link's `)`) does not fade in twice.
 */
export const STREAM_WORD_SETTLE_MS = 150 + 610;

/** Where words are left alone: code, links and summaries (their renderers read the text), media. */
const UNWRAPPED_TAGS = new Set([
  "a",
  "code",
  "pre",
  "kbd",
  "samp",
  "summary",
  "svg",
  "math",
  "script",
  "style",
]);

interface TextNode {
  type: "text";
  value: string;
  position?: { start?: { offset?: number } };
}

interface ParentNode {
  type: string;
  tagName?: string;
  children: Node[];
}

interface ElementNode extends ParentNode {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
}

type Node = TextNode | ParentNode | { type: string };

const isText = (node: Node): node is TextNode => node.type === "text";
const isParent = (node: Node): node is ParentNode =>
  "children" in node && Array.isArray(node.children);

function wrapWords(parent: ParentNode, firstSeen: Map<number, number>, now: number) {
  const children: Node[] = [];
  let text = "";
  const flush = () => {
    if (text) children.push({ type: "text", value: text });
    text = "";
  };
  for (const child of parent.children) {
    if (!isText(child)) {
      flush();
      if (isParent(child) && !UNWRAPPED_TAGS.has(child.tagName ?? "")) {
        wrapWords(child, firstSeen, now);
      }
      children.push(child);
      continue;
    }
    const start = child.position?.start?.offset;
    if (start === undefined) {
      text += child.value;
      continue;
    }
    let end = 0;
    const words = /\S+/g;
    for (let word = words.exec(child.value); word; word = words.exec(child.value)) {
      const offset = start + word.index;
      const seenAt = firstSeen.get(offset);
      if (seenAt === undefined) firstSeen.set(offset, now);
      else if (now - seenAt > STREAM_WORD_SETTLE_MS) continue;
      text += child.value.slice(end, word.index);
      flush();
      const element: ElementNode = {
        type: "element",
        tagName: `willow-w-${offset}`,
        properties: { className: ["willow-stream-word"] },
        children: [{ type: "text", value: word[0] }],
      };
      children.push(element);
      end = word.index + word[0].length;
    }
    text += child.value.slice(end);
  }
  flush();
  parent.children = children;
}

function createStreamWordsPlugin() {
  const firstSeen = new Map<number, number>();
  let previousSource = "";
  return function willowStreamWords() {
    return (tree: unknown, file: { value?: unknown }) => {
      const source = typeof file.value === "string" ? file.value : "";
      // A reply that was replaced rather than extended starts its words afresh.
      if (!source.startsWith(previousSource)) firstSeen.clear();
      previousSource = source;
      wrapWords(tree as ParentNode, firstSeen, performance.now());
    };
  };
}

/** The plugin while `streaming`, and until its last words have faded in. */
export function useStreamWordsPlugin(streaming: boolean) {
  const [plugin] = useState(createStreamWordsPlugin);
  const [lingering, setLingering] = useState(streaming);
  if (streaming && !lingering) setLingering(true);
  useEffect(() => {
    if (streaming || !lingering) return;
    const timer = setTimeout(() => setLingering(false), STREAM_WORD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [streaming, lingering]);
  return streaming || lingering ? plugin : null;
}
