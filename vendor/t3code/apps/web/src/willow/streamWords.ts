import { useEffect, useState } from "react";

/*
 * A streaming reply's words arrive as Willow's do (platform/ui StreamingMarkdown, `smd-w`): each
 * new word fades in over 610ms ease-out (markdown.css), 150ms after its block began. Blocks that
 * begin in the same reveal step take turns 120ms apart in document order, and a block keeps its
 * delay for the words that join it later (streaming-text-reveal's geminiRevealTimingAt and
 * StreamingMarkdown's nextRevealBlockTiming): a paragraph, heading, code block, table or quote,
 * and every list item, whose own paragraphs share its turn. Only words still fading are
 * elements; the rest stay text. Each fading word is its own element name, so react-markdown's
 * sibling keys (`name-count`) keep pointing at the same word while older words return to text,
 * and a word the markdown rebuilds under a new parent after it has faded in (a closing `**`, a
 * link's `)`) does not fade in twice.
 */
const WORD_FADE_MS = 610;
const BLOCK_DELAY_MS = 150;
const BLOCK_STAGGER_MS = 120;

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

/** Blocks with a turn of their own outside a list item; inside one they share its turn. */
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table", "blockquote"]);

interface TextNode {
  type: "text";
  value: string;
  position?: { start?: { offset?: number } };
}

interface ParentNode {
  type: string;
  tagName?: string;
  children: Node[];
  position?: { start?: { offset?: number } };
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

interface RevealState {
  /** When each word, by its offset in the reply, was first painted. */
  readonly firstSeen: Map<number, number>;
  /** Each block's delay, by the offset it starts at, fixed when it began. */
  readonly blockDelay: Map<number, number>;
  /** What the previous render showed: blocks starting before it are not new. */
  settledBefore: number;
  /** When the last fading word is done. */
  settleBy: number;
}

interface Pass {
  readonly state: RevealState;
  readonly now: number;
  /** The next turn for a block beginning in this render. */
  turn: number;
}

function blockDelayFor(node: ParentNode, pass: Pass): number {
  const start = node.position?.start?.offset;
  if (start === undefined) return BLOCK_DELAY_MS;
  let delay = pass.state.blockDelay.get(start);
  if (delay === undefined) {
    delay =
      start < pass.state.settledBefore
        ? BLOCK_DELAY_MS
        : BLOCK_DELAY_MS + pass.turn++ * BLOCK_STAGGER_MS;
    pass.state.blockDelay.set(start, delay);
  }
  return delay;
}

/** `shared`: inside a list item or quote, whose blocks share its turn. */
function wrapWords(parent: ParentNode, pass: Pass, delay: number, shared: boolean) {
  const children: Node[] = [];
  let text = "";
  const flush = () => {
    if (text) children.push({ type: "text", value: text });
    text = "";
  };
  for (const child of parent.children) {
    if (!isText(child)) {
      flush();
      if (isParent(child)) {
        const tag = child.tagName ?? "";
        // A code block takes its turn too, though it fades as a whole.
        const ownTurn = tag === "li" || (!shared && BLOCK_TAGS.has(tag));
        const childDelay = ownTurn ? blockDelayFor(child, pass) : delay;
        if (!UNWRAPPED_TAGS.has(tag)) {
          wrapWords(child, pass, childDelay, shared || tag === "li" || tag === "blockquote");
        }
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
      let seenAt = pass.state.firstSeen.get(offset);
      if (seenAt === undefined) {
        seenAt = pass.now;
        pass.state.firstSeen.set(offset, seenAt);
      } else if (pass.now - seenAt > delay + WORD_FADE_MS) continue;
      pass.state.settleBy = Math.max(pass.state.settleBy, seenAt + delay + WORD_FADE_MS);
      text += child.value.slice(end, word.index);
      flush();
      const element: ElementNode = {
        type: "element",
        tagName: `willow-w-${offset}`,
        properties: {
          className: ["willow-stream-word"],
          ...(delay === BLOCK_DELAY_MS ? {} : { style: `animation-delay: ${delay}ms` }),
        },
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

/** Wraps the words a render shows for the first time; `settleIn` says when the last is done. */
export function createStreamWords() {
  const state: RevealState = {
    firstSeen: new Map(),
    blockDelay: new Map(),
    settledBefore: 0,
    settleBy: 0,
  };
  let previousSource = "";
  return {
    transform(tree: unknown, source: string, now: number) {
      // A reply that was replaced rather than extended starts its words afresh.
      if (!source.startsWith(previousSource)) {
        state.firstSeen.clear();
        state.blockDelay.clear();
        previousSource = "";
      }
      state.settledBefore = previousSource.length;
      previousSource = source;
      wrapWords(tree as ParentNode, { state, now, turn: 0 }, BLOCK_DELAY_MS, false);
    },
    settleIn: (now: number) => Math.max(0, state.settleBy - now),
  };
}

function createStreamWordsPlugin() {
  const words = createStreamWords();
  const plugin = function willowStreamWords() {
    return (tree: unknown, file: { value?: unknown }) => {
      words.transform(tree, typeof file.value === "string" ? file.value : "", performance.now());
    };
  };
  return { plugin, settleIn: () => words.settleIn(performance.now()) };
}

/** The plugin while `streaming`, and until its last words have faded in. */
export function useStreamWordsPlugin(streaming: boolean) {
  const [words] = useState(createStreamWordsPlugin);
  const [lingering, setLingering] = useState(streaming);
  if (streaming && !lingering) setLingering(true);
  useEffect(() => {
    if (streaming || !lingering) return;
    const timer = setTimeout(() => setLingering(false), words.settleIn());
    return () => clearTimeout(timer);
  }, [streaming, lingering, words]);
  return streaming || lingering ? words.plugin : null;
}
