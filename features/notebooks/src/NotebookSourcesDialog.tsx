import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import { MAX_INLINE_SOURCE_BYTES } from './notebook-types';
import type { Notebook, NotebookSource } from './notebook-types';
import { addNotebookSource, removeNotebookSource } from './notebooks-store';

/**
 * The Sources dialog — Gemini's `project-create-sources-dialog`.
 *
 * ── Measured at a REAL desktop viewport (1536x826) ─────────────────────────
 *
 * This was first built from a probe taken at a 1075x350 viewport, where Gemini
 * swaps to `div.content.mobile-layout`: a back chevron top-left and a "+" that
 * opens the source types as a popup menu. That is the narrow layout and it was the
 * wrong component. **Check `innerWidth` before trusting any Gemini geometry** —
 * `Emulation.clearDeviceMetricsOverride` first, because a stale override silently
 * shrinks the viewport.
 *
 * The desktop layout:
 *
 *   dialog            887x548, radius 28, `rgb(30,31,32)`
 *   h2 "Sources"      [24,24], 20px/24px w470, `rgb(227,227,227)`
 *   subtitle          [24,48], 17px/24px w400, ALSO `rgb(227,227,227)` — not muted
 *   close (X)         [823,24] 40x40, `close` Luminous, transparent, round
 *   left rail         4 items at x=24, y=96/160/224/288 → **64px pitch**
 *     each            174x56, radius 16, `rgb(23,23,23)`, label 13px/17px w400
 *   empty state       centred in the space to the RIGHT of the rail
 *
 * The four entries are a **permanent rail**, not a menu — no "+" button exists at
 * this width. The fourth is **"Copied text"**, not "Add text".
 *
 * Gemini's own rail is internally inconsistent (icon sizes 24/30/16/16, paddings
 * `8px 12px` vs `0 16px`, gaps 8/4/12/12) because the first two rows are a
 * different component from the last two. Icon size is reproduced per row; padding
 * and gap are unified on the majority values, which is the one deliberate
 * simplification here.
 *
 * ── What is NOT replicated ─────────────────────────────────────────────────
 *
 * **Add from Drive is inert.** Gemini opens Google's Drive picker against a
 * Drive-scoped token. The row is present because its absence is more wrong than
 * its being disabled, and it says so when clicked rather than silently failing.
 *
 * **Website text is not fetched.** A browser cannot read a cross-origin page, so
 * the URL is stored and passed as context rather than faked as ingested text.
 *
 * **Binaries are not parsed.** `readAsText` on a PDF yields noise that would poison
 * every grounded turn. Images under `MAX_INLINE_SOURCE_BYTES` keep a data URL;
 * everything else is recorded by name and type.
 */
export interface NotebookSourcesDialogProps {
  notebook: Notebook;
  onClose: () => void;
}

const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cs',
  '.sh', '.sql', '.css', '.scss', '.log', '.ini', '.toml', '.env', '.srt', '.vtt',
];

const isTextFile = (file: File): boolean => {
  if (file.type.startsWith('text/')) return true;
  if (/^application\/(json|xml|x-yaml|javascript|typescript)/.test(file.type)) return true;
  const lower = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const read = (file: File, as: 'text' | 'dataUrl'): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    if (as === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });

const iconFor = (source: NotebookSource): { name: string; family: 'luminous' | 'google-symbols' } => {
  if (source.kind === 'website') return { name: 'web', family: 'google-symbols' };
  if (source.kind === 'text') return { name: 'content_paste', family: 'google-symbols' };
  const mime = source.mimeType || '';
  if (mime.startsWith('image/')) return { name: 'image', family: 'luminous' };
  if (mime.startsWith('video/')) return { name: 'movie', family: 'luminous' };
  if (mime.startsWith('audio/')) return { name: 'mic', family: 'luminous' };
  if (mime === 'application/pdf') return { name: 'picture_as_pdf', family: 'google-symbols' };
  return { name: 'description', family: 'luminous' };
};

const formatBytes = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Gemini's empty-state glyph — its `data-mat-icon-name="files"` icon, path copied
 * verbatim from the live DOM.
 *
 * It is not a font ligature, which is why substituting `image` or `note_stack`
 * looked wrong: this is a document-with-a-folded-corner mark, drawn on Google's
 * `0 -960 960 960` viewBox, and it renders in `rgb(78,143,248)`.
 */
const FilesGlyph: React.FC = () => (
  /* 20px, measured — the svg inside Gemini's 48px circle is 20x20, not 24. */
  <svg viewBox="0 -960 960 960" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M160-160q-33 0-56.5-23.5T80-240v-400q0-33 23.5-56.5T160-720h240l80-80h320q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm73-280h207v-207L233-440Zm-73-40 160-160H160v160Zm0 120v120h640v-480H520v280q0 33-23.5 56.5T440-360H160Zm280-160Z" />
  </svg>
);

