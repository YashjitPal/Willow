import React, { createContext, useContext, ReactNode } from 'react';
import { useUserData } from './use-user-data';

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

interface UserDataContextType {
  apiKeys: ApiKeys;
  settings: UserSettings;
  loading: boolean;
  synced: boolean;
  saveApiKeys: (newApiKeys: ApiKeys) => Promise<void>;
  saveSettings: (newSettings: UserSettings) => Promise<void>;
  addApiKey: (provider: keyof ApiKeys, key: string) => Promise<void>;
  removeApiKey: (provider: keyof ApiKeys, key: string) => Promise<void>;
  isLoggedIn: boolean;
}

const UserDataContext = createContext<UserDataContextType | null>(null);

export const UserDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const userData = useUserData();

  return (
    <UserDataContext.Provider value={userData}>
      {children}
    </UserDataContext.Provider>
  );
};

export const useUserDataContext = () => {
  const context = useContext(UserDataContext);
  if (!context) {
    throw new Error('useUserDataContext must be used within a UserDataProvider');
  }
  return context;
};
