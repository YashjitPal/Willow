/*
 * API keys and endpoints for the six model providers.
 *
 * This used to live inside `SettingsModal`, as component state plus five refs.
 * It moved out when Models & API grew a second surface: the standalone
 * `/models-settings` page shows the same keys as the modal's Models tab, and the
 * modal stays mounted after its first open (see `hasOpenedSettings` in
 * `App.tsx`), so both surfaces are alive at once.
 *
 * Two components each holding their own copy of this would mean two of
 * everything, and — worse — two independent writers racing, where the loser's
 * stale snapshot silently overwrites a key the user just typed. So the state
 * lives here, at module scope, and `useProviderSettings` is only a
 * subscription to it.
 *
 * **Keys never leave the device.** They are written to `localStorage` and
 * nowhere else. Willow used to sync them to Firestore, which put a user's
 * third-party credentials in a database the project owner can read; the only
 * thing left of that is `ensureProviderStateLoaded`, which exists purely to
 * delete keys an older build already uploaded.
 */

import { atom } from 'nanostores';
import { DEFAULT_BASE_URLS, resolveBaseUrl, type ProviderId } from '@willow/ai/providers/endpoints';
import { DEFAULT_PROFILE_IDS } from '@willow/ai/providers/profiles';

export type ProviderConfig = { apiKey: string; baseUrl: string };

export type ProviderParams = {
  gemini: ProviderConfig;
  openai: ProviderConfig;
  anthropic: ProviderConfig;
  moonshot: ProviderConfig;
  spacexai: ProviderConfig;
  zhipuai: ProviderConfig;
  activeProvider: ProviderId;
};

/** The subset of a Firebase user this module needs. */
export type ProviderAuthUser = { uid: string; getIdToken: () => Promise<string> };

type ModelConfigSetter = (updater: (previous: any) => any) => void;

export const PROVIDER_IDS: ProviderId[] = ['gemini', 'openai', 'anthropic', 'moonshot', 'spacexai', 'zhipuai'];

const NON_DEFAULT_PROVIDERS = ['openai', 'anthropic', 'moonshot', 'spacexai', 'zhipuai'];

export const DEFAULT_PROVIDER_STATE: ProviderParams = {
  gemini: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.gemini },
  openai: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.openai },
  anthropic: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.anthropic },
  moonshot: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.moonshot },
  spacexai: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.spacexai },
  zhipuai: { apiKey: '', baseUrl: DEFAULT_BASE_URLS.zhipuai },
  activeProvider: 'gemini',
};

const GUEST_PROVIDER_SCOPE = 'guest';

const FIRESTORE_PROJECT_ID = 'willow-64095';

const getProviderStorageKeys = (scope: string) => ({
  providerState: `willow:providerState:${scope}`,
  apiKeys: `willow:apiKeys:${scope}`,
});

/** True when any provider in this state carries a key. */
const hasAnyKey = (state: ProviderParams): boolean =>
  PROVIDER_IDS.some((provider) => Boolean(state[provider]?.apiKey));

const normalizeProviderState = (value: unknown): ProviderParams | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ProviderParams>;
  const readConfig = (provider: ProviderId): ProviderConfig => {
    const config = candidate[provider as keyof ProviderParams] as Partial<ProviderConfig> | undefined;
    const fallback = DEFAULT_PROVIDER_STATE[provider as keyof ProviderParams] as ProviderConfig;
    return {
      apiKey: typeof config?.apiKey === 'string' ? config.apiKey : '',
      baseUrl: typeof config?.baseUrl === 'string' ? config.baseUrl : fallback.baseUrl,
    };
  };
  const activeProvider = candidate.activeProvider;

  return {
    gemini: readConfig('gemini'),
    openai: readConfig('openai'),
    anthropic: readConfig('anthropic'),
    moonshot: readConfig('moonshot'),
    spacexai: readConfig('spacexai'),
    zhipuai: readConfig('zhipuai'),
    activeProvider: NON_DEFAULT_PROVIDERS.includes(activeProvider || '') ? (activeProvider as ProviderId) : 'gemini',
  };
};

const migrateProviderStorage = (uid: string) => {
  try {
    const keys = getProviderStorageKeys(uid);

    /*
     * Recover the per-tab copy an older build wrote. The direction is
     * deliberately the reverse of what it used to be: sessionStorage was the
     * account cache back when Firestore held the real keys, so this is the last
     * chance to rescue them before the tab closes. localStorage wins a tie —
     * it is the live store now.
     */
    for (const key of [keys.providerState, keys.apiKeys]) {
      const perTabValue = sessionStorage.getItem(key);
      if (perTabValue !== null && localStorage.getItem(key) === null) {
        localStorage.setItem(key, perTabValue);
      }
      sessionStorage.removeItem(key);
    }
    // Unscoped legacy entries cannot be attributed to an account, so they are
    // dropped rather than imported into whichever account happens to load.
    localStorage.removeItem('providerState');
    localStorage.removeItem('apiKeys');
    sessionStorage.removeItem('providerState');
    sessionStorage.removeItem('apiKeys');
  } catch (error) {
    console.warn('[Settings] Unable to migrate provider cache:', error);
  }
};