/** Gemini's Drive mark, as an inline SVG so it keeps its four brand colours. */
const DriveGlyph: React.FC = () => (
  /* 16px, measured — Gemini's Drive svg is 16x16 while the row beside it is 20px. */
  <svg viewBox="0 0 87.3 78" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
    <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
    <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
    <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
    <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
    <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
  </svg>
);

/**
 * Gemini's secondary dialog shell, shared by "Add websites" and "Copied text".
 *
 * 600 wide, radius 28, `rgb(28,28,28)`, 24px inset. The confirm button is disabled
 * until there is input — Gemini's carries `gem-button-disabled` with an
 * `rgba(224,224,224,0.12)` fill while empty.
 */
const SubDialog: React.FC<{
  icon: string;
  iconFamily: 'luminous' | 'google-symbols';
  title: string;
  subtitle: string;
  notes?: readonly string[];
  confirmLabel: string;
  canConfirm: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ icon, iconFamily, title, subtitle, notes, confirmLabel, canConfirm, onConfirm, onClose, children }) => (
  <div className="nb-sub-scrim" role="presentation" onClick={onClose}>
    <div
      className="nb-surface nb-sub"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="nb-sub-header">
        <div className="nb-sub-title-row">
          <MaterialSymbol name={icon} family={iconFamily} size={24} weight={400} roundness={100} opticalSize={24} />
          <h2 className="nb-sub-title">{title}</h2>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="nb-sub-close">
          <MaterialSymbol name="close" family="luminous" size={24} weight={320} roundness={100} opticalSize={24} />
        </button>
      </div>

      <div className="nb-sub-content">
        <p className="nb-sub-subtitle">{subtitle}</p>
        {children}
        {notes && notes.length > 0 && (
          <ul className="nb-sub-notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="nb-sub-actions">
        <button type="button" disabled={!canConfirm} onClick={onConfirm} className="nb-sub-confirm">
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

type Sub = 'websites' | 'text' | null;

export const NotebookSourcesDialog: React.FC<NotebookSourcesDialogProps> = ({ notebook, onClose }) => {
  const [sub, setSub] = useState<Sub>(null);
  const [urls, setUrls] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textBody, setTextBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setIsBusy(true);
    const byNameOnly: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (isTextFile(file)) {
          addNotebookSource(notebook.id, {
            title: file.name,
            kind: 'file',
            mimeType: file.type || 'text/plain',
            size: file.size,
            content: await read(file, 'text'),
          });
          continue;
        }
        const inlineable = file.type.startsWith('image/') && file.size <= MAX_INLINE_SOURCE_BYTES;
        addNotebookSource(notebook.id, {
          title: file.name,
          kind: 'file',
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: inlineable ? await read(file, 'dataUrl') : undefined,
        });
        if (!inlineable) byNameOnly.push(file.name);
      }
      if (byNameOnly.length) {
        setError(
          `Added ${byNameOnly.join(', ')} by name — Willow cannot read that format's text in the browser yet. Paste the text under “Copied text” if you need it grounded.`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file.');
    } finally {
      setIsBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /** Gemini accepts a space- or newline-separated list in one go. */
  const addWebsites = () => {
    const parts = urls.split(/[\s\n]+/).map((u) => u.trim()).filter(Boolean);
    if (!parts.length) return;
    let added = 0;
    for (const raw of parts) {
      const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        const parsed = new URL(normalized);
        addNotebookSource(notebook.id, {
          title: parsed.hostname + parsed.pathname.replace(/\/$/, ''),
          kind: 'website',
          url: normalized,
        });
        added += 1;
      } catch {
        /* skip an unparseable entry rather than aborting the whole paste */
      }
    }
    if (added === 0) setError('None of those looked like URLs.');
    else {
      setUrls('');
      setSub(null);
      setError(null);
    }
  };

  const addText = () => {
    if (!textBody.trim()) return;
    addNotebookSource(notebook.id, {
      title: textTitle.trim() || 'Copied text',
      kind: 'text',
      content: textBody,
      size: textBody.length,
    });
    setTextTitle('');
    setTextBody('');
    setSub(null);
    setError(null);
  };

  /** The permanent left rail. Icon sizes are per-row, as Gemini's are. */
  const rail: ReadonlyArray<{
    label: string;
    glyph: React.ReactNode;
    onSelect: () => void;
    disabledReason?: string;
  }> = [
    {
      label: 'Upload files',
      glyph: <MaterialSymbol name="add_2" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} />,
      onSelect: () => fileInputRef.current?.click(),
    },
    {
      label: 'Add from Drive',
      glyph: <DriveGlyph />,
      onSelect: () => setError('Drive picking is not wired up yet — use Upload files for now.'),
      disabledReason: 'Not connected',
    },
    {
      label: 'Add websites',
      /*
       * `web`, measured off Gemini's `fonticon`. An earlier guess at `web_asset` is
       * not a ligature in the Google Symbols face Willow loads, and an unknown
       * ligature falls back to rendering the NAME as text — which is why the row
       * showed a stray letter instead of an icon.
       */
      glyph: <MaterialSymbol name="web" family="google-symbols" size={20} weight={320} roundness={100} />,
      onSelect: () => setSub('websites'),
    },
    {
      label: 'Copied text',
      glyph: <MaterialSymbol name="content_paste" family="google-symbols" size={20} weight={320} roundness={100} />,
      onSelect: () => setSub('text'),
    },
  ];

  /*
   * Rendered through a portal to <body>.
   *
   * `position: fixed; inset: 0` is not enough on its own: the notebook page sits
   * inside the studio shell, and the sidebar's stacking context painted OVER the
   * scrim, so the tint stopped at the sidebar's edge. Gemini's backdrop covers the
   * full 1536x826 viewport, sidebar included. A portal plus a z-index above the
   * shell is what gets that.
   */
  return createPortal(
    <div className="nb-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="nb-surface nb-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Sources"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nb-sheet-header">
          <div className="nb-sheet-header-text">
            <h2 className="nb-sheet-title">Sources</h2>
            <p className="nb-sheet-sub">Add files that Willow can reference in your notebook</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="nb-sheet-close">
            <MaterialSymbol name="close" family="luminous" size={24} weight={320} roundness={100} opticalSize={24} />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => void onFiles(event.target.files)}
        />

        <div className="nb-sheet-body">
          <div className="nb-src-rail">
            {rail.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onSelect}
                title={item.disabledReason}
                className="nb-src-rail-item"
              >
                <span className="nb-src-rail-icon">{item.glyph}</span>
                <span className="nb-src-rail-label">{item.label}</span>
              </button>
            ))}
          </div>

          <div
            className="nb-src-pane"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void onFiles(event.dataTransfer.files);
            }}
          >
            {notebook.sources.length === 0 ? (
              <div className="nb-src-empty">
                <span className="nb-src-empty-icon">
                  <FilesGlyph />
                </span>
                <p className="nb-src-empty-text">
                  Documents, images, videos, and files you add will appear here.
                </p>
              </div>
            ) : (
              <div className="nb-src-list">
                {notebook.sources.map((source) => {
                  const icon = iconFor(source);
                  return (
                    <div key={source.id} className="nb-src-row">
                      <MaterialSymbol
                        name={icon.name}
                        family={icon.family}
                        size={24}
                        weight={300}
                        roundness={100}
                        opticalSize={24}
                        className="shrink-0 text-white/70"
                      />
                      <span className="nb-src-row-text">
                        <span className="nb-src-row-title">{source.title}</span>
                        <span className="nb-src-row-meta">
                          {source.kind === 'website'
                            ? source.url
                            : [
                                source.content ? 'Text extracted' : source.dataUrl ? 'Image' : 'Reference only',
                                formatBytes(source.size),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${source.title}`}
                        onClick={() => removeNotebookSource(notebook.id, source.id)}
                        className="nb-src-row-remove"
                      >
                        <MaterialSymbol name="close" family="luminous" size={18} weight={320} roundness={100} opticalSize={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {isBusy && <p className="nb-sheet-hint">Reading…</p>}
            {error && <p className="nb-sheet-error">{error}</p>}
          </div>
        </div>
      </div>

      {sub === 'websites' && (
        <SubDialog
          icon="web"
          iconFamily="google-symbols"
          title="Website URLs"
          subtitle="Paste in website URLs below to upload as a source."
          notes={[
            'To add multiple URLs, separate with a space or new line.',
            'Willow stores the link and passes it to the model as context; page text is not downloaded.',
            'Paid articles are not supported.',
            'Paste the text itself under “Copied text” if you need the contents grounded.',
          ]}
          confirmLabel="Insert"
          canConfirm={urls.trim().length > 0}
          onConfirm={addWebsites}
          onClose={() => setSub(null)}
        >
          <textarea
            autoFocus
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder="Paste any links"
            rows={6}
            className="nb-sub-textarea"
          />
        </SubDialog>
      )}

      {sub === 'text' && (
        <SubDialog
          icon="content_paste"
          iconFamily="google-symbols"
          title="Copied text"
          subtitle="Paste or type the text you want this notebook to reference."
          confirmLabel="Insert"
          canConfirm={textBody.trim().length > 0}
          onConfirm={addText}
          onClose={() => setSub(null)}
        >
          <input
            value={textTitle}
            onChange={(event) => setTextTitle(event.target.value)}
            placeholder="Title (optional)"
            className="nb-sub-input"
          />
          <textarea
            autoFocus
            value={textBody}
            onChange={(event) => setTextBody(event.target.value)}
            placeholder="Paste text here"
            rows={7}
            className="nb-sub-textarea"
          />
        </SubDialog>
      )}
    </div>,
    document.body,
  );
};
