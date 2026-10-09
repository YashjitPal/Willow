/**
 * The inline Canvas card — the document as it appears INSIDE the thread.
 *
 * Two states, and they are not the same element resized:
 *
 *  - Collapsed (708x133): the chip, `gem-processing-card.completed`. Pressing it, or
 *    its `Open`, EXPANDS IT IN PLACE — that is what Gemini's chip does now; the
 *    full-screen view is the expanded card's own `Fullscreen` button.
 *  - Expanded (948x900): `.inline-preview-container`, rgb(31,31,31), radius 40, no
 *    border, a 72px title row over an 828px body that scrolls. It BLEEDS 120px past
 *    each side of the 708px column, centred by `left:50%` + `translateX(-50%)`.
 *
 * THE BLEED IS GATED, DELIBERATELY. A card wider than its column makes the whole
 * shell scroll horizontally at narrow widths, which broke ChatView's grid twice. It
 * is therefore opt-in per card (`bleed`) AND behind `min-width: 1200px` in canvas.css.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  CanvasCodeView,
  CanvasExportMenu,
  CanvasIconButton,
  CanvasPill,
  CanvasTabToggle,
  CanvasVersionNav,
  canvasExportItems,
  downloadCanvas,
  type CanvasTab,
} from './canvas-view';
import { CanvasRichEditor, type CanvasEditorSelection } from './CanvasRichEditor';
import { CanvasSelectionPrompt, shareCanvas } from './CanvasPrompt';
import {
  clampVersion,
  formatCanvasTimestamp,
  isPreviewable,
  type CanvasDoc,
} from './canvas-store';

export interface CanvasCardProps {
  doc: CanvasDoc;
  /** The version THIS turn produced — the card is a snapshot, not a live view. */
  version: number;
  expanded: boolean;
  /** The chip and its `Open` expand the card; the expanded card's `Close` collapses it. */
  onToggleExpanded: () => void;
  /** `Fullscreen`: hands the document to `$openCanvas`, the full-screen panel. */
  onOpen: () => void;
  /**
   * Write an edit back to the document. Absent = read-only, which is what a turn in
   * flight is: the runner owns `messages` for its duration.
   */
  onEditContent?: (content: string) => void;
  /** Ask about a selection — the "Ask Willow" field under selected text. */
  onPrompt?: (text: string) => void;
  /** Off unless the thread has room — the horizontal-scrollbar hazard above. */
  bleed?: boolean;
}

const KIND_ICON = {
  text: { icon: 'article', family: 'luminous' as const },
  code: { icon: 'code_blocks', family: 'luminous' as const },
};

