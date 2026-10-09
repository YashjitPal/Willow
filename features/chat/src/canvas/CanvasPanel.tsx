/**
 * The full-screen Canvas panel — Gemini's `immersive-panel` in `full-width-immersive`.
 *
 * Reached from the expanded card's `Fullscreen`. On a desktop it fills ChatView's
 * one-track grid edge to edge (Gemini leaves 24px a side; see canvas.css), full
 * height, rgb(31,31,31), no border or radius, while the chat column above it shows
 * nothing but the "Ask Willow" fab (ChatView owns that). Below 960px it is fixed over
 * the whole app.
 *
 * The enter values are Gemini's `immersivePanelTransitions`, read off the running
 * app through `effect.getKeyframes()` the instant the node is inserted:
 *
 *   transform: scale(0.6) -> scale(1)   500ms cubic-bezier(0.2, 0, 0, 1)
 *   opacity:   0 -> 1                   200ms linear
 *
 * `origin-center` is required by that. THERE IS NO LEAVE ANIMATION, which is
 * Gemini's behaviour: collapsing removes the node in one frame and the chat column
 * slides back in from translateX(-20%) (see `immersiveControls` in ChatView).
 *
 * ## The toolbar
 *
 * Desktop (60px, padding 0 32px, gap 8): a left panel (8px in) holding the title
 * (17/24 w370), the 40px versioning trio, and — prose only — a divider, the Styles
 * menu, a divider and `more_vert`, which toggles the formatting row under it. Then
 * the actions (12px in, gap 8): Export (prose) or Code/Preview + Download + Show
 * console (code), the 24px Share, and the 56px Collapse.
 *
 * <=960px (padding 0 16px, space-between): Collapse becomes a leading
 * `chevron_left`; the title (tablet only) and `more_vert` follow, and everything
 * else folds into the panel `more_vert` opens. Export or Code/Preview and Share stay.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  CanvasCodeView,
  CanvasExportMenu,
  CanvasFormatButtons,
  CanvasIcon,
  CanvasIconButton,
  CanvasPill,
  CanvasStylesMenu,
  CanvasTabToggle,
  CanvasVersionNav,
  canvasExportItems,
  downloadCanvas,
  type CanvasConsoleLine,
  type CanvasFormatActions,
  type CanvasTab,
} from './canvas-view';
import { CanvasRichEditor, type CanvasEditorHandle, type CanvasEditorSelection } from './CanvasRichEditor';
import { CanvasCoCreateInput, CanvasSelectionPrompt, shareCanvas } from './CanvasPrompt';
import type { CanvasBlockKind } from './canvas-markdown';
import { clampVersion, isPreviewable, type CanvasDoc } from './canvas-store';

export interface CanvasPanelProps {
  doc: CanvasDoc;
  /** Index into `doc.versions`; clamped here, so a stale value is harmless. */
  version: number;
  onVersionChange: (version: number) => void;
  /** `Collapse` — back to the inline card, never a discard. */
  onCollapse: () => void;
  /** Sends an ordinary follow-up turn: selection prompts, Add Gemini features, select-and-ask. */
  onPrompt: (text: string) => void;
  /** Write an edit back to the document. Absent = read-only, which is what a turn in flight is. */
  onEditContent?: (content: string) => void;
}

const COMPACT_QUERY = '(max-width: 959.98px)';

const useCompact = (): boolean => {
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
};

/** Closes a toggled panel on an outside press or Escape. */
const useOutside = (open: boolean, close: () => void) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) closeRef.current(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return ref;
};

const ADD_GEMINI_FEATURES_PROMPT = 'Add Gemini features to this app: use the Gemini API to make it smarter and more interactive.';

