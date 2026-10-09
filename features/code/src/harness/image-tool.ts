/**
 * `generate_image` — the Image tool, as the model calls it.
 *
 * Makes a picture with an image model the user added in Settings → Models and
 * saves it into the project, where a component imports it like any asset. There
 * is no fallback model: Media's rule is that nothing generates with a model the
 * user did not add, and the harness keeps it — without one, the model is told
 * to use a placeholder and say so.
 */

import {
  generateGeminiImage,
  IMAGE_ASPECT_RATIOS,
  type GenerateImageOptions,
  type GeneratedImage,
  type ImageAspectRatio,
} from '@willow/ai/image-generation';
import { nextId } from './protocol';
import type { HarnessTool } from './tools';
import { PathError } from './workspace';

export interface ImageModelChoice {
  /** The id Google serves the model under. */
  model: string;
  /** What the user calls it. */
  name: string;
  apiKey: string;
  baseUrl?: string;
}

export type ImageModelResolution = ImageModelChoice | { missing: string };

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface ImageToolOptions {
  resolveModel: () => ImageModelResolution;
  generate?: (options: GenerateImageOptions) => Promise<GeneratedImage>;
  /** Re-encodes the picture for the project; photos are far smaller as JPEG. */
  encode?: (image: GeneratedImage, format: ImageFormat) => Promise<GeneratedImage>;
}

const slugOf = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter(Boolean).slice(0, 5).join('-') || 'image';

const formatOf = (path: string): ImageFormat => (/\.png$/i.test(path) ? 'png' : /\.webp$/i.test(path) ? 'webp' : 'jpeg');

export function makeImageTool(options: ImageToolOptions): HarnessTool {
  const generate = options.generate ?? generateGeminiImage;
  return {
    name: 'generate_image',
    description:
      "Makes an image with the user's image model and saves it into the project: a hero photo, an illustration, a product shot, a texture. Use it by importing the returned path in a component; the import is a URL string for an <img> or CSS. Describe the subject, style, colours, lighting and composition. Each image takes several seconds.",
    signature: '{"prompt": "…", "path"?: "/assets/hero.jpg", "aspect_ratio"?: "16:9"}',
    readOnly: false,
    source: 'builtin',
    startStep: (args) => ({
      id: nextId('step'),
      kind: 'image',
      origin: 'generated',
      caption: String(args.prompt ?? '').trim().slice(0, 200),
      status: 'running',
    }),
    async run(args, context) {
      const prompt = String(args.prompt ?? args.description ?? '').trim();
      if (!prompt) return { output: 'generate_image needs a "prompt".', isError: true, step: { status: 'error', error: 'No prompt' } };
      const ratio = String(args.aspect_ratio ?? args.aspectRatio ?? '1:1');
      if (!(IMAGE_ASPECT_RATIOS as readonly string[]).includes(ratio)) {
        return { output: `"${ratio}" is not an aspect ratio the model makes. Use one of: ${IMAGE_ASPECT_RATIOS.join(', ')}.`, isError: true, step: { status: 'error', error: 'Bad aspect ratio' } };
      }

      const requested = String(args.path ?? '').trim();
      let path: string;
      try {
        path = context.workspace.resolvePath(requested || `/assets/${slugOf(prompt)}.jpg`);
      } catch (error) {
        if (error instanceof PathError) return { output: `${error.message} Use a path like /assets/hero.jpg.`, isError: true, step: { status: 'error', error: 'Invalid path' } };
        throw error;
      }
      if (!/\.(png|jpe?g|webp)$/i.test(path)) path = `${path.replace(/\.[a-z0-9]+$/i, '')}.jpg`;
      if (!requested && context.workspace.exists(path)) {
        const stem = path.replace(/\.[a-z0-9]+$/i, '');
        const extension = path.slice(stem.length);
        let count = 2;
        while (context.workspace.exists(`${stem}-${count}${extension}`)) count += 1;
        path = `${stem}-${count}${extension}`;
      }

      const choice = options.resolveModel();
      if ('missing' in choice) return { output: choice.missing, isError: true, step: { status: 'error', error: 'No image model' } };

      let image = await generate({
        apiKey: choice.apiKey,
        model: choice.model,
        prompt,
        aspectRatio: ratio as ImageAspectRatio,
        baseUrl: choice.baseUrl,
        signal: context.signal,
      });
      if (options.encode) image = await options.encode(image, formatOf(path));

      context.workspace.write(path, `data:${image.mimeType};base64,${image.data}`);
      const kilobytes = Math.round((image.data.length * 0.75) / 1024);
      return {
        output: `Saved ${path} (${ratio}, ${kilobytes} KB), made with ${choice.name}. Import that path in a component and use it as the image source.`,
        step: { status: 'done', path },
      };
    },
  };
}
