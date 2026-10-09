// The All media composer's text field: Flow's `flow-rich-text-editor`, a contenteditable that
// holds text and mention chips.
//
// Flow's rules for "@": typed at the start of the field, a line or a word (after a space, a line
// break or another chip), it opens the add menu (onMentionStart) with "@" left in the text. The
// menu's pick swaps that "@" for a chip naming the asset, followed by a space; closing the menu
// without a pick takes the "@" away again. A chip reads as invalid (outlined, dimmed) while its
// asset is not one of the composer's ingredients. Backspace takes a chip out whole; its
// ingredient stays.
//
// The prompt is still the plain-text store every other control reads (PromptTextarea.tsx): a chip
// contributes its name. When the store is set from outside (a clear, a reuse) the field shows that
// text and its chips are gone, as Flow's are when its prompt is replaced.
import React from 'react';
import { useStore } from '@nanostores/react';
import type { PromptStore } from './PromptTextarea';
import './prompt-editor.css';

export interface PromptMention {
  id: string;
  title: string;
  /** Flow's referenceType: a character ('entity') or a gallery item ('media'). */
  type: 'entity' | 'media';
}

export interface PromptEditorHandle {
  /** Focuses the field where its caret last was, else at the end. */
  focus: () => void;
  /** Swaps the "@" that opened the menu for a chip; false when no "@" is waiting. */
  insertMention: (mention: PromptMention) => boolean;
  /** Takes away the "@" that opened the menu. */
  cancelMention: () => void;
}

/** The prompt text: a chip reads as its name, a line break as "\n". */
export function serializePrompt(root: HTMLElement): string {
  let out = '';
  const walk = (parent: Node) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) { out += child.textContent ?? ''; return; }
      if (!(child instanceof HTMLElement)) return;
      if (child.dataset.mentionId !== undefined) { out += child.textContent ?? ''; return; }
      if (child.tagName === 'BR') { out += '\n'; return; }
      if ((child.tagName === 'DIV' || child.tagName === 'P') && out && !out.endsWith('\n')) out += '\n';
      walk(child);
    });
  };
  walk(root);
  // Chrome keeps a trailing <br> so that an ending line break has a line to sit on.
  if (root.lastChild instanceof HTMLElement && root.lastChild.tagName === 'BR' && out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

function renderText(root: HTMLElement, text: string) {
  root.replaceChildren();
  text.split('\n').forEach((line, i) => {
    if (i > 0) root.appendChild(document.createElement('br'));
    if (line) root.appendChild(document.createTextNode(line));
  });
  if (text.endsWith('\n')) root.appendChild(document.createElement('br'));
}

function chipNode(m: PromptMention): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'mention-chip';
  chip.contentEditable = 'false';
  chip.dataset.mentionId = m.id;
  chip.dataset.referenceType = m.type;
  chip.textContent = m.title;
  return chip;
}

/** Flow's trigger test: "@" at the start, after whitespace, after a line break or after a chip. */
function atWordStart(node: Text, offset: number): boolean {
  if (offset > 0) return /\s/.test(node.data[offset - 1]);
  let prev: Node | null = node.previousSibling;
  while (prev && prev.nodeType === Node.TEXT_NODE && !(prev.textContent ?? '')) prev = prev.previousSibling;
  if (!prev) return true;
  if (prev.nodeType === Node.TEXT_NODE) return /\s$/.test(prev.textContent ?? '');
  return prev instanceof HTMLElement && (prev.tagName === 'BR' || prev.dataset.mentionId !== undefined);
}

