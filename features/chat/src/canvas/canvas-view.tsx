/**
 * Shared Canvas chrome — the parts the full-bleed panel and the inline thread
 * card both render.
 *
 * ## Where the numbers come from
 *
 * Every dimension here was measured off the live Gemini app over CDP at
 * 1536x826 CSS px / DPR 1.25, dark theme, sidebar collapsed to its 76px rail. The
 * measurements are repeated in comments beside the values they justify, because
 * the capture tree they came from (`tools/ui-research/captures/canvas-transition/`)
 * is gitignored: it has already been destroyed once by a history rewrite, and the
 * spec had to be rebuilt by replaying a session transcript. Source comments are
 * the only copy that survives a cleanup.
 *
 * ## Icon families
 *
 * `luminous` and `google-symbols` are SUBSET faces declared in
 * `apps/studio/index.html` (194 ligatures for the latter), and a ligature the face
 * lacks renders as the letters of its own name — the browser never falls through,
 * because those letters are present. So anything not already named somewhere in
 * the app uses `material-rounded`, the full Material Symbols Rounded family:
 * `cloud_done`, `undo`, `redo`, `collapse_content`, `code_blocks`. `close`,
 * `expand_content`, `download` and `content_copy` are in the subsets already and
 * keep Gemini's own faces.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  StreamingMarkdown,
  copyToClipboard,
  downloadText,
  highlightedCode,
} from '@willow/ui/StreamingMarkdown';
import { useInjectStyles } from '@willow/ui/streaming-markdown-styles';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { codeExtension, isPreviewable, type CanvasDoc } from './canvas-store';

export type CanvasTab = 'code' | 'preview';

export type CanvasIconFamily = 'material-rounded' | 'luminous' | 'google-symbols';

/**
 * `c_<hash>_<name>.<ext>` -> `<name>.<ext>`.
 *
 * The filename half of the document id is what Download and Export name the file,
 * which is the whole reason `canvasDocId` builds one instead of using a bare hash.
 */
