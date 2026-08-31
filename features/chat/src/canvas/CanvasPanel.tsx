/**
 * The full-bleed Canvas panel.
 *
 * A SIBLING of `RichResourcePanel`, not a variant of it: it reuses ChatView's
 * existing right-hand slot (the same `AnimatePresence`, the same grid columns, the
 * same `immersiveControls` slide on the chat column), so opening a canvas is the
 * transition that already ships rather than a second one to keep in step.
 *
 * The enter/exit values below and the margin class string are copied from
 * `RichResourcePanel` deliberately, and must stay copied. Both are Gemini's
 * `immersivePanelTransitions`, read off the running app through
 * `effect.getKeyframes()` the instant the node is inserted:
 *
 *   transform: scale(0.6) -> scale(1)   500ms cubic-bezier(0.2, 0, 0, 1)
 *   opacity:   0 -> 1                   200ms linear
 *
 * `origin-center` is required by that — the captured transform-origin is the
 * panel's own centre, and no element's WIDTH animates at any point (the panel
 * measured 1436px wide from its first frame, at scale 0.6).
 *
 * THERE IS NO LEAVE ANIMATION, which is Gemini's behaviour and now Willow's too.
 * A 200ms opacity fade used to sit here, for a reason that has since expired: back
 * then ChatView animated `grid-template-columns` over 500ms, so an instantly
 * removed panel left a visibly collapsing gap. ChatView now snaps the grid and
 * slides the chat column in from `translateX(-20%)` instead, exactly as Gemini
 * does, so the space is refilled in the same frame the panel goes.
 *
 * Keeping the fade after that change was actively harmful, and this is the reported
 * "little lag while closing" that opening never had. The grid snaps to
 * `minmax(0,1fr) 0fr` in the same commit the panel starts exiting, and the exiting
 * panel is still the item in that second track — with `min-w-0` and
 * `overflow-hidden` its automatic minimum is 0, so it spent the whole fade being
 * re-laid-out at zero width. That re-lays out its embedded document too: a preview
 * iframe resized to 0 runs the guest's own reflow and resize handlers. Then the
 * unmount, and the frame teardown with it, landed 200ms into a 500ms slide — a
 * hitch in the middle of the motion rather than before it. Nothing was gained for
 * it: a panel crushed to zero width in frame one has nothing left to fade.
 *
 * The work close costs is unavoidable, but it belongs in the frame BEFORE the
 * animation, not in the middle of one. Opening never showed any of this because
 * the panel is laid out at its final width from its first frame and its iframe is
 * deferred until the scale has finished.
 *
 * THE RIGHT MARGIN IS 32px (`mr-8`) AND IT IS COUPLED TO ChatView's GRID. Gemini
 * authors 24px because its grid is already inset by that much on the right; Willow's
 * is not, so the margin absorbs it. Changing one without the other moves the panel
 * 8px sideways, and the grid half of that has failed twice — see the notes at the
 * grid in ChatView.tsx and at RichResourcePanel.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CanvasCodeView,
  CanvasIconButton,
  CanvasMenuPill,
  CanvasPill,
  CanvasProseView,
  CanvasQuickActions,
  CanvasTabSwitch,
  CanvasVersionNav,
  canvasExportItems,
  canvasFileName,
  copyCanvas,
  downloadCanvas,
  type CanvasTab,
} from './canvas-view';
import { clampVersion, isPreviewable, type CanvasDoc } from './canvas-store';

export interface CanvasPanelProps {
  doc: CanvasDoc;
  /** Index into `doc.versions`; clamped here, so a stale value is harmless. */
  version: number;
  onVersionChange: (version: number) => void;
  /** `collapse_content` — back to the inline card, never a discard. */
  onCollapse: () => void;
  /**
   * `close` — dismiss the panel and leave NO card expanded in the thread. The
   * difference from `onCollapse` is what the thread is left holding: collapsing
   * hands the document back to the turn that wrote it as an expanded card, and
   * closing puts every card for it back to its chip.
   */
  onClose?: () => void;
  /** Sends an ordinary follow-up turn; the quick actions are prompts, not edits. */
  onPrompt: (text: string) => void;
  /**
   * Write an edit back to the document. Absent = read-only, and so is any view of
   * an OLD version: `applyCanvasEdit` rewrites the newest revision, so a caret
   * while scrubbed back would save somewhere the user is not looking.
   */
  onEditContent?: (content: string) => void;
}

/**
 * The toolbar measured 1436x60 with the title's left edge at x=116 against a panel
 * left edge of x=76 — a 40px inset (`pl-10`) — and the 56x56 Collapse button's icon
 * centred 60px from the panel's right edge, which `pr-8` + a 56px box reproduces
 * exactly. Everything between is laid out with an 8px gap and a spacer, not absolute
 * offsets, because the measurements come from one viewport width and the real panel
 * is fluid; the two ends are the parts that read as misaligned when they drift.
 */
const TOOLBAR_CLASS = 'flex h-[60px] shrink-0 items-center gap-2 pl-10 pr-8';

/** 17px/24px w370 Google Sans Flex #e3e3e3 — the one weight Gemini uses off-scale. */
const TITLE_CLASS = 'min-w-0 flex-none truncate text-[17px] font-[370] leading-6 text-[#e3e3e3]';

