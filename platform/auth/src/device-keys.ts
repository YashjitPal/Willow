/*
 * API keys belong to this device, not to whoever is signed in.
 *
 * Signing in is optional — nothing Willow runs needs an account — so a key typed
 * signed out has to keep working after signing in, and the other way round.
 * Keys used to sit in one slot per account (`willow:apiKeys:<uid>`) plus one for
 * signed out (`…:guest`), which made signing out look like every key had been
 * deleted: the guest slot was empty and no model would run.
 *
 * `providerState` is the record (raw field text and endpoint per provider);
 * `apiKeys` is the same keys split into lists, written alongside it.
 */
export const DEVICE_KEY_SLOT = {
  providerState: 'willow:providerState:device',
  apiKeys: 'willow:apiKeys:device',
} as const;

const PROVIDERS = ['gemini', 'openai', 'anthropic', 'moonshot', 'spacexai', 'zhipuai'] as const;
const ACCOUNT_SLOT_PREFIXES = ['willow:providerState:', 'willow:apiKeys:'] as const;

type Slot = Record<string, unknown>;

const readSlot = (key: string): Slot | null => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value && typeof value === 'object' ? value as Slot : null;
  } catch {
    return null;
  }
};

const fieldText = (state: Slot | null, provider: string): string => {
  const apiKey = (state?.[provider] as Slot | undefined)?.apiKey;
  return typeof apiKey === 'string' ? apiKey.trim() : '';
};

const listedKeys = (keys: Slot | null, provider: string): string[] => {
  const list = keys?.[provider];
  return Array.isArray(list) ? list.filter((key): key is string => typeof key === 'string' && key.trim() !== '') : [];
};

export const splitDeviceKeys = (value: string): string[] => value
  .split(/[\r\n,]+/)
  .map((key) => key.trim())
  .filter(Boolean);

/**
 * Fill the device slot from the per-account slots older builds wrote, then
 * delete those so a key removed here is not still sitting under an old name.
 *
 * Merged per provider, in order: the account signed in now, signed out's, then
 * any other account this browser has held — so no key anyone typed goes
 * missing. Runs until it has something to adopt; once the device slot exists,
 * even emptied by the user, it is the only copy and this does nothing.
 */
export const adoptAccountKeys = (currentUid?: string | null): void => {
  try {
    if (localStorage.getItem(DEVICE_KEY_SLOT.providerState) !== null
      || localStorage.getItem(DEVICE_KEY_SLOT.apiKeys) !== null) return;

    const scopes = [currentUid, 'guest'].filter((scope): scope is string => Boolean(scope));
    const accountSlots: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const prefix = key ? ACCOUNT_SLOT_PREFIXES.find((candidate) => key.startsWith(candidate)) : undefined;
      if (!key || !prefix) continue;
      accountSlots.push(key);
      const scope = key.slice(prefix.length);
      if (!scopes.includes(scope)) scopes.push(scope);
    }
    if (accountSlots.length === 0) return;

    const merged: Slot = {};
    for (const scope of scopes) {
      const state = readSlot(`willow:providerState:${scope}`);
      const keys = readSlot(`willow:apiKeys:${scope}`);
      for (const provider of PROVIDERS) {
        if (fieldText(merged, provider)) continue;
        const apiKey = fieldText(state, provider) || listedKeys(keys, provider).join(', ');
        const config = state?.[provider] as Slot | undefined;
        if (!apiKey && (merged[provider] || !config)) continue;
        merged[provider] = { ...config, apiKey };
      }
      if (merged.activeProvider === undefined && typeof state?.activeProvider === 'string') {
        merged.activeProvider = state.activeProvider;
      }
    }
    if (Object.keys(merged).length === 0) return;

    localStorage.setItem(DEVICE_KEY_SLOT.providerState, JSON.stringify(merged));
    localStorage.setItem(DEVICE_KEY_SLOT.apiKeys, JSON.stringify(Object.fromEntries(
      PROVIDERS.map((provider) => [provider, splitDeviceKeys(fieldText(merged, provider))]),
    )));
    for (const key of accountSlots) localStorage.removeItem(key);
  } catch {
    // Storage unavailable: there is nothing to adopt from either.
  }
};