const readCachedProviderState = (scope: string): ProviderParams | null => {
  try {
    const key = getProviderStorageKeys(scope).providerState;
    const serialized = localStorage.getItem(key);
    if (!serialized) return null;
    const state = normalizeProviderState(JSON.parse(serialized));
    if (!state) localStorage.removeItem(key);
    return state;
  } catch (error) {
    console.warn('[Settings] Ignoring invalid provider cache:', error);
    return null;
  }
};

const cacheProviderState = (scope: string, state: ProviderParams) => {
  try {
    const keys = getProviderStorageKeys(scope);
    localStorage.setItem(keys.providerState, JSON.stringify(state));
    localStorage.setItem(keys.apiKeys, JSON.stringify({
      gemini: state.gemini.apiKey ? [state.gemini.apiKey] : [],
      openai: state.openai.apiKey ? [state.openai.apiKey] : [],
      anthropic: state.anthropic.apiKey ? [state.anthropic.apiKey] : [],
      moonshot: state.moonshot.apiKey ? [state.moonshot.apiKey] : [],
      spacexai: state.spacexai.apiKey ? [state.spacexai.apiKey] : [],
      zhipuai: state.zhipuai.apiKey ? [state.zhipuai.apiKey] : [],
    }));
  } catch (error) {
    console.warn('[Settings] Unable to cache provider configuration:', error);
  }
};

/** The keys and endpoints every Models & API surface renders from. */
export const $providerState = atom<ProviderParams>(DEFAULT_PROVIDER_STATE);

/*
 * Bookkeeping that used to be refs on the modal. `scopeUid` is `undefined`
 * before the first scope is applied, which is distinct from the `null` that
 * means "signed out" — the reset below has to run for a signed-out boot too.
 */
let scopeUid: string | null | undefined = undefined;
let loadedScopeUid: string | null | undefined = undefined;
let editVersion = 0;
let loadController: AbortController | null = null;

/**
 * Delete both key fields from this account's Firestore document.
 *
 * A `PATCH` whose `updateMask` names a field the body omits deletes that field,
 * so this clears `providerState` and the legacy `apiKeys` array while leaving
 * `settings`, `createdAt` and the profile alone.
 */
