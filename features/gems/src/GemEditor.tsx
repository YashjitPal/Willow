import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '@nanostores/react';
import { useThemeMode } from '@willow/core/theme-mode';
import { detectAttachmentKind, getFileExtension, type ComposerAttachment } from '@willow/core/attachments';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { Tooltip } from '@willow/ui/Tooltip';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';
import { GeminiAttachmentCard } from '@willow/ui/GeminiAttachmentCard';
import { GithubImportDialog } from '@willow/ui/github/GithubImportDialog';
import { StreamingMarkdown } from '@willow/ui/StreamingMarkdown';
import { showCopyToast } from '@willow/ui/copy-toast-store';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { streamChat } from '@willow/ai/chat';
import { useCompactViewport } from '@willow/chat/use-compact-viewport';
import { chatSystemPromptFor, resolveChatModel } from '@willow/chat/chat-model';
import { extractSourceText } from '@willow/notebooks/source-extract';
import type { Notebook } from '@willow/notebooks/notebook-types';

import './gems.css';
import { GemAddNotebookDialog } from './GemAddNotebookDialog';
import { knowledgeId, notebookKnowledge } from './gem-knowledge';
import { GemLogo, draftLogoSpec, gemLogoSpec } from './GemLogo';
import { GEM_MENU_TRIGGER, GemMenu, anchorOf, type GemAnchor } from './GemMenu';
import { GemTips } from './GemTips';
import { GemZeroState } from './GemZeroState';
import { buildGemSystemPrompt } from './gem-chat-store';
import { GEM_DEFAULT_TOOLS, emptyGemDraft, type GemDraft, type GemKnowledgeFile } from './gem-types';
import {
  MAX_KNOWLEDGE_CHARS,
  copyGemDraft,
  createGem,
  gemsStore,
  gemsWriteErrorStore,
  resolveGem,
  updateGem,
} from './gems-store';

export interface GemPreviewComposerProps {
  onSubmit: (prompt: string) => void;
  isGenerating: boolean;
  onStop: () => void;
}

export interface GemEditorProps {
  route: { kind: 'create' } | { kind: 'edit'; id: string };
  /** The shell's model settings, so the preview and the rewrite run on the chosen model. */
  modelConfig?: any;
  selectedModelId?: string;
  /** The real composer, supplied by the shell like the notebook page's. */
  renderPreviewComposer?: (props: GemPreviewComposerProps) => React.ReactNode;
  /** The shell's top-bar model picker; it shows itself below 961px only. */
  renderModelPicker?: () => React.ReactNode;
}

const sameDraft = (a: GemDraft, b: GemDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

const knowledgeTile = (file: GemKnowledgeFile): ComposerAttachment => ({
  id: file.id,
  kind: detectAttachmentKind(file.name, file.mimeType),
  name: file.name,
  extension: getFileExtension(file.name),
  mimeType: file.mimeType,
  size: file.size,
});

/** Gemini's power-up mark (a pen and a spark), the first frame of its Lottie. */
const PowerUpGlyph: React.FC = () => (
  <svg viewBox="0 0 600 600" width="32" height="32" aria-hidden="true" focusable="false" className="gem-editor-powerup-glyph">
    <g transform="matrix(1,0,0,1,-27.973,-92.332)">
      <path transform="matrix(1,0,0,1,306.37,395.808)" d="M-66.673,124.925 L-43.802,124.925 L113.089,-31.965 L90.217,-54.837 L-66.673,102.054 Z M-98.774,157.026 L-98.774,88.812 L113.089,-122.649 C116.299,-125.586 119.843,-127.87 123.714,-129.47 C127.598,-131.075 131.676,-131.878 135.961,-131.878 C140.246,-131.878 144.388,-131.074 148.4,-129.47 C152.412,-127.866 155.895,-125.458 158.832,-122.248 L180.901,-99.778 C184.112,-96.841 186.438,-93.358 187.915,-89.345 C189.392,-85.332 190.13,-81.32 190.13,-77.307 C190.13,-73.022 189.383,-68.948 187.915,-65.061 C186.454,-61.193 184.112,-57.646 180.901,-54.435 L-30.56,157.026 Z" />
      <path d="M247.722,408.382 C247.722,383.777 239.167,362.911 222.041,345.786 C204.915,328.661 184.051,320.106 159.446,320.106 C184.051,320.106 204.916,311.552 222.041,294.426 C239.166,277.3 247.722,256.435 247.722,231.83 C247.722,256.435 256.276,277.301 273.402,294.426 C290.528,311.551 311.393,320.106 335.998,320.106 C311.393,320.106 290.527,328.66 273.402,345.786 C256.277,362.912 247.722,383.777 247.722,408.382 Z" />
    </g>
  </svg>
);

interface PreviewMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
}

