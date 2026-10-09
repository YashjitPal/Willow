// Prints the Media agent's system prompt and tool declarations for a sample project, to read
// what the model reads.  node tools/scratch/media-agent-prompt.mjs [--tools]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from '../../apps/studio/test/ts-module.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tools = await importTs(path.join(REPO, 'features/media/src/agent/agent-tools.ts'));
const context = await importTs(path.join(REPO, 'features/media/src/agent/agent-context.ts'));

const IMAGE_MODELS = [{ id: 'gemini-3-pro-image', name: 'Nano Banana Pro' }];
const VIDEO_MODELS = [{ id: 'veo-3.1-fast', name: 'Veo 3.1 Fast' }, { id: 'omni-flash', name: 'Gemini Omni Flash 1' }];
const item = (id, extra = {}) => ({
  id, kind: 'image', status: 'completed', url: `data:image/png;base64,${id}`, prompt: `prompt ${id}`,
  modelId: 'm', modelName: 'M', ratio: '16:9', timestamp: 0, ...extra,
});
const host = {
  mediaItems: [
    item('img-1', { shortenedPrompt: 'Harbour at dawn', timestamp: 1 }),
    item('vid-1', { kind: 'video', shortenedPrompt: 'Mira boards the plane', timestamp: 2 }),
    item('vid-2', { kind: 'video', shortenedPrompt: 'Take-off over the sea', timestamp: 3 }),
    item('portrait-1', { characterId: 'char-1', timestamp: 4 }),
  ],
  characters: [{
    id: 'char-1', name: 'Mira', prompt: 'A red-haired pilot in a leather jacket', personality: 'Brave, dry humour',
    voice: { name: 'Kore' }, portraitId: 'portrait-1', updatedAt: 5,
  }],
  scenes: [{ id: 'scene-1', name: 'First flight', aspectRatio: '16:9', clips: [{ id: 'c1', mediaId: 'vid-1', trimStart: 0, trimEnd: 8 }], updatedAt: 6 }],
  collections: [],
  focus: { tab: 'Videos', selection: [{ kind: 'media', id: 'vid-2' }, { kind: 'media', id: 'vid-1' }] },
};

if (process.argv.includes('--tools')) {
  console.log(JSON.stringify(tools.buildMediaAgentToolDeclarations(IMAGE_MODELS, VIDEO_MODELS), null, 2));
} else {
  console.log(tools.buildMediaAgentSystemPrompt({
    imageModels: IMAGE_MODELS,
    videoModels: VIDEO_MODELS,
    defaults: { imageModel: 'gemini-3-pro-image', imageRatio: '16:9', imageCount: 2, videoModel: 'veo-3.1-fast', videoRatio: '16:9', videoCount: 1, videoDuration: '8s' },
    confirmBeforeGenerating: false,
    instructions: [],
    inventory: context.toInventory(host.mediaItems, new Map()),
    characters: context.toPromptCharacters(host),
    scenes: context.toPromptScenes(host),
    focus: context.toPromptFocus(host, new Map()),
  }));
}
