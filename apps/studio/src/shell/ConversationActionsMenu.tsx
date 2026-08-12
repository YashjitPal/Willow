import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';
import { emitChatActionIntent, isChatPinned } from './chat-actions';
import './ConversationActionsMenu.css';

/**
 * Gemini's top-right conversation-actions menu. Every value here is measured —
 * see ConversationActionsMenu.css for the capture notes and the arithmetic.
 *
 * The two things that most easily go wrong:
 *
 *   1. NO ANIMATION, in either direction. This pane is a `gem-menu` in a plain
 *      `cdk-overlay-popover`, so Angular Material's `_mat-menu-enter` /
 *      `_mat-menu-exit` never match it — unlike the Recents row menu, which is a
 *      real `mat-menu` and does animate. So there is no closing state and no
 *      unmount hold here: `isOpen` renders the pane and clearing it removes the
 *      pane in the same frame, which is what was measured.
 *
 *   2. The width is CONTENT-DERIVED and must not be authored. Each row reserves
 *      an empty 20px trailing slot, which is 20 + 8 of the measured 203.26 — drop
 *      it and the pane comes out too narrow even with every other value right.
 */

/*
 * Row box, measured: 36 tall, `padding: 8px`, `gap: 8px`, `border-radius: 12px`,
 * `cursor: pointer`, transparent until hover, then rgba(230, 230, 230, 0.08) on
 * the row's OWN background (not a ripple — that is the trigger's mechanism, not
 * the row's). Gemini's `transition: all` is reproduced as a colour transition,
 * since background-color is the only property that changes.
 */
const ROW_CLASS =
  'flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl p-2 text-left transition-colors hover:bg-[rgba(230,230,230,0.08)]';

/*
 * Label, measured: 13px/17px 400 in rgb(230, 230, 230) at the pane's width axis,
 * `white-space: nowrap` with `overflow: hidden; text-overflow: ellipsis`.
 *
 * Deliberately NOT `flex-1`. Every label measured its natural text width — 115.26
 * for "Share conversation" but 35.14 for "Unpin" — so it does not grow into the
 * row. The trailing slot is what takes up the slack (see below).
 */
