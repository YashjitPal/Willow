/**
 * The row Gemini adds along the bottom of the composer for a creation tool — `input-companion`.
 *
 * Each chip is an outlined pill (36 tall, a 1px outline at 16%) taking an equal share of the
 * row, 8px apart, 12px in from the box: an icon, a 13px label and a chevron, centred. A chip
 * opens a `companion-menu` whose bottom edge sits on the chip's top and whose left edge is the
 * chip's, with a 13px title and 28px radio rows 8px apart. Nothing is picked until the user picks, except the
 * video's shape, which starts on Landscape.
 *
 *   Create image   Aspect ratio
 *   Create video   [add image]  Landscape
 *   Create music   Length  Vocals  Genre
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { GeminiBottomSheet } from '@willow/ui/GeminiBottomSheet';
import type { MediaToolOptions } from '../media/media-tools';
import type { ToolId } from './composer-options';
import './composer-companion.css';

type Family = 'luminous' | 'google-symbols';
interface Glyph { name: string; family: Family }
interface Choice { value: string; label: string; sublabel?: string; icon: Glyph }
type PickerKey = 'aspectRatio' | 'musicLength' | 'vocals' | 'genre';
interface Picker { kind: 'menu'; key: PickerKey; title: string; icon: Glyph; label: string; choices: Choice[] }
/** `text` shows beside the glyph; without it the chip is the glyph alone. */
interface Upload { kind: 'upload'; icon: Glyph; label: string; text?: string }
/** Deep research's "Sources": the places it may read. Willow's run reads the web. */
interface Sources { kind: 'sources'; label: string }
type Chip = Picker | Upload | Sources;

const GOOGLE_MARK = 'https://www.gstatic.com/lamda/images/immersives/google_logo_icon_2380fba942c84387f09cf.svg';

const lumi = (name: string): Glyph => ({ name, family: 'luminous' });
const google = (name: string): Glyph => ({ name, family: 'google-symbols' });

const IMAGE_RATIOS: Choice[] = [
  { value: '1:1', label: '1:1', icon: google('crop_square') },
  { value: '9:16', label: '9:16', icon: lumi('crop_9_16') },
  { value: '3:4', label: '3:4', icon: google('crop_portrait') },
  { value: '4:3', label: '4:3', icon: google('crop_landscape') },
  { value: '16:9', label: '16:9', icon: lumi('crop_16_9') },
];

const VIDEO_RATIOS: Choice[] = [
  { value: '16:9', label: 'Landscape', sublabel: '16:9', icon: lumi('crop_16_9') },
  { value: '9:16', label: 'Portrait', sublabel: '9:16', icon: lumi('crop_9_16') },
];

const CUSTOM: Choice = { value: 'custom', label: 'Custom', sublabel: 'Based on your prompt', icon: google('chat_spark_2') };

export const MUSIC_GENRES = [
  'Pop', 'Hip-hop & rap', 'Rock', 'K-pop', 'Latin', 'Electronic', 'R&B', 'Country', 'Afrobeats',
  'Reggae', 'Jazz & blues', 'Classical', 'Folk', 'Lo-fi', 'Acoustic', 'Cinematic', 'Ambient',
] as const;

const CHIPS: Partial<Record<ToolId, Chip[]>> = {
  images: [
    { kind: 'menu', key: 'aspectRatio', title: 'Aspect ratio', icon: lumi('aspect_ratio'), label: 'Aspect ratio', choices: IMAGE_RATIOS },
  ],
  video: [
    { kind: 'upload', icon: lumi('add_image'), label: 'Add an image' },
    { kind: 'menu', key: 'aspectRatio', title: 'Aspect ratio', icon: lumi('crop_16_9'), label: 'Aspect ratio', choices: VIDEO_RATIOS },
  ],
  music: [
    {
      kind: 'menu', key: 'musicLength', title: 'Length', icon: lumi('schedule'), label: 'Length',
      choices: [
        { value: 'short', label: 'Short', icon: lumi('schedule') },
        { value: 'standard', label: 'Standard', icon: lumi('schedule') },
      ],
    },
    {
      kind: 'menu', key: 'vocals', title: 'Vocals', icon: google('record_voice_over'), label: 'Vocals',
      choices: [
        CUSTOM,
        { value: 'on', label: 'Vocals on', icon: google('record_voice_over') },
        { value: 'instrumental', label: 'Instrumental', icon: google('voice_over_off') },
      ],
    },
    {
      kind: 'menu', key: 'genre', title: 'Genre', icon: lumi('music_note'), label: 'Genre',
      choices: [CUSTOM, ...MUSIC_GENRES.map((genre) => ({ value: genre, label: genre, icon: lumi('music_note') }))],
    },
  ],
  research: [
    { kind: 'sources', label: 'Sources' },
    { kind: 'upload', icon: lumi('upload'), label: 'Add files', text: 'Files' },
  ],
};

