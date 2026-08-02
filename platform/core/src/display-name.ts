// Tiny localStorage cache of the user's first name so greetings can render
// instantly on mount instead of flashing "there" while the Firestore profile
// is still being fetched.
const KEY = 'willow-cached-first-name';

export const getCachedFirstName = (): string => {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};

export const cacheFirstName = (name: string): void => {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* ignore */
  }
};
