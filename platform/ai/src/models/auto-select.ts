/**
 * Which of the user's saved models should run a background job, when the user
 * has not picked one themselves.
 *
 * Background jobs — building the Personal Intelligence profile, naming a chat —
 * are not the user's conversation. They run on the user's key, without being
 * asked for, and nobody is waiting on the answer. So the right model for them is
 * the cheapest one that can read and follow a format, and the wrong model is
 * whatever the user happens to chat with. A hardcoded id is also wrong: the user
 * may not hold a key for it, and it goes stale the moment a provider ships
 * something newer.
 *
 * This file answers the question from what the user actually has. It is pure —
 * a list in, one id out — so the settings screen and the builder can both ask it
 * and be guaranteed to agree about which model is in use.
 */

export type AutoSelectProvider = 'gemini' | 'openai' | 'anthropic';

/**
 * The stored value that means "keep choosing for me".
 *
 * Absence would work too, but a real value is easier to read in a settings blob
 * and lets the dropdown offer a way back after the user has pinned something.
 */
export const AUTO_MODEL = 'auto';

export interface SavedModelLike {
  modelId?: string;
  id?: string;
  name?: string;
  provider?: string;
}

export interface AutoSelection {
  modelId: string;
  provider: AutoSelectProvider;
  name?: string;
}

/**
 * Cheapest tier first, within each provider's own naming.
 *
 * These are the families the providers sell as small/medium/large, and the order
 * is what they charge for them. Anthropic's Fable is the exception: it is priced
 * below Haiku but sold for creative writing, so it sits last — a cheap model
 * that is bad at following a rigid output format is not a saving.
 *
 * Order matters within a list for another reason: matching walks it front to
 * back, so `flash-lite` has to come before `flash` or every Lite model would be
 * read as a Flash.
 */
const FAMILY_ORDER: Record<AutoSelectProvider, string[]> = {
  gemini: ['flash-lite', 'flash', 'pro'],
  openai: ['luna', 'terra', 'sol'],
  anthropic: ['haiku', 'sonnet', 'opus', 'fable'],
};

/**
 * Providers in price order, used only to break a tie between two models of the
 * same tier. Gemini's small tier undercuts the other two, and Anthropic's is the
 * dearest of the three.
 *
 * The list is also the set of providers this can return at all. Kimi, Grok and
 * GLM are missing on purpose: nothing that consumes this selection knows how to
 * send them a request, so offering them would produce a setting that silently
 * does nothing.
 */
const PROVIDER_ORDER: AutoSelectProvider[] = ['gemini', 'openai', 'anthropic'];

/**
 * Ids that name a model which cannot do the job, however cheap it is.
 *
 * The saved-model list is one flat list of everything the user added, which
 * includes image, video, music and voice models. Several of them carry a text
 * model's family name — `gemini-3.1-flash-lite-image`, `omni-flash` — so they
 * would otherwise rank as the cheapest thing available and win every time.
 */
const NON_TEXT = /(image|banana|veo|lyria|tts|audio|speech|embedding|omni|realtime|whisper|sora)/;

/** The provider a model id belongs to, by prefix. */
export const providerOfModelId = (modelId: string): AutoSelectProvider | null => {
  const id = modelId.toLowerCase();
  if (id.startsWith('gemini-')) return 'gemini';
  if (id.startsWith('claude-')) return 'anthropic';
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) return 'openai';
  return null;
};

/** Where a model sits in its provider's price list, or `null` if it is not a
 *  family this knows — an unknown family is not guessed at. */
const familyRank = (provider: AutoSelectProvider, modelId: string): number | null => {
  const id = modelId.toLowerCase();
  const families = FAMILY_ORDER[provider];
  for (let rank = 0; rank < families.length; rank += 1) {
    if (id.includes(families[rank])) return rank;
  }
  return null;
};

/**
 * The version number in a model id, as something comparable.
 *
 * Providers write the same number three ways — `3.5`, `4-5`, and a bare `5` —
 * and Anthropic suffixes a release date that would otherwise read as an enormous
 * version. Dropping the date first is what makes `claude-haiku-4-5-20251001`
 * come out as 4.5 rather than 4.520251001.
 */
const versionOf = (modelId: string): number => {
  const withoutDate = modelId.toLowerCase().replace(/-\d{6,}$/, '');
  const pair = withoutDate.match(/(\d+)[.-](\d+)(?!\d)/);
  if (pair) return Number(`${pair[1]}.${pair[2]}`);
  const single = withoutDate.match(/(\d+)/);
  return single ? Number(single[1]) : 0;
};

/**
 * Pick a model for a background job from the user's saved list.
 *
 * `hasKey` decides which providers count. A saved model whose provider has no
 * key is not a choice the user can actually run, and returning one would make
 * the settings screen name a model that never gets called.
 *
 * Returns `null` when nothing qualifies — a new install with no keys, or a user
 * running entirely on a provider this cannot send requests to. Callers treat
 * that as "no background job", not as an error.
 */
export const pickAutoModel = (
  models: SavedModelLike[],
  hasKey: (provider: AutoSelectProvider) => boolean,
): AutoSelection | null => {
  const ranked = models
    .map((model) => {
      const modelId = model.modelId || model.id;
      if (!modelId || NON_TEXT.test(modelId.toLowerCase())) return null;

      // Trust the id over a `provider` field the caller stapled on, so a model
      // filed under the wrong provider cannot be ranked against the wrong table.
      const provider = providerOfModelId(modelId);
      if (!provider || !hasKey(provider)) return null;

      const family = familyRank(provider, modelId);
      if (family === null) return null;

      return {
        modelId,
        provider,
        name: model.name,
        family,
        price: PROVIDER_ORDER.indexOf(provider),
        version: versionOf(modelId),
      };
    })
    .filter(Boolean) as Array<AutoSelection & { family: number; price: number; version: number }>;

  if (ranked.length === 0) return null;

  // Cheapest tier wins outright — a small model from a dear provider still beats
  // a large model from a cheap one. Provider price only separates two models of
  // the same tier, and the newest release wins last, within one family.
  ranked.sort((a, b) => (
    a.family - b.family
    || a.price - b.price
    || b.version - a.version
  ));

  const best = ranked[0];
  return { modelId: best.modelId, provider: best.provider, name: best.name };
};

/**
 * What a stored system-default setting resolves to right now.
 *
 * `AUTO_MODEL`, an empty value, or a pinned id whose provider has since lost its
 * key all fall through to a fresh automatic pick. That last case is the one worth
 * being careful about: a setting left pointing at a removed key should quietly
 * route somewhere that works rather than stopping the job forever.
 */
export const resolveAutoModel = (
  stored: string | undefined,
  models: SavedModelLike[],
  hasKey: (provider: AutoSelectProvider) => boolean,
): AutoSelection | null => {
  const pinned = stored?.trim();
  if (pinned && pinned !== AUTO_MODEL) {
    const provider = providerOfModelId(pinned);
    if (provider && hasKey(provider)) {
      const saved = models.find((model) => (model.modelId || model.id) === pinned);
      return { modelId: pinned, provider, name: saved?.name };
    }
  }
  return pickAutoModel(models, hasKey);
};
