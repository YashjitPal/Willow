/**
 * One workspace colour, signed in or out.
 *
 * The colour used to live only on the Firestore profile, so a signed-out window had none: every
 * surface fell back to a default (green for most, blue for Spark Home), and a colour picked while
 * signed out was dropped, there being no profile to save it to. `AuthContext` now owns the colour
 * on screen — the account's while signed in, mirrored to the device; the device's while signed
 * out — and every surface reads that.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

it('keeps the colour on the device, and lets the account win while there is one', () => {
  const auth = read('platform', 'auth', 'src', 'AuthContext.tsx');
  assert.match(auth, /const DEVICE_WORKSPACE_COLOR_KEY = 'willow_workspace_color';/);
  assert.match(auth, /const workspaceColor: WorkspaceColor = profileWorkspaceColor \?\? deviceWorkspaceColor \?\? 'green';/);
  assert.match(auth, /if \(!profileWorkspaceColor\) return;\s*writeDeviceWorkspaceColor\(profileWorkspaceColor\);/, 'the account\'s colour is mirrored, so signing out changes nothing');
  assert.match(auth, /writeDeviceWorkspaceColor\(color\);\s*setDeviceWorkspaceColor\(color\);\s*if \(!user\) return;/, 'a pick is kept on the device first, signed in or not');
  assert.match(auth, /workspaceColor: data\.workspaceColor \|\| deviceColor \|\| 'green'/, 'an account without a colour adopts the device\'s');
  assert.match(auth, /workspaceColor,\s*setWorkspaceColor,\s*\}\),/);
});

it('picks through the context, and nothing reads the profile\'s colour directly', () => {
  for (const file of ['apps/studio/src/shell/sidebar/Sidebar.tsx', 'apps/studio/src/settings/tabs/AppearanceTab.tsx']) {
    assert.match(read(...file.split('/')), /void setWorkspaceColor\(colorId as typeof workspaceColor\)/, `${file} picks through setWorkspaceColor`);
  }
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !full.endsWith(path.join('auth', 'src', 'AuthContext.tsx'))) {
        if (/userProfile\??\.workspaceColor/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  for (const root of ['apps/studio/src', 'features', 'platform']) walk(path.join(repoRoot, root));
  assert.deepEqual(offenders, [], 'read `workspaceColor` from useAuth(): it is the same signed in or out');
});

it('gives Spark the same colour as everything else, with no blue of its own for "signed out"', () => {
  const home = read('features', 'spark', 'src', 'SparkHome.tsx');
  assert.doesNotMatch(home, /\|\| 'blue'/);
  assert.doesNotMatch(home, /theme\.id === 'blue' \|\| !workspaceColor/);
  const workspace = read('features', 'spark', 'src', 'SparkWorkspace.tsx');
  assert.match(workspace, /const glowLight = workspaceTheme\.id === 'blue'\s*\?/);
});
