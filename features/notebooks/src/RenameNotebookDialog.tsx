import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import type { Notebook } from './notebook-types';
import { setNotebookEmoji } from './notebooks-store';
import { useNotebookDisk } from './useNotebookDisk';

/**
 * Gemini's emoji keyboard — `xap-emoji-picker`, 375x356.
 *
 * This is a SHARED Google widget, not a Gemini component, and its palette gives it
 * away: container `rgb(32,33,36)`, search field `rgb(60,64,67)`, active category
 * `rgb(102,157,246)`. None of those appear anywhere else in the notebook UI, so they
 * are deliberately not expressed in terms of the surrounding tokens.
 *
 *   container   375x356, bg `rgb(32,33,36)`, radius **22px**, padding 12
 *   toolbar     68px tall
 *   search      bg `rgb(60,64,67)`, radius **30px**, `padding: 0 10px`, **28px** tall,
 *               20px leading icon with `margin-right: 6px` in `rgba(255,255,255,0.6)`,
 *               input **12px/17px w500** `rgb(230,230,230)`, placeholder "Search"
 *   categories  40px tall, space-between; 30x30 round buttons with 18px glyphs,
 *               active `rgb(102,157,246)`, inactive `rgba(255,255,255,0.6)`
 *   grid        9 columns of 38.46px, gap 0; cells 38x38 radius 10, font-size 25px
 *
 * One deliberate divergence: Gemini's cells carry NO text — 24 sampled cells came
 * back as empty strings despite a 25px font-size, so the glyphs are painted some
 * other way (a sprite, as ChatGPT's composer does). Rendering the emoji as text at
 * the measured 25px in the measured 38x38 cell is visually equivalent and does not
 * need an asset pipeline.
 */
/**
 * Emoji for a category, built from contiguous Unicode ranges.
 *
 * Gemini's grid measured **270 cells**. Hand-written lists of ~36 were nowhere near
 * that — the default tab showed twelve emoji and a lot of empty panel. Ranges give
 * the real density in a fraction of the source, and only fully-assigned emoji blocks
 * are used, so nothing renders as tofu.
 */
const range = (from: number, to: number): string[] => {
  const out: string[] = [];
  for (let cp = from; cp <= to; cp += 1) out.push(String.fromCodePoint(cp));
  return out;
};

/**
 * Tab icons as inline SVG, deliberately NOT an icon font.
 *
 * Gemini's own tabs are inline `svg`+`path` at 18x18 — the recording showed exactly
 * that — and two attempts to substitute ligatures both rendered as literal TEXT in
 * the strip ("ЛL", "A", "DC", "S"). A missing ligature is not an error: the font
 * falls back to drawing its own name. `google-symbols` is loaded from a subsetted
 * `kit=` URL, so which names exist is not something this file can rely on.
 *
 * Inline paths have no such failure mode. At 18px these read as the category, which
 * is all the strip needs.
 */
const CAT_ICONS: Record<string, string> = {
  recent: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-13h-2v6l5 3 1-1.6-4-2.4V7z',
  smileys: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 17.5c2.3 0 4.2-1.5 5-3.5H7c.8 2 2.7 3.5 5 3.5z',
  people: 'M12 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm-2 6a3 3 0 0 0-3 3v3h2v5h6v-5h2v-3a3 3 0 0 0-3-3h-4z',
  nature: 'M6.5 3C5 6 4 9 4 12a8 8 0 0 0 8 8c3 0 6-1 9-2.5C19.5 20 16 21 12 21A9 9 0 0 1 3 12c0-4 1.5-7 3.5-9zm12 2c-6 0-10 3-10 8 0 1.3.4 2.5 1 3.5C13 13 16 10 20 9c-3 2-5 5-6 9 5 0 9-4 9-9V5h-4.5z',
  food: 'M4 5h13a3 3 0 0 1 3 3 3 3 0 0 1-3 3h-1v2a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V5zm12 4h1a1 1 0 0 0 0-2h-1v2zM3 20h15v2H3v-2z',
  activities: 'M18 3h3v4a4 4 0 0 1-3.2 3.9A6 6 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1a6 6 0 0 1-4.8-4A4 4 0 0 1 3 7V3h3V2h12v1zM6 5H5v2a2 2 0 0 0 1 1.7V5zm12 0v3.7A2 2 0 0 0 19 7V5h-1z',
  travel: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h1v6h-2v2h-3v-2H9v2H6v-2H4v-6h1zm2.6-4l-1 3h10.8l-1-3H7.6zM7 13.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  objects: 'M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2zm-2 17h4v1a2 2 0 0 1-4 0v-1z',
  symbols: 'M12 21l-1.5-1.4C5.4 15 2 11.9 2 8.2A4.9 4.9 0 0 1 7 3.2c1.9 0 3.7.9 5 2.4 1.3-1.5 3.1-2.4 5-2.4a4.9 4.9 0 0 1 5 5c0 3.7-3.4 6.8-8.5 11.4L12 21z',
  flags: 'M6 2v20H4V2h2zm2 1h11l-2.5 4L19 11H8V3z',
};

