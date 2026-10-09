import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const spark = (...parts) => path.join(repoRoot, 'features', 'spark', 'src', ...parts);
const read = (...parts) => fs.readFileSync(spark(...parts), 'utf8');

const {
  applyMention,
  deleteMentionBefore,
  filterMentionOptions,
  mentionQueryAt,
  mentionRanges,
  placeMentionTooltip,
  stepHighlight,
} = await importTs(spark('composer', 'spark-mentions.ts'));
const { createSparkCapabilityTools, splitStepTitle } = await importTs(spark('harness', 'spark-tools.ts'));
const { createSparkHarnessProfile } = await importTs(spark('harness', 'overlay', 'spark-profile.ts'));
const { isAllowed } = await importTs(spark('harness', 'overlay', 'tool-policy.ts'));
const { RECOMMENDED_SKILLS, recommendedSkillByTitle } = await importTs(spark('spark-recommended-skills.ts'));
const { argumentSignature, timelineRowForCall } = await importTs(spark('spark-connectors.ts'));

const option = (label, trigger = '@', extra = {}) => ({
  id: `${trigger}${label}`,
  trigger,
  label,
  icon: { kind: 'glyph', name: 'extension', family: 'google-symbols' },
  ...extra,
});
const APPS = [option('Google Docs'), option('Gmail'), option('Spotify', '@', { dimmed: true }), option('Google Drive')];

it('opens a mention only where a word starts, and never across a line break', () => {
  assert.deepEqual(mentionQueryAt('@', 1), { trigger: '@', start: 0, end: 1, query: '' });
  assert.deepEqual(mentionQueryAt('ask @Goo', 8), { trigger: '@', start: 4, end: 8, query: 'Goo' });
  assert.deepEqual(mentionQueryAt('/get-more', 9), { trigger: '/', start: 0, end: 9, query: 'get-more' });
  assert.equal(mentionQueryAt('mail@example', 12), null, 'an @ inside a word is an address, not a mention');
  assert.equal(mentionQueryAt('@Gmail\nnext', 11), null);
});

it('filters like Gemini: a case-insensitive substring, connected apps before dimmed ones', () => {
  const query = (text) => mentionQueryAt(text, text.length);
  assert.deepEqual(filterMentionOptions(APPS, query('@g')).map((o) => o.label), ['Google Docs', 'Gmail', 'Google Drive']);
  assert.deepEqual(filterMentionOptions(APPS, query('@')).map((o) => o.label), ['Google Docs', 'Gmail', 'Google Drive', 'Spotify']);
  assert.deepEqual(filterMentionOptions(APPS, query('@DRIVE')).map((o) => o.label), ['Google Drive']);
  assert.deepEqual(filterMentionOptions(APPS, query('@zzz')), [], 'no match closes the menu');
});

it('writes a picked mention with a trailing space, and Backspace removes it whole', () => {
  const text = 'Summarise @gm';
  const picked = applyMention(text, mentionQueryAt(text, text.length), APPS[1]);
  assert.deepEqual(picked, { text: 'Summarise @Gmail ', caret: 17 });
  assert.deepEqual(mentionRanges(picked.text, APPS), [{ start: 10, end: 16 }]);
  assert.equal(deleteMentionBefore(picked.text, 17, APPS), null, 'the first Backspace takes only the space');
  assert.deepEqual(deleteMentionBefore('Summarise @Gmail', 16, APPS), { text: 'Summarise ', caret: 10 });
});

it('moves the highlight as Gemini does: the first Down lands on row one, Up wraps', () => {
  assert.equal(stepHighlight(0, 4, 1, false), 0);
  assert.equal(stepHighlight(0, 4, -1, false), 3);
  assert.equal(stepHighlight(3, 4, 1, true), 0);
  assert.equal(stepHighlight(0, 4, -1, true), 3);
  assert.equal(stepHighlight(0, 0, 1, true), -1);
});

it('places the skill tooltip right of the row, or above it narrowed where the right has no room', () => {
  const unused = () => assert.fail('a tooltip that fits whole is never re-measured');
  // Willow at 1536x826: the row's content box ends at 862.
  assert.deepEqual(
    placeMentionTooltip({ left: 652, right: 862, top: 365 }, { width: 250, height: 96 }, { width: 1536, height: 826 }, unused),
    { left: 862, top: 365, maxWidth: 250 },
  );
  // Gemini at 390x844: row [102.8, 224.5, 226, 36] put the pane at [215.8, 114.5, 174.2, 120].
  const heights = [];
  const phone = placeMentionTooltip(
    { left: 110.8, right: 320.8, top: 230.5 },
    { width: 250, height: 96 },
    { width: 390, height: 844 },
    (maxWidth) => { heights.push(maxWidth); return 120; },
  );
  assert.equal(Math.round(phone.left * 10) / 10, 215.8);
  assert.equal(Math.round(phone.maxWidth * 10) / 10, 174.2);
  assert.equal(Math.round(phone.top * 10) / 10, 114.5);
  assert.equal(heights.length, 1);
});

