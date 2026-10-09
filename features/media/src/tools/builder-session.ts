/**
 * One tool's Tool Builder conversation, outside React: the messages (saved per tool), the turn in
 * flight, Stop, Restore and feedback. A turn is the forked Code harness (`harness/turn.ts`) over
 * the tool's files; when it changed them, its result becomes the tool's next version, which is
 * what the reply's Restore returns to. Streaming writes `$live` only, so a token re-renders the
 * chat and nothing else.
 *
 * Flow's rules kept: a new tool is named from its first request; a failure is kept with the reply
 * for Flow's error card (`builder-errors.ts`); Restore on a reply puts the tool back to the version
 * that reply made and adds Flow's "Restored from" mark.
 */
import { atom } from 'nanostores';
import { getGeminiClient } from '@willow/ai/chat';
import { collectSavedModelsInCatalogOrder, isChatCapableModel } from '@willow/core/model-catalog';
import type { StoredToolChatMessage } from '@willow/storage/media-tools';
import { isQuotaError, isStorageError } from './builder-errors';
import { compactHistory, describeChanges, type HistoryEntry } from './harness/context';
import { MissingApiKeyError, resolveHarnessModel } from './harness/model';
import { stepsText, type TurnPhase } from './harness/protocol';
import { runTurn, type ModelBinding } from './harness/turn';
import { createToolChecker } from './harness/verify';
import { commitVersion, getTool, loadBuilderChat, loadToolFiles, restoreVersion, saveBuilderChat, updateTool } from './tools-store';

export interface BuilderEnv {
  modelConfig: unknown;
  apiKeys: unknown;
  geminiKey?: string;
}

/** The reply being written: what the chat shows under the last prompt while a turn runs. */
export interface BuilderLive {
  messageId: string;
  phase: TurnPhase | null;
  thoughts: string;
  text: string;
}

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The model the builder runs on: the user's first Gemini chat model that is not a lite one. */
function builderModel(env: BuilderEnv): ModelBinding {
  const chat = collectSavedModelsInCatalogOrder(env.modelConfig).filter(isChatCapableModel);
  const gemini = chat.filter((m) => m.providerId === 'gemini');
  const pick = gemini.find((m) => !/lite/i.test(`${m.modelId ?? m.id} ${m.name ?? ''}`)) ?? gemini[0] ?? chat[0];
  return resolveHarnessModel(env.modelConfig, pick?.id, env.apiKeys);
}

/** A new tool's name and line, from its first request, as Flow names one. */
async function nameTool(prompt: string, key: string | undefined): Promise<{ name: string; description: string } | null> {
  if (!key) return null;
  try {
    const model = getGeminiClient(key).getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } },
    } as never);
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `Name this creative tool and describe what it does in one line, the way an app gallery would.\n\nThe request it was built from:\n${prompt.slice(0, 4000)}\n\nReply with JSON only: {"name": "2 to 4 words, Title Case, no quotes", "description": "one sentence under 80 characters, starting with a verb, no full stop"}`,
        }],
      }],
    });
    const raw = String(result.response.text() ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed = JSON.parse(raw) as { name?: unknown; description?: unknown };
    const name = typeof parsed.name === 'string' ? parsed.name.trim().replace(/^["']|["']$/g, '') : '';
    const description = typeof parsed.description === 'string' ? parsed.description.trim().replace(/\.$/, '') : '';
    return name ? { name: name.slice(0, 60), description: description.slice(0, 140) } : null;
  } catch {
    return null;
  }
}

const fallbackName = (prompt: string): string => {
  const words = prompt.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 4);
  return words.length ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') : 'New tool';
};

export class ToolBuilderSession {
  readonly $messages = atom<StoredToolChatMessage[]>([]);
  readonly $live = atom<BuilderLive | null>(null);
  readonly $loaded = atom(false);
  /** The reply whose Restore is running. */
  readonly $restoring = atom<string | null>(null);
  /** The debug menu's pick: the error code the next send fails with. */
  readonly $mockError = atom<string | null>(null);
  /** A quota error's code: until the page is left, its card stands in for the prompt box. */
  readonly $quotaError = atom<string | null>(null);
  /** The tool hit its storage limit: the page shows Flow's banner asking the agent. */
  readonly $storageFull = atom(false);
  #controller: AbortController | null = null;
  #loading: Promise<void> | null = null;

  constructor(readonly toolId: string) {}

  load(): Promise<void> {
    if (!this.#loading) {
      this.#loading = loadBuilderChat(this.toolId)
        .then((messages) => { if (!this.$live.get()) this.$messages.set(messages); })
        .catch(() => undefined)
        .finally(() => this.$loaded.set(true));
    }
    return this.#loading;
  }

  get running(): boolean {
    return this.$live.get() !== null;
  }

  /** The debug menu's "Mock Error on Next Send"; null sends for real. */
  setMockError(code: string | null): void {
    this.$mockError.set(code);
  }

  /** What a page clears when it opens (Flow resets these per visit). */
  resetPageState(): void {
    this.$quotaError.set(null);
    this.$storageFull.set(false);
  }

