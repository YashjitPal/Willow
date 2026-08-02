import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';

interface ApiKeys {
  gemini: string[];
  openai: string[];
  anthropic: string[];
  moonshot?: string[];
  spacexai?: string[];
  zhipuai?: string[];
}

interface UserSettings {
  modelConfig: {
    gemini: { 
      model: string; 
      thinkingLevel: number;
      savedModels: Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>;
    };
    openai: { 
      model: string;
      thinkingLevel: number;
      savedModels: Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>;
    };
    anthropic: { 
      model: string;
      thinkingLevel: number;
      savedModels: Array<{ id: string; name: string; thinkingLevel: number; thinkingLabel?: string; effortLabel?: string; modelId: string }>;
    };
  };
  selectedModelId: string;
}

interface UserData {
  apiKeys: ApiKeys;
  settings: UserSettings;
}

const DEFAULT_API_KEYS: ApiKeys = {
  gemini: [],
  openai: [],
  anthropic: [],
  moonshot: [],
  spacexai: [],
  zhipuai: []
};

const DEFAULT_SETTINGS: UserSettings = {
  modelConfig: {
    gemini: { model: 'gemini-3-pro', thinkingLevel: 1, savedModels: [] },
    openai: { model: 'gpt-5.2-thinking', thinkingLevel: 2, savedModels: [] },
    anthropic: { model: 'claude-sonnet-4.5', thinkingLevel: 2, savedModels: [] }
  },
  selectedModelId: '',
};

const getUserStorageKeys = (uid: string) => ({
  apiKeys: `willow:apiKeys:${uid}`,
  providerState: `willow:providerState:${uid}`,
  settings: `willow:userSettings:${uid}`,
});

const mapProviderState = (providerState: any): ApiKeys => {
  if (!providerState) return DEFAULT_API_KEYS;

  const extractKey = (newSchemaConfig: any, oldSchemaKeys: any) => {
    if (typeof newSchemaConfig?.apiKey === 'string' && newSchemaConfig.apiKey) {
      return newSchemaConfig.apiKey
        .split(/[\r\n,]+/)
        .map((key: string) => key.trim())
        .filter(Boolean);
    }

    const keys = Array.isArray(oldSchemaKeys) ? oldSchemaKeys : [];
    if (keys.length === 0) return [];
    const selectedKeys = keys.some((key: any) => key?.isActive)
      ? keys.filter((key: any) => key?.isActive)
      : [keys[0]];
    return selectedKeys
      .map((key: any) => key?.key)
      .filter((key: unknown): key is string => typeof key === 'string' && key.length > 0);
  };

  return {
    gemini: extractKey(providerState.gemini, providerState.geminiKeys),
    openai: extractKey(providerState.openai, providerState.openaiKeys),
    anthropic: extractKey(providerState.anthropic, providerState.anthropicKeys),
    moonshot: extractKey(providerState.moonshot, []),
    spacexai: extractKey(providerState.spacexai, []),
    zhipuai: extractKey(providerState.zhipuai, []),
  };
};

const normalizeApiKeys = (value: unknown): ApiKeys | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ApiKeys>;
  const normalizeProviderKeys = (keys: unknown) => (
    Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []
  );

  return {
    gemini: normalizeProviderKeys(candidate.gemini),
    openai: normalizeProviderKeys(candidate.openai),
    anthropic: normalizeProviderKeys(candidate.anthropic),
    moonshot: normalizeProviderKeys(candidate.moonshot),
    spacexai: normalizeProviderKeys(candidate.spacexai),
    zhipuai: normalizeProviderKeys(candidate.zhipuai),
  };
};

