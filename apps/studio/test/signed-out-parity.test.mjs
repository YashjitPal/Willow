/**
 * Signed out is the same Willow.
 *
 * Signing in is optional: nothing Willow runs needs an account. But keys sat in one slot per
 * account plus a `guest` slot, so after signing out no model would run, and a handful of
 * surfaces still asked for sign-in before doing anything (the Develop and Media prompts, the
 * Agents view), hid themselves (Search chats, Notebooks, the projects showcase), or swapped the
 * user's background for `lines`. Keys are now the device's, and every one of those is gone.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const { DEVICE_KEY_SLOT, adoptAccountKeys } = await importTs(path.join(repoRoot, 'platform', 'auth', 'src', 'device-keys.ts'));

const installStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  globalThis.localStorage = {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
  return map;
};

it('adopts every account\'s keys onto the device, the current account first, and clears the old slots', () => {
  const storage = installStorage({
    'willow:providerState:uid-a': JSON.stringify({
      gemini: { apiKey: 'g-a', baseUrl: 'https://gateway.example' },
      openai: { apiKey: '', baseUrl: '' },
      activeProvider: 'gemini',
    }),
    'willow:apiKeys:uid-a': JSON.stringify({ gemini: ['g-a'], openai: [] }),
    'willow:providerState:guest': JSON.stringify({ gemini: { apiKey: 'g-guest' }, openai: { apiKey: 'o-1, o-2' } }),
    'willow:apiKeys:uid-b': JSON.stringify({ anthropic: ['a-b'] }),
    unrelated: 'kept',
  });
  adoptAccountKeys('uid-a');

  const state = JSON.parse(storage.get(DEVICE_KEY_SLOT.providerState));
  assert.deepEqual(state.gemini, { apiKey: 'g-a', baseUrl: 'https://gateway.example' }, 'the signed-in account wins a provider both hold');
  assert.equal(state.openai.apiKey, 'o-1, o-2', 'a provider only the guest slot held is not lost');
  assert.equal(state.anthropic.apiKey, 'a-b', 'nor one only another account held');
  assert.equal(state.activeProvider, 'gemini');

  const keys = JSON.parse(storage.get(DEVICE_KEY_SLOT.apiKeys));
  assert.deepEqual(keys.gemini, ['g-a']);
  assert.deepEqual(keys.openai, ['o-1', 'o-2'], 'split the way every reader splits');
  assert.deepEqual(keys.moonshot, []);

  assert.deepEqual([...storage.keys()].sort(), [DEVICE_KEY_SLOT.apiKeys, DEVICE_KEY_SLOT.providerState, 'unrelated'].sort(),
    'a key removed later must not survive under an old name');
});

it('keeps a key typed while signed in working after signing out', () => {
  const storage = installStorage({ 'willow:apiKeys:uid-a': JSON.stringify({ gemini: ['g-a'] }) });
  adoptAccountKeys(null);
  assert.deepEqual(JSON.parse(storage.get(DEVICE_KEY_SLOT.apiKeys)).gemini, ['g-a']);
});

it('leaves the device slot alone once it exists, even emptied', () => {
  const storage = installStorage({
    [DEVICE_KEY_SLOT.apiKeys]: JSON.stringify({ gemini: [] }),
    'willow:apiKeys:uid-a': JSON.stringify({ gemini: ['g-a'] }),
  });
  adoptAccountKeys('uid-a');
  assert.deepEqual(JSON.parse(storage.get(DEVICE_KEY_SLOT.apiKeys)), { gemini: [] }, 'a key the user removed stays removed');
  assert.equal(storage.has(DEVICE_KEY_SLOT.providerState), false);
});

it('writes nothing when there is nothing to adopt', () => {
  const storage = installStorage({});
  adoptAccountKeys('uid-a');
  assert.equal(storage.size, 0);
});

it('reads and writes keys in the device slot only', () => {
  const userData = read('platform', 'auth', 'src', 'use-user-data.ts');
  assert.match(userData, /adoptAccountKeys\(uid\);\s*try \{\s*const serializedApiKeys = localStorage\.getItem\(DEVICE_KEY_SLOT\.apiKeys\);/);
  assert.match(userData, /localStorage\.setItem\(DEVICE_KEY_SLOT\.apiKeys, JSON\.stringify\(apiKeys\)\)/);
  assert.doesNotMatch(userData, /willow:apiKeys:\$\{|'guest'|apiKeysOwnerUid/, 'keys no longer belong to an account');

  const providers = read('apps', 'studio', 'src', 'settings', 'provider-settings.ts');
  assert.match(providers, /adoptAccountKeys\(uid\);\s*try \{\s*const key = DEVICE_KEY_SLOT\.providerState;/);
  assert.match(providers, /localStorage\.setItem\(DEVICE_KEY_SLOT\.providerState, JSON\.stringify\(state\)\)/);
  assert.doesNotMatch(providers, /GUEST_PROVIDER_SCOPE|'guest'/);

  assert.doesNotMatch(read('features', 'media', 'src', 'MediaView.tsx'), /willow:providerState:\$\{user/);
});

it('asks no one to sign in before doing the work', () => {
  const app = read('apps', 'studio', 'src', 'app', 'App.tsx');
  assert.doesNotMatch(app, /if \(!user\) \{\s*setIsAuthModalOpen\(true\);/, 'the Develop and Media prompts run signed out');
  assert.doesNotMatch(app, /onAuthRequired=\{!user/);
  assert.doesNotMatch(app, /\{user && \(\s*<div className="pb-20">/, 'the projects showcase shows signed out');
  assert.doesNotMatch(app, /user && isAgentsEnabled|Boolean\(user && searchParams/, 'the Agents view opens signed out');
  assert.match(app, /<Route path="\/agents" element=\{<Navigate to="\/\?view=agents" replace \/>\} \/>/);

  assert.doesNotMatch(read('features', 'chat', 'src', 'ChatView.tsx'), /\{isAuthenticated && \(/);

  const sidebar = read('apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.tsx');
  assert.doesNotMatch(sidebar, /\{user && \(\s*<SidebarItem\s+symbol="search"/, 'Search chats shows signed out');
  assert.doesNotMatch(sidebar, /\(user \|\| isLocalFolderConnected\)/, 'Projects and Notebooks show signed out');
});

it('shows the same background signed in or out', () => {
  for (const file of [['features', 'chat', 'src', 'composer', 'Composer.tsx'], ['features', 'design', 'src', 'composer', 'Composer.tsx']]) {
    assert.doesNotMatch(read(...file), /isAuthenticated \? background : 'lines'/, `${file.join('/')} styles for the real background`);
  }
  const background = read('apps', 'studio', 'src', 'shell', 'BackgroundContext.tsx');
  assert.match(background, /setBackgroundState\(userProfile\.background\);\s*try \{ localStorage\.setItem\(STORAGE_KEY, userProfile\.background\); \}/,
    'the account\'s background is mirrored, so signing out changes nothing');
  const auth = read('platform', 'auth', 'src', 'AuthContext.tsx');
  assert.match(auth, /background: data\.background \|\| deviceBackground \|\| 'solid'/, 'an account without one adopts the device\'s');
  assert.match(auth, /background: readDeviceBackground\(\) \?\? 'solid'/);
});
