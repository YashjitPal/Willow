/**
 * Shrinking an assistant turn before it re-enters the conversation.
 *
 * A turn is one request per round with the whole conversation re-sent each
 * time, so anything left in history is paid for again on every later round. The
 * model needs the envelopes it emitted; it does not need the file contents back.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { compactForHistory } = await importTs(
  path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'history.ts'),
);

const bigPatch = (path_, lines) =>
  [
    `*** Add File: ${path_}`,
    ...Array.from({ length: lines }, (_, i) => `+const line${i} = ${i};`),
  ].join('\n');

it('leaves a turn without a patch completely alone', () => {
  const raw = `Checking the project.
*** Call: list_files
{}
*** End Call
`;
  assert.equal(compactForHistory(raw), raw);
});

it('keeps a short patch verbatim', () => {
  // Small diffs are cheap, and seeing them is useful next round.
  const raw = `Fixing it.

*** Begin Patch
*** Update File: /App.tsx
@@
-const a = 1;
+const a = 2;
*** End Patch
`;
  assert.equal(compactForHistory(raw), raw);
});

it('replaces a long body with a summary, keeping every marker', () => {
  const raw = `Creating it.

*** Begin Patch
${bigPatch('/App.tsx', 279)}
*** End Patch

Done.
`;
  const compact = compactForHistory(raw);

  // The structure the model reasons about survives.
  assert.match(compact, /\*\*\* Begin Patch/);
  assert.match(compact, /\*\*\* Add File: \/App\.tsx/);
  assert.match(compact, /\*\*\* End Patch/);
  assert.match(compact, /Creating it\./);
  assert.match(compact, /Done\./);

  // The bulk does not.
  assert.doesNotMatch(compact, /const line200/);
  assert.match(compact, /\[279 lines applied: \+279 -0\]/);
  assert.ok(compact.length < raw.length / 5, 'the body is the bulk and must go');
});

it('summarises each file in a multi-file envelope separately', () => {
  const raw = `Setting up.

*** Begin Patch
${bigPatch('/calculator.ts', 265)}
${bigPatch('/App.tsx', 279)}
*** End Patch
`;
  const compact = compactForHistory(raw);

  assert.match(compact, /\*\*\* Add File: \/calculator\.ts/);
  assert.match(compact, /\*\*\* Add File: \/App\.tsx/);
  assert.match(compact, /\[265 lines applied/);
  assert.match(compact, /\[279 lines applied/);
});

it('still collapses a patch whose envelope was never closed', () => {
  // Truncated mid-stream. The body is no more useful for being unterminated.
  const raw = `Creating.

*** Begin Patch
${bigPatch('/App.tsx', 300)}`;

  const compact = compactForHistory(raw);
  assert.match(compact, /\[300 lines applied/);
  assert.doesNotMatch(compact, /const line200/);
});

it('does not touch a call envelope, which is what the model needs most', () => {
  // This is the one that caused the orphan `*** End Call` runs when it went
  // missing, so it must survive compaction untouched.
  const raw = `Recording the plan.

*** Begin Patch
${bigPatch('/App.tsx', 100)}
*** End Patch

*** Call: update_plan
{"plan": [{"step": "Build it", "status": "pending"}]}
*** End Call
`;
  const compact = compactForHistory(raw);

  assert.match(compact, /\*\*\* Call: update_plan/);
  assert.match(compact, /"step": "Build it"/);
  assert.match(compact, /\*\*\* End Call/);
  assert.match(compact, /\[100 lines applied/);
});
