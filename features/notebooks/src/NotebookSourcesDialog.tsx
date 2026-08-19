import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';

import './notebooks.css';
import { MAX_INLINE_SOURCE_BYTES } from './notebook-types';
import type { Notebook, NotebookSource, NotebookSourceKind } from './notebook-types';
import { addNotebookSource, removeNotebookSource, setNotebookSourceFsName } from './notebooks-store';
import { SourceTile } from './SourceTile';
import { extractSourceText, fetchWebsiteText } from './source-extract';

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
 * **Images are stored but not sent.** A file under `MAX_INLINE_SOURCE_BYTES` keeps a
 * data URL, and grounding only tells the model the image exists. Handing it over as a
 * real image part is still to do — see the note on `NotebookSource.dataUrl`.
 *
 * PDFs, DOCX and website text ARE ingested; `source-extract.ts` owns that, and the
 * row's meta line says which of the two a source got ("Text extracted" against
 * "Reference only").
 */
export interface NotebookSourcesDialogProps {
  notebook: Notebook;
  onClose: () => void;
}

// Text sniffing and the parsers live in `source-extract.ts`; this file only
// still needs the data-URL reader, for images.
const read = (file: File, as: 'text' | 'dataUrl'): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    if (as === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });

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

/**
 * Exit animation plus its delay — see `.nb-sheet-exit`. The parent owns the
 * mount, so this component holds it off for exactly as long as the fade runs.
 * Same 125ms as the three-dot menu, deliberately.
 */
const SHEET_EXIT_MS = 125;

/**
 * A source whose text is still being extracted. Enough of a `NotebookSource` for the tile
 * to draw its name and pick its icon, and nothing else — it is not stored anywhere.
 */
interface PendingSource {
  id: string;
  title: string;
  kind: NotebookSourceKind;
  url?: string;
  mimeType?: string;
}

let pendingCounter = 0;
/** Local to a dialog instance and never persisted, so a counter is identity enough. */
const pendingId = (): string => `pending-${(pendingCounter += 1)}`;

