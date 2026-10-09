// One Media agent conversation, and the loop that runs its turns.
//
// Deliberately outside React, like Chat's chat-turn-runner: the transcript streams into
// nanostores that only the agent sidebar subscribes to, so a token never re-renders
// MediaView, which draws the whole Media page. MediaView supplies a `MediaAgentHost` — its
// generation functions and current settings — and this file never imports it.
//
// Turn isolation: every turn is an `ActiveTurn`. Stop, New chat and opening another session
// detach it first; a detached turn's late callbacks see `detached` and write nothing, so an
// old reply can never stream into a new conversation.

import { atom, computed, onMount } from 'nanostores';
import {
  streamChat,
  isAbortError,
  generateSessionTitle,
  getGeminiClient,
  type ChatMessage,
  type StreamPhase,
} from '@willow/ai/chat';
import {
  listAgentSessions,
  loadAgentSession,
  saveAgentSession,
  deleteAgentSession,
  type AgentSessionSummary,
  type StoredAgentMessage,
} from '@willow/storage/media-agent-sessions';
import type { StoredAgentSession } from '@willow/storage/media-agent-sessions';
import {
  CONVERSATION_FOLDERS,
  contentKey,
  conversationFileName,
  type ConversationFile,
} from '@willow/storage/local-fs/conversation-files';
import { base64ToBlob } from '@willow/core/attachments';
import type { ImageAttachment, MediaItem } from '../types';
import { fitVideoDuration } from '../media-models';
import { findVoice } from '../characters/voices';
import { fullBodyPrompt } from '../characters/character-store';
import { captureFrame } from '../scenes/scene-frames';
import {
  castNote,
  characterName,
  clipSeconds,
  collectionNames,
  describeToolCall,
  flat,
  galleryItems,
  isReadyImage,
  itemById,
  itemName,
  latestVersionsOf,
  planSceneClips,
  replyForHistory,
  resolveCast,
  slotState,
  toInventory,
  toPromptCharacters,
  toPromptFocus,
  toPromptScenes,
  voiceLabel,
} from './agent-context';
import {
  MEDIA_AGENT_MODEL,
  IMAGE_RATIOS,
  VIDEO_RATIOS,
  VIDEO_DURATIONS,
  MAX_GENERATION_COUNT,
  buildMediaAgentSystemPrompt,
  buildMediaAgentToolDeclarations,
  formatSeconds,
  videoModelTakesReferences,
  type AgentModelOption,
  type MediaAgentPromptContext,
} from './agent-tools';
import {
  agentSettingsText,
  onAgentSettingsChange,
  readAgentSettings,
  writeAgentSettings,
  type AgentInstruction,
  type AgentSettings,
} from './agent-settings';

export type { AgentInstruction, AgentSettings };

export const DEFAULT_SESSION_TITLE = 'Untitled session';
/** Gallery thumbnails the model has not seen yet, attached per turn. */
const VISUAL_CONTEXT_PER_TURN = 6;
/** Character portraits the model has not seen yet, attached per turn on top of those. */
const CHARACTER_CONTEXT_PER_TURN = 4;
const VISUAL_CONTEXT_SIZE = 512;
const ATTACHMENT_THUMB_SIZE = 160;
const MAX_TOOL_ROUNDS = 12;
const ANALYZE_MAX_BYTES = 18 * 1024 * 1024;
const STREAM_FLUSH_MS = 32;

export interface AgentAttachment {
  name?: string;
  mimeType: string;
  /**
   * Base64 bytes, held in memory for the request and never persisted. A gallery video has none:
   * it is sent as a reference by `mediaId`, since the agent works on it through tools by ID.
   */
  data?: string;
  /** Small JPEG data URL for the transcript. */
  thumb?: string;
  mediaId?: string;
  /** A character the user @-mentioned: sent by ID, since the agent features it with character_ids. */
  characterId?: string;
  /**
   * An upload's file beside the chat in the project's folder. Gallery picks and characters
   * have none: their files are already the project's own.
   */
  file?: string;
}

export type AgentMessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

/** A character or scene a reply made or changed, drawn as a card in it. */
export interface AgentLink {
  kind: 'character' | 'scene';
  id: string;
  /** For a character, the image made in that reply. */
  mediaId?: string;
  /** Where in the reply's `content` the card goes: the point the reply made it, as its media is. */
  at?: number;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  attachments?: AgentAttachment[];
  status?: AgentMessageStatus;
  error?: string;
  reaction?: 'like' | 'dislike' | null;
  links?: AgentLink[];
  /**
   * A line per tool call the reply made (`describeToolCall`), saved with it: what a later turn is
   * told of this one when `history` is gone, as a stopped turn's always is.
   */
  actions?: string[];
  /** Gemini contents returned by the turn, so the next one continues from them. Memory only. */
  history?: any[];
}

export interface AgentActivity {
  id: string;
  kind: 'image' | 'video' | 'analyze' | 'list' | 'character' | 'scene';
  label: string;
  detail?: string;
}

export interface AgentApproval {
  id: string;
  kind: 'image' | 'video' | 'character';
  /** The card's question; "Generate 2 images?" when absent. */
  title?: string;
  prompt: string;
  count: number;
  modelName: string;
  ratio: string;
  duration?: string;
  referenceCount: number;
}

export interface AgentTurnState {
  running: boolean;
  phase: StreamPhase | 'idle';
  /** The model is working but nothing is streaming: before the first token, or after a tool. */
  waiting: boolean;
}

export interface AgentHistoryState {
  loading: boolean;
  sessions: AgentSessionSummary[];
}

export interface GenerationOutcome {
  id: string;
  status: 'completed' | 'failed';
  error?: string;
  /** The finished file. The host's items catch up a render later, so a follow-up step reads it here. */
  url?: string;
}

/** Placeholder tiles exist as soon as this returns; `done` settles once per item and never rejects. */
export type GenerationStart = { ids: string[]; done: Promise<GenerationOutcome[]> } | { error: string };

/** A saved character, in the shape the character store keeps (`StoredCharacter`). */
export interface AgentCharacterRecord {
  id: string;
  name: string;
  /** The description its portrait was made from. */
  prompt?: string;
  personality?: string;
  voice?: { name: string };
  portraitId?: string;
  bodyId?: string;
  favorite?: boolean;
  updatedAt?: number;
}

export interface AgentSceneClip {
  id: string;
  mediaId: string;
  trimStart: number;
  trimEnd: number;
  sourceDuration: number;
  thumb?: string;
}

/** A scene, in the shape the scene store keeps (`StoredScene`). */
export interface AgentSceneRecord {
  id: string;
  name: string;
  aspectRatio: string;
  trashedAt?: number;
  updatedAt?: number;
  clips: AgentSceneClip[];
}

/** A scene's new clip list: clips it keeps as they are, and videos to read in whole. */
export type SceneClipPlan = ({ clip: AgentSceneClip } | { video: MediaItem })[];

/** What the user has in front of them when they send. */
export interface AgentFocusState {
  /** The sidebar tab, as its label: "All media", "Videos"... */
  tab: string;
  collectionId?: string;
  /** The gallery item open in the image or video view. */
  viewerId?: string;
  /** The scene open in the Scenebuilder. */
  sceneId?: string;
  /** The character whose page is open. */
  characterId?: string;
  /** The gallery's selection, tile by tile. */
  selection: { kind: 'media' | 'scene' | 'collection'; id: string }[];
}

export type CharacterImageStart = { id: string; done: Promise<GenerationOutcome> } | { error: string };

