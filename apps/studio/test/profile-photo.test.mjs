/**
 * The user's profile photo (platform/ui/src/ProfilePhoto.tsx): asked for without a Referer, given one
 * retry, and replaced by the silhouette while it loads and wherever it cannot load — and every place
 * that shows it goes through it, so none shows the browser's broken-image glyph again.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8');
const PHOTO = read('platform', 'ui', 'src', 'ProfilePhoto.tsx');

it('asks for the photo without a Referer, retries once, and keeps the silhouette under it', () => {
  assert.match(PHOTO, /referrerPolicy="no-referrer"/);
  assert.match(PHOTO, /onError=\{\(\) => \(attempt === 0 \? setWaiting\(true\) : setFailed\(true\)\)\}/);
  assert.match(PHOTO, /<ProfileSilhouette className="absolute inset-0 h-full w-full" \/>\s*\{url && !waiting && !failed && \(/);
  assert.match(PHOTO, /alt=""/, 'a photo that fails shows no alt text either');
});

it('is what every view of the user shows their photo with', () => {
  const views = [
    ['apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.tsx'],
    ['apps', 'studio', 'src', 'shell', 'StudioLayout.tsx'],
    ['apps', 'studio', 'src', 'shell', 'sidebar', 'UserMenu.tsx'],
    ['apps', 'studio', 'src', 'settings', 'tabs', 'PeopleTab.tsx'],
    ['apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps', 'ConnectConsentDialog.tsx'],
  ];
  for (const view of views) {
    const source = read(...view);
    assert.match(source, /<ProfilePhoto\b/, view.at(-1));
    assert.doesNotMatch(source, /<img\b[^>]*\bsrc=\{(?:userProfile\??\.photoURL|user\??\.photoURL|photo)\b/, `${view.at(-1)} has a bare <img> for the photo`);
    assert.doesNotMatch(source, /picsum\.photos/, `${view.at(-1)} stands a stranger's picture in for the user's`);
  }
  assert.match(read('platform', 'ui', 'src', 'Avatar.tsx'), /<ProfilePhoto src=\{effectiveSrc\}/);
});
