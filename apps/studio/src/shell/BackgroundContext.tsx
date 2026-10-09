import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { DEVICE_BACKGROUND_KEY, useAuth } from '@willow/auth/AuthContext';

export type BackgroundType = 'waves' | 'lines' | 'solid';

interface BackgroundContextType {
  background: BackgroundType;
  setBackground: (bg: BackgroundType) => void;
}

const BackgroundContext = createContext<BackgroundContextType | undefined>(undefined);

const STORAGE_KEY = DEVICE_BACKGROUND_KEY;

export const BackgroundProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, userProfile, updateUserProfile } = useAuth();
  
  const [background, setBackgroundState] = useState<BackgroundType>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved as BackgroundType) || 'solid'; // Default to solid
  });

  // Signed in, the account's background wins and is kept on the device too, so
  // signing out shows the same one.
  useEffect(() => {
    if (user && userProfile?.background) {
      setBackgroundState(userProfile.background);
      try { localStorage.setItem(STORAGE_KEY, userProfile.background); } catch { /* ignore */ }
    }
  }, [user, userProfile?.background]);

  const setBackground = useCallback(async (bg: BackgroundType) => {
    setBackgroundState(bg);
    localStorage.setItem(STORAGE_KEY, bg);

    // If authenticated, also save to Firestore
    if (user) {
      await updateUserProfile({ background: bg });
    }
  }, [user, updateUserProfile]);

  const value = useMemo(() => ({ background, setBackground }), [background, setBackground]);

  return (
    <BackgroundContext.Provider value={value}>
      {children}
    </BackgroundContext.Provider>
  );
};

export const useBackground = (): BackgroundContextType => {
  const context = useContext(BackgroundContext);
  if (!context) {
    throw new Error('useBackground must be used within a BackgroundProvider');
  }
  return context;
};
