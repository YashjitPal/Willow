/**
 * Gemini's chat filter: the funnel at the end of the drawer's chat heading, the menu it opens
 * (All, Ready, Needs attention, In progress) and the rows' status marks it filters by, measured at
 * 1536x826, 800x1280 and 390x844 (tools/ui-research/captures/gemini/sort/).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

// The module keeps marks in localStorage and follows the storage layer's window events.
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, String(value)); },
    removeItem: (key) => { memory.delete(key); },
  },
});
globalThis.window ??= new EventTarget();

const status = await importTs(path.join(ROOT, 'features/chat/src/chat-status.ts'));
const turns = await importTs(path.join(ROOT, 'features/chat/src/chat-turn-store.ts'));

const settle = (scopeId, chatId, patch = {}) => status.noteChatTurnSettled({
  scopeId, chatId, chatIdHistory: [], isIncognito: false, isError: false, wasStopped: false, ...patch,
});
const running = (chatId) => {
  const turnId = `test-${chatId}-${Math.random()}`;
  turns.registerChatTurn({ turnId, chatId, chatIdHistory: [], scopeId: 'test', isIncognito: false, status: 'running', abort: new AbortController(), listener: null, settledBy: null, persisted: true });
  return () => turns.removeChatTurn(turnId);
};

describe('the filters', () => {
  it('lists Gemini\'s four, in its order and words', () => {
    assert.deepEqual([...status.CHAT_STATUS_FILTERS], ['ALL', 'READY', 'NEEDS_ATTENTION', 'IN_PROGRESS']);
    assert.deepEqual(status.CHAT_STATUS_FILTERS.map(status.chatStatusFilterLabel), ['All', 'Ready', 'Needs attention', 'In progress']);
    assert.deepEqual(['needs-input', 'in-progress', 'unread'].map(status.chatStatusLabel), ['Needs input', 'In progress', 'Unread']);
    assert.equal(status.$chatStatusFilter.get(), 'ALL', 'the filter starts on All and is not restored across a reload');
  });

  it('keeps every chat under All and each mark under the filter that names it', () => {
    for (const mark of [null, 'unread', 'needs-input', 'in-progress']) assert.ok(status.matchesChatStatusFilter(mark, 'ALL'));
    const under = (filter) => [null, 'unread', 'needs-input', 'in-progress'].filter((mark) => status.matchesChatStatusFilter(mark, filter));
    assert.deepEqual(under('READY'), ['unread']);
    assert.deepEqual(under('NEEDS_ATTENTION'), ['needs-input']);
    assert.deepEqual(under('IN_PROGRESS'), ['in-progress']);
  });
});

describe('the marks', () => {
  it('marks a reply that finished off screen Unread, and one that failed Needs input', () => {
    status.$chatSurfaceOnShow.set(false);
    const scope = 'test::settled';
    settle(scope, 'done');
    settle(scope, 'failed', { isError: true });
    settle(scope, 'stopped', { wasStopped: true });
    settle(scope, 'incognito', { isIncognito: true });
    assert.equal(status.chatStatusOf(scope, 'done'), 'unread');
    assert.equal(status.chatStatusOf(scope, 'failed'), 'needs-input');
    assert.equal(status.chatStatusOf(scope, 'stopped'), null, 'a reply the user stopped leaves no mark');
    assert.equal(status.chatStatusOf(scope, 'incognito'), null, 'an incognito chat leaves no mark');
  });

  it('leaves no mark on the chat on screen, and clears a chat\'s mark when it is opened', () => {
    const scope = 'test::screen';
    status.$chatSurfaceOnShow.set(true);
    status.reportChatOnScreen(scope, ['open', null, 'open']);
    settle(scope, 'open');
    settle(scope, 'renamed', { chatIdHistory: ['open'] });
    settle(scope, 'other');
    assert.equal(status.chatStatusOf(scope, 'open'), null);
    assert.equal(status.chatStatusOf(scope, 'renamed'), null, 'a chat named mid-reply was on screen under its old id');
    assert.equal(status.chatStatusOf(scope, 'other'), 'unread');
    status.reportChatOnScreen(scope, ['other']);
    assert.equal(status.chatStatusOf(scope, 'other'), null, 'opening a chat reads it');

    // Chat open behind another tab (Spark, Code) is not on screen; coming back to it reads it.
    status.$chatSurfaceOnShow.set(false);
    settle(scope, 'other');
    assert.equal(status.chatStatusOf(scope, 'other'), 'unread');
    status.$chatSurfaceOnShow.set(true);
    assert.equal(status.chatStatusOf(scope, 'other'), null);
    status.reportChatOnScreen(scope, []);
    status.$chatSurfaceOnShow.set(false);
  });

  it('ranks Needs input over In progress over Unread, as Gemini\'s badge does', () => {
    const scope = 'test::rank';
    settle(scope, 'read-later');
    const stopA = running('read-later');
    assert.equal(status.chatStatusOf(scope, 'read-later'), 'in-progress');
    stopA();
    assert.equal(status.chatStatusOf(scope, 'read-later'), 'unread');
    settle(scope, 'broken', { isError: true });
    const stopB = running('broken');
    assert.equal(status.chatStatusOf(scope, 'broken'), 'needs-input');
    stopB();
  });

  it('shows a Deep Research run In progress, then Unread or Needs input as it ends off screen', () => {
    const scope = 'test::research';
    status.trackResearchChat('run-1', scope, 'deep');
    assert.equal(status.chatStatusOf(scope, 'deep'), 'in-progress');
    status.noteResearchStatus('run-1', 'done');
    assert.equal(status.chatStatusOf(scope, 'deep'), 'unread');
    status.trackResearchChat('run-2', scope, 'deep-failed');
    status.noteResearchStatus('run-2', 'error');
    assert.equal(status.chatStatusOf(scope, 'deep-failed'), 'needs-input');
    status.trackResearchChat('run-3', scope, 'deep-canceled');
    status.noteResearchStatus('run-3', 'canceled');
    assert.equal(status.chatStatusOf(scope, 'deep-canceled'), null);
  });

  it('keeps marks per chat scope in localStorage, and rereads one another tab changed', () => {
    const one = 'signed-out::folder one';
    const two = 'signed-out::folder two';
    settle(one, 'shared');
    assert.equal(status.chatStatusOf(one, 'shared'), 'unread');
    assert.equal(status.chatStatusOf(two, 'shared'), null, 'a mark belongs to its account and folder');
    const key = `willow_chat_status:${encodeURIComponent(one)}`;
    assert.deepEqual(JSON.parse(localStorage.getItem(key)), { shared: 'unread' });

    localStorage.setItem(`willow_chat_status:${encodeURIComponent(two)}`, JSON.stringify({ shared: 'needs-input' }));
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: `willow_chat_status:${encodeURIComponent(two)}` });
    window.dispatchEvent(event);
    assert.equal(status.chatStatusOf(two, 'shared'), 'needs-input');
  });

  it('moves a mark with a chat the storage layer renamed, and forgets a deleted chat\'s', () => {
    const scope = 'test::follow';
    settle(scope, 'old name');
    window.dispatchEvent(new CustomEvent('willow_chat_id_moved', { detail: { from: 'old name', to: 'new name' } }));
    assert.equal(status.chatStatusOf(scope, 'old name'), null);
    assert.equal(status.chatStatusOf(scope, 'new name'), 'unread');
    window.dispatchEvent(new CustomEvent('willow_chat_deleted', { detail: { chatId: 'new name' } }));
    assert.equal(status.chatStatusOf(scope, 'new name'), null);
  });

  it('bumps chatStatusVersion when a mark changes, so the drawer recomputes', () => {
    const before = status.chatStatusVersion.get();
    settle('test::version', 'bumped');
    assert.ok(status.chatStatusVersion.get() > before);
  });
});

describe('the drawer', () => {
  const sidebar = read('apps/studio/src/shell/sidebar/Sidebar.tsx');

  it('lists the chats the filter keeps, and counts pins and the window from that list', () => {
    assert.match(sidebar, /const listedChats = useMemo\(\s*\(\) => \(statusFilter === 'ALL'\s*\?\s*sortedChats\s*:\s*sortedChats\.filter\(\(chat\) => matchesChatStatusFilter\(chatStatuses\.get\(chat\) \?\? null, statusFilter\)\)\)/);
    assert.match(sidebar, /visiblePinnedCount = useMemo\(\s*\(\) => listedChats\.reduce/);
    assert.match(sidebar, /const hasMoreRecents = effectiveRecentsLimit < listedChats\.length;/);
    assert.match(sidebar, /setRecentsLimit\(RECENTS_INITIAL_COUNT\);\s*\n\s*\}, \[chatScopeId, statusFilter\]\)/, 'a new filter starts the list from its top');
    assert.match(sidebar, /\}, \[sortedChats, chatScopeId, chatStatusTick, chatTurnTick\]\);/, 'marks recompute on turns and on flag changes');
  });

  it('names the filter in the heading, and keeps heading and funnel over a filter with no matches', () => {
    assert.match(sidebar, /title=\{chatStatusFilterLabel\(statusFilter\)\}\s*\n\s*actions=\{<ChatStatusFilterButton \/>\}/);
    const gate = sidebar.match(/\{([^\n]*?) && \(\s*<>\s*<SectionHeader\s+title=\{chatStatusFilterLabel/);
    assert.ok(gate, 'could not locate the chat section gate');
    assert.match(gate[1], /sortedChats\.length > 0/, 'gated on the filtered list, the funnel would vanish with its last match');
    assert.match(sidebar, /status=\{chatStatuses\.get\(chat\) \?\? null\}/);
  });

  it('takes marks from turns, research runs, the chat on screen and the shell tab', () => {
    const runner = read('features/chat/src/chat-turn-runner.ts');
    assert.match(runner, /noteChatTurnSettled\(record\);\s*\n[\s\S]{0,400}?claimChatTurnSettlement\(record\.turnId\)/);
    assert.match(read('features/chat/src/research/research-runner.ts'), /if \(patch\.status\) noteResearchStatus\(key, patch\.status\);/);
    const chatView = read('features/chat/src/ChatView.tsx');
    assert.match(chatView, /reportChatOnScreen\(chatScopeId, \[activeChatId, chatTitle, chatSessionId\]\)/);
    assert.match(chatView, /useEffect\(\(\) => \(\) => reportChatOnScreen\(chatScopeId, \[\]\), \[chatScopeId\]\);/);
    assert.match(chatView, /trackResearchChat\(replyId, chatScopeId, chatTitle \|\| chatSessionId\);/);
    assert.match(read('apps/studio/src/app/App.tsx'), /\$chatSurfaceOnShow\.set\(shellTab === 'chat'\)/);
  });
});

describe('the funnel and its menu', () => {
  const source = read('apps/studio/src/shell/sidebar/ChatStatusFilter.tsx');

  it('is a menu button over radio rows, portalled out of the sidebar', () => {
    assert.match(source, /aria-label="Filter"\s*\n\s*aria-haspopup="true"\s*\n\s*aria-expanded=\{open\}/);
    assert.match(source, /role="menu"/);
    assert.match(source, /role="menuitemradio"\s*\n\s*aria-checked=\{selected\}\s*\n\s*tabIndex=\{index === active \? 0 : -1\}/);
    assert.match(source, /document\.body,\s*\n\s*\)\}/);
    assert.match(source, /name="filter_alt"\s*\n\s*family="luminous"\s*\n\s*size=\{compact \? 24 : 20\}\s*\n\s*weight=\{compact \? 300 : 320\}/);
  });

  it('hangs 4px under the funnel, or 4px over it without room, pushed inside the window', () => {
    assert.match(source, /const GAP = 4;/);
    assert.match(source, /const top = below \+ height <= window\.innerHeight \? below : Math\.max\(0, anchor\.top - GAP - height\);/);
    assert.match(source, /const left = Math\.max\(0, Math\.min\(anchor\.left, window\.innerWidth - width\)\);/);
  });

  it('opens on the chosen row; the arrows wrap, Escape and Tab close it through the funnel', () => {
    assert.match(source, /setActive\(Math\.max\(0, CHAT_STATUS_FILTERS\.indexOf\(filter\)\)\)/);
    assert.match(source, /'ArrowDown'\) \{ event\.preventDefault\(\); setActive\(\(i\) => \(i === last \? 0 : i \+ 1\)\); \}/);
    assert.match(source, /'ArrowUp'\) \{ event\.preventDefault\(\); setActive\(\(i\) => \(i === 0 \? last : i - 1\)\); \}/);
    assert.match(source, /'Escape'\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); close\(true\); \}/, 'Escape must not reach the drawer');
    assert.match(source, /'Tab'\) close\(true\);/, 'Tab moves on from the funnel, with no preventDefault');
  });

  it('has no backdrop: a press elsewhere closes it and still lands', () => {
    assert.match(source, /document\.addEventListener\('pointerdown', onPointerDown, true\)/);
    const handler = source.match(/const onPointerDown = \(event: PointerEvent\) => \{([\s\S]*?)\n {4}\};/);
    assert.ok(handler, 'could not locate the outside-press handler');
    assert.ok(!/preventDefault|stopPropagation/.test(handler[1]));
  });

  it('ripples from the funnel\'s centre, as Gemini\'s centred icon buttons do', () => {
    assert.match(source, /launchMaterialRipple\(ripplesRef\.current, 'chat-status-filter-ripple', box\.left \+ box\.width \/ 2, box\.top \+ box\.height \/ 2\)/);
  });
});

describe('the measured look', () => {
  const css = stripComments(read('apps/studio/src/shell/sidebar/ChatStatusFilter.css'));
  const rule = (scope, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[{}])\\s*${escaped} \\{([^}]*)\\}`).exec(scope)?.[1] ?? '';
  };
  const block = (at) => {
    const start = css.indexOf(`${at} {`);
    assert.ok(start >= 0, `no ${at} block`);
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
    }
    return '';
  };
  const has = (decls, ...wanted) => { for (const decl of wanted) assert.ok(decls.includes(decl), `missing \`${decl}\` in {${decls}}`); };

  it('draws the desktop funnel: 24px, white at 55%, an 8% and 12% #c4c7c5 layer, a 3px ring', () => {
    has(rule(css, '.chat-status-filter-button'), 'width: 24px;', 'height: 24px;', 'margin-right: 2px;', 'color: rgba(255, 255, 255, 0.55);', 'border-radius: 9999px;');
    has(rule(css, '.chat-status-filter-button::before'), 'background-color: #c4c7c5;', 'opacity: 0;');
    has(rule(css, '.chat-status-filter-button:hover::before'), 'opacity: 0.08;');
    has(rule(css, '.chat-status-filter-button:active::before'), 'opacity: 0.12;');
    has(rule(css, '.chat-status-filter-button:focus-visible'), 'outline: 3px solid #e6e6e6;', 'outline-offset: 2px;');
    has(rule(css, '.chat-status-filter-ripple'), 'background-color: rgba(230, 230, 230, 0.1);');
  });

  it('draws the desktop menu: a 20px-cornered #1f1f1f panel of 36px rows', () => {
    has(rule(css, '.chat-status-filter-menu'), 'padding: 8px;', 'border-radius: 20px;', 'background-color: #1f1f1f;', 'box-shadow: 0 0 20px 0 rgba(0, 0, 0, 0.28);');
    has(rule(css, '.chat-status-filter-item'), 'height: 36px;', 'gap: 8px;', 'padding: 8px;', 'border-radius: 12px;');
    has(rule(css, '.chat-status-filter-item[aria-checked="true"]'), 'background-color: #171717;');
    has(rule(css, '.chat-status-filter-item:focus-visible'), 'outline: 2px solid #e6e6e6;', 'outline-offset: -2px;');
    has(rule(css, '.chat-status-filter-label'), 'font-size: 13px;', 'line-height: 17px;');
    has(rule(block('@media (hover: hover)'), '.chat-status-filter-item:hover'), 'background-color: rgba(230, 230, 230, 0.08);');
    // A plain rectangle of the panel's colour behind the rows keeps the text subpixel-rendered.
    has(rule(css, '.chat-status-filter-list'), 'background-color: inherit;');
  });

  it('neither animates in nor out, as Gemini\'s appears and goes in one frame', () => {
    for (const selector of ['.chat-status-filter-menu', '.chat-status-filter-list', '.chat-status-filter-item']) {
      assert.ok(!/\b(animation|transition)\b/.test(rule(css, selector)), `${selector} animates`);
    }
    assert.deepEqual([...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]), ['chat-status-rotate']);
  });

  it('grows for phones and tablets: a 36px funnel, 48px rows, 17px labels on #1c1c1c', () => {
    const narrow = block('@media (max-width: 960px)');
    has(rule(narrow, '.chat-status-filter-button'), 'width: 36px;', 'height: 36px;', 'margin-right: 11px;', 'padding: 6px;');
    has(rule(narrow, '.chat-status-filter-menu'), 'background-color: #1c1c1c;');
    has(rule(narrow, '.chat-status-filter-item'), 'height: 48px;', 'padding: 12px;');
    has(rule(narrow, '.chat-status-filter-item[aria-checked="true"]'), 'background-color: #141414;');
    has(rule(narrow, '.chat-status-filter-label'), 'font-size: 17px;', 'line-height: 24px;');
  });

  it('marks rows with a #fe4a00 flag, a 2s turning spinner (still under reduced motion) or an 8px #3186ff dot', () => {
    has(rule(css, '.chat-status-mark--needs-input'), 'color: #fe4a00;');
    has(rule(css, '.chat-status-mark--in-progress'), 'animation: chat-status-rotate 2s linear infinite;');
    has(rule(block('@media (prefers-reduced-motion: reduce)'), '.chat-status-mark--in-progress'), 'animation: none;');
    has(rule(css, '.chat-status-mark--unread::before'), 'width: 8px;', 'height: 8px;', 'background-color: #3186ff;');
  });

  it('rests a row\'s mark over its menu slot on desktops, and before the always-shown menu on touch', () => {
    const row = read('apps/studio/src/shell/sidebar/RecentChatRow.tsx');
    assert.match(row, /sidebar-row-status pointer-events-none order-1 -ml-6 flex h-6 w-6 shrink-0 items-center justify-center max-\[960px\]:order-none max-\[960px\]:ml-0 max-\[960px\]:mr-px max-\[960px\]:h-4 max-\[960px\]:w-4/);
    assert.match(row, /isMenuOpen \|\| startedInCode \? 'hidden' : 'min-\[961px\]:group-hover\/item:hidden'/);
    assert.match(row, /keepActionsVisible=\{isPinned \|\| !!status \|\| isMenuOpen \|\| startedInCode\}/);
  });

  it('asks for Luminous Symbols with its optical sizes, as Gemini\'s kit has them', () => {
    // Without opsz every glyph draws at its 24px design, so 16 and 20px icons come out heavier.
    assert.match(read('tools/icons/icon-kit-superset.cjs'), /query: 'Luminous\+Symbols:opsz,wght@20\.\.48,100\.\.700'/);
  });
});
