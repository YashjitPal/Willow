// Flow TV's building blocks, prop for prop: its icon, ButtonIcon, ButtonOutline, ButtonSolid,
// tooltip, assets and screen-reader alerts. Each sets the data attributes and custom properties
// willow-tv.css (Flow TV's own stylesheet) styles them by, so the CSS needs no Willow changes.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TvIconName } from './tv-icons';
import { CSS_EASE_OUT } from './tv-motion';
import { tvColor } from './tv-theme';

export const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');
const rgb = (token?: string) => (token ? tvColor(token) : undefined);

export type IconProps = React.SVGProps<SVGSVGElement> & { [data: `data-${string}`]: unknown };

export const TvIcon: React.FC<{ id: TvIconName } & IconProps> = ({ id, ...rest }) => (
  <svg {...rest} aria-hidden>
    <use href={`#wtv-${id}`} />
  </svg>
);

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string; isExternal?: boolean; replace?: boolean };

/** Flow TV's Link: router links inside Willow TV, a new tab for anything else. */
export const TvLink = React.forwardRef<HTMLAnchorElement, LinkProps>(({ href, isExternal, replace, children, ...rest }, ref) => {
  if (!href) return <a ref={ref} {...rest}>{children}</a>;
  if (isExternal) return <a ref={ref} href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
  return <Link ref={ref} to={href} replace={replace} {...rest}>{children}</Link>;
});
TvLink.displayName = 'TvLink';

export const TvTooltip: React.FC<{ height: 34 | 44; className?: string; children: React.ReactNode }> = ({ height, className, children }) => (
  <span className={cx('wtv-tooltip__tooltip', className)} data-height={height}>{children}</span>
);

/** motion's AnimatePresence mode="wait" around an icon: the old fades out, then the new fades in. */
const FadingIcon: React.FC<{ icon: TvIconName } & IconProps> = ({ icon, style, ...rest }) => {
  const [shown, setShown] = useState(icon);
  const out = shown !== icon;
  useEffect(() => {
    if (!out) return;
    const t = setTimeout(() => setShown(icon), 200);
    return () => clearTimeout(t);
  }, [icon, out]);
  return <TvIcon {...rest} id={shown} style={{ ...style, opacity: out ? 0 : 1, transition: 'opacity 0.2s linear' }} />;
};

export interface ButtonIconProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  element?: 'button' | 'link';
  href?: string;
  isExternal?: boolean;
  icon: TvIconName;
  shape?: 'circle' | 'oval';
  colorIcon: string;
  colorIconAlpha?: number;
  colorIconHover?: string;
  colorIconHoverAlpha?: number;
  colorBackground?: string;
  colorBackgroundAlpha?: number;
  colorBackgroundHover?: string;
  colorBackgroundHoverAlpha?: number;
  colorBackgroundPressed?: string;
  colorBackgroundPressedAlpha?: number;
  colorBackgroundDisabled?: string;
  colorBackgroundDisabledAlpha?: number;
  colorIconDisabled?: string;
  colorIconDisabledAlpha?: number;
  containerSize: number;
  containerSizeMobile?: number;
  containerSizeMobileLarge?: number;
  containerHeight?: number;
  containerHeightMobile?: number;
  containerHeightMobileLarge?: number;
  containerBorderRadius?: number;
  containerBorderRadiusMobile?: number;
  containerBorderRadiusMobileLarge?: number;
  iconSize: number;
  iconSizeMobile?: number;
  iconSizeMobileLarge?: number;
  isDisabled?: boolean;
  isHidden?: boolean;
  hasBackdropFilterBlurOnHover?: boolean;
  iconProps?: IconProps;
  animateIconChanges?: boolean;
  title?: string;
  tooltip?: string;
  [data: `data-${string}`]: unknown;
}

