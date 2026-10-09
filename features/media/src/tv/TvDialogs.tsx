// Flow TV's dialogs: the modal <dialog> they share, About (the header's help button) and Share.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { slugify } from './tv-library';
import { tvClipPath } from './tv-routes';
import { themeVars } from './tv-theme';
import { TvButtonIcon, TvButtonOutline, TvIcon, TvVideo, cx } from './TvPrimitives';
import { useMediaUrl, useTvRemote, useTvShell } from './TvState';

/** Flow TV's Dialog: a modal <dialog> that fades in and out over 0.2s and stops the page scrolling. */
export const TvDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  children: React.ReactNode;
}> = ({ isOpen, onClose, className, style, onClick, children }) => {
  const { setHasOpenDialog } = useTvShell();
  const ref = useRef<HTMLDialogElement>(null);
  const [rendered, setRendered] = useState(isOpen);
  if (isOpen && !rendered) setRendered(true);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (isOpen) {
      d.getAnimations().forEach((a) => a.cancel());
      if (!d.open) d.showModal();
      setHasOpenDialog(true);
      d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' });
      return;
    }
    const fade = d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' });
    let live = true;
    void fade.finished.then(() => {
      if (!live) return;
      if (d.open) d.close();
      setRendered(false);
      setHasOpenDialog(false);
    }, () => undefined);
    return () => { live = false; };
  }, [isOpen, rendered, setHasOpenDialog]);
  useEffect(() => {
    if (!isOpen) return;
    const { body } = document;
    const before = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = before; };
  }, [isOpen]);
  if (!rendered) return null;
  return (
    <dialog
      ref={ref}
      className={cx('wtv-dialog__container', className)}
      style={style}
      onClick={onClick}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
};

const ABOUT = `Willow TV is an ever-growing showcase of the clips, channels, and short films you've made in Willow.

Use the remote control at the bottom of the screen to browse Channels and see the prompt behind the clip. Hit the Home button to see all Channels, or watch the short films you've put together in Scenebuilder.

Every Media project with a finished video is a channel, and every scene is a short film. Nothing leaves this device: Willow TV only plays what is already in your projects.

Create with Willow <a href="/media" target="_blank">here</a>.`;

/** Flow TV's HTML renderer, for the few strings it writes with links in them. */
export const TvHtml: React.FC<{ html: string; theme: Parameters<typeof themeVars>[0]; className?: string }> = ({ html, theme, className }) => (
  <p className={cx('wtv-html-renderer__html', className)} dangerouslySetInnerHTML={{ __html: html }} style={themeVars(theme, [300]) as React.CSSProperties} />
);

/** The header's help button and Flow TV's About dialog, in the page's theme (purple off a channel). */
export const TvAboutButton: React.FC = () => {
  const { pageTheme } = useTvShell();
  const theme = pageTheme || 'purple';
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <TvButtonIcon
        shape="circle"
        icon="help"
        colorIcon="neutral-100"
        colorBackgroundHover="white"
        colorBackgroundHoverAlpha={0.15}
        colorBackgroundPressedAlpha={0.25}
        containerSize={40}
        iconSize={24}
        title="About Willow TV"
        onClick={() => setOpen((v) => !v)}
      />
      <TvDialog className="wtv-button-help-dialog__dialog" isOpen={open} onClose={close} onClick={close} style={themeVars(theme, [300, 200]) as React.CSSProperties}>
        <div className="wtv-button-help-dialog__modalOuterContainer">
          <div className="wtv-button-help-dialog__modalInnerContainer" onClick={(e) => e.stopPropagation()}>
            <h1 className="wtv-button-help-dialog__modalTitle">About Willow TV</h1>
            <TvHtml className="wtv-button-help-dialog__modalDescription" html={ABOUT} theme={theme} />
            <button type="button" className="wtv-button-help-dialog__modalButton" onClick={close}>Got it</button>
          </div>
        </div>
      </TvDialog>
    </>
  );
};

const copy = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'absolute';
  area.style.opacity = '0';
  document.body.prepend(area);
  area.select();
  try { document.execCommand('copy'); } finally { area.remove(); }
};

