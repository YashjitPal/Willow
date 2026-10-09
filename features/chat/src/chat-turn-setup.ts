import { runWebSearch, webSearchToolDeclaration } from '@willow/ai/web-search-tool';
import {
  apiKeysForBinding,
  defaultApiFormatForProvider,
  nativeToolFormatForProvider,
  resolveProviderBinding,
} from '@willow/ai/providers/profiles';
import { buildNotebookSystemPrompt } from '@willow/notebooks/notebook-chat-store';
import { notebooksStore } from '@willow/notebooks/notebooks-store';
import { resolveNotebookEmbeddingModel } from '@willow/notebooks/source-retrieval';
import { buildGemSystemPrompt, gemPromptSource } from '@willow/gems/gem-chat-store';
import { resolveGem } from '@willow/gems/gems-store';
import type { ToolId } from './composer/composer-options';
import type { ChatMsg } from './chat-message';
import { chatSystemPromptFor, type ResolvedChatModel } from './chat-model';
import type { ChatTurnRunnerDeps } from './chat-turn-runner';
import { personalChatTools } from './personal-tools';
import { buildCanvasDocs } from './canvas/canvas-store';
import { CANVAS_INSTRUCTIONS, canvasChatTools, canvasContextBlock } from './canvas/canvas-tools';
import { mediaChatTools, mediaInstructions, mediaKindForTool, type MediaToolMode, type MediaToolOptions } from './media/media-tools';
import { createChatMediaHost, type ChatMediaStore } from './media/media-host';
import type { InlineImage } from './media/media-clients';
import type { LibrarySkill } from '@willow/core/skill-library';
import { mentionedAppsBlock, mentionedSkillsBlock } from './composer/mentions/mention-prompts';
import { researchChatTools, researchInstructions } from './research/research-tools';
import { libraryChatTools, libraryInstructions } from './library/library-tools';
import { sparkLibraryWriter } from '@willow/core/spark-library';

/**
 * Everything a chat turn is built from besides its history, shared by the
 * composer's send and by a tab resuming a turn another tab started. Two copies
 * of this would drift, and a resumed reply that quietly lost its notebook or
 * its canvas tools would read as the model forgetting the conversation.
 */

/** The per-turn choices that live in the sending tab's UI rather than in the chat file. */
export interface ChatTurnChoices {
  /** The notebook the chat belongs to, if any. */
  notebookId: string | null;
  /** The Gem the chat was opened with, if any. */
  gemId: string | null;
  /** The composer tool picked for this message. */
  tool: ToolId | null;
}

/**
 * Notebook and Gem grounding for this question.
 *
 * Resolved before the turn is built because retrieval is asynchronous now: it
 * ranks the notebook's passages against THIS question rather than sending every
 * source in full, and may embed the query first.
 *
 * Failures degrade to an empty string rather than aborting the send: a notebook
 * chat that cannot retrieve should answer ungrounded, not refuse. `selectChunks`
 * already falls back from embeddings to lexical internally, so reaching a catch
 * means something further out went wrong.
 */
export const resolveChatTurnGrounding = async ({
  text,
  notebookId,
  gemId,
  modelConfig,
  apiKeys,
}: {
  text: string;
  notebookId: string | null;
  gemId: string | null;
  modelConfig: any;
  apiKeys: any;
}): Promise<{ notebookGrounding: string; gemPrompt: string }> => {
  const model = resolveNotebookEmbeddingModel(modelConfig, apiKeys);
  const notebook = notebookId ? notebooksStore.get().find((candidate) => candidate.id === notebookId) : undefined;
  const gem = resolveGem(gemId);
  const [notebookGrounding, gemPrompt] = await Promise.all([
    notebook ? buildNotebookSystemPrompt(notebook, { query: text, model }).catch(() => '') : '',
    // The Gem's instructions and the knowledge passages that bear on this question.
    gem ? buildGemSystemPrompt(gemPromptSource(gem), { query: text, model }).catch(() => '') : '',
  ]);
  return { notebookGrounding, gemPrompt };
};

export type ChatTurnSetup = Pick<
  ChatTurnRunnerDeps,
  | 'options' | 'systemPrompt' | 'personalTools' | 'canvasTools' | 'canvasHost' | 'mediaTools' | 'mediaHost'
  | 'researchTools' | 'researchHost' | 'libraryTools' | 'libraryHost' | 'webSearchTools' | 'runWebSearch'
>;

