/**
 * Regression tests: the boot sequence, and "Let's chat" never appearing without
 * the name.
 *
 * A refresh used to read `Let's chat` -> `Let's chat, there` -> `Let's chat,
 * Yashjit`. The cause is that the name lives INSIDE the greeting string, so
 * rendering before the name is known does not produce a greeting missing its
 * name — it produces a different, wrong greeting that then has to be replaced.
 * Firebase reports the session on one tick and the Firestore profile carrying
 * `displayName` on a later one, and the heading was rebuilt from whatever was
 * present at each.
 *
 * The fix is one shared readiness signal, `useGreetingReady`, consumed in three
 * places that must stay in agreement:
 *
 *   1. the greeting text itself (both the pinned and the unpinned heading)
 *   2. the home glow, which is a different subtree — holding only the text left
 *      the glow blooming alone against an empty centre
 *   3. `isBootHydrating` in ChatView, which keeps the composer docked, so the
 *      rise, the glow and the heading all land in one commit
 *
 * The rest of the boot sequence is pinned here too, because it is one design and
 * splitting it across files would let half of it drift: the sidebar fills in
 * against a bare surface with no placeholder animation anywhere, Recents brings
 * its own heading with it rather than promising a section that is not there yet,
 * and the chat registry hydrates exactly once so the list does not paint,
 * vanish, and paint again.
 *
 * Source assertions, because these are render-time conditions inside large
 * components and the guarantee is about which expression gates what.
 *
 * The glow's half of (2) is additionally pinned from the glow's own side in
 * `home-glow-accent.test.mjs`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const MEDIA_HOME = () => read('features', 'media', 'src', 'MediaHome.tsx');
const CHAT_VIEW = () => read('features', 'chat', 'src', 'ChatView.tsx');
const SIDEBAR = () => read('apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.tsx');
const SIDEBAR_CSS = () => read('apps', 'studio', 'src', 'shell', 'sidebar', 'Sidebar.css');
const LOCAL_FS = () => read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');
const INDEX_HTML = () => read('apps', 'studio', 'index.html');

// Every file here explains this behaviour in prose, quoting the very strings and
// identifiers asserted below — including the wrong intermediate greetings and
// the CSS that was removed. A comment would otherwise satisfy an assertion, or
// trip an absence check.
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

// ── 1. The readiness signal ──────────────────────────────────────────────────

it('holds the greeting until Firebase has reported AND the profile has landed', () => {
  const source = codeOnly(MEDIA_HOME());

  const hook = source.match(/export const useGreetingReady = \([\s\S]*?\n\};/);
  assert.ok(hook, 'useGreetingReady is gone — nothing gates the greeting on the name');

  // `!loading` is the term that fixed the reported bug. While Firebase is still
  // restoring the session `user` is null, so `isAuthenticated` is false — which
  // is indistinguishable from genuinely signed out, and the signed-out
  // short-circuit below would fire for a signed-in user and paint the nameless
  // greeting as if it were final.
  assert.match(hook[0], /!loading/,
    'the greeting no longer waits for Firebase — a signed-in user gets the nameless greeting first');
  assert.match(hook[0], /!!userProfile/,
    'the greeting no longer waits for the profile document that carries displayName');

  // Signed out, `Let's chat` IS the final text. Without the short-circuit a
  // signed-out user waits on a profile that will never arrive, and the greeting
  // never renders at all.
  assert.match(hook[0], /!isAuthenticated \|\| !!userProfile/,
    'signed out no longer short-circuits — the greeting waits on a profile that never arrives');
});

it('keeps the name inside the greeting string, which is why it must be withheld', () => {
  const source = codeOnly(MEDIA_HOME());

  // If this ever became "Let's chat" + a separate name node, withholding the
  // whole heading would be the wrong fix and these tests would be pinning it.
  assert.match(source, /`Let's chat, \$\{firstName\}`/,
    'the greeting no longer interpolates the name, so the withhold-until-ready rule may no longer apply');
});

// ── 2. Both headings are withheld, and neither moves the composer ─────────────

it('renders nothing rather than a placeholder for the pinned greeting', () => {
  const source = codeOnly(MEDIA_HOME());

  const pinned = source.match(/export const PinnedChatGreeting[\s\S]*?\n\};/);
  assert.ok(pinned, 'could not locate PinnedChatGreeting');

  assert.match(pinned[0], /useGreetingReady\(isAuthenticated\)/,
    'the pinned greeting no longer consumes the shared readiness signal');
  assert.match(pinned[0], /if \(!isReady\) return null;/,
    'the pinned greeting renders before the name is known, or renders a placeholder instead of nothing');

  // Withholding is only free because the heading is absolutely positioned
  // against the composer's own box: no reserved space to collapse, so the
  // composer does not shift when it lands.
  assert.match(pinned[0], /absolute bottom-full/,
    'the pinned greeting is no longer absolute against the composer — withholding it will now move the composer');
});

it('withholds the unpinned heading inside its fixed-height spacer', () => {
  const source = codeOnly(MEDIA_HOME());

  assert.match(source, /\{isGreetingReady && \(\s*<ChatZeroStateGreeting/,
    'the unpinned heading renders before the name is known');

  // The spacer is what makes that safe here: a fixed 36px row with the heading
  // absolutely positioned inside it, so the InputBar sits at the same place
  // whether the heading is present or not.
  assert.match(source, /h-\[36px\]/,
    'the greeting spacer lost its fixed height — the InputBar will jump when the heading lands');
});

// ── 3. The composer waits for the same signal ────────────────────────────────

it('keeps the composer docked until the greeting is ready, not just the chat list', () => {
  const source = codeOnly(CHAT_VIEW());

  const boot = source.match(/const isBootHydrating =([\s\S]*?);/);
  assert.ok(boot, 'the boot-dock signal is gone — the composer centres before anything has loaded');

  // Without this term the composer rises to centre over blank space while the
  // profile is still in flight, and the heading drops in afterwards — two
  // events where the design calls for one.
  assert.match(boot[1], /!isGreetingReady/,
    'the composer no longer waits for the greeting — the rise and the heading will land in separate frames');
  assert.match(boot[1], /!isChatListHydrated/,
    'the composer no longer waits for the chat registry, so it can rise and then drop back into a restored chat');

  // The escape hatches: real content means the thread must not be blanked to
  // wait on a list.
  for (const term of ['messages.length === 0', '!isGenerating', '!isLive']) {
    assert.ok(boot[1].includes(term),
      `${term} is gone from the boot dock — a live thread can be blanked waiting on hydration`);
  }

  assert.match(source, /const isGreetingReady = useGreetingReady\(/,
    'ChatView derives readiness some other way — it must share the hook with the greeting and the glow');
});

// ── 4. The pre-React shell hands off without moving anything ─────────────────

it('paints a docked composer, not a spinner, before React mounts', () => {
  const html = INDEX_HTML();

  assert.match(html, /<div id="willow-boot"[^>]*>/,
    'the pre-React boot shell is gone — the first paint is whatever React manages on its own');

  const shell = html.match(/<div id="willow-boot"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(shell, 'could not locate the boot shell markup');
  assert.match(shell[0], /willow-boot-composer/,
    'the boot shell no longer paints the composer, so the handoff will jump');

  // The shell stands in for UI that does not exist yet: it must be unreachable
  // by a screen reader and by Tab, with the <div role="status"> carrying the
  // only thing worth announcing.
  assert.match(shell[0], /aria-hidden="true"/, 'the boot shell is exposed to screen readers');
  assert.match(shell[0], /\binert\b/, 'the boot shell is reachable by Tab');

  // Docked, matching the composer's resting position in every loaded chat, so a
  // refresh that lands back in a chat moves nothing.
  const main = html.match(/\.willow-boot-main \{([\s\S]*?)\}/);
  assert.ok(main, 'could not locate the boot shell layout rule');
  assert.match(main[1], /justify-content: flex-end/,
    'the boot composer is no longer docked — the handoff jumps from centre to bottom or back');

  // Dimensions are copied from Composer.tsx; drift shows up as a jump at the
  // handoff, which is the one thing this shell exists to avoid.
  const composer = html.match(/\.willow-boot-composer \{([\s\S]*?)\}/);
  assert.ok(composer, 'could not locate the boot composer rule');
  assert.match(composer[1], /max-width: 660px/, 'the boot composer width drifted from the real one');
  assert.match(composer[1], /min-height: 64px/, 'the boot composer height drifted from the real one');
  assert.match(composer[1], /border-radius: 32px/, 'the boot composer radius drifted from the real one');
});

// ── 5. The sidebar fills in against a bare surface ───────────────────────────

it('reserves the account row without animating it', () => {
  const source = codeOnly(SIDEBAR());

  // An empty row of the final height. The rest of the rail arrives element by
  // element against a bare surface, so a pulsing account row would be the one
  // thing on screen drawing attention to itself.
  const placeholder = source.match(/\{isAuthLoading \? \(([\s\S]*?)\) : user \? \(/);
  assert.ok(placeholder, 'the auth-loading branch is gone — the footer will show "Sign In" then swap identities');
  assert.match(placeholder[1], /h-10/,
    'the account placeholder no longer reserves the row height, so the avatar and name will shift it');
  assert.ok(!/skeleton/i.test(placeholder[1]),
    'a skeleton is back in the account row — it must be empty');

  const css = codeOnly(SIDEBAR_CSS());
  assert.ok(!/willow-profile-skeleton/.test(css),
    'the profile skeleton CSS is back — the account row must have no placeholder animation');

  // The reveal is NOT a placeholder: it runs on the real avatar and name so
  // they resolve into place rather than appearing abruptly.
  assert.match(css, /\.willow-profile-reveal \{[^}]*animation: willow-profile-reveal/,
    'the profile reveal is gone — the real avatar and name now appear abruptly');
  assert.match(source, /willow-profile-reveal/,
    'nothing consumes the profile reveal any more');
});

it('brings the Recents heading in with the chats, never before them', () => {
  const source = codeOnly(SIDEBAR());

  // A section heading is a promise that there is a section. This gate governs
  // the header AND the rows, so the label cannot appear over empty space.
  const gate = source.match(/\{([^\n]*?) && \(\s*<>\s*<SectionHeader\s+title="Recents"/);
  assert.ok(gate, 'could not locate the Recents gate, or the header is no longer inside it');
  assert.match(gate[1], /isChatListHydrated/,
    'Recents no longer waits for the chat registry');
  /*
   * `sortedChats`, not `localChats`: a chat filed into a notebook is dropped from
   * Recents but stays in the registry, so the unfiltered count is no longer a
   * count of what renders — gating on it puts the heading over an empty list the
   * moment every chat is filed, which is the exact bug this test exists to catch.
   */
  assert.match(gate[1], /sortedChats\.length > 0/,
    'the Recents heading can render with no chats beneath it');

  // Deliberately NOT the slow flag: `isInitializingLocalFS` additionally waits
  // on folder permission, a per-file disk reconcile and a projects scan, none
  // of which change what Recents renders.
  assert.ok(!/isInitializingLocalFS/.test(gate[1]),
    'Recents is gated on the slow init flag again — it will appear long after the nav rows above it');
});