const LABEL_CLASS =
  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-[17px] font-normal tracking-normal text-[#e6e6e6]';

/*
 * The 20x20 boxes either side of the label. Both measured 20x20 with
 * `display: flex; align-items: center`.
 *
 * The trailing one is EMPTY in all seven rows (`innerHTML` is three Angular
 * comment anchors and nothing else) and sits flush against the row's right edge
 * in all seven — trailing.x was 1488 on both the 115.26px row and the 35.14px
 * one. So the slack goes here, as an auto left margin, rather than into the
 * label. It still contributes its 20px to the pane's width.
 */
const SLOT_CLASS = 'flex h-5 w-5 shrink-0 items-center';

type ConversationActionRow = {
  id: string;
  label: string;
  icon: string;
  /** Measured per row: `download` is Google Symbols, the other six are Luminous. */
  family: 'luminous' | 'google-symbols';
  onSelect: () => void;
};

export interface ConversationActionsMenuProps {
  /** The chat every row acts on. */
  chatId: string;
}

export const ConversationActionsMenu: React.FC<ConversationActionsMenuProps> = ({ chatId }) => {
  const { chatScopeId } = useLocalFS();
  const [isOpen, setIsOpen] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  // Read at open rather than held as state: Pin/Unpin closes the pane, so a
  // mounted pane is always looking at storage as it was a frame ago and there is
  // nothing to invalidate. Sidebar remains the only writer.
  const [isPinned, setIsPinned] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const triggerClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
      setIsOpen(false);
    }, 125);
  };

  useEffect(() => {
    if (!shouldRender || isClosing) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) triggerClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') triggerClose();
    };
    window.addEventListener('click', onDocumentClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', onDocumentClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [shouldRender, isClosing]);

  // A chat switch while the pane is open would leave it acting on the old id.
  useEffect(() => {
    setIsOpen(false);
    setShouldRender(false);
    setIsClosing(false);
  }, [chatId]);

  const run = (action: () => void) => () => {
    triggerClose();
    action();
  };

  /*
   * Seven rows, in the measured order, with the measured glyph names. Gemini's
   * icon names live in `data-mat-icon-name`, never in the MAT-ICON's text.
   *
   * Four are stubs, because Willow has nothing behind them: Share and Add to
   * notebook match what the Recents row menu already does, and Download PDF /
   * Export to Docs say so plainly rather than claiming to have run. They are
   * still rendered — the pane's 268px height is 16 + 7 x 36, so dropping a row
   * would change a measured value.
   */
  const rows: ConversationActionRow[] = [
    {
      id: 'share',
      label: 'Share conversation',
      icon: 'share_1',
      family: 'luminous',
      onSelect: () => alert('Sharing conversation link: ' + window.location.origin + '/chat/' + chatId),
    },
    {
      id: 'pin',
      label: isPinned ? 'Unpin' : 'Pin',
      icon: isPinned ? 'unpin' : 'push_pin',
      family: 'luminous',
      onSelect: () => emitChatActionIntent({ action: 'pin', chatId }),
    },
    {
      id: 'rename',
      label: 'Rename',
      icon: 'edit',
      family: 'luminous',
      onSelect: () => emitChatActionIntent({ action: 'rename', chatId }),
    },
    {
      id: 'download',
      label: 'Download PDF',
      icon: 'download',
      family: 'google-symbols',
      onSelect: () => alert("Download PDF isn't available in Willow yet."),
    },
    {
      id: 'export',
      label: 'Export to Docs',
      icon: 'docs',
      family: 'luminous',
      onSelect: () => alert("Export to Docs isn't available in Willow yet."),
    },
    {
      id: 'notebook',
      label: 'Add to notebook',
      icon: 'notebook',
      family: 'luminous',
      onSelect: () => alert(`Added "${chatId}" to Notebook.`),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'delete',
      family: 'luminous',
      onSelect: () => emitChatActionIntent({ action: 'delete', chatId }),
    },
  ];

  return (
    <div ref={rootRef} className="absolute top-[14px] right-[12px] z-30">
      {/*
        * Trigger, measured: BUTTON 36x36 at (1488, 14) — top 14 / right 12 —
        * `border-radius: 9999px`, `padding: 6px`, background transparent,
        * `min-width: 0; min-height: 0`, no border, colour rgb(230, 230, 230).
        *
        * The hover tint is NOT the button's background, which stayed
        * rgba(0, 0, 0, 0) throughout. It is a persistent-ripple child whose
        * `::before` is rgb(196, 199, 197) at opacity 0 -> 0.08, radius inherited
        * — the same mechanism as the Recents row trigger, reproduced the same way.
        *
        * 0.08 and not 0.12: the first read of this said 0.12 because the button
        * still carried `cdk-focused cdk-keyboard-focused` from having been opened
        * programmatically, and MDC uses 0.12 for focus. Blurring first and then
        * reading the authored rules under a forced :hover gives 0.08.
        */}
      <button
        type="button"
        aria-label="Open menu for conversation actions."
        aria-haspopup="menu"
        aria-expanded={shouldRender && !isClosing}
        onClick={(event) => {
          event.stopPropagation();
          const nextOpen = !(shouldRender && !isClosing);
          if (nextOpen) {
            setIsPinned(isChatPinned(chatScopeId, chatId));
            setShouldRender(true);
            setIsClosing(false);
            setIsOpen(true);
          } else {
            triggerClose();
          }
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border-0 bg-transparent p-1.5 text-[#e6e6e6] before:absolute before:inset-0 before:rounded-full before:bg-[rgb(196,199,197)] before:opacity-0 before:transition-opacity before:content-[''] hover:before:opacity-[0.08]"
      >
        <MaterialSymbol
          name="more_vert"
          family="luminous"
          size={24}
          weight={300}
          roundness={100}
          opticalSize={24}
          className="relative"
        />
      </button>

      {/*
        * The pane. `top-[40px]` is the measured 36px trigger plus the pane's own
        * `translateY(4px)` — i.e. trigger.bottom + 4 = 54 at a trigger top of 14.
        * `right-0` reproduces the CDK wrapper's `align-items: flex-end` against
        * `right: 12px`, which put the pane's right edge on trigger.right (1524).
        *
        * No width, no min-width, no max-width. Gemini authors
        * `min-width: min(225px, 100%)` but it measured inert — the pane came out
        * 203.26, below 225, because the 100% resolves against a shrink-wrapped
        * container. Reproducing the declaration would wrongly widen this to 225.
        *
        * The shadow is measured on the `.container` parent rather than the
        * `gem-menu` itself, but both share the same 203.26x268 box and the same
        * 20px radius, so one node carries both here.
        */}
      {shouldRender && (
        <div
          role="menu"
          className={`willow-conv-menu absolute top-[40px] right-0 flex flex-col rounded-[20px] bg-[#1f1f1f] p-2 shadow-[0_0_20px_rgba(0,0,0,0.28)] ${
            isClosing ? 'willow-mat-menu-exit' : 'willow-mat-menu-enter'
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          {rows.map((row) => (
            <button key={row.id} type="button" role="menuitem" onClick={run(row.onSelect)} className={ROW_CLASS}>
              <span className={SLOT_CLASS}>
                <MaterialSymbol
                  name={row.icon}
                  family={row.family}
                  size={20}
                  weight={320}
                  roundness={100}
                  opticalSize={20}
                  className="willow-conv-menu-icon"
                />
              </span>
              <span className={LABEL_CLASS}>{row.label}</span>
              {/* The reserved trailing slot: empty in all seven measured rows,
                  flush right in all seven, and 20 of the pane's 203.26. */}
              <span aria-hidden="true" className={`${SLOT_CLASS} ml-auto`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ConversationActionsMenu;
