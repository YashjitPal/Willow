/**
 * The composer's "@" app menu and "/" skill menu, laid over Chat's `InputBar` without forking it.
 *
 * Two seams make that work. The host element hears the textarea's keys first (capture phase), so
 * the menu takes the arrows, Enter, Tab and Escape before the composer would send. And the
 * textarea's value is written through its native setter plus an `input` event, which is how
 * React's own `onChange` learns of it — `InputBar` keeps owning the draft.
 *
 * Gemini writes a picked mention as bold text in a contenteditable. A textarea cannot hold bold
 * text, so a copy of the textarea's text lies over it, transparent except for the mentions, which
 * it traces with a fine stroke: they read bolder while every glyph keeps the width the caret is
 * placed by.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { caretRect, mirrorTextareaStyle } from './caret-rect';
import {
  applyMention,
  deleteMentionBefore,
  filterMentionOptions,
  mentionQueryAt,
  mentionRanges,
  placeMentionTooltip,
  stepHighlight,
  type MentionOption,
  type MentionQuery,
  type TooltipAnchor,
  type TooltipPlacement,
} from './spark-mentions';
import './spark-mentions.css';

const writeTextarea = (textarea: HTMLTextAreaElement, text: string, caret: number): void => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, text);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.setSelectionRange(caret, caret);
};

interface MenuState {
  query: MentionQuery;
  matches: MentionOption[];
  highlight: number;
  /** Whether a key has moved the highlight yet: the first Down lands on the first row. */
  activated: boolean;
  /** The trigger character's left edge, and the bottom of its line. */
  left: number;
  lineTop: number;
  lineBottom: number;
}

/** The skill description waits this long under the pointer, then fades in. */
const TOOLTIP_DELAY_MS = 750;
/** It is anchored to the row's content: inside the row's 8px padding, the 24px line 6px down. */
const TOOLTIP_ANCHOR_INSET_X = 8;
const TOOLTIP_ANCHOR_INSET_Y = 6;
/** Gemini's pane sits 4px below the line (`translateY(4px)` on the overlay pane). */
const MENU_OFFSET = 4;
const VIEWPORT_MARGIN = 8;

const MentionIcon: React.FC<{ option: MentionOption }> = ({ option }) => (
  <span className="spark-mention-menu__icon" aria-hidden="true">
    {option.icon.kind === 'img' ? (
      <img src={option.icon.src} alt="" />
    ) : option.icon.family === 'luminous' ? (
      <MaterialSymbol family="luminous" name={option.icon.name} size={16} weight={330} roundness={100} opticalSize={16} className="spark-mention-menu__glyph" />
    ) : (
      <MaterialSymbol family="google-symbols" name={option.icon.name} size={20} weight={320} roundness={100} opticalSize={20} className="spark-mention-menu__glyph" />
    )}
  </span>
);

const MentionHighlight: React.FC<{ textarea: HTMLTextAreaElement; text: string; ranges: { start: number; end: number }[] }> = ({ textarea, text, ranges }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const container = textarea.parentElement;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;
    const place = () => {
      mirrorTextareaStyle(textarea, layer);
      layer.style.left = `${textarea.offsetLeft}px`;
      layer.style.top = `${textarea.offsetTop}px`;
      layer.style.height = `${textarea.offsetHeight}px`;
      layer.style.setProperty('--spark-mention-ink', getComputedStyle(textarea).color);
      layer.scrollTop = textarea.scrollTop;
    };
    place();
    const onScroll = () => { layer.scrollTop = textarea.scrollTop; };
    textarea.addEventListener('scroll', onScroll);
    const observer = new ResizeObserver(place);
    observer.observe(textarea);
    return () => {
      textarea.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [textarea, text]);

  if (!container) return null;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(<span key={index} className="spark-mention-highlight__mention">{text.slice(range.start, range.end)}</span>);
    cursor = range.end;
  });
  parts.push(`${text.slice(cursor)}\u200b`);
  return createPortal(<div ref={layerRef} className="spark-mention-highlight" aria-hidden="true">{parts}</div>, container);
};

