/**
 * The inline Canvas card — the document as it appears INSIDE the thread.
 *
 * Two states, and they are not the same element resized:
 *
 *  - Collapsed (708x133): the chip. Re-measured off the live app for this pass,
 *    because Willow's first attempt guessed a code preview into it and that is
 *    not what Gemini shows — see the block comment at the collapsed branch for
 *    the full readout. It is what pressing `close` on the panel leaves behind,
 *    and what every follow-up turn that touches a canvas appends its own copy of
 *    — a 2-document / 7-edit thread held NINE chips, one per turn, each frozen at
 *    the version that turn produced.
 *  - Expanded (949.6x901.6): a rounded container that BLEEDS 120.8px past each side of
 *    the 708px text column, holding a 72px title row over an 828px body.
 *
 * Expanding is not exclusive with the panel and does not replace it: Gemini keeps
 * `expand_content` in the expanded card's own title row, so the card is a second way
 * to read the document rather than a step on the way to the panel.
 *
 * THE BLEED IS GATED, DELIBERATELY. A card wider than its column makes the whole
 * shell scroll horizontally at narrow widths, which is the exact failure that broke
 * ChatView's grid twice (see the notes there). It is therefore opt-in per card
 * (`bleed`) AND behind `min-[1200px]:`, so the card is column-width until there is
 * provably room for the overhang.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  CanvasCodeView,
  CanvasIconButton,
  CanvasMenuPill,
  CanvasPill,
  CanvasProseView,
  CanvasTabSwitch,
  CanvasVersionNav,
  canvasExportItems,
  downloadCanvas,
  type CanvasTab,
} from './canvas-view';
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
  /** `expand_content` on the card, `close` on the expanded card's title row. */
  onToggleExpanded: () => void;
  /** `Open` / the panel: hands the document to `$openCanvas`. */
  onOpen: () => void;
  /**
   * Write an edit back to the document. Absent = read-only, which is what a turn in
   * flight is: the runner owns `messages` for its duration. Present for every
   * version, including an older one — see `editContent` in the body.
   */
  onEditContent?: (content: string) => void;
  /**
   * Off unless the thread has room. See the note above — this is the horizontal
   * scrollbar hazard, not a style preference.
   */
  bleed?: boolean;
}

/** 28.8px of padding each side of the expanded card's 948px inner box (measured). */
const CARD_INSET_CLASS = 'pl-7 pr-7';

/** `rgb(31,31,31)` on a 0.8px `rgba(255,255,255,0.12)` border, 40px radius. */
const CARD_SHELL_CLASS = 'overflow-hidden border-[0.8px] border-white/[0.12] bg-[rgb(31,31,31)]';

const KIND_ICON = {
  text: { icon: 'draft', family: 'google-symbols' as const },
  /* `code_blocks` is in neither subset face, so it comes off the full family. */
  code: { icon: 'code_blocks', family: 'material-rounded' as const },
};