const purgeRemotelyStoredKeys = async (uid: string, idToken: string) => {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${uid}`
    + '?updateMask.fieldPaths=providerState&updateMask.fieldPaths=apiKeys';

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: {} }),
  });

  if (!response.ok) throw new Error(`Firestore key purge failed (${response.status})`);
};

/**
 * Merge the resolved endpoints into `modelConfig`, which is where the streaming
 * layer reads them from.
 *
 * Every provider is included on purpose: one omitted from this merge silently
 * falls back to its official API even though Settings shows a custom gateway.
 */
const syncBaseUrlsIntoModelConfig = (state: ProviderParams, setModelConfig: ModelConfigSetter) => {
  setModelConfig((previous: any) => {
    const next = { ...previous };
    PROVIDER_IDS.forEach((provider) => {
      next[provider] = {
        ...previous[provider],
        baseUrl: resolveBaseUrl(provider, state[provider]?.baseUrl),
      };
    });
    next.providerProfiles = (previous.providerProfiles || []).map((profile: any) => {
      const provider = PROVIDER_IDS.find((candidate) => DEFAULT_PROFILE_IDS[candidate] === profile.id);
      return provider
        ? { ...profile, baseUrl: resolveBaseUrl(provider, state[provider]?.baseUrl), updatedAt: Date.now() }
        : profile;
    });
    return next;
  });
};

/**
 * Point the store at one account, clearing the previous account's keys.
 *
 * Called from a layout effect so the swap lands before the browser paints the
 * new account. Idempotent per uid: the second surface to mount sees its own
 * scope already applied and does nothing.
 */
export const resetProviderScope = (uid: string | null) => {
  if (scopeUid === uid) return;

  loadController?.abort();
  loadController = null;
  scopeUid = uid;
  loadedScopeUid = undefined;
  editVersion += 1;
  $providerState.set(DEFAULT_PROVIDER_STATE);

  if (uid) migrateProviderStorage(uid);
  // Local storage is the whole source of truth now, signed in or out — nothing
  // arrives later to fill this in.
  const cachedState = readCachedProviderState(uid ?? GUEST_PROVIDER_SCOPE);
  if (cachedState) $providerState.set(cachedState);
};

/**
 * Evict any keys an older build left in Firestore, once per account.
 *
 * Willow no longer syncs keys anywhere, but a user who ran an earlier build
 * still has theirs sitting in `users/{uid}` in plaintext. So this reads the
 * document one last time, adopts the keys locally if this device has none —
 * losing someone's keys to a privacy fix would be its own kind of rude — and
 * then deletes both key fields. Once that succeeds there is nothing left to
 * find, and every later call is a single 404 or an empty document.
 *
 * Uses the REST API rather than the SDK to sidestep its streaming listener, and
 * single-flights on uid so mounting a second Models & API surface does not refetch.
 */
export const ensureProviderStateLoaded = async (
  user: ProviderAuthUser | null,
  setModelConfig: ModelConfigSetter,
) => {
  const uid = user?.uid ?? null;
  if (scopeUid !== uid || loadedScopeUid === uid) return;
  loadedScopeUid = uid;
  if (!user) return;

  const controller = new AbortController();
  loadController = controller;
  const loadEditVersion = editVersion;

  const adoptRecoveredState = (recovered: ProviderParams) => {
    if (controller.signal.aborted || scopeUid !== uid || editVersion !== loadEditVersion) return;
    $providerState.set(recovered);
    cacheProviderState(uid, recovered);
    syncBaseUrlsIntoModelConfig(recovered, setModelConfig);
  };

  try {
    const idToken = await user.getIdToken();
    if (controller.signal.aborted) return;
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` },
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;

    // No document means no account ever wrote keys, so there is nothing to evict.
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Firestore load failed (${response.status})`);

    const data = await response.json();
    if (controller.signal.aborted) return;

    const ps = data.fields?.providerState?.mapValue?.fields;
    if (!ps && !data.fields?.apiKeys) return;

    if (ps) {
      const extractOldKey = (arr: any) => {
        if (!arr?.arrayValue?.values || arr.arrayValue.values.length === 0) return '';
        const values = arr.arrayValue.values;
        const selected = values.some((value: any) => value.mapValue.fields.isActive?.booleanValue)
          ? values.filter((value: any) => value.mapValue.fields.isActive?.booleanValue)
          : [values[0]];
        return selected
          .map((value: any) => value.mapValue.fields.key?.stringValue || '')
          .filter(Boolean)
          .join(', ');
      };

      const extractNewConfig = (field: any, oldKeysField: any, defaultBaseUrl: string): ProviderConfig => {
        if (field?.mapValue?.fields) {
          return {
            apiKey: field.mapValue.fields.apiKey?.stringValue || '',
            baseUrl: field.mapValue.fields.baseUrl?.stringValue || defaultBaseUrl,
          };
        }
        return { apiKey: extractOldKey(oldKeysField), baseUrl: defaultBaseUrl };
      };
      const activeProvider = ps.activeProvider?.stringValue;

      const recovered: ProviderParams = {
        gemini: extractNewConfig(ps.gemini, ps.geminiKeys, DEFAULT_BASE_URLS.gemini),
        openai: extractNewConfig(ps.openai, ps.openaiKeys, DEFAULT_BASE_URLS.openai),
        anthropic: extractNewConfig(ps.anthropic, ps.anthropicKeys, DEFAULT_BASE_URLS.anthropic),
        moonshot: extractNewConfig(ps.moonshot, null, DEFAULT_BASE_URLS.moonshot),
        spacexai: extractNewConfig(ps.spacexai, null, DEFAULT_BASE_URLS.spacexai),
        zhipuai: extractNewConfig(ps.zhipuai, null, DEFAULT_BASE_URLS.zhipuai),
        activeProvider: NON_DEFAULT_PROVIDERS.includes(activeProvider || '') ? (activeProvider as ProviderId) : 'gemini',
      };

      // Only adopt onto a device that has nothing. A key typed here is newer
      // than whatever the old build last uploaded, and must not be clobbered.
      if (hasAnyKey(recovered) && !hasAnyKey($providerState.get())) {
        adoptRecoveredState(recovered);
      }
    }

    await purgeRemotelyStoredKeys(uid, idToken);
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') {
      console.error('[Settings] Failed to evict remotely stored API keys:', error);
    }
    // A failed eviction must not latch: let the next mount try again, or the
    // keys stay in the database until the user happens to reload.
    if (loadedScopeUid === uid) loadedScopeUid = undefined;
  }
};

/** Write one provider's key and endpoint, everywhere they are read from. */
export const updateProviderConfig = async (
  provider: ProviderId,
  config: ProviderConfig,
  user: ProviderAuthUser | null,
  setModelConfig: ModelConfigSetter,
) => {
  const uid = user?.uid ?? null;
  if (scopeUid !== uid) return;

  const newState: ProviderParams = { ...$providerState.get(), [provider]: config };

  editVersion += 1;
  $providerState.set(newState);
  cacheProviderState(uid ?? GUEST_PROVIDER_SCOPE, newState);
  /*
   * Sync baseUrl into modelConfig so streaming callers can access it. This runs
   * unconditionally: when the field is cleared we must overwrite the previous
   * custom URL with the official default, otherwise the stale gateway stays live
   * even though the input looks empty.
   */
  setModelConfig((previous: any) => ({
    ...previous,
    [provider]: { ...previous[provider], baseUrl: resolveBaseUrl(provider, config.baseUrl) },
    providerProfiles: (previous.providerProfiles || []).map((profile: any) => profile.id === DEFAULT_PROFILE_IDS[provider]
      ? { ...profile, baseUrl: resolveBaseUrl(provider, config.baseUrl), updatedAt: Date.now() }
      : profile),
  }));
  window.dispatchEvent(new Event('apikeys-updated'));
};
