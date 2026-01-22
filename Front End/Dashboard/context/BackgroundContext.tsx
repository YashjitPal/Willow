import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type BackgroundType = 'waves' | 'lines' | 'solid';

interface BackgroundContextType {
  background: BackgroundType;
  setBackground: (bg: BackgroundType) => void;
}

const BackgroundContext = createContext<BackgroundContextType | undefined>(undefined);

const STORAGE_KEY = 'dashboard-background';

export const BackgroundProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, userProfile, updateUserProfile } = useAuth();
  
  const [background, setBackgroundState] = useState<BackgroundType>(() => {
    // Load from localStorage on init (fallback for non-authenticated users)
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved as BackgroundType) || 'waves'; // Default to waves
  });

  // Sync with userProfile when authenticated
  useEffect(() => {
    if (user && userProfile?.background) {
      setBackgroundState(userProfile.background);
    }
  }, [user, userProfile?.background]);

  const setBackground = async (bg: BackgroundType) => {
    setBackgroundState(bg);
    localStorage.setItem(STORAGE_KEY, bg);
    
    // If authenticated, also save to Firestore
    if (user) {
      await updateUserProfile({ background: bg });
    }
  };

  return (
    <BackgroundContext.Provider value={{ background, setBackground }}>
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
