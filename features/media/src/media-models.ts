// What Media can generate with: the image, video and music models added in Settings → Models,
// the ids Google serves them under, and the limits Google's APIs enforce per model.

import { collectSavedModelsInCatalogOrder, getModelCategory, liveModelId, liveSavedModel } from '@willow/core/model-catalog';

export interface MediaModelOption {
  id: string;
  name: string;
}

export interface VideoModelOption extends MediaModelOption {
  /** The id the request names. */
  apiId: string;
}

export interface MediaModelLists {
  image: MediaModelOption[];
  video: VideoModelOption[];
  music: MediaModelOption[];
}

export type MediaModelKind = keyof MediaModelLists;

/** Settings' video models and the ids Google serves them under. */
export const VIDEO_MODEL_CATALOG: readonly VideoModelOption[] = [
  { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', apiId: 'veo-3.1-fast-generate-preview' },
  { id: 'veo-3.1', name: 'Veo 3.1', apiId: 'veo-3.1-generate-preview' },
  { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite', apiId: 'veo-3.1-lite-generate-preview' },
  { id: 'omni-flash', name: 'Gemini Omni Flash 1', apiId: 'gemini-omni-flash-preview' },
  { id: 'omni-flash-1.1', name: 'Gemini Omni Flash 1.1', apiId: 'gemini-omni-1.1-flash' },
];

/** A saved id outside the catalog is taken to be Google's own. */
export const videoApiModelId = (id: string): string =>
  VIDEO_MODEL_CATALOG.find((model) => model.id === id)?.apiId ?? id;

/** Omni Flash renders through the Interactions API; every other video model is a Veo long-running predict. */
export const isOmniFlashModel = (id: string): boolean => id.startsWith('omni-flash');

/** Veo takes 4, 6 or 8 seconds and rejects anything else; Omni Flash takes 3 to 10. */
export const videoDurationOptions = (id: string): string[] =>
  isOmniFlashModel(id) ? ['4s', '6s', '8s', '10s'] : ['4s', '6s', '8s'];

/** `duration` when the model takes it, otherwise the longest length it takes that is not longer. */
export const fitVideoDuration = (id: string, duration: string): string => {
  const options = videoDurationOptions(id);
  if (options.includes(duration)) return duration;
  const seconds = parseInt(duration, 10) || 0;
  return options.filter((option) => parseInt(option, 10) <= seconds).pop() ?? options[0];
};

const toOption = (model: { id?: string; modelId?: string; name?: string }): MediaModelOption => {
  const live = liveSavedModel(model);
  const id = liveModelId(live.modelId || live.id || '');
  return { id, name: live.name || id };
};

const uniqueById = <T extends MediaModelOption>(models: T[]): T[] =>
  models.filter((model, index) => model.id && models.findIndex((other) => other.id === model.id) === index);

/** The models added in Settings → Models, grouped by what they make, in the user's order. */
export const mediaModelLists = (modelConfig: unknown): MediaModelLists => {
  const saved = collectSavedModelsInCatalogOrder(modelConfig);
  return {
    image: uniqueById(saved.filter((model) => getModelCategory(model) === 'image').map(toOption)),
    video: uniqueById(saved
      .filter((model) => getModelCategory(model) === 'video')
      .map((model) => {
        const option = toOption(model);
        return { ...option, apiId: videoApiModelId(option.id) };
      })),
    // Music is generated with Lyria's request shape only; voice models make speech, not songs.
    music: uniqueById(saved
      .filter((model) => /lyria/i.test(`${model.modelId || model.id} ${model.name || ''}`))
      .map(toOption)),
  };
};

/** The remembered pick while it is still added, else the first added model, else '' for none. */
export const resolveModelPick = (pick: string, models: readonly MediaModelOption[]): string => {
  const live = liveModelId(pick);
  return models.some((model) => model.id === live) ? live : (models[0]?.id ?? '');
};

const picksKey = (scopeId: string) => `willow:media:modelPicks:v1:${(scopeId || 'signed-out').split('::')[0]}`;

const readPicks = (scopeId: string): Partial<Record<MediaModelKind, string>> => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(picksKey(scopeId)) : null;
    const picks = raw ? JSON.parse(raw) : null;
    return picks && typeof picks === 'object' ? picks : {};
  } catch {
    return {};
  }
};

export const readModelPick = (kind: MediaModelKind, scopeId: string): string => {
  const pick = readPicks(scopeId)[kind];
  return typeof pick === 'string' ? pick : '';
};

export const writeModelPick = (kind: MediaModelKind, id: string, scopeId: string): void => {
  try {
    localStorage.setItem(picksKey(scopeId), JSON.stringify({ ...readPicks(scopeId), [kind]: id }));
  } catch {
    // Storage full or blocked: the pick lasts until the page is closed.
  }
};
