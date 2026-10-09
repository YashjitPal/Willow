/**
 * The Deep Research side panel — Gemini's `deep-research-immersive-panel` inside the same
 * `immersive-panel` shell as Canvas (#1f1f1f, radius 40, 24/32/48/8 margins, a 60px toolbar
 * 32px in).
 *
 * While the run is going: the title, "Show thinking", and a timeline — skeleton bars until
 * the first note, then italic notes on a sparkle rail and the sources as 220px chips under
 * the Google mark. Once it is done: the report (h1 28/36 at 350, h2 24/28 at 380, 17/24
 * prose) under Contents, Share & Export and Create.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { markdownToEditorHtml } from '../canvas/canvas-markdown';
import { useCompactViewport } from '../use-compact-viewport';
import type { ResearchRecord, ResearchSource } from './research-types';
import './research.css';

export type ResearchCreateKind = 'web' | 'infographic' | 'quiz' | 'flashcards';

const CREATE_ITEMS: { kind: ResearchCreateKind; label: string; icon: string; family: 'luminous' | 'google-symbols' }[] = [
  { kind: 'web', label: 'Web page', icon: 'web', family: 'google-symbols' },
  { kind: 'infographic', label: 'Infographic', icon: 'bar_chart', family: 'google-symbols' },
  { kind: 'quiz', label: 'Quiz', icon: 'quiz', family: 'luminous' },
  { kind: 'flashcards', label: 'Flashcards', icon: 'cards_star', family: 'google-symbols' },
];

const Glyph: React.FC<{ name: string; family: 'luminous' | 'google-symbols'; size: number }> = ({ name, family, size }) => (
  family === 'luminous'
    ? <MaterialSymbol family="luminous" name={name} size={size} weight={300} roundness={100} opticalSize={24} />
    : <MaterialSymbol family="google-symbols" name={name} size={size} weight={300} />
);

/** An `lm-menu-theme` panel under its trigger, right-aligned to it. */
const PanelMenu: React.FC<{
  anchor: HTMLElement;
  width: number;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}> = ({ anchor, width, onClose, className = '', children }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPlace({ top: r.bottom + 8, left, maxHeight: window.innerHeight - r.bottom - 24 });
  }, [anchor, width]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  if (!place) return null;
  return createPortal(
    <div ref={ref} className={`dr-menu ${className}`} role="menu" style={{ top: place.top, left: place.left, width, maxHeight: place.maxHeight }}>
      {children}
    </div>,
    document.body,
  );
};

const favicon = (url: string): string => {
  try {
    const { origin } = new URL(url);
    return `https://t2.gstatic.com/faviconV2?url=${encodeURIComponent(origin)}/&client=BARD&type=FAVICON&size=32&fallback_opts=TYPE,SIZE,URL`;
  } catch {
    return '';
  }
};

const SourceChips: React.FC<{ sources: ResearchSource[] }> = ({ sources }) => (
  <div className="dr-timeline__item">
    <div className="dr-timeline__side">
      <span className="dr-timeline__dot">
        <img className="dr-timeline__google" src="https://www.gstatic.com/lamda/images/immersives/google_logo_icon_2380fba942c84387f09cf.svg" alt="" />
      </span>
      <span className="dr-timeline__line dr-timeline__line--first" />
    </div>
    <div className="dr-chips">
      {sources.map((source) => (
        <a key={source.url} className="dr-chip" href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
          <img className="dr-chip__icon" src={favicon(source.url)} alt="" />
          <span className="dr-chip__domain">{source.domain}</span>
          <span className="dr-chip__title">{source.title}</span>
        </a>
      ))}
    </div>
  </div>
);

const Skeleton: React.FC = () => (
  <div className="dr-skeleton" aria-hidden="true">
    {[0, 1, 2, 3].map((group) => (
      <div key={group} className="dr-skeleton__group">
        <span className="dr-skeleton__bar dr-skeleton__bar--short" />
        <span className="dr-skeleton__bar" />
        <span className="dr-skeleton__bar" />
        <span className="dr-skeleton__bar dr-skeleton__bar--mid" />
      </div>
    ))}
  </div>
);

