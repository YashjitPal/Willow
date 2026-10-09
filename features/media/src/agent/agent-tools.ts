// The media agent's contract with the model: the tools it may call and what it is told
// about itself.
//
// Every tool declared here is executed in `agent-session.ts`, and nothing else is declared.
// That pairing is the point of this file. A declared tool with no executor behind it does
// not add capability; it teaches the model to announce work that never happens (see
// "The deferred prompt blocks" in features/chat/AGENTS.md). The suite this replaced was
// copied from Google Flow and offered collections, Street View, credits and polling that
// Willow has never had, answered by a mock that returned stock footage.
//
// Eight tools, one job each: two make media, two build characters, two build scenes and two
// look. Tools that overlap are what confuse a model into picking the wrong one, so a new
// ability goes into an existing tool's parameters unless it is a different job.

import { CHARACTER_VOICES } from '../characters/voices';

export const MEDIA_AGENT_MODEL = 'gemini-3.5-flash';

export const IMAGE_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const VIDEO_RATIOS = ['16:9', '9:16'] as const;
export const VIDEO_DURATIONS = ['4s', '6s', '8s', '10s'] as const;
export const MAX_GENERATION_COUNT = 4;
/** How much of the gallery the system prompt lists; `list_media` reaches the rest. */
export const PROMPT_INVENTORY_LIMIT = 40;
export const PROMPT_CHARACTER_LIMIT = 20;
export const PROMPT_SCENE_LIMIT = 15;
/** Clips listed per scene; its clip count and length cover the rest. */
const PROMPT_SCENE_CLIP_LIMIT = 8;
const PROMPT_SELECTION_LIMIT = 24;
const PROMPT_TEXT_LIMIT = 240;

export type MediaAgentToolName =
  | 'generate_image'
  | 'generate_video'
  | 'create_character'
  | 'update_character'
  | 'create_scene'
  | 'update_scene'
  | 'list_media'
  | 'analyze_media';

export const MEDIA_AGENT_TOOL_NAMES: readonly MediaAgentToolName[] = [
  'generate_image',
  'generate_video',
  'create_character',
  'update_character',
  'create_scene',
  'update_scene',
  'list_media',
  'analyze_media',
];

export interface AgentModelOption {
  id: string;
  name: string;
}

export interface InventoryEntry {
  id: string;
  /** image, video or audio for gallery media; scene or collection for what a selection holds. */
  kind: string;
  name: string;
  ratio: string;
  status: string;
  favorite?: boolean;
  /** The collection it sits in, by name. */
  collection?: string;
}

export interface PromptCharacter {
  id: string;
  name: string;
  /** The description its portrait was made from. */
  look: string;
  /** "Character info": how it acts, written by the user for the agent. */
  info: string;
  /** Its voice and what it sounds like, e.g. "Kore (female, firm, mid pitch)". */
  voice?: string;
  portrait: 'ready' | 'generating' | 'failed' | 'none';
  fullBody: boolean;
  favorite?: boolean;
}

export interface PromptSceneClip {
  mediaId: string;
  name: string;
  seconds: number;
}

export interface PromptScene {
  id: string;
  name: string;
  ratio: string;
  seconds: number;
  clips: PromptSceneClip[];
}

/** What the user has in front of them, for "this", "these" and "the one I have open". */
export interface PromptFocus {
  tab: string;
  collection?: { id: string; name: string };
  viewer?: InventoryEntry;
  scene?: { id: string; name: string };
  character?: { id: string; name: string };
  selection: InventoryEntry[];
}

export interface AgentInstructionForPrompt {
  title: string;
  content: string;
  referenceId?: string;
  referenceName?: string;
}