export const canvasFileName = (doc: CanvasDoc): string => {
  const match = /^c_[0-9a-f]+_(.+\..+)$/.exec(doc.docId);
  if (match) return match[1];
  const ext = doc.kind === 'code' ? codeExtension(doc.language) : 'md';
  const slug = doc.title.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${slug || 'document'}.${ext}`;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  css: 'text/css;charset=utf-8',
  js: 'text/javascript;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export const downloadCanvas = (doc: CanvasDoc, content: string): void => {
  const name = canvasFileName(doc);
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  downloadText(name, content, MIME_BY_EXTENSION[extension] ?? 'text/plain;charset=utf-8');
};

export const copyCanvas = async (content: string): Promise<void> => {
  await copyToClipboard(content);
  // Same feedback as copying a response: the bottom-left snackbar, no tick swap.
  showCopyToast('Copied to clipboard');
};

/**
 * The script every preview document runs FIRST, before any of the model's own.
 *
 * ## Why a preview needs a shim at all
 *
 * The frame has an OPAQUE origin, because it must (see `CANVAS_PREVIEW_SANDBOX`).
 * In an opaque origin, merely *touching* `localStorage` throws a `SecurityError` —
 * not on write, on property access — and a model asked for a game writes
 * `localStorage.getItem('highScore')` in its init path more often than not. The
 * throw aborts init, so the listeners are never attached and every button in the
 * document is inert. Reported exactly that way: "if I press 'Play game'… it doesn't
 * response at all."
 *
 * So storage is replaced with an in-memory stand-in when the real one is
 * unreachable. A high score does not survive a reload; the game runs.
 *
 * ## And why it reports errors
 *
 * A sandboxed frame that throws does so into its own console with no indication in
 * the app, which is what made the above look like a dead button rather than a
 * crash. Anything uncaught is relayed to the embedder, which logs it — so the next
 * one of these is a message instead of a mystery.
 */
export const CANVAS_PREVIEW_SHIM = `<script>(function(){
var post=function(kind,detail){try{parent.postMessage({source:'willow-canvas-preview',kind:kind,detail:String(detail)},'*');}catch(e){}};
var memory=function(){var m=Object.create(null);return{getItem:function(k){k=String(k);return k in m?m[k]:null;},setItem:function(k,v){m[String(k)]=String(v);},removeItem:function(k){delete m[String(k)];},clear:function(){m=Object.create(null);},key:function(i){var keys=Object.keys(m);return i<keys.length?keys[i]:null;},get length(){return Object.keys(m).length;}};};
['localStorage','sessionStorage'].forEach(function(name){var ok=false;try{var store=window[name];if(store){store.setItem('__willow_probe','1');store.removeItem('__willow_probe');ok=true;}}catch(e){}
if(!ok){try{Object.defineProperty(window,name,{configurable:true,value:memory()});post('shim',name);}catch(e){}}});
try{void document.cookie;}catch(e){try{Object.defineProperty(Document.prototype,'cookie',{configurable:true,get:function(){return '';},set:function(){}});post('shim','cookie');}catch(_){}}
window.addEventListener('error',function(event){post('error',(event.message||'Script error')+' ('+(event.filename||'inline')+':'+(event.lineno||0)+')');});
window.addEventListener('unhandledrejection',function(event){var reason=event.reason;post('error','Unhandled rejection: '+((reason&&reason.message)||reason));});
})();</script>`;

/**
 * Put the shim in front of the document's own scripts.
 *
 * A pass-through document is edited rather than rewrapped, for the reason above:
 * nesting `<html>` inside `<html>` makes the browser drop the inner `<head>`. The
 * insertion point is after `<head>` where there is one, and after `<html>` or at
 * the very front where there is not — all three leave the model's markup intact,
 * and Chrome hoists a leading script into the head it synthesises anyway.
 */
const withPreviewShim = (document_: string): string => {
  const head = /<head[^>]*>/i.exec(document_);
  if (head) {
    const at = head.index + head[0].length;
    return document_.slice(0, at) + CANVAS_PREVIEW_SHIM + document_.slice(at);
  }
  const html = /<html[^>]*>/i.exec(document_);
  if (html) {
    const at = html.index + html[0].length;
    return document_.slice(0, at) + CANVAS_PREVIEW_SHIM + document_.slice(at);
  }
  return CANVAS_PREVIEW_SHIM + document_;
};

/**
 * The document the Preview tab runs.
 *
 * A model asked for a web app writes a whole document, so anything that already
 * declares `<html>` or a doctype is passed through untouched — rewrapping it would
 * nest one document inside another and silently drop its `<head>`. A bare fragment
 * gets the minimum wrapper needed for it to lay out at all.
 */
export const canvasPreviewDocument = (content: string): string => {
  if (/<!doctype/i.test(content) || /<html[\s>]/i.test(content)) return withPreviewShim(content);
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>html,body{margin:0;min-height:100%;background:#fff;',
    'font-family:"Google Sans Text",system-ui,-apple-system,sans-serif;}</style>',
    CANVAS_PREVIEW_SHIM,
    '</head><body>',
    content,
    '</body></html>',
  ].join('');
};

/**
 * The sandbox the preview iframe runs under.
 *
 * A DELIBERATE DEPARTURE from Gemini, which adds `allow-same-origin`. It can:
 * its preview is served from a per-conversation `*.scf.usercontent.goog` origin, so
 * same-origin there means same-origin with a throwaway sandbox host. Willow renders
 * the document with `srcDoc`, and `allow-scripts` + `allow-same-origin` on a
 * srcdoc frame resolves to *Willow's own origin* — model-authored script would then
 * read the app's `localStorage`, its IndexedDB and its auth tokens. Omitting it
 * gives the frame an opaque origin, which costs the document nothing it needs.
 */
export const CANVAS_PREVIEW_SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
  'allow-pointer-lock',
].join(' ');

/*
 * The hover tint is a STATE LAYER, not a background.
 *
 * Measured on every icon button in the app's Gemini-derived chrome: the button's
 * own `background-color` stays `rgba(0,0,0,0)` in both states, and what changes is
 * the opacity of a `::before` filled with `rgb(196,199,197)` — Material's
 * persistent ripple. 0.08 for hover, 0.12 for focus, which is MDC's own pair.
 * Setting a background here instead reads as a slightly different grey rather than
 * a tint over whatever is behind it.
 */
const ICON_BUTTON_CLASS =
  'relative flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 '
  + 'text-[#e3e3e3] outline-none disabled:pointer-events-none disabled:opacity-[0.38] '
  + "before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 "
  + "before:transition-opacity before:content-[''] hover:before:opacity-[0.08] focus-visible:before:opacity-[0.12]";

export const CanvasIconButton: React.FC<{
  icon: string;
  family?: CanvasIconFamily;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** 36 in the card's title row, 40 in the panel toolbar, 56 for its Collapse. */
  box?: number;
  iconSize?: number;
  fill?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({
  icon,
  family = 'material-rounded',
  label,
  onClick,
  disabled,
  box = 36,
  iconSize = 24,
  fill,
  className = '',
  style,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    style={{ width: box, height: box, ...style }}
    className={`${ICON_BUTTON_CLASS} ${className}`}
  >
    <MaterialSymbol
      name={icon}
      family={family}
      size={iconSize}
      weight={300}
      roundness={100}
      opticalSize={iconSize}
      fill={fill}
      className="relative"
    />
  </button>
);

/*
 * The primary pill: `Export` on a prose canvas, `Download` on a code one.
 *
 * Measured `128.45 x 36` (Export) and `120.15 x 36` (Download), both
 * `background: rgb(23,23,23)` / `border-radius: 9999px`, with a 24px icon 8px in
 * and a `.gds-body-m` 15px/20px w400 label 40px in. Those two widths are NOT
 * label-driven — "Download" is the longer word and the narrower button — so they
 * are set as minimums rather than derived from padding, and Export's extra 8px is
 * where its menu affordance lives.
 */
const PILL_CLASS =
  'relative flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border-0 '
  + 'bg-[rgb(23,23,23)] pl-2 pr-4 text-[15px] font-normal leading-5 text-[#e3e3e3] outline-none '
  + "before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 "
  + "before:transition-opacity before:content-[''] hover:before:opacity-[0.08] focus-visible:before:opacity-[0.12]";

export const CanvasPill: React.FC<{
  icon: string;
  family?: CanvasIconFamily;
  label: string;
  minWidth: number;
  onClick?: () => void;
  expanded?: boolean;
}> = ({ icon, family = 'google-symbols', label, minWidth, onClick, expanded }) => (
  <button
    type="button"
    onClick={onClick}
    style={{ minWidth }}
    aria-haspopup={expanded === undefined ? undefined : 'menu'}
    aria-expanded={expanded}
    className={PILL_CLASS}
  >
    <MaterialSymbol name={icon} family={family} size={24} weight={300} roundness={100} className="relative" />
    <span className="relative">{label}</span>
  </button>
);

export interface CanvasMenuItem {
  id: string;
  label: string;
  icon: string;
  family?: CanvasIconFamily;
  onSelect: () => void;
}

/*
 * Menu pane, matching the shell's own (ConversationActionsMenu): 20px radius,
 * `#1f1f1f`, 8px padding, `0 0 20px rgba(0,0,0,0.28)`; rows 36px tall with a 20px
 * icon slot and a 13px/17px label. Gemini's Export and quick-action menus were
 * never captured open, so their contents are Willow's choice — the chrome is not.
 */
const MENU_ROW_CLASS =
  'flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent p-2 '
  + 'text-left text-[13px] font-normal leading-[17px] text-[#e6e6e6] transition-colors '
  + 'hover:bg-[rgba(230,230,230,0.08)]';

/** A menu anchored under (or over) its trigger. The trigger owns the open state. */
const CanvasMenuPane: React.FC<{
  items: CanvasMenuItem[];
  onClose: () => void;
  align?: 'left' | 'right';
  side?: 'below' | 'left';
}> = ({ items, onClose, align = 'right', side = 'below' }) => (
  <div
    role="menu"
    onClick={(event) => event.stopPropagation()}
    className={`absolute z-30 flex min-w-[180px] flex-col rounded-[20px] bg-[#1f1f1f] p-2 shadow-[0_0_20px_rgba(0,0,0,0.28)] ${
      side === 'below'
        ? `top-[calc(100%+4px)] ${align === 'right' ? 'right-0' : 'left-0'}`
        : 'right-[calc(100%+8px)] top-0'
    }`}
  >
    {items.map((item) => (
      <button
        key={item.id}
        type="button"
        role="menuitem"
        className={MENU_ROW_CLASS}
        onClick={() => { onClose(); item.onSelect(); }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center">
          <MaterialSymbol
            name={item.icon}
            family={item.family ?? 'material-rounded'}
            size={20}
            weight={320}
            roundness={100}
            opticalSize={20}
          />
        </span>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</span>
      </button>
    ))}
  </div>
);

/** Closes on an outside pointer-down or Escape — the two ways every menu in the
 *  shell closes, so a Canvas menu does not need its own habit. */
const useDismissable = (open: boolean, onClose: () => void) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stopped here so the panel's own Escape-to-collapse does not also fire:
      // one Escape should close one thing.
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose]);
  return rootRef;
};

