import { useColorScheme } from 'react-native';

export type Palette = {
  scheme: 'dark' | 'light';
  background: string;
  surface: string;
  input: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  onPrimary: string;
  accent: string;
  danger: string;
  dangerSurface: string;
};

/** Willow's own surfaces (apps/studio/index.html), so nothing flashes between the app and the page. */
const dark: Palette = {
  scheme: 'dark',
  background: '#0f0f0f',
  surface: '#1f1f1f',
  input: '#27272a',
  border: '#2e2e30',
  text: '#ffffff',
  muted: '#a1a1aa',
  primary: '#ffffff',
  onPrimary: '#0f0f0f',
  accent: '#8bc26b',
  danger: '#ff8a80',
  dangerSurface: '#3a1d1b',
};

const light: Palette = {
  scheme: 'light',
  background: '#faf9f9',
  surface: '#ffffff',
  input: '#f0eeee',
  border: '#e4e1e1',
  text: '#1f1f1f',
  muted: '#6b6b70',
  primary: '#1f1f1f',
  onPrimary: '#ffffff',
  accent: '#4a7b40',
  danger: '#b3261e',
  dangerSurface: '#fbe9e7',
};

export function usePalette(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}