export interface MediaAgentPromptContext {
  userName?: string;
  imageModels: AgentModelOption[];
  videoModels: AgentModelOption[];
  defaults: {
    imageModel: string;
    imageRatio: string;
    imageCount: number;
    videoModel: string;
    videoRatio: string;
    videoCount: number;
    videoDuration: string;
  };
  confirmBeforeGenerating: boolean;
  instructions: AgentInstructionForPrompt[];
  /** Newest first, already filtered to what the gallery shows. */
  inventory: InventoryEntry[];
  characters: PromptCharacter[];
  scenes: PromptScene[];
  focus?: PromptFocus;
}

/** Omni Flash reads every reference image; Veo only takes an opening frame. */
export const videoModelTakesReferences = (modelId: string): boolean => modelId.startsWith('omni-flash');

const enumOrFree = (values: readonly string[], description: string) =>
  values.length > 0
    ? { type: 'STRING', format: 'enum', enum: [...values], description }
    : { type: 'STRING', description };

const idArray = (description: string) => ({ type: 'ARRAY', items: { type: 'STRING' }, description });

const VOICE_GUIDE = CHARACTER_VOICES.map((v) => `${v.name} (${v.description.toLowerCase()})`).join(', ');
const VOICE_NAMES = CHARACTER_VOICES.map((v) => v.name);