export const CanvasMenuPill: React.FC<{
  icon: string;
  family?: CanvasIconFamily;
  label: string;
  minWidth: number;
  items: CanvasMenuItem[];
}> = ({ icon, family, label, minWidth, items }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useDismissable(open, () => setOpen(false));
  return (
    <div ref={rootRef} className="relative shrink-0">
      <CanvasPill
        icon={icon}
        family={family}
        label={label}
        minWidth={minWidth}
        expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open && <CanvasMenuPane items={items} onClose={() => setOpen(false)} />}
    </div>
  );
};

const CanvasMenuFab: React.FC<{
  icon: string;
  label: string;
  items: CanvasMenuItem[];
}> = ({ icon, label, items }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useDismissable(open, () => setOpen(false));
  return (
    <div ref={rootRef} className="relative">
      <CanvasIconButton
        icon={icon}
        label={label}
        box={40}
        onClick={() => setOpen((current) => !current)}
        // `rgb(19,19,20)` is the fab's own fill, measured — it matches the rail it
        // sits in, so the group reads as one pill with three pressable thirds.
        // Inline, not a class: `ICON_BUTTON_CLASS` already sets `bg-transparent`,
        // and two Tailwind background utilities on one element resolve by
        // stylesheet order rather than by attribute order.
        style={{ backgroundColor: 'rgb(19,19,20)' }}
      />
      {open && <CanvasMenuPane items={items} onClose={() => setOpen(false)} side="left" />}
    </div>
  );
};