  #save(messages: StoredToolChatMessage[]): void {
    this.$messages.set(messages);
    void saveBuilderChat(this.toolId, messages).catch((e) => console.warn('[tools] builder chat not saved', e));
  }

  async send(text: string, env: BuilderEnv, options: { onVersion?: (versionId: string) => void } = {}): Promise<void> {
    const prompt = text.trim();
    if (!prompt || this.running) return;
    await this.load();
    const prior = this.$messages.get();
    const user: StoredToolChatMessage = { id: uid('u-'), role: 'user', text: prompt, createdAt: Date.now() };
    const agentId = uid('a-');
    this.#save([...prior, user]);
    this.$live.set({ messageId: agentId, phase: 'thinking', thoughts: '', text: '' });
    const controller = new AbortController();
    this.#controller = controller;
    let thoughts = '';
    let frame = 0;
    let pending: BuilderLive | null = null;
    const flush = () => { frame = 0; if (pending && this.#controller === controller) this.$live.set(pending); };
    const finish = (message: StoredToolChatMessage) => {
      if (frame) cancelAnimationFrame(frame);
      this.#controller = null;
      this.$live.set(null);
      this.#save([...this.$messages.get(), message]);
    };
    try {
      const mock = this.$mockError.get();
      if (mock) {
        this.$mockError.set(null);
        throw new Error(mock);
      }
      const model = builderModel(env);
      const files = await loadToolFiles(this.toolId);
      const workspaceFiles = Object.fromEntries(files.map((f) => [`/${f.path.replace(/^\/+/, '')}`, f.content]));
      const history: HistoryEntry[] = prior
        .filter((m) => m.role !== 'reverted' && m.status !== 'error')
        .map((m) => (m.role === 'user'
          ? { role: 'user', content: m.text }
          : { role: 'assistant', content: m.changes ? `${m.text}\n\n[Changes made: ${m.changes}]` : m.text }));
      const result = await runTurn({
        prompt,
        history: compactHistory(history),
        files: workspaceFiles,
        mode: 'build',
        model,
        checker: createToolChecker(),
        signal: controller.signal,
        onUpdate: (state) => {
          thoughts = state.thoughts;
          pending = { messageId: agentId, phase: state.phase, thoughts: state.thoughts, text: stepsText(state.steps) };
          if (!frame) frame = requestAnimationFrame(flush);
        },
      });
      let versionId: string | undefined;
      if (result.workspace.changes().length > 0 && result.reason !== 'error') {
        const next = Object.entries(result.workspace.files).map(([path, content]) => ({ path: path.replace(/^\/+/, ''), content }));
        const version = await commitVersion(this.toolId, next, files.length === 0 ? 'create' : 'edit');
        versionId = version.id;
        options.onVersion?.(version.id);
      }
      const tool = getTool(this.toolId);
      if (tool && !tool.name && versionId) {
        const named = await nameTool(prompt, env.geminiKey);
        updateTool(this.toolId, { name: named?.name ?? fallbackName(prompt), ...(named?.description && !tool.description ? { description: named.description } : {}) });
      }
      const changes = describeChanges(result.steps);
      finish({
        id: agentId,
        role: 'agent',
        text: result.text,
        createdAt: Date.now(),
        ...(thoughts ? { thoughts } : {}),
        ...(versionId ? { versionId } : {}),
        ...(changes ? { changes } : {}),
        status: result.reason === 'cancelled' ? 'stopped' : result.reason === 'error' ? 'error' : 'done',
        ...(result.error ? { error: result.error } : {}),
      });
    } catch (error) {
      const message = error instanceof MissingApiKeyError ? error.message : error instanceof Error ? error.message : String(error);
      if (isQuotaError(message)) this.$quotaError.set(message);
      else if (isStorageError(message)) this.$storageFull.set(true);
      finish({ id: agentId, role: 'agent', text: '', createdAt: Date.now(), status: 'error', error: message });
    }
  }

  stop(): void {
    this.#controller?.abort();
  }

  /** The prompt an error card's Try again sends again. */
  retryPrompt(messageId: string): string | null {
    const messages = this.$messages.get();
    const at = messages.findIndex((m) => m.id === messageId);
    for (let i = at - 1; i >= 0; i -= 1) if (messages[i]!.role === 'user') return messages[i]!.text;
    return null;
  }

  /** Drops a failed reply and the prompt that led to it, before Try again sends it again. */
  dropFailed(messageId: string): void {
    const messages = this.$messages.get();
    const at = messages.findIndex((m) => m.id === messageId);
    if (at < 0) return;
    const start = at > 0 && messages[at - 1]!.role === 'user' ? at - 1 : at;
    this.#save([...messages.slice(0, start), ...messages.slice(at + 1)]);
  }

  /**
   * "Restore tool to this version": the version this reply made becomes current again, and the
   * chat gains Flow's "Restored from" mark with the prompt that made it.
   */
  async restore(messageId: string, onVersion?: (versionId: string) => void): Promise<void> {
    const messages = this.$messages.get();
    const at = messages.findIndex((m) => m.id === messageId);
    const message = messages[at];
    if (!message?.versionId || this.$restoring.get() || this.running) return;
    this.$restoring.set(messageId);
    try {
      const version = await restoreVersion(this.toolId, message.versionId);
      if (!version) return;
      let prompt: string | undefined;
      for (let i = at - 1; i >= 0 && prompt === undefined; i -= 1) if (messages[i]!.role === 'user') prompt = messages[i]!.text;
      this.#save([...this.$messages.get(), { id: uid('r-'), role: 'reverted', text: '', createdAt: Date.now(), ...(prompt ? { restoredPrompt: prompt } : {}) }]);
      onVersion?.(version.id);
    } finally {
      this.$restoring.set(null);
    }
  }

  setFeedback(messageId: string, feedback: 'up' | 'down'): void {
    this.#save(this.$messages.get().map((m) => (m.id === messageId ? { ...m, feedback: m.feedback === feedback ? undefined : feedback } : m)));
  }
}

const sessions = new Map<string, ToolBuilderSession>();

export function builderSession(toolId: string): ToolBuilderSession {
  let session = sessions.get(toolId);
  if (!session) {
    session = new ToolBuilderSession(toolId);
    sessions.set(toolId, session);
  }
  return session;
}
