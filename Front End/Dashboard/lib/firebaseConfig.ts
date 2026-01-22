// Firebase Configuration - Clean Setup
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCLL8xcMqnkpm5nLc2k89j13jurbn1oiZ8",
  authDomain: "willow-64095.firebaseapp.com",
  projectId: "willow-64095",
  storageBucket: "willow-64095.firebasestorage.app",
  messagingSenderId: "945166842026",
  appId: "1:945166842026:web:3d9092b90ff2fe8f75f8d3",
  measurementId: "G-7KL5VNW9D7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Auth instance with local persistence
export const auth = getAuth(app);

// Set persistence to local (survives browser restarts)
setPersistence(auth, browserLocalPersistence).catch(console.error);

// Google Auth Provider (basic auth, no Drive access)
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Separate provider for Drive access (used when user explicitly connects Drive)
export const driveProvider = new GoogleAuthProvider();
driveProvider.setCustomParameters({
  prompt: 'consent' // Always show consent screen for Drive access
});
driveProvider.addScope('https://www.googleapis.com/auth/drive.file');

// Firestore instance
export const db = getFirestore(app);

export default app;