const REWRITE_SYSTEM = [
  'You improve the instructions for a custom AI assistant (a "Gem").',
  'Rewrite the instructions the user gives you so they are clear, specific and well organised: who the Gem is, its goal, how it should respond, its tone, and what it should avoid.',
  'Keep everything the user asked for and invent nothing they would not want. Write in the second person ("You are…").',
  'Return only the rewritten instructions, with no preamble and no Markdown code fences.',
].join(' ');

/**
 * The Gem editor — Gemini's `bots-creation-window`, measured at 1536x826, 800x1280 and
 * 390x844. A two-column card on the desktop (the form, and a live preview of the Gem),
 * and below 961px one column with Editor / Preview tabs and the Save button full width
 * under the title.
 *
 * Nothing exists until Save. Leaving with changes asks first, as Gemini's
 * "Close without saving?" does.
 */
export const GemEditor: React.FC<GemEditorProps> = ({
  route,
  modelConfig,
  selectedModelId,
  renderPreviewComposer,
  renderModelPicker,
}) => {
  const { isLight } = useThemeMode();
  const isCompact = useCompactViewport();
  const navigate = useNavigate();
  const location = useLocation();
  const gems = useStore(gemsStore);
  const writeError = useStore(gemsWriteErrorStore);
  const { apiKeys } = useUserDataContext();

  const editing = route.kind === 'edit' ? resolveGem(route.id, gems) : null;
  const editingId = editing?.kind === 'custom' ? editing.gem.id : null;
  const copyFrom = (location.state as { copyFrom?: string } | null)?.copyFrom;

  const initialDraft = useMemo<GemDraft>(() => {
    if (editing?.kind === 'custom') {
      const { id: _id, createdAt: _c, updatedAt: _u, ...draft } = editing.gem;
      return draft;
    }
    const source = copyFrom ? resolveGem(copyFrom, gemsStore.get()) : null;
    return source ? copyGemDraft(source.gem) : emptyGemDraft();
    // Only on mount: the store changing under an open editor must not discard edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [draft, setDraft] = useState<GemDraft>(initialDraft);
  const [baseline, setBaseline] = useState<GemDraft>(() => (editingId ? initialDraft : emptyGemDraft()));
  const isDirty = !sameDraft(draft, baseline);
  const canSave = draft.name.trim().length > 0 && isDirty;

  const [nameFocused, setNameFocused] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [instructionsFocused, setInstructionsFocused] = useState(false);
  const [history, setHistory] = useState<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const [isRewriting, setIsRewriting] = useState(false);
  const [toolMenu, setToolMenu] = useState<GemAnchor | null>(null);
  const [uploadMenu, setUploadMenu] = useState<GemAnchor | null>(null);
  const [importingCode, setImportingCode] = useState(false);
  const [pickingNotebooks, setPickingNotebooks] = useState(false);
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // The preview comes alive once the Gem has a name and the name field has been left.
  const [previewName, setPreviewName] = useState(initialDraft.name.trim());
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([]);
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (route.kind === 'create') nameInputRef.current?.focus({ preventScroll: true });
  }, [route.kind]);

  useEffect(() => () => previewAbortRef.current?.abort(), []);

  useEffect(() => {
    const el = previewScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [previewMessages]);

  // A missing Gem (deleted, or a premade one, which cannot be edited) goes back to the list.
  useEffect(() => {
    if (route.kind === 'edit' && !editingId) navigate('/gems', { replace: true });
  }, [route.kind, editingId, navigate]);

  const patch = (next: Partial<GemDraft>) => setDraft((current) => ({ ...current, ...next }));

  /*
   * Typing within a second of the last keystroke extends the same undo step, so Undo
   * steps back over a phrase rather than a character. A rewrite is always its own step.
   */
  const lastTypedAtRef = useRef(0);
  const setInstructions = (value: string, step: 'typing' | 'rewrite' = 'typing') => {
    if (value === draft.instructions) return;
    const now = Date.now();
    if (step === 'rewrite' || now - lastTypedAtRef.current > 1000) {
      setHistory({ past: [...history.past.slice(-99), draft.instructions], future: [] });
    } else if (history.future.length) {
      setHistory({ past: history.past, future: [] });
    }
    lastTypedAtRef.current = step === 'typing' ? now : 0;
    patch({ instructions: value });
  };

  const undo = () => {
    if (!history.past.length) return;
    setHistory({ past: history.past.slice(0, -1), future: [draft.instructions, ...history.future] });
    lastTypedAtRef.current = 0;
    patch({ instructions: history.past[history.past.length - 1] });
  };

  const redo = () => {
    if (!history.future.length) return;
    const [next, ...rest] = history.future;
    setHistory({ past: [...history.past, draft.instructions], future: rest });
    lastTypedAtRef.current = 0;
    patch({ instructions: next });
  };

  const resolveModel = () => resolveChatModel({
    modelConfig,
    selectedModelId: selectedModelId ?? '',
    apiKeys: apiKeys as any,
  });

  /** "Power up": the model rewrites the instructions; Undo brings the old ones back. */
  const rewriteInstructions = async () => {
    if (!draft.instructions.trim() || isRewriting) return;
    const model = resolveModel();
    if (!model.apiKey) {
      showCopyToast('Add an API key in Settings to re-write instructions.');
      return;
    }
    setIsRewriting(true);
    let output = '';
    try {
      await streamChat(
        [{
          role: 'user',
          content: [
            `Gem name: ${draft.name.trim() || '(not named yet)'}`,
            draft.description.trim() ? `Description: ${draft.description.trim()}` : '',
            '',
            'Instructions to rewrite:',
            draft.instructions,
          ].filter((line) => line !== '').join('\n'),
        }],
        {
          provider: model.provider,
          model: model.model,
          apiKey: model.apiKey,
          apiKeyFallbacks: model.apiKeyFallbacks,
          thinkingLevel: 0,
          enableSearch: false,
          enableCodeExecution: false,
          baseUrl: model.baseUrl,
          apiFormat: model.apiFormat,
          toolPolicy: model.toolPolicy,
          profileId: model.profileId,
        },
        (token: string) => { output += token; },
        () => undefined,
        REWRITE_SYSTEM,
      );
      const rewritten = output.replace(/^```[a-z]*\n?|```$/g, '').trim();
      if (rewritten) setInstructions(rewritten, 'rewrite');
    } catch {
      showCopyToast('Couldn’t re-write the instructions. Try again.');
    } finally {
      setIsRewriting(false);
    }
  };

  const addFiles = async (files: FileList | readonly File[] | null) => {
    if (!files?.length) return;
    setIsReadingFiles(true);
    const added: GemKnowledgeFile[] = [];
    for (const file of Array.from(files)) {
      let content: string | undefined;
      let problem: string | undefined;
      try {
        const result = await extractSourceText(file);
        content = result.text || undefined;
        problem = result.problem;
      } catch {
        problem = 'contents could not be read';
      }
      if (content && content.length > MAX_KNOWLEDGE_CHARS) {
        content = content.slice(0, MAX_KNOWLEDGE_CHARS);
        problem = `text truncated at ${MAX_KNOWLEDGE_CHARS.toLocaleString()} characters`;
      }
      added.push({
        id: knowledgeId(),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        ...(content ? { content } : {}),
        ...(problem ? { problem } : {}),
        addedAt: Date.now(),
      });
    }
    setDraft((current) => ({ ...current, knowledge: [...current.knowledge, ...added] }));
    setIsReadingFiles(false);
  };

  const addNotebooks = (notebooks: readonly Notebook[]) => {
    const added = notebooks.map(notebookKnowledge);
    setDraft((current) => ({ ...current, knowledge: [...current.knowledge, ...added] }));
  };

  const removeFile = (id: string) => setDraft((current) => {
    const knowledge = current.knowledge.filter((file) => file.id !== id);
    return { ...current, knowledge, hideCitations: knowledge.length ? current.hideCitations : false };
  });

  const save = () => {
    if (!canSave) return;
    const cleaned: GemDraft = { ...draft, name: draft.name.trim() };
    if (editingId) {
      updateGem(editingId, cleaned);
      setBaseline(cleaned);
      setDraft(cleaned);
      return;
    }
    const gem = createGem(cleaned);
    setBaseline(cleaned);
    setDraft(cleaned);
    navigate(`/gems/edit/${encodeURIComponent(gem.id)}`, { replace: true });
  };

  const leave = () => navigate('/gems');
  const requestLeave = () => (isDirty ? setConfirmLeave(true) : leave());

  const previewSource = { name: draft.name.trim(), instructions: draft.instructions, knowledge: draft.knowledge, hideCitations: draft.hideCitations };

  const sendPreview = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || previewGenerating) return;
    const model = resolveModel();
    const userMsg: PreviewMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const replyId = crypto.randomUUID();
    const prior = previewMessages.filter((m) => !m.isError);
    setPreviewMessages([...previewMessages, userMsg, { id: replyId, role: 'assistant', content: '', isStreaming: true }]);
    if (!model.apiKey) {
      setPreviewMessages((list) => list.map((m) => (m.id === replyId
        ? { ...m, isStreaming: false, isError: true, content: 'Add an API key in Settings to preview your Gem.' }
        : m)));
      return;
    }
    setPreviewGenerating(true);
    const abort = new AbortController();
    previewAbortRef.current = abort;
    let acc = '';
    try {
      const system = [
        chatSystemPromptFor(model.provider),
        await buildGemSystemPrompt(previewSource, { query: text }),
      ].join('\n\n');
      await streamChat(
        [...prior, userMsg].map((m) => ({ role: m.role, content: m.content })),
        {
          provider: model.provider,
          model: model.model,
          apiKey: model.apiKey,
          apiKeyFallbacks: model.apiKeyFallbacks,
          thinkingLevel: model.thinkingLevel,
          enableSearch: false,
          enableCodeExecution: false,
          signal: abort.signal,
          baseUrl: model.baseUrl,
          apiFormat: model.apiFormat,
          toolPolicy: model.toolPolicy,
          profileId: model.profileId,
          reasoningEffort: model.reasoningEffort,
        },
        (token: string) => {
          acc += token;
          setPreviewMessages((list) => list.map((m) => (m.id === replyId ? { ...m, content: acc } : m)));
        },
        () => undefined,
        system,
      );
      setPreviewMessages((list) => list.map((m) => (m.id === replyId ? { ...m, isStreaming: false } : m)));
    } catch (error) {
      const aborted = abort.signal.aborted;
      setPreviewMessages((list) => list.map((m) => (m.id === replyId
        ? { ...m, isStreaming: false, isError: !aborted && !acc, content: acc || (aborted ? '' : 'Something went wrong. Try again.') }
        : m)).filter((m) => m.id !== replyId || m.content));
      if (!aborted) console.warn('[Gems] preview failed', error);
    } finally {
      setPreviewGenerating(false);
      previewAbortRef.current = null;
    }
  };

  // A saved Gem keeps its colour and shows the initial of the name being typed.
  const logoFor = (name: string) => (editing?.kind === 'custom'
    ? gemLogoSpec({ kind: 'custom', gem: { ...editing.gem, name: name || editing.gem.name } }, isLight)
    : draftLogoSpec(name, isLight));
  const headerLogo = logoFor(draft.name);
  const title = draft.name.trim() || (editingId ? '' : 'New Gem');
  const nameError = nameTouched && !nameFocused && !draft.name.trim();
  const tool = GEM_DEFAULT_TOOLS.find((option) => option.id === draft.defaultTool) ?? GEM_DEFAULT_TOOLS[0];
  const saveLabel = editingId ? 'Update' : 'Save';

  const saveButton = (
    <button type="button" className="gem-editor-save" disabled={!canSave} onClick={save}>
      {saveLabel}
    </button>
  );

  const form = (
    <div className="gem-editor-form">
      <label className="gem-editor-label" htmlFor="gem-editor-name">Name</label>
      <div className={`gem-editor-field${nameFocused ? ' is-focused' : ''}${nameError ? ' is-error' : ''}`}>
        <input
          id="gem-editor-name"
          ref={nameInputRef}
          value={draft.name}
          placeholder="Give your Gem a name"
          autoComplete="off"
          onChange={(event) => patch({ name: event.target.value })}
          onFocus={() => setNameFocused(true)}
          onBlur={() => {
            setNameFocused(false);
            setNameTouched(true);
            setPreviewName(draft.name.trim());
          }}
        />
        {nameError && <MaterialSymbol name="error" family="google-symbols" size={24} weight={400} className="gem-editor-field-error-icon" />}
      </div>
      <div className="gem-editor-subscript">
        {nameError && <span className="gem-editor-error">Your Gem requires a name to start testing.</span>}
      </div>

      <label className="gem-editor-label" htmlFor="gem-editor-description">Description</label>
      <div className="gem-editor-field is-textarea">
        <textarea
          id="gem-editor-description"
          rows={1}
          value={draft.description}
          placeholder="Describe your Gem and explain what it does"
          onChange={(event) => patch({ description: event.target.value })}
        />
      </div>
      <div className="gem-editor-subscript" />

      <div className="gem-editor-row-header">
        <label className="gem-editor-label" htmlFor="gem-editor-instructions">Instructions</label>
        <GemTips
          label="Information about the instructions of the Gem"
          title="Instructions for your Gem"
          body="What are your Gem’s main objectives and capabilities and what style of response do you want?"
        />
      </div>
      <div className={`gem-editor-instructions${instructionsFocused ? ' is-focused' : ''}${isRewriting ? ' is-rewriting' : ''}`}>
        <textarea
          id="gem-editor-instructions"
          value={draft.instructions}
          disabled={isRewriting}
          placeholder="Example: You are a horticulturist with a background in natural lawns and native plants, and you help people plan low water gardens. Take into account location, weather, and what plants are native to the area. You are knowledgeable, casual, and friendly."
          onChange={(event) => setInstructions(event.target.value)}
          onFocus={() => setInstructionsFocused(true)}
          onBlur={() => setInstructionsFocused(false)}
        />
        {isRewriting && (
          <div className="gem-editor-rewriting" aria-hidden="true">
            <span /><span /><span />
          </div>
        )}
        <div className="gem-editor-instruction-actions">
          <Tooltip content="Undo">
            <button
              type="button"
              aria-label="Button to undo Gem instruction change"
              className="gem-editor-history is-undo"
              disabled={!history.past.length || isRewriting}
              onClick={undo}
            >
              <MaterialSymbol name="undo" family="google-symbols" size={24} weight={400} />
            </button>
          </Tooltip>
          <Tooltip content="Redo">
            <button
              type="button"
              aria-label="Button to redo Gem instruction change"
              className="gem-editor-history is-redo"
              disabled={!history.future.length || isRewriting}
              onClick={redo}
            >
              <MaterialSymbol name="redo" family="google-symbols" size={24} weight={400} />
            </button>
          </Tooltip>
          <Tooltip content="Re-write instructions">
            <button
              type="button"
              aria-label="Power up"
              className="gem-editor-powerup"
              disabled={!draft.instructions.trim() || isRewriting}
              onClick={() => { void rewriteInstructions(); }}
            >
              <PowerUpGlyph />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="gem-editor-tool-row">
        <div className="gem-editor-label is-inline">Default tool</div>
        <GemTips
          label="Information about default tool"
          title="Default tool"
          body="When you start a new conversation with the Gem, the default tool will be selected. You can still remove it or select another one."
        />
        <div className="gem-editor-spacer" />
        <button
          type="button"
          {...GEM_MENU_TRIGGER}
          className="gem-editor-select"
          aria-haspopup="menu"
          aria-expanded={!!toolMenu}
          onClick={(event) => {
            const anchor = anchorOf(event.currentTarget);
            setToolMenu((open) => (open ? null : anchor));
          }}
        >
          <span>{tool.label}</span>
          <MaterialSymbol
            name="keyboard_arrow_down"
            family="google-symbols"
            size={18}
            weight={370}
            style={{ width: 16, justifyContent: 'flex-start', overflow: 'hidden' }}
          />
        </button>
      </div>

      <div className="gem-editor-knowledge">
        <label className="gem-editor-label">Knowledge</label>
        <GemTips
          label="Information about the knowledges of the Gem"
          body="Files you add here are saved with the Gem and used to answer its chats. Willow keeps the text it can read from them."
          padding={10}
        />
        <div
          className="gem-editor-knowledge-box"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void addFiles(event.dataTransfer.files);
          }}
        >
          {draft.knowledge.length > 0 && (
            <div className="gem-editor-knowledge-files">
              {draft.knowledge.map((file) => (
                <GeminiAttachmentCard key={file.id} attachment={knowledgeTile(file)} onRemove={() => removeFile(file.id)} />
              ))}
            </div>
          )}
          <div className="gem-editor-knowledge-footer">
            <div className="gem-editor-knowledge-placeholder">
              {isReadingFiles ? 'Reading files…' : draft.knowledge.length ? '' : 'Add files for your Gem to reference'}
            </div>
            <button
              type="button"
              {...GEM_MENU_TRIGGER}
              aria-label="Open upload file menu for Gem knowledge section"
              aria-haspopup="menu"
              aria-expanded={!!uploadMenu}
              className="gems-icon-button gem-editor-upload"
              onClick={(event) => {
                const anchor = anchorOf(event.currentTarget);
                setUploadMenu((open) => (open ? null : anchor));
              }}
            >
              <MaterialSymbol name="add_2" family="google-symbols" size={20} weight={400} />
            </button>
          </div>
        </div>
      </div>

      <div className="gem-editor-citations">
        <label className={`gem-editor-checkbox${draft.knowledge.length ? '' : ' is-disabled'}`}>
          <input
            type="checkbox"
            checked={draft.hideCitations}
            disabled={!draft.knowledge.length}
            onChange={(event) => patch({ hideCitations: event.target.checked })}
          />
          <span className="gem-editor-checkbox-box" aria-hidden="true">
            {draft.hideCitations && <MaterialSymbol name="check" family="google-symbols" size={16} weight={500} />}
          </span>
          <span className="gem-editor-checkbox-label">Disable Knowledge Citations</span>
        </label>
        <Tooltip content="Hide knowledge attachments from showing up in Gem's responses" position="above">
          <button type="button" aria-label="More information on disabling knowledge citations" className="gems-icon-button">
            <MaterialSymbol name="info" family="google-symbols" size={20} weight={400} />
          </button>
        </Tooltip>
      </div>
      {writeError && <div className="gem-editor-error is-block">{writeError}</div>}
    </div>
  );

  const previewReady = previewName.length > 0;
  const preview = (
    <div className="gem-editor-preview">
      {!isCompact && <div className="gem-editor-label">Preview</div>}
      <div className="gem-editor-preview-box">
        <div ref={previewScrollRef} className="gem-editor-preview-thread">
          {previewMessages.length === 0 ? (
            <GemZeroState
              logo={previewReady ? logoFor(previewName) : draftLogoSpec('', isLight)}
              name={previewReady ? previewName : ''}
              description={previewReady ? draft.description.trim() : ''}
            />
          ) : (
            <div className="gem-editor-preview-messages">
              {previewMessages.map((message) => (message.role === 'user' ? (
                <div key={message.id} className="gem-editor-preview-user">{message.content}</div>
              ) : (
                <div key={message.id} className={`gem-editor-preview-reply${message.isError ? ' is-error' : ''}`}>
                  <StreamingMarkdown text={message.content} isStreaming={!!message.isStreaming} />
                </div>
              )))}
            </div>
          )}
        </div>
        <div className="gem-editor-preview-composer">
          {renderPreviewComposer?.({
            onSubmit: (prompt) => { void sendPreview(prompt); },
            isGenerating: previewGenerating,
            onStop: () => previewAbortRef.current?.abort(),
          })}
        </div>
        {!previewReady && (
          <div className="gem-editor-preview-placeholder">
            <span>To preview your Gem start by giving it a name</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`gems-surface gem-editor gemini-chat-scrollbar${isCompact ? ' is-compact' : ''}${isCompact && tab === 'preview' ? ' is-preview-tab' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {isCompact && (
        <>
          {renderModelPicker && <div className="gem-editor-model">{renderModelPicker()}</div>}
          <div className="gem-editor-mobile-title">
            <button type="button" aria-label="Back" className="gems-icon-button gem-editor-back" onClick={requestLeave}>
              <MaterialSymbol name="arrow_back_ios_new" family="google-symbols" size={24} weight={400} />
            </button>
            <div className="gem-editor-mobile-name">
              <GemLogo spec={headerLogo} size={50} className="gem-editor-mobile-logo" />
              <h2>{title}</h2>
            </div>
            {isDirty && <div className="gem-editor-save-state">Gem not saved</div>}
          </div>
          <div className="gem-editor-mobile-actions">{saveButton}</div>
          <nav className="gem-editor-tabs" aria-label="Gem editor">
            {(['editor', 'preview'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`gem-editor-tab${tab === id ? ' is-active' : ''}`}
                onClick={() => setTab(id)}
              >
                <span>{id === 'editor' ? 'Editor' : 'Preview'}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      <div className="gem-editor-card">
        {!isCompact && (
          <div className="gem-editor-title">
            <button type="button" aria-label="Back" className="gems-icon-button gem-editor-back" onClick={requestLeave}>
              <MaterialSymbol name="arrow_back_ios_new" family="google-symbols" size={24} weight={400} />
            </button>
            <GemLogo spec={headerLogo} size={50} />
            <h2>{title}</h2>
          </div>
        )}
        {(!isCompact || tab === 'editor') && form}
        {(!isCompact || tab === 'preview') && preview}
        {!isCompact && (
          <div className="gem-editor-actions">
            {isDirty && <div className="gem-editor-save-state">Gem not saved</div>}
            {saveButton}
          </div>
        )}
      </div>

      {(!isCompact || tab === 'editor') && (
        <div className="gem-editor-legal">
          <MaterialSymbol name="error" family="google-symbols" size={15} weight={400} />
          <span>Willow can make mistakes, so double-check responses. Create Gems responsibly.</span>
        </div>
      )}

      {toolMenu && (
        <GemMenu
          anchor={toolMenu}
          label="Default tool"
          placement="above"
          wide
          onClose={() => setToolMenu(null)}
          items={GEM_DEFAULT_TOOLS.map((option) => ({
            label: option.label,
            icon: option.icon,
            family: option.family,
            checked: option.id === draft.defaultTool,
            onSelect: () => patch({ defaultTool: option.id }),
          }))}
        />
      )}

      {uploadMenu && (
        <GemMenu
          anchor={uploadMenu}
          label="Add knowledge"
          placement="above"
          variant="upload"
          onClose={() => setUploadMenu(null)}
          items={[
            { label: 'Upload files', icon: 'attach_file', family: 'luminous', onSelect: () => fileInputRef.current?.click() },
            {
              label: 'Add from Drive',
              icon: 'drive',
              strongIcon: true,
              onSelect: () => showCopyToast('Drive isn’t connected yet — use Upload files for now.'),
            },
            {
              label: 'Google Photos',
              icon: 'photos',
              strongIcon: true,
              onSelect: () => showCopyToast('Google Photos isn’t connected yet — use Upload files for now.'),
            },
            { label: 'Import code', icon: 'code', family: 'luminous', onSelect: () => setImportingCode(true) },
            {
              label: 'Notebooks',
              icon: 'notebook',
              family: 'luminous',
              strongIcon: true,
              onSelect: () => setPickingNotebooks(true),
            },
          ]}
        />
      )}

      <GithubImportDialog
        open={importingCode}
        onClose={() => setImportingCode(false)}
        onImported={(attachment) => {
          if (attachment.file) void addFiles([attachment.file]);
        }}
        onFolderSelected={(files) => { void addFiles(files); }}
      />

      {pickingNotebooks && (
        <GemAddNotebookDialog onAdd={addNotebooks} onClose={() => setPickingNotebooks(false)} />
      )}

      {confirmLeave && (
        <GeminiDialog
          headingAs="h1"
          title="Close without saving?"
          message
          onDismiss={() => setConfirmLeave(false)}
          actions={(
            <>
              <GeminiDialogPill onClick={() => setConfirmLeave(false)}>Cancel</GeminiDialogPill>
              <GeminiDialogPill onClick={leave}>OK</GeminiDialogPill>
            </>
          )}
        >
          <p>Are you sure you want to close without saving your instructions?</p>
        </GeminiDialog>
      )}
    </div>
  );
};