const headingsOf = (markdown: string): { level: number; text: string }[] =>
  markdown.split('\n')
    .map((line) => /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ level: m[1].length, text: m[2].replace(/[*_`]/g, '') }));

const fileStem = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Research report';

export const ResearchPanel: React.FC<{
  record: ResearchRecord;
  onClose: () => void;
  onCreate: (kind: ResearchCreateKind) => void;
}> = ({ record, onClose, onCreate }) => {
  const [showThinking, setShowThinking] = useState(true);
  const [menu, setMenu] = useState<{ kind: 'contents' | 'export' | 'create'; anchor: HTMLElement } | null>(null);
  const compact = useCompactViewport();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const done = record.status === 'done' && !!record.report;
  const headings = useMemo(() => (done ? headingsOf(record.report ?? '') : []), [done, record.report]);

  useEffect(() => {
    // Kept mounted behind another tab (`inert`), the chat leaves the Escape to the tab on show.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !menu && !bodyRef.current?.closest('[inert]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, onClose]);

  const toggleMenu = (kind: 'contents' | 'export' | 'create') => (event: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget;
    setMenu((open) => (open?.kind === kind ? null : { kind, anchor }));
  };

  const scrollToHeading = (text: string) => {
    closeMenu();
    const target = [...(bodyRef.current?.querySelectorAll('h1, h2, h3') ?? [])].find((h) => h.textContent?.trim() === text);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const share = async () => {
    closeMenu();
    const text = record.report ?? '';
    try {
      if (navigator.share) { await navigator.share({ title: record.title, text }); return; }
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'AbortError') return;
    }
    await navigator.clipboard.writeText(text).then(() => showCopyToast('Copied to clipboard'), () => showCopyToast('Something went wrong'));
  };

  const exportDoc = () => {
    closeMenu();
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${record.title}</title></head><body>${markdownToEditorHtml(record.report ?? '')}</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'application/msword' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileStem(record.title)}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyContents = async () => {
    closeMenu();
    await navigator.clipboard.writeText(record.report ?? '').then(() => showCopyToast('Copied to clipboard'), () => showCopyToast('Something went wrong'));
  };

  /* Below 960px the panel is full screen and portalled to the body, as Canvas's is: inside
     ChatView an ancestor's stacking context leaves the shell's mobile header icons on top. */
  const panel = (
    <motion.aside
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ scale: { duration: 0.5, ease: [0.2, 0, 0, 1] }, opacity: { duration: 0.2, ease: 'linear' } }}
      className="dr-panel fixed inset-0 z-[1000] flex min-h-0 min-w-0 origin-center flex-col overflow-hidden transform-gpu min-[960px]:relative min-[960px]:inset-auto min-[960px]:z-auto min-[960px]:mb-12 min-[960px]:ml-2 min-[960px]:mr-8 min-[960px]:mt-6 min-[960px]:rounded-[40px] min-[960px]:border min-[960px]:border-white/[0.12]"
      aria-label={`${record.title} research`}
    >
      <div className="dr-toolbar">
        <div className="dr-toolbar__left">
          <h2 className="dr-toolbar__title">{record.title}</h2>
          {!done && (
            <>
              <span className="dr-toolbar__divider" aria-hidden="true" />
              {/* Gemini's label stays "Show thinking" whether the notes are open or not. */}
              <button type="button" className="dr-toolbar__thinking" aria-expanded={showThinking} onClick={() => setShowThinking((open) => !open)}>
                Show thinking
                <MaterialSymbol family="google-symbols" name="keyboard_arrow_down" size={18} weight={400} className={showThinking ? '' : '-rotate-90'} />
              </button>
            </>
          )}
        </div>
        <div className="dr-toolbar__actions">
          {done && (
            <>
              <button type="button" className="dr-toolbar__pill" aria-label="Table of contents menu" aria-expanded={menu?.kind === 'contents'} onClick={toggleMenu('contents')}>
                <span>Contents</span>
                <MaterialSymbol family="google-symbols" name="keyboard_arrow_down" size={18} weight={400} />
              </button>
              <button type="button" className="dr-toolbar__pill dr-toolbar__pill--tonal" aria-label="Share and export" aria-expanded={menu?.kind === 'export'} onClick={toggleMenu('export')}>
                <span className="dr-toolbar__pill-icon"><Glyph name="share_1" family="luminous" size={20} /></span>
                <span className="dr-toolbar__pill-label">Share &amp; Export</span>
                <MaterialSymbol family="google-symbols" name="keyboard_arrow_down" size={18} weight={400} className="dr-toolbar__pill-chevron" />
              </button>
              <button type="button" className="dr-toolbar__pill dr-toolbar__pill--create" aria-expanded={menu?.kind === 'create'} onClick={toggleMenu('create')}>
                <span>Create</span>
                <MaterialSymbol family="luminous" name="keyboard_arrow_down" size={20} weight={300} roundness={100} opticalSize={20} />
              </button>
            </>
          )}
          <button type="button" className="dr-toolbar__close" aria-label="Close panel" title="Close" onClick={onClose}>
            <MaterialSymbol family="luminous" name="close" size={24} weight={300} roundness={100} opticalSize={24} />
          </button>
        </div>
      </div>

      <div ref={bodyRef} className="dr-body">
        {done ? (
          <StreamingMarkdown text={record.report ?? ''} isStreaming={false} animate={false} reveal={false} className="dr-report" />
        ) : record.status === 'running' || record.status === 'plan' ? (
          showThinking && (
            record.thoughts.length === 0 && record.sources.length === 0 ? <Skeleton /> : (
              <div className="dr-timeline">
                {record.thoughts.map((thought, i) => (
                  <div key={i} className="dr-timeline__item">
                    <div className="dr-timeline__side">
                      {i === 0 && (
                        <span className="dr-timeline__dot">
                          <MaterialSymbol family="luminous" name="spark" size={28} weight={260} roundness={100} opticalSize={24} />
                        </span>
                      )}
                      <span className={`dr-timeline__line${i === 0 ? ' dr-timeline__line--first' : ''}`} />
                    </div>
                    <div className="dr-thought">
                      <div className="dr-thought__heading">{thought.heading}</div>
                      <div className="dr-thought__body">{thought.body}</div>
                    </div>
                  </div>
                ))}
                {record.sources.length > 0 && <SourceChips sources={record.sources} />}
              </div>
            )
          )
        ) : (
          <div className="dr-ended">{record.status === 'canceled' ? 'This research was canceled.' : record.error || "This research didn't finish."}</div>
        )}
      </div>

      {menu?.kind === 'contents' && (
        <PanelMenu anchor={menu.anchor} width={400} onClose={closeMenu} className="dr-menu--contents">
          {headings.map((heading, i) => (
            <button key={i} type="button" role="menuitem" className="dr-menu__toc" onClick={() => scrollToHeading(heading.text)}>
              {heading.text}
            </button>
          ))}
        </PanelMenu>
      )}
      {menu?.kind === 'export' && (
        <PanelMenu anchor={menu.anchor} width={191} onClose={closeMenu}>
          <button type="button" role="menuitem" className="dr-menu__item dr-menu__item--small" onClick={() => void share()}>
            <Glyph name="share_1" family="luminous" size={20} /><span>Share</span>
          </button>
          <button type="button" role="menuitem" className="dr-menu__item dr-menu__item--small" onClick={exportDoc}>
            <Glyph name="docs" family="luminous" size={20} /><span>Export to Docs</span>
          </button>
          <button type="button" role="menuitem" className="dr-menu__item dr-menu__item--small" onClick={() => void copyContents()}>
            <Glyph name="content_copy" family="luminous" size={20} /><span>Copy contents</span>
          </button>
        </PanelMenu>
      )}
      {menu?.kind === 'create' && (
        <PanelMenu anchor={menu.anchor} width={278} onClose={closeMenu}>
          {CREATE_ITEMS.map((item) => (
            <button key={item.kind} type="button" role="menuitem" className="dr-menu__item" onClick={() => { closeMenu(); onCreate(item.kind); }}>
              <Glyph name={item.icon} family={item.family} size={24} /><span>{item.label}</span>
            </button>
          ))}
        </PanelMenu>
      )}
    </motion.aside>
  );
  return compact ? createPortal(panel, document.body) : panel;
};