export const PromptEditor = React.forwardRef<PromptEditorHandle, {
  store: PromptStore;
  isAgentActive: boolean;
  onSubmit: () => void;
  onPasteFiles: (files: File[]) => Promise<void>;
  /** The ids a chip can point at: the composer's ingredients. A chip for anything else is invalid. */
  validMentionIds: ReadonlySet<string>;
  /** "@" was typed where it opens the menu; `field` is the editable element. */
  onMentionStart: (field: HTMLElement) => void;
  placeholder?: string;
}>(function PromptEditor({ store, isAgentActive, onSubmit, onPasteFiles, validMentionIds, onMentionStart, placeholder = 'What do you want to create?' }, ref) {
  const prompt = useStore(store);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const emittedRef = React.useRef(store.get());
  const pendingRef = React.useRef<{ node: Text; offset: number } | null>(null);
  const lastRangeRef = React.useRef<Range | null>(null);
  const validRef = React.useRef(validMentionIds);
  validRef.current = validMentionIds;
  const [hasChips, setHasChips] = React.useState(false);
  const [fades, setFades] = React.useState({ top: false, bottom: false });

  const updateFades = React.useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const scrollable = el.scrollHeight > el.clientHeight + 4;
    setFades({ top: scrollable && el.scrollTop > 2, bottom: scrollable && el.scrollHeight - el.scrollTop > el.clientHeight + 4 });
  }, []);

  const markValidity = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-mention-id]').forEach((chip) => {
      chip.classList.toggle('mention-chip-invalid', !validRef.current.has(chip.dataset.mentionId ?? ''));
    });
  }, []);

  const sync = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const text = serializePrompt(root);
    setHasChips(!!root.querySelector('[data-mention-id]'));
    if (text !== emittedRef.current) {
      emittedRef.current = text;
      store.set(text);
    }
    updateFades();
  }, [store, updateFades]);

  // The field is uncontrolled: it is written once from the store, and again only when the store
  // changes from outside it.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (root) renderText(root, store.get());
    return store.listen((value) => {
      if (value === emittedRef.current || !rootRef.current) return;
      emittedRef.current = value;
      pendingRef.current = null;
      renderText(rootRef.current, value);
      setHasChips(false);
      updateFades();
    });
  }, [store, updateFades]);

  React.useEffect(() => { markValidity(); }, [validMentionIds, markValidity]);

  React.useEffect(() => {
    const remember = () => {
      const sel = window.getSelection();
      const root = rootRef.current;
      if (sel && sel.rangeCount && root && root.contains(sel.anchorNode)) lastRangeRef.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);

  const placeCaret = (range: Range) => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  React.useImperativeHandle(ref, () => ({
    focus() {
      const root = rootRef.current;
      if (!root) return;
      if (document.activeElement !== root) root.focus({ preventScroll: true });
      const saved = lastRangeRef.current;
      if (saved && root.contains(saved.startContainer)) { placeCaret(saved); return; }
      const end = document.createRange();
      end.selectNodeContents(root);
      end.collapse(false);
      placeCaret(end);
    },
    insertMention(mention) {
      const root = rootRef.current;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!root || !pending || !root.contains(pending.node) || pending.node.data[pending.offset] !== '@') return false;
      const range = document.createRange();
      range.setStart(pending.node, pending.offset);
      range.setEnd(pending.node, pending.offset + 1);
      range.deleteContents();
      const space = document.createTextNode(' ');
      range.insertNode(space);
      range.insertNode(chipNode(mention));
      root.focus({ preventScroll: true });
      const after = document.createRange();
      after.setStartAfter(space);
      after.collapse(true);
      placeCaret(after);
      sync();
      markValidity();
      return true;
    },
    cancelMention() {
      const root = rootRef.current;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!root || !pending || !root.contains(pending.node) || pending.node.data[pending.offset] !== '@') return;
      pending.node.deleteData(pending.offset, 1);
      root.focus({ preventScroll: true });
      const at = document.createRange();
      at.setStart(pending.node, pending.offset);
      at.collapse(true);
      placeCaret(at);
      sync();
    },
  }), [sync, markValidity]);

  const insertPlain = (text: string) => {
    if (text) document.execCommand('insertText', false, text);
  };

  const empty = !prompt && !hasChips;
  return (
    <div className="prompt-editor-host">
      {empty && <span className="prompt-editor__placeholder" aria-hidden>{placeholder}</span>}
      <div
        ref={rootRef}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        className={`prompt-editor no-scrollbar${fades.top && fades.bottom ? ' both-fade' : fades.top ? ' top-fade' : fades.bottom ? ' bottom-fade' : ''}`}
        style={{ paddingRight: isAgentActive ? (prompt ? '44px' : '24px') : (prompt ? '20px' : '14px') }}
        onInput={(e) => {
          sync();
          const native = e.nativeEvent as InputEvent;
          if (native.inputType !== 'insertText' || native.data !== '@') return;
          const sel = window.getSelection();
          const node = sel?.anchorNode;
          const offset = sel?.anchorOffset ?? 0;
          if (!(node instanceof Text) || !rootRef.current?.contains(node) || offset < 1 || node.data[offset - 1] !== '@') return;
          if (!atWordStart(node, offset - 1)) return;
          pendingRef.current = { node, offset: offset - 1 };
          onMentionStart(rootRef.current);
        }}
        onBeforeInput={(e) => {
          const native = e.nativeEvent as InputEvent;
          // Dropped or pasted content arrives as plain text, never as markup.
          if (native.inputType === 'insertFromDrop' || native.inputType === 'insertFromPaste') {
            const text = native.dataTransfer?.getData('text/plain') ?? '';
            e.preventDefault();
            insertPlain(text);
          }
        }}
        onScroll={updateFades}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (e.shiftKey) document.execCommand('insertLineBreak');
          else onSubmit();
        }}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          const files: File[] = [];
          for (let i = 0; i < (items?.length ?? 0); i += 1) {
            const item = items![i];
            if (/^(image|video|audio)\//.test(item.type)) {
              const file = item.getAsFile();
              if (file) files.push(file);
            }
          }
          e.preventDefault();
          if (files.length) { void onPasteFiles(files); return; }
          insertPlain(e.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
});
