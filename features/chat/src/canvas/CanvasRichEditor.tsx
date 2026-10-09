/**
 * The prose canvas's editor — Gemini's `div.ProseMirror[aria-label="Canvas editor"]`.
 *
 * The document is edited in place as rich text, the way Gemini does it: the Styles
 * menu turns a line into a heading, Bold/Italic and the two list buttons work on
 * the selection, and equations are atoms. There is no source mode and no button
 * to enter one; a caret is the whole affordance, and every keystroke rides the
 * same 400ms autosave the code view uses.
 *
 * It is a `contenteditable` region whose DOM the browser owns. React renders the
 * element once and never its children: the HTML is written imperatively when the
 * document changes from OUTSIDE (a new version from the model, a version scrub),
 * and edits flow back out as Markdown through `editorDomToMarkdown`. Writing the
 * children from render would put the caret back at the start on every keystroke.
 *
 * The echo rule is `useCanvasDraft`'s: a committed edit comes back a moment later
 * as the `content` prop, and it is recognised as our own by comparing against the
 * last Markdown sent, so it never rewrites the DOM under the caret.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  editorDomToMarkdown,
  markdownToEditorHtml,
  mathAtomHtml,
  renderTex,
  type CanvasBlockKind,
} from './canvas-markdown';

const COMMIT_MS = 400;

export interface CanvasEditorSelection {
  text: string;
  /** The selection's bounding box, viewport coordinates. */
  rect: { left: number; top: number; right: number; bottom: number };
}

export interface CanvasEditorHandle {
  setBlock: (kind: CanvasBlockKind) => void;
  bold: () => void;
  italic: () => void;
  bulletedList: () => void;
  numberedList: () => void;
  insertEquation: (display: boolean) => void;
  focus: () => void;
}

export interface CanvasRichEditorProps {
  content: string;
  /** Absent = read-only, which is what a turn in flight is. Called on a debounce. */
  onContentChange?: (markdown: string) => void;
  /** The block the caret sits in, for the Styles button. */
  onBlockChange?: (kind: CanvasBlockKind) => void;
  /** A non-empty selection settled (pointer up / key up), or `null` when it collapsed. */
  onSelectionChange?: (selection: CanvasEditorSelection | null) => void;
  className?: string;
}

const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, div';

const blockKindAt = (root: HTMLElement): CanvasBlockKind => {
  const selection = window.getSelection();
  const node = selection && selection.anchorNode;
  if (!node || !root.contains(node)) return 'p';
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const block = element && element.closest(BLOCK_SELECTOR);
  const tag = block && root.contains(block) ? block.tagName.toLowerCase() : 'p';
  return tag === 'h1' || tag === 'h2' || tag === 'h3' ? tag : 'p';
};

interface EquationEdit {
  node: HTMLElement;
  tex: string;
  display: boolean;
  /** A fresh atom that has never been confirmed is removed if the edit is cancelled. */
  fresh: boolean;
}

