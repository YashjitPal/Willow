// Flow TV's header and sub-header: the blurred backdrop, the logo (a random channel), search with
// its model filter, Create with Willow, About, and the More menu; under them, the back arrow and
// the Channels / Short Films tabs, the FAQ title, or the search's title.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ALL_VIDEOS, searchFilters } from './tv-library';
import { CSS_EASE_OUT } from './tv-motion';
import { PARAM_QUERY, TV_BASE, TV_CHANNELS, TV_FAQ, TV_SHORT_FILMS, isChannelRoute, parseTvPath, tvSearchPath, type TvRoute } from './tv-routes';
import { TvAboutButton } from './TvDialogs';
import { TvButtonIcon, TvButtonOutline, TvButtonSolid, TvIcon, TvLink, cx } from './TvPrimitives';
import { useHotkey, useTvLibrary } from './TvState';
import type { TvIconName } from './tv-icons';

const MEDIA_HOME = '/media';

/** Clicks outside `ref` close what it holds (Flow TV's useClickOutside). */
function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, isEnabled: boolean) {
  useEffect(() => {
    if (!isEnabled) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onOutside();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, onOutside, isEnabled]);
}

/** Tab keeps to what `ref` holds while it is open (Flow TV's focus trap). */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>, isEnabled: boolean, tabbable = "a[href]:not([tabindex='-1']), button:not([tabindex='-1']), [tabindex='0']") {
  useHotkey('Tab', (e) => {
    const el = ref.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(tabbable);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (!el.contains(active)) {
      (e.shiftKey ? last : first).focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    } else if (e.shiftKey && active === first) {
      last.focus();
      e.preventDefault();
    }
  }, { isEnabled });
}

/**
 * Whether focus is inside `ref`, as Flow TV's search tracks it: a press inside that moves focus
 * nowhere (on the filter chip's padding, say) does not count as leaving.
 */
function useFocusWithin(ref: React.RefObject<HTMLElement | null>, onChange: (inside: boolean) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inside = false;
    let downWithin: Node | null = null;
    const onDown = (e: MouseEvent) => { downWithin = e.target instanceof Node ? e.target : null; };
    const onIn = () => {
      if (inside) return;
      inside = true;
      onChange(true);
    };
    const onOut = (e: FocusEvent) => {
      if (!inside || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
      if (downWithin) {
        const within = el.contains(downWithin);
        downWithin = null;
        if (within) return;
      }
      inside = false;
      onChange(false);
    };
    document.addEventListener('mousedown', onDown, { passive: true });
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('mousedown', onDown);
      el.removeEventListener('focusin', onIn);
      el.removeEventListener('focusout', onOut);
    };
  }, [ref, onChange]);
}

const Backdrop: React.FC<{ route: TvRoute }> = ({ route }) => (
  <span className="wtv-backdrop__backdrop" data-is-hidden={isChannelRoute(route)}>
    {Array.from({ length: 6 }, (_, i) => <span key={i} className="wtv-backdrop__blur" />)}
  </span>
);