export const NotebookSourcesDialog: React.FC<NotebookSourcesDialogProps> = ({ notebook, onClose }) => {
  const [sub, setSub] = useState<Sub>(null);
  const [urls, setUrls] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textBody, setTextBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  /*
   * Sources being read, as tiles with a spinner where their icon will go — which is
   * Gemini's own answer to "this is taking a moment", and the reason there is no
   * "Reading…" line any more. A source only reaches the store once its text is
   * extracted, so until then it exists nowhere else and this is what stands in for it.
   *
   * Local to the dialog, not in the store. Persisting a half-read source would leave one
   * stuck pending forever if the tab closed mid-extraction, and the store is what the
   * model grounds on: a source that is still being read has nothing to ground with.
   */
  const [pending, setPending] = useState<PendingSource[]>([]);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { saveLocalFSNotebookSource, deleteLocalFSNotebookSource } = useLocalFS();

  /**
   * Add a source: store it, then mirror it into the notebook's `Sources/` folder.
   *
   * The registry write is first and synchronous, so the tile appears without
   * waiting on the disk — and so a source is never lost when there is no folder
   * connected, which is the whole reason the registry is authoritative here.
   *
   * `blob` is the file the user actually chose, and passing it is what keeps
   * `lecture.pdf` a real PDF on disk instead of a `.pdf` holding extracted text.
   * The name the file ends up with comes back from the write (collisions get a
   * `(1)` suffix) and is recorded on the source, because a name derived a second
   * time would not match.
   */
  const addSource = async (
    source: Omit<NotebookSource, 'id' | 'createdAt'>,
    blob?: Blob | null,
  ): Promise<void> => {
    const created = addNotebookSource(notebook.id, source);
    if (!created) return;
    const fsName = await saveLocalFSNotebookSource(notebook.id, {
      title: source.title,
      kind: source.kind,
      blob: blob ?? null,
      content: source.content,
      url: source.url,
    });
    if (fsName) setNotebookSourceFsName(notebook.id, created.id, fsName);
  };

  /** Remove a source, and its file with it. Registry first, for the same reason. */
  const removeSource = (source: NotebookSource): void => {
    removeNotebookSource(notebook.id, source.id);
    if (source.fsName) void deleteLocalFSNotebookSource(notebook.id, source.fsName);
  };

  const settlePending = (id: string) =>
    setPending((current) => current.filter((entry) => entry.id !== id));

  /*
   * Every dismissal goes through here, so the dialog fades out instead of
   * vanishing. It had an entrance and no exit: `onClose` unmounts the tree in the
   * same frame, which leaves nothing for an animation to play on.
   *
   * Guarded on the timer rather than on `isClosing` so a second click during the
   * fade cannot queue a second close.
   */
  const requestClose = React.useCallback(() => {
    if (closeTimerRef.current !== undefined) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, SHEET_EXIT_MS);
  }, [onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
  }, []);

  /*
   * One pass per file: extract what text it has, store the source, and collect
   * anything the user needs telling about.
   *
   * Every file gets its tile up front, all of them at once, and each drops its spinner as
   * it lands. Files are still handled one at a time rather than with `Promise.all`,
   * deliberately: pdf.js parses in a worker but decodes page by page, and several large
   * PDFs at once compete for the same worker and the same memory. The tiles are what shows
   * that the queue is moving, one spinner resolving at a time.
   */
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const notes: string[] = [];
    const queue = Array.from(files).map((file) => ({
      file,
      entry: { id: pendingId(), title: file.name, kind: 'file' as const, mimeType: file.type },
    }));
    setPending((current) => [...current, ...queue.map((item) => item.entry)]);
    try {
      for (const { file, entry } of queue) {
        try {
          // Images are kept as data URLs and sent as image parts on the turn, so
          // they are not a text-extraction case at all.
          if (file.type.startsWith('image/')) {
            const inlineable = file.size <= MAX_INLINE_SOURCE_BYTES;
            await addSource({
              title: file.name,
              kind: 'file',
              mimeType: file.type,
              size: file.size,
              dataUrl: inlineable ? await read(file, 'dataUrl') : undefined,
            }, file);
            if (!inlineable) notes.push(`${file.name} is too large to attach (over ${Math.round(MAX_INLINE_SOURCE_BYTES / 1_000_000)}MB), so only its name was kept`);
            continue;
          }

          const result = await extractSourceText(file);
          await addSource({
            title: file.name,
            kind: 'file',
            mimeType: file.type || (result.via === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
            size: file.size,
            pages: result.pages,
            // Undefined rather than an empty string when nothing was extracted, so
            // the grounding block reports the source as unreadable instead of
            // listing it as present and empty.
            content: result.text || undefined,
            /*
             * The original file goes to disk whatever the extraction did. A PDF
             * that could not be parsed is still the user's PDF, and the folder is
             * theirs to open — "too large to inline" is a limit on what the model
             * is fed, not on what is kept.
             */
          }, file);
          if (result.problem) notes.push(`${file.name}: ${result.problem}`);
        } finally {
          // Per file, so one that throws cannot leave its tile spinning for ever.
          settlePending(entry.id);
        }
      }
      if (notes.length) setError(notes.join('\n'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /*
   * Gemini accepts a space- or newline-separated list in one go, and fetches each
   * page's text at add time rather than at question time — its docs describe the
   * source as a static copy taken on import. `fetchWebsiteText` does the same
   * through `/api/fetch-source`; a page that cannot be read is still stored as a
   * link, which is what every URL used to be.
   *
   * The page title replaces the host/path guess when one comes back, because
   * "en.wikipedia.org/wiki/Photosynthesis" is a worse label than "Photosynthesis".
   */
  const addWebsites = async () => {
    const parts = urls.split(/[\s\n]+/).map((u) => u.trim()).filter(Boolean);
    if (!parts.length) return;

    /*
     * Parse the whole paste BEFORE fetching anything, so the sub-dialog can close on the
     * spot and the pending tiles are visible while the pages are read. Fetching first
     * would hold the sub-dialog open over the very tiles that report the progress.
     */
    const queue: Array<{ url: string; entry: PendingSource }> = [];
    for (const raw of parts) {
      const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        new URL(normalized);
      } catch {
        continue; // skip an unparseable entry rather than aborting the whole paste
      }
      queue.push({
        url: normalized,
        // Labelled with the URL, which is what the finished tile shows too.
        entry: { id: pendingId(), title: normalized, kind: 'website', url: normalized },
      });
    }
    if (!queue.length) {
      setError('None of those looked like URLs.');
      return;
    }

    setError(null);
    setUrls('');
    setSub(null);
    setPending((current) => [...current, ...queue.map((item) => item.entry)]);

    const notes: string[] = [];
    for (const { url, entry } of queue) {
      try {
        const parsed = new URL(url);
        const fetched = await fetchWebsiteText(url);
        await addSource({
          title: fetched.title || parsed.hostname + parsed.pathname.replace(/\/$/, ''),
          kind: 'website',
          url,
          content: fetched.text,
          size: fetched.text?.length,
        });
        if (fetched.problem) notes.push(`${parsed.hostname}: ${fetched.problem}`);
      } finally {
        settlePending(entry.id);
      }
    }
    setError(notes.length ? notes.join('\n') : null);
  };

  const addText = () => {
    if (!textBody.trim()) return;
    void addSource({
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
    /*
     * The exit class goes on the SCRIM, not the sheet: opacity on the scrim
     * composites its whole subtree, so the tint and the dialog leave together.
     * On the sheet alone, the scrim would snap away and the dialog would be seen
     * fading over the bare page.
     */
    <div
      className={`nb-sheet-scrim ${isClosing ? 'nb-sheet-exit' : ''}`}
      role="presentation"
      onClick={requestClose}
    >
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
          <button type="button" aria-label="Close" onClick={requestClose} className="nb-sheet-close">
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
            {notebook.sources.length === 0 && pending.length === 0 ? (
              <div className="nb-src-empty">
                <span className="nb-src-empty-icon">
                  <FilesGlyph />
                </span>
                <p className="nb-src-empty-text">
                  Documents, images, videos, and files you add will appear here.
                </p>
              </div>
            ) : (
              <div className="nb-src-tiles">
                {notebook.sources.map((source) => (
                  <SourceTile
                    key={source.id}
                    source={source}
                    onRemove={() => removeSource(source)}
                  />
                ))}
                {/*
                  * After the stored ones, in the order they will land in — a source is
                  * appended when it lands, so a tile does not jump position as it settles.
                  */}
                {pending.map((entry) => (
                  <SourceTile
                    key={entry.id}
                    source={{ ...entry, createdAt: 0 }}
                    loading
                  />
                ))}
              </div>
            )}

            {/*
              * `white-space: pre-line` on the error: extraction reports one note
              * per file, joined with newlines, and a 40-page scan plus a working
              * PDF in the same drop produces two very different messages.
              */}
            {error && <p className="nb-sheet-error" style={{ whiteSpace: 'pre-line' }}>{error}</p>}
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
          // `void`: fetching is async now, and the dialog reports progress itself
          // rather than making the button await it.
          onConfirm={() => { void addWebsites(); }}
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