export const buildChatTurnSetup = ({
  model,
  apiKey,
  prevMessages,
  tool,
  isIncognito,
  chatKey,
  modelConfig,
  apiKeys,
  notebookGrounding,
  gemPrompt,
  mediaOptions,
  mediaStore,
  mediaScopeId = '',
  mediaInputImages,
  mediaPreviousImage,
  researchQuery = '',
  mentionedSkills = [],
  mentionedApps = [],
  libraryScopeId = '',
}: {
  model: ResolvedChatModel;
  apiKey: string;
  /** The thread before this turn. */
  prevMessages: ChatMsg[];
  tool: ToolId | null | undefined;
  isIncognito: boolean;
  chatKey: string;
  modelConfig: any;
  apiKeys: any;
  notebookGrounding: string;
  gemPrompt: string;
  /** The composer companion row's choices for this message (aspect ratio, template, …). */
  mediaOptions?: MediaToolOptions;
  /** Where generated files are kept. Without one the media tools are not declared. */
  mediaStore?: ChatMediaStore;
  /** The storage scope Media's model picks are remembered under. */
  mediaScopeId?: string;
  /** Images attached to this message, handed to the generator as input. */
  mediaInputImages?: InlineImage[];
  /** Reads the newest image already in the thread, for a call that changes or animates it. */
  mediaPreviousImage?: () => Promise<InlineImage | null>;
  /** The message text, kept on a Deep Research plan as what was asked. */
  researchQuery?: string;
  /** Skills the message invokes with "/": their instructions join this turn's prompt. */
  mentionedSkills?: LibrarySkill[];
  /** Connected apps the message names with "@", by label: the model is told to use them. */
  mentionedApps?: string[];
  /** The storage scope a schedule or skill saved from this chat goes to. Without one they are not offered. */
  libraryScopeId?: string;
}): ChatTurnSetup => {
  const { provider, apiFormat, toolPolicy } = model;

  // A temporary chat carries nothing personal in and saves nothing out, so
  // the same flag governs both halves of personalization: the prompt blocks
  // and the tools. Computed once here so they cannot disagree — the
  // retrieval guidance tells the model it MUST call a tool, and shipping
  // that text without the declaration produces a model that keeps trying.
  const personalTools = personalChatTools({ personalize: !isIncognito });

  /*
   * Canvas is declared when the user attached the chip — OR when this
   * conversation already holds a document.
   *
   * The second half is not a convenience. "Make it shorter" is the most
   * common canvas follow-up and nobody re-attaches the chip to send it, so
   * gating purely on the chip would answer it in the chat and leave the panel
   * showing the old text. It also makes Retry and Edit-and-resend behave: the
   * tool selection is per-message and is not stored on a saved message, so a
   * regenerated canvas turn has no chip to read and would otherwise silently
   * lose the feature.
   *
   * Both halves are safe against unwanted cards because the tools are only
   * offered, never forced, and the instruction block spends most of its length
   * on when NOT to call them.
   */
  const canvasDocs = buildCanvasDocs(prevMessages);
  const canvasEnabled = tool === 'canvas' || canvasDocs.size > 0;
  const canvasTools = canvasChatTools(canvasEnabled);
  const canvasInventory = [...canvasDocs.values()]
    .sort((a, b) => a.lastTouchedIndex - b.lastTouchedIndex);

  /*
   * Willow's own web search, declared as a client tool when this endpoint is
   * not being sent a server-side one.
   *
   * Exactly one search mechanism per turn. `web_search` is also the name of
   * Anthropic's and OpenAI's built-ins, so declaring ours alongside theirs
   * would put two tools of the same name in one request — hence the condition
   * is the exact negation of "a native search tool is going out".
   * `nativeToolFormatForProvider` is the same predicate `chat.ts` gates its
   * OpenAI path on, and it is null for Moonshot, which has no verified shape.
   *
   * This is what finally makes Tool translation = "Function calling" mean
   * something: it is the setting for a relay that proxies the wire format but
   * not the provider's built-ins, and it now buys Willow's own search instead
   * of silently buying no search at all. Gated on a Gemini key because that is
   * what answers the call — a declared tool with no executor is worse than no
   * tool, since the model announces a search it cannot run.
   */
  const searchBinding = resolveProviderBinding(modelConfig, 'gemini');
  const searchBackendKey = apiKeysForBinding(searchBinding, 'gemini', apiKeys)[0];
  const endpointRunsOwnSearch = toolPolicy !== 'function-calling'
    && !!nativeToolFormatForProvider(provider, apiFormat ?? defaultApiFormatForProvider(provider));
  const clientSearchEnabled = toolPolicy !== 'disabled'
    && !endpointRunsOwnSearch
    && !!searchBackendKey;

  /*
   * Image, video and music: declared for the composer tool the user attached, exactly as
   * Canvas is, and only when the view gave somewhere to keep the files. They are declared
   * even without a Gemini key or a model of that kind — the card then says what to add in
   * Settings, which beats a model explaining that it cannot draw.
   *
   * With no tool attached, all three are offered, never forced, so "draw me a cat" draws one
   * the way Gemini does. That half waits for a Gemini key: the user never turned the feature
   * on, so a card pointing them at Settings would be a detour they did not ask for.
   */
  const mediaKey = apiKeysForBinding(searchBinding, 'gemini', apiKeys)[0] ?? '';
  const mediaKind: MediaToolMode = toolPolicy === 'disabled' || !mediaStore
    ? null
    : mediaKindForTool(tool) ?? (!tool && mediaKey ? 'auto' : null);
  /* Deep research proposes a plan through a client tool; the run itself needs a Gemini key,
     which the view checks when Start research is pressed. */
  const researchEnabled = tool === 'research' && toolPolicy !== 'disabled';
  /* Scheduled actions and skills outlive the chat, so a temporary chat — which keeps
     nothing — cannot make them. Saved through Spark, so a build without Spark has none. */
  const libraryWriter = sparkLibraryWriter();
  const libraryEnabled = !isIncognito && toolPolicy !== 'disabled' && !!libraryWriter && !!libraryScopeId && !researchEnabled;

  return {
    options: {
      provider,
      model: model.model,
      apiKey,
      apiKeyFallbacks: model.apiKeyFallbacks,
      thinkingLevel: model.thinkingLevel,
      baseUrl: model.baseUrl,
      apiFormat,
      toolPolicy,
      profileId: model.profileId,
      reasoningEffort: model.reasoningEffort,
    },
    // Saved Info is the "in" half: the entries survive the session, so
    // sending them would make a temporary chat quietly personalized.
    systemPrompt: [
      chatSystemPromptFor(provider, {
        personalize: !isIncognito,
        personalTool: personalTools.length > 0,
        /* Drops the bento-cards section for this turn — see the flag's note.
           Two instructions for "how do I present a set of things" is one too
           many, and the canvas rules are the specific ones. */
        canvas: canvasEnabled,
      }),
      (modelConfig.resources || []).length > 0
        ? `Configured user resources:\n${(modelConfig.resources || []).map((resource: any) => `- ${resource.name}: ${resource.uri || resource.content || ''}`).join('\n')}`
        : '',
      /*
       * Notebook sources, when this chat belongs to a notebook.
       *
       * Here and not in the user's message: folding the preamble into the
       * message text rendered it inside the visible user bubble, and only
       * grounded the first turn. This array is rebuilt every turn, so a source
       * added mid-conversation reaches the next one and nothing is displayed.
       */
      gemPrompt,
      notebookGrounding,
      canvasEnabled ? CANVAS_INSTRUCTIONS : '',
      canvasEnabled ? canvasContextBlock(canvasInventory) : '',
      mediaInstructions(mediaKind, mediaOptions),
      researchInstructions(researchEnabled),
      libraryInstructions(libraryEnabled),
      mentionedSkillsBlock(mentionedSkills),
      mentionedAppsBlock(mentionedApps),
    ].filter(Boolean).join('\n\n'),
    personalTools,
    canvasTools,
    canvasHost: canvasEnabled ? { chatKey, priorDocs: canvasDocs } : undefined,
    mediaTools: mediaChatTools(mediaKind),
    mediaHost: mediaKind && mediaStore
      ? createChatMediaHost({
        apiKey: mediaKey,
        modelConfig,
        scopeId: mediaScopeId,
        options: mediaOptions ?? {},
        store: mediaStore,
        inputImages: mediaInputImages,
        previousImage: mediaPreviousImage,
      })
      : undefined,
    researchTools: researchChatTools(researchEnabled),
    researchHost: researchEnabled ? { query: researchQuery } : undefined,
    libraryTools: libraryChatTools(libraryEnabled),
    libraryHost: libraryEnabled && libraryWriter ? { scopeId: libraryScopeId, writer: libraryWriter } : undefined,
    webSearchTools: clientSearchEnabled ? webSearchToolDeclaration() : undefined,
    runWebSearch: clientSearchEnabled
      ? (query: string) => runWebSearch({
        query,
        apiKey: searchBackendKey,
        baseUrl: searchBinding.baseUrl,
      })
      : undefined,
  };
};