export function buildMediaAgentToolDeclarations(
  imageModels: AgentModelOption[],
  videoModels: AgentModelOption[],
): { functionDeclarations: any[] }[] {
  const imageModel = enumOrFree(imageModels.map((m) => m.id), "Image model ID. Defaults to the user's setting.");
  return [{
    functionDeclarations: [
      {
        name: 'generate_image',
        description:
          "Generate images and add them to the user's gallery. To edit, restyle or reuse a gallery image, put its ID in reference_ids and describe only the change; call once per source image when editing several. To feature saved characters, put their IDs in character_ids. The results appear in the chat by themselves.",
        parameters: {
          type: 'OBJECT',
          properties: {
            prompt: {
              type: 'STRING',
              description: 'A complete, specific prompt (subject, setting, composition, lighting, style). For an edit, describe only the change to make.',
            },
            aspect_ratio: enumOrFree(IMAGE_RATIOS, "Aspect ratio. Defaults to the user's setting."),
            count: {
              type: 'INTEGER',
              description: `Number of variations, 1 to ${MAX_GENERATION_COUNT}. Defaults to 1 for an edit (reference_ids set) and otherwise to the user's setting; follow an explicit number in the request instead.`,
            },
            model: imageModel,
            reference_ids: idArray('Gallery media IDs to use as the edit source or as style, character or composition references.'),
            character_ids: idArray('Saved characters to feature. Their portraits are sent as references, so describe what they do and where, not how they look.'),
          },
          required: ['prompt'],
        },
      },
      {
        name: 'generate_video',
        description:
          "Generate videos and add them to the user's gallery. Text-to-video by default; set first_frame_id to animate a gallery image. Videos take a minute or more, and calls made in the same step render at the same time. The results appear in the chat by themselves.",
        parameters: {
          type: 'OBJECT',
          properties: {
            prompt: {
              type: 'STRING',
              description: 'What happens in the shot: subject, action, camera movement, setting, mood, any dialogue and sound.',
            },
            aspect_ratio: enumOrFree(VIDEO_RATIOS, "Aspect ratio. Defaults to the user's setting."),
            duration: enumOrFree(VIDEO_DURATIONS, "Clip length. Veo models take 4s, 6s or 8s; only Omni Flash also takes 10s. Defaults to the user's setting."),
            count: {
              type: 'INTEGER',
              description: `Number of variations, 1 to ${MAX_GENERATION_COUNT}. Defaults to the user's setting; follow an explicit number in the request instead.`,
            },
            model: enumOrFree(videoModels.map((m) => m.id), "Video model ID. Defaults to the user's setting."),
            first_frame_id: {
              type: 'STRING',
              description: 'Gallery image ID to use as the opening frame (image-to-video).',
            },
            reference_ids: idArray('Gallery image IDs that guide the subject or style. Only Omni Flash models read these; Veo models ignore them.'),
            character_ids: idArray('Saved characters to feature. Only Omni Flash models read their portraits. For a Veo model, make the opening frame with generate_image and character_ids, then pass that image as first_frame_id.'),
          },
          required: ['prompt'],
        },
      },
      {
        name: 'create_character',
        description:
          'Create a reusable character and generate its portrait, and optionally a full-body shot. Use it when the user asks for a character, or before several shots of a new recurring person, animal or creature. The character appears in the chat and on the Characters page.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'A short display name.' },
            description: {
              type: 'STRING',
              description: 'A detailed visual description the portrait is made from: face, age, hair, build, clothing, accessories and art style.',
            },
            personality: { type: 'STRING', description: 'How the character acts and speaks, used to direct it in later shots.' },
            voice: enumOrFree(VOICE_NAMES, `The voice it speaks with in videos. One of: ${VOICE_GUIDE}.`),
            reference_ids: idArray('Gallery images to base the character on, such as a photo, a sketch or a style reference.'),
            full_body: { type: 'BOOLEAN', description: 'Also make a full-body shot, after the portrait.' },
            model: imageModel,
          },
          required: ['name', 'description'],
        },
      },
      {
        name: 'update_character',
        description:
          "Change a saved character: rename it, update its personality or voice, change how it looks (a new version of its portrait or full-body shot), or give it a full-body shot.",
        parameters: {
          type: 'OBJECT',
          properties: {
            character_id: { type: 'STRING', description: 'The character to change.' },
            name: { type: 'STRING', description: 'A new display name.' },
            personality: { type: 'STRING', description: 'The new personality text. It replaces the old one.' },
            voice: enumOrFree(VOICE_NAMES, 'A new voice, from the voices create_character lists.'),
            change_look: { type: 'STRING', description: "A change to the character's appearance, such as \"short silver hair\". It makes a new version of the image named in image." },
            image: enumOrFree(['portrait', 'full_body'], 'Which image change_look changes. Defaults to the portrait.'),
            full_body: { type: 'BOOLEAN', description: 'Make a new full-body shot from the current portrait (after change_look, if both are given).' },
            model: imageModel,
          },
          required: ['character_id'],
        },
      },
      {
        name: 'create_scene',
        description:
          'Make a new scene from finished gallery videos, played one after another in the order given; it opens in the Scenebuilder. For a scene of new shots, generate the videos first and pass their IDs once they have finished.',
        parameters: {
          type: 'OBJECT',
          properties: {
            clip_ids: idArray('Gallery video IDs in story order. A video can appear more than once.'),
            name: { type: 'STRING', description: 'The scene name. Defaults to the date.' },
          },
          required: ['clip_ids'],
        },
      },
      {
        name: 'update_scene',
        description: 'Change a scene: rename it, add clips at the end, or set its whole clip order, which can also remove clips.',
        parameters: {
          type: 'OBJECT',
          properties: {
            scene_id: { type: 'STRING', description: 'The scene to change.' },
            name: { type: 'STRING', description: 'A new name.' },
            add_clip_ids: idArray('Gallery video IDs to add at the end, in order.'),
            clip_ids: idArray("The scene's complete new clip order, as gallery video IDs. Clips already in the scene keep their trims; videos left out are removed."),
          },
          required: ['scene_id'],
        },
      },
      {
        name: 'list_media',
        description:
          "List what this project holds, newest first: gallery items, characters or scenes, with their IDs. Use it to find things beyond the ones listed in your instructions.",
        parameters: {
          type: 'OBJECT',
          properties: {
            kind: enumOrFree(['all', 'image', 'video', 'audio', 'character', 'scene'], 'What to list. Defaults to all.'),
            query: { type: 'STRING', description: 'Optional words to match against names.' },
            limit: { type: 'INTEGER', description: 'Maximum number of entries, up to 100. Defaults to 50.' },
          },
        },
      },
      {
        name: 'analyze_media',
        description:
          'Look closely at one gallery image or video and answer a question about it. Use it for details the thumbnails do not show, and for videos, which you otherwise cannot see.',
        parameters: {
          type: 'OBJECT',
          properties: {
            media_id: { type: 'STRING', description: "The gallery media ID, or a character's portrait image ID." },
            question: { type: 'STRING', description: 'What to find out about it.' },
          },
          required: ['media_id', 'question'],
        },
      },
    ],
  }];
}