export function CanvasPanel({
  doc,
  version,
  onVersionChange,
  onCollapse,
  onClose,
  onPrompt,
  onEditContent,
}: CanvasPanelProps) {
  const shown = clampVersion(doc, version);
  const snapshot = doc.versions[shown];
  const content = snapshot ? snapshot.content : '';
  /* An older version carries its own title: the fold in canvas-store keeps every
   * snapshot's title, so scrubbing back shows what the document was called then. */
  const title = (snapshot && snapshot.title) || doc.title;

  /* Only the newest revision is writable — see the prop's note. */
  const editContent = shown === doc.versions.length - 1 ? onEditContent : undefined;

  const previewable = doc.kind === 'code' && isPreviewable(doc);
  const [tab, setTab] = useState<CanvasTab>(previewable ? 'preview' : 'code');
  /* A document can stop being previewable between versions (HTML -> Python). Snap
   * back rather than leaving a Preview tab selected over a dead iframe. */
  useEffect(() => {
    if (!previewable) setTab('code');
  }, [previewable]);

  /* Same deferral as RichResourcePanel: mounting an iframe during the 500ms scale
   * costs a layout+paint on every frame of it. 700ms is the animation plus slack,
   * and it is a fallback — `onAnimationComplete` normally gets there first. */
  const [embedReady, setEmbedReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setEmbedReady(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      /* A menu inside the panel stops its own Escape (see `useDismissable`), so
       * reaching here means nothing smaller was open. */
      event.stopPropagation();
      onCollapse();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCollapse]);

  const exportItems = useMemo(() => canvasExportItems(doc, content), [doc, content]);

  const share = () => {
    const fileName = canvasFileName(doc);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator.share({ title, text: content }).catch(() => copyCanvas(content));
      return;
    }
    /* No Web Share on desktop Chrome without a user-gesture-bound handler, and
     * Gemini's share sheet was never captured — copying is the honest fallback. */
    void fileName;
    copyCanvas(content);
  };

  return (
    <motion.aside
      aria-label={`${title} canvas`}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      onAnimationComplete={() => setEmbedReady(true)}
      transition={{
        scale: { duration: 0.5, ease: [0.2, 0, 0, 1] },
        opacity: { duration: 0.2, ease: 'linear' },
      }}
      className="fixed inset-0 z-50 flex min-h-0 min-w-0 origin-center flex-col overflow-hidden bg-[#1f1f1f] font-['Google_Sans_Flex','Google_Sans_Text','Google_Sans',sans-serif] text-[#e3e3e3] will-change-[transform,opacity] transform-gpu min-[960px]:relative min-[960px]:inset-auto min-[960px]:z-auto min-[960px]:mb-12 min-[960px]:ml-2 min-[960px]:mr-8 min-[960px]:mt-6 min-[960px]:rounded-[40px] min-[960px]:border min-[960px]:border-white/[0.12]"
    >
      <div className={TOOLBAR_CLASS}>
        <h2 className={TITLE_CLASS}>{title}</h2>
        <CanvasVersionNav
          versionCount={doc.versions.length}
          version={shown}
          onVersionChange={onVersionChange}
          box={40}
        />
        <div className="min-w-0 flex-1" />
        {doc.kind === 'code' && previewable && <CanvasTabSwitch tab={tab} onChange={setTab} />}
        {doc.kind === 'code' ? (
          /* Code gets a direct Download (measured 120.15 wide) rather than a menu:
             Gemini's code panel has no Export dropdown, and the file name is the
             whole point of the button. Copy still lives in the doc's own actions. */
          <CanvasPill
            icon="download"
            family="google-symbols"
            label="Download"
            minWidth={120}
            onClick={() => downloadCanvas(doc, content)}
          />
        ) : (
          /* `ios_share` is NOT in either of Willow's subset icon faces — a missing
             ligature there renders as the letters of its own name, with no fallback —
             so it comes off the full Material Symbols Rounded family. Gemini's export
             glyph was never read by name; this is the closest one that exists. */
          <CanvasMenuPill
            icon="ios_share"
            family="material-rounded"
            label="Export"
            minWidth={128}
            items={exportItems}
          />
        )}
        <CanvasIconButton icon="share_2" family="luminous" label="Share canvas" onClick={share} />
        {/* 56x56, and the only button in the toolbar that is not 36 or 40: it is the
            panel's own close affordance, and `collapse_content` is not `close` —
            collapsing returns the document to its inline card in the thread.

            WITH `onClose` PRESENT IT IS NO LONGER THE CORNER BUTTON. The measured
            geometry put this icon 60px from the panel's right edge (`pr-8` + a 56px
            box); the cross now owns that spot and this sits 56px inboard of it. A
            documented departure, and the reason is that the two do different things:
            Gemini's panel only collapses, so it never had to show both. */}
        <CanvasIconButton icon="collapse_content" label="Collapse canvas" box={56} onClick={onCollapse} />
        {onClose && (
          <CanvasIconButton icon="close" family="google-symbols" label="Close canvas" box={56} onClick={onClose} />
        )}
      </div>

      {doc.kind === 'code' ? (
        <CanvasCodeView
          doc={doc}
          content={content}
          tab={tab}
          inset={48}
          previewMounted={embedReady}
          onContentChange={editContent}
        />
      ) : (
        /* `response-container` measured `124,60,1328,717.6` — a 48px left inset and
           60px of right gutter inside a 1436px panel. The rail overlaps that gutter
           in Gemini (`sticky`, and its shadow floats over the prose's right margin);
           here it is a flex sibling instead, which reserves 88px rather than 60 and
           costs the text column ~28px of measure. That is the trade for not
           absolutely positioning a sticky element inside the scroller. */
        <div
          className="gemini-chat-scrollbar min-h-0 flex-1 overflow-y-auto"
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="flex min-h-full items-start">
            <div className="min-w-0 flex-1 pb-12 pl-12 pr-6 pt-2">
              <CanvasProseView
                content={content}
                onContentChange={editContent}
              />
            </div>
            <CanvasQuickActions onPrompt={onPrompt} />
          </div>
        </div>
      )}
    </motion.aside>
  );
}