const CatIcon: React.FC<{ id: string }> = ({ id }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={CAT_ICONS[id] ?? CAT_ICONS.recent} fill="currentColor" />
  </svg>
);

const EMOJI_CATEGORIES: ReadonlyArray<{ id: string; label: string; emoji: readonly string[] }> = [
  {
    // Gemini's first tab. Willow keeps no usage history, so this is a fixed set of
    // notebook-appropriate glyphs rather than a real recency list.
    id: 'recent', label: 'Recently used',
    emoji: [...range(0x1f4d2, 0x1f4da), '📈', '🧪', '📏', '🎯', '🍎', '🎤', '🔬', '🧮'],
  },
  // Each list below follows a Unicode emoji GROUP, which is where Google's own
  // keyboard takes its ordering from. Only fully-assigned blocks are used.
  {
    id: 'smileys', label: 'Smileys and emotions',
    emoji: [...range(0x1f600, 0x1f64f), ...range(0x1f910, 0x1f92f), ...range(0x1f970, 0x1f97a)],
  },
  {
    id: 'people', label: 'People',
    emoji: [...range(0x1f44a, 0x1f450), ...range(0x1f464, 0x1f487), ...range(0x1f930, 0x1f93a),
      ...range(0x1f9b5, 0x1f9bb)],
  },
  {
    id: 'nature', label: 'Animals and nature',
    emoji: [...range(0x1f400, 0x1f43e), ...range(0x1f980, 0x1f9ae), ...range(0x1f330, 0x1f343),
      ...range(0x1f490, 0x1f4a0)],
  },
  {
    id: 'food', label: 'Food and drink',
    emoji: [...range(0x1f345, 0x1f37f), ...range(0x1f950, 0x1f96f), ...range(0x1f9c0, 0x1f9cb)],
  },
  {
    id: 'activities', label: 'Activities and events',
    emoji: [...range(0x1f380, 0x1f393), ...range(0x1f3a0, 0x1f3ca), ...range(0x1f3cf, 0x1f3d3),
      ...range(0x1f947, 0x1f94c)],
  },
  {
    id: 'travel', label: 'Travel and places',
    emoji: [...range(0x1f680, 0x1f6a4), ...range(0x1f6b2, 0x1f6bc), ...range(0x1f300, 0x1f320),
      ...range(0x1f3d4, 0x1f3e0), ...range(0x1f5fb, 0x1f5ff)],
  },
  {
    id: 'objects', label: 'Objects',
    emoji: [...range(0x1f4a1, 0x1f4fc), ...range(0x1f526, 0x1f52f), ...range(0x1f9f0, 0x1f9ff)],
  },
  {
    id: 'symbols', label: 'Symbols',
    emoji: [...range(0x1f493, 0x1f49f), ...range(0x1f500, 0x1f525), ...range(0x1f534, 0x1f53d)],
  },
  {
    // Flags are regional-indicator PAIRS, which no single codepoint range can
    // express, so this one list stays literal.
    id: 'flags', label: 'Flags',
    emoji: ['🏁', '🚩', '🎌', '🏴', '🇮🇳', '🇺🇸', '🇬🇧', '🇨🇦',
      '🇦🇺', '🇯🇵', '🇰🇷', '🇨🇳', '🇩🇪', '🇫🇷', '🇮🇹',
      '🇪🇸', '🇧🇷', '🇲🇽', '🇷🇺', '🇿🇦', '🇳🇬', '🇪🇬',
      '🇸🇦', '🇦🇪', '🇸🇬', '🇲🇾', '🇮🇩', '🇹🇭', '🇻🇳',
      '🇵🇭', '🇳🇿', '🇮🇪', '🇳🇱', '🇸🇪', '🇳🇴', '🇩🇰',
      '🇫🇮', '🇵🇱', '🇹🇷', '🇬🇷', '🇵🇹', '🇨🇭', '🇦🇹'],
  },
];