const FilterButton: React.FC<{
  activeFilter: string;
  options: { value: string; label: string }[];
  hasFocusWithin: boolean;
  onChange: (value: string) => void;
}> = ({ activeFilter, options, hasFocusWithin, onChange }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  if (!hasFocusWithin && open) setOpen(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  useHotkey('Escape', close, { isEnabled: open });
  useFocusTrap(ref, open, 'button, input:checked');
  useClickOutside(ref, close, open);
  const label = options.find((o) => o.value === activeFilter)?.label ?? 'All Videos';
  return (
    <div ref={ref} className="wtv-button-filter__container wtv-search-input__buttonFilter">
      <TvButtonSolid
        className="wtv-button-filter__buttonSolid"
        height={27}
        colorText="white"
        colorBackground="white"
        colorBackgroundHover="white"
        colorBackgroundAlpha={0.05}
        colorBackgroundHoverAlpha={0.15}
        colorBackgroundPressedAlpha={0.25}
        hasIcon
        onClick={toggle}
        isHidden={!hasFocusWithin}
      >
        {label}
        <TvIcon className="wtv-button-filter__icon" id="chevron-up" data-is-dropdown-open={open} />
      </TvButtonSolid>
      <TvButtonIcon
        className="wtv-button-filter__buttonIcon"
        shape="circle"
        colorIcon="neutral-100"
        colorIconHover="neutral-100"
        colorBackground={open ? 'white' : undefined}
        colorBackgroundAlpha={open ? 0.15 : undefined}
        colorBackgroundHover="white"
        colorBackgroundHoverAlpha={0.15}
        colorBackgroundPressedAlpha={0.25}
        icon="config"
        containerSize={28}
        iconSize={20}
        onClick={toggle}
        isHidden={!hasFocusWithin}
        title="Change search filter"
      />
      {open && (
        <ol className="wtv-button-filter__dropdownContainer" style={{ animation: 'wtv-fade-in 0.2s linear' }}>
          {options.map((o) => (
            <li key={o.value}>
              <label htmlFor={`wtv-filter-${o.value}`} className="wtv-control-radio__container" data-usage="dropdown">
                <input
                  className="wtv-control-radio__input"
                  name="filter"
                  id={`wtv-filter-${o.value}`}
                  type="radio"
                  checked={activeFilter === o.value}
                  onChange={(e) => { if (e.target.checked) onChange(o.value); }}
                />
                {o.label}
              </label>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

const SearchInput: React.FC = () => {
  const navigate = useNavigate();
  const { library } = useTvLibrary();
  const ref = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [hasFocusWithin, setHasFocusWithin] = useState(false);
  const [canShowQueries, setCanShowQueries] = useState(false);
  const [filter, setFilter] = useState(ALL_VIDEOS);
  const options = useMemo(() => (library ? searchFilters(library) : [{ value: ALL_VIDEOS, label: 'All Videos' }]), [library]);
  useFocusWithin(ref, setHasFocusWithin);
  useLayoutEffect(() => {
    const el = buttonsRef.current;
    if (!el) return;
    const from = el.getBoundingClientRect().width;
    el.style.width = hasFocusWithin ? 'auto' : '0px';
    const to = el.getBoundingClientRect().width;
    if (from === to) return;
    el.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: 600, easing: CSS_EASE_OUT });
  }, [hasFocusWithin]);
  return (
    <div ref={ref} className="wtv-search-input__container" data-has-focus-within={hasFocusWithin}>
      <form
        className="wtv-search-input__inputOuterContainer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!query) return;
          navigate(tvSearchPath(query, filter));
          setCanShowQueries(false);
        }}
      >
        <div className="wtv-search-input__inputInnerContainer">
          <TvIcon className="wtv-search-input__iconSearch" id="magnifying-glass" />
          <input
            className="wtv-search-input__input"
            type="text"
            value={query}
            maxLength={200}
            aria-label="Search"
            onChange={(e) => {
              setQuery(e.target.value);
              setCanShowQueries(true);
            }}
          />
          <div ref={buttonsRef} className="wtv-search-input__buttonsOuterContainer" style={{ width: 0 }}>
            <div className="wtv-search-input__buttonsInnerContainer">
              <FilterButton activeFilter={filter} options={options} hasFocusWithin={hasFocusWithin} onChange={setFilter} />
              <TvButtonIcon
                className="wtv-search-input__buttonClear"
                shape="circle"
                colorIcon="neutral-100"
                colorIconHover="neutral-100"
                colorBackgroundHover="white"
                colorBackgroundHoverAlpha={0.15}
                colorBackgroundPressedAlpha={0.25}
                icon="close"
                containerSize={28}
                iconSize={16}
                iconSizeMobile={20}
                onClick={() => setQuery('')}
                isHidden={!hasFocusWithin}
                title="Clear search"
              />
            </div>
          </div>
        </div>
      </form>
      {query.length > 0 && hasFocusWithin && canShowQueries && (
        <ul className="wtv-search-input__queriesContainer" style={{ animation: 'wtv-fade-in 0.2s linear' }}>
          <li>
            <TvLink className="wtv-search-input__queryContainer" href={tvSearchPath(query, filter)} onClick={() => setCanShowQueries(false)}>
              Search “{query}”
            </TvLink>
          </li>
        </ul>
      )}
    </div>
  );
};

const MORE_ITEMS: { icon: TvIconName; label: string; href?: string }[] = [
  { icon: '!', label: 'Send app feedback' },
  { icon: 'flag', label: 'Report legal issue' },
  { icon: '?', label: 'FAQ', href: TV_FAQ },
];

const MoreButton: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useHotkey('Escape', close, { isEnabled: open });
  useFocusTrap(ref, open);
  useClickOutside(ref, close, open);
  return (
    <div ref={ref} className="wtv-button-more-dropdown__container">
      <TvButtonIcon
        shape="circle"
        icon="more"
        colorIcon="neutral-100"
        colorBackground={open ? 'white' : undefined}
        colorBackgroundAlpha={open ? 0.15 : undefined}
        colorBackgroundHover="white"
        colorBackgroundHoverAlpha={0.15}
        colorBackgroundPressedAlpha={0.25}
        containerSize={40}
        iconSize={24}
        title="See more options"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <ol className="wtv-button-more-dropdown__dropdownItemsContainer" style={{ animation: 'wtv-fade-in 0.2s linear' }}>
          {MORE_ITEMS.map((item) => (
            <li key={item.label} className="wtv-button-more-dropdown__dropdownItemContainer">
              {item.href ? (
                <TvLink href={item.href} className="wtv-button-more-dropdown__dropdownLink" onClick={close}>
                  <TvIcon id={item.icon} className="wtv-button-more-dropdown__dropdownIcon" />
                  {item.label}
                </TvLink>
              ) : (
                <button type="button" className="wtv-button-more-dropdown__dropdownLink" onClick={close}>
                  <TvIcon id={item.icon} className="wtv-button-more-dropdown__dropdownIcon" />
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/** Flow TV's logo plays a random channel: home again, with a fresh `h` so it picks anew. */
const Logo: React.FC = () => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="wtv-header__logoContainer"
      title="Play random channel"
      aria-label="Play random channel"
      onClick={() => navigate(`${TV_BASE}?h=${Math.random().toString(36).substring(2, 7)}`)}
    >
      <span className="wtv-asset__container wtv-header__logo" style={{ width: 'auto' }}>
        <span className="wtv-wordmark">Willow<span className="wtv-wordmark__badge">TV</span></span>
      </span>
    </button>
  );
};

export const TvHeader: React.FC = () => {
  const { pathname } = useLocation();
  const route = parseTvPath(pathname);
  return (
    <>
      <Backdrop route={route} />
      <header className="wtv-header__container">
        <Logo />
        <SearchInput />
        <div className="wtv-header__buttonsContainer">
          <TvButtonIcon
            className="wtv-header__buttonIconTryFlow"
            shape="circle"
            element="link"
            href={MEDIA_HOME}
            isExternal
            icon="magic"
            colorIcon="neutral-100"
            colorBackgroundHover="white"
            colorBackgroundHoverAlpha={0.15}
            colorBackgroundPressedAlpha={0.25}
            containerSize={40}
            iconSize={24}
            title="Create with Willow"
          />
          <TvButtonOutline
            className="wtv-header__buttonOutlineTryFlow"
            element="link"
            href={MEDIA_HOME}
            isExternal
            height={40}
            colorText="neutral-100"
            colorTextHover="neutral-100"
            colorBorder="white"
            colorBorderAlpha={0.15}
            colorBackground="white"
            colorBackgroundAlpha={0.05}
            colorBorderHover="white"
            colorBorderHoverAlpha={0.15}
            colorBackgroundPressedAlpha={0.25}
            colorBackgroundHover="white"
            colorBackgroundHoverAlpha={0.15}
          >
            Create with Willow
          </TvButtonOutline>
          <TvAboutButton />
          <MoreButton />
        </div>
      </header>
    </>
  );
};

const SUB_HEADER_TABS = [
  { label: 'Channels', href: TV_CHANNELS },
  { label: 'Short Films', href: TV_SHORT_FILMS },
];

/** Under the header on every page but a channel's: back, and the page's tabs or title. */
export const TvSubHeader: React.FC<{ hasPrevious: boolean }> = ({ hasPrevious }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseTvPath(location.pathname);
  const shown = route.kind === 'channels' || route.kind === 'short-films' || route.kind === 'faq' || route.kind === 'search' || route.kind === 'not-found';
  if (!shown) return null;
  const query = new URLSearchParams(location.search).get(PARAM_QUERY);
  return (
    <header className="wtv-sub-header__container" style={{ animation: 'wtv-fade-in 0.2s linear' }}>
      {hasPrevious && (
        <TvButtonIcon
          className="wtv-sub-header__buttonArrowBack"
          icon="arrow-back"
          colorIcon="white"
          colorBackgroundHover="white"
          colorBackgroundHoverAlpha={0.15}
          colorBackgroundPressedAlpha={0.25}
          containerSize={40}
          iconSize={24}
          hasBackdropFilterBlurOnHover
          title="Go to a random channel video"
          onClick={() => navigate(-1)}
        />
      )}
      {(route.kind === 'channels' || route.kind === 'short-films') && (
        <div className="wtv-channels-and-short-films-sub-header__container">
          {SUB_HEADER_TABS.map((tab) => (
            <TvLink
              key={tab.href}
              className="wtv-channels-and-short-films-sub-header__link"
              href={tab.href}
              replace
              data-is-active={location.pathname === tab.href}
              aria-label={`Go to ${tab.label}`}
            >
              {tab.label}
            </TvLink>
          ))}
        </div>
      )}
      {route.kind === 'faq' && <h1 className="wtv-faq-sub-header__title">FAQ</h1>}
      {route.kind === 'search' && (
        <h1 className="wtv-search-sub-header__container">
          {query && <span className={cx('wtv-search-sub-header__title')} key={query}>Search results for “{query}”</span>}
        </h1>
      )}
    </header>
  );
};