const modelLabel = (models: AgentModelOption[], id: string): string => {
  const match = models.find((m) => m.id === id);
  return match ? `${match.name} (${id})` : id;
};

const clip = (text: string, limit = PROMPT_TEXT_LIMIT): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** 7 → "7s", 75 → "1:15". */
export const formatSeconds = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const inventoryLine = (entry: InventoryEntry): string => {
  const flags = [
    entry.status !== 'completed' ? entry.status : '',
    entry.favorite ? 'favorite' : '',
    entry.collection ? `in "${entry.collection}"` : '',
  ].filter(Boolean);
  const ratio = entry.ratio ? ` · ${entry.ratio}` : '';
  return `- ${entry.id} · ${entry.kind}${ratio} · "${entry.name}"${flags.length ? ` · ${flags.join(', ')}` : ''}`;
};

const characterLines = (c: PromptCharacter): string[] => {
  const head = [
    `- ${c.id} · "${c.name}"`,
    c.portrait === 'ready' ? (c.fullBody ? 'portrait and full body ready' : 'portrait ready') : `portrait ${c.portrait}`,
    c.voice ? `voice ${c.voice}` : '',
    c.favorite ? 'favorite' : '',
  ].filter(Boolean).join(' · ');
  return [
    head,
    ...(c.look.trim() ? [`  Look: ${clip(c.look)}`] : []),
    ...(c.info.trim() ? [`  Info: ${clip(c.info)}`] : []),
  ];
};

const sceneLines = (s: PromptScene): string[] => {
  const shown = s.clips.slice(0, PROMPT_SCENE_CLIP_LIMIT)
    .map((c, i) => `${i + 1}. ${c.mediaId} "${clip(c.name, 60)}" ${formatSeconds(c.seconds)}`);
  const more = s.clips.length > shown.length ? `; and ${s.clips.length - shown.length} more` : '';
  return [
    `- ${s.id} · "${s.name}"${s.ratio ? ` · ${s.ratio}` : ''} · ${plural(s.clips.length, 'clip')}, ${formatSeconds(s.seconds)}`,
    ...(shown.length ? [`  Clips: ${shown.join('; ')}${more}`] : ['  No clips yet.']),
  ];
};

const focusLines = (focus: PromptFocus): string[] => {
  const lines = ['On screen now', `- Tab: ${focus.tab}.`];
  if (focus.collection) lines.push(`- Inside the collection "${focus.collection.name}" (${focus.collection.id}).`);
  if (focus.viewer) lines.push(`- Open in the viewer:${inventoryLine(focus.viewer).slice(1)}`);
  if (focus.scene) lines.push(`- Open in the Scenebuilder: scene ${focus.scene.id} "${focus.scene.name}".`);
  if (focus.character) lines.push(`- Open: the page of character ${focus.character.id} "${focus.character.name}".`);
  if (focus.selection.length) {
    const shown = focus.selection.slice(0, PROMPT_SELECTION_LIMIT);
    lines.push(`- Selected in the gallery (${focus.selection.length}), oldest first:`);
    lines.push(...shown.map((entry) => `  ${inventoryLine(entry)}`));
    if (focus.selection.length > shown.length) lines.push(`  and ${focus.selection.length - shown.length} more.`);
  } else {
    lines.push('- Nothing is selected in the gallery.');
  }
  return lines;
};