export const CanvasRichEditor = forwardRef<CanvasEditorHandle, CanvasRichEditorProps>(
  function CanvasRichEditor({ content, onContentChange, onBlockChange, onSelectionChange, className = '' }, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    /*
     * The first render carries the document's HTML, so the first frame (and a static
     * render) shows it. The prop is ONE OBJECT for the editor's whole life: React
     * compares `dangerouslySetInnerHTML` by identity, so a fresh `{ __html }` per render
     * rewrites innerHTML on every re-render — collapsing the selection the moment a
     * mouse-up reports it, and throwing away whatever was typed. Later outside changes
     * are written by the layout effect below.
     */
    const seedRef = useRef<{ content: string; prop: { __html: string } } | null>(null);
    if (seedRef.current === null) seedRef.current = { content, prop: { __html: markdownToEditorHtml(content) } };
    const sentRef = useRef<string | null>(seedRef.current.content);
    const timerRef = useRef<number | null>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const onChangeRef = useRef(onContentChange);
    onChangeRef.current = onContentChange;
    const onBlockRef = useRef(onBlockChange);
    onBlockRef.current = onBlockChange;
    const onSelectionRef = useRef(onSelectionChange);
    onSelectionRef.current = onSelectionChange;
    const editable = !!onContentChange;
    const [equation, setEquation] = useState<EquationEdit | null>(null);

    /* Outside changes only. Our own commits come back equal to `sentRef` and are skipped. */
    useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root || content === sentRef.current) return;
      sentRef.current = content;
      root.innerHTML = markdownToEditorHtml(content);
    }, [content]);

    const flush = useCallback(() => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const root = rootRef.current;
      const onChange = onChangeRef.current;
      if (!root || !onChange) return;
      const markdown = editorDomToMarkdown(root);
      if (markdown === sentRef.current) return;
      sentRef.current = markdown;
      onChange(markdown);
    }, []);

    const schedule = useCallback(() => {
      if (!onChangeRef.current) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, COMMIT_MS);
    }, [flush]);

    useEffect(() => () => flush(), [flush]);

    /* ProseMirror's initial selection is the start of the document, so Gemini's Styles
       button names the FIRST block before anything is clicked ("Heading 1" for a titled
       document). Mirror that until a real caret arrives. */
    useEffect(() => {
      const first = rootRef.current?.firstElementChild;
      const tag = first ? first.tagName.toLowerCase() : 'p';
      onBlockRef.current?.(tag === 'h1' || tag === 'h2' || tag === 'h3' ? tag : 'p');
    }, []);

    /* The Styles label follows the caret; a selection is reported once it settles. */
    useEffect(() => {
      const onSelectionChangeEvent = () => {
        const root = rootRef.current;
        const selection = window.getSelection();
        if (!root || !selection || !selection.anchorNode || !root.contains(selection.anchorNode)) return;
        if (selection.rangeCount) savedRangeRef.current = selection.getRangeAt(0).cloneRange();
        onBlockRef.current?.(blockKindAt(root));
        if (selection.isCollapsed) onSelectionRef.current?.(null);
      };
      document.addEventListener('selectionchange', onSelectionChangeEvent);
      return () => document.removeEventListener('selectionchange', onSelectionChangeEvent);
    }, []);

    const reportSelection = useCallback(() => {
      const root = rootRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const text = selection.toString().trim();
      if (!text) return;
      const box = range.getBoundingClientRect();
      onSelectionRef.current?.({ text, rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } });
    }, []);

    /** Put the caret back where it was before a toolbar press took focus. */
    const restore = useCallback(() => {
      const root = rootRef.current;
      if (!root) return;
      root.focus({ preventScroll: true });
      const range = savedRangeRef.current;
      const selection = window.getSelection();
      if (range && selection && root.contains(range.commonAncestorContainer)) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }, []);

    const run = useCallback((command: string, value?: string) => {
      if (!editable) return;
      restore();
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand(command, false, value);
      const root = rootRef.current;
      if (root) onBlockRef.current?.(blockKindAt(root));
      schedule();
    }, [editable, restore, schedule]);

    const insertEquation = useCallback((display: boolean) => {
      if (!editable) return;
      restore();
      const marker = `cv-eq-${Date.now()}`;
      const html = mathAtomHtml('x', display).replace('class="cv-math', `data-new="${marker}" class="cv-math`);
      document.execCommand('insertHTML', false, display ? html : `${html}&#8203;`);
      const node = rootRef.current?.querySelector<HTMLElement>(`[data-new="${marker}"]`);
      if (node) {
        node.removeAttribute('data-new');
        setEquation({ node, tex: 'x', display, fresh: true });
      }
      schedule();
    }, [editable, restore, schedule]);

    useImperativeHandle(ref, () => ({
      setBlock: (kind) => run('formatBlock', `<${kind}>`),
      bold: () => run('bold'),
      italic: () => run('italic'),
      bulletedList: () => run('insertUnorderedList'),
      numberedList: () => run('insertOrderedList'),
      insertEquation,
      focus: () => restore(),
    }), [run, insertEquation, restore]);

    const commitEquation = (tex: string) => {
      const edit = equation;
      setEquation(null);
      if (!edit) return;
      const value = tex.trim();
      if (!value) {
        edit.node.remove();
      } else {
        edit.node.setAttribute('data-tex', value);
        edit.node.innerHTML = renderTex(value, edit.display);
      }
      schedule();
    };

    const cancelEquation = () => {
      const edit = equation;
      setEquation(null);
      if (edit && edit.fresh) {
        edit.node.remove();
        schedule();
      }
    };

    return (
      <>
        <div
          ref={rootRef}
          role="textbox"
          aria-label="Canvas editor"
          aria-multiline="true"
          aria-readonly={!editable || undefined}
          contentEditable={editable}
          suppressContentEditableWarning
          spellCheck={editable}
          translate="no"
          className={`cv-prose ${className}`}
          dangerouslySetInnerHTML={seedRef.current.prop}
          onFocus={() => {
            document.execCommand('defaultParagraphSeparator', false, 'p');
          }}
          onInput={schedule}
          onBlur={flush}
          onMouseUp={reportSelection}
          onKeyUp={(event) => { if (event.shiftKey || event.key.startsWith('Arrow')) reportSelection(); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              /* One Escape closes the smallest thing: here it leaves the editor, and
                 the panel's own Escape (collapse) needs a second press. */
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              onSelectionRef.current?.(null);
              rootRef.current?.blur();
            }
          }}
          onPaste={(event) => {
            if (!editable) return;
            event.preventDefault();
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
          }}
          onClick={(event) => {
            const atom = (event.target as Element).closest?.('.cv-math') as HTMLElement | null;
            if (!atom || !editable || !rootRef.current?.contains(atom)) return;
            setEquation({ node: atom, tex: atom.getAttribute('data-tex') || '', display: atom.getAttribute('data-display') === 'true', fresh: false });
          }}
        />
        {equation && (
          <CanvasEquationEditor
            key={equation.node.getAttribute('data-tex') + String(equation.fresh)}
            anchor={equation.node}
            initial={equation.tex}
            onCommit={commitEquation}
            onCancel={cancelEquation}
          />
        )}
      </>
    );
  },
);

/** A one-line TeX field under an equation atom. Enter confirms, Escape cancels. */
const CanvasEquationEditor: React.FC<{
  anchor: HTMLElement;
  initial: string;
  onCommit: (tex: string) => void;
  onCancel: () => void;
}> = ({ anchor, initial, onCommit, onCancel }) => {
  const [value, setValue] = useState(initial);
  /* Escape unmounts the field, and losing focus to that would commit as well. */
  const doneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  const box = anchor.getBoundingClientRect();
  return createPortal(
    <div className="cv-equation" style={{ left: Math.max(8, box.left), top: box.bottom + 8 }}>
      <input
        autoFocus
        aria-label="Equation"
        className="cv-equation__input"
        value={value}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); finish(true); }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    </div>,
    document.body,
  );
};