/** Flow TV's ButtonIcon. */
export const TvButtonIcon = React.forwardRef<HTMLElement, ButtonIconProps>((props, ref) => {
  const {
    element, href, isExternal, icon, shape = 'circle',
    colorIcon, colorIconAlpha = 1, colorIconHover, colorIconHoverAlpha = 1,
    colorBackground, colorBackgroundAlpha = 1, colorBackgroundHover, colorBackgroundHoverAlpha = 1,
    colorBackgroundPressed, colorBackgroundPressedAlpha, colorBackgroundDisabled, colorBackgroundDisabledAlpha,
    colorIconDisabled, colorIconDisabledAlpha,
    containerSize, containerSizeMobile, containerSizeMobileLarge, containerHeight, containerHeightMobile, containerHeightMobileLarge,
    containerBorderRadius, containerBorderRadiusMobile, containerBorderRadiusMobileLarge,
    iconSize, iconSizeMobile, iconSizeMobileLarge,
    isDisabled = false, isHidden, hasBackdropFilterBlurOnHover = false, iconProps, animateIconChanges,
    title, tooltip, onClick, className, style, tabIndex, ...rest
  } = props;
  const pressed = colorBackgroundPressed ? rgb(colorBackgroundPressed) : rgb(colorBackgroundHover);
  const iconAttrs: IconProps = {
    ...iconProps,
    className: cx(iconProps?.className as string | undefined, 'wtv-button-icon__icon'),
    'data-has-responsive-icon-size-mobile': iconSizeMobile !== undefined,
    'data-has-responsive-icon-size-mobile-large': iconSizeMobileLarge !== undefined,
    style: {
      ...(iconProps?.style as React.CSSProperties | undefined),
      '--icon-size': `${iconSize}px`,
      ...(iconSizeMobileLarge ? { '--icon-size-mobile-large': `${iconSizeMobileLarge}px` } : {}),
      ...(iconSizeMobile ? { '--icon-size-mobile': `${iconSizeMobile}px` } : {}),
    } as React.CSSProperties,
  };
  const attrs = {
    ...rest,
    className: cx('wtv-button-icon__container', className),
    'data-shape': shape,
    'data-is-disabled': isDisabled,
    'data-has-responsive-container-size-mobile': containerSizeMobile !== undefined,
    'data-has-responsive-container-size-mobile-large': containerSizeMobileLarge !== undefined,
    'data-has-responsive-container-height-mobile': containerHeightMobile !== undefined,
    'data-has-responsive-container-height-mobile-large': containerHeightMobileLarge !== undefined,
    'data-has-responsive-container-border-radius-mobile': containerBorderRadiusMobile !== undefined,
    'data-has-responsive-container-border-radius-mobile-large': containerBorderRadiusMobileLarge !== undefined,
    'data-has-color-icon-hover': colorIconHover !== undefined,
    'data-has-tooltip': tooltip !== undefined,
    'data-has-backdrop-filter-blur-on-hover': hasBackdropFilterBlurOnHover,
    'data-has-pressed-background': pressed !== undefined || colorBackgroundPressedAlpha !== undefined,
    ...(isHidden !== undefined ? { 'data-is-hidden': isHidden } : {}),
    style: {
      ...style,
      '--container-size': `${containerSize}px`,
      ...(containerSizeMobileLarge ? { '--container-size-mobile-large': `${containerSizeMobileLarge}px` } : {}),
      ...(containerSizeMobile ? { '--container-size-mobile': `${containerSizeMobile}px` } : {}),
      ...(containerHeight ? { '--container-height': `${containerHeight}px` } : {}),
      ...(containerHeightMobileLarge ? { '--container-height-mobile-large': `${containerHeightMobileLarge}px` } : {}),
      ...(containerHeightMobile ? { '--container-height-mobile': `${containerHeightMobile}px` } : {}),
      ...(containerBorderRadius ? { '--container-border-radius': `${containerBorderRadius}px` } : {}),
      ...(containerBorderRadiusMobileLarge ? { '--container-border-radius-mobile-large': `${containerBorderRadiusMobileLarge}px` } : {}),
      ...(containerBorderRadiusMobile ? { '--container-border-radius-mobile': `${containerBorderRadiusMobile}px` } : {}),
      '--color-icon': rgb(colorIcon),
      '--color-icon-alpha': colorIconAlpha,
      '--color-icon-hover': rgb(colorIconHover),
      '--color-icon-hover-alpha': colorIconHoverAlpha,
      '--color-background': rgb(colorBackground),
      '--color-background-alpha': colorBackgroundAlpha,
      '--color-background-hover': rgb(colorBackgroundHover),
      '--color-background-hover-alpha': colorBackgroundHoverAlpha,
      '--color-background-pressed': pressed,
      '--color-background-pressed-alpha': colorBackgroundPressedAlpha ?? 1,
      '--color-background-disabled': rgb(colorBackgroundDisabled),
      '--color-background-disabled-alpha': colorBackgroundDisabledAlpha ?? 1,
      '--color-disabled': rgb(colorIconDisabled),
      '--color-disabled-alpha': colorIconDisabledAlpha ?? 1,
    } as React.CSSProperties,
    'aria-hidden': isHidden || undefined,
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (isDisabled || isHidden) e.preventDefault();
      else onClick?.(e);
    },
    tabIndex: isDisabled || isHidden ? -1 : tabIndex,
    title: isHidden || tooltip ? undefined : title,
    'aria-label': title,
  };
  const body = (
    <>
      {animateIconChanges ? <FadingIcon {...iconAttrs} icon={icon} /> : <TvIcon {...iconAttrs} id={icon} />}
      {tooltip && !isDisabled && <TvTooltip className="wtv-button-icon__tooltip" height={44}>{tooltip}</TvTooltip>}
    </>
  );
  if (element === 'link') {
    return <TvLink ref={ref as React.Ref<HTMLAnchorElement>} href={href} isExternal={isExternal} {...(attrs as LinkProps)}>{body}</TvLink>;
  }
  return <button ref={ref as React.Ref<HTMLButtonElement>} type="button" {...(attrs as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{body}</button>;
});
TvButtonIcon.displayName = 'TvButtonIcon';

export interface ButtonOutlineProps extends React.HTMLAttributes<HTMLElement> {
  element?: 'button' | 'link';
  href?: string;
  isExternal?: boolean;
  height: number;
  heightMobile?: number;
  fontMobile?: false | 'sans-text-5' | 'sans-text-6';
  colorText: string;
  colorTextHover: string;
  colorBorder?: string;
  colorBorderAlpha?: number;
  colorBorderHover?: string;
  colorBorderHoverAlpha?: number;
  colorBackground?: string;
  colorBackgroundAlpha?: number;
  colorBackgroundHover?: string;
  colorBackgroundHoverAlpha?: number;
  colorBackgroundPressedAlpha?: number;
  hasBackdropFilterBlur?: boolean;
  withIcon?: false | 'left' | 'only';
  isHidden?: boolean;
  [data: `data-${string}`]: unknown;
}

/** Flow TV's ButtonOutline. */
export const TvButtonOutline = React.forwardRef<HTMLElement, ButtonOutlineProps>((props, ref) => {
  const {
    element, href, isExternal, height, heightMobile, fontMobile = false, colorText, colorTextHover,
    colorBorder, colorBorderAlpha = 1, colorBorderHover, colorBorderHoverAlpha = 1,
    colorBackground, colorBackgroundAlpha = 1, colorBackgroundHover, colorBackgroundHoverAlpha = 1,
    colorBackgroundPressedAlpha, hasBackdropFilterBlur = false, withIcon = false, isHidden, className, style, children, ...rest
  } = props;
  const attrs = {
    ...rest,
    className: cx('wtv-button-outline__container', className),
    'data-has-responsive-height-mobile': heightMobile !== undefined,
    'data-font-mobile': fontMobile,
    'data-has-backdrop-filter-blur': hasBackdropFilterBlur,
    'data-has-color-background-pressed-alpha': colorBackgroundPressedAlpha !== undefined,
    'data-with-icon': withIcon,
    ...(isHidden !== undefined ? { 'data-is-hidden': isHidden } : {}),
    style: {
      ...style,
      '--height': `${height}px`,
      ...(heightMobile ? { '--height-mobile': `${heightMobile}px` } : {}),
      '--color-text': rgb(colorText),
      '--color-text-hover': rgb(colorTextHover),
      '--color-border': colorBorder ? rgb(colorBorder) : rgb(colorText),
      '--color-border-alpha': colorBorderAlpha,
      '--color-border-hover': colorBorderHover ? rgb(colorBorderHover) : rgb(colorTextHover),
      '--color-border-hover-alpha': colorBorderHoverAlpha,
      '--color-background': colorBackground ? rgb(colorBackground) : 'transparent',
      '--color-background-alpha': colorBackgroundAlpha,
      '--color-background-hover': colorBackgroundHover ? rgb(colorBackgroundHover) : 'transparent',
      '--color-background-hover-alpha': colorBackgroundHoverAlpha,
      '--color-background-pressed-alpha': colorBackgroundPressedAlpha,
    } as React.CSSProperties,
    'aria-hidden': isHidden || undefined,
  };
  if (element === 'link') {
    return <TvLink ref={ref as React.Ref<HTMLAnchorElement>} href={href} isExternal={isExternal} {...(attrs as LinkProps)}>{children}</TvLink>;
  }
  return <button ref={ref as React.Ref<HTMLButtonElement>} type="button" {...(attrs as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{children}</button>;
});
TvButtonOutline.displayName = 'TvButtonOutline';

/** Flow TV's ButtonSolid (the search filter's chip). */
export const TvButtonSolid: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  height: 27;
  colorText: string;
  colorBackground?: string;
  colorBackgroundAlpha?: number;
  colorBackgroundHover?: string;
  colorBackgroundHoverAlpha?: number;
  colorBackgroundPressedAlpha?: number;
  hasIcon?: boolean;
  isHidden?: boolean;
}> = ({ height, colorText, colorBackground, colorBackgroundAlpha = 1, colorBackgroundHover, colorBackgroundHoverAlpha = 1, colorBackgroundPressedAlpha, hasIcon = false, isHidden, className, style, onClick, tabIndex, children, ...rest }) => (
  <button
    type="button"
    {...rest}
    className={cx('wtv-button-solid__container', className)}
    data-height={height}
    data-has-color-background-pressed-alpha={colorBackgroundPressedAlpha !== undefined}
    data-has-icon={hasIcon}
    {...(isHidden !== undefined ? { 'data-is-hidden': isHidden } : {})}
    style={{
      ...style,
      '--color-text': rgb(colorText),
      '--color-background': colorBackground ? rgb(colorBackground) : 'transparent',
      '--color-background-alpha': colorBackgroundAlpha,
      '--color-background-hover': colorBackgroundHover ? rgb(colorBackgroundHover) : 'transparent',
      '--color-background-hover-alpha': colorBackgroundHoverAlpha,
      '--color-background-pressed-alpha': colorBackgroundPressedAlpha,
    } as React.CSSProperties}
    aria-hidden={isHidden || undefined}
    onClick={isHidden ? undefined : onClick}
    tabIndex={isHidden ? -1 : tabIndex}
  >
    {children}
  </button>
);

/** Flow TV's Image: an <img> in an asset container that fades in once it has loaded. */
export const TvImage = React.forwardRef<HTMLSpanElement, {
  src: string;
  alt?: string;
  className?: string;
  objectFit?: React.CSSProperties['objectFit'];
  animateOnLoad?: boolean;
  style?: React.CSSProperties;
  onLoad?: () => void;
}>(({ src, alt = '', className, objectFit = 'cover', animateOnLoad = true, style, onLoad }, ref) => (
  <span ref={ref} className={cx('wtv-asset__container', className)} style={style} {...(animateOnLoad ? { 'data-animate-on-load': true } : {})}>
    <img
      ref={(el) => {
        if (el?.complete && el.naturalWidth) el.setAttribute('data-is-loaded', 'true');
      }}
      className="wtv-asset__asset"
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      style={{ objectFit }}
      onLoad={(e) => {
        e.currentTarget.setAttribute('data-is-loaded', 'true');
        onLoad?.();
      }}
    />
  </span>
));
TvImage.displayName = 'TvImage';

type VideoProps = React.VideoHTMLAttributes<HTMLVideoElement> & { objectFit?: React.CSSProperties['objectFit']; onLoaded?: () => void };

/** Flow TV's Video: muted and looping unless told otherwise, marked loaded once it has metadata. */
export const TvVideo = React.forwardRef<HTMLVideoElement, VideoProps>(({ objectFit = 'cover', className, style, onLoaded, src, ...rest }, ref) => {
  const local = useRef<HTMLVideoElement | null>(null);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  useEffect(() => {
    const v = local.current;
    if (!v || !src) return;
    const mark = () => {
      v.setAttribute('data-is-loaded', 'true');
      loaded.current?.();
    };
    if (v.readyState > 0) {
      mark();
      return;
    }
    v.addEventListener('loadedmetadata', mark, { once: true });
    return () => v.removeEventListener('loadedmetadata', mark);
  }, [src]);
  return (
    <video
      autoPlay
      playsInline
      loop
      muted
      controlsList="nodownload noplaybackrate"
      disablePictureInPicture
      tabIndex={-1}
      draggable={false}
      preload="metadata"
      controls={false}
      {...rest}
      src={src}
      ref={(el) => {
        local.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className={cx('wtv-asset__asset', className)}
      style={{ ...style, objectFit }}
    />
  );
});
TvVideo.displayName = 'TvVideo';

export const PoliteAlert: React.FC<{ alert: string }> = ({ alert }) => (
  <span aria-live="polite" className="wtv-screen-reader-polite-alert__screenReaderOnly">{alert}</span>
);

export const AssertiveAlert: React.FC<{ alert: string }> = ({ alert }) => (
  <p className="wtv-screen-reader-assertive-alert__screenReaderOnly" aria-live="assertive" role="alert">{alert}</p>
);

/* ---- motion's AnimatePresence, the three ways Flow TV uses it ---- */

const settled = (anims: Animation[]) => Promise.all(anims.map((a) => a.finished.catch(() => undefined)));

/**
 * A part of the remote that opens and closes sideways: from width 0 and transparent to its own
 * width, and back before it goes (Flow TV's `initial`/`exit` of `{opacity: 0, width: 0}`, 0.3s
 * ease-out). There at first, it does not animate, as Flow TV's `initial={false}` presences don't.
 * Open, it holds motion's `animate` values inline: Flow TV's stylesheet starts the prompt panel
 * at `width: 0` and leaves the rest to them.
 */
export const WidthPresence: React.FC<{ show: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: unknown }> = ({ show, children, style, ...rest }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(show);
  const animateIn = useRef(false);
  if (show && !rendered) {
    animateIn.current = true;
    setRendered(true);
  }
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (show) {
      el.getAnimations().forEach((a) => a.cancel());
      if (!animateIn.current) return;
      animateIn.current = false;
      const width = el.getBoundingClientRect().width;
      el.animate([{ opacity: 0, width: '0px' }, { opacity: 1, width: `${width}px` }], { duration: 300, easing: CSS_EASE_OUT });
      return;
    }
    const width = el.getBoundingClientRect().width;
    const anim = el.animate([{ opacity: 1, width: `${width}px` }, { opacity: 0, width: '0px' }], { duration: 300, easing: CSS_EASE_OUT, fill: 'forwards' });
    let live = true;
    void anim.finished.then(() => { if (live) setRendered(false); }, () => undefined);
    return () => { live = false; };
  }, [show, rendered]);
  if (!rendered) return null;
  return <div ref={ref} {...rest} style={{ ...style, width: 'auto', opacity: 1 }}>{children}</div>;
};

/**
 * motion's mode="wait": when `swapKey` changes the content leaves (fading and, with `slide`, moving
 * up that far) and only then does the new content come in (from `slide` below). Flow TV's labels
 * only fade (0.2s); the prompt fades in 0.3s and slides 10px in 0.5s.
 */
export const SwapPresence: React.FC<{
  swapKey: string;
  slide?: number;
  as?: 'div' | 'span';
  className?: string;
  children: React.ReactNode;
  onEntered?: () => void;
  [data: `data-${string}`]: unknown;
}> = ({ swapKey, slide = 0, as = 'div', className, children, onEntered, ...rest }) => {
  const ref = useRef<HTMLElement>(null);
  const [shownKey, setShownKey] = useState(swapKey);
  const [held, setHeld] = useState<React.ReactNode>(null);
  const leaving = shownKey !== swapKey;
  const entered = useRef(onEntered);
  entered.current = onEntered;
  const last = useRef(children);
  if (!leaving) last.current = children;
  useEffect(() => {
    if (!leaving) return;
    setHeld(last.current);
    const el = ref.current;
    if (!el) {
      setShownKey(swapKey);
      return;
    }
    const fadeMs = slide ? 300 : 200;
    const anims = [el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeMs, easing: 'linear', fill: 'forwards' })];
    if (slide) anims.push(el.animate([{ transform: 'translateY(0px)' }, { transform: `translateY(${-slide}px)` }], { duration: 500, easing: CSS_EASE_OUT, fill: 'forwards' }));
    let live = true;
    void settled(anims).then(() => {
      if (!live) return;
      setHeld(null);
      setShownKey(swapKey);
    });
    return () => { live = false; };
  }, [leaving, swapKey, slide]);
  const enteredKey = useRef(shownKey);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || leaving || enteredKey.current === shownKey) return;
    enteredKey.current = shownKey;
    el.getAnimations().forEach((a) => a.cancel());
    const anims = [el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: slide ? 300 : 200, easing: 'linear' })];
    if (slide) anims.push(el.animate([{ transform: `translateY(${slide}px)` }, { transform: 'translateY(0px)' }], { duration: 500, easing: CSS_EASE_OUT }));
    void settled(anims).then(() => entered.current?.());
  }, [shownKey, leaving, slide]);
  const Tag = as as 'div';
  return <Tag ref={ref as React.Ref<HTMLDivElement>} className={className} {...rest}>{leaving ? held ?? last.current : children}</Tag>;
};

