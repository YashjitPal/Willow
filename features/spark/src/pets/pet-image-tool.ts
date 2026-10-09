/**
 * The Hatch Pet skill's pictures, in Spark.
 *
 * The skill needs an image tool, and Spark has none of its own, so a run gets
 * this one while the user has the skill: `app:generate_pet_image`, from the
 * "Pets" app. It draws with the Gemini image model the user added in Settings →
 * Models — nothing is substituted, as with Code's image tool — conditioned on
 * the reference images the skill names, and saves the result inside the pet's
 * creation run, where the skill's scripts pick it up. The desktop app keeps it
 * there: it reads and writes only inside the library's `.hatching` runs.
 */
import { generateGeminiImage, IMAGE_ASPECT_RATIOS, type GeneratedImage, type ImageAspectRatio } from '@willow/ai/image-generation';
import { apiKeysForBinding, resolveProviderBinding } from '@willow/ai/providers/profiles';
import { isDesktopApp, readDesktopPetImage, writeDesktopPetImage } from '@willow/core/desktop-bridge';
import { collectSavedModelsInCatalogOrder, getModelCategory, liveModelId } from '@willow/core/model-catalog';
import type { SparkConnectorTool } from '../harness/spark-tools';
import type { SparkSkill } from '../spark-types';

const SKILL = 'hatch-pet';
/** A row of poses is drawn from the canonical base and a few anchors, not from everything at once. */
const MAX_REFERENCES = 6;

type ImageModel = { model: string; apiKey: string; baseUrl?: string } | { missing: string };

/** The first Gemini image model the user added, with its key. */
const imageModel = (modelConfig: unknown, apiKeys: unknown): ImageModel => {
  const model = collectSavedModelsInCatalogOrder(modelConfig as never)
    .find((entry) => getModelCategory(entry) === 'image' && entry.providerId === 'gemini');
  if (!model) {
    return { missing: 'No image was made: there is no Gemini image model in Settings → Models. Tell the user they can add one (for example Nano Banana) and try again; do not draw the pet some other way.' };
  }
  const binding = resolveProviderBinding(modelConfig as never, 'gemini', { profileId: model.profileId });
  const apiKey = apiKeysForBinding(binding, 'gemini', apiKeys as never)[0];
  if (!apiKey) return { missing: 'No image was made: the Gemini API key is missing. The user can add it in Settings → Models.' };
  return { model: liveModelId(model.modelId || model.id), apiKey, baseUrl: binding.baseUrl };
};

const fromDataUrl = (url: string): GeneratedImage => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) throw new Error('A reference image could not be read.');
  return { mimeType: match[1], data: match[2] };
};

/** The skill keys out a flat background, which a lossy format would smear: always PNG. */
async function asPng(image: GeneratedImage): Promise<string> {
  if (image.mimeType === 'image/png') return image.data;
  const bitmap = await createImageBitmap(await (await fetch(`data:${image.mimeType};base64,${image.data}`)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const url = canvas.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}

/** The tool, for a run in the desktop app while the user has the Hatch Pet skill turned on. */
export const petCreationTools = (skills: readonly SparkSkill[], modelConfig: unknown, apiKeys: unknown): SparkConnectorTool[] => {
  if (!isDesktopApp() || !skills.some((skill) => skill.enabled !== false && skill.name.toLowerCase() === SKILL)) return [];
  return [{
    name: 'generate_pet_image',
    app: 'pets',
    appLabel: 'Pets',
    description:
      'For the hatch-pet skill only: draws one image with the user\'s image model and saves it as a PNG at `output`, an absolute path inside the pet\'s creation run (the `run` folder pet_bridge.py returned). Pass every reference image as absolute paths inside that run in `references` — the canonical base for every pose and look row. `aspectRatio` is one of 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9. Returns the saved path.',
    signature: '{ prompt: string, output: string, references?: string[], aspectRatio?: string }',
    run: async (args) => {
      try {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const output = typeof args.output === 'string' ? args.output.trim() : '';
        if (!prompt || !output) return { text: 'generate_pet_image needs a `prompt` and an `output` path.', failed: true };
        const model = imageModel(modelConfig, apiKeys);
        if ('missing' in model) return { text: model.missing, failed: true };
        const references = Array.isArray(args.references) ? args.references.filter((path): path is string => typeof path === 'string' && path.trim() !== '') : [];
        if (references.length > MAX_REFERENCES) return { text: `Attach at most ${MAX_REFERENCES} reference images.`, failed: true };
        const images = await Promise.all(references.map(async (path) => fromDataUrl(await readDesktopPetImage(path.trim()))));
        const aspectRatio = (IMAGE_ASPECT_RATIOS as readonly string[]).includes(String(args.aspectRatio)) ? args.aspectRatio as ImageAspectRatio : '1:1';
        const image = await generateGeminiImage({ apiKey: model.apiKey, model: model.model, baseUrl: model.baseUrl, prompt, images, aspectRatio });
        const saved = await writeDesktopPetImage(output, await asPng(image));
        return { text: `Saved ${saved}.` };
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), failed: true };
      }
    },
  }];
};
