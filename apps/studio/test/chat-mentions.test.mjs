/**
 * The chat composer's "@" and "/" menus, and the thinking row's "Connecting to <app>" line —
 * Gemini's prompt box and status line, re-read off gemini.google.com/app in Oct 2026.
 *
 * The text logic is a plain module, so it runs here. What only a React component decides (which
 * skills "/" lists, what a send carries, when the status line names an app) is pinned by source.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const MENTIONS_DIR = path.join(repoRoot, 'features', 'chat', 'src', 'composer', 'mentions');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const mentions = () => importTs(path.join(MENTIONS_DIR, 'mentions.ts'));
const prompts = () => importTs(path.join(MENTIONS_DIR, 'mention-prompts.ts'));

const model = (label) => ({ id: `model:${label}`, trigger: '@', kind: 'model', value: label, label, icon: { kind: 'glyph', name: 'spark_outline', size: 20 } });
const app = (label) => ({ id: `app:${label}`, trigger: '@', kind: 'app', value: label.toLowerCase(), label, icon: { kind: 'img', src: 'x' } });
const skill = (label) => ({ id: `skill:${label}`, trigger: '/', kind: 'skill', value: label, label, icon: { kind: 'glyph', name: 'contract', size: 16 } });

describe('mention queries', () => {
  it('opens on a trigger at the start of the box or after a space, never mid-word', async () => {
    const { mentionQueryAt } = await mentions();
    assert.deepEqual(mentionQueryAt('@', 1), { trigger: '@', start: 0, end: 1, query: '' });
    assert.deepEqual(mentionQueryAt('ask @You', 8), { trigger: '@', start: 4, end: 8, query: 'You' });
    assert.deepEqual(mentionQueryAt('hi\n/sum', 7), { trigger: '/', start: 3, end: 7, query: 'sum' });
    assert.equal(mentionQueryAt('mail a@b', 8), null, 'an address is not a mention');
    assert.equal(mentionQueryAt('and/or', 6), null, 'a slash inside a word is not a command');
    assert.equal(mentionQueryAt('@You\nnext', 9), null, 'a line break ends the query');
  });

  it('keeps spaces in the query, as "@Google Cal" does in Gemini', async () => {
    const { mentionQueryAt, filterMentionOptions } = await mentions();
    const query = mentionQueryAt('@google cal', 11);
    assert.equal(query.query, 'google cal');
    assert.deepEqual(filterMentionOptions([app('Google Calendar'), app('Google Docs')], query).map((option) => option.label), ['Google Calendar']);
  });

  it('filters by a case-insensitive substring, in order, per trigger', async () => {
    const { mentionQueryAt, filterMentionOptions } = await mentions();
    const options = [model('3.1 Pro'), app('Google Docs'), app('Gmail'), skill('summarize')];
    const at = filterMentionOptions(options, mentionQueryAt('@', 1));
    assert.deepEqual(at.map((option) => option.label), ['3.1 Pro', 'Google Docs', 'Gmail']);
    assert.deepEqual(filterMentionOptions(options, mentionQueryAt('@MAIL', 5)).map((option) => option.label), ['Gmail']);
    assert.deepEqual(filterMentionOptions(options, mentionQueryAt('/', 1)).map((option) => option.label), ['summarize']);
  });

  it('finds nothing for "/" when no skill is installed, so no menu opens', async () => {
    const { mentionQueryAt, filterMentionOptions } = await mentions();
    assert.deepEqual(filterMentionOptions([model('3.1 Pro'), app('YouTube')], mentionQueryAt('/', 1)), []);
    const component = codeOnly(fs.readFileSync(path.join(MENTIONS_DIR, 'ChatMentions.tsx'), 'utf8'));
    assert.match(component, /if \(matches\.length === 0\) \{\s*setMenu\(null\);/,
      'an empty match list must close the menu rather than draw an empty panel');
  });

  it('splits a label around the match for the bold run', async () => {
    const { labelParts } = await mentions();
    assert.deepEqual(labelParts('YouTube', 'tub'), { before: 'You', match: 'Tub', after: 'e' });
    assert.deepEqual(labelParts('YouTube', ''), { before: 'YouTube', match: '', after: '' });
  });
});

describe('picking and editing mentions', () => {
  it('writes the trigger, the name and one space, with the caret after it', async () => {
    const { applyMention, mentionQueryAt } = await mentions();
    const picked = applyMention('find @you', mentionQueryAt('find @you', 9), app('YouTube'));
    assert.deepEqual(picked, { text: 'find @YouTube ', caret: 14 });
    const before = applyMention('@3 now', { trigger: '@', start: 0, end: 2, query: '3' }, model('3.1 Pro'));
    assert.equal(before.text, '@3.1 Pro now', 'no second space when one follows');
  });

  it('recognises the longest known name, ending at a space or the end', async () => {
    const { mentionsIn } = await mentions();
    const options = [app('Google'), app('Google Calendar'), skill('summarize')];
    const found = mentionsIn('@Google Calendar then /summarize', options);
    assert.deepEqual(found.map(({ start, end, option }) => [start, end, option.label]), [[0, 16, 'Google Calendar'], [22, 32, 'summarize']]);
    assert.deepEqual(mentionsIn('@Googley', options), [], 'a name running into more letters is not that name');
  });

  it('takes a whole mention on Backspace', async () => {
    const { deleteMentionBefore } = await mentions();
    assert.deepEqual(deleteMentionBefore('ask @YouTube', 12, [app('YouTube')]), { text: 'ask ', caret: 4 });
    assert.equal(deleteMentionBefore('ask @YouTube ', 13, [app('YouTube')]), null, 'past the space it is plain text again');
  });

  it('wraps the arrow keys, starting from the highlighted first row', async () => {
    const { stepHighlight } = await mentions();
    assert.equal(stepHighlight(0, 3, 1), 1, 'Down from the first row lands on the second, as in Gemini');
    assert.equal(stepHighlight(2, 3, 1), 0);
    assert.equal(stepHighlight(0, 3, -1), 2);
  });
});

describe('what a send carries', () => {
  it('brings a picked skill\'s instructions to the turn', async () => {
    const { mentionedSkillsBlock } = await prompts();
    assert.equal(mentionedSkillsBlock([]), '');
    const block = mentionedSkillsBlock([{ name: 'summarize', instructions: '  Use three bullets.  ', files: { 'notes.md': 'Keep it short.', 'big.txt': 'x'.repeat(20000) } }]);
    assert.match(block, /^## The "summarize" skill/);
    assert.match(block, /invoked this skill with \/summarize/);
    assert.match(block, /Use three bullets\./);
    assert.match(block, /### notes\.md\nKeep it short\./);
    assert.match(block, /also ships big\.txt, too long to include here/);
  });

  it('points the turn at the apps named with "@"', async () => {
    const { mentionedAppsBlock } = await prompts();
    assert.equal(mentionedAppsBlock([]), '');
    assert.match(mentionedAppsBlock(['YouTube']), /named YouTube with "@".*that app's tools/);
    assert.match(mentionedAppsBlock(['Gmail', 'Google Docs', 'YouTube']), /named Gmail, Google Docs and YouTube/);
  });

  it('lists only enabled skills under "/", and under "@" only the apps a turn can reach', () => {
    const hook = codeOnly(fs.readFileSync(path.join(MENTIONS_DIR, 'use-chat-mention-options.ts'), 'utf8'));
    assert.match(hook, /skills\s*\.filter\(\(skill\) => skill\.enabled\)/);
    assert.match(hook, /trigger: '\/'/);
    assert.match(hook, /personalize && profile\.enabled \? usableConnectors\(\) : \[\]/);
    assert.match(hook, /CHAT_APPS\.filter\(\(app\) => reachable\.has\(app\.id\)\)/,
      'an app the turn cannot reach is left out, not dimmed');
    for (const file of ['mentions.ts', 'ChatMentions.tsx', 'chat-mentions.css', 'use-chat-mention-options.ts']) {
      assert.doesNotMatch(codeOnly(fs.readFileSync(path.join(MENTIONS_DIR, file), 'utf8')), /dimmed/, `${file} still dims`);
    }
  });

  it('resolves the mentions of a send and hands them to the turn setup', () => {
    const view = codeOnly(read('features', 'chat', 'src', 'ChatView.tsx'));
    assert.match(view, /mentionsIn\(trimmed, mentionOptionsRef\.current\)/);
    assert.match(view, /skillLibrary\.get\(\)\.filter\(\(skill\) => skill\.enabled && mentionedSkillIds\.has\(skill\.id\)\)/);
    assert.match(view, /mentioned\.filter\(\(option\) => option\.kind === 'app'\)\.map\(\(option\) => option\.label\)/);
    assert.match(view, /mentionedSkills,\s*mentionedApps,\s*\}\)/);
    assert.match(view, /<ChatMentions host=\{composerBox\} options=\{mentionOptions\} onPick=\{pickMention\}/);
    assert.match(view, /if \(option\.kind === 'model'\) setSelectedModelId\(option\.value\);/, 'picking a model switches to it');

    const setup = codeOnly(read('features', 'chat', 'src', 'chat-turn-setup.ts'));
    assert.match(setup, /mentionedSkillsBlock\(mentionedSkills\),\s*mentionedAppsBlock\(mentionedApps\)/);
  });
});

describe('the menu\'s measured look', () => {
  it('keeps Gemini\'s panel and row geometry', () => {
    const css = read('features', 'chat', 'src', 'composer', 'mentions', 'chat-mentions.css');
    const rule = (selector) => {
      const at = css.indexOf(`${selector} {`);
      assert.ok(at >= 0, `${selector} is gone`);
      return css.slice(at, css.indexOf('}', at));
    };
    const panel = rule('.wc-mention-menu');
    assert.match(panel, /background(-color)?: #1f1f1f/);
    assert.match(panel, /border-radius: 16px/);
    assert.match(panel, /max-height: 45vh/);
    const item = rule('.wc-mention-menu__item');
    assert.match(item, /height: 36px/);
    assert.match(item, /border-radius: 12px/);
  });

  it('traces a mention as heavy as Gemini\'s \'wght\' 540, the stroke stepping with resolution', () => {
    const css = read('features', 'chat', 'src', 'composer', 'mentions', 'chat-mentions.css');
    assert.match(css, /\.wc-mention-highlight__mention \{\s*-webkit-text-stroke: 0\.2px var\(--wc-mention-ink, #fff\);/);
    for (const [dppx, width] of [['1\\.125', '0\\.25'], ['1\\.375', '0\\.32'], ['1\\.75', '0\\.38'], ['2\\.5', '0\\.45']]) {
      assert.match(css, new RegExp(`@media \\(min-resolution: ${dppx}dppx\\) \\{\\s*\\.wc-mention-highlight__mention \\{\\s*-webkit-text-stroke-width: ${width}px;`));
    }
    const composer = read('features', 'chat', 'src', 'composer', 'Composer.tsx');
    assert.match(composer, /isLight \? 'text-\[#1f1f1f\]' : chatVariant \? 'text-\[#e3e3e3\]' : 'text-white'/,
      'Gemini\'s typed text is #e3e3e3, and a mention is that text');
  });

  it('opens 4px below the line, or flipped with its bottom 1px into it, placed by its layout box', () => {
    const component = codeOnly(fs.readFileSync(path.join(MENTIONS_DIR, 'ChatMentions.tsx'), 'utf8'));
    assert.match(component, /const MENU_OFFSET = 4;/);
    assert.match(component, /const MENU_OFFSET_ABOVE = -1;/, 'Gemini: 1217 and 781 against line tops of 1216 and 780');
    assert.match(component, /const \{ offsetWidth: width, offsetHeight: height \} = panel;/,
      'a client rect would read the scale(0.8) the enter animation starts from, and flip the menu 20% short');
  });
});

describe('Connecting to <app>', () => {
  it('marks the app whose tool is running, and clears it when the tool returns', () => {
    const runner = codeOnly(read('features', 'chat', 'src', 'chat-turn-runner.ts'));
    const set = runner.indexOf('record.connectingApp = app;');
    const run = runner.indexOf('runPersonalTool(name, args)');
    const clear = runner.indexOf('record.connectingApp = undefined;');
    assert.ok(set > 0 && run > set && clear > run, 'set before the tool runs, cleared after it');
    assert.match(runner, /finally \{\s*if \(app && record\.connectingApp === app\)/, 'a failing tool must not leave the line up');
  });

  it('draws "Connecting to", the app\'s logo, then its name, on the thought heading row', () => {
    const line = codeOnly(read('features', 'chat', 'src', 'ThoughtSummaryLine.tsx'));
    assert.match(line, /export const connectingHeading = \(label: string\): string => `Connecting to \$\{label\}`;/);
    assert.match(line, /Connecting to\s*<img className="thought-summary-line__logo" src=\{app\.logo\} alt="" \/>\s*\{app\.label\}/);
    const css = read('features', 'chat', 'src', 'thought-summary.css');
    assert.match(css, /\.thought-summary-line__logo \{[^}]*width: 24px;[^}]*height: 24px;[^}]*margin: 0 8px;/);

    const view = codeOnly(read('features', 'chat', 'src', 'ChatView.tsx'));
    assert.match(view, /const app = active && isLastAssistant \? chatApp\(connectingApp\) : null;/);
    assert.match(view, /const statusHeading = mediaStatus \?\? \(app \? connectingHeading\(app\.label\) : null\) \?\?/,
      'media statuses keep priority; a running app comes before search and code');
    assert.match(view, /setConnectingApp\(record\.connectingApp \?\? null\);/);
    assert.match(view, /marginTop: summaryHeading && !isCompact \? 4 : undefined/,
      'on a desktop Gemini\'s heading row sits at 192 against the bare dots\' 188');
  });
});