/**
 * `cloud_done` · `undo` · `redo` — the versioning trio.
 *
 * Measured 120x40 in the panel toolbar (three 40x40 buttons at +0/+40/+80, i.e. no
 * gap) and 36x36 on a 44px pitch in the card's title row (8px gap). `cloud_done` is
 * a button in Gemini too, and it does nothing: it is the "Changes saved" status,
 * and it is here rather than as a text label because that is what the app shows.
 *
 * Undo/Redo are version history, NOT text editing. Willow's canvas is not an
 * editable ProseMirror document, so there is nothing else they could mean — they
 * step `CanvasDoc.versions`, which is the fold of every turn that touched this
 * document (see canvas-store.ts).
 */
export const CanvasVersionNav: React.FC<{
  versionCount: number;
  version: number;
  onVersionChange: (version: number) => void;
  box?: number;
}> = ({ versionCount, version, onVersionChange, box = 40 }) => (
  <div className={`flex shrink-0 items-center ${box === 40 ? 'gap-0' : 'gap-2'}`}>
    <CanvasIconButton
      icon="cloud_done"
      label={version === versionCount - 1 ? 'Changes saved' : `Version ${version + 1} of ${versionCount}`}
      box={box}
    />
    <CanvasIconButton
      icon="undo"
      label="Previous version"
      box={box}
      disabled={version <= 0}
      onClick={() => onVersionChange(version - 1)}
    />
    <CanvasIconButton
      icon="redo"
      label="Next version"
      box={box}
      disabled={version >= versionCount - 1}
      onClick={() => onVersionChange(version + 1)}
    />
  </div>
);

/**
 * Code / Preview.
 *
 * Gemini ships this concept as two different components — the panel's
 * `gem-segmented-button-row` (`130.25x28` outer, `126.25x24` track, a `63.13x24`
 * slider that moves to the selected tab) and the card's `mat-button-toggle-group`
 * (`127.19x28` track, `background: rgba(255,255,255,0.12)`). One component covers
 * both here, at the card's measured colours, because the panel's tonal track was
 * never read.
 *
 * The selected state is DARKER than the track — `rgb(15,15,15)` on
 * `rgba(255,255,255,0.12)`. That looks like an inversion of the usual segmented
 * control and is the measured value; the checked cell reads as a hole, not a raised
 * chip.
 */
export const CanvasTabSwitch: React.FC<{
  tab: CanvasTab;
  onChange: (tab: CanvasTab) => void;
}> = ({ tab, onChange }) => (
  <div
    role="tablist"
    aria-label="Canvas view"
    className="relative flex h-7 w-[130px] shrink-0 items-center rounded-full bg-[rgba(255,255,255,0.12)] p-0.5"
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-0.5 top-0.5 h-6 w-[63px] rounded-full bg-[rgb(15,15,15)] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]"
      style={{ transform: `translateX(${tab === 'code' ? 0 : 63}px)` }}
    />
    {(['code', 'preview'] as CanvasTab[]).map((value) => (
      <button
        key={value}
        type="button"
        role="tab"
        aria-selected={tab === value}
        onClick={() => onChange(value)}
        className="relative z-[1] flex h-6 w-[63px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[13px] font-normal leading-[17px] text-[#e3e3e3] outline-none"
      >
        {value === 'code' ? 'Code' : 'Preview'}
      </button>
    ))}
  </div>
);

/**
 * A document the user is typing into, held locally and committed on a timer.
 *
 * Two problems, one hook:
 *
 *  - **The store round-trip is not per keystroke.** `content` comes out of the
 *    message-log fold, and rewriting a `CanvasRef` re-renders the whole thread,
 *    so committing on every character would put a full ChatView render between
 *    the key and the glyph. The draft is what the editor shows.
 *  - **The commit ECHOES BACK.** A moment later `content` arrives as the value we
 *    just sent, and naively syncing on it clobbers whatever was typed in the
 *    meantime — measured as characters vanishing while typing fast. So an
 *    incoming value is only adopted when it differs from what we last sent,
 *    which is exactly "someone else changed the document" (the model rewriting
 *    it, or an undo to another version).
 *
 * The pending edit is flushed on unmount so closing the panel mid-word cannot
 * lose the word.
 */