/* ─────────────────────────────────────────────────────────────────────
 * DEFERRED: media capability self-description
 *
 * SLOTS INTO: `buildMediaAgentSystemPrompt` below, as a trailing section.
 * BLOCKED ON: nothing structural — the agent's turns set
 *   `enableMediaTools: true` (agent-session.ts), so it is the one surface
 *   that may honestly claim these. What it needs is a pass to reconcile
 *   the text against what Willow really wires up: the agent has no music
 *   or Live tool, so those paragraphs must not ship as written.
 *
 * This came from the source prompt Chat's `CHAT_SYSTEM_PROMPT` was adapted
 * from, and it is the reason Chat must never carry it: chat turns leave
 * `enableMediaTools` off, so `generate_image` / `generate_video` are never
 * declared to them. A chat model told it can generate video announces a
 * render that never lands. Media is the correct home, which is why the
 * block was parked here rather than in `features/chat`.
 *
 * Reconcile before pasting — the model names here are the source's, while
 * the live ones arrive in `ctx.imageModels` / `ctx.videoModels` from the
 * user's picker. Prefer those over hardcoding, or the prompt will drift from
 * the picker. Willow has no subscription tiers, so the source's per-day
 * allowances are already deleted rather than renumbered.
 *
 * ───8<─────── paste from here ───────
 *
 * The following information block is strictly for answering questions
 * about your capabilities. It MUST NOT be used for any other purpose, such
 * as executing a request or influencing a non-capability-related response.
 * If there are questions about your capabilities, use the following info to
 * answer appropriately:
 *
 * * Generative Abilities: You can generate text, images, videos, music.
 * * Image Tools (image_generation & image_edit):
 *     * Description: Can help generate and edit images. This is powered by
 *       the "Nano Banana 2" model, which has an official name of Gemini 3
 *       Flash Image. It's a state-of-the-art model capable of
 *       text-to-image, image+text-to-image (editing), and
 *       multi-image-to-image (composition and style transfer).
 * * Video Tools (video_generation):
 *     * Description: Can help generate videos. This uses the "Veo" model.
 *       Veo is Google's state-of-the-art model for generating high-fidelity
 *       videos with natively generated audio. Capabilities include
 *       text-to-video with audio cues, extending existing Veo videos,
 *       generating videos between specified first and last frames, and
 *       using reference images to guide video content.
 *     * Constraints: Unsafe content.
 * * Music Tools (music_generation):
 *     * Description: Can help generate high-fidelity music tracks. This is
 *       powered by the "Lyria 3" model. It is a multimodal model capable of
 *       text-to-music, image-to-music, and video-to-music generation. It
 *       supports professional-grade arrangements, including automated lyric
 *       writing and realistic vocal performances in multiple languages.
 *     * Features: Produces 30-second tracks with granular control over
 *       tempo, genre, and emotional mood.
 *     * Constraints: All tracks include SynthID watermarking for
 *       AI-identification.
 * * Willow Live Mode: You have a conversational mode called Willow Live.
 *     * Description: This mode allows for a more natural, real-time voice
 *       conversation. You can be interrupted and engage in free-flowing
 *       dialogue.
 *     * Key Features:
 *         * Natural Voice Conversation: Speak back and forth in real-time.
 *         * Camera Sharing: Share your camera feed to ask questions about
 *           what you see.
 *         * Screen Sharing: Share your screen for contextual help on apps
 *           or content.
 *         * Image/File Discussion: Upload images or files to discuss their
 *           content.
 *     * Use Cases: Real-time assistance, brainstorming, language learning,
 *       translation, getting information about surroundings, help with
 *       on-screen tasks.
 *
 * ───8<─────── to here ───────
 *
 * The Live paragraph is the one part that is already true elsewhere — Chat
 * ships live voice today (`liveSystemPrompt` in `@willow/chat/chat-model`).
 * If any of this is wanted sooner, it is that paragraph, trimmed to the
 * surfaces Willow actually ships, and it belongs to Chat rather than here.
 * ───────────────────────────────────────────────────────────────────── */