const readCachedApiKeys = (uid: string | null): ApiKeys => {
  if (!uid || typeof window === 'undefined') return DEFAULT_API_KEYS;

  try {
    const keys = getUserStorageKeys(uid);
    const serializedApiKeys = sessionStorage.getItem(keys.apiKeys);
    if (serializedApiKeys) {
      const cachedApiKeys = normalizeApiKeys(JSON.parse(serializedApiKeys));
      if (cachedApiKeys) return cachedApiKeys;
      sessionStorage.removeItem(keys.apiKeys);
    }

    const serializedProviderState = sessionStorage.getItem(keys.providerState);
    if (serializedProviderState) {
      return mapProviderState(JSON.parse(serializedProviderState));
    }
  } catch (error) {
    console.warn('[UserData] Ignoring invalid API-key cache:', error);
  }

  return DEFAULT_API_KEYS;
};

const cacheApiKeys = (uid: string, apiKeys: ApiKeys) => {
  try {
    sessionStorage.setItem(getUserStorageKeys(uid).apiKeys, JSON.stringify(apiKeys));
  } catch (error) {
    console.warn('[UserData] Unable to cache API keys for this tab:', error);
  }
};

const readCachedSettings = (uid: string | null): UserSettings => {
  if (!uid || typeof window === 'undefined') return DEFAULT_SETTINGS;

  try {
    const serializedSettings = sessionStorage.getItem(getUserStorageKeys(uid).settings);
    if (serializedSettings) return JSON.parse(serializedSettings) as UserSettings;
  } catch (error) {
    console.warn('[UserData] Ignoring invalid settings cache:', error);
  }

  return DEFAULT_SETTINGS;
};

const cacheSettings = (uid: string, settings: UserSettings) => {
  try {
    sessionStorage.setItem(getUserStorageKeys(uid).settings, JSON.stringify(settings));
  } catch (error) {
    console.warn('[UserData] Unable to cache settings for this tab:', error);
  }
};