export function CanvasCard({
  doc,
  version,
  expanded,
  onToggleExpanded,
  onOpen,
  onEditContent,
  bleed = false,
}: CanvasCardProps) {
  /*
   * The card is anchored to the turn that wrote it, so `version` is what it opens at,
   * but its own undo/redo still scrub — Gemini puts the versioning trio in the card's
   * title row, not just the panel's. Local state, re-seeded whenever the anchor moves
   * (a later turn rewriting this document appends a new card; this one does not follow
   * it, which is the whole point of a per-turn snapshot).
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
   * EVERY version is writable, including one scrubbed back to.
   *
   * The edit always lands on the document's current text — `applyCanvasEdit` writes
   * the newest ref — so typing into an older revision means "carry this text
   * forward", not "rewrite history". What would be wrong is leaving the view behind
   * on the old index afterwards, because the user's own keystroke would appear to
   * vanish into a version they are not looking at. So an edit this card originated
   * pulls it to the end, where its text now is.
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

  const exportItems = useMemo(() => canvasExportItems(doc, content), [doc, content]);
  const kind = KIND_ICON[doc.kind];
  /* The measured chip's second line is a TIMESTAMP. Refs written before
   * `createdAt` existed have none, and inventing a date for them would be a lie,
   * so those fall back to the kind-and-version line this card used to show. */
  const stamp = snapshot && snapshot.createdAt ? formatCanvasTimestamp(snapshot.createdAt) : '';
  const subtitle = stamp || `${doc.kind === 'code' ? 'Code' : 'Document'} · ${
    doc.versions.length > 1 ? `Version ${shown + 1} of ${doc.versions.length}` : 'Canvas'
  }`;

  if (!expanded) {
    /*
     * The chip, re-measured off the live app (nine of them in one thread, eight
     * collapsed). `gem-processing-card.completed`:
     *
     *   radius 28px · bg rgb(23,23,23) · NO border · overflow hidden · h 133 ·
     *   cursor pointer (the WHOLE card opens the document, not just the button)
     *     div.container: grid, padding 20px, column-gap 16px
     *       gem-icon.status-icon  28x28
     *       span.card-title       17px/24px w400 rgb(230,230,230), truncate, max-w 620
     *       div.body-area         margin 4px 0 8px
     *         span.current-step   13px/17px rgba(255,255,255,0.55)  "Aug 29, 6:39 PM"
     *       div.actions           flex, justify-end, h 36
     *         button              radius 9999 · bg rgb(31,59,155) · 15px/20px
     *                             rgb(230,230,230) · padding 0 12px · w 61.76
     *
     * 20 + 28 + 4 + 17 + 8 + 36 + 20 = 133 exactly, which is how the row heights
     * are known: the title row is 28px because the ICON sets it, so the 24px
     * title sits 2px low, and the actions row is its own 36px band rather than
     * being aligned with the title.
     *
     * TWO THINGS THIS DOES NOT HAVE, both of which Willow shipped and the user
     * filed: a code preview inside the chip (there is none — the body is the
     * timestamp alone), and an `Open` button on the title row (it is below, right
     * aligned, and it is FILLED BLUE, the only saturated fill in the thread).
     */
    return (
      <div
        onClick={onOpen}
        className="w-full cursor-pointer overflow-hidden rounded-[28px] bg-[rgb(23,23,23)]"
      >
        <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-4 p-5">
          <MaterialSymbol
            name={kind.icon}
            family={kind.family}
            size={28}
            weight={260}
            roundness={100}
            opticalSize={24}
            className="shrink-0 text-[#c4c7c5]"
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
              /* The card behind it opens the same document; stopping here keeps one
                 press from being two opens. */
              onClick={(event) => { event.stopPropagation(); onOpen(); }}
              aria-label={`Open ${title} in Canvas`}
              style={{ minWidth: 62 }}
              className="relative flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-[rgb(31,59,155)] px-3 text-[15px] font-normal leading-5 text-[rgb(230,230,230)] outline-none before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:transition-opacity before:content-[''] hover:before:opacity-[0.08] focus-visible:before:opacity-[0.12]"
            >
              <span className="relative">Open</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        `relative w-full rounded-[40px] ${CARD_SHELL_CLASS} `
        + (bleed
          /* 949.6 measured against a 708px column; Willow's is 704, so the overhang
             is 245.6px total, centred by `left:50%` + `translateX(-50%)` exactly as
             Gemini does it (read back as `matrix(1,0,0,1,-474.8,0)`). */
          ? 'min-[1200px]:left-1/2 min-[1200px]:w-[calc(100%+245.6px)] min-[1200px]:-translate-x-1/2'
          : '')
      }
    >
      {/* 948x72, with `.title-wrapper` 36px tall at y+18. Every button here is 36x36
          on a 44px pitch (8px gap) — four px smaller than the panel's, which is why
          `CanvasVersionNav` takes a box size instead of hard-coding 40. */}
      <div className={`flex h-[72px] items-center gap-2 ${CARD_INSET_CLASS}`}>
        <span className="min-w-0 flex-none truncate text-[17px] font-[370] leading-6 text-[#e3e3e3]">
          {title}
        </span>
        <CanvasVersionNav
          versionCount={doc.versions.length}
          version={shown}
          onVersionChange={setShownVersion}
          box={36}
        />
        <div className="min-w-0 flex-1" />
        {previewable && <CanvasTabSwitch tab={tab} onChange={setTab} />}
        {doc.kind === 'code' ? (
          <CanvasPill
            icon="download"
            family="google-symbols"
            label="Download"
            minWidth={120}
            onClick={() => downloadCanvas(doc, content)}
          />
        ) : (
          <CanvasMenuPill
            icon="ios_share"
            family="material-rounded"
            label="Export"
            minWidth={128}
            items={exportItems}
          />
        )}
        <CanvasIconButton icon="expand_content" family="google-symbols" label="Open in Canvas" box={36} onClick={onOpen} />
        {/* `close` here, `collapse_content` on the panel: this one puts the document
            back to its collapsed chip, and the panel's returns the panel TO a card. */}
        <CanvasIconButton icon="close" family="google-symbols" label="Close canvas" box={36} onClick={onToggleExpanded} />
      </div>

      {/* 828px, measured, and it scrolls internally: 72 + 828 + 1.6 of border = 901.6,
          which is the card's measured height to the tenth. Prose keeps the 28.8px
          side padding; code does NOT — its iframe measured the full 948px inner
          width, edge to edge. */}
      {doc.kind === 'code' ? (
        <div className="flex h-[828px] flex-col">
          <CanvasCodeView doc={doc} content={content} tab={tab} inset={0} onContentChange={editContent} />
        </div>
      ) : (
        <div
          className={`gemini-chat-scrollbar h-[828px] overflow-y-auto pb-8 ${CARD_INSET_CLASS}`}
          style={{ scrollbarGutter: 'stable' }}
        >
          <CanvasProseView
            content={content}
            onContentChange={editContent}
          />
        </div>
      )}
    </div>
  );
}