export interface MediaAgentHost {
  projectId: string;
  scopeId: string;
  geminiKeys: string[];
  userName?: string;
  mediaItems: MediaItem[];
  defaults: MediaAgentPromptContext['defaults'];
  imageModels: AgentModelOption[];
  videoModels: AgentModelOption[];
  collections: { id: string; name: string }[];
  characters: AgentCharacterRecord[];
  /** The project's scenes, trashed ones included. */
  scenes: AgentSceneRecord[];
  focus: AgentFocusState;
  /** `apiPrompt`, when given, is what the model is sent; the tile keeps `prompt`. */
  startImages(spec: { prompt: string; apiPrompt?: string; model: string; ratio: string; count: number; references: MediaItem[] }): GenerationStart;
  startVideos(spec: { prompt: string; apiPrompt?: string; model: string; ratio: string; duration: string; count: number; frames: MediaItem[] }): GenerationStart;
  createCharacter(fields: { name: string; prompt: string; personality?: string; voice?: string }): string;
  updateCharacter(id: string, patch: { name?: string; personality?: string; voice?: string; portraitId?: string; bodyId?: string }): void;
  /** Only for a character whose portrait never started, as the New character page does. */
  deleteCharacter(id: string): void;
  /** An image for one of a character's slots; `parent` makes it a new version of that image. */
  startCharacterImage(spec: {
    characterId: string;
    slot: 'portrait' | 'body';
    prompt: string;
    model: string;
    references: MediaItem[];
    parent?: MediaItem;
  }): CharacterImageStart;
  /** Resolves once every clip has been read; rejects, leaving no scene, if one can't be. */
  createScene(spec: { name?: string; videos: MediaItem[] }): Promise<AgentSceneRecord>;
  updateScene(id: string, spec: { name?: string; plan?: SceneClipPlan }): Promise<AgentSceneRecord | undefined>;
  /**
   * The chat in the project's folder, `Agent sessions/<id>.json`, with what the user
   * uploaded beside it. Without them (or a folder) the chat stays in the browser only.
   */
  saveSessionToDisk?(session: StoredAgentSession, files: ConversationFile[]): Promise<boolean>;
  deleteSessionFromDisk?(sessionId: string): Promise<boolean>;
}

/** A thumbnail sent with a turn; `label` is how the model sees it named. */
interface VisualContext {
  id: string;
  label: string;
  data: string;
}

interface ActiveTurn {
  id: string;
  assistantId: string;
  controller: AbortController;
  answer: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  detached: boolean;
  approvals: Map<string, (decision: 'approve' | 'skip' | 'stopped') => void>;
  /** Thumbnails sent this turn; marked seen only once the model actually got them. */
  visualIds: string[];
  /** The thought summary of the model's current round, emptied when a tool round ends. */
  thinking: string;
  /** What each tool call so far did, the reply's `actions`. */
  actions: string[];
}

const newId = (): string =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const MEDIA_MARKDOWN = /!\[[^\]]*\]\(media-id:[^)]*\)/g;

/** Assistant text without the inline media cards, for copying and for model history. */
export const stripMediaMarkdown = (text: string): string =>
  text.replace(MEDIA_MARKDOWN, '').replace(/\n{3,}/g, '\n\n').trim();

/** Drops cards for media that no longer exists, which would otherwise shimmer forever. */
export const pruneMissingMedia = (text: string, knownIds: Set<string>): string =>
  text.replace(/!\[[^\]]*\]\(media-id:([^)]*)\)/g, (match, id: string) => (knownIds.has(id) ? match : ''));

const normalizeId = (value: unknown): string => String(value ?? '').replace(/^media-id:\s*/i, '').trim();

const idList = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(normalizeId).filter(Boolean))] : [];

/** Like `idList` but keeping repeats, for clip orders where a video can play twice. */
const orderedIdList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(normalizeId).filter(Boolean) : [];

const cleanText = (value: unknown, limit: number): string => String(value ?? '').trim().slice(0, limit);

const clampCount = (value: unknown, fallback: number): number => {
  const parsed = Math.round(Number(value));
  const count = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(1, Math.min(MAX_GENERATION_COUNT, count));
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A promise's outcome as a value, so `abortable` (which reads a rejection as a stop) can tell them apart. */
const settle = <T,>(work: Promise<T>): Promise<{ value: T } | { error: string }> =>
  work.then((value) => ({ value }), (error) => ({ error: String((error as any)?.message || error || 'Unknown error') }));

const modelName = (models: AgentModelOption[], id: string) => models.find((m) => m.id === id)?.name ?? id;


/** The SDK's errors lead with a class tag and the full request URL; the user needs neither. */
const describeError = (error: unknown): string => {
  const raw = String((error as any)?.message || error || '').trim().replace(/^\[GoogleGenerativeAI Error\]:\s*/i, '');
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Couldn't reach Gemini. Check your connection and retry.";
  }
  const http = raw.match(/^Error fetching from \S+?: \[(\d{3})[^\]]*\]\s*([\s\S]*)$/);
  if (http) {
    const [, status, detail] = http;
    const reason = detail.trim().replace(/\.$/, '') || 'The request failed';
    const hint = status === '429'
      ? ' You may have hit a rate limit; wait a moment and retry.'
      : ['400', '401', '403'].includes(status) && /key|permission|auth/i.test(detail)
        ? ' Check your Gemini API key in Settings > Models & API.'
        : '';
    return `Gemini returned ${status}: ${reason}.${hint}`;
  }
  return raw || 'Something went wrong while talking to Gemini.';
};

// ── Attachment bytes and thumbnails ───────────────────────────────────────────

const parseDataUrl = (url: string): { mimeType: string; data: string } | null => {
  const match = url.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
  return match ? { mimeType: match[1], data: match[2] } : null;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = src;
  });

/** A JPEG data URL no larger than `maxSize` on its long edge, or null if it can't be drawn. */
export async function makeJpegThumbnail(src: string, maxSize: number, quality: number): Promise<string | null> {
  try {
    const img = await loadImage(src);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, maxSize / longEdge);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/** Reads composer attachments into the bytes a request needs plus a thumbnail for the transcript. */
export async function toAgentAttachments(attachments: ImageAttachment[]): Promise<AgentAttachment[]> {
  const converted = await Promise.all(attachments.map(async (att): Promise<AgentAttachment | null> => {
    try {
      if (att.characterId) {
        const thumb = att.url ? await makeJpegThumbnail(att.url, ATTACHMENT_THUMB_SIZE, 0.7) : null;
        return { name: att.name, mimeType: 'image/jpeg', ...(thumb ? { thumb } : {}), characterId: att.characterId };
      }
      // A gallery video goes by ID: the agent uses it through tools, and its bytes would add
      // megabytes to every request that carries this message.
      if (att.kind === 'video' && !att.file) {
        const thumb = att.url ? await captureFrame(att.url, 0, ATTACHMENT_THUMB_SIZE).catch(() => undefined) : undefined;
        return { name: att.name, mimeType: 'video/mp4', thumb, mediaId: att.id };
      }
      let dataUrl = att.url.startsWith('data:') ? att.url : '';
      if (!dataUrl) {
        const blob = att.file ?? await fetch(att.url).then((r) => r.blob());
        dataUrl = await blobToDataUrl(blob);
      }
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return null;
      const isImage = parsed.mimeType.startsWith('image/');
      return {
        name: att.name,
        mimeType: parsed.mimeType,
        data: parsed.data,
        thumb: isImage ? (await makeJpegThumbnail(dataUrl, ATTACHMENT_THUMB_SIZE, 0.7)) ?? undefined : undefined,
        mediaId: att.id,
        // Only an upload is new to the project; a gallery pick is already one of its files.
        ...(att.file
          ? { file: `${CONVERSATION_FOLDERS.attachments}/${conversationFileName(att.name, contentKey(parsed.data), parsed.mimeType)}` }
          : {}),
      };
    } catch {
      return null;
    }
  }));
  return converted.filter((att): att is AgentAttachment => att !== null);
}

// ── Persistence mapping ───────────────────────────────────────────────────────

const toStored = (message: AgentMessage): StoredAgentMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt,
  ...(message.status && message.status !== 'streaming' ? { status: message.status } : message.status === 'streaming' ? { status: 'stopped' as const } : {}),
  ...(message.error ? { error: message.error } : {}),
  ...(message.reaction ? { reaction: message.reaction } : {}),
  ...(message.attachments?.length
    ? {
        attachments: message.attachments.map(({ name, mimeType, thumb, mediaId, characterId, file }) => ({
          name,
          mimeType,
          thumb,
          mediaId,
          ...(characterId ? { characterId } : {}),
          ...(file ? { file } : {}),
        })),
      }
    : {}),
  ...(message.links?.length ? { links: message.links.map((link) => ({ ...link })) } : {}),
  ...(message.actions?.length ? { actions: [...message.actions] } : {}),
});

const fromStored = (message: StoredAgentMessage): AgentMessage => ({ ...message });

