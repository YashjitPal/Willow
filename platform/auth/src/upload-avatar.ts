import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

/**
 * Uploads a user avatar image to Firebase Storage and returns a permanent
 * download URL suitable for persisting in Firestore.
 *
 * We intentionally do NOT persist `URL.createObjectURL(file)` blob URLs — those
 * are in-memory only and break on the next page load (showing the browser's
 * broken-image icon). Always route user-uploaded avatars through this helper
 * before calling `updateUserProfile({ photoURL })` or `completeOnboarding`.
 */
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const avatarRef = ref(storage, `avatars/${uid}.${ext}`);
  await uploadBytes(avatarRef, file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(avatarRef);
}