// ── 6. One hydration pass, so the list does not flicker ──────────────────────

it('hydrates the chat registry once, under the real account', () => {
  const source = codeOnly(LOCAL_FS());

  // The scope id is `${uid}::${rootId}::${workspace}`, so running the restore
  // before auth reports hydrates under a provisional identity, then re-runs
  // under the real one and wipes — the list appeared, vanished, and appeared
  // again on every refresh.
  assert.match(source, /if \(isAuthLoading\) return;/,
    'the restore no longer waits for auth — the chat list will hydrate under a provisional scope and flicker');

  const effect = source.match(/if \(isAuthLoading\) return;[\s\S]*?\}, \[([^\]]*)\]\);/);
  assert.ok(effect, 'could not locate the restore effect');
  assert.ok(/isAuthLoading/.test(effect[1]),
    'isAuthLoading is not a dependency, so the restore never re-runs once auth resolves and no chats load at all');

  // And the wipe must stay conditional: this effect re-runs on ANY userProfile
  // change, and an unconditional clear nulls activeChatId mid-conversation,
  // which ChatView reads as a deselect.
  assert.match(source, /if \(buildChatScopeId\(nextRootId\) !== chatScopeIdRef\.current\) \{\s*setLocalChats\(\[\]\);/,
    'the registry wipe is unconditional again — a profile change will clear the open chat');
});