/**
 * motion's mode="sync": the old item leaves while the new one comes in over it (both in the same
 * grid cell), as the channel nav's thumbnail and name change. `render` draws one item by its key.
 */
export function SyncPresence<K extends string>({ itemKey, render, leave, enter }: {
  itemKey: K;
  render: (key: K, ref: (el: HTMLElement | null) => void) => React.ReactNode;
  leave: (el: HTMLElement) => Animation[];
  enter: (el: HTMLElement) => Animation[];
}) {
  const [items, setItems] = useState<{ key: K; leaving: boolean; animate: boolean }[]>([{ key: itemKey, leaving: false, animate: false }]);
  const els = useRef(new Map<string, HTMLElement>());
  if (!items.some((i) => i.key === itemKey && !i.leaving)) {
    setItems((prev) => [
      ...prev.filter((i) => i.key !== itemKey).map((i) => ({ ...i, leaving: true, animate: true })),
      { key: itemKey, leaving: false, animate: true },
    ]);
  }
  useLayoutEffect(() => {
    for (const item of items) {
      const el = els.current.get(item.key);
      const state = item.leaving ? 'leave' : 'enter';
      if (!el || !item.animate || el.dataset.presence === state) continue;
      el.dataset.presence = state;
      el.getAnimations().forEach((a) => a.cancel());
      if (!item.leaving) {
        enter(el);
        continue;
      }
      void settled(leave(el)).then(() => {
        setItems((prev) => prev.filter((i) => !(i.key === item.key && i.leaving)));
      });
    }
  }, [items, leave, enter]);
  return (
    <>
      {items.map((item) => (
        <React.Fragment key={item.key}>
          {render(item.key, (el) => {
            if (el) els.current.set(item.key, el);
            else els.current.delete(item.key);
          })}
        </React.Fragment>
      ))}
    </>
  );
}
