import { atom } from 'nanostores';
import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'willow_theme';

const getInitialThemeChoice = (): ThemeChoice => {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    /* localStorage inaccessible */
  }
  return 'dark';
};

const getSystemPreferredTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
};

const resolveTheme = (choice: ThemeChoice): ResolvedTheme => {
  if (choice === 'system') {
    return getSystemPreferredTheme();
  }
  return choice;
};

export const $themeChoice = atom<ThemeChoice>(getInitialThemeChoice());
export const $themeMode = $themeChoice;
export const $resolvedTheme = atom<ResolvedTheme>(resolveTheme($themeChoice.get()));

const applyThemeToDOM = (resolved: ResolvedTheme) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;

  if (resolved === 'light') {
    root.classList.add('light-theme');
    root.classList.remove('dark-theme');
    root.setAttribute('data-theme', 'light');
    if (body) {
      body.classList.add('light-theme');
      body.classList.remove('dark-theme');
      body.setAttribute('data-theme', 'light');
    }
  } else {
    root.classList.add('dark-theme');
    root.classList.remove('light-theme');
    root.setAttribute('data-theme', 'dark');
    if (body) {
      body.classList.add('dark-theme');
      body.classList.remove('light-theme');
      body.setAttribute('data-theme', 'dark');
    }
  }
};

export const setThemeChoice = (choice: ThemeChoice): void => {
  $themeChoice.set(choice);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage quota / private browsing */
  }
  const resolved = resolveTheme(choice);
  $resolvedTheme.set(resolved);
  applyThemeToDOM(resolved);
};

// Initialize DOM on browser load
if (typeof window !== 'undefined') {
  applyThemeToDOM($resolvedTheme.get());

  // Listen to system preference changes
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handleMediaChange = () => {
    if ($themeChoice.get() === 'system') {
      const resolved = getSystemPreferredTheme();
      $resolvedTheme.set(resolved);
      applyThemeToDOM(resolved);
    }
  };

  if (mql.addEventListener) {
    mql.addEventListener('change', handleMediaChange);
  } else if ('addListener' in mql) {
    (mql as any).addListener(handleMediaChange);
  }

  // Cross-tab storage synchronization
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY && event.newValue) {
      const nextChoice = event.newValue as ThemeChoice;
      if (nextChoice === 'system' || nextChoice === 'light' || nextChoice === 'dark') {
        $themeChoice.set(nextChoice);
        const resolved = resolveTheme(nextChoice);
        $resolvedTheme.set(resolved);
        applyThemeToDOM(resolved);
      }
    }
  });
}

/**
 * Hook to consume the current theme choice and resolved theme.
 */
export const useThemeMode = () => {
  const [choice, setChoice] = useState<ThemeChoice>(() => $themeChoice.get());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => $resolvedTheme.get());

  useEffect(() => {
    const unsubChoice = $themeChoice.subscribe(setChoice);
    const unsubResolved = $resolvedTheme.subscribe(setResolved);
    return () => {
      unsubChoice();
      unsubResolved();
    };
  }, []);

  return {
    themeChoice: choice,
    resolvedTheme: resolved,
    isLight: resolved === 'light',
    setThemeChoice,
  };
};