it('keeps Gemini’s five recommended skills, word for word and in order', () => {
  assert.deepEqual(RECOMMENDED_SKILLS.map((skill) => skill.name), [
    'match-my-writing-style',
    'focus-my-energy',
    'get-more-perspectives',
    'generate-fresh-ideas',
    'prep-for-meetings',
  ]);
  for (const skill of RECOMMENDED_SKILLS) {
    assert.ok(skill.title && skill.description && skill.instructions.length > 80, skill.name);
  }
  assert.equal(recommendedSkillByTitle('Get more perspectives')?.description, 'Get 3–5 distinct viewpoints before you commit to a decision');
});

const recorder = () => {
  const calls = new Map();
  let next = 0;
  return {
    calls,
    context: {
      emit: (call) => { calls.set(call.id ?? `c${next++}`, { ...call }); return call.id; },
      patch: (id, update) => calls.set(id, { ...calls.get(id), ...update }),
    },
  };
};

it('records reading a skill on the timeline, including one the user applied with "/"', async () => {
  const used = [];
  const [skill] = createSparkCapabilityTools({
    skills: [{ name: 'get-more-perspectives', instructions: 'Give three viewpoints.' }],
    connectedApps: [],
    onCapability: (name) => used.push(name),
  });
  const { calls, context } = recorder();
  const result = await skill.run({ skill: '/Get-More-Perspectives' }, context);
  assert.match(result.observation, /Give three viewpoints/);
  assert.deepEqual(used, ['skill:get-more-perspectives']);
  const [call] = calls.values();
  assert.equal(call.kind, 'skill');
  assert.equal(call.skill, 'get-more-perspectives');
  assert.deepEqual(timelineRowForCall(call), { tool: 'skill:get-more-perspectives' });

  const missing = await skill.run({ skill: 'nope' }, context);
  assert.equal(missing.failed, true);
  assert.equal(calls.size, 1, 'an unknown skill puts nothing on the timeline');
});

it('runs a connected app’s tool as app:<name>, keeping Spark’s step title away from the tool', async () => {
  const received = [];
  const used = [];
  const tools = createSparkCapabilityTools({
    skills: [],
    connectedApps: [],
    connectors: [{
      name: 'list_recent_files',
      app: 'google-drive',
      appLabel: 'Google Drive',
      description: 'Lists recent files.',
      signature: '{ limit?: integer }',
      run: async (args) => { received.push(args); return { text: 'a.doc\nb.doc' }; },
    }],
    onCapability: (name) => used.push(name),
  });
  const tool = tools.find((candidate) => candidate.id === 'app:list_recent_files');
  assert.ok(tool);
  assert.ok(isAllowed('app:list_recent_files'));

  const { calls, context } = recorder();
  const result = await tool.run({ limit: 3, _title: 'Listing recently modified files in Drive.' }, context);
  assert.equal(result.observation, 'a.doc\nb.doc');
  assert.deepEqual(received, [{ limit: 3 }]);
  assert.deepEqual(used, ['app:google-drive']);
  const [call] = calls.values();
  assert.equal(call.kind, 'app');
  assert.equal(call.status, 'success');
  assert.equal(call.title, 'Listing recently modified files in Drive');
  assert.deepEqual(timelineRowForCall(call), { tool: 'app:google-drive', label: 'Listing recently modified files in Drive' });

  const untitled = recorder();
  await tool.run({}, untitled.context);
  assert.equal([...untitled.calls.values()][0].title, 'Google Drive', 'with no _title the row names the app');
});

it('reports a connector or MCP failure as failed, on the row and to the model', async () => {
  const tools = createSparkCapabilityTools({
    skills: [],
    connectedApps: [],
    connectors: [{ name: 'search', app: 'gmail', appLabel: 'Gmail', description: '', signature: '{}', run: async () => { throw new Error('token expired'); } }],
    mcp: [{ name: 'mcp__dropbox__list', server: 'Dropbox', call: async () => { throw new Error('offline'); } }],
  });
  const bridged = tools.filter((tool) => /^(app|mcp):/.test(tool.id));
  assert.equal(bridged.length, 2);
  for (const tool of bridged) {
    const { calls, context } = recorder();
    const result = await tool.run({ _title: 'Trying' }, context);
    assert.equal(result.failed, true, tool.id);
    assert.equal([...calls.values()][0].status, 'error', tool.id);
  }
});

