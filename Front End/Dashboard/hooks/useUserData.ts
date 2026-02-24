import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebaseConfig';
import { useAuth } from '../context/AuthContext';

interface ApiKeys {
  gemini: string[];
  openai: string[];
  anthropic: string[];
}

interface UserSettings {
  modelConfig: {
    gemini: { 
      model: string; 
      thinkingLevel: number;
      savedModels: Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>;
    };
    openai: { 
      model: string;
      thinkingLevel: number;
      savedModels: Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>;
    };
    anthropic: { 
      model: string;
      thinkingLevel: number;
      savedModels: Array<{ id: string; name: string; thinkingLevel: number; modelId: string }>;
    };
  };
  selectedModelId: string;
  agentSwarmEnabled: boolean;
}

interface UserData {
  apiKeys: ApiKeys;
  settings: UserSettings;
}

const DEFAULT_API_KEYS: ApiKeys = {
  gemini: [],
  openai: [],
  anthropic: []
};

const DEFAULT_SETTINGS: UserSettings = {
  modelConfig: {
    gemini: { model: 'gemini-3-pro', thinkingLevel: 1, savedModels: [] },
    openai: { model: 'gpt-5.2-thinking', thinkingLevel: 2, savedModels: [] },
    anthropic: { model: 'claude-sonnet-4.5', thinkingLevel: 2, savedModels: [] }
  },
  selectedModelId: '',
  agentSwarmEnabled: false,
};