// ── The agent ─────────────────────────────────────────────────────────────────

export type MediaAgent = ReturnType<typeof createMediaAgent>;

export function createMediaAgent(options: { getHost: () => MediaAgentHost; scopeId: string }) {
  const { getHost } = options;
  const $messages = atom<AgentMessage[]>([]);
  const $turn = atom<AgentTurnState>({ running: false, phase: 'idle', waiting: false });
  /** Changes twice per turn, unlike `$turn`; for hosts that only need to know a turn is running. */
  const $running = computed($turn, (turn) => turn.running);
  const $activities = atom<AgentActivity[]>([]);
  const $approvals = atom<AgentApproval[]>([]);
  /** What the model is thinking in its current round, as Gemini's thought summary streams it. */
  const $thinking = atom('');
  const $session = atom<{ id: string; title: string }>({ id: newId(), title: DEFAULT_SESSION_TITLE });
  const $history = atom<AgentHistoryState>({ loading: false, sessions: [] });
  const settingsScope = () => getHost()?.scopeId ?? options.scopeId;
  const $settings = atom<AgentSettings>(readAgentSettings(options.scopeId));
  // Read again whenever anything reads it: settings.json or another tab may have changed them, or
  // the user signed in since this agent was made. Equal saved settings keep the page's own state
  // (a title being edited).
  const refreshSettings = () => {
    const saved = readAgentSettings(settingsScope());
    if (agentSettingsText(saved) !== agentSettingsText($settings.get())) $settings.set(saved);
  };
  onMount($settings, () => {
    refreshSettings();
    return onAgentSettingsChange(refreshSettings);
  });

  let sessionCreatedAt = Date.now();
  let seenMediaIds = new Set<string>();
  let turn: ActiveTurn | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const idleTurn: AgentTurnState = { running: false, phase: 'idle', waiting: false };

  const updateMessage = (id: string, patch: Partial<AgentMessage>) => {
    const messages = $messages.get();
    const index = messages.findIndex((m) => m.id === id);
    if (index < 0) return;
    const next = messages.slice();
    next[index] = { ...messages[index], ...patch };
    $messages.set(next);
  };

  // ── Saving ──
  const persist = async (snapshot: { id: string; title: string; createdAt: number; messages: AgentMessage[] }) => {
    const host = getHost();
    if (!host.projectId || snapshot.messages.length === 0) return;
    const session: StoredAgentSession = {
      id: snapshot.id,
      title: snapshot.title,
      createdAt: snapshot.createdAt,
      updatedAt: Date.now(),
      messages: snapshot.messages.map(toStored),
    };
    try {
      await saveAgentSession(host.projectId, session, host.scopeId);
      void refreshHistory();
    } catch (error) {
      console.warn('[MediaAgent] Could not save the conversation:', error);
    }
    // The uploads' bytes are only in memory, for as long as this session is open: an
    // upload is written the first time a save finds it, and is then remembered by name.
    const files: ConversationFile[] = snapshot.messages.flatMap((message) => (message.attachments ?? []).flatMap((attachment) => {
      const { data, file, mimeType } = attachment;
      return data && file ? [{ path: file, read: () => base64ToBlob(data, mimeType) }] : [];
    }));
    void host.saveSessionToDisk?.(session, files).catch(() => false);
  };

  const currentSnapshot = () => ({ ...$session.get(), createdAt: sessionCreatedAt, messages: $messages.get() });

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist(currentSnapshot());
    }, 400);
  };

  const flushSave = async () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await persist(currentSnapshot());
  };

  const refreshHistory = async () => {
    const host = getHost();
    if (!host.projectId) {
      $history.set({ loading: false, sessions: [] });
      return;
    }
    $history.set({ loading: true, sessions: $history.get().sessions });
    try {
      $history.set({ loading: false, sessions: await listAgentSessions(host.projectId, host.scopeId) });
    } catch (error) {
      console.warn('[MediaAgent] Could not list saved conversations:', error);
      $history.set({ loading: false, sessions: $history.get().sessions });
    }
  };

  // ── Streaming into the transcript ──
  const flushAnswer = (t: ActiveTurn) => {
    if (t.flushTimer) {
      clearTimeout(t.flushTimer);
      t.flushTimer = null;
    }
    if (!t.detached) updateMessage(t.assistantId, { content: t.answer });
  };

  const scheduleFlush = (t: ActiveTurn) => {
    if (t.flushTimer || t.detached) return;
    t.flushTimer = setTimeout(() => {
      t.flushTimer = null;
      flushAnswer(t);
    }, STREAM_FLUSH_MS);
  };

  const setPhase = (t: ActiveTurn, phase: StreamPhase) => {
    if (t.detached) return;
    // Thinking again after tools is a new round: its summary starts over, not from the last one's.
    if (phase === 'thinking' && $turn.get().phase === 'tooling') setThinking(t, '');
    $turn.set({ running: true, phase, waiting: phase === 'thinking' || phase === 'searching' });
  };

  const setThinking = (t: ActiveTurn, text: string) => {
    if (t.detached) return;
    t.thinking = text;
    $thinking.set(text);
  };

  const addActivity = (t: ActiveTurn, activity: Omit<AgentActivity, 'id'>): string => {
    const id = newId();
    if (!t.detached) $activities.set([...$activities.get(), { id, ...activity }]);
    return id;
  };

  const removeActivity = (t: ActiveTurn, id: string) => {
    if (!t.detached) $activities.set($activities.get().filter((a) => a.id !== id));
  };

  const abortable = <T,>(t: ActiveTurn, work: Promise<T>): Promise<T | null> =>
    new Promise((resolve) => {
      const signal = t.controller.signal;
      if (signal.aborted) return resolve(null);
      const onAbort = () => resolve(null);
      signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        () => { signal.removeEventListener('abort', onAbort); resolve(null); },
      );
    });

  const requestApproval = (t: ActiveTurn, approval: Omit<AgentApproval, 'id'>): Promise<'approve' | 'skip' | 'stopped'> => {
    const id = newId();
    $approvals.set([...$approvals.get(), { id, ...approval }]);
    return new Promise((resolve) => {
      t.approvals.set(id, (decision) => {
        t.approvals.delete(id);
        $approvals.set($approvals.get().filter((a) => a.id !== id));
        resolve(decision);
      });
      if (t.controller.signal.aborted) t.approvals.get(id)?.('stopped');
    });
  };

  const appendMedia = (t: ActiveTurn, ids: string[]) => {
    if (!ids.length) return;
    t.answer = `${t.answer.replace(/\s+$/, '')}\n\n${ids.map((id) => `![Generated media](media-id:${id})`).join('\n\n')}\n\n`;
    flushAnswer(t);
  };

  /**
   * One card per character or scene per reply, where the reply made it: the text so far ends its
   * paragraph there, as before a media card. A later change to it moves the card to that point,
   * with its new image.
   */
  const addLink = (t: ActiveTurn, link: AgentLink) => {
    if (t.detached) return;
    if (t.answer.trim()) t.answer = `${t.answer.replace(/\s+$/, '')}\n\n`;
    flushAnswer(t);
    const links = $messages.get().find((m) => m.id === t.assistantId)?.links ?? [];
    updateMessage(t.assistantId, { links: [...links.filter((l) => !(l.kind === link.kind && l.id === link.id)), { ...link, at: t.answer.length }] });
  };

  const findItem = (host: MediaAgentHost, id: unknown): MediaItem | undefined => {
    const clean = normalizeId(id);
    return clean ? host.mediaItems.find((m) => m.id === clean) : undefined;
  };

  const resolveReferences = (host: MediaAgentHost, ids: string[]) => {
    const found: MediaItem[] = [];
    const unusable: string[] = [];
    for (const id of ids) {
      const item = findItem(host, id);
      if (item && item.status === 'completed' && item.url && item.kind === 'image') found.push(item);
      else unusable.push(id);
    }
    return { found, unusable };
  };

  // ── Tools ──
  const runGeneration = async (
    t: ActiveTurn,
    kind: 'image' | 'video',
    args: any,
  ): Promise<Record<string, unknown>> => {
    const host = getHost();
    const settings = $settings.get();
    const prompt = String(args?.prompt ?? '').trim();
    if (!prompt) return { status: 'failed', error: 'A prompt is required.' };

    const models = kind === 'image' ? host.imageModels : host.videoModels;
    if (models.length === 0) {
      return { status: 'failed', error: `No ${kind} model is added. Ask the user to add one in Settings → Models.` };
    }
    const defaultModel = kind === 'image' ? host.defaults.imageModel : host.defaults.videoModel;
    const requestedModel = typeof args?.model === 'string' ? args.model.trim() : '';
    const model = models.some((m) => m.id === requestedModel) ? requestedModel : defaultModel;
    // An edit (references given) defaults to one result, not the user's batch size: "change the
    // headlights on the third image" wants one new image, as the prompt box's edit flow gives.
    const isEdit = kind === 'image' && idList(args?.reference_ids).length > 0;
    const count = clampCount(args?.count, isEdit ? 1 : kind === 'image' ? host.defaults.imageCount : host.defaults.videoCount);
    const ratio = kind === 'image'
      ? pick(args?.aspect_ratio, IMAGE_RATIOS, pick(host.defaults.imageRatio, IMAGE_RATIOS, '16:9'))
      : pick(args?.aspect_ratio, VIDEO_RATIOS, pick(host.defaults.videoRatio, VIDEO_RATIOS, '16:9'));
    const duration = fitVideoDuration(model, pick(args?.duration, VIDEO_DURATIONS, pick(host.defaults.videoDuration, VIDEO_DURATIONS, '8s')));

    const notes: Record<string, unknown> = {};
    let references: MediaItem[] = [];
    if (kind === 'image') {
      const { found, unusable } = resolveReferences(host, idList(args?.reference_ids));
      references = found;
      if (unusable.length) notes.unusable_reference_ids = unusable;
    } else {
      const firstFrameId = normalizeId(args?.first_frame_id);
      if (firstFrameId) {
        const { found, unusable } = resolveReferences(host, [firstFrameId]);
        references.push(...found);
        if (unusable.length) notes.unusable_first_frame_id = firstFrameId;
      }
      const referenceIds = idList(args?.reference_ids).filter((id) => id !== firstFrameId);
      if (referenceIds.length) {
        if (videoModelTakesReferences(model)) {
          const { found, unusable } = resolveReferences(host, referenceIds);
          references.push(...found);
          if (unusable.length) notes.unusable_reference_ids = unusable;
        } else {
          notes.ignored_reference_ids = referenceIds;
          notes.note = `${modelName(models, model)} does not read reference images; only first_frame_id is used.`;
        }
      }
    }

    // The cast's portraits follow any explicit references, and the note says which is which.
    const cast = resolveCast(host, idList(args?.character_ids));
    if (cast.unknown.length) notes.unknown_character_ids = cast.unknown;
    let apiPrompt: string | undefined;
    if (cast.members.length) {
      const castSeesImages = kind === 'image' || videoModelTakesReferences(model);
      const firstIndex = references.length + 1;
      if (castSeesImages) {
        for (const member of cast.members) {
          for (const image of member.images) if (!references.some((r) => r.id === image.id)) references.push(image);
        }
      } else if (!normalizeId(args?.first_frame_id)) {
        notes.character_note = `${modelName(models, model)} cannot see character references, so only their descriptions were sent. For a consistent look, make the opening frame with generate_image and character_ids, then pass it as first_frame_id.`;
      }
      apiPrompt = `${prompt}\n\n${castNote(cast.members, kind, castSeesImages, firstIndex)}`;
      const unready = cast.members.filter((m) => !m.images.length).map((m) => m.name);
      if (unready.length && castSeesImages) notes.characters_without_images = unready;
    }
    const castNames = cast.members.map((m) => m.name);

    const name = modelName(models, model);
    if (settings.confirmBeforeGenerating) {
      const decision = await requestApproval(t, {
        kind,
        prompt: castNames.length ? `${prompt}\n\nWith ${castNames.join(', ')}.` : prompt,
        count,
        modelName: name,
        ratio,
        ...(kind === 'video' ? { duration } : {}),
        referenceCount: references.length,
      });
      if (decision === 'skip') return { status: 'declined', message: 'The user skipped this generation. Nothing was generated.' };
      if (decision === 'stopped') return { status: 'stopped', message: 'The user stopped the agent before this ran.' };
    }

    const detail = [
      name,
      ratio,
      kind === 'video' ? duration : '',
      castNames.length ? `with ${castNames.join(', ')}` : '',
      references.length && !castNames.length ? plural(references.length, kind === 'video' ? 'frame' : 'reference') : '',
    ].filter(Boolean).join(' · ');
    const activityId = addActivity(t, { kind, label: `Generating ${plural(count, kind)}`, detail });

    const started = kind === 'image'
      ? host.startImages({ prompt, apiPrompt, model, ratio, count, references })
      : host.startVideos({ prompt, apiPrompt, model, ratio, duration, count, frames: references });
    if ('error' in started) {
      removeActivity(t, activityId);
      return { status: 'failed', error: started.error };
    }
    appendMedia(t, started.ids);

    const outcomes = await abortable(t, started.done);
    removeActivity(t, activityId);
    if (!outcomes) {
      return { status: 'stopped', message: 'The user stopped the agent. Generations already started keep running in the gallery.', started: started.ids };
    }
    const failed = outcomes.filter((o) => o.status === 'failed');
    return {
      status: failed.length === 0 ? 'completed' : failed.length === outcomes.length ? 'failed' : 'partial',
      model: name,
      aspect_ratio: ratio,
      ...(kind === 'video' ? { duration } : {}),
      ...(castNames.length ? { characters: castNames } : {}),
      items: outcomes.map((o) => ({ id: o.id, status: o.status, ...(o.error ? { error: o.error } : {}) })),
      ...notes,
      already_rendered: true,
      shown_to_user: 'Every item above is already displayed in the chat. Do not repeat IDs or links.',
    };
  };

  // ── Characters ──
  const findCharacter = (host: MediaAgentHost, id: unknown): AgentCharacterRecord | undefined => {
    const clean = normalizeId(id);
    return clean ? host.characters.find((c) => c.id === clean) : undefined;
  };

  /** `finished` are outcomes from this call; they are newer than the host's items for a render. */
  const characterSummary = (host: MediaAgentHost, id: string, finished: (GenerationOutcome | { id?: string } | null | undefined)[] = []): Record<string, unknown> => {
    const c = host.characters.find((x) => x.id === id);
    if (!c) return { id };
    const slot = (item: MediaItem | undefined) => {
      if (!item) return null;
      const outcome = finished.find((o): o is GenerationOutcome => !!o && 'status' in o && o.id === item.id);
      const status = outcome ? (outcome.status === 'completed' ? 'ready' : 'failed') : slotState(item);
      return { image_id: item.id, status };
    };
    return {
      id: c.id,
      name: characterName(c),
      ...(c.personality ? { personality: c.personality } : {}),
      ...(voiceLabel(c) ? { voice: voiceLabel(c) } : {}),
      portrait: slot(itemById(host, c.portraitId)),
      full_body: slot(itemById(host, c.bodyId)),
    };
  };

  const imageModelFor = (host: MediaAgentHost, requested: unknown): string => {
    const wanted = typeof requested === 'string' ? requested.trim() : '';
    return host.imageModels.some((m) => m.id === wanted) ? wanted : host.defaults.imageModel;
  };

  /** The item behind a finished outcome, with the file the outcome carries. */
  const finishedItem = (outcome: GenerationOutcome | { id?: string; url?: string } | null | undefined): MediaItem | undefined => {
    if (!outcome?.id || !outcome.url) return undefined;
    const item = itemById(getHost(), outcome.id);
    return item ? { ...item, status: 'completed', url: outcome.url } : undefined;
  };

  /** One image for a character slot, waited on. `null` when the user stopped the agent. */
  const makeCharacterImage = async (
    t: ActiveTurn,
    spec: Parameters<MediaAgentHost['startCharacterImage']>[0],
  ): Promise<GenerationOutcome | { status: 'failed'; error: string; id?: undefined } | null> => {
    const host = getHost();
    const started = host.startCharacterImage(spec);
    if ('error' in started) return { status: 'failed', error: started.error };
    host.updateCharacter(spec.characterId, spec.slot === 'portrait' ? { portraitId: started.id } : { bodyId: started.id });
    addLink(t, { kind: 'character', id: spec.characterId, mediaId: started.id });
    return abortable(t, started.done);
  };

  const approveImageWork = async (t: ActiveTurn, title: string, prompt: string, count: number, model: string, references: number) => {
    if (!$settings.get().confirmBeforeGenerating) return 'approve' as const;
    return requestApproval(t, {
      kind: 'character',
      title,
      prompt,
      count,
      modelName: modelName(getHost().imageModels, model),
      ratio: '16:9',
      referenceCount: references,
    });
  };

  const createCharacterTool = async (t: ActiveTurn, args: any): Promise<Record<string, unknown>> => {
    const host = getHost();
    const name = cleanText(args?.name, 60);
    const description = cleanText(args?.description, 2000);
    if (!description) return { status: 'failed', error: 'A description of how the character looks is required.' };
    if (!host.imageModels.length) {
      return { status: 'failed', error: 'No image model is added, so no portrait can be made. Ask the user to add one in Settings → Models.' };
    }
    const model = imageModelFor(host, args?.model);
    const voice = findVoice(args?.voice);
    const { found: references, unusable } = resolveReferences(host, idList(args?.reference_ids));
    const fullBody = args?.full_body === true;
    const notes: Record<string, unknown> = {};
    if (unusable.length) notes.unusable_reference_ids = unusable;
    if (args?.voice && !voice) notes.unknown_voice = String(args.voice);

    const decision = await approveImageWork(t, `Create the character ${name ? `"${name}"` : 'below'}?`, description, fullBody ? 2 : 1, model, references.length);
    if (decision === 'skip') return { status: 'declined', message: 'The user skipped creating this character. Nothing was made.' };
    if (decision === 'stopped') return { status: 'stopped', message: 'The user stopped the agent before this ran.' };

    const characterId = host.createCharacter({
      name,
      prompt: description,
      ...(args?.personality ? { personality: cleanText(args.personality, 2000) } : {}),
      ...(voice ? { voice: voice.name } : {}),
    });
    const label = name || 'a character';
    const activityId = addActivity(t, {
      kind: 'character',
      label: `Creating ${label}`,
      detail: [modelName(host.imageModels, model), fullBody ? 'portrait and full body' : 'portrait'].join(' · '),
    });
    try {
      const portrait = await makeCharacterImage(t, { characterId, slot: 'portrait', prompt: description, model, references });
      if (!portrait) return { status: 'stopped', message: 'The user stopped the agent. The portrait keeps generating on the Characters page.', character: characterSummary(getHost(), characterId) };
      if (portrait.status === 'failed' && !portrait.id) {
        getHost().deleteCharacter(characterId);
        return { status: 'failed', error: portrait.error, ...notes };
      }
      let body: Awaited<ReturnType<typeof makeCharacterImage>> | undefined;
      const portraitItem = finishedItem(portrait);
      if (fullBody && portraitItem) {
        body = await makeCharacterImage(t, {
          characterId,
          slot: 'body',
          prompt: fullBodyPrompt(description),
          model,
          references: [portraitItem],
        });
        if (!body) return { status: 'stopped', message: 'The user stopped the agent. The full-body shot keeps generating.', character: characterSummary(getHost(), characterId) };
      }
      const failures = [portrait, body].filter((o) => o && o.status === 'failed').map((o) => o!.error);
      return {
        status: portrait.status === 'failed' ? 'failed' : failures.length ? 'partial' : 'completed',
        character: characterSummary(getHost(), characterId, [portrait, body]),
        ...(failures.length ? { errors: failures } : {}),
        ...notes,
        shown_to_user: 'A card for the character is already displayed in the chat. Do not repeat its ID.',
      };
    } finally {
      removeActivity(t, activityId);
    }
  };

  const updateCharacterTool = async (t: ActiveTurn, args: any): Promise<Record<string, unknown>> => {
    const host = getHost();
    const character = findCharacter(host, args?.character_id);
    if (!character) return { status: 'failed', error: `No character has the ID "${normalizeId(args?.character_id)}".` };
    const changeLook = cleanText(args?.change_look, 1000);
    const wantsBody = args?.full_body === true;
    const voice = findVoice(args?.voice);
    const notes: Record<string, unknown> = {};
    if (args?.voice && !voice) notes.unknown_voice = String(args.voice);

    const patch: { name?: string; personality?: string; voice?: string } = {};
    if (typeof args?.name === 'string' && args.name.trim()) patch.name = cleanText(args.name, 60);
    if (typeof args?.personality === 'string') patch.personality = cleanText(args.personality, 2000);
    if (voice) patch.voice = voice.name;
    const changed = Object.keys(patch);
    if (!changed.length && !changeLook && !wantsBody) {
      return { status: 'failed', error: 'Nothing to change. Pass name, personality, voice, change_look or full_body.', ...notes };
    }
    if ((changeLook || wantsBody) && !host.imageModels.length) {
      return { status: 'failed', error: 'No image model is added, so its images cannot change. Ask the user to add one in Settings → Models.' };
    }
    if (changed.length) host.updateCharacter(character.id, patch);
    if (!changeLook && !wantsBody) {
      addLink(t, { kind: 'character', id: character.id });
      return { status: 'completed', changed, character: characterSummary(getHost(), character.id), ...notes, shown_to_user: 'A card for the character is already displayed in the chat.' };
    }

    const model = imageModelFor(host, args?.model);
    const label = patch.name || characterName(character);
    const decision = await approveImageWork(
      t,
      `Change ${label}?`,
      [changeLook, wantsBody ? 'Make a new full-body shot.' : ''].filter(Boolean).join(' '),
      (changeLook ? 1 : 0) + (wantsBody ? 1 : 0),
      model,
      1,
    );
    if (decision === 'skip') return { status: 'declined', message: 'The user skipped this change to the character.', changed };
    if (decision === 'stopped') return { status: 'stopped', message: 'The user stopped the agent before this ran.', changed };

    const activityId = addActivity(t, {
      kind: 'character',
      label: `Updating ${label}`,
      detail: [modelName(host.imageModels, model), changeLook ? (args?.image === 'full_body' ? 'full body' : 'portrait') : '', wantsBody ? 'new full body' : ''].filter(Boolean).join(' · '),
    });
    const errors: string[] = [];
    const finished: GenerationOutcome[] = [];
    let newPortrait: MediaItem | undefined;
    try {
      if (changeLook) {
        const slot = args?.image === 'full_body' ? 'body' : 'portrait';
        const current = itemById(host, slot === 'body' ? character.bodyId : character.portraitId);
        const base = isReadyImage(current) ? current : undefined;
        const portrait = itemById(host, character.portraitId);
        // With no finished image to change, the slot is made afresh from its description.
        const references = base ? [base] : slot === 'body' && isReadyImage(portrait) ? [portrait] : [];
        const prompt = base
          ? changeLook
          : slot === 'body'
            ? fullBodyPrompt(`${character.prompt || ''} ${changeLook}`.trim())
            : `${character.prompt || ''} ${changeLook}`.trim();
        const outcome = await makeCharacterImage(t, { characterId: character.id, slot, prompt, model, references, parent: base });
        if (!outcome) return { status: 'stopped', message: 'The user stopped the agent. The new image keeps generating.', changed };
        if (outcome.id) finished.push(outcome as GenerationOutcome);
        if (outcome.status === 'failed') errors.push(outcome.error || 'The new image failed.');
        else if (slot === 'portrait') newPortrait = finishedItem(outcome);
      }
      if (wantsBody) {
        const latest = getHost();
        const now = latest.characters.find((c) => c.id === character.id);
        const portrait = newPortrait ?? itemById(latest, now?.portraitId);
        if (!isReadyImage(portrait)) {
          errors.push('The character has no finished portrait to make a full-body shot from.');
        } else {
          const previous = itemById(latest, now?.bodyId);
          const outcome = await makeCharacterImage(t, {
            characterId: character.id,
            slot: 'body',
            prompt: fullBodyPrompt(character.prompt || portrait.prompt || ''),
            model,
            references: [portrait],
            parent: isReadyImage(previous) ? previous : undefined,
          });
          if (!outcome) return { status: 'stopped', message: 'The user stopped the agent. The full-body shot keeps generating.', changed };
          if (outcome.id) finished.push(outcome as GenerationOutcome);
          if (outcome.status === 'failed') errors.push(outcome.error || 'The full-body shot failed.');
        }
      }
    } finally {
      removeActivity(t, activityId);
    }
    const imageSteps = (changeLook ? 1 : 0) + (wantsBody ? 1 : 0);
    return {
      status: errors.length === 0 ? 'completed' : errors.length === imageSteps && !changed.length ? 'failed' : 'partial',
      changed: [...changed, ...(changeLook ? ['look'] : []), ...(wantsBody ? ['full_body'] : [])],
      character: characterSummary(getHost(), character.id, finished),
      ...(errors.length ? { errors } : {}),
      ...notes,
      shown_to_user: 'A card for the character is already displayed in the chat. Do not repeat its ID.',
    };
  };

  // ── Scenes ──
  /** A gallery video the agent may put in a scene, as the grid shows it, or why it can't be. */
  const sceneVideo = (host: MediaAgentHost, id: string): MediaItem | string => {
    const item = itemById(host, id);
    if (!item) return 'not found';
    const shown = latestVersionsOf(host.mediaItems).get(item.historyGroupId || item.id) ?? item;
    if (shown.kind !== 'video') return `is a ${shown.kind}, not a video`;
    if (shown.status === 'generating') return 'is still generating';
    if (shown.status === 'failed' || !shown.url) return 'failed or has no file';
    return shown;
  };

  const sceneSummary = (host: MediaAgentHost, scene: AgentSceneRecord): Record<string, unknown> => ({
    id: scene.id,
    name: scene.name,
    aspect_ratio: scene.aspectRatio,
    clips: scene.clips.map((c) => {
      const item = itemById(host, c.mediaId);
      return { video_id: c.mediaId, name: item ? itemName(item) : 'missing video', seconds: Math.round(clipSeconds(c) * 10) / 10 };
    }),
    length: formatSeconds(scene.clips.reduce((total, c) => total + clipSeconds(c), 0)),
  });

  const createSceneTool = async (t: ActiveTurn, args: any): Promise<Record<string, unknown>> => {
    const host = getHost();
    const ids = orderedIdList(args?.clip_ids);
    if (!ids.length) return { status: 'failed', error: 'clip_ids needs at least one finished gallery video.' };
    const videos: MediaItem[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const video = sceneVideo(host, id);
      if (typeof video === 'string') skipped.push({ id, reason: video });
      else videos.push(video);
    }
    if (!videos.length) return { status: 'failed', error: 'None of those can go in a scene.', skipped };

    const activityId = addActivity(t, { kind: 'scene', label: 'Building the scene', detail: plural(videos.length, 'clip') });
    try {
      const built = await abortable(t, settle(host.createScene({ name: cleanText(args?.name, 80) || undefined, videos })));
      if (!built) return { status: 'stopped', message: 'The user stopped the agent while the scene was being built.' };
      if ('error' in built) {
        return { status: 'failed', error: `The scene could not be built: ${built.error}`, ...(skipped.length ? { skipped } : {}) };
      }
      addLink(t, { kind: 'scene', id: built.value.id });
      return {
        status: skipped.length ? 'partial' : 'completed',
        scene: sceneSummary(getHost(), built.value),
        ...(skipped.length ? { skipped } : {}),
        shown_to_user: 'A card for the scene is already displayed in the chat; it opens the Scenebuilder. Do not repeat its ID.',
      };
    } finally {
      removeActivity(t, activityId);
    }
  };

  const updateSceneTool = async (t: ActiveTurn, args: any): Promise<Record<string, unknown>> => {
    const host = getHost();
    const sceneId = normalizeId(args?.scene_id);
    const scene = host.scenes.find((s) => s.id === sceneId && !s.trashedAt);
    if (!scene) return { status: 'failed', error: `No scene has the ID "${sceneId}".` };
    const name = cleanText(args?.name, 80);
    const order = Array.isArray(args?.clip_ids) ? orderedIdList(args.clip_ids) : null;
    const additions = orderedIdList(args?.add_clip_ids);
    if (!name && !order && !additions.length) {
      return { status: 'failed', error: 'Nothing to change. Pass name, add_clip_ids or clip_ids.' };
    }

    const planned = order || additions.length
      ? planSceneClips(scene.clips, order, additions, (id) => sceneVideo(host, id))
      : null;
    const plan = planned?.plan;
    const skipped = planned?.skipped ?? [];
    if (plan && !plan.length) return { status: 'failed', error: 'That would leave the scene with no clips.', ...(skipped.length ? { skipped } : {}) };

    const activityId = addActivity(t, { kind: 'scene', label: `Updating "${scene.name}"` });
    try {
      const updated = await abortable(t, settle(host.updateScene(scene.id, { ...(name ? { name } : {}), ...(plan ? { plan } : {}) })));
      if (!updated) return { status: 'stopped', message: 'The user stopped the agent while the scene was being changed.' };
      if ('error' in updated) return { status: 'failed', error: `The scene could not be changed: ${updated.error}` };
      if (!updated.value) return { status: 'failed', error: 'That scene is gone.' };
      addLink(t, { kind: 'scene', id: scene.id });
      return {
        status: skipped.length ? 'partial' : 'completed',
        scene: sceneSummary(getHost(), updated.value),
        ...(skipped.length ? { skipped } : {}),
        shown_to_user: 'A card for the scene is already displayed in the chat. Do not repeat its ID.',
      };
    } finally {
      removeActivity(t, activityId);
    }
  };

  const listMedia = (args: any): Record<string, unknown> => {
    const host = getHost();
    const kind = pick(args?.kind, ['all', 'image', 'video', 'audio', 'character', 'scene'] as const, 'all');
    const query = String(args?.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, Math.round(Number(args?.limit)) || 50));
    const matches = (...fields: string[]) => !query || fields.some((f) => f.toLowerCase().includes(query));
    const entries: Record<string, unknown>[] = [];
    if (kind === 'all' || kind === 'character') {
      for (const c of toPromptCharacters(host)) {
        if (!matches(c.name, c.look)) continue;
        entries.push({ id: c.id, kind: 'character', name: c.name, portrait: c.portrait, full_body: c.fullBody, ...(c.voice ? { voice: c.voice } : {}) });
      }
    }
    if (kind === 'all' || kind === 'scene') {
      for (const s of toPromptScenes(host)) {
        if (!matches(s.name)) continue;
        entries.push({ id: s.id, kind: 'scene', name: s.name, aspect_ratio: s.ratio, clips: s.clips.length, length: formatSeconds(s.seconds) });
      }
    }
    if (kind !== 'character' && kind !== 'scene') {
      for (const e of toInventory(host.mediaItems, collectionNames(host))) {
        if ((kind === 'all' || e.kind === kind) && matches(e.name)) entries.push({ ...e });
      }
    }
    return { total: entries.length, items: entries.slice(0, limit) };
  };

  const analyzeMedia = async (t: ActiveTurn, args: any): Promise<Record<string, unknown>> => {
    const host = getHost();
    const item = findItem(host, args?.media_id);
    const question = String(args?.question ?? '').trim() || 'Describe this in detail.';
    if (!item) return { status: 'failed', error: `No gallery item has the ID "${normalizeId(args?.media_id)}".` };
    if (item.kind === 'audio') return { status: 'failed', error: 'Audio cannot be analyzed.' };
    if (item.status !== 'completed' || !item.url) return { status: 'failed', error: 'That item has no finished media to look at yet.' };
    const apiKey = host.geminiKeys[0];
    if (!apiKey) return { status: 'failed', error: 'No Gemini API key is configured.' };

    const activityId = addActivity(t, { kind: 'analyze', label: `Looking at "${itemName(item)}"` });
    try {
      const blob = await fetch(item.url, { signal: t.controller.signal }).then((r) => r.blob());
      if (blob.size > ANALYZE_MAX_BYTES) return { status: 'failed', error: 'That file is too large to analyze.' };
      const parsed = parseDataUrl(await blobToDataUrl(blob));
      if (!parsed) return { status: 'failed', error: 'Could not read that file.' };
      const mimeType = blob.type || parsed.mimeType || (item.kind === 'video' ? 'video/mp4' : 'image/png');
      const vision = getGeminiClient(apiKey).getGenerativeModel({ model: MEDIA_AGENT_MODEL });
      const response = await vision.generateContent(
        { contents: [{ role: 'user', parts: [{ text: question }, { inlineData: { mimeType, data: parsed.data } }] }] },
        { signal: t.controller.signal },
      );
      // Not `media_id`: chat.ts draws a media card for any result carrying one.
      return { status: 'completed', id: item.id, answer: response.response.text() };
    } catch (error) {
      if (isAbortError(error) || t.controller.signal.aborted) return { status: 'stopped' };
      return { status: 'failed', error: describeError(error) };
    } finally {
      removeActivity(t, activityId);
    }
  };

  /**
   * Runs a tool call and keeps a line on what it did with the reply (`actions`). Written even once
   * the turn is stopped: a call the stop caught still says what it started.
   */
  const callTool = async (t: ActiveTurn, name: string, args: any): Promise<Record<string, unknown>> => {
    if (t.detached) return { status: 'stopped' };
    const result = await executeTool(t, name, args);
    t.actions.push(describeToolCall(name, args, result));
    if ($messages.get().some((m) => m.id === t.assistantId)) {
      updateMessage(t.assistantId, { actions: [...t.actions] });
      if (t.detached) scheduleSave();
    }
    return result;
  };

  const executeTool = async (t: ActiveTurn, name: string, args: any): Promise<Record<string, unknown>> => {
    switch (name) {
      case 'generate_image':
        return runGeneration(t, 'image', args);
      case 'generate_video':
        return runGeneration(t, 'video', args);
      case 'create_character':
        return createCharacterTool(t, args);
      case 'update_character':
        return updateCharacterTool(t, args);
      case 'create_scene':
        return createSceneTool(t, args);
      case 'update_scene':
        return updateSceneTool(t, args);
      case 'list_media':
        return listMedia(args);
      case 'analyze_media':
        return analyzeMedia(t, args);
      default:
        return { status: 'error', error: `The tool "${name}" does not exist. Do not claim it ran.` };
    }
  };

  // ── Turns ──
  const buildRequestMessages = (history: AgentMessage[], user: AgentMessage, visual: VisualContext[]): ChatMessage[] => {
    const host = getHost();
    const galleryIds = new Set(host.mediaItems.map((m) => m.id));
    const toApiAttachments = (attachments: AgentAttachment[] | undefined) =>
      (attachments ?? [])
        .filter((a) => a.data)
        .map((a) => (a.mediaId && galleryIds.has(a.mediaId)
          ? { type: 'image', mimeType: a.mimeType, data: a.data!, name: `media-id: ${a.mediaId}`, id: a.mediaId }
          : { type: 'file', mimeType: a.mimeType, data: a.data!, name: a.name || 'attachment' }));
    // What is attached by ID only (gallery videos, @-mentioned characters) is named in the text.
    const characterIds = new Set(host.characters.map((c) => c.id));
    const withReferences = (content: string, attachments: AgentAttachment[] | undefined) => {
      const named = (attachments ?? []).flatMap((a) => {
        const label = a.name ? ` "${flat(a.name, 60)}"` : '';
        if (a.characterId && characterIds.has(a.characterId)) return [`character ${a.characterId}${label}`];
        if (!a.data && a.mediaId && galleryIds.has(a.mediaId)) return [`${a.mimeType.startsWith('video/') ? 'video' : 'item'} ${a.mediaId}${label}`];
        return [];
      });
      return named.length ? `${content}\n\n[The user attached: ${named.join(', ')}]`.trim() : content;
    };

    // Every reply is kept, empty or not, so a rebuilt history still alternates user and model. One
    // without its own history (stopped, failed, or from before a reload) says what its tools did
    // and whether it finished, which is what a "continue" needs.
    const prior: ChatMessage[] = history.map((m) => (m.role === 'user'
      ? { role: 'user', content: withReferences(m.content, m.attachments) || '(See the attached media.)', attachments: toApiAttachments(m.attachments) as any }
      : m.history
        ? { role: 'assistant', content: stripMediaMarkdown(m.content) || '(No reply.)', history: m.history }
        : { role: 'assistant', content: replyForHistory(m, stripMediaMarkdown(m.content)) }));

    const attachments = [
      ...toApiAttachments(user.attachments),
      ...visual.map((v) => ({ type: 'image', mimeType: 'image/jpeg', data: v.data, name: `media-id: ${v.id}`, id: v.label })),
    ];
    return [
      ...prior,
      {
        role: 'user',
        content: withReferences(user.content, user.attachments) || '(See the attached media.)',
        ...(attachments.length ? { attachments: attachments as any } : {}),
      },
    ];
  };

  /**
   * Gallery images and character portraits the model has not seen, as small labelled thumbnails.
   * Characters the user mentioned come first.
   */
  const collectVisualContext = async (
    host: MediaAgentHost,
    alreadyAttached: Set<string>,
    mentioned: Set<string>,
  ): Promise<VisualContext[]> => {
    const unseen = (m: MediaItem | undefined): m is MediaItem =>
      isReadyImage(m) && !seenMediaIds.has(m.id) && !alreadyAttached.has(m.id);
    const gallery = galleryItems(host.mediaItems)
      .filter(unseen)
      .slice(0, VISUAL_CONTEXT_PER_TURN)
      .map((m) => ({ item: m, label: m.id }));
    const portraits = [...host.characters]
      .sort((a, b) => Number(mentioned.has(b.id)) - Number(mentioned.has(a.id)))
      .map((c) => ({ c, item: itemById(host, c.portraitId) }))
      .filter((p): p is { c: AgentCharacterRecord; item: MediaItem } => unseen(p.item))
      .slice(0, CHARACTER_CONTEXT_PER_TURN)
      .map(({ c, item }) => ({ item, label: `${item.id}, the portrait of character ${c.id} "${characterName(c)}"` }));
    const thumbs = await Promise.all([...portraits, ...gallery].map(async ({ item, label }) => {
      const thumb = await makeJpegThumbnail(item.url!, VISUAL_CONTEXT_SIZE, 0.6);
      const parsed = thumb ? parseDataUrl(thumb) : null;
      return parsed ? { id: item.id, label, data: parsed.data } : null;
    }));
    return thumbs.filter((v): v is VisualContext => v !== null);
  };

  const finishTurn = (t: ActiveTurn, patch: Partial<AgentMessage>) => {
    if (t.detached) return;
    flushAnswer(t);
    updateMessage(t.assistantId, patch);
    for (const resolve of [...t.approvals.values()]) resolve('stopped');
    t.detached = true;
    turn = null;
    $activities.set([]);
    $approvals.set([]);
    $thinking.set('');
    $turn.set(idleTurn);
    scheduleSave();
  };

  const runTurn = async (user: AgentMessage, { appendUser }: { appendUser: boolean }) => {
    const host = getHost();
    const t: ActiveTurn = {
      id: newId(),
      assistantId: newId(),
      controller: new AbortController(),
      answer: '',
      flushTimer: null,
      detached: false,
      approvals: new Map(),
      visualIds: [],
      thinking: '',
      actions: [],
    };
    turn = t;
    $thinking.set('');

    const before = $messages.get();
    const history = appendUser ? before : before.slice(0, -1);
    const isFirstPrompt = !history.some((m) => m.role === 'user');
    $messages.set([
      ...(appendUser ? [...before, user] : before),
      { id: t.assistantId, role: 'assistant', content: '', createdAt: Date.now(), status: 'streaming' },
    ]);
    $turn.set({ running: true, phase: 'thinking', waiting: true });
    // Saved now as well as at the end, so the question is on disk if the tab
    // closes mid-reply: the placeholder stores as "stopped", which is the shape
    // `retry` runs again — in this tab, or the one that carries the turn on.
    scheduleSave();

    const apiKey = host.geminiKeys[0];
    if (!apiKey) {
      finishTurn(t, { status: 'error', error: 'Add a Gemini API key in Settings > Models & API to use the agent.' });
      return;
    }

    if (isFirstPrompt && $session.get().title === DEFAULT_SESSION_TITLE && user.content.trim()) {
      const sessionId = $session.get().id;
      void generateSessionTitle(user.content, apiKey)
        .then((title: string) => {
          const clean = String(title || '').trim();
          const meta = $session.get();
          if (!clean || clean === DEFAULT_SESSION_TITLE || meta.id !== sessionId || meta.title !== DEFAULT_SESSION_TITLE) return;
          $session.set({ ...meta, title: clean });
          if ($messages.get().length && !turn) scheduleSave();
        })
        .catch(() => {});
    }

    try {
      const attachedIds = new Set((user.attachments ?? []).map((a) => a.mediaId).filter((id): id is string => !!id));
      const mentioned = new Set((user.attachments ?? []).map((a) => a.characterId).filter((id): id is string => !!id));
      const visual = await collectVisualContext(host, attachedIds, mentioned);
      if (t.detached) return;
      t.visualIds = [...visual.map((v) => v.id), ...attachedIds];

      const settings = $settings.get();
      const collections = collectionNames(host);
      const systemPrompt = buildMediaAgentSystemPrompt({
        userName: host.userName,
        imageModels: host.imageModels,
        videoModels: host.videoModels,
        defaults: host.defaults,
        confirmBeforeGenerating: settings.confirmBeforeGenerating,
        instructions: settings.instructions.filter((i) => i.isActive),
        inventory: toInventory(host.mediaItems, collections),
        characters: toPromptCharacters(host),
        scenes: toPromptScenes(host),
        focus: toPromptFocus(host, collections),
      });

      const returnedHistory = await streamChat(
        buildRequestMessages(history, user, visual),
        {
          provider: 'gemini',
          model: MEDIA_AGENT_MODEL,
          apiKey,
          apiKeyFallbacks: host.geminiKeys.slice(1),
          thinkingLevel: 1,
          // The sidebar's thinking row shows the newest heading of this summary, as Chat's does.
          includeThoughts: true,
          enableSearch: true,
          enableCodeExecution: false,
          // Keeps the turn on the GenerateContent path, whose returned history the next turn
          // continues from. The tools themselves are declared just below.
          enableMediaTools: true,
          toolDeclarations: buildMediaAgentToolDeclarations(host.imageModels, host.videoModels),
          maxToolIterations: MAX_TOOL_ROUNDS,
          signal: t.controller.signal,
        },
        (token: string) => {
          if (t.detached) return;
          if ($turn.get().waiting) setPhase(t, 'responding');
          t.answer += token;
          scheduleFlush(t);
        },
        () => {},
        systemPrompt,
        (phase: StreamPhase) => setPhase(t, phase),
        (name: string, args: any) => callTool(t, name, args),
        (thought: string) => setThinking(t, t.thinking + thought),
      );

      if (t.detached) return;
      for (const id of t.visualIds) seenMediaIds.add(id);
      // A card is content too: a reply that only made a character is not "No response".
      const hasContent = t.answer.trim().length > 0 || !!$messages.get().find((m) => m.id === t.assistantId)?.links?.length;
      finishTurn(t, {
        status: 'done',
        history: Array.isArray(returnedHistory) ? returnedHistory : undefined,
        ...(hasContent ? {} : { content: '_No response._' }),
      });
    } catch (error) {
      if (t.detached) return;
      if (isAbortError(error) || t.controller.signal.aborted) {
        finishTurn(t, { status: 'stopped' });
      } else {
        console.error('[MediaAgent] Turn failed:', error);
        finishTurn(t, { status: 'error', error: describeError(error) });
      }
    }
  };

  /** Ends the running turn now, keeping what streamed so far. Its late callbacks write nothing. */
  const detachTurn = () => {
    const t = turn;
    if (!t) return;
    flushAnswer(t);
    updateMessage(t.assistantId, { status: 'stopped' });
    t.detached = true;
    turn = null;
    for (const resolve of [...t.approvals.values()]) resolve('stopped');
    t.controller.abort();
    $activities.set([]);
    $approvals.set([]);
    $thinking.set('');
    $turn.set(idleTurn);
  };

  const resetSession = (meta: { id: string; title: string }, messages: AgentMessage[], createdAt: number) => {
    // Messages first: a render between the two sets then still pairs old id with old rows.
    $messages.set(messages);
    $session.set(meta);
    sessionCreatedAt = createdAt;
    seenMediaIds = new Set();
  };

  const updateSettings = (patch: Partial<AgentSettings>) => {
    const next = { ...$settings.get(), ...patch };
    $settings.set(next);
    writeAgentSettings(settingsScope(), next);
  };

  return {
    $messages,
    $turn,
    $running,
    $activities,
    $approvals,
    $thinking,
    $session,
    $history,
    $settings,

    send(input: { text: string; attachments?: AgentAttachment[] }) {
      if (turn) return;
      const text = input.text.trim();
      const attachments = input.attachments ?? [];
      if (!text && attachments.length === 0) return;
      void runTurn(
        { id: newId(), role: 'user', content: text, createdAt: Date.now(), ...(attachments.length ? { attachments } : {}) },
        { appendUser: true },
      );
    },

    stop() {
      if (!turn) return;
      detachTurn();
      scheduleSave();
    },

    /** Re-runs the last request after a failed or stopped reply. */
    retry() {
      if (turn) return;
      const messages = $messages.get();
      const last = messages[messages.length - 1];
      const user = messages[messages.length - 2];
      if (!last || last.role !== 'assistant' || !user || user.role !== 'user') return;
      $messages.set(messages.slice(0, -1));
      void runTurn(user, { appendUser: false });
    },

    /**
     * Runs the last request again after another tab closed mid-reply. 'missing'
     * when the conversation never saved that request, so the caller can send it.
     */
    resumeInterrupted(): 'resumed' | 'finished' | 'missing' {
      if (turn) return 'resumed';
      const messages = $messages.get();
      const last = messages[messages.length - 1];
      if (last?.role === 'user') {
        void runTurn(last, { appendUser: false });
        return 'resumed';
      }
      const user = messages[messages.length - 2];
      if (last?.role === 'assistant' && user?.role === 'user') {
        if (last.status === 'done') return 'finished';
        $messages.set(messages.slice(0, -1));
        void runTurn(user, { appendUser: false });
        return 'resumed';
      }
      return 'missing';
    },

    resolveApproval(id: string, approved: boolean) {
      turn?.approvals.get(id)?.(approved ? 'approve' : 'skip');
    },

    setReaction(messageId: string, reaction: 'like' | 'dislike' | null) {
      updateMessage(messageId, { reaction });
      if (!turn) scheduleSave();
    },

    updateSettings,

    updateInstruction(id: string, patch: Partial<AgentInstruction>) {
      updateSettings({
        instructions: $settings.get().instructions.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      });
    },

    async newSession() {
      const hadTurn = !!turn;
      detachTurn();
      if (hadTurn) await persist(currentSnapshot());
      else await flushSave();
      resetSession({ id: newId(), title: DEFAULT_SESSION_TITLE }, [], Date.now());
    },

    async openSession(id: string) {
      if (id === $session.get().id) return;
      const host = getHost();
      const hadTurn = !!turn;
      detachTurn();
      if (hadTurn) await persist(currentSnapshot());
      else await flushSave();
      const stored = await loadAgentSession(host.projectId, id, host.scopeId).catch(() => null);
      if (!stored) {
        void refreshHistory();
        return;
      }
      resetSession({ id: stored.id, title: stored.title || DEFAULT_SESSION_TITLE }, stored.messages.map(fromStored), stored.createdAt);
    },

    async deleteSession(id: string) {
      const host = getHost();
      if (id === $session.get().id) {
        detachTurn();
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        resetSession({ id: newId(), title: DEFAULT_SESSION_TITLE }, [], Date.now());
      }
      try {
        await deleteAgentSession(host.projectId, id, host.scopeId);
      } catch (error) {
        console.warn('[MediaAgent] Could not delete the conversation:', error);
      }
      void host.deleteSessionFromDisk?.(id).catch(() => false);
      await refreshHistory();
    },

    refreshHistory,

    /** Stops a running turn and writes anything unsaved. Safe to call more than once. */
    dispose() {
      if (turn) {
        detachTurn();
        void persist(currentSnapshot());
      } else {
        void flushSave();
      }
    },
  };
}
