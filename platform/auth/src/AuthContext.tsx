import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from 'react';
import { 
  User, 
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  reauthenticateWithPopup
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, googleProvider, driveProvider, db } from './firebase';

// User profile data stored in Firestore
interface UserProfile {
  displayName: string | null;
  photoURL: string | null;
  role: string | null;
  onboardingComplete: boolean;
  workspaceName: string | null;
  username: string | null;
  workspaceColor: 'green' | 'pink' | 'yellow' | 'orange' | 'blue';
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

const createEmptyUserProfile = (): UserProfile => ({
  displayName: null,
  photoURL: null,
  role: null,
  onboardingComplete: false,
  workspaceName: null,
  username: null,
  workspaceColor: 'green',
  workspaceDescription: null,
  location: null,
  background: 'solid',
  theme: null,
  description: null,
});

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
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const authGenerationRef = useRef(0);
  const activeAuthUidRef = useRef<string | null>(null);

  // Fetch user profile from Firestore
  const fetchUserProfile = useCallback(async (uid: string): Promise<UserProfile> => {
    try {
      const userDocRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        return {
          displayName: data.displayName || null,
          photoURL: data.photoURL || null,
          role: data.role || null,
          onboardingComplete: data.onboardingComplete || false,
          workspaceName: data.workspaceName || null,
          username: data.username || null,
          workspaceColor: data.workspaceColor || 'green',
          workspaceDescription: data.workspaceDescription || null,
          location: data.location || null,
          background: data.background || 'solid',
          theme: data.theme || null,
          description: data.description || null,
        };
      }

      // New user - no profile yet
      return createEmptyUserProfile();
    } catch (err) {
      console.error('[Auth] Error fetching user profile:', err);
      return createEmptyUserProfile();
    }
  }, []);

  useEffect(() => {
    console.log('[Auth] Setting up auth state listener...');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const generation = ++authGenerationRef.current;
      const nextUid = firebaseUser?.uid || null;
      if (activeAuthUidRef.current !== nextUid) {
        // Close the account-switch window before any profile/network work can
        // run with the previous account's Drive credential.
        setDriveAccessToken(null);
        setIsDriveConnected(false);
        setUserProfile(null);
      }
      activeAuthUidRef.current = nextUid;
      console.log('[Auth] State changed:', firebaseUser ? firebaseUser.email : 'No user');
      setUser(firebaseUser);
      
      if (firebaseUser) {
        setLoading(true);
        const profile = await fetchUserProfile(firebaseUser.uid);
        if (authGenerationRef.current !== generation) return;
        setUserProfile(profile);

        const storedDriveToken = sessionStorage.getItem('googleDriveAccessToken');
        const storedDriveOwner = sessionStorage.getItem('googleDriveTokenOwner');
        const storedDriveConnected = sessionStorage.getItem('isDriveConnected');
        if (storedDriveToken && storedDriveOwner === firebaseUser.uid && storedDriveConnected === 'true') {
          setDriveAccessToken(storedDriveToken);
          setIsDriveConnected(true);
        } else {
          setDriveAccessToken(null);
          setIsDriveConnected(false);
          sessionStorage.removeItem('googleDriveAccessToken');
          sessionStorage.removeItem('googleDriveTokenOwner');
          sessionStorage.removeItem('isDriveConnected');
        }
      } else {
        setUserProfile(null);
        setDriveAccessToken(null);
        setIsDriveConnected(false);
        sessionStorage.removeItem('googleDriveAccessToken');
        sessionStorage.removeItem('googleDriveTokenOwner');
        sessionStorage.removeItem('isDriveConnected');
      }

      if (authGenerationRef.current === generation) {
        setLoading(false);
      }
    });

    return () => {
      authGenerationRef.current += 1;
      unsubscribe();
    };
  }, [fetchUserProfile]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    try {
      console.log('[Auth] Starting Google sign-in with popup...');

      const result = await signInWithPopup(auth, googleProvider);
      console.log('[Auth] Google sign-in successful:', result.user.email);

      // Firebase owns the app login session. The basic Google OAuth token is not
      // needed by Willow, so do not retain it in JavaScript-readable storage.
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
  }, []);

  const connectDrive = useCallback(async () => {
    setError(null);
    const expectedUser = auth.currentUser;
    const expectedUid = user?.uid;
    if (!expectedUser || !expectedUid || expectedUser.uid !== expectedUid) {
      const accountUnavailableError = Object.assign(
        new Error('Your account is still loading. Please wait a moment and try connecting Drive again.'),
        { code: 'auth/drive-account-unavailable' }
      );
      setError(accountUnavailableError.message);
      throw accountUnavailableError;
    }

    const expectedEmail = (user.email || expectedUser.email || '').trim().toLowerCase();

    try {
      console.log('[Auth] Starting Google Drive connection...');

      // Use the current account as a hint when available, and always replace
      // any parameters left on the shared provider by a previous account.
      driveProvider.setCustomParameters({
        ...(expectedEmail ? { login_hint: expectedEmail } : {}),
        prompt: 'consent',
      });

      // Reauthenticate the existing Firebase user instead of signing in again.
      // This obtains a fresh Drive-scoped Google token without letting account
      // selection replace Willow's active Firebase identity.
      const result = await reauthenticateWithPopup(expectedUser, driveProvider);
      const returnedEmail = (result.user.email || '').trim().toLowerCase();
      const identityMatches = result.user.uid === expectedUid && (
        !expectedEmail || returnedEmail === expectedEmail
      ) && auth.currentUser?.uid === expectedUid;

      if (!identityMatches) {
        setDriveAccessToken(null);
        setIsDriveConnected(false);
        sessionStorage.removeItem('googleDriveAccessToken');
        sessionStorage.removeItem('googleDriveTokenOwner');
        sessionStorage.removeItem('isDriveConnected');

        const mismatchMessage = auth.currentUser?.uid === expectedUid
          ? `Drive was not connected. Choose the Google account${expectedEmail ? ` ${expectedEmail}` : ' already signed in to Willow'}.`
          : 'Drive was not connected because the active Willow account changed during authorization. Please try again.';
        throw Object.assign(new Error(mismatchMessage), { code: 'auth/drive-account-mismatch' });
      }

      console.log('[Auth] Google Drive connection successful');

      // Get the Google OAuth access token with Drive scope
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setDriveAccessToken(credential.accessToken);
        setIsDriveConnected(true);
        sessionStorage.setItem('googleDriveAccessToken', credential.accessToken);
        sessionStorage.setItem('googleDriveTokenOwner', expectedUid);
        sessionStorage.setItem('isDriveConnected', 'true');
      } else {
        throw new Error('Google Drive did not return an access token. Please try connecting again.');
      }
    } catch (err: any) {
      console.error('[Auth] Google Drive connection error:', err.code, err.message);

      if (err.code === 'auth/popup-closed-by-user') {
        setError('Drive connection was cancelled.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Popup was blocked. Please allow popups for this site.');
      } else if (err.code === 'auth/cancelled-popup-request') {
        return;
      } else if (err.code === 'auth/drive-account-mismatch' || err.code === 'auth/user-mismatch') {
        setError(
          err.code === 'auth/user-mismatch'
            ? `Drive was not connected. Choose the Google account${expectedEmail ? ` ${expectedEmail}` : ' already signed in to Willow'}.`
            : err.message
        );
      } else {
        setError(err.message || 'Drive connection failed. Please try again.');
      }
      throw err;
    }
  }, [user?.email, user?.uid]);

  const disconnectDrive = useCallback(() => {
    setDriveAccessToken(null);
    setIsDriveConnected(false);
    sessionStorage.removeItem('googleDriveAccessToken');
    sessionStorage.removeItem('googleDriveTokenOwner');
    sessionStorage.removeItem('isDriveConnected');
    console.log('[Auth] Google Drive disconnected');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      setDriveAccessToken(null);
      setIsDriveConnected(false);
      setUserProfile(null);
      localStorage.removeItem('googleAccessToken');
      localStorage.removeItem('googleDriveAccessToken');
      localStorage.removeItem('isDriveConnected');
      sessionStorage.removeItem('googleDriveAccessToken');
      sessionStorage.removeItem('googleDriveTokenOwner');
      sessionStorage.removeItem('isDriveConnected');
      setError(null);
      console.log('[Auth] Signed out successfully');
    } catch (err: any) {
      console.error('[Auth] Sign-out error:', err);
      setError(err.message || 'Sign-out failed');
      throw err;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Update user profile in Firestore
  const updateUserProfile = useCallback(async (data: Partial<UserProfile>) => {
    if (!user) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, data, { merge: true });

      if (auth.currentUser?.uid === user.uid) {
        setUserProfile(prev => ({ ...(prev || createEmptyUserProfile()), ...data }));
      }

      console.log('[Auth] User profile updated:', data);
    } catch (err) {
      console.error('[Auth] Error updating user profile:', err);
      throw err;
    }
  }, [user]);

  // Complete onboarding - save all profile data with auto-generated fields
  const completeOnboarding = useCallback(async (name: string, role: string, photoURL: string | null) => {
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
  }, [user, updateUserProfile]);

  // Remove tokens persisted by older builds. Login is managed by Firebase and
  // the Drive token is restored only from this tab's UID-scoped session above.
  useEffect(() => {
    localStorage.removeItem('googleAccessToken');
    localStorage.removeItem('googleDriveAccessToken');
    localStorage.removeItem('isDriveConnected');
  }, []);

  // If a Drive request reports the token expired/revoked (HTTP 401), clear the
  // stale auth so the UI can prompt a fresh connect instead of failing silently.
  useEffect(() => {
    const handleExpired = () => {
      setDriveAccessToken(null);
      setIsDriveConnected(false);
      localStorage.removeItem('googleAccessToken');
      localStorage.removeItem('googleDriveAccessToken');
      localStorage.removeItem('isDriveConnected');
      sessionStorage.removeItem('googleDriveAccessToken');
      sessionStorage.removeItem('googleDriveTokenOwner');
      sessionStorage.removeItem('isDriveConnected');
      setError('Your Google Drive session expired. Please reconnect Drive.');
    };
    window.addEventListener('willow_drive_auth_expired', handleExpired);
    return () => window.removeEventListener('willow_drive_auth_expired', handleExpired);
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    userProfile,
    loading,
    error,
    // Compatibility signal for older editor callers. It is intentionally null
    // until Drive is connected and never represents the basic login token.
    accessToken: isDriveConnected ? driveAccessToken : null,
    driveAccessToken,
    isDriveConnected,
    signInWithGoogle,
    signOut,
    connectDrive,
    disconnectDrive,
    clearError,
    updateUserProfile,
    completeOnboarding,
  }), [user, userProfile, loading, error, driveAccessToken, isDriveConnected, signInWithGoogle, signOut, connectDrive, disconnectDrive, clearError, updateUserProfile, completeOnboarding]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