const CANVAS_EDIT_COMMIT_MS = 400;

export const useCanvasDraft = (
  content: string,
  onChange?: (next: string) => void,
): [string, (next: string) => void] => {
  const [draft, setDraft] = useState(content);
  const sentRef = useRef(content);
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (content === sentRef.current) return;
    sentRef.current = content;
    setDraft(content);
  }, [content]);

  const pendingRef = useRef<string | null>(null);
  const flush = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending === null || pending === sentRef.current) return;
    sentRef.current = pending;
    onChangeRef.current?.(pending);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => () => flushRef.current(), []);

  const edit = (next: string) => {
    setDraft(next);
    if (!onChangeRef.current) return;
    pendingRef.current = next;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => flushRef.current(), CANVAS_EDIT_COMMIT_MS);
  };

  return [draft, edit];
};

/**
 * Prose body.
 *
 * `StreamingMarkdown` needs no canvas-specific type scale, and that is not a
 * coincidence: its headings are already 28/36 w350 and 24/28 w380 on a 17/24 body
 * (streaming-markdown-styles.ts), which is exactly what the canvas measured, because
 * both were read off the same Gemini markdown renderer.
 *
 * Always settled — never `isStreaming`. A canvas document arrives whole, in one tool
 * call, so there is no partial state to pace; the turn's own text is what streams.
 *
 * ## Editing has NO BUTTON
 *
 * It used to: a pencil that swapped the rendered document for its Markdown. The
 * user asked for it gone — "there shouldn't be an edit button to edit inside a
 * document canvas... the user can freely edit and it will be saved automatically" —
 * so the document is editable by putting a caret in it, exactly like the code view,
 * and every keystroke rides the same 400ms autosave.
 *
 * What is unavoidable, and is a real trade rather than an oversight: while the caret
 * is in the document you are editing its MARKDOWN. Willow renders canvas prose with
 * the thread's own Markdown renderer, and rendered HTML cannot be typed back into
 * Markdown without a rich-text editor and a serialiser to match it (Gemini runs
 * one; that is a build, not a flag). So focus swaps to the source and blur swaps
 * back — no mode to remember, no button to find, and what you type is what is
 * saved.
 *
 * The scroller keeps its position across the swap: `preserveScroll` snapshots the
 * nearest scrollable ancestor and puts it back after the exchanged node lays out,
 * because the source is a different height from the document it replaces and the
 * default is a jump to the top.
 */
const preserveScroll = (node: HTMLElement | null): (() => void) => {
  let scroller: HTMLElement | null = node;
  while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return () => {};
  const top = scroller.scrollTop;
  return () => { scroller.scrollTop = top; };
};

export const CanvasProseView: React.FC<{
  content: string;
  className?: string;
  /** Absent = read-only. Called on a debounce, not per keystroke. */
  onContentChange?: (next: string) => void;
}> = ({ content, className = '', onContentChange }) => {
  const [draft, setDraft] = useCanvasDraft(content, onContentChange);
  const [editing, setEditing] = useState(false);
  const restoreRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore) restore();
  }, [editing]);

  if (!onContentChange) {
    return (
      <StreamingMarkdown
        text={content}
        isStreaming={false}
        animate={false}
        reveal={false}
        className={className}
      />
    );
  }

  if (editing) {
    return (
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          restoreRef.current = preserveScroll(event.currentTarget);
          setEditing(false);
        }}
        autoFocus
        spellCheck
        aria-label="Document"
        className={
          'gemini-chat-scrollbar block min-h-[320px] w-full resize-none border-0 bg-transparent '
          + 'p-0 text-[17px] font-normal leading-6 text-[#e3e3e3] outline-none '
          + `[field-sizing:content] ${className}`
        }
      />
    );
  }

  /*
   * `tabIndex` and a click handler rather than a `contenteditable`: the rendered
   * document is React's, and making it directly writable would let the browser
   * mutate a tree React owns — the edit would be reverted by the next render and
   * saved nowhere. Focus is the affordance; the swap is what makes it writable.
   */
  return (
    <div
      role="textbox"
      aria-label="Document"
      aria-multiline="true"
      tabIndex={0}
      onFocus={(event) => {
        restoreRef.current = preserveScroll(event.currentTarget);
        setEditing(true);
      }}
      onMouseDown={(event) => {
        /* A drag is a selection, not an edit: only a plain click enters the source.
           `detail === 0` is a keyboard-driven click, which focus already handled. */
        if (event.button !== 0 || event.detail === 0) return;
        restoreRef.current = preserveScroll(event.currentTarget);
        setEditing(true);
      }}
      className="outline-none focus-visible:outline-none"
    >
      <StreamingMarkdown
        text={content}
        isStreaming={false}
        animate={false}
        reveal={false}
        className={className}
      />
    </div>
  );
};