const EmojiPicker: React.FC<{
  anchor: { x: number; y: number; w: number; h: number };
  onPick: (emoji: string) => void;
  onClose: () => void;
}> = ({ anchor, onPick, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (panelRef.current?.contains(event.target)) return;
      if (event.target.closest('[data-nb-emoji-trigger]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  /*
   * Search spans EVERY category, not just the active one, and matches the category
   * label — Gemini's own search returns cross-category hits. When there are none the
   * grid is replaced by "No emoji found".
   */
  const trimmed = query.trim().toLowerCase();
  const results = trimmed
    ? EMOJI_CATEGORIES.flatMap((c) => (c.label.toLowerCase().includes(trimmed) ? c.emoji : []))
    : [];

  /*
   * Every category is laid out at once, in one scroller.
   *
   * This used to render ONLY the active category, so the tabs behaved like a
   * filter and there was no way to see the whole set — you had to click each
   * tab in turn. Gemini's keyboard puts them all in a single scroll with the
   * tabs as jump links, which is what these two handlers do: a tab scrolls its
   * section to the top, and scrolling back marks whichever section is up there.
   */
  const jumpTo = (id: string) => {
    setQuery('');
    setActiveCategory(id);
    const scroller = scrollRef.current;
    const section = sectionRefs.current.get(id);
    if (!scroller || !section) return;
    scroller.scrollTo({ top: section.offsetTop - scroller.offsetTop, behavior: 'smooth' });
  };

  const syncActiveFromScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // +8 so a section counts as reached once its heading is at the top edge,
    // rather than only after it has scrolled a pixel past it.
    const top = scroller.scrollTop + 8;
    let current = EMOJI_CATEGORIES[0].id;
    for (const category of EMOJI_CATEGORIES) {
      const section = sectionRefs.current.get(category.id);
      if (!section) continue;
      if (section.offsetTop - scroller.offsetTop <= top) current = category.id;
    }
    setActiveCategory((previous) => (previous === current ? previous : current));
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return createPortal(
    <div
      ref={panelRef}
      className="nb-emoji-kb"
      /*
       * Stop the click here.
       *
       * A React portal bubbles events through the REACT tree, not the DOM tree — so
       * even though this panel is portalled to <body>, in React's tree it is a child
       * of the Rename dialog's scrim, whose onClick dismisses the dialog. Without
       * this, clicking a category, the search field or any emoji tore down the whole
       * dialog before the pick could land.
       */
      onClick={(event) => event.stopPropagation()}
      /* Measured: the picker's top sits 52px below the trigger's top (a 48px button
       * plus the same 4px gap the three-dot menus use), and 12px right of its left
       * edge. */
      style={{ left: anchor.x + 12, top: anchor.y + anchor.h + 4 }}
    >
      <div className="nb-emoji-kb-inner">
        <div className="nb-emoji-toolbar">
          <div className="nb-emoji-search">
            <svg className="nb-emoji-search-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search emoji"
              autoFocus
            />
          </div>
          <nav className="nb-emoji-cats">
            {EMOJI_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                title={category.label}
                aria-label={category.label}
                aria-pressed={!trimmed && activeCategory === category.id}
                onClick={() => jumpTo(category.id)}
                className={`nb-emoji-cat ${!trimmed && activeCategory === category.id ? 'is-active' : ''}`}
              >
                <CatIcon id={category.id} />
              </button>
            ))}
          </nav>
        </div>

        {trimmed && results.length === 0 ? (
          <div className="nb-emoji-empty">No emoji found</div>
        ) : trimmed ? (
          <div className="nb-emoji-scroll">
            <div className="nb-emoji-section">
              <span>Search results</span>
            </div>
            <div className="nb-emoji-grid">
              {results.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  onClick={() => onPick(emoji)}
                  className="nb-emoji-cell"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="nb-emoji-scroll" ref={scrollRef} onScroll={syncActiveFromScroll}>
            {EMOJI_CATEGORIES.map((category) => {
              const isCollapsed = collapsed.has(category.id);
              return (
                <div
                  key={category.id}
                  ref={(node) => {
                    if (node) sectionRefs.current.set(category.id, node);
                    else sectionRefs.current.delete(category.id);
                  }}
                >
                  {/*
                    * The heading is the collapse control. Gemini's carries the
                    * same chevron, and it turns to point at the section when the
                    * section is closed.
                    */}
                  <button
                    type="button"
                    className="nb-emoji-section"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapsed(category.id)}
                  >
                    <span>{category.label}</span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
                    >
                      <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4z" />
                    </svg>
                  </button>
                  {!isCollapsed && (
                    <div className="nb-emoji-grid">
                      {category.emoji.map((emoji, index) => (
                        <button
                          key={`${emoji}-${index}`}
                          type="button"
                          onClick={() => onPick(emoji)}
                          className="nb-emoji-cell"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

/**
 * Gemini's `edit-title-dialog` — Rename notebook, 512x236.
 *
 *   surface   bg `rgb(31,31,31)`, radius 32
 *   header    512x72, align-START (not centre), space-between; h2
 *             `padding: 24px 24px 0`, 20px/24px w470; close button 40x40 at dx456
 *             with `margin: 16px`, radius 100px, 24px google-symbols
 *             `rgb(196,199,197)`
 *   content   `padding: 16px 24px 0`; `.title-input-row` 452x56 with `padding: 12px 0`
 *             and `gap: 12px`
 *   emoji     the trigger sits first in that row, ~86px wide and 48px tall
 *   field     354.1x56 with the input inset 16px, 16px/24px w400 Google Sans Flex
 *             `"ROND" 0,"slnt" 0,"wdth" 92,"wght" 400`
 *   actions   the same tonal pills as the other dialogs — Cancel's label measured
 *             46.7px here and 46.725px in Delete notebook, i.e. one component
 */
/** Exit animation plus its 25ms delay — see `.nb-sheet-exit`. */
const RENAME_EXIT_MS = 125;

export const RenameNotebookDialog: React.FC<{
  notebook: Notebook;
  onClose: () => void;
}> = ({ notebook, onClose }) => {
  const [title, setTitle] = useState(notebook.title);
  const [emoji, setEmoji] = useState(notebook.emoji);
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { renameNotebookWithFolder } = useNotebookDisk();
  /*
   * Held open for the length of the exit fade — see `.nb-sheet-exit`. The parent
   * owns the mount, so a bare `onClose()` deletes the tree in the same frame and
   * leaves the animation nothing to play on. Same shape as the Sources dialog.
   */
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const requestClose = React.useCallback(() => {
    if (closeTimerRef.current !== undefined) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, RENAME_EXIT_MS);
  }, [onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
  }, []);

  // Prefilled and focused with the caret at the end, as the sidebar's rename is.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const trimmed = title.trim();
  const canSave = trimmed.length > 0 && (trimmed !== notebook.title || emoji !== notebook.emoji);

  const save = () => {
    if (!canSave) return;
    if (trimmed !== notebook.title) renameNotebookWithFolder(notebook.id, trimmed);
    if (emoji !== notebook.emoji) setNotebookEmoji(notebook.id, emoji);
    requestClose();
  };

  return createPortal(
    <div
      className={`nb-set-scrim ${isClosing ? 'nb-sheet-exit' : ''}`}
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Rename notebook"
        className="nb-surface nb-ren"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nb-ren-header">
          <h2 className="nb-ren-title">Rename notebook</h2>
          <button type="button" aria-label="Close" onClick={requestClose} className="nb-ren-close">
            <MaterialSymbol name="close" family="google-symbols" size={24} />
          </button>
        </div>

        <div className="nb-ren-content">
          <div className="nb-ren-row">
            <button
              type="button"
              aria-label="Change notebook icon"
              aria-haspopup="dialog"
              data-nb-emoji-trigger=""
              onClick={(event) => {
                // Eager measure — an updater runs at render time, when
                // `currentTarget` is already null. See NotebookPage's header trigger.
                const r = event.currentTarget.getBoundingClientRect();
                const next = { x: r.x, y: r.y, w: r.width, h: r.height };
                setPickerAnchor((open) => (open ? null : next));
              }}
              className="nb-ren-emoji"
            >
              <span className="nb-ren-emoji-glyph" aria-hidden="true">{emoji}</span>
            </button>

            <div className="nb-ren-field">
              <input
                ref={inputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); save(); }
                }}
                aria-label="Notebook name"
              />
            </div>
          </div>
        </div>

        <div className="nb-ren-actions">
          <button type="button" onClick={requestClose} className="nb-pill">Cancel</button>
          <button type="button" disabled={!canSave} onClick={save} className="nb-pill">Save</button>
        </div>
      </div>

      {pickerAnchor && (
        <EmojiPicker
          anchor={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
          onPick={(picked) => { setEmoji(picked); setPickerAnchor(null); }}
        />
      )}
    </div>,
    document.body,
  );
};