export const hasCompanion = (tool: ToolId | null): boolean => !!tool && !!CHIPS[tool]?.length;

export const defaultToolOptions = (tool: ToolId | null): MediaToolOptions =>
  tool === 'video' ? { aspectRatio: '16:9' } : {};

const PLACEHOLDERS: Partial<Record<ToolId, string>> = {
  images: 'Describe your image',
  video: 'Describe your video',
  music: 'Describe your track',
  research: 'What do you want to research?',
};

export const toolPlaceholder = (tool: ToolId | null): string | undefined => (tool ? PLACEHOLDERS[tool] : undefined);

const Icon: React.FC<{ glyph: Glyph; size?: number }> = ({ glyph, size = 20 }) => (
  glyph.family === 'luminous'
    ? <MaterialSymbol family="luminous" name={glyph.name} size={size} weight={300} roundness={100} opticalSize={20} />
    : <MaterialSymbol family="google-symbols" name={glyph.name} size={size} weight={300} />
);

/* At 600px and below Gemini lifts a companion menu into a bottom sheet: the title centred over
   the rows, Done under them. */
const PHONE_QUERY = '(max-width: 600px)';

export const usePhone = (): boolean => {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const sync = () => setPhone(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return phone;
};

const CompanionSheet: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => (
  <GeminiBottomSheet isOpen onClose={onClose} label={title}>
    <div className="wc-sheet">
      <div className="wc-sheet__header">{title}</div>
      <div className="wc-sheet__list" role="menu" aria-label={title}>{children}</div>
      <div className="wc-sheet__done">
        <button type="button" className="wc-sheet__done-button" onClick={onClose}>Done</button>
      </div>
    </div>
  </GeminiBottomSheet>
);

/** A companion menu's placement (bottom on the chip's top, left on its left) and dismissal. */
const useCompanionPopover = (anchor: HTMLElement, onClose: () => void, itemRole: string) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    setPlace({ left: rect.left, bottom: window.innerHeight - rect.top, maxHeight: Math.max(160, rect.top - 16) });
  }, [anchor]);

  useEffect(() => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(`[role="${itemRole}"]`);
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (selected ?? items?.[0])?.focus({ preventScroll: true });
  }, [place, itemRole]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); anchor.focus(); }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return { menuRef, place };
};

/** "Choose one or more sources": Willow's run reads the web, so Search is on and stays on. */
const SourcesMenu: React.FC<{ anchor: HTMLElement; onClose: () => void }> = ({ anchor, onClose }) => {
  const { menuRef, place } = useCompanionPopover(anchor, onClose, 'menuitemcheckbox');
  if (!place) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="wc-companion-menu wc-companion-menu--sources"
      role="menu"
      aria-label="Sources"
      style={{ left: place.left, bottom: place.bottom, maxHeight: place.maxHeight }}
    >
      <div className="wc-companion-menu__title">Choose one or more sources</div>
      <button type="button" role="menuitemcheckbox" aria-checked="true" aria-disabled="true" className="wc-companion-menu__item" title="Deep research always searches the web">
        <span className="wc-companion-menu__row">
          <span className="wc-companion-menu__icon"><img className="wc-companion-menu__mark" src={GOOGLE_MARK} alt="" /></span>
          <span className="wc-companion-menu__labels"><span className="wc-companion-menu__label">Search</span></span>
          <span className="wc-companion-menu__check">
            <MaterialSymbol family="google-symbols" name="check_box" size={20} weight={300} />
          </span>
        </span>
      </button>
    </div>,
    document.body,
  );
};

