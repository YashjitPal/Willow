/**
 * Media's Tools pages (the clone of Flow's Tools tab): its addresses, Flow's catalog, the
 * runner's import map and sandbox, the Tool Builder's error wording and thought chip, the Code
 * tab's highlighting, and the store's lists. The pages themselves are checked in a browser by
 * tools/scratch/w-tools.cjs; these pin the rules that page tests would only see indirectly.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const tools = (...segments) => path.join(repoRoot, 'features', 'media', 'src', 'tools', ...segments);
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

it('parses the Tools addresses and keeps the Media query on every link', async () => {
  const r = await importTs(tools('tools-routes.ts'));
  assert.deepEqual(r.parseToolsRoute('/media/tools', ''), { page: 'manager' });
  assert.deepEqual(r.parseToolsRoute('/media/create-tool/', ''), { page: 'create' });
  assert.deepEqual(
    r.parseToolsRoute('/media/tool/abc', '?projectId=p&mode=EDIT&fromViewSource=tools'),
    { page: 'view', toolId: 'abc', mode: 'EDIT', from: 'tools' },
  );
  assert.equal(r.parseToolsRoute('/media/tool/abc', '?mode=SIDE').mode, null, 'only APP and EDIT are modes');
  assert.equal(r.parseToolsRoute('/media/images', ''), null);
  assert.equal(r.isToolsPath('/media/tool/x'), true);
  assert.deepEqual(r.toolsLocation('?projectId=p&mode=EDIT'), { pathname: '/media/tools', search: '?projectId=p' });
  assert.deepEqual(
    r.toolLocation('?projectId=p&fromViewSource=tools', 'a b', { mode: 'EDIT' }),
    { pathname: '/media/tool/a%20b', search: '?projectId=p&mode=EDIT' },
  );
  assert.deepEqual(r.galleryLocation('?projectId=p&mode=APP'), { pathname: '/media', search: '?projectId=p' });
});

it('ships Flow\'s catalog: its sections, slides, suggestions and every tool\'s files', async () => {
  const c = await importTs(tools('catalog.ts'));
  assert.deepEqual(
    c.templatesBySection().map((s) => [s.category, s.tools.length]),
    [['Image', 8], ['Video', 10], ['Prompting', 5], ['Experimental', 11]],
  );
  assert.equal(c.COMMUNITY_TOOLS.length, 34);
  assert.equal(c.communityBySection()[0].category, 'Spotlight');
  assert.equal(c.CATEGORY_TITLES.Spotlight, 'Spotlight creatives');
  assert.equal(c.COMMUNITY_SLIDES.length, 7);
  assert.deepEqual(c.CREATE_SUGGESTIONS.map((s) => s.name).sort(), ['Image filter', 'Style morph', 'Time stretcher', 'Voice over']);
  for (const tool of [...c.TEMPLATES, ...c.COMMUNITY_TOOLS]) {
    const { files } = JSON.parse(fs.readFileSync(tools('catalog', 'sources', `${tool.id}.json`), 'utf8'));
    assert.ok(files.some((f) => /(^|\/)App\.tsx$/.test(f.path)), `${tool.name} has an App.tsx`);
  }
  for (const slide of c.COMMUNITY_SLIDES.filter((s) => s.toolId)) {
    assert.ok(c.catalogTool(slide.toolId), `slide "${slide.title}" opens a tool in the catalog`);
  }
});

it('builds Flow\'s import map: React pinned, esm.sh with React external, p5 and pixi.js from jsDelivr', async () => {
  const h = await importTs(tools('runtime', 'runner-html.ts'));
  assert.deepEqual(h.parseSpecifier('@scope/pkg@1.2/sub/x'), { name: '@scope/pkg', version: '1.2', subpath: 'sub/x' });
  assert.deepEqual(h.parseSpecifier('three'), { name: 'three', version: null, subpath: null });
  assert.equal(h.packageUrl('react@18'), 'https://esm.sh/react@19.1.1');
  assert.equal(h.packageUrl('three/examples/jsm/controls/OrbitControls.js'), 'https://esm.sh/three@latest/examples/jsm/controls/OrbitControls.js?external=react,react-dom');
  assert.equal(h.packageUrl('p5'), 'https://cdn.jsdelivr.net/npm/p5@latest/+esm');
  assert.equal(h.packageUrl('pixi.js@8.1.0'), 'https://cdn.jsdelivr.net/npm/pixi.js@8.1.0/dist/pixi.min.mjs');
  const map = h.buildImportMap('import { Icon } from "lucide-react";\nimport confetti from "https://esm.sh/canvas-confetti@1.9.3";\nimport { Flow } from "flow-sdk";', null);
  assert.equal(map['lucide-react'], 'https://esm.sh/lucide-react@latest?external=react,react-dom');
  assert.equal(map['canvas-confetti@1.9.3'], 'https://esm.sh/canvas-confetti@1.9.3?external=react,react-dom');
  assert.match(map['flow-sdk'], /^data:text\/javascript;base64,/);
  assert.match(map['@app'], /^data:text\/javascript;base64,/);
  const doc = h.buildRunnerDocument({ code: '', externalImports: [], parentOrigin: 'http://localhost:3101' });
  assert.match(doc, /<script type="importmap">/);
  assert.match(doc, /Content-Security-Policy/);
  assert.ok(doc.indexOf('WILLOW_RUNNER_READY') > doc.indexOf('port_init'), 'the page says it is ready only once the port listener is in place');
});

it('runs a tool in an opaque origin, so it can never read Willow\'s storage', () => {
  const bridge = read('features', 'media', 'src', 'tools', 'runtime', 'bridge.ts');
  assert.match(bridge, /export const RUNNER_SANDBOX = 'allow-scripts /);
  assert.doesNotMatch(bridge, /allow-same-origin/);
  assert.match(bridge, /frame\.setAttribute\('sandbox', RUNNER_SANDBOX\)/);
});

it('words a failed turn as Flow\'s error card does, its codes exactly', async () => {
  const e = await importTs(tools('builder-errors.ts'));
  assert.equal(e.MOCK_ERRORS.length, 13);
  assert.deepEqual(e.MOCK_ERRORS[0], { code: null, label: 'None (real BE)' });
  assert.deepEqual(e.describeBuilderError('PUBLIC_ERROR_HIGH_TRAFFIC'), { message: 'Tool Builder is experiencing high demand. Please try again later.', button: 'Try again', action: 'RETRY' });
  assert.deepEqual(e.describeBuilderError('PUBLIC_ERROR_USER_QUOTA_REACHED'), { message: "You've reached your Agent quota limit. Come back tomorrow to chat more.", button: null, action: 'NONE' });
  assert.equal(e.isQuotaError('PUBLIC_ERROR_USER_QUOTA_REACHED'), true);
  assert.equal(e.describeBuilderError('PUBLIC_ERROR_SEXUAL').action, 'FEEDBACK');
  assert.deepEqual(e.describeBuilderError('PUBLIC_ERROR_APPLET_STORAGE_QUOTA_EXCEEDED'), { message: 'You have reached the tool storage limit. Try deleting old tools.', button: 'Back to gallery', action: 'NAVIGATE' });
  assert.equal(e.describeBuilderError('UNKNOWN_ERROR_CODE').message, 'Something went wrong. Please try again.');
  assert.equal(e.describeBuilderError('API Key for Gemini is missing').action, 'SETTINGS');
  assert.equal(e.describeBuilderError('[429 Too Many Requests] Resource exhausted').message, 'You are sending messages too fast. Please wait a moment and try again.');
  assert.equal(e.describeBuilderError('fetch failed').button, 'Try again');
});

it('labels the thought chip with the summary\'s last heading, as Flow does', async () => {
  const { thoughtChip } = await importTs(tools('builder-errors.ts'));
  assert.equal(thoughtChip(''), null);
  assert.deepEqual(thoughtChip('**Reading the canvas**\n\nfirst\n\n**Refining Button Appearance**\n\nThe blue arrow.'), { label: 'Refining Button Appearance', detail: 'The blue arrow.' });
  assert.deepEqual(thoughtChip('no heading here'), { label: '', detail: 'no heading here' });
  assert.deepEqual(thoughtChip('**Done**'), { label: 'Done' });
});

it('highlights a file whole and splits it into lines that each close their spans', async () => {
  const c = await importTs(tools('code-highlight.ts'));
  assert.deepEqual(c.splitHighlightedLines('<span class="a">x\ny</span>\n'), ['<span class="a">x</span>', '<span class="a">y</span>']);
  const lines = c.highlightLines('src/App.tsx', 'const note = `one\ntwo`;\n// done\nexport default note;\n');
  assert.equal(lines.length, 4);
  for (const line of lines) assert.equal((line.match(/<span/g) || []).length, (line.match(/<\/span>/g) || []).length, line);
  assert.match(lines[0], /hljs-keyword/);
  assert.match(lines[1], /^<span class="hljs-string">/, 'the template string carries on onto its second line');
  assert.equal(c.languageFor('lib/run.MJS'), 'javascript');
  assert.equal(c.languageFor('notes.txt'), '');
  assert.deepEqual(['src/index.css', 'src/App.tsx', 'index.html', 'metadata.json'].map(c.fileIcon), ['css', 'code', 'description', 'description']);
  assert.deepEqual(c.highlightLines('notes.txt', '<b>x</b>'), ['&lt;b&gt;x&lt;/b&gt;']);
});

it('orders My creations, Favorites and the dock as Flow does, and lists no tool still being made', async () => {
  const s = await importTs(tools('tools-store.ts'));
  const { TEMPLATES } = await importTs(tools('catalog.ts'));
  const tool = (id, name, extra = {}) => ({ id, name, description: '', icon: '', createdAt: 1, updatedAt: 1, versionId: 'v', ...extra });
  s.$tools.set([
    tool('old', 'Old', { updatedAt: 10 }),
    tool('opened', 'Opened', { updatedAt: 5, lastOpenedAt: 50 }),
    tool('making', '', { updatedAt: 99, pending: true }),
  ]);
  const template = TEMPLATES[0].id;
  s.$toolPrefs.set({ favorites: ['making', 'old', template], pins: [template], recent: ['making', 'opened', template, 'old', 'gone'] });
  assert.deepEqual(s.$myCreations.get().map((e) => e.id), ['opened', 'old']);
  assert.deepEqual(s.$favorites.get().map((e) => e.id), ['old', template]);
  assert.deepEqual(s.$dock.get().items.map((e) => e.id), [template, 'opened', 'old'], 'pins first, then the recent ones not pinned');
  assert.equal(s.toolEntry('making').name, s.UNTITLED_TOOL, 'its own page still finds it');
  s.$toolPrefs.set({ favorites: [], pins: [], recent: TEMPLATES.slice(0, 8).map((t) => t.id) });
  assert.deepEqual([s.$dock.get().items.length, s.$dock.get().more], [s.DOCK_LIMIT, 3]);
});

it('tells the Tool Builder about the tools it has, and has no plan tool', async () => {
  const { BUILTIN_TOOLS } = await importTs(tools('harness', 'tools.ts'));
  const { buildSystemPrompt } = await importTs(tools('harness', 'prompt.ts'));
  const prompt = buildSystemPrompt({ mode: 'build', tools: BUILTIN_TOOLS });
  assert.deepEqual(BUILTIN_TOOLS.map((t) => t.name), ['read_file', 'list_files', 'search_files', 'check_project']);
  for (const t of BUILTIN_TOOLS) assert.ok(prompt.includes(t.name), `${t.name} is described`);
  assert.doesNotMatch(prompt, /propose_plan/);
  for (const api of ['Flow.generate.image', 'Flow.media.select', 'Flow.storage']) assert.ok(prompt.includes(api), `${api} is documented`);
});

it('mounts the Tools pages over Media, with one rail for both', () => {
  const view = read('features', 'media', 'src', 'MediaView.tsx');
  assert.match(view, /const ToolsSurface = React\.lazy\(\(\) => import\('\.\/tools\/ToolsSurface'\)\)/);
  assert.match(view, /parseToolsRoute\(location\.pathname, location\.search\)/);
  assert.match(view, /<ToolsSurface route=\{toolsRoute\} host=\{toolsHost\} \/>/);
  assert.match(view, /renderSidebar: \(\) => \(\s*<MediaSidebar/);
  assert.equal((view.match(/<MediaSidebar\b/g) || []).length, 2, 'the gallery and the Tools pages draw the same rail');
  assert.doesNotMatch(view, /<aside className=\{`\$\{isSidebarCollapsed/, 'the rail is not drawn inline any more');
  // A press on a bare element in the gallery starts MediaView's marquee, which turns the rail's
  // pointer events off before the click lands: the Tools row and the dock rows are links.
  const rail = read('features', 'media', 'src', 'MediaSidebar.tsx');
  assert.doesNotMatch(rail, /role="link"/);
  assert.match(rail, /<a\s+href=\{toolsHref\}/);
  assert.match(rail, /<a\s+key=\{tool\.id\}\s+href=\{toolHref\?\.\(tool\.id\)\}/);
  assert.match(view, /toolsHref=\{toolsHref\}\s+toolHref=\{dockToolHref\}/);
  // The Loading page still covers the rail while it fades out; a press then must reach the rail.
  const loading = read('features', 'media', 'src', 'flow-loading-page.css');
  assert.match(loading, /\.flow-loading-host\.loading-page-fade-out\s*\{[^}]*pointer-events:\s*none/);
  const picker = read('features', 'media', 'src', 'scenes', 'SceneMediaPicker.tsx');
  assert.match(picker, /export type PickerMode = [^;]*'tool'/);
  assert.match(picker, /const actionLabel = multiple \? 'Confirm'/);
  // `/media/*` is a splat route: the router's relative "?…" lands on /media and closes the page.
  assert.match(view, /const \[searchParams\] = useSearchParams\(\);/);
  assert.match(view, /navigate\(\{ pathname: window\.location\.pathname, search: search \? `\?\$\{search\}` : '' \}, options\)/);
  const app = read('apps', 'studio', 'src', 'app', 'App.tsx');
  assert.match(app, /const MediaRouteRedirect[\s\S]*?<Navigate to=\{\{ pathname, search: `\?\$\{next\.toString\(\)\}` \}\} replace \/>/);
});

it('keeps every tool in the folder\'s Media/Tools, which no project scan, rename or delete takes for a project', () => {
  assert.match(read('apps', 'studio', 'src', 'app', 'register-features.ts'), /import '@willow\/media\/register';/);
  const register = read('features', 'media', 'src', 'register.ts');
  assert.match(register, /registerSyncedFolder\('media-tools', toolsFolderDescriptor\(mediaTools\)\.descriptor\)/);
  const disk = read('features', 'media', 'src', 'tools', 'tools-disk.ts');
  assert.match(disk, /export const TOOLS_FOLDER = 'Media\/Tools';/);
  assert.match(disk, /export const TOOL_FILE_EXTENSION = '\.tool\.json';/, 'a project\'s .willow.json beside the files is never taken for one');
  const ctx = read('platform', 'storage', 'src', 'local-fs', 'LocalFSContext.tsx');
  assert.match(ctx, /if \(syncedFolderAt\(`\$\{parentName\}\/\$\{entry\.name\}`\) && !\(await holdsProjectManifest\(entry\)\)\) continue;/, 'the scan');
  assert.match(ctx, /if \(syncedFolderAt\(`\$\{parentName\}\/\$\{oldName\}`\)\) \{\s*if \(await holdsProjectManifest\(source\)\) return false;\s*continue;/, 'a rename');
  assert.match(ctx, /const synced = syncedFolderAt\(`\$\{folderName\}\/\$\{projectName\}`\);[\s\S]{0,400}?if \(!\(await holdsProjectManifest\(dir\)\)\) continue;[\s\S]{0,300}?endsWith\(synced\.extension\.toLowerCase\(\)\)\) continue;/, 'a delete');
  assert.match(ctx, /window\.addEventListener\(SYNCED_FOLDERS_CHANGED_EVENT, onSyncedFolderChange\);/, 'a change here asks for a pass');
  const store = read('platform', 'storage', 'src', 'media-tools.ts');
  for (const what of ['save the Media tool', 'delete the Media tool', 'save the Media tool version', 'save the Tool Builder chat', 'write the tool storage', 'remove from the tool storage', 'clear the tool storage']) {
    assert.match(store, new RegExp(`await done\\(tx, '${what}'\\);\\s*announce\\(`), `"${what}" is announced`);
  }
});