export const SparkMentions: React.FC<{
  /** The element wrapping the composer; its textarea is found inside. */
  host: HTMLElement | null;
  options: readonly MentionOption[];
  disabled?: boolean;
}> = ({ host, options, disabled = false }) => {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [text, setText] = useState('');
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; anchor: TooltipAnchor } | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  const optionsRef = useRef(options);
  const disabledRef = useRef(disabled);
  const dismissedRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  menuRef.current = menu;
  optionsRef.current = options;
  disabledRef.current = disabled;

  useEffect(() => {
    if (!host) return undefined;
    const find = () => setTextarea(host.querySelector('textarea'));
    find();
    const observer = new MutationObserver(find);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [host]);

  const hideTooltip = useCallback(() => {
    if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setTooltip(null);
  }, []);

  const sync = useCallback(() => {
    const area = host?.querySelector('textarea');
    if (!area) return;
    setText(area.value);
    if (disabledRef.current || document.activeElement !== area || area.selectionStart !== area.selectionEnd) {
      setMenu(null);
      return;
    }
    const query = mentionQueryAt(area.value, area.selectionStart ?? 0);
    if (!query) dismissedRef.current = null;
    if (!query || query.start === dismissedRef.current) {
      setMenu(null);
      return;
    }
    const matches = filterMentionOptions(optionsRef.current, query);
    if (matches.length === 0) {
      setMenu(null);
      return;
    }
    const at = caretRect(area, query.start);
    setMenu((previous) => {
      const same = previous && previous.query.start === query.start && previous.query.query === query.query;
      return {
        query,
        matches,
        highlight: same ? Math.min(previous.highlight, matches.length - 1) : 0,
        activated: same ? previous.activated : false,
        left: at.left,
        lineTop: at.top,
        lineBottom: at.top + at.lineHeight,
      };
    });
  }, [host]);

  const pick = useCallback((option: MentionOption | undefined) => {
    const area = host?.querySelector('textarea');
    const current = menuRef.current;
    if (!area || !current || !option) return;
    const next = applyMention(area.value, current.query, option);
    setMenu(null);
    hideTooltip();
    writeTextarea(area, next.text, next.caret);
    area.focus();
  }, [host, hideTooltip]);

  useEffect(() => {
    if (!host) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const area = event.target;
      if (!(area instanceof HTMLTextAreaElement) || event.isComposing) return;
      const current = menuRef.current;
      if (current) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          setMenu({
            ...current,
            highlight: stepHighlight(current.highlight, current.matches.length, event.key === 'ArrowDown' ? 1 : -1, current.activated),
            activated: true,
          });
          return;
        }
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          pick(current.matches[current.highlight] ?? current.matches[0]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dismissedRef.current = current.query.start;
          setMenu(null);
          hideTooltip();
          return;
        }
      }
      if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey && area.selectionStart === area.selectionEnd) {
        const next = deleteMentionBefore(area.value, area.selectionStart, optionsRef.current);
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        writeTextarea(area, next.text, next.caret);
      }
    };
    const onCaret = (event: Event) => {
      if (event.target instanceof HTMLTextAreaElement) window.requestAnimationFrame(sync);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      setMenu(null);
      hideTooltip();
    };
    host.addEventListener('keydown', onKeyDown, true);
    host.addEventListener('input', sync, true);
    host.addEventListener('click', onCaret, true);
    host.addEventListener('keyup', onCaret, true);
    host.addEventListener('focusin', onCaret, true);
    host.addEventListener('focusout', onFocusOut, true);
    return () => {
      host.removeEventListener('keydown', onKeyDown, true);
      host.removeEventListener('input', sync, true);
      host.removeEventListener('click', onCaret, true);
      host.removeEventListener('keyup', onCaret, true);
      host.removeEventListener('focusin', onCaret, true);
      host.removeEventListener('focusout', onFocusOut, true);
    };
  }, [host, pick, sync, hideTooltip]);

  // Below the line, as Gemini's pane is; above it when the line is too near the bottom, as CDK flips.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!menu || !panel) {
      setPlacement(null);
      return;
    }
    // The layout box: the enter animation starts at scale(0.8), which a client rect would report.
    const { offsetWidth: width, offsetHeight: height } = panel;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(menu.left, window.innerWidth - VIEWPORT_MARGIN - width));
    const below = menu.lineBottom + MENU_OFFSET;
    const above = below + height > window.innerHeight - VIEWPORT_MARGIN && menu.lineTop - MENU_OFFSET - height >= VIEWPORT_MARGIN;
    setPlacement({ left, top: above ? menu.lineTop - MENU_OFFSET - height : below, above });
  }, [menu]);

  useEffect(() => {
    if (!menu || !menu.activated) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-index="${menu.highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [menu]);

  // Measured hidden at the corner, where nothing narrows it, then placed before the first paint.
  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!tooltip || !element) {
      setTooltipPlacement(null);
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    const heightAt = (maxWidth: number) => {
      element.style.maxWidth = `${maxWidth}px`;
      const measured = element.getBoundingClientRect().height;
      element.style.maxWidth = '';
      return measured;
    };
    setTooltipPlacement(placeMentionTooltip(tooltip.anchor, { width, height }, { width: window.innerWidth, height: window.innerHeight }, heightAt));
  }, [tooltip]);

  const menuOpen = menu !== null;
  useEffect(() => {
    if (!menuOpen) hideTooltip();
  }, [menuOpen, hideTooltip]);

  useEffect(() => () => hideTooltip(), [hideTooltip]);

  const ranges = useMemo(() => mentionRanges(text, options), [text, options]);

  const showTooltip = (option: MentionOption, element: HTMLElement) => {
    hideTooltip();
    if (!option.description) return;
    tooltipTimerRef.current = window.setTimeout(() => {
      const rect = element.getBoundingClientRect();
      setTooltip({
        text: option.description!,
        anchor: { left: rect.left + TOOLTIP_ANCHOR_INSET_X, right: rect.right - TOOLTIP_ANCHOR_INSET_X, top: rect.top + TOOLTIP_ANCHOR_INSET_Y },
      });
    }, TOOLTIP_DELAY_MS);
  };

  const slash = menu?.query.trigger === '/';
  return (
    <>
      {textarea && ranges.length > 0 && <MentionHighlight textarea={textarea} text={text} ranges={ranges} />}
      {menu && createPortal(
        <div
          className={`spark-mention-pane${placement?.above ? ' is-above' : ''}`}
          style={placement ? { left: placement.left, top: placement.top } : { left: menu.left, top: menu.lineBottom + MENU_OFFSET, visibility: 'hidden' }}
        >
          <div
            ref={panelRef}
            className={`spark-mention-menu ${slash ? 'spark-mention-menu--slash' : 'spark-mention-menu--apps'}`}
            role="menu"
            aria-label={slash ? 'Skills' : 'Apps'}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="spark-mention-menu__content">
              {menu.matches.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  data-index={index}
                  className={[
                    'spark-mention-menu__item',
                    index === menu.highlight ? 'is-highlighted' : '',
                    option.dimmed ? 'is-dimmed' : '',
                    option.disabledSkill ? 'is-disabled-skill' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={option.label}
                  onMouseEnter={(event) => {
                    setMenu((current) => current && { ...current, highlight: index, activated: true });
                    showTooltip(option, event.currentTarget);
                  }}
                  onMouseLeave={hideTooltip}
                  onClick={() => pick(option)}
                >
                  <MentionIcon option={option} />
                  <span className="spark-mention-menu__label">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {menu && tooltip && createPortal(
        <div
          ref={tooltipRef}
          className="spark-mention-tooltip"
          role="dialog"
          aria-label="Skill description"
          style={tooltipPlacement
            ? { left: tooltipPlacement.left, top: tooltipPlacement.top, maxWidth: tooltipPlacement.maxWidth }
            : { left: 0, top: 0, visibility: 'hidden' }}
        >
          {tooltip.text}
        </div>,
        document.body,
      )}
    </>
  );
};