export const useUserData = () => {
  const { user } = useAuth();
  const userId = user?.uid ?? null;

  const [apiKeys, setApiKeysState] = useState<ApiKeys>(() => readCachedApiKeys(userId));
  const [apiKeysOwnerUid, setApiKeysOwnerUid] = useState<string | null>(userId);
  const [settings, setSettingsState] = useState<UserSettings>(() => readCachedSettings(userId));
  const [settingsOwnerUid, setSettingsOwnerUid] = useState<string | null>(userId);
  const [loading, setLoading] = useState(Boolean(userId));
  const [synced, setSynced] = useState(false);

  // Keep mutation sources synchronous so back-to-back add/remove calls cannot
  // derive from a render that predates the preceding operation.
  const apiKeysRef = useRef(apiKeys);
  const apiKeysOwnerUidRef = useRef<string | null>(userId);
  const currentUserIdRef = useRef(userId);
  currentUserIdRef.current = userId;
  const loadGenerationRef = useRef(0);
  const apiKeysSyncGenerationRef = useRef(0);
  const settingsSyncGenerationRef = useRef(0);
  const apiKeysDirtyRef = useRef(false);
  const settingsDirtyRef = useRef(false);
  const apiKeysSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const publishSyncState = useCallback((uid: string) => {
    if (currentUserIdRef.current === uid) {
      setSynced(!apiKeysDirtyRef.current && !settingsDirtyRef.current);
    }
  }, []);

  const setOwnedApiKeys = useCallback((uid: string | null, nextApiKeys: ApiKeys) => {
    apiKeysRef.current = nextApiKeys;
    apiKeysOwnerUidRef.current = uid;
    setApiKeysOwnerUid(uid);
    setApiKeysState(nextApiKeys);
  }, []);

  const setOwnedSettings = useCallback((uid: string | null, nextSettings: UserSettings) => {
    setSettingsOwnerUid(uid);
    setSettingsState(nextSettings);
  }, []);

  // Legacy unscoped caches cannot be attributed to an account. Remove them
  // without importing their secrets into whichever account happens to load.
  useEffect(() => {
    try {
      localStorage.removeItem('providerState');
      localStorage.removeItem('apiKeys');
      localStorage.removeItem('userSettings');
    } catch (error) {
      console.warn('[UserData] Unable to remove legacy unscoped caches:', error);
    }
  }, []);

  // Listen for API key updates from SettingsModal's UID-scoped tab cache.
  useEffect(() => {
    const handleApiKeysUpdated = () => {
      const uid = currentUserIdRef.current;
      if (!uid) return;
      apiKeysSyncGenerationRef.current += 1;
      setOwnedApiKeys(uid, readCachedApiKeys(uid));
    };
    window.addEventListener('apikeys-updated', handleApiKeysUpdated);
    return () => window.removeEventListener('apikeys-updated', handleApiKeysUpdated);
  }, [setOwnedApiKeys]);

  // Load user data from Firestore
  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    // Invalidate completions from an earlier account, including A -> B -> A
    // switches where the UID alone would otherwise look current again.
    const apiKeysGenerationAtLoad = ++apiKeysSyncGenerationRef.current;
    const settingsGenerationAtLoad = ++settingsSyncGenerationRef.current;
    const uid = userId;

    apiKeysDirtyRef.current = false;
    settingsDirtyRef.current = false;
    setSynced(false);
    setOwnedApiKeys(uid, readCachedApiKeys(uid));
    setOwnedSettings(uid, readCachedSettings(uid));

    const loadUserData = async () => {
      if (!uid) {
        if (loadGenerationRef.current === generation) {
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const userDocRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userDocRef);

        if (loadGenerationRef.current !== generation || currentUserIdRef.current !== uid) return;

        if (userDoc.exists()) {
          const data = userDoc.data();

          if (
            apiKeysSyncGenerationRef.current === apiKeysGenerationAtLoad &&
            !apiKeysDirtyRef.current
          ) {
            const remoteApiKeys = data.providerState
              ? mapProviderState(data.providerState)
              : normalizeApiKeys(data.apiKeys) || DEFAULT_API_KEYS;
            setOwnedApiKeys(uid, remoteApiKeys);
            cacheApiKeys(uid, remoteApiKeys);
          }

          if (
            settingsSyncGenerationRef.current === settingsGenerationAtLoad &&
            !settingsDirtyRef.current
          ) {
            const remoteSettings = (data.settings || DEFAULT_SETTINGS) as UserSettings;
            setOwnedSettings(uid, remoteSettings);
            cacheSettings(uid, remoteSettings);
          }
        } else {
          // Merge defaults so a concurrent profile or settings write cannot be
          // erased while this initial read is in flight. Omit any field that a
          // user edit has already superseded.
          const initialDocument: Record<string, unknown> = {
            createdAt: new Date().toISOString(),
          };
          if (
            apiKeysSyncGenerationRef.current === apiKeysGenerationAtLoad &&
            !apiKeysDirtyRef.current
          ) {
            initialDocument.apiKeys = DEFAULT_API_KEYS;
          }
          if (
            settingsSyncGenerationRef.current === settingsGenerationAtLoad &&
            !settingsDirtyRef.current
          ) {
            initialDocument.settings = DEFAULT_SETTINGS;
          }
          await setDoc(userDocRef, initialDocument, { merge: true });
          if (loadGenerationRef.current !== generation || currentUserIdRef.current !== uid) return;
        }
        publishSyncState(uid);
      } catch (error) {
        if (loadGenerationRef.current !== generation || currentUserIdRef.current !== uid) return;
        console.error('Error loading user data:', error);
        // The UID-scoped session cache was already installed before the read.
        // Keep any pending local edit intact and report that cloud sync failed.
        setSynced(false);
      } finally {
        if (loadGenerationRef.current === generation && currentUserIdRef.current === uid) {
          setLoading(false);
        }
      }
    };

    void loadUserData();
    return () => {
      if (loadGenerationRef.current === generation) {
        loadGenerationRef.current += 1;
      }
    };
  }, [publishSyncState, setOwnedApiKeys, setOwnedSettings, userId]);

  // Save API keys
  const saveApiKeys = useCallback(async (newApiKeys: ApiKeys) => {
    const uid = userId;
    if (currentUserIdRef.current !== uid) {
      throw new Error('The active account changed before API keys could be saved.');
    }

    setOwnedApiKeys(uid, newApiKeys);
    if (uid) cacheApiKeys(uid, newApiKeys);

    if (uid) {
      const generation = ++apiKeysSyncGenerationRef.current;
      apiKeysDirtyRef.current = true;
      setSynced(false);
      const operation = apiKeysSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const userDocRef = doc(db, 'users', uid);
          await setDoc(userDocRef, { apiKeys: newApiKeys }, { merge: true });
          if (apiKeysSyncGenerationRef.current === generation && currentUserIdRef.current === uid) {
            apiKeysDirtyRef.current = false;
            publishSyncState(uid);
          }
        })
        .catch((error) => {
          console.error('Error saving API keys:', error);
          if (apiKeysSyncGenerationRef.current === generation && currentUserIdRef.current === uid) {
            apiKeysDirtyRef.current = true;
            publishSyncState(uid);
          }
          throw error;
        });
      apiKeysSaveQueueRef.current = operation.catch(() => undefined);
      await operation;
    } else {
      setSynced(false);
    }
  }, [publishSyncState, setOwnedApiKeys, userId]);

  // Save settings
  const saveSettings = useCallback(async (newSettings: UserSettings) => {
    const uid = userId;
    if (currentUserIdRef.current !== uid) {
      throw new Error('The active account changed before settings could be saved.');
    }

    setOwnedSettings(uid, newSettings);
    if (uid) cacheSettings(uid, newSettings);

    if (uid) {
      const generation = ++settingsSyncGenerationRef.current;
      settingsDirtyRef.current = true;
      setSynced(false);
      const operation = settingsSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const userDocRef = doc(db, 'users', uid);
          await setDoc(userDocRef, { settings: newSettings }, { merge: true });
          if (settingsSyncGenerationRef.current === generation && currentUserIdRef.current === uid) {
            settingsDirtyRef.current = false;
            publishSyncState(uid);
          }
        })
        .catch((error) => {
          console.error('Error saving settings:', error);
          if (settingsSyncGenerationRef.current === generation && currentUserIdRef.current === uid) {
            settingsDirtyRef.current = true;
            publishSyncState(uid);
          }
          throw error;
        });
      settingsSaveQueueRef.current = operation.catch(() => undefined);
      await operation;
    } else {
      setSynced(false);
    }
  }, [publishSyncState, setOwnedSettings, userId]);

  // Add a single API key
  const addApiKey = useCallback(async (provider: keyof ApiKeys, key: string) => {
    const currentApiKeys = apiKeysOwnerUidRef.current === userId
      ? apiKeysRef.current
      : DEFAULT_API_KEYS;
    const newApiKeys = {
      ...currentApiKeys,
      [provider]: [...currentApiKeys[provider], key]
    };
    await saveApiKeys(newApiKeys);
  }, [saveApiKeys, userId]);

  // Remove a single API key
  const removeApiKey = useCallback(async (provider: keyof ApiKeys, key: string) => {
    const currentApiKeys = apiKeysOwnerUidRef.current === userId
      ? apiKeysRef.current
      : DEFAULT_API_KEYS;
    const newApiKeys = {
      ...currentApiKeys,
      [provider]: currentApiKeys[provider].filter(k => k !== key)
    };
    await saveApiKeys(newApiKeys);
  }, [saveApiKeys, userId]);

  const visibleApiKeys = apiKeysOwnerUid === userId ? apiKeys : DEFAULT_API_KEYS;
  const visibleSettings = settingsOwnerUid === userId ? settings : DEFAULT_SETTINGS;

  return useMemo(() => ({
    apiKeys: visibleApiKeys,
    settings: visibleSettings,
    loading,
    synced,
    saveApiKeys,
    saveSettings,
    addApiKey,
    removeApiKey,
    isLoggedIn: !!user
  }), [visibleApiKeys, visibleSettings, loading, synced, saveApiKeys, saveSettings, addApiKey, removeApiKey, user]);
};
