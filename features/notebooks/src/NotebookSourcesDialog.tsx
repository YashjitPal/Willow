import React, { useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import type { Notebook, NotebookSource } from './notebook-types';
import { addNotebookSource, removeNotebookSource } from './notebooks-store';

/**
 * The Add sources sheet.
 *
 * Three ways in, which is what a notebook actually needs to be useful:
 *
 *  - **Upload** — files read as text. Deliberately limited to text-ish types (see
 *    `TEXT_EXTENSIONS`): a PDF or a .docx read through `FileReader.readAsText`
 *    yields binary garbage that then gets folded into every grounded turn, which
 *    is worse than refusing it, because it fails silently as bad model output
 *    rather than as an error the user can see.
 *  - **Paste text** — the escape hatch for anything the uploader rejects. Copying
 *    a PDF's text into here works fine.
 *  - **Link** — stored as a titled reference. NOT fetched: the browser cannot read
 *    most cross-origin pages, so pretending to ingest one would produce an empty
 *    source that looks ingested. The URL is passed to the model as context.
 *
 * Sources are stored on the notebook and folded into chats by
 * `buildGrounding` in `notebook-chat-store.ts`.
 */
export interface NotebookSourcesDialogProps {
  notebook: Notebook;
  onClose: () => void;
}

/** Extensions whose bytes are meaningfully text. */
const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cs',
  '.sh', '.sql', '.css', '.scss', '.log', '.ini', '.toml', '.env', '.rtf',
];

const isTextFile = (file: File): boolean => {
  if (file.type.startsWith('text/')) return true;
  if (/^application\/(json|xml|x-yaml|javascript)/.test(file.type)) return true;
  const lower = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const readAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });

type Tab = 'upload' | 'text' | 'link';

export const NotebookSourcesDialog: React.FC<NotebookSourcesDialogProps> = ({ notebook, onClose }) => {
  const [tab, setTab] = useState<Tab>('upload');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteBody, setPasteBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setIsBusy(true);
    const rejected: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!isTextFile(file)) {
          rejected.push(file.name);
          continue;
        }
        const content = await readAsText(file);
        addNotebookSource(notebook.id, { title: file.name, kind: 'file', content });
      }
      if (rejected.length) {
        setError(
          `Could not read ${rejected.join(', ')} as text. Paste the contents under "Paste text" instead.`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file.');
    } finally {
      setIsBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addPastedText = () => {
    if (!pasteBody.trim()) return;
    addNotebookSource(notebook.id, {
      title: pasteTitle.trim() || 'Pasted text',
      kind: 'text',
      content: pasteBody,
    });
    setPasteTitle('');
    setPasteBody('');
    setError(null);
  };

  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    let normalized = url;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    let host = normalized;
    try {
      host = new URL(normalized).hostname;
    } catch {
      setError('That does not look like a URL.');
      return;
    }
    addNotebookSource(notebook.id, { title: linkTitle.trim() || host, kind: 'link', url: normalized });
    setLinkUrl('');
    setLinkTitle('');
    setError(null);
  };

  const kindIcon = (kind: NotebookSource['kind']) =>
    kind === 'link' ? 'link' : kind === 'text' ? 'notes' : 'description';

  return (
    <div className="nb-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="nb-surface nb-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Add sources"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nb-sheet-head">
          <h2 className="nb-sheet-title">Add sources</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="nb-sheet-close">
            <MaterialSymbol name="close" family="luminous" size={20} weight={320} roundness={100} opticalSize={20} />
          </button>
        </div>

        <p className="nb-sheet-sub">
          Sources let this notebook ground its answers on what you add — documents, notes, or links.
        </p>

        <div className="nb-sheet-tabs" role="tablist">
          {([
            ['upload', 'Upload'],
            ['text', 'Paste text'],
            ['link', 'Link'],
          ] as ReadonlyArray<[Tab, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setError(null);
              }}
              className={`nb-sheet-tab ${tab === id ? 'is-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'upload' && (
          <div
            className="nb-sheet-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void onFiles(event.dataTransfer.files);
            }}
          >
            <MaterialSymbol
              name="upload"
              family="luminous"
              size={28}
              weight={300}
              roundness={100}
              opticalSize={28}
              className="text-white/50"
            />
            <p className="nb-sheet-drop-text">Drop text files here, or</p>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="nb-sheet-primary">
              Choose files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => void onFiles(event.target.files)}
            />
            <p className="nb-sheet-hint">
              Text, Markdown, CSV, JSON and source files. For a PDF, copy its text into “Paste text”.
            </p>
          </div>
        )}

        {tab === 'text' && (
          <div className="nb-sheet-form">
            <input
              value={pasteTitle}
              onChange={(event) => setPasteTitle(event.target.value)}
              placeholder="Title (optional)"
              className="nb-sheet-input"
            />
            <textarea
              value={pasteBody}
              onChange={(event) => setPasteBody(event.target.value)}
              placeholder="Paste or type the source text"
              rows={7}
              className="nb-sheet-textarea"
            />
            <button type="button" onClick={addPastedText} disabled={!pasteBody.trim()} className="nb-sheet-primary">
              Add source
            </button>
          </div>
        )}

        {tab === 'link' && (
          <div className="nb-sheet-form">
            <input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://example.com/article"
              className="nb-sheet-input"
            />
            <input
              value={linkTitle}
              onChange={(event) => setLinkTitle(event.target.value)}
              placeholder="Title (optional)"
              className="nb-sheet-input"
            />
            <button type="button" onClick={addLink} disabled={!linkUrl.trim()} className="nb-sheet-primary">
              Add link
            </button>
            <p className="nb-sheet-hint">
              The page is not downloaded — the link is passed to the model as context. Paste the text
              itself if you need the contents grounded.
            </p>
          </div>
        )}

        {error && <p className="nb-sheet-error">{error}</p>}
        {isBusy && <p className="nb-sheet-hint">Reading…</p>}

        <div className="nb-sheet-list">
          <h3 className="nb-sheet-list-title">
            {notebook.sources.length === 0
              ? 'No sources yet'
              : `${notebook.sources.length} ${notebook.sources.length === 1 ? 'source' : 'sources'}`}
          </h3>
          {notebook.sources.map((source) => (
            <div key={source.id} className="nb-sheet-row">
              <MaterialSymbol
                name={kindIcon(source.kind)}
                family="luminous"
                size={20}
                weight={320}
                roundness={100}
                opticalSize={20}
                className="text-white/60"
              />
              <span className="nb-sheet-row-title">{source.title}</span>
              <button
                type="button"
                aria-label={`Remove ${source.title}`}
                onClick={() => removeNotebookSource(notebook.id, source.id)}
                className="nb-sheet-row-remove"
              >
                <MaterialSymbol name="close" family="luminous" size={18} weight={320} roundness={100} opticalSize={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
