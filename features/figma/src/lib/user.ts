/**
 * Willow Figma — local user identity for multiplayer presence & comments.
 * Persisted in localStorage so the same browser keeps its name/color.
 */

import { presenceColor } from './colors';
import { genId } from './scene';
import type { PresenceUser } from './types';

const STORAGE_KEY = 'willow_figma_user';

const ANON_NAMES = [
  'Ant', 'Bat', 'Bear', 'Bee', 'Cat', 'Deer', 'Dove', 'Fox', 'Frog', 'Hawk',
  'Koala', 'Lion', 'Lynx', 'Mole', 'Moth', 'Otter', 'Owl', 'Panda', 'Seal', 'Wolf',
];

export function getLocalUser(): PresenceUser {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PresenceUser;
      if (parsed && parsed.id && parsed.name && parsed.color) return parsed;
    }
  } catch {
    /* fall through to a fresh identity */
  }
  const id = genId();
  const user: PresenceUser = {
    id,
    name: `Anonymous ${ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)]}`,
    color: presenceColor(id),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* private mode — session identity only */
  }
  return user;
}

export function setLocalUserName(name: string): PresenceUser {
  const user = { ...getLocalUser(), name };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
  return user;
}