/**
 * Code body: the editor and the preview as SIBLINGS, switched by a `hidden` class.
 *
 * Measured, and the single most worthwhile thing to copy from the code panel:
 * Gemini's `div.container` holds `web-preview`, `xap-code-editor` and `console` at
 * once and toggles `.hidden` between them. Nothing is mounted or unmounted, so a
 * running app SURVIVES a trip to the Code tab — the iframe is never torn down and
 * never re-executes. Rendering `tab === 'code' ? <pre/> : <iframe/>` instead
 * restarts the document on every tab press, which for anything with state (a game,
 * a form, a timer) reads as the preview being broken.
 *
 * `display: none` is safe for that: unlike moving an iframe in the DOM, hiding it
 * does not reload its document.
 *
 * Editor geometry: `div.monaco-editor` at `124,60,1340,765` inside a panel at x=76,
 * i.e. a 48px inset on each side, first line at y=108 (48px down); `.view-line` is
 * 14px/19px w400 "Google Sans Code" `#ffffff` on `rgb(20,20,20)`, and
 * `.margin-view-overlays` measures 0 wide — LINE NUMBERS ARE OFF.
 *
 * ## Typing
 *
 * Gemini runs Monaco. Willow does not, and pulling one in for this would be a
 * megabyte of editor to get a caret — so `onContentChange` turns the body into a
 * transparent `<textarea>` sitting exactly on top of the highlighted `<pre>`, the
 * two sharing one box (see the note at the pair below). Highlighting is recomputed
 * synchronously on every keystroke for a reason that is not performance: the text
 * the user sees IS the `<pre>`, so a deferred re-highlight means typing into a
 * document that does not visibly change.
 */
/**
 * The editor's measured text metrics, shared by the `<pre>` that paints the
 * tokens and the `<textarea>` that takes the keystrokes.
 *
 * ONE constant, deliberately: the transparent-textarea-over-highlighted-pre
 * technique only works while the two agree to the pixel on family, size,
 * line-height and tab width. Two class strings drift, and the failure mode is
 * a caret that walks away from the glyphs as the line gets longer.
 */
const CANVAS_CODE_FONT_CLASS =
  "block bg-transparent font-['Google_Sans_Code',ui-monospace,SFMono-Regular,Consolas,monospace] "
  + 'text-[14px] font-normal leading-[19px] [tab-size:4]';

/**
 * A textarea whose value ends in a newline shows an empty last line and lets the
 * caret sit on it. A `<pre>` does not reliably generate that line box, so the
 * highlighted layer ends up one line SHORTER than the textarea it has to cover —
 * and the caret on that last line falls outside the scroll extent. A zero-width
 * space pins the line box without adding a visible character.
 */
const withTrailingLineBox = (value: string): string => (
  value.endsWith('\n') ? `${value}\u200b` : value
);