const CompanionMenu: React.FC<{
  picker: Picker;
  value: string | undefined;
  anchor: HTMLElement;
  onPick: (value: string) => void;
  onClose: () => void;
}> = ({ picker, value, anchor, onPick, onClose }) => {
  const { menuRef, place } = useCompanionPopover(anchor, onClose, 'menuitemradio');

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  if (!place) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="wc-companion-menu"
      role="menu"
      aria-label={picker.title}
      style={{ left: place.left, bottom: place.bottom, maxHeight: place.maxHeight }}
      onKeyDown={moveFocus}
    >
      <div className="wc-companion-menu__title">{picker.title}</div>
      {picker.choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            aria-label={choice.sublabel ? `${choice.label}, ${choice.sublabel}` : choice.label}
            className={`wc-companion-menu__item${selected ? ' is-selected' : ''}`}
            onClick={() => onPick(choice.value)}
          >
            <span className="wc-companion-menu__row">
              <span className="wc-companion-menu__icon"><Icon glyph={choice.icon} /></span>
              <span className="wc-companion-menu__labels">
                <span className="wc-companion-menu__label">{choice.label}</span>
                {choice.sublabel && <span className="wc-companion-menu__sub">{choice.sublabel}</span>}
              </span>
              <span className="wc-companion-menu__check">
                {selected && <MaterialSymbol family="luminous" name="check" size={20} weight={300} roundness={100} opticalSize={20} />}
              </span>
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};

export const ComposerCompanion: React.FC<{
  tool: ToolId | null;
  options: MediaToolOptions;
  onChange: (next: MediaToolOptions) => void;
  onUpload?: () => void;
  disabled?: boolean;
}> = ({ tool, options, onChange, onUpload, disabled = false }) => {
  const [open, setOpen] = useState<{ key: PickerKey | 'sources'; anchor: HTMLElement } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const phone = usePhone();
  useEffect(() => { setOpen(null); }, [tool]);

  const chips = tool ? CHIPS[tool] ?? [] : [];
  if (!chips.length) return null;

  return (
    <div className="wc-companion" role="toolbar" aria-label="Options" data-tool={tool ?? undefined}>
      {chips.map((chip) => {
        if (chip.kind === 'upload') {
          return (
            <button
              key="upload"
              type="button"
              className="wc-companion__chip"
              aria-label={chip.label}
              title={chip.label}
              disabled={disabled}
              onClick={onUpload}
            >
              <Icon glyph={chip.icon} />
              {chip.text && <span className="wc-companion__label">{chip.text}</span>}
            </button>
          );
        }
        if (chip.kind === 'sources') {
          const isOpen = open?.key === 'sources';
          return (
            <React.Fragment key="sources">
              <button
                type="button"
                className={`wc-companion__chip${isOpen ? ' is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                disabled={disabled}
                onClick={(event) => {
                  const anchor = event.currentTarget;
                  setOpen((current) => (current?.key === 'sources' ? null : { key: 'sources', anchor }));
                }}
              >
                <img className="wc-companion__mark" src={GOOGLE_MARK} alt="" />
                <span className="wc-companion__label">{chip.label}</span>
              </button>
              {isOpen && open && (phone ? (
                <CompanionSheet title="Choose one or more sources" onClose={close}>
                  <button type="button" role="menuitemcheckbox" aria-checked="true" aria-disabled="true" className="wc-sheet__item">
                    <span className="wc-companion-menu__icon"><img className="wc-companion-menu__mark" src={GOOGLE_MARK} alt="" /></span>
                    <span className="wc-sheet__label">Search</span>
                    <MaterialSymbol family="google-symbols" name="check_box" size={24} weight={300} />
                  </button>
                </CompanionSheet>
              ) : <SourcesMenu anchor={open.anchor} onClose={close} />)}
            </React.Fragment>
          );
        }
        const value = options[chip.key] as string | undefined;
        const picked = chip.choices.find((choice) => choice.value === value);
        const isOpen = open?.key === chip.key;
        return (
          <React.Fragment key={chip.key}>
            <button
              type="button"
              className={`wc-companion__chip${isOpen ? ' is-open' : ''}`}
              aria-label={picked ? undefined : chip.label}
              data-unpicked={picked ? undefined : ''}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              disabled={disabled}
              onClick={(event) => {
                const anchor = event.currentTarget;
                setOpen((current) => (current?.key === chip.key ? null : { key: chip.key, anchor }));
              }}
            >
              <Icon glyph={picked?.icon ?? chip.icon} />
              <span className="wc-companion__label">{picked?.label ?? chip.label}</span>
              <MaterialSymbol family="luminous" name="keyboard_arrow_down" size={20} weight={300} roundness={100} opticalSize={20} />
            </button>
            {isOpen && open && (phone ? (
              <CompanionSheet title={chip.title} onClose={close}>
                {chip.choices.map((choice) => {
                  const selected = choice.value === value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`wc-sheet__item${selected ? ' is-selected' : ''}`}
                      onClick={() => onChange({ ...options, [chip.key]: choice.value })}
                    >
                      <span className="wc-companion-menu__icon"><Icon glyph={choice.icon} size={24} /></span>
                      <span className="wc-sheet__label">
                        {choice.label}
                        {choice.sublabel && <span className="wc-sheet__sub">{choice.sublabel}</span>}
                      </span>
                      {selected && <MaterialSymbol family="luminous" name="check" size={24} weight={300} roundness={100} opticalSize={24} />}
                    </button>
                  );
                })}
              </CompanionSheet>
            ) : (
              <CompanionMenu
                picker={chip}
                value={value}
                anchor={open.anchor}
                onClose={close}
                onPick={(next) => {
                  onChange({ ...options, [chip.key]: next });
                  setOpen(null);
                }}
              />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
};
