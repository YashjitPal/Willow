import React, { useRef } from 'react';
import { launchMaterialRipple } from '@willow/chat/material-ripple';
import { IslandButton } from '../search/IslandButton';

/**
 * Gemini's "Search chats" button, one of its React islands: left of the toggle in the expanded
 * sidebar and the drawer (`header`, sized for each by the stylesheet), under New chat on the
 * collapsed rail (`rail`). Its tooltip is the island kind, below the button in the header and to
 * the right on the rail.
 */
export const SidebarSearchButton: React.FC<{
  placement: 'header' | 'rail';
  onClick: () => void;
}> = ({ placement, onClick }) => (
  <IslandButton
    aria-label="Search chats"
    aria-haspopup="dialog"
    title="Search chats"
    data-tooltip-variant="island"
    data-tooltip-position={placement === 'rail' ? 'right' : 'below'}
    className={`willow-sidenav-search willow-sidenav-search--${placement}`}
    onClick={onClick}
  >
    <span className="luminous-symbols willow-sidenav-glyph willow-sidenav-search-glyph" aria-hidden="true">search</span>
  </IslandButton>
);

/** A Material icon button's ripple, from the button's middle as Gemini's icon buttons start theirs. */
const useCentredRipple = (className: string) => {
  const ripplesRef = useRef<HTMLSpanElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const end = () => {
    releaseRef.current?.();
    releaseRef.current = null;
  };
  const start = (event: React.PointerEvent) => {
    if (event.button !== 0 || !ripplesRef.current) return;
    end();
    const box = ripplesRef.current.getBoundingClientRect();
    releaseRef.current = launchMaterialRipple(ripplesRef.current, className, box.left + box.width / 2, box.top + box.height / 2);
  };
  return { ripplesRef, handlers: { onPointerDown: start, onPointerUp: end, onPointerLeave: end, onPointerCancel: end } };
};

/**
 * Gemini's "Close sidebar" (`gem-icon-button`, 36px with its 20px `side_nav`, which turns into
 * `side_nav_collapse` while hovered or focused). In the drawer it is the 48px close button, its
 * 28px `close` glyph Gemini's too.
 */
export const SidebarCloseButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const ripple = useCentredRipple('willow-sidenav-ripple willow-sidenav-ripple--close');
  return (
    <button
      type="button"
      aria-label="Close sidebar"
      title="Close sidebar"
      data-tooltip-position="right"
      className="willow-sidenav-close-button willow-sidenav-icon-button"
      onClick={onClick}
      {...ripple.handlers}
    >
      <span ref={ripple.ripplesRef} className="willow-sidenav-ripples" aria-hidden="true" />
      <span className="luminous-symbols willow-sidenav-glyph willow-sidenav-close-glyph willow-sidenav-close-glyph--rest" aria-hidden="true">side_nav</span>
      <span className="luminous-symbols willow-sidenav-glyph willow-sidenav-close-glyph willow-sidenav-close-glyph--active" aria-hidden="true">side_nav_collapse</span>
      <span className="luminous-symbols willow-sidenav-glyph willow-sidenav-close-glyph willow-sidenav-close-glyph--drawer" aria-hidden="true">close</span>
    </button>
  );
};

/**
 * Gemini's collapsed-rail "Open sidebar" (`side-nav-sparkle-button`): the 22px logo at rest,
 * `side_nav_expand` while hovered or focused, swapped in one frame.
 */
export const SidebarOpenButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => {
  const ripple = useCentredRipple('willow-sidenav-ripple willow-sidenav-ripple--open');
  return (
    <button
      type="button"
      aria-label="Open sidebar"
      title="Open sidebar"
      data-tooltip-position="right"
      className="willow-sidenav-open-button willow-sidenav-icon-button"
      onClick={onClick}
      {...ripple.handlers}
    >
      <span ref={ripple.ripplesRef} className="willow-sidenav-ripples" aria-hidden="true" />
      <span className="willow-sidenav-open-logo">{children}</span>
      <span className="luminous-symbols willow-sidenav-glyph willow-sidenav-open-glyph" aria-hidden="true">side_nav_expand</span>
    </button>
  );
};