export const useUserData = () => {
  const { user } = useAuth();
  
  // Initialize from localStorage synchronously for instant availability
  const getInitialApiKeys = (): ApiKeys => {
    if (typeof window === 'undefined') return DEFAULT_API_KEYS;
    
    const mapProviderState = (ps: any): ApiKeys => {
      if (!ps) return DEFAULT_API_KEYS;
      return {
        gemini: (ps.geminiKeys || []).length > 0 
          ? ((ps.geminiKeys.some((k: any) => k.isActive) ? ps.geminiKeys.filter((k: any) => k.isActive) : [ps.geminiKeys[0]])).map((k: any) => k.key)
          : [],
        openai: (ps.openaiKeys || []).length > 0
          ? ((ps.openaiKeys.some((k: any) => k.isActive) ? ps.openaiKeys.filter((k: any) => k.isActive) : [ps.openaiKeys[0]])).map((k: any) => k.key)
          : [],
        anthropic: (ps.anthropicKeys || []).length > 0
          ? ((ps.anthropicKeys.some((k: any) => k.isActive) ? ps.anthropicKeys.filter((k: any) => k.isActive) : [ps.anthropicKeys[0]])).map((k: any) => k.key)
          : []
      };
    };
    
    try {
      const localProviderState = localStorage.getItem('providerState');
      if (localProviderState) return mapProviderState(JSON.parse(localProviderState));
      
      const localApiKeys = localStorage.getItem('apiKeys');
      if (localApiKeys) return JSON.parse(localApiKeys);
    } catch {}
    
    return DEFAULT_API_KEYS;
  };
  
  const [apiKeys, setApiKeysState] = useState<ApiKeys>(getInitialApiKeys);
  const [settings, setSettingsState] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false); // Changed to false - keys already loaded from localStorage
  const [synced, setSynced] = useState(false);

  // Ref to avoid stale closure in callbacks while keeping deps stable
  const apiKeysRef = useRef(apiKeys);
  apiKeysRef.current = apiKeys;

  // Load user data from Firestore
  useEffect(() => {
    const loadUserData = async () => {
      const mapProviderState = (ps: any): ApiKeys => {
        if (!ps) return DEFAULT_API_KEYS;
        return {
          gemini: (ps.geminiKeys || []).length > 0 
            ? ((ps.geminiKeys.some((k: any) => k.isActive) ? ps.geminiKeys.filter((k: any) => k.isActive) : [ps.geminiKeys[0]])).map((k: any) => k.key)
            : [],
          openai: (ps.openaiKeys || []).length > 0
            ? ((ps.openaiKeys.some((k: any) => k.isActive) ? ps.openaiKeys.filter((k: any) => k.isActive) : [ps.openaiKeys[0]])).map((k: any) => k.key)
            : [],
          anthropic: (ps.anthropicKeys || []).length > 0
            ? ((ps.anthropicKeys.some((k: any) => k.isActive) ? ps.anthropicKeys.filter((k: any) => k.isActive) : [ps.anthropicKeys[0]])).map((k: any) => k.key)
            : []
        };
      };

      if (!user) {
        // Load from localStorage for anonymous users
        const localApiKeys = localStorage.getItem('apiKeys');
        const localSettings = localStorage.getItem('userSettings');
        const localProviderState = localStorage.getItem('providerState');
        
        if (localProviderState) {
          setApiKeysState(mapProviderState(JSON.parse(localProviderState)));
        } else if (localApiKeys) {
          setApiKeysState(JSON.parse(localApiKeys));
        }

        if (localSettings) setSettingsState(JSON.parse(localSettings));
        
        setLoading(false);
        setSynced(false);
        return;
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          
          if (data.providerState) {
            setApiKeysState(mapProviderState(data.providerState));
          } else if (data.apiKeys) {
            setApiKeysState(data.apiKeys);
          } else {
            setApiKeysState(DEFAULT_API_KEYS);
          }
          
          setSettingsState(data.settings || DEFAULT_SETTINGS);
        } else {
          // Create new user document
          await setDoc(userDocRef, {
            apiKeys: DEFAULT_API_KEYS,
            settings: DEFAULT_SETTINGS,
            createdAt: new Date().toISOString()
          });
        }
        setSynced(true);
      } catch (error) {
        console.error('Error loading user data:', error);
        // Fall back to localStorage
        const localApiKeys = localStorage.getItem('apiKeys');
        const localSettings = localStorage.getItem('userSettings');
        const localProviderState = localStorage.getItem('providerState');
        
        if (localProviderState) {
          setApiKeysState(mapProviderState(JSON.parse(localProviderState)));
        } else if (localApiKeys) {
          setApiKeysState(JSON.parse(localApiKeys));
        }

        if (localSettings) setSettingsState(JSON.parse(localSettings));
        setSynced(false);
      } finally {
        setLoading(false);
      }
    };

    loadUserData();
  }, [user]);

  // Save API keys
  const saveApiKeys = useCallback(async (newApiKeys: ApiKeys) => {
    setApiKeysState(newApiKeys);
    localStorage.setItem('apiKeys', JSON.stringify(newApiKeys));

    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, { apiKeys: newApiKeys });
        setSynced(true);
      } catch (error) {
        console.error('Error saving API keys:', error);
        setSynced(false);
      }
    }
  }, [user]);

  // Save settings
  const saveSettings = useCallback(async (newSettings: UserSettings) => {
    setSettingsState(newSettings);
    localStorage.setItem('userSettings', JSON.stringify(newSettings));

    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, { settings: newSettings });
        setSynced(true);
      } catch (error) {
        console.error('Error saving settings:', error);
        setSynced(false);
      }
    }
  }, [user]);

  // Add a single API key
  const addApiKey = useCallback(async (provider: keyof ApiKeys, key: string) => {
    const newApiKeys = {
      ...apiKeysRef.current,
      [provider]: [...apiKeysRef.current[provider], key]
    };
    setApiKeysState(newApiKeys);
    localStorage.setItem('apiKeys', JSON.stringify(newApiKeys));
    if (user) {
      const userDocRef = doc(db, 'users', user.uid);
      updateDoc(userDocRef, { apiKeys: newApiKeys }).catch(console.error);
    }
  }, [user]);

  // Remove a single API key
  const removeApiKey = useCallback(async (provider: keyof ApiKeys, key: string) => {
    const newApiKeys = {
      ...apiKeysRef.current,
      [provider]: apiKeysRef.current[provider].filter(k => k !== key)
    };
    setApiKeysState(newApiKeys);
    localStorage.setItem('apiKeys', JSON.stringify(newApiKeys));
    if (user) {
      const userDocRef = doc(db, 'users', user.uid);
      updateDoc(userDocRef, { apiKeys: newApiKeys }).catch(console.error);
    }
  }, [user]);

  return useMemo(() => ({
    apiKeys,
    settings,
    loading,
    synced,
    saveApiKeys,
    saveSettings,
    addApiKey,
    removeApiKey,
    isLoggedIn: !!user
  }), [apiKeys, settings, loading, synced, saveApiKeys, saveSettings, addApiKey, removeApiKey, user]);
};