export function CanvasPanel({
  doc,
  version,
  onVersionChange,
  onCollapse,
  onPrompt,
  onEditContent,
}: CanvasPanelProps) {
  const compact = useCompact();
  const shown = clampVersion(doc, version);
  const snapshot = doc.versions[shown];
  const content = snapshot ? snapshot.content : '';
  /* An older version carries its own title: scrubbing back shows what it was called then. */
  const title = (snapshot && snapshot.title) || doc.title;
  const editable = !!onEditContent;

  const previewable = doc.kind === 'code' && isPreviewable(doc);
  const [tab, setTab] = useState<CanvasTab>(previewable ? 'preview' : 'code');
  /* A document can stop being previewable between versions (HTML -> Python). */
  useEffect(() => {
    if (!previewable) setTab('code');
  }, [previewable]);

  /* Mounting an iframe during the 500ms scale costs a layout+paint on every frame of
   * it. 700ms is the animation plus slack; `onAnimationComplete` normally gets there first. */
  const [embedReady, setEmbedReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setEmbedReady(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      /* Kept mounted behind another tab (`inert`), the chat leaves the Escape to the tab on show. */
      if (panelRef.current?.closest('[inert]')) return;
      /* Menus, the editor and the prompts stop their own Escape, so reaching here
       * means nothing smaller was open. */
      event.stopPropagation();
      onCollapse();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCollapse]);

  const exportItems = useMemo(() => canvasExportItems(doc, content), [doc, content]);

  /* ---- prose: the editor and its tools ---- */
  const editorRef = useRef<CanvasEditorHandle | null>(null);
  const [block, setBlock] = useState<CanvasBlockKind>('p');
  const [selection, setSelection] = useState<CanvasEditorSelection | null>(null);
  const formatActions: CanvasFormatActions = {
    bold: () => editorRef.current?.bold(),
    italic: () => editorRef.current?.italic(),
    bulletedList: () => editorRef.current?.bulletedList(),
    numberedList: () => editorRef.current?.numberedList(),
    inlineEquation: () => editorRef.current?.insertEquation(false),
    blockEquation: () => editorRef.current?.insertEquation(true),
  };
  const [formatRowOpen, setFormatRowOpen] = useState(false);
  const formatRowRef = useOutside(formatRowOpen, () => setFormatRowOpen(false));
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useOutside(overflowOpen, () => setOverflowOpen(false));

  /* ---- code: console, floating tools, select-and-ask ---- */
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleExpanded, setConsoleExpanded] = useState(false);
  const [consoleLines, setConsoleLines] = useState<CanvasConsoleLine[]>([]);
  const [consoleUnread, setConsoleUnread] = useState(false);
  const consoleSeq = useRef(0);
  const consoleOpenRef = useRef(consoleOpen);
  consoleOpenRef.current = consoleOpen;
  const onConsole = (line: Omit<CanvasConsoleLine, 'id'>) => {
    consoleSeq.current += 1;
    const next = { ...line, id: consoleSeq.current };
    setConsoleLines((lines) => [...lines.slice(-499), next]);
    if (!consoleOpenRef.current) setConsoleUnread(true);
  };
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const versionNav = (
    <CanvasVersionNav
      versionCount={doc.versions.length}
      version={shown}
      onVersionChange={onVersionChange}
      variant="panel"
    />
  );

  const stylesMenu = (
    <CanvasStylesMenu
      current={block}
      disabled={!editable}
      onSelect={(kind) => { editorRef.current?.setBlock(kind); setBlock(kind); }}
    />
  );

  /* While a turn is writing, Gemini dims the toolbar's outputs: there is nothing settled to hand out. */
  const share = (
    <CanvasIconButton
      icon="share"
      label={compact ? 'Share Canvas' : 'Share and export canvas'}
      tooltip="Share & export"
      size={24}
      disabled={!editable}
      className="cv-share"
      onClick={() => shareCanvas(doc, content)}
    />
  );

  const download = <CanvasPill icon="download" label="Download" disabled={!editable} onClick={() => downloadCanvas(doc, content)} />;

  const toolbar = compact ? (
    <div className="cv-toolbar">
      <div className="cv-toolbar__left">
        <CanvasIconButton icon="chevron_left" family="luminous" label="Collapse" size={56} onClick={onCollapse} />
        <div ref={overflowRef} className="cv-overflow">
          <h2 className="cv-toolbar__title">{title}</h2>
          <CanvasIconButton
            icon="more_vert"
            label="More options"
            tooltip="More"
            size={40}
            expanded={overflowOpen}
            onClick={() => setOverflowOpen((open) => !open)}
          />
          {overflowOpen && (
            <div className="cv-overflow-panel">
              {versionNav}
              {doc.kind === 'code' ? download : (
                <>
                  {stylesMenu}
                  <div className="cv-divider" />
                  <CanvasFormatButtons actions={formatActions} disabled={!editable} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="cv-toolbar__actions">
        {doc.kind === 'code'
          ? (previewable ? <CanvasTabToggle tab={tab} onChange={setTab} /> : null)
          : <CanvasExportMenu items={exportItems} disabled={!editable} />}
        {share}
      </div>
    </div>
  ) : (
    <div className="cv-toolbar">
      <div className="cv-toolbar__left">
        <h2 className="cv-toolbar__title">{title}</h2>
        {versionNav}
        {doc.kind === 'text' && (
          <div className="cv-toolbar__group">
            <div className="cv-divider" />
            {stylesMenu}
            <div className="cv-divider" />
            {/* Not positioned, so the row below anchors to the left panel, as Gemini's does. */}
            <div ref={formatRowRef} className="cv-toolbar__group">
              <CanvasIconButton
                icon="more_vert"
                label="More formatting options"
                size={40}
                expanded={formatRowOpen}
                onClick={() => setFormatRowOpen((open) => !open)}
              />
              {formatRowOpen && (
                <div className="cv-floating-editor">
                  <CanvasFormatButtons actions={formatActions} disabled={!editable} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="cv-toolbar__actions">
        {doc.kind === 'code' ? (
          <>
            {previewable && <CanvasTabToggle tab={tab} onChange={setTab} />}
            {download}
            <span className="relative inline-flex">
              <CanvasIconButton
                icon="terminal"
                label="Show console"
                tooltip="Show console"
                size={24}
                pressed={consoleOpen}
                onClick={() => {
                  setConsoleOpen((open) => !open);
                  setConsoleUnread(false);
                }}
              />
              {consoleUnread && <span className="cv-badge" aria-label="unread" />}
            </span>
          </>
        ) : (
          <CanvasExportMenu items={exportItems} disabled={!editable} />
        )}
        {share}
        <CanvasIconButton icon="collapse_content" family="luminous" label="Collapse" tooltip="Collapse" size={56} onClick={onCollapse} />
      </div>
    </div>
  );

  const panel = (
    <motion.aside
      ref={panelRef}
      aria-label={`${title} canvas`}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      onAnimationComplete={() => setEmbedReady(true)}
      transition={{
        scale: { duration: 0.5, ease: [0.2, 0, 0, 1] },
        opacity: { duration: 0.2, ease: 'linear' },
      }}
      className="cv-scope cv-panel origin-center transform-gpu"
    >
      {toolbar}

      {doc.kind === 'code' ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <CanvasCodeView
            doc={doc}
            content={content}
            tab={tab}
            inset={48}
            previewMounted={embedReady}
            onContentChange={onEditContent}
            onConsole={onConsole}
            frameRef={frameRef}
            overlay={<CanvasPreviewTools compact={compact} frameRef={frameRef} onPrompt={onPrompt} />}
          />
          {consoleOpen && (
            <div className={`cv-console${consoleExpanded ? ' cv-console--expanded' : ''}`}>
              <div className="cv-console__header">
                <span className="cv-console__title">Console</span>
                <div className="flex items-center">
                  <CanvasIconButton
                    icon={consoleExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
                    label="Toggle expansion"
                    size={40}
                    onClick={() => setConsoleExpanded((value) => !value)}
                  />
                  <CanvasIconButton icon="close" label="Close console" size={40} onClick={() => setConsoleOpen(false)} />
                </div>
              </div>
              <div className="cv-console__output gemini-chat-scrollbar">
                {consoleLines.map((line) => (
                  <div key={line.id} className={`cv-console__line--${line.level}`}>{line.text}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* No reserved gutter: Gemini's text column is the full 1328 until it overflows. */
        <div className="cv-panel__scroll gemini-chat-scrollbar">
          <div className="cv-panel__doc">
            <CanvasRichEditor
              ref={editorRef}
              content={content}
              onContentChange={onEditContent}
              onBlockChange={setBlock}
              onSelectionChange={setSelection}
            />
          </div>
        </div>
      )}
      {selection && doc.kind === 'text' && (
        <CanvasSelectionPrompt
          selection={selection}
          onSend={(text) => { setSelection(null); onPrompt(text); }}
          onDismiss={() => setSelection(null)}
        />
      )}
    </motion.aside>
  );
  /*
   * Below 960px the panel covers the whole app, top bar included, as Gemini's does.
   * Inside ChatView it cannot: an ancestor's stacking context caps it under the
   * shell's mobile header, whose icons then sit on the toolbar and take its taps.
   * So it is portalled to the body there.
   */
  return compact && typeof document !== 'undefined' ? createPortal(panel, document.body) : panel;
}

/**
 * The preview's floating tools: drag handle, Add Gemini features, select-and-ask.
 * 40x128 pill, 20px in from the bottom-right corner; drag moves it. On a phone or
 * tablet select-and-ask is not offered, and the pill is the top two.
 */
const CanvasPreviewTools: React.FC<{
  compact: boolean;
  frameRef: React.MutableRefObject<HTMLIFrameElement | null>;
  onPrompt: (text: string) => void;
}> = ({ compact, frameRef, onPrompt }) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selecting, setSelecting] = useState(false);
  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const start = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    const move = (e: PointerEvent) => setOffset({ x: e.clientX - start.x, y: e.clientY - start.y });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <>
      {selecting && (
        <CanvasSelectAsk frameRef={frameRef} onPrompt={onPrompt} onDone={() => setSelecting(false)} />
      )}
      <div className="cv-float-tools" style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}>
        <div className="cv-float-tools__pill">
          <div className="cv-float-tools__drag" aria-label="Select and hold to move" onPointerDown={startDrag}>
            <CanvasIcon name="drag_indicator" size={20} weight={400} />
          </div>
          <button
            type="button"
            aria-label="Add Gemini features"
            title="Add Gemini features"
            className={`cv-float-tool${compact ? ' cv-float-tool--last' : ''}`}
            onClick={() => onPrompt(ADD_GEMINI_FEATURES_PROMPT)}
          >
            <CanvasIcon name="button_magic" size={20} weight={400} />
          </button>
          {!compact && (
            <button
              type="button"
              aria-label="Select and ask"
              title="Select and ask"
              aria-pressed={selecting}
              className="cv-float-tool cv-float-tool--last"
              onClick={() => setSelecting((value) => !value)}
            >
              <CanvasIcon name="ink_selection" size={20} weight={400} />
            </button>
          )}
        </div>
      </div>
    </>
  );
};

/**
 * Select and ask: a crosshair layer over the running preview; drag out a rectangle
 * (radius 12, a white 2px stroke with Gemini's blue-blue-pink glow), and a
 * "Describe changes" pill opens 10px under it, left-aligned. The frame reports the
 * elements inside the rectangle, and those go to the model with the request.
 */
const CanvasSelectAsk: React.FC<{
  frameRef: React.MutableRefObject<HTMLIFrameElement | null>;
  onPrompt: (text: string) => void;
  onDone: () => void;
}> = ({ frameRef, onPrompt, onDone }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [settled, setSettled] = useState(false);
  const [elements, setElements] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDone();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (data && data.source === 'willow-canvas-preview' && data.kind === 'region') setElements(String(data.detail));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef]);

  const point = (event: React.PointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    setSettled(false);
    setElements('');
    setRect({ x: start.x, y: start.y, w: 0, h: 0 });
    const target = event.currentTarget;
    const move = (e: PointerEvent) => {
      const box = target.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      setRect({ x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) });
    };
    const up = (e: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      move(e);
      setSettled(true);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  /* Ask the frame what the rectangle covers once it is drawn. */
  useEffect(() => {
    if (!settled || !rect || rect.w < 4 || rect.h < 4) return;
    frameRef.current?.contentWindow?.postMessage({ source: 'willow-canvas-host', kind: 'region', rect }, '*');
  }, [settled, rect, frameRef]);

  return (
    <>
      <svg ref={svgRef} className="cv-select-ask" onPointerDown={onPointerDown}>
        <defs>
          <filter id="cv-select-shadows">
            <feDropShadow dx="-0.8" dy="0" floodColor="#3271EA" stdDeviation="2" result="shadow1" />
            <feDropShadow dx="0" dy="0.8" floodColor="#4C8DF6" stdDeviation="2" result="shadow2" />
            <feDropShadow dx="0.8" dy="0" floodColor="#FF7DD2" stdDeviation="1" result="shadow3" />
            <feMerge>
              <feMergeNode in="shadow1" />
              <feMergeNode in="shadow2" />
              <feMergeNode in="shadow3" />
            </feMerge>
          </filter>
        </defs>
        {rect && (
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            rx={12}
            ry={12}
            fill="transparent"
            filter="url(#cv-select-shadows)"
            style={{ stroke: 'rgb(255, 255, 255)', strokeWidth: 2 }}
          />
        )}
      </svg>
      {settled && rect && rect.w >= 4 && rect.h >= 4 && (
        <div className="cv-select-ask__box" style={{ left: rect.x, top: rect.y + rect.h + 10 }}>
          <CanvasCoCreateInput
            placeholder="Describe changes"
            autoFocus
            onEscape={onDone}
            onSend={(text) => {
              onDone();
              onPrompt(
                elements
                  ? `In the preview, I selected the area containing:\n${elements}\n\n${text}`
                  : `In the preview, I selected an area ${Math.round(rect.w)}x${Math.round(rect.h)}px at (${Math.round(rect.x)}, ${Math.round(rect.y)}).\n\n${text}`,
              );
            }}
          />
        </div>
      )}
    </>
  );
};
