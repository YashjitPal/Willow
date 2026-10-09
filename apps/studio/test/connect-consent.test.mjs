import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'apps', 'studio', 'src', 'settings', 'tabs', 'connected-apps');
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

const {
  CONSENT_LINKS,
  GENERIC_CONSENT_APPS,
  WORKSPACE_CONSENT_LOGOS,
  consentButtons,
  consentTitle,
  consentVariant,
} = await importTs(path.join(dir, 'connect-consent.ts'));
const { CARD_CONNECTORS } = await importTs(path.join(dir, 'connector-map.ts'));

it('gives every connectable card one of Gemini’s three consent layouts', () => {
  assert.equal(consentVariant('workspace'), 'workspace');
  assert.equal(consentVariant('github'), 'github');
  assert.equal(consentVariant('youtube'), 'generic');
  assert.equal(consentVariant('spotify'), 'generic');
  for (const cardId of ['youtube', 'spotify']) {
    assert.ok(GENERIC_CONSENT_APPS[cardId], `${cardId} says what its items are`);
    assert.match(GENERIC_CONSENT_APPS[cardId].privacyUrl, /^https:\/\//);
  }
  for (const cardId of Object.keys(CARD_CONNECTORS)) {
    assert.ok(['workspace', 'github', 'generic'].includes(consentVariant(cardId)), cardId);
  }
});

it('labels the buttons and titles as Gemini does', () => {
  assert.deepEqual(consentButtons('workspace'), { cancel: 'Cancel', confirm: 'Connect' });
  assert.deepEqual(consentButtons('github'), { cancel: 'No thanks', confirm: 'Connect' });
  assert.deepEqual(consentButtons('generic'), { cancel: 'No thanks', confirm: 'Connect' });
  assert.equal(consentTitle('workspace', 'Google Workspace'), 'Connect Google Workspace?');
  assert.equal(consentTitle('github', 'GitHub'), 'Connect GitHub?');
  assert.equal(consentTitle('generic', 'Spotify'), 'Connect Spotify?');
});

it('lists the Workspace banner logos in Gemini’s order', () => {
  assert.deepEqual(WORKSPACE_CONSENT_LOGOS.map((logo) => logo.name), [
    'Google Calendar', 'Gmail', 'Google Drive', 'Google Docs', 'Google Keep', 'Google Tasks',
  ]);
  for (const logo of WORKSPACE_CONSENT_LOGOS) assert.match(logo.src, /_2026\/v2\/web\/192px\.svg$/);
  assert.match(CONSENT_LINKS.workspacePrivacy, /p=ws_ext_privacy/);
  assert.match(CONSENT_LINKS.contentUse, /p=ghi_ca_data/);
});

it('keeps the measured dialog chrome and motion', () => {
  const css = read('ConnectConsentDialog.css');
  assert.match(css, /\.cc-pane \{[^}]*width: calc\(100vw - 48px\);[^}]*max-width: 512px;/);
  assert.match(css, /\.cc-surface \{[^}]*min-width: 280px;[^}]*border-radius: 32px;[^}]*background: rgb\(31, 31, 31\);[^}]*box-shadow: rgba\(0, 0, 0, 0\.28\) 0 0 20px 0;/);
  assert.match(css, /\.cc-backdrop \{[^}]*rgba\(0, 0, 0, 0\.32\);[^}]*transition: opacity 400ms cubic-bezier\(0\.25, 0\.8, 0\.25, 1\);/);
  assert.match(css, /\.cc-inner \{[^}]*transition: opacity 150ms linear;/);
  assert.match(css, /\.cc-surface \{[^}]*transform: scale\(0\.8\);[^}]*transition: transform 150ms cubic-bezier\(0, 0, 0\.2, 1\);/);
  assert.match(css, /\.cc-inner--closing \{[^}]*transition-duration: 75ms;/);
  assert.match(css, /\.cc-banner \{\s*padding: 34px 0 16px;/);
  assert.match(css, /\.cc-banner--first-party \{\s*padding: 24px 0 0;/);
  assert.match(css, /\.cc-banner-line \{[^}]*box-sizing: content-box;[^}]*border: 0\.5px solid #7a7a7a;/);
  assert.match(css, /\.cc-title \{[^}]*padding: 24px 24px 0;[^}]*font-size: 20px;[^}]*font-weight: 470;/);
  assert.match(css, /\.cc-first-party-title \{[^}]*margin: 16px 0 0;[^}]*font-size: 24px;[^}]*font-weight: 380;/);
  assert.match(css, /\.cc-account-pill \{[^}]*padding: 9px 11px;[^}]*border: 1px solid #444746;[^}]*border-radius: 58px;/);
  assert.match(css, /\.cc-content \{[^}]*max-height: calc\(100vh - 325px\);[^}]*scrollbar-gutter: stable;/);
  assert.match(css, /@media \(pointer: fine\) \{\s*\.cc-content::-webkit-scrollbar,\s*\.cc-content::-webkit-scrollbar-corner \{\s*width: 12px;/);
  assert.match(css, /\.cc-link \{[^}]*text-decoration-style: dotted;[^}]*text-underline-position: from-font;/);
  assert.match(css, /\.cc-button--tonal \{\s*background: rgb\(23, 23, 23\);/);
  assert.match(css, /\.cc-button:hover::before \{\s*opacity: 0\.08;/);
  assert.match(css, /\.cc-button:active::before \{\s*opacity: 0\.12;/);
  assert.match(css, /\.cc-ripple \{[^}]*background-color: rgba\(230, 230, 230, 0\.1\);[^}]*transition: opacity, transform 0ms cubic-bezier\(0, 0, 0\.2, 1\);/);
  assert.match(read('ConnectConsentDialog.tsx'), /launchMaterialRipple\(hostRef\.current, 'cc-ripple', event\.clientX, event\.clientY\)/);
  assert.match(css, /\.cc-button:focus-visible \{\s*outline: 3px solid rgb\(230, 230, 230\);\s*outline-offset: 2px;/);
  assert.match(css, /\.cc-host \{[^}]*color-scheme: dark;/);
  assert.match(read('ConnectConsentDialog.tsx'), /const EXIT_MS = 225;/);
});

it('restyles the popup for phones and tablets as Gemini does', () => {
  const css = read('ConnectConsentDialog.css');
  const narrow = css.match(/@media \(max-width: 960px\) \{([\s\S]*?)\n\}/);
  assert.ok(narrow);
  assert.match(narrow[1], /\.cc-surface \{\s*background: rgb\(28, 28, 28\);/);
  assert.match(narrow[1], /\.cc-content,\s*\.cc-link,\s*\.cc-button \{\s*color: rgb\(224, 224, 224\);/);
  assert.match(narrow[1], /\.cc-button--tonal \{\s*background: rgb\(20, 20, 20\);/);
  const phone = css.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/);
  assert.ok(phone);
  assert.match(phone[1], /\.cc-pane \{\s*height: 100dvh;/);
  assert.match(phone[1], /\.cc-container \{\s*width: fit-content;\s*height: 100vh;\s*max-height: 650px;/);
});

it('asks before connecting, and connects from the Connect click itself', () => {
  const tab = read('ConnectedAppsTab.tsx');
  assert.match(tab, /if \(current\.connected \|\| !current\.connectable\) \{\s*void toggleConnection\(id, name\);\s*return;\s*\}\s*setConsent\(/);
  assert.match(tab, /confirm: \(\) => \{\s*void toggleConnection\(id, name\);\s*\}/);
  assert.match(tab, /consent\?\.cardId === cardId \|\| state\.busy \? \{ \.\.\.state, connected: true \} : state/);
  assert.match(tab, /<GithubTokenRow login=\{githubLogin\} onConnect=\{connectGithubWithConsent\} \/>/);
  assert.match(tab, /cancel: \(\) => resolve\(null\)/);
  assert.match(read('GithubTokenRow.tsx'), /else if \(ok === false\) setRejected\(true\);/);
  const dialog = read('ConnectConsentDialog.tsx');
  assert.match(dialog, /title="Cancel consent dialog"/);
  assert.match(dialog, /aria-label="Cancel \(Closes dialog box and does not give consent\)"/);
  assert.match(dialog, /role="alertdialog"/);
});
