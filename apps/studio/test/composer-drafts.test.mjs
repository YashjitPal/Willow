/**
 * Unsent text outlives a restart: the composer keeps what is typed under its box's `draftKey` in localStorage
 * (`willow:draft:<key>`), and every box that takes a message names one — a conversation its own, so one chat's
 * draft never shows in another.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

it('keeps a box\'s unsent text under its key, and swaps it with the conversation', () => {
  const composer = read('features', 'chat', 'src', 'composer', 'Composer.tsx');
  assert.match(composer, /const DRAFT_PREFIX = 'willow:draft:';/);
  assert.match(composer, /if \(text\.trim\(\)\) localStorage\.setItem\(`\$\{DRAFT_PREFIX\}\$\{key\}`, text\);\s*else localStorage\.removeItem/);
  assert.match(composer, /if \(draftFor !== draftKey\) \{\s*setDraftFor\(draftKey\);\s*setPromptText\(readDraft\(draftKey\)\);\s*\}/);
  assert.match(composer, /useEffect\(\(\) => \{\s*if \(draftKey\) writeDraft\(draftKey, promptText\);\s*\}, \[draftKey, promptText\]\);/);
});

it('gives every box that takes a message a key of its own', () => {
  assert.match(read('features', 'chat', 'src', 'ChatView.tsx'), /draftKey=\{`chat:\$\{chatScopeId\}:\$\{activeChatId \|\| 'new'\}`\}/);
  const sparkComposer = read('features', 'spark', 'src', 'SparkComposer.tsx');
  assert.match(sparkComposer, /draftKey\?: string;/);
  assert.match(sparkComposer, /draftKey=\{draftKey\}/);
  assert.match(read('features', 'spark', 'src', 'SparkWorkspace.tsx'), /draftKey="spark:new-task"/);
  assert.match(read('features', 'spark', 'src', 'SparkHome.tsx'), /draftKey="spark:home"/);
  assert.match(read('features', 'spark', 'src', 'SparkTaskDetail.tsx'), /draftKey=\{`spark:task:\$\{currentTask\.id\}`\}/);
  assert.match(read('features', 'spark', 'src', 'dots', 'DotConversation.tsx'), /draftKey=\{`bot:\$\{dot\.id\}`\}/);
  assert.match(read('features', 'media', 'src', 'MediaHome.tsx'), /draftKey="media:home"/);
});