export function buildMediaAgentSystemPrompt(ctx: MediaAgentPromptContext): string {
  const who = ctx.userName ? ctx.userName : 'the user';
  const { defaults } = ctx;
  const inventory = ctx.inventory.slice(0, PROMPT_INVENTORY_LIMIT);
  const characters = ctx.characters.slice(0, PROMPT_CHARACTER_LIMIT);
  const scenes = ctx.scenes.slice(0, PROMPT_SCENE_LIMIT);
  const omniModels = ctx.videoModels.filter((m) => videoModelTakesReferences(m.id)).map((m) => m.name);

  const sections: string[] = [];

  sections.push(
    `You are the Media agent in Willow Studio. You help ${who} plan and make images, videos, characters and scenes for the project open on screen, working alongside their gallery.`,
  );

  sections.push([
    'What you can do',
    '- generate_image and generate_video: make images and videos, edit or restyle gallery images, animate an image, and feature saved characters.',
    '- create_character and update_character: build reusable characters (a portrait, an optional full-body shot, how they act and their voice) and change them later.',
    '- create_scene and update_scene: put finished videos together into scenes, the timelines the Scenebuilder plays, and add to, reorder or rename them.',
    '- list_media and analyze_media: find gallery items, characters and scenes, and look closely at an image or video.',
    '- Write prompts, storyboards, shot lists and creative direction directly in your reply. That is text and needs no tool.',
    'You cannot make music or audio files on their own, trim or edit a clip inside a scene, delete, move or download anything, or change settings. Say so plainly when asked.',
  ].join('\n'));

  const working = [
    'How to work',
    "- When the user asks for something, call the tool in the same turn. Never describe work you have not started, and never say something finished before the tool result says so.",
    '- Write strong prompts for the tools: concrete subject, setting, composition, lighting, style, lens and mood. Keep the user\'s own wording for anything they were specific about.',
    '- An explicit number in the request ("one image", "two versions") overrides the default count.',
    "- To edit images, call generate_image once per source image, with that image's ID in reference_ids and a prompt describing only the change. If the user does not say which image, use the most recent relevant one; ask only when it is genuinely ambiguous.",
    '- "This", "these", "the selected ones" and "the one I have open" mean what the On screen section lists. What the user attaches or @-mentions arrives at the end of their message as "[The user attached: …]", by ID.',
    '- Media, characters and scenes you make are shown in the chat automatically. Never write IDs or markdown image links in your reply; refer to things by name or by description, such as "the 16:9 lighthouse shot".',
    '- When a tool reports a failure, say so in one line and suggest a fix. Never claim success for anything that failed.',
    '- When the user asks you to go on after a reply of yours that did not finish (its note says it was stopped or failed), carry on with that request from where it stopped: keep what it already made, do not make it again, and do only what is left. Its note lists what each tool call made.',
  ];
  if (ctx.confirmBeforeGenerating) {
    working.push("- The user approves each generation before it runs. If they skip one, acknowledge it briefly and don't retry unless they ask.");
  }
  working.push('- Be concise: short paragraphs or bullets, no emojis, no filler. Reply in the language the user writes in.');
  sections.push(working.join('\n'));

  sections.push([
    'Working with characters',
    "- When the user mentions a saved character, pass its ID in character_ids. Its portrait travels as the reference, so write the action, setting and camera rather than re-describing its looks.",
    "- Use a character's info to direct how it acts, and its voice to say how it sounds when it speaks in a video.",
    '- Create a character when the user asks for one, or before several shots of a new recurring person, animal or creature: give it a name and a detailed visual description, then use the new ID in the shots. A one-off image needs no character.',
    omniModels.length
      ? `- Only ${omniModels.join(' and ')} ${omniModels.length === 1 ? 'takes' : 'take'} character_ids for video. On a Veo model, keep a character consistent by first making the opening frame with generate_image and character_ids, then animating that image with generate_video and first_frame_id.`
      : '- Veo models cannot take character references. Keep a character consistent on video by first making the opening frame with generate_image and character_ids, then animating that image with generate_video and first_frame_id.',
    "- To change a character's appearance, use update_character with change_look; for a full-body shot, full_body.",
  ].join('\n'));

  sections.push([
    'Working with scenes',
    '- A scene plays gallery videos one after another. Only finished videos can go in one.',
    '- For a scene of new shots, call generate_video once per shot in the same step so they render together, then call create_scene with the finished video IDs in story order. Leave out any that failed and say so.',
    '- For a scene of clips the user already has, use the videos they point at, in the order they ask for, or else the order they are listed.',
    '- To add to, reorder or rename an existing scene, use update_scene rather than making a new one.',
  ].join('\n'));

  sections.push([
    'Defaults (use these unless the user asks otherwise)',
    ctx.imageModels.length
      ? `- Images: ${modelLabel(ctx.imageModels, defaults.imageModel)}, ${defaults.imageRatio}, ${defaults.imageCount} per request (1 per edit).`
      : '- Images: none. No image model is added, so you cannot make images or characters; if asked, tell the user to add one in Settings → Models.',
    ctx.videoModels.length
      ? `- Videos: ${modelLabel(ctx.videoModels, defaults.videoModel)}, ${defaults.videoRatio}, ${defaults.videoDuration}, ${defaults.videoCount} per request.`
      : '- Videos: none. No video model is added, so you cannot make videos; if asked, tell the user to add one in Settings → Models.',
  ].join('\n'));

  const modelLines = ['Models'];
  if (ctx.imageModels.length) modelLines.push(`- Image: ${ctx.imageModels.map((m) => `${m.name} (${m.id})`).join(', ')}.`);
  if (ctx.videoModels.length) {
    modelLines.push(`- Video: ${ctx.videoModels.map((m) => `${m.name} (${m.id})`).join(', ')}.`);
    modelLines.push(
      omniModels.length
        ? `- Only ${omniModels.join(' and ')} can use reference images for video; other video models only take an opening frame.`
        : '- The available video models only take an opening frame, not reference images.',
    );
  }
  if (modelLines.length === 1) modelLines.push('- None added yet.');
  sections.push(modelLines.join('\n'));

  if (ctx.focus) sections.push(focusLines(ctx.focus).join('\n'));

  sections.push(characters.length
    ? [
        `Characters (${ctx.characters.length}${characters.length < ctx.characters.length ? `, ${characters.length} shown; list_media finds the rest` : ''})`,
        ...characters.flatMap(characterLines),
      ].join('\n')
    : 'Characters\nNone yet.');

  sections.push(scenes.length
    ? [
        `Scenes (${ctx.scenes.length}${scenes.length < ctx.scenes.length ? `, ${scenes.length} shown; list_media finds the rest` : ''})`,
        ...scenes.flatMap(sceneLines),
      ].join('\n')
    : 'Scenes\nNone yet.');

  if (inventory.length) {
    sections.push([
      `Gallery (newest first; ${inventory.length} of ${ctx.inventory.length} shown, use list_media for the rest)`,
      ...inventory.map(inventoryLine),
      'Some images and character portraits also arrive as thumbnails in the conversation, each labelled with its ID.',
    ].join('\n'));
  } else {
    sections.push('Gallery\nThe gallery for this project is empty.');
  }

  const instructions = ctx.instructions.filter((i) => i.content.trim());
  if (instructions.length) {
    sections.push([
      `${ctx.userName ? `${ctx.userName}'s` : "The user's"} standing instructions (always follow these)`,
      ...instructions.map((i) => {
        const reference = i.referenceId
          ? ` Reference media: ${i.referenceId}${i.referenceName ? ` ("${i.referenceName}")` : ''}.`
          : '';
        return `- ${i.title.trim() || 'Instruction'}: ${i.content.trim()}${reference}`;
      }),
    ].join('\n'));
  }

  return sections.join('\n\n');
}
