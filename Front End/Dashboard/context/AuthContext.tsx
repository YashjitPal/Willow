import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  User, 
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, googleProvider, driveProvider, db } from '../lib/firebaseConfig';

// User profile data stored in Firestore
interface UserProfile {
  displayName: string | null;
  photoURL: string | null;
  role: string | null;
  onboardingComplete: boolean;
  workspaceName: string | null;
  username: string | null;
  workspaceColor: 'green' | 'pink' | 'yellow' | 'orange';
  workspaceDescription: string | null;
  location: string | null;
  background: 'solid' | 'waves' | 'lines';
  theme: string | null;
  description: string | null; // User bio/description
}

// Export the interface for use in other components
export type { UserProfile };

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  error: string | null;
  accessToken: string | null;
  driveAccessToken: string | null;
  isDriveConnected: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  connectDrive: () => Promise<void>;
  disconnectDrive: () => void;
  clearError: () => void;
  updateUserProfile: (data: Partial<UserProfile>) => Promise<void>;
  completeOnboarding: (name: string, role: string, photoURL: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [isDriveConnected, setIsDriveConnected] = useState(false);

  // Fetch user profile from Firestore
  const fetchUserProfile = async (uid: string) => {
    try {
      const userDocRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserProfile({
          displayName: data.displayName || null,
          photoURL: data.photoURL || null,
          role: data.role || null,
          onboardingComplete: data.onboardingComplete || false,
          workspaceName: data.workspaceName || null,
          username: data.username || null,
          workspaceColor: data.workspaceColor || 'green',
        });
      } else {
        // New user - no profile yet
        setUserProfile({
          displayName: null,
          photoURL: null,
          role: null,
          onboardingComplete: false,
          workspaceName: null,
          username: null,
          workspaceColor: 'green',
        });
      }
    } catch (err) {
      console.error('[Auth] Error fetching user profile:', err);
      setUserProfile({
        displayName: null,
        photoURL: null,
        role: null,
        onboardingComplete: false,
        workspaceName: null,
        username: null,
        workspaceColor: 'green',
      });
    }
  };

  useEffect(() => {
    console.log('[Auth] Setting up auth state listener...');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('[Auth] State changed:', firebaseUser ? firebaseUser.email : 'No user');
      setUser(firebaseUser);
      
      if (firebaseUser) {
        await fetchUserProfile(firebaseUser.uid);
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
      
      // Clear tokens if user signs out
      if (!firebaseUser) {
        setAccessToken(null);
        setDriveAccessToken(null);
        setIsDriveConnected(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setError(null);
    try {
      console.log('[Auth] Starting Google sign-in with popup...');
      
      const result = await signInWithPopup(auth, googleProvider);
      console.log('[Auth] Google sign-in successful:', result.user.email);
      
      // Get the Google OAuth access token (basic, no Drive access)
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        console.log('[Auth] Got Google access token');
        setAccessToken(credential.accessToken);
        localStorage.setItem('googleAccessToken', credential.accessToken);
      }
    } catch (err: any) {
      console.error('[Auth] Google sign-in error:', err.code, err.message);
      
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled. If this keeps happening, try signing in with email instead, or try a different browser.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Popup was blocked. Please allow popups for this site.');
      } else if (err.code === 'auth/cancelled-popup-request') {
        return;
      } else {
        setError(err.message || 'Sign-in failed. Please try again.');
      }
      throw err;
    }
  };

  const connectDrive = async () => {
    setError(null);
    try {
      console.log('[Auth] Starting Google Drive connection...');
      
      // If user is logged in with Google, use their email as login_hint to skip account selection
      if (user?.email) {
        driveProvider.setCustomParameters({
          login_hint: user.email,
          prompt: 'consent' // Still show consent for Drive permission
        });
      }
      
      const result = await signInWithPopup(auth, driveProvider);
      console.log('[Auth] Google Drive connection successful');
      
      // Get the Google OAuth access token with Drive scope
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        console.log('[Auth] Got Google Drive access token');
        setDriveAccessToken(credential.accessToken);
        setIsDriveConnected(true);
        localStorage.setItem('googleDriveAccessToken', credential.accessToken);
        localStorage.setItem('isDriveConnected', 'true');
      }
    } catch (err: any) {
      console.error('[Auth] Google Drive connection error:', err.code, err.message);
      
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Drive connection was cancelled.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Popup was blocked. Please allow popups for this site.');
      } else if (err.code === 'auth/cancelled-popup-request') {
        return;
      } else {
        setError(err.message || 'Drive connection failed. Please try again.');
      }
      throw err;
    }
  };

  const disconnectDrive = () => {
    setDriveAccessToken(null);
    setIsDriveConnected(false);
    localStorage.removeItem('googleDriveAccessToken');
    localStorage.removeItem('isDriveConnected');
    console.log('[Auth] Google Drive disconnected');
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      setAccessToken(null);
      setDriveAccessToken(null);
      setIsDriveConnected(false);
      setUserProfile(null);
      localStorage.removeItem('googleAccessToken');
      localStorage.removeItem('googleDriveAccessToken');
      localStorage.removeItem('isDriveConnected');
      setError(null);
      console.log('[Auth] Signed out successfully');
    } catch (err: any) {
      console.error('[Auth] Sign-out error:', err);
      setError(err.message || 'Sign-out failed');
      throw err;
    }
  };

  const clearError = () => setError(null);

  // Update user profile in Firestore
  const updateUserProfile = async (data: Partial<UserProfile>) => {
    if (!user) return;
    
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, data, { merge: true });
      
      setUserProfile(prev => prev ? { ...prev, ...data } : {
        displayName: data.displayName || null,
        photoURL: data.photoURL || null,
        role: data.role || null,
        onboardingComplete: data.onboardingComplete || false,
        workspaceName: data.workspaceName || null,
        username: data.username || null,
        workspaceColor: data.workspaceColor || 'green',
      });
      
      console.log('[Auth] User profile updated:', data);
    } catch (err) {
      console.error('[Auth] Error updating user profile:', err);
      throw err;
    }
  };

  // Complete onboarding - save all profile data with auto-generated fields
  const completeOnboarding = async (name: string, role: string, photoURL: string | null) => {
    if (!user) return;
    
    // Extract first name for workspace name
    const firstName = name.split(' ')[0];
    const workspaceName = `${firstName}'s Willow`;
    
    // Generate username from name (remove spaces)
    const username = name.replace(/\s+/g, '');
    
    await updateUserProfile({
      displayName: name,
      role: role,
      photoURL: photoURL,
      onboardingComplete: true,
      workspaceName: workspaceName,
      username: username,
      workspaceColor: 'green',
    });
  };

  // Restore tokens from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('googleAccessToken');
    if (storedToken) {
      setAccessToken(storedToken);
    }
    
    const storedDriveToken = localStorage.getItem('googleDriveAccessToken');
    const storedDriveConnected = localStorage.getItem('isDriveConnected');
    if (storedDriveToken && storedDriveConnected === 'true') {
      setDriveAccessToken(storedDriveToken);
      setIsDriveConnected(true);
    }
  }, []);

  const value: AuthContextType = {
    user,
    userProfile,
    loading,
    error,
    accessToken,
    driveAccessToken,
    isDriveConnected,
    signInWithGoogle,
    signOut,
    connectDrive,
    disconnectDrive,
    clearError,
    updateUserProfile,
    completeOnboarding,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
