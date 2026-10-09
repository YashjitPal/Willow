import { concatInline, splitInline } from "./inline-dom";
import { text, type PageInline, type PageTextRun } from "./state/page-document";

/** `K` (title-menu chunk): typed shortcuts and their glyphs, longest first. */
const replacements: readonly (readonly [shortcut: string, glyph: string])[] = [
  ["<->", "↔"],
  ["<=>", "⇔"],
  ["<-", "←"],
  ["->", "→"],
  ["=>", "⇒"],
  ["<=", "≤"],
  [">=", "≥"],
  ["!=", "≠"],
  ["+/-", "±"],
  ["--", "—"],
  ["...", "…"],
];

/** Characters whose input can complete a conversion. */
export const smartPunctuationTriggers = `"'.=>-`;

export interface SmartPunctuation {
  shortcut: string;
  glyph: string;
  /** Start of the text the glyph replaces. */
  from: number;
  /** Extends the glyph just converted (`←` + `>` becomes `↔`). */
  continuation: boolean;
}

/** `Re`: the conversion for `typed` after `before`; `previousShortcut` is the shortcut converted right before the caret. */
export function smartPunctuationFor(before: string, typed: string, previousShortcut?: string): SmartPunctuation | undefined {
  if (typed === '"' || typed === "'") {
    const opening = before.length === 0 || /[\s{[(<'"‘“]/.test(before.slice(-1));
    return { shortcut: typed, glyph: (typed === '"' ? "“”" : "‘’")[opening ? 0 : 1], from: before.length, continuation: false };
  }
  if (typed.length !== 1 || !".=>-".includes(typed)) return undefined;
  const continuation = typed === ">" && ((previousShortcut === "<-" && before.endsWith("←")) || (previousShortcut === "<=" && before.endsWith("≤")));
  const run = (continuation ? previousShortcut : before.slice(-2)) + typed;
  const match = replacements.find(([shortcut]) => run.endsWith(shortcut));
  if (match == null) return undefined;
  return { shortcut: match[0], glyph: match[1], from: before.length - (continuation ? 1 : match[0].length - 1), continuation };
}

/** `Be`: whether the character at `index` follows an odd run of backslashes. */
function isEscaped(text: string, index: number) {
  let start = index;
  while (start > 0 && text[start - 1] === "\\") start -= 1;
  return (index - start) % 2 === 1;
}

/**
 * `ze`: escaped text, Markdown link targets, URLs and open inline code keep the typed characters.
 * `codeMarked` flags characters of `before` inside a code mark; their backticks never open a fence.
 */
export function keepsLiteralPunctuation(before: string, typed: string, from: number, codeMarked?: readonly boolean[]) {
  if (isEscaped(before, from) || (before.includes("](") && before.lastIndexOf("](") > before.lastIndexOf(")"))) return true;
  if (typed !== '"') {
    const text = before + typed;
    if (/https?:\/\/|www\./i.test(text)) {
      const word = /(?:^|[\s"“”])([^\s"“”]*)$/.exec(text)?.[1];
      if (word != null && /https?:\/\/|www\./i.test(word)) return true;
    }
  }
  if (!before.includes("`")) return false;
  const unmarked = codeMarked == null ? before : before.replace(/`/g, (tick, index: number) => (codeMarked[index] ? " " : tick));
  let openFence: string | undefined;
  for (const match of unmarked.matchAll(/`+/g)) {
    if (openFence === match[0]) openFence = undefined;
    else if (openFence == null && !isEscaped(unmarked, match.index)) openFence = match[0];
  }
  return openFence != null;
}

/** A body conversion that Backspace can still revert. */
export interface PunctuationConversion {
  key: string;
  from: number;
  shortcut: string;
  glyph: string;
}

/** Text with atoms as U+FFFC, like ProseMirror's `textBetween(from, to, "", "\uFFFC")`. */
function leafText(content: PageInline[]) {
  return content.map((run) => (run.kind === "text" ? run.text : "\uFFFC")).join("");
}

function codeMask(content: PageInline[]) {
  return content.flatMap((run) => (run.kind === "text" ? Array.from({ length: run.text.length }, () => run.marks?.includes("code") === true) : [false]));
}

/** Replaces `[from, to)` with `value`, keeping the formatting of the first replaced text run. */
function replaceText(content: PageInline[], from: number, to: number, value: string) {
  const [head, rest] = splitInline(content, from);
  const [replaced, tail] = splitInline(rest, to - from);
  const style = replaced.find((run): run is PageTextRun => run.kind === "text");
  return concatInline(concatInline(head, [{ ...(style ?? text("")), text: value }]), tail);
}

/**
 * `AK` (content chunk) once `typed` has landed before `caret`: the content with the shortcut turned into its glyph,
 * or null to keep the typed text. Code-marked text and Markdown table rules stay literal.
 */
export function convertTypedPunctuation(content: PageInline[], caret: number, typed: string, previous?: PunctuationConversion) {
  if (typed.length !== 1 || !smartPunctuationTriggers.includes(typed)) return null;
  const position = caret - 1;
  const value = leafText(content);
  const code = codeMask(content);
  if (value[position] !== typed || code[position]) return null;
  const before = value.slice(0, position);
  const context = before.slice(-2);
  const conversion = smartPunctuationFor(context, typed, previous?.from === position - 1 ? previous.shortcut : undefined);
  if (conversion == null) return null;
  const from = position - (context.length - conversion.from);
  if (code.slice(Math.max(0, from), position).some(Boolean)) return null;
  if ((typed === "-" && /^[\s|:-]*$/.test(before) && !/^ {0,3}-$/.test(before)) || keepsLiteralPunctuation(before, typed, Math.max(0, from), code)) return null;
  return { content: replaceText(content, from, caret, conversion.glyph), from, shortcut: conversion.shortcut, glyph: conversion.glyph };
}

/** Backspace right after a conversion: the typed shortcut again. */
export function revertPunctuation(content: PageInline[], conversion: PunctuationConversion) {
  return replaceText(content, conversion.from, conversion.from + conversion.glyph.length, conversion.shortcut);
}
