import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const browseUrl = await importTs(path.join(ROOT, 'features/spark/src/remote-browser/browse-url.ts'));
const proxy = await import(new URL('../../../api/_browse-proxy.js', import.meta.url));
const privateHost = await import(new URL('../../../api/_private-host.js', import.meta.url));
const requests = await importTs(path.join(ROOT, 'features/spark/src/remote-browser/browser-requests.ts'));
const { createSparkCapabilityTools, computerRequestFrom, BROWSER_PERMISSION_RESPONSE } = await importTs(
  path.join(ROOT, 'features/spark/src/harness/spark-tools.ts'),
);

describe('remote browser URLs', () => {
  const origins = [
    'https://www.example.com',
    'http://example.com:8080',
    'https://html.duckduckgo.com',
    `https://${'very-long-subdomain-label.'.repeat(4)}example.org`,
  ];

  it('encodes origins exactly as the proxy does, in valid DNS labels', () => {
    for (const origin of origins) {
      const encoded = browseUrl.encodeOrigin(origin);
      assert.equal(encoded, proxy.encodeOrigin(origin), origin);
      assert.equal(browseUrl.decodeOrigin(encoded), origin);
      for (const label of encoded.split('.')) assert.ok(label.length <= 63 && /^[a-z2-7]+$/.test(label), label);
    }
  });

  it('maps a page onto its proxy origin and back, keeping path, query and hash', () => {
    const target = 'https://www.example.com/a/b?c=1#d';
    const proxied = browseUrl.toBrowseUrl(target, '3000');
    assert.equal(proxied, proxy.toBrowseUrl(target, '3000'));
    assert.match(proxied, /^http:\/\/[a-z2-7.]+\.wb\.localhost:3000\/a\/b\?c=1#d$/);
    assert.equal(browseUrl.fromBrowseUrl(proxied), target);
    assert.deepEqual(proxy.parseBrowseHost(new URL(proxied).host), { origin: 'https://www.example.com', port: '3000' });
    assert.equal(browseUrl.fromBrowseUrl('https://plain.example/x'), 'https://plain.example/x');
  });

  it('drops the post/redirect/get token from the address it reports', () => {
    const base = browseUrl.toBrowseUrl('https://html.duckduckgo.com/html/', '3000');
    assert.equal(browseUrl.fromBrowseUrl(`${base}?__willow_post=abc123`), 'https://html.duckduckgo.com/html/');
    assert.equal(
      browseUrl.fromBrowseUrl(browseUrl.toBrowseUrl('https://x.example/s?q=1', '3000').replace('?q=1', '?q=1&__willow_post=t&p=2')),
      'https://x.example/s?q=1&p=2',
    );
  });

  it('normalizes what the agent or the omnibox types', () => {
    assert.equal(browseUrl.normalizeBrowseTarget('example.com'), 'https://example.com/');
    assert.equal(browseUrl.normalizeBrowseTarget('  http://a.example/x '), 'http://a.example/x');
    assert.equal(browseUrl.normalizeBrowseTarget('javascript:alert(1)'), null);
    assert.equal(browseUrl.normalizeBrowseTarget('file:///etc/passwd'), null);
    assert.equal(browseUrl.normalizeBrowseTarget(''), null);
    assert.equal(browseUrl.displayUrl('https://www.wolframalpha.com/input?i=x'), 'wolframalpha.com/input?i=x');
  });
});

describe('remote browser proxy', () => {
  it('splits the post token out of a request path', () => {
    assert.deepEqual(proxy.splitPostToken('/html/?__willow_post=abc'), { path: '/html/', token: 'abc' });
    assert.deepEqual(proxy.splitPostToken('/s?q=1&__willow_post=t&x=2'), { path: '/s?q=1&x=2', token: 't' });
    assert.deepEqual(proxy.splitPostToken('/a?__willow_post=t#frag'), { path: '/a#frag', token: 't' });
    assert.deepEqual(proxy.splitPostToken('/plain?q=1'), { path: '/plain?q=1', token: null });
  });

  it('refuses private, loopback and link-local hosts', () => {
    for (const host of ['localhost', 'a.localhost', 'nas.local', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '[::1]', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.equal(privateHost.isPrivateHost(host), true, host);
    }
    for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) {
      assert.equal(privateHost.isPrivateHost(host), false, host);
    }
  });

  it('injects the bridge first in <head> and drops the page’s own CSP', () => {
    const html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src none"><title>t</title></head><body></body></html>';
    const out = proxy.injectBridge(html, 'https://example.com');
    assert.match(out, /<head><script data-willow-browse>/);
    assert.doesNotMatch(out, /script-src none/);
  });

  it('upgrades insecure subresources on https sites only', () => {
    // A scheme-less "//host/a.png" takes the proxy's http; on the real site it is https.
    const html = '<html><head></head><body><img src="//upload.example.org/a.png"></body></html>';
    assert.match(proxy.injectBridge(html, 'https://example.com'), /<\/script><meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">/);
    assert.doesNotMatch(proxy.injectBridge(html, 'http://example.com'), /upgrade-insecure-requests/);
  });

  it('turns a POSTed page into a 303 to a tokened GET', () => {
    const source = read('api/_browse-proxy.js');
    assert.match(source, /method === 'POST' && wantsDocument && upstream\.status === 200/);
    assert.match(source, /res\.statusCode = 303;\s*res\.setHeader\('Location', withPostToken\(requestPath, rememberPostedPage\(html\)\)\)/);
    assert.match(source, /if \(postToken !== null && method === 'GET'\)/);
  });
});

describe('remote browser bridge capture', () => {
  const bridge = read('api/_browse-bridge.js');

  it('reports a parsed document separately from a finished load', () => {
    assert.match(bridge, /loading: document\.readyState !== 'complete',\s*parsed: document\.readyState !== 'loading',/);
  });

  it('gives the root its viewport overflow in the clone', () => {
    assert.match(bridge, /function releaseViewportOverflow\(clone\)/);
    assert.match(bridge, /clone\.documentElement\.style\.setProperty\('overflow', 'visible', 'important'\)/);
  });

  it('leaves off-screen subtrees out of the clone and lines the clone up with the live page', () => {
    assert.match(bridge, /ignoreElements: plan \? function \(element\) \{\s*return plan\.skip\.has\(element\) \|\| plan\.boxes\.has\(element\.parentElement\);/);
    assert.match(bridge, /onclone: function \(clone\) \{ return prepareClone\(clone, plan\); \}/);
    assert.match(bridge, /clone\.defaultView\.scrollTo\(window\.scrollX, window\.scrollY\)/);
    // The markers come off the live page as soon as the synchronous copy is taken.
    assert.match(bridge, /markCapture\(plan, true\);\s*try \{[\s\S]*?return html2canvas\([\s\S]*?\} finally \{\s*markCapture\(plan, false\);/);
  });

  it('keeps fixed, sticky and on-screen content whole', () => {
    assert.match(bridge, /if \(position !== 'fixed' && position !== 'sticky'\) continue;\s*\}\s*for \(var node = element; node && !keep\.has\(node\); node = node\.parentElement\) keep\.add\(node\);/);
  });

  it('only empties boxes whose margins cannot leak', () => {
    assert.match(bridge, /function sealsMargins\(element, style, parentStyle\)/);
    assert.match(bridge, /if \(sealsMargins\(child, style, parentStyle\)\) boxes\.set\(child, style\.width \+ ',' \+ style\.height\);\s*else queue\.push\(child\);/);
  });

  it('draws srcset images from the file they chose, and masked icons from their mask', () => {
    assert.match(bridge, /img\.removeAttribute\('srcset'\);[\s\S]*?img\.src = chosen;/);
    assert.match(bridge, /target\.setProperty\('background-image', mask, 'important'\)/);
  });
});

describe('remote browser frames', () => {
  const TAG = '__willowBrowse';
  let frames;
  let iframe;
  const posted = [];
  const replaced = [];
  const messageListeners = [];

  const fakeElement = () => {
    const handlers = {};
    const attributes = {};
    let src = '';
    return {
      style: { removeProperty(name) { delete this[name]; } },
      appendChild() {},
      remove() {},
      setAttribute(name, value) { attributes[name] = String(value); },
      getAttribute(name) { return name === 'src' ? (src || null) : (attributes[name] ?? null); },
      addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
      fire(type) { (handlers[type] || []).forEach((handler) => handler()); },
      get src() { return src; },
      set src(value) { src = value; },
      contentWindow: {
        postMessage: (message) => posted.push(message),
        location: { replace: (url) => replaced.push(url) },
      },
    };
  };

  const send = (data) => messageListeners.forEach((listener) => listener({ source: iframe.contentWindow, data: { [TAG]: 1, ...data } }));
  const ready = (url) => send({
    event: 'ready', url, title: url, favicon: '', loading: false, parsed: true,
    width: 1280, height: 937, canGoBack: false, canGoForward: false,
  });

  before(async () => {
    globalThis.window = { addEventListener: (type, listener) => { if (type === 'message') messageListeners.push(listener); } };
    globalThis.document = { createElement: () => fakeElement(), getElementById: () => null, body: { appendChild() {} } };
    frames = await importTs(path.join(ROOT, 'features/spark/src/remote-browser/remote-browser-frames.ts'));
    iframe = frames.ensureRemoteFrame('task-1', 'https://a.example/');
  });

  it('tracks a bridged page and marks a navigation as leaving at once', () => {
    ready('https://a.example/');
    iframe.fire('load');
    assert.equal(frames.isRemoteFrameUnbridged('task-1'), false);
    assert.equal(frames.remoteFrameState('task-1').parsed, true);
    frames.navigateRemoteFrame('task-1', 'https://a.example/doc.pdf');
    assert.equal(frames.remoteFrameState('task-1').parsed, false);
  });

  it('treats a load with no bridge as a dead page, labelled with where it was headed', async () => {
    iframe.fire('load');
    assert.equal(frames.isRemoteFrameUnbridged('task-1'), true);
    const state = frames.remoteFrameState('task-1');
    assert.equal(state.url, 'https://a.example/doc.pdf');
    assert.equal(state.parsed, true);
    assert.equal(state.canGoBack, true);
    await assert.rejects(frames.callRemoteFrame('task-1', 'click'), { message: frames.UNBRIDGED_PAGE_ERROR });
  });

  it('goes back from a dead page by replacing it with the last bridged page', async () => {
    assert.deepEqual(await frames.stepRemoteFrame('task-1', 'forward'), { success: false, error: 'There is no later page to go forward to.' });
    assert.deepEqual(await frames.stepRemoteFrame('task-1', 'back'), { success: true });
    assert.match(replaced.at(-1), /^http:\/\/[a-z2-7.]+\.wb\.localhost\/$/);
    assert.equal(browseUrl.fromBrowseUrl(replaced.at(-1)), 'https://a.example/');
  });

  it('asks a bridged page to step itself', async () => {
    ready('https://a.example/');
    iframe.fire('load');
    const step = frames.stepRemoteFrame('task-1', 'back');
    const request = posted.at(-1);
    assert.equal(request.op, 'back');
    send({ id: request.id, ok: true, result: { success: true, navigating: true } });
    assert.deepEqual(await step, { success: true, navigating: true });
  });

  it('holds a first page back while the pane opens, and shows it once it has loaded', async () => {
    const held = frames.ensureRemoteFrame('task-2', 'https://b.example/', { loadAfterMs: 30 });
    assert.equal(held.src, '');
    assert.equal(held.style.opacity, '0');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(browseUrl.fromBrowseUrl(held.src), 'https://b.example/');
    held.fire('load');
    assert.equal(held.style.opacity, undefined);
    // A navigation before the held page starts takes its place.
    const raced = frames.ensureRemoteFrame('task-3', 'https://c.example/', { loadAfterMs: 30 });
    frames.navigateRemoteFrame('task-3', 'https://d.example/');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(browseUrl.fromBrowseUrl(raced.src), 'https://d.example/');
  });
});

describe('remote browser in the thread', () => {
  const detail = read('features/spark/src/SparkTaskDetail.tsx');
  const workspace = read('features/spark/src/SparkWorkspace.tsx');
  const driver = read('features/spark/src/remote-browser/run-remote-browser.ts');

  it('only the latest turn can be waiting on a card, and a question is not a card', () => {
    const request = { id: 'r1', title: 't', task: 'do it', status: 'pending', createdAt: '' };
    const task = { status: 'needs-input', browserRequest: request, turns: [] };
    assert.equal(requests.isAwaitingBrowserPermission(task), true);
    assert.equal(requests.isAwaitingBrowserPermission({ ...task, turns: [{ id: 'n', prompt: 'next' }] }), false);
    assert.equal(requests.isAwaitingBrowserPermission({ ...task, browserRequest: undefined }), false);
    assert.equal(requests.findBrowserRequest({ ...task, turns: [{ id: 'u', browserRequest: { ...request, id: 'r2' } }] }, 'r2').turnId, 'u');
  });

  it('keeps the box live under a card, and writing turns the request down', () => {
    assert.match(detail, /const followUpPlaceholder = 'Ask a follow-up';/);
    assert.match(detail, /const followUpBlocked = isTaskActive\(currentTask\);/);
    assert.doesNotMatch(detail, /followUpLocked/);
    assert.match(workspace, /const pending = awaitingBrowser \? pendingBrowserRequest\(activeTask\) : null;\s*if \(pending\) \{\s*const declined = \{ \.\.\.pending\.request, status: 'denied' as const \};/);
  });

  it('names the processing header by phase, as Gemini does', () => {
    assert.match(detail, /const heading = phase \? 'Thinking it through…' : 'Thoughts';/);
  });

  it('never lets a page that cannot be captured end the browser task', () => {
    assert.match(driver, /if \(!shot\) \{\s*const url = remoteFrameState\(taskId\)\?\.url \|\| '';\s*shot = \{ dataUrl: unreachablePageShot\(url, isRemoteFrameUnbridged\(taskId\)\), url, title: displayUrl\(url\) \};/);
    assert.match(driver, /case 'go_back':\s*case 'go_forward':\s*return await stepRemoteFrame\(taskId, action\.name === 'go_back' \? 'back' : 'forward'\);/);
  });

  it('waits for a parsed page, not for every image and tracker', () => {
    assert.match(driver, /await waitUntil\(\(\) => pageParsed\(taskId\), PAGE_LOAD_TIMEOUT_MS, signal\);\s*await waitUntil\(\(\) => pageLoaded\(taskId\), LOAD_GRACE_MS, signal\);/);
  });
});

describe('remote browser on phones and tablets', () => {
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const mediaBodies = (css, query) => {
    const opener = `@media ${query} {`;
    const bodies = [];
    for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + 1)) {
      let depth = 1;
      let i = at + opener.length;
      for (; i < css.length && depth > 0; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') depth -= 1;
      }
      bodies.push(css.slice(at + opener.length, i - 1));
    }
    return bodies.join('\n');
  };
  const detail = read('features/spark/src/SparkTaskDetail.tsx');
  const pane = read('features/spark/src/remote-browser/SparkRemoteBrowserPane.tsx');
  const detailCss = stripComments(read('features/spark/src/SparkTaskDetail.css'));
  const paneCss = stripComments(read('features/spark/src/remote-browser/SparkRemoteBrowserPane.css'));
  const compact = mediaBodies(detailCss, '(max-width: 960px)');

  it('opens the pane full-screen in Gemini’s overlay below 961px, and beside the chat above', () => {
    assert.match(detail, /const isRemoteBrowserOpen = remoteBrowserPane === 'open' && !isCompact;/);
    assert.match(detail, /const isRemoteBrowserOverlayOpen = remoteBrowserPane === 'open' && isCompact;/);
    // Filling the screen with its own close, or (after a take-over) the card under the overlay's bar.
    assert.match(detail, /\{isRemoteBrowserOverlayOpen && remoteBrowserFullscreen && \(\s*<div className="spark-task-detail__progress-overlay" role="dialog" aria-modal="true" aria-label="Remote computer">\s*<SparkRemoteBrowserPane taskId=\{currentTask\.id\} onClose=\{\(\) => closeRemoteBrowserPane\(currentTask\.id\)\} compact fullscreen \/>/);
    assert.match(detail, /\{isRemoteBrowserOverlayOpen && !remoteBrowserFullscreen && \(\s*<div className="spark-task-detail__progress-overlay" role="dialog" aria-modal="true" aria-label="Remote browser">[\s\S]*?aria-label="Close panel"[\s\S]*?<SparkRemoteBrowserPane taskId=\{currentTask\.id\} onClose=\{\(\) => closeRemoteBrowserPane\(currentTask\.id\)\} compact \/>/);
  });

  it('draws the overlay’s card as Gemini’s narrow side panel, and nowhere on the desktop', () => {
    assert.match(compact, /\.spark-task-detail__browser-overlay-panel \{[^}]*border: 0\.8px solid #141414;[^}]*border-radius: 28px;[^}]*background: #1c1c1c;/);
    assert.ok(!stripComments(detailCss.replace(/@media \(max-width: 960px\) \{[\s\S]*$/, '')).includes('browser-overlay-panel'),
      'the card rule must stay inside the compact block');
  });

  it('leaves the card’s close to the overlay’s bar and writes the narrow disclaimer', () => {
    assert.match(pane, /\{\(!compact \|\| filling\) && \(\s*<div className="spark-remote-browser__header-actions">/);
    assert.match(pane, /Manage permissions in Skills & apps\./);
    assert.match(pane, /\{compact \? COMPACT_DISCLAIMER : DISCLAIMER\}/);
  });

  it('shows the scrim on the first tap instead of pressing a hidden button', () => {
    assert.match(pane, /if \(interactive \|\| event\.pointerType === 'mouse' \|\| touchRevealed\) return;\s*swallowClickRef\.current = true;\s*setTouchRevealed\(true\);/);
    assert.match(pane, /onClickCapture=\{\(event\) => \{\s*if \(!swallowClickRef\.current\) return;/);
    assert.match(paneCss, /\.spark-remote-browser__scrim\.is-revealed \{\s*opacity: 1;/);
  });

  it('opens and closes on the spot below 961px, as Gemini’s overlay does', () => {
    for (const selector of ['.spark-task-detail__progress-overlay', '.spark-task-detail__browser-overlay-panel']) {
      const rule = new RegExp(`${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(compact)?.[1] ?? '';
      assert.doesNotMatch(rule, /animation|transition/, selector);
    }
  });

  it('gives the monitor menu Gemini’s narrow row', () => {
    assert.match(compact, /\.spark-task-detail__browser-menu button \{[^}]*font-size: 14px;[^}]*font-weight: 500;[^}]*line-height: 20px;/);
    assert.match(compact, /\.spark-task-detail__task-menu\.spark-task-detail__browser-menu \{[^}]*min-width: max-content;/);
  });
});

describe('remote browser motion on the desktop', () => {
  const detail = read('features/spark/src/SparkTaskDetail.tsx');
  const css = read('features/spark/src/SparkTaskDetail.css').replace(/\/\*[\s\S]*?\*\//g, '');

  // Recorded frame by frame in Gemini: in the first frame the card already has its
  // two thirds, transparent; it fades in while the task list collapses beside it.
  it('opens the card at its share and fades it in, on Gemini’s 450ms emphasised clock', () => {
    assert.match(css, /\.spark-task-detail__side-panel \{[^}]*transition:\s*flex 450ms cubic-bezier\(0\.2, 0, 0, 1\),\s*opacity 450ms cubic-bezier\(0\.2, 0, 0, 1\);/);
    assert.match(css, /@starting-style \{\s*\.spark-task-detail__side-panel \{\s*opacity: 0;\s*\}\s*\}/);
  });

  it('hands the card between the browser and Progress instead of swapping two cards', () => {
    // An open file is the side panel's third state (`spark-file-open.test.mjs`).
    assert.match(detail, /const sidePanel = isFileOpen \? 'file' : isRemoteBrowserOpen \? 'browser' : isProgressPanelOpen \? 'progress' : null;/);
    assert.match(detail, /const sidePanelHandoff = previousSidePanel && sidePanel && previousSidePanel !== sidePanel \? sidePanel : null;/);
    assert.match(detail, /spark-task-detail__progress-panel\$\{isProgressPanelOpen \? ' is-open' : ''\}\$\{sidePanelHandoff === 'progress' \? ' is-taking-over' : ''\}/);
    assert.match(detail, /spark-task-detail__side-panel\$\{sidePanelHandoff === 'browser' \? widePanelHandoff : ''\}/);
    // Out of Progress it grows; in a file's place it takes the width it shares.
    assert.match(detail, /const widePanelHandoff = previousSidePanel === 'progress' \? ' is-taking-over' : ' is-replacing';/);
    // Closing: Progress starts at the browser's share, opaque, and shrinks to 300px.
    assert.match(css, /@starting-style \{\s*\.spark-task-detail__progress-panel\.is-open\.is-taking-over \{\s*flex: 2 1 0%;\s*opacity: 1;/);
    // Opening over Progress: the card starts at Progress's 300px.
    assert.match(css, /@starting-style \{\s*\.spark-task-detail__side-panel\.is-taking-over \{\s*flex: 0 0 300px;\s*opacity: 1;/);
  });

  it('lets the viewer join the card late, so it never zooms with it', () => {
    const pane = read('features/spark/src/remote-browser/SparkRemoteBrowserPane.tsx');
    assert.match(detail, /<SparkRemoteBrowserPane\s*taskId=\{currentTask\.id\}\s*onClose=\{closeRemoteBrowser\}\s*viewerDelayMs=\{265\}/);
    assert.match(pane, /const \[viewerReady, setViewerReady\] = useState\(viewerDelayMs <= 0\);/);
    assert.match(pane, /\{!session\.inControl && viewerReady && \(/);
  });

  it('takes the monitor button out at once and brings it back over 300ms', () => {
    assert.match(detail, /\{canViewRemoteBrowser && \(\s*<SparkRemoteBrowserMenu\s*key=\{currentTask\.id\}\s*hidden=\{isRemoteBrowserOpen\}/);
    assert.match(detail, /<span className="spark-task-detail__browser-menu-anchor">/);
    assert.match(detail, /\$\{hidden \? ' is-hidden' : ''\}/);
    assert.match(css, /\.spark-task-detail__browser-menu-anchor > \.spark-task-detail__header-icon \{\s*transition: background-color 140ms ease, color 140ms ease, opacity 300ms ease, scale 300ms ease;/);
    assert.match(css, /\.spark-task-detail__browser-menu-anchor > \.spark-task-detail__header-icon\.is-hidden \{\s*width: 0;[^}]*opacity: 0;\s*scale: 0\.9;/);
  });

  it('fades the menu out as Material’s does', () => {
    assert.match(css, /\.spark-task-detail__browser-menu\.is-closing \{\s*pointer-events: none;\s*animation: spark-task-response-menu-exit 100ms linear 25ms forwards;/);
    assert.match(detail, /role="menuitem"\s*onClick=\{\(\) => \{\s*close\(\);\s*onView\(\);/);
  });

  // Flex transitions run on the main thread: a full redraw of the task stalls them.
  it('keeps the task from redrawing while the card grows', () => {
    assert.match(detail, /const useRemoteBrowserPane = \(taskId: string\): 'none' \| 'closed' \| 'open' =>\s*useSyncExternalStore\(subscribeRemoteBrowsers,/);
    assert.doesNotMatch(detail, /useStore\(remoteBrowserSessions\)/);
    // No state set while rendering: that runs the whole component twice in the click.
    assert.doesNotMatch(detail, /setPreviousSidePanel|setSidePanelHandoff/);
    assert.match(detail, /const viewRemoteBrowser = \(\) => \{\s*setStatusOpen\(false\);\s*if \(!isCompact\) setLibraryCollapsed\(true\);/);
    assert.match(detail, /const closeRemoteBrowser = \(\) => \{\s*setLibraryCollapsed\(true\);\s*closeRemoteBrowserPane\(currentTask\.id\);/);
    // The task list's rows are kept between renders, and its fade is not read as it collapses.
    assert.match(detail, /const libraryRows = useMemo\(\(\) => filteredTasks\.map\(\(recentTask\) => \{/);
    assert.match(detail, /\{libraryRows\}/);
    assert.match(detail, /if \(!libraryCollapsed\) updateFade\(\);/);
    // The browser frame around the page does not redraw with each scale step.
    assert.match(read('features/spark/src/remote-browser/SparkRemoteBrowserPane.tsx'), /const MemoRemoteBrowserChrome = React\.memo\(RemoteBrowserChrome\);/);
    // The anchored reply's floor follows the resizing panel on the element itself.
    assert.match(detail, /if \(floor\) floor\.style\.minHeight = `\$\{reserve\}px`;\s*window\.clearTimeout\(settle\);\s*settle = window\.setTimeout\(\(\) => setAnchorReserve\(reserve\), 200\);/);
    // The menu's fade-out state is the menu's own.
    assert.match(detail, /const SparkRemoteBrowserMenu: React\.FC<\{[\s\S]*?const \[closing, setClosing\] = useState\(false\);/);
  });

  it('loads a browser the page has not opened yet only once the card has grown in', () => {
    const store = read('features/spark/src/remote-browser/remote-browser-store.ts');
    assert.match(store, /ensureRemoteBrowserSession\(taskId, seed, \{ loadFrameAfterMs: 480 \}\);\s*updateRemoteBrowserSession\(taskId, \{ paneOpen: true, fullscreen: true \}\);/);
  });
});

describe('what the remote browser saw, kept', () => {
  const store = read('features/spark/src/remote-browser/remote-browser-store.ts');
  const shots = read('features/spark/src/remote-browser/remote-browser-shots.ts');
  const pane = read('features/spark/src/remote-browser/SparkRemoteBrowserPane.tsx');
  const paneCss = read('features/spark/src/remote-browser/SparkRemoteBrowserPane.css');
  const workspace = read('features/spark/src/SparkWorkspace.tsx');

  it('keeps every screenshot, in IndexedDB and beside the task, with nothing capped', () => {
    assert.doesNotMatch(store, /MAX_SHOTS/);
    assert.match(shots, /const DB_NAME = 'willow-spark-browser';/);
    assert.match(shots, /const STEPS_FILE = `\$\{CONVERSATION_FOLDERS\.browser\}\/steps\.json`;/);
    assert.match(shots, /return `\$\{String\(index \+ 1\)\.padStart\(3, '0'\)\} \$\{safeFileStem\(host, 'page'\)\}\.jpg`;/);
    assert.match(shots, /\{ path: STEPS_FILE, read: \(\) => stepsDocument\(taskId, history\), replace: true \}/);
  });

  it('brings a task’s history back after a reload, and continues it rather than overwriting it', () => {
    assert.match(store, /histories\.set\(taskId, restoreHistory\(taskId\)\.catch\(\(\) => undefined\)\);/);
    assert.match(store, /void \(histories\.get\(taskId\) \?\? Promise\.resolve\(\)\)\.then\(\(\) => \{\s*const current = remoteBrowserSessions\.get\(\)\[taskId\];\s*if \(!current\) return;\s*const next = nextRemoteBrowserShot\(current\.shots,/);
    assert.match(shots, /const index = taken\.reduce\(\(highest, existing\) => Math\.max\(highest, existing\.index\), -1\) \+ 1;/);
    // The folder's list stands in for a browser that has none.
    assert.match(shots, /const steps = await sparkDisk\(\)\?\.read\(taskId, STEPS_FILE\)/);
  });

  it('reads a step from this session, then the browser, then the folder', () => {
    assert.match(shots, /const held = pending\.get\(pendingKey\(taskId, shot\)\);\s*if \(held\) return held;[\s\S]*?const stored = await loadShotBlob\(scope, taskId, shot\.index\)[\s\S]*?const file = await sparkDisk\(\)\?\.read\(taskId, shot\.file\)/);
    assert.match(pane, /const shotImage = useRemoteBrowserShotImage\(taskId, viewing\);/);
  });

  it('says a step’s image is gone instead of showing a broken one', () => {
    assert.match(pane, /\{viewing && shotImage\.missing && <RemoteBrowserShotUnavailable shot=\{viewing\} top=\{CHROME_HEIGHT \* scale\} \/>\}/);
    assert.match(pane, />Screenshot unavailable<\/span>/);
    assert.match(pane, /onError=\{shotImage\.fail\}/);
    assert.match(paneCss, /\.spark-remote-browser__unavailable \{[^}]*z-index: 3;[^}]*background: #1e1f20;/);
    // Under the scrim, so previous, next and View Live still work over it.
    assert.match(paneCss, /\.spark-remote-browser__scrim \{[^}]*z-index: 4;/);
  });

  it('shows the dots around the step on screen, however long the history', () => {
    assert.match(pane, /const MAX_HISTORY_DOTS = 15;/);
    assert.match(pane, /shots\.slice\(start, start \+ MAX_HISTORY_DOTS\)/);
  });

  it('writes a task’s attachments beside it, and removes its files with it', () => {
    assert.match(workspace, /write: \(taskId, files\) => writeLocalFSConversationFiles\(SPARK_TASKS_FOLDER, taskId, files\),/);
    assert.match(workspace, /if \(sparkDiskReady\) mirrorSparkTaskAttachments\(tasks, getActiveSparkStorageScope\(\)\);/);
    assert.match(workspace, /void deleteRemoteBrowserShots\(taskId, scopeId\)\.catch\(\(\) => undefined\);\s*void sparkDisk\(\)\?\.remove\(taskId\);/);
    assert.match(read('features/spark/src/spark-task-files.ts'), /`\$\{CONVERSATION_FOLDERS\.attachments\}\/\$\{conversationFileName\(attachment\.name, attachment\.id, attachment\.mimeType\)\}`/);
  });
});

describe('the computer tool', () => {
  const toolContext = () => {
    const events = [];
    return {
      events,
      emit: (call) => { events.push(['emit', call]); return call.id; },
      patch: (id, update) => events.push(['patch', id, update]),
      stopTurn: (text) => events.push(['stop', text]),
    };
  };
  const capability = (allowed) => {
    const seen = { requested: [], ran: [] };
    return {
      seen,
      isAllowed: () => allowed,
      requestPermission: (request) => seen.requested.push(request),
      run: async (request) => { seen.ran.push(request); return { completed: true, report: 'The page says hello.', url: 'https://a.example/' }; },
    };
  };
  const computerTool = (computer) => createSparkCapabilityTools({ skills: [], connectedApps: [], computer })
    .find((tool) => tool.id === 'computer');

  it('asks first: records the request, ends the turn with Gemini’s sentence, and runs nothing', async () => {
    const computer = capability(false);
    const context = toolContext();
    const result = await computerTool(computer).run({ title: 'Read a page', task: 'Open https://a.example and read it.' }, context);
    assert.equal(computer.seen.requested.length, 1);
    assert.equal(computer.seen.ran.length, 0);
    assert.deepEqual(context.events.find(([kind]) => kind === 'stop'), ['stop', BROWSER_PERMISSION_RESPONSE]);
    assert.equal(context.events[0][1].kind, 'computer');
    assert.match(result.observation, /Stop here/);
  });

  it('runs once the thread is allowed, and reads the report back', async () => {
    const computer = capability(true);
    const result = await computerTool(computer).run({ task: 'Open https://a.example and read it.' }, toolContext());
    assert.equal(computer.seen.ran.length, 1);
    assert.match(result.observation, /Browser agent finished/);
    assert.match(result.observation, /The page says hello\./);
  });

  it('refuses a call with no task, and reads the spellings models reach for', async () => {
    assert.equal((await computerTool(capability(true)).run({}, toolContext())).failed, true);
    const request = computerRequestFrom({ instruction: 'Find the date.', start_url: 'https://b.example', label: `${'x'.repeat(90)}.` });
    assert.equal(request.task, 'Find the date.');
    assert.equal(request.url, 'https://b.example');
    assert.equal(request.title.length, 78);
  });
});