export function CanvasCard({
  doc,
  version,
  expanded,
  onToggleExpanded,
  onOpen,
  onEditContent,
  onPrompt,
  bleed = false,
}: CanvasCardProps) {
  /*
   * The card opens at the version its turn wrote, but its own undo/redo still scrub —
   * Gemini puts the versioning trio in the card's title row too. Local state,
   * re-seeded whenever the anchor moves.
   */
  const [shownVersion, setShownVersion] = useState(version);
  useEffect(() => setShownVersion(version), [version]);

  const shown = clampVersion(doc, shownVersion);
  const snapshot = doc.versions[shown];
  const content = snapshot ? snapshot.content : '';
  const title = (snapshot && snapshot.title) || doc.title;

  const previewable = doc.kind === 'code' && isPreviewable(doc);
  const [tab, setTab] = useState<CanvasTab>(previewable ? 'preview' : 'code');
  useEffect(() => {
    if (!previewable) setTab('code');
  }, [previewable]);

  /*
   * EVERY version is writable, including one scrubbed back to: the edit lands on the
   * document's current text, so typing into an older revision carries it forward.
   * What would be wrong is leaving the view on the old index afterwards, so an edit
   * this card originated pulls it to the end, where its text now is.
   */
  const followEditRef = useRef(false);
  const versionCount = doc.versions.length;
  useEffect(() => {
    if (!followEditRef.current) return;
    followEditRef.current = false;
    setShownVersion(versionCount - 1);
  }, [versionCount]);
  const editContent = onEditContent
    ? (next: string) => {
      followEditRef.current = true;
      onEditContent(next);
    }
    : undefined;

  const [selection, setSelection] = useState<CanvasEditorSelection | null>(null);
  const exportItems = useMemo(() => canvasExportItems(doc, content), [doc, content]);
  const kind = KIND_ICON[doc.kind];
  /* The chip's second line is a TIMESTAMP. Refs written before `createdAt` existed
   * have none, and inventing a date for them would be a lie, so those fall back to
   * the kind-and-version line. */
  const stamp = snapshot && snapshot.createdAt ? formatCanvasTimestamp(snapshot.createdAt) : '';
  const subtitle = stamp || `${doc.kind === 'code' ? 'Code' : 'Document'} · ${
    doc.versions.length > 1 ? `Version ${shown + 1} of ${doc.versions.length}` : 'Canvas'
  }`;

  if (!expanded) {
    /*
     * The chip, measured. `gem-processing-card.completed`: radius 28px, bg
     * rgb(23,23,23), NO border, margin 12px 0, 133px tall — 20 + 28 + 4 + 17 + 8 +
     * 36 + 20 — with the 28px status icon (`article`, Luminous Symbols w260) setting
     * the title row. There is no preview inside it: the body is the timestamp alone,
     * and `Open` is below, right-aligned, FILLED rgb(31,59,155) — the only saturated
     * fill in the thread. The whole card is pressable.
     */
    return (
      <div
        onClick={onToggleExpanded}
        className="my-3 w-full cursor-pointer overflow-hidden rounded-[28px] bg-[rgb(23,23,23)]"
      >
        <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-4 p-5">
          <MaterialSymbol
            name={kind.icon}
            family={kind.family}
            size={28}
            weight={260}
            roundness={100}
            opticalSize={28}
            className="shrink-0 text-[#e3e3e3]"
          />
          <span className="max-w-[620px] truncate text-[17px] font-normal leading-6 text-[rgb(230,230,230)]">
            {title}
          </span>
          <div className="col-start-2 mb-2 mt-1 min-w-0">
            <span className="block truncate text-[13px] font-normal leading-[17px] text-[rgba(255,255,255,0.55)]">
              {subtitle}
            </span>
          </div>
          <div className="col-start-2 flex h-9 items-center justify-end">
            <button
              type="button"
              /* The card behind it does the same thing; stopping here keeps one press
                 from being two toggles. */
              onClick={(event) => { event.stopPropagation(); onToggleExpanded(); }}
              aria-label={`Open ${title} in Canvas`}
              style={{ minWidth: 62 }}
              className="relative flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-[color:var(--sync-1f3b9b,rgb(31,59,155))] px-3 text-[15px] font-normal leading-5 text-[rgb(230,230,230)] outline-none before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:transition-opacity before:content-[''] hover:before:opacity-[0.08] focus-visible:before:opacity-[0.12]"
            >
              <span className="relative">Open</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`cv-scope cv-card${bleed ? ' cv-card--bleed' : ''}`}>
      {/* `.title-container`: padding 8px 28px, 8px gaps, the title taking what is left
          so the versioning trio sits against the actions. On a phone it wraps: title
          and trio on one line, the actions right-aligned under them. The actions are
          one group so that a row too narrow for them all moves them down together
          rather than sliding them under the title. */}
      <div className="cv-card__head">
        <div className="cv-card__title-wrap">
          <span className="cv-card__title">{title}</span>
          <CanvasVersionNav
            versionCount={doc.versions.length}
            version={shown}
            onVersionChange={setShownVersion}
            variant="card"
          />
        </div>
        <div className="cv-card__actions">
          {previewable && <CanvasTabToggle tab={tab} onChange={setTab} />}
          {doc.kind === 'code' ? (
            <CanvasPill icon="download" label="Download" onClick={() => downloadCanvas(doc, content)} />
          ) : (
            <CanvasExportMenu items={exportItems} />
          )}
          <CanvasIconButton icon="share_2" family="luminous" label="Share" tooltip="Share" onClick={() => shareCanvas(doc, content)} />
          <CanvasIconButton icon="expand_content" family="luminous" label="Fullscreen" tooltip="Fullscreen" onClick={onOpen} />
          <CanvasIconButton icon="close" family="luminous" label="Close" tooltip="Close" onClick={onToggleExpanded} />
        </div>
      </div>

      {/* Code is edge to edge — its iframe measured the full 948px inner width. */}
      {doc.kind === 'code' ? (
        <div className="cv-card__body cv-card__body--code">
          <CanvasCodeView doc={doc} content={content} tab={tab} inset={0} onContentChange={editContent} />
        </div>
      ) : (
        <div className="cv-card__body gemini-chat-scrollbar">
          <CanvasRichEditor
            content={content}
            onContentChange={editContent}
            onSelectionChange={onPrompt ? setSelection : undefined}
          />
        </div>
      )}
      {selection && onPrompt && (
        <CanvasSelectionPrompt
          selection={selection}
          onSend={(text) => { setSelection(null); onPrompt(text); }}
          onDismiss={() => setSelection(null)}
        />
      )}
    </div>
  );
}