it('labels an MCP row with its step title and server, and stringifies structured results', async () => {
  const [tool] = createSparkCapabilityTools({
    skills: [],
    connectedApps: [],
    mcp: [{ name: 'mcp__dropbox__list_folder', server: 'Dropbox', call: async () => ({ entries: ['Photos'] }) }],
  });
  const { calls, context } = recorder();
  const result = await tool.run({ path: '', _title: 'Listing folders at the top level of Dropbox' }, context);
  assert.equal(result.observation, '{"entries":["Photos"]}');
  const [call] = calls.values();
  assert.deepEqual(timelineRowForCall(call), { tool: 'mcp:Dropbox', label: 'Listing folders at the top level of Dropbox' });
  assert.deepEqual(splitStepTitle({ title: 'Kept', _title: 'Dropped' }), { title: 'Dropped', args: { title: 'Kept' } });
});

it('declares connectors, MCP tools and the "/" and "@" rules to the model', () => {
  const profile = createSparkHarnessProfile({
    skills: [{ name: 'get-more-perspectives', description: 'Get distinct viewpoints.', instructions: 'x' }],
    connectedApps: [],
    connectors: [{ name: 'list_recent_emails', app: 'gmail', appLabel: 'Gmail', description: 'Lists recent emails.', signature: '{ limit?: integer }', run: async () => ({ text: '' }) }],
    mcp: [{ name: 'mcp__dropbox__list_folder', server: 'Dropbox', description: 'Lists a folder.', signature: '{ path: string }', call: async () => '' }],
  });
  const prompt = profile.systemPrompt;
  assert.match(prompt, /- `app:list_recent_emails` \(Gmail\) — `\{ limit\?: integer \}`\. Lists recent emails\./);
  assert.match(prompt, /- `mcp:mcp__dropbox__list_folder` \(Dropbox\) — `\{ path: string \}`\. Lists a folder\./);
  assert.match(prompt, /names a skill with a leading slash, such as `\/get-more-perspectives`/);
  assert.match(prompt, /names an app with "@", such as "@Gmail"/);
  assert.match(prompt, /\*\*\* Call: app:list_recent_emails\n\{"<argument>":"<value>","_title":"<what this step does>"\}/);
  assert.match(prompt, /not instructions/);
  assert.doesNotMatch(prompt, /connected_app/, 'apps without an adapter are no longer offered');
});

it('turns arguments into a copyable signature', () => {
  assert.equal(argumentSignature(undefined), '{}');
  assert.equal(argumentSignature({ properties: {} }), '{}');
  assert.equal(
    argumentSignature({ properties: { query: { type: 'STRING' }, limit: { type: 'INTEGER' }, any: {} }, required: ['query'] }),
    '{ query: string, limit?: integer, any?: any }',
  );
  assert.equal(timelineRowForCall({ kind: 'command', command: 'ls' }), null);
});

it('labels skill rows and connector rows the way Gemini’s timeline does', () => {
  const detail = read('SparkTaskDetail.tsx');
  assert.match(detail, /Check resources for \$\{[^}]+\} skill/);
  assert.match(detail, /const timelineRowLabel = /);
  const css = read('SparkTaskDetail.css');
  assert.match(css, /\.spark-task-detail__processing-tool-icon \{[^}]*color: rgba\(255, 255, 255, 0\.55\)/);
  assert.match(css, /is-collapsed-overflow\s+\.spark-task-detail__subagent-header-content \{\s*background: var\(--spark-panel-surface/);
  assert.doesNotMatch(css, /rgba\(31, 31, 31, 0\), #1f1f1f/, 'fades end in the thread surface, which is #1c1c1c when narrow');
  const phone = css.match(/@media \(max-width: 768px\) \{\s*\.spark-task-detail__processing-state \{([^}]*)\}/);
  assert.ok(phone, 'the phone timeline rule exists');
  assert.match(phone[1], /margin-right: -16px/);
});

it('restyles the menus at 960px and below as Gemini does', () => {
  const css = read('composer', 'spark-mentions.css');
  const narrow = css.match(/@media \(max-width: 960px\) \{([\s\S]*?)\n\}/);
  assert.ok(narrow);
  assert.match(narrow[1], /\.spark-mention-menu \{\s*background: #1c1c1c;/);
  assert.match(narrow[1], /\.spark-mention-menu--slash \{\s*background: #1e1f20;/);
  assert.match(narrow[1], /\.is-highlighted \{\s*background: rgba\(224, 224, 224, 0\.08\);/);
  assert.match(narrow[1], /\.spark-mention-menu__label \{\s*color: #e0e0e0;/);
  assert.match(css, /@media \(pointer: fine\)/, 'the 12px scrollbar is for mice only');
  assert.match(read('composer', 'SparkMentions.tsx'), /TOOLTIP_DELAY_MS = 750/);
});