export const CanvasCodeView: React.FC<{
  doc: CanvasDoc;
  content: string;
  tab: CanvasTab;
  /** 48 in the panel, 0 in the card, where the body is already inset. */
  inset?: number;
  /**
   * Hold the iframe out of the DOM until the container has finished animating.
   * A hidden iframe still parses and RUNS its document, so mounting it during the
   * 500ms scale puts the model's script on the same main thread as the transition.
   * Once true it must stay true, or the sibling trick above is undone.
   */
  previewMounted?: boolean;
  /** Absent = read-only. Called on a debounce, not per keystroke. */
  onContentChange?: (next: string) => void;
}> = ({ doc, content, tab, inset = 48, previewMounted = true, onContentChange }) => {
  useInjectStyles();
  const previewable = isPreviewable(doc);
  /*
   * `wantPreview` is the TAB; `showPreview` is the tab and a frame to show for it.
   *
   * The gap between them is the panel's 500ms scale, and what fills it used to be
   * the CODE — on the theory that a blank panel reads as a bug. Reported as worse
   * than blank: "the codebase appears in the place of the preview… before the
   * flash". So the code body is hidden for the tab, not for the frame, and the
   * shell's own `rgb(20,20,20)` is what the deferral shows.
   */
  const wantPreview = previewable && tab === 'preview';
  const showPreview = wantPreview && previewMounted;
  /*
   * The white flash. A sub-frame paints its own base background — white — as soon
   * as it has a box, and the document's own background only lands once its style
   * has been parsed. So the frame is transparent until `load`, which is after that.
   *
   * A ONE-WAY LATCH, never reset: `srcDoc` changes on every committed edit, and
   * blinking the preview out at each one would be a worse artifact than the flash.
   * The timer is the fallback for a document whose `load` never arrives.
   */
  const [previewPainted, setPreviewPainted] = useState(false);
  useEffect(() => {
    if (!showPreview || previewPainted) return;
    const timer = window.setTimeout(() => setPreviewPainted(true), 400);
    return () => window.clearTimeout(timer);
  }, [showPreview, previewPainted]);
  const [draft, setDraft] = useCanvasDraft(content, onContentChange);
  const editable = !!onContentChange;
  /* The DRAFT is highlighted, not `content`, and synchronously — the caret sits
     over transparent text, so a debounced or deferred re-highlight is invisible
     typing. hljs on a canvas-sized document is sub-millisecond; the guard is for
     a pathological paste, where plain text beats a frozen tab. */
  const source = editable ? withTrailingLineBox(draft) : content;
  const html = useMemo(
    () => (source.length > 200_000
      /* `'text'` short-circuits inside `highlightedCode` to a plain HTML escape,
         which is the right answer for a document big enough that tokenising it
         per keystroke would drop frames. */
      ? highlightedCode(source, 'text')
      : highlightedCode(source, doc.language || 'html')),
    [source, doc.language],
  );
  const previewSource = useMemo(
    () => (previewable ? canvasPreviewDocument(editable ? draft : content) : ''),
    [previewable, editable, draft, content],
  );

  /*
   * What the shim relays, logged where the developer can see it. `event.origin` is
   * `"null"` for an opaque frame and cannot be checked, so the frame's own
   * `contentWindow` is the identity test — otherwise any page in any tab could
   * write into this console line.
   */
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== 'willow-canvas-preview') return;
      if (data.kind === 'error') console.warn(`[canvas preview] ${doc.title}: ${data.detail}`);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [doc.title]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[rgb(20,20,20)]">
      {previewable && previewMounted && (
        <iframe
          ref={frameRef}
          /* `aria-label`, NOT `title`: an iframe's title doubles as a native
             tooltip, so hovering anywhere in a running preview popped up the
             document's name — the panel already shows that name in its header. */
          aria-label={`${doc.title} preview`}
          /* NO `bg-white` HERE, AND THAT IS THE FIX FOR A WHITE HAIRLINE.
             A sub-frame rasterises on whole device pixels, but this card's edges do
             not sit on one: the bleeding card is `calc(100% + 245.6px)` wide and
             centred by `translateX(-50%)`, so its inner edge lands mid-pixel (the
             same snapping asymmetry as the Spark timeline connector). The frame's
             own raster starts at the next whole pixel, and whatever the ELEMENT's
             background is paints in the ~1px it left over — reported as a white
             vertical line down the left of a running preview.
             Removing it is safe rather than a trade: a document's white base
             background is painted by the sub-frame itself, not by this element, so
             a document that declares no background of its own still comes up white.
             This background was only ever visible in the seam, and in the seam the
             shell's `rgb(20,20,20)` is what should show. */
          className={
            showPreview
              ? `h-full w-full border-0 transition-opacity duration-200 ${
                previewPainted ? 'opacity-100' : 'opacity-0'
              }`
              : 'hidden'
          }
          onLoad={() => setPreviewPainted(true)}
          sandbox={CANVAS_PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={previewSource}
        />
      )}
      {/* `.smd-code-tokens` is the hljs PALETTE and nothing else. This used to say
          `.smd-code-block`, which carried the palette and the whole markdown block
          with it: `overflow: clip` (so neither axis could be scrolled, by wheel or
          by script — the reported "I still cant scroll down vertically or
          horizontally"), `margin: 16px -16px 0`, a 40px radius, `rgb(23,23,23)` and
          32px of padding fighting `inset`. The metrics here are the canvas's own
          14/19, not the markdown block's 14/21. */}
      <div
        className={
          wantPreview
            ? 'hidden'
            : 'smd-code-tokens gemini-chat-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain'
        }
      >
        {/* Editing is a TEXTAREA UNDER THE HIGHLIGHTING, not a contenteditable.
            The two share one box: the `<pre>` sizes it and paints the tokens, the
            textarea sits on top with transparent text and a visible caret, so
            selection, undo, IME, autoscroll-to-caret and every keyboard habit are
            the browser's own rather than reimplemented. `w-max` on the wrapper is
            what makes the pair scroll horizontally as one thing — the textarea is
            `inset-0` of the widest line, not of the viewport. */}
        <div className={`relative ${editable ? 'w-max min-w-full' : ''}`}>
          <pre
            className="m-0 w-max min-w-full bg-transparent"
            style={{ padding: inset }}
            aria-hidden={editable || undefined}
          >
            <code
              className={`hljs ${CANVAS_CODE_FONT_CLASS} text-white`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
          {editable && (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              wrap="off"
              aria-label={`Edit ${doc.title}`}
              className={
                'absolute inset-0 resize-none overflow-hidden whitespace-pre border-0 outline-none '
                + 'text-transparent caret-white selection:bg-[rgba(255,255,255,0.22)] '
                + CANVAS_CODE_FONT_CLASS
              }
              style={{ padding: inset }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * The prose panel's quick-actions rail.
 *
 * `immersive-editor-side-panel` `1432,64,84,582.79` — `position: sticky; top: 0`,
 * `padding-left: 24px`, `min-width: 64px` — holding
 * `div.immersive-editor-quick-actions.gds-elevation-3` `1456,64,40,136`:
 * `border-radius: 9999px`, `background: rgb(19,19,20)`, and the elevation-3 triple
 * shadow spelled out below. Inside it, `div.action-buttons-container` is `40x128`
 * with `padding: 4px 0` and `gap: 4px`, holding three 40x40 fabs — `Length` at
 * y=68, `Tone` at 112, `Suggest` at 156, i.e. a 44px pitch. 40*3 + 4*2 + 4 + 4 = 136.
 *
 * Two departures, both deliberate:
 *
 *  - Gemini's container is `overflow: hidden`, which clips its fabs' ripples. It
 *    would also clip a menu opening out of it, so it is dropped here.
 *  - The glyphs and the menu contents are Willow's. The rail was captured as three
 *    labelled buttons; neither the icon ligatures nor the menus behind them were
 *    read, so these are plain Material Symbols and the items are the edits the
 *    labels promise. Each one sends an ordinary follow-up prompt, which is what
 *    makes them work at all: the canvas tool already handles "make it shorter" as a
 *    targeted update to the current document.
 */
export const CanvasQuickActions: React.FC<{ onPrompt: (text: string) => void }> = ({ onPrompt }) => (
  <div className="sticky top-0 flex shrink-0 justify-end self-start pl-6">
    <div
      className="flex w-10 flex-col items-center rounded-full bg-[rgb(19,19,20)] py-1"
      style={{
        boxShadow:
          'rgba(0,0,0,.2) 0 3px 5px -1px, rgba(0,0,0,.14) 0 6px 10px 0, rgba(0,0,0,.12) 0 1px 18px 0',
      }}
    >
      <div className="flex flex-col gap-1">
        <CanvasMenuFab
          icon="format_line_spacing"
          label="Length"
          items={[
            { id: 'shorter', label: 'Shorter', icon: 'compress', onSelect: () => onPrompt('Make the canvas shorter, keeping every key point.') },
            { id: 'longer', label: 'Longer', icon: 'expand', onSelect: () => onPrompt('Make the canvas longer, adding useful detail rather than filler.') },
          ]}
        />
        <CanvasMenuFab
          icon="mood"
          label="Tone"
          items={[
            { id: 'professional', label: 'More professional', icon: 'work', onSelect: () => onPrompt('Rewrite the canvas in a more professional tone.') },
            { id: 'casual', label: 'More casual', icon: 'chat_bubble', onSelect: () => onPrompt('Rewrite the canvas in a more casual, conversational tone.') },
            { id: 'simpler', label: 'Simpler language', icon: 'school', onSelect: () => onPrompt('Rewrite the canvas in simpler language, without losing accuracy.') },
          ]}
        />
        <CanvasMenuFab
          icon="edit_note"
          label="Suggest"
          items={[
            { id: 'suggest', label: 'Suggest edits', icon: 'lightbulb', onSelect: () => onPrompt('Suggest specific edits that would improve the canvas, then apply the ones you are confident about.') },
            { id: 'proofread', label: 'Proofread', icon: 'spellcheck', onSelect: () => onPrompt('Proofread the canvas and fix any spelling, grammar or consistency problems.') },
          ]}
        />
      </div>
    </div>
  </div>
);

/** Export (prose) and Download (code) share one builder so the panel and the card
 *  cannot drift apart on what those buttons do. */
export const canvasExportItems = (doc: CanvasDoc, content: string): CanvasMenuItem[] => [
  {
    id: 'copy',
    label: doc.kind === 'code' ? 'Copy code' : 'Copy as Markdown',
    icon: 'content_copy',
    family: 'google-symbols',
    onSelect: () => { void copyCanvas(content); },
  },
  {
    id: 'download',
    label: `Download ${canvasFileName(doc)}`,
    icon: 'download',
    family: 'google-symbols',
    onSelect: () => downloadCanvas(doc, content),
  },
];