const download = async (src: string, name: string) => {
  try {
    const blob = await (await fetch(src)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(`Error downloading file: ${e}`);
  }
};

const OUTLINE = {
  height: 40,
  heightMobile: 34,
  fontMobile: 'sans-text-5' as const,
  colorText: 'neutral-100',
  colorTextHover: 'neutral-100',
  colorBorder: 'white',
  colorBorderAlpha: 0.15,
  colorBackground: 'white',
  colorBackgroundAlpha: 0.05,
  colorBorderHover: 'white',
  colorBorderHoverAlpha: 0.15,
  colorBackgroundPressedAlpha: 0.25,
  colorBackgroundHover: 'white',
  colorBackgroundHoverAlpha: 0.15,
};

const CopyLinkButton: React.FC<{ shareUrl: string }> = ({ shareUrl }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <TvButtonOutline
      {...OUTLINE}
      className="wtv-share-dialog__buttonCopyOuterContainer"
      withIcon="left"
      onClick={() => {
        void copy(shareUrl);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }}
    >
      <span className="wtv-share-dialog__buttonCopyInnerContainer" key={String(copied)} style={{ animation: 'wtv-fade-in 0.2s linear' }}>
        <TvIcon className="wtv-share-dialog__buttonIcon" id={copied ? 'tick' : 'anchor'} />
        {copied ? 'Link Copied' : 'Copy Link'}
      </span>
    </TvButtonOutline>
  );
};

/**
 * Flow TV's Share dialog: the clip, Copy Link, and Download. Flow TV's links are public and it
 * offers X as well; Willow TV's open only on this device, so it keeps to copying and saving.
 */
export const TvShareDialog: React.FC = () => {
  const { channelProps, channelGenerationProps: gen, isShareDialogOpen, setIsShareDialogOpen } = useTvRemote();
  const close = useCallback(() => setIsShareDialogOpen(false), [setIsShareDialogOpen]);
  const src = useMediaUrl(isShareDialogOpen ? gen?.shareMedia : null);
  const shareUrl = useMemo(() => {
    if (!gen || !channelProps) return window.location.href;
    return `${window.location.origin}${tvClipPath(gen.parentSlug, gen.id)}`;
  }, [gen, channelProps]);
  if (!channelProps) return null;
  return (
    <TvDialog className="wtv-share-dialog__dialog" isOpen={isShareDialogOpen} onClose={close} onClick={close}>
      <div className="wtv-share-dialog__contentContainer" onClick={(e) => e.stopPropagation()}>
        <div className="wtv-share-dialog__headerContainer">
          <TvButtonIcon
            className="wtv-share-dialog__buttonArrowBack"
            shape="circle"
            icon="arrow-back"
            colorIcon="white"
            colorBackgroundHover="white"
            colorBackgroundHoverAlpha={0.15}
            colorBackgroundPressedAlpha={0.25}
            hasBackdropFilterBlurOnHover
            containerSize={40}
            iconSize={30}
            containerSizeMobile={32}
            iconSizeMobile={20}
            title="Go back"
            onClick={close}
          />
          <h1 className="wtv-share-dialog__title">Share</h1>
        </div>
        <div className="wtv-share-dialog__videoContainer">
          {src && <span className="wtv-asset__container"><TvVideo src={src} /></span>}
        </div>
        <div className="wtv-share-dialog__buttonsContainer">
          <div className="wtv-share-dialog__buttonsLeftColumnOuterContainer">
            <CopyLinkButton shareUrl={shareUrl} />
          </div>
          {src && gen && !gen.hasFullVideo && (
            <TvButtonOutline {...OUTLINE} className="wtv-share-dialog__buttonDownload" withIcon="left" onClick={() => void download(src, `${slugify(gen.description).slice(0, 48) || 'video'}.mp4`)}>
              <TvIcon className="wtv-share-dialog__buttonIcon" id="download" />
              Download
            </TvButtonOutline>
          )}
        </div>
      </div>
    </TvDialog>
  );
};
