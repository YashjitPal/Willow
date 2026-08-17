/**
 * Catching file contents written as prose instead of applied as a patch.
 *
 * This is the harness's worst failure mode: the user sees a wall of code and
 * assumes it landed, when nothing was written. The detector has to fire on real
 * files and stay quiet on explanation, because a false positive costs a round
 * trip every time the model legitimately explains something with a snippet.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const loose = await importTs(
  path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'loose-code.ts'),
);

const { findLooseCode, looseCodeObservation, stripLooseCode } = loose;

const fence = (language, body) => '```' + language + '\n' + body + '\n```';

const COMPONENT = `export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="p-4">
      <p>{count}</p>
      <button onClick={() => setCount(count + 1)}>Add</button>
    </div>
  );
}`;

it('fires on a whole file written into the reply', () => {
  const found = findLooseCode(`Here is the component:\n\n${fence('tsx', COMPONENT)}\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0].language, 'tsx');
  assert.ok(found[0].lineCount >= 8);
  assert.match(found[0].hint, /export default function Counter/);
});

it('stays quiet on a short snippet inside an explanation', () => {
  // "The fix is one line" is a legitimate, useful thing to say. Nagging the
  // model here would cost a round trip on every explanation it gives.
  const text = `The problem is the flex child. Add this:\n\n${fence('css', '.item {\n  flex-shrink: 0;\n}')}\n`;
  assert.deepEqual(findLooseCode(text), []);
});

it('stays quiet on prose, shell output, and unlabelled fences', () => {
  assert.deepEqual(findLooseCode('Just an explanation with no code at all.'), []);
  assert.deepEqual(findLooseCode(fence('bash', 'npm run build\nnpm test')), []);
  // An unlabelled fence is usually output or pseudo-code, not a file.
  assert.deepEqual(findLooseCode(fence('', COMPONENT)), []);
});

it('stays quiet on a long block that is not structurally code', () => {
  const prose = Array.from({ length: 12 }, (_, i) => `line ${i} of plain notes`).join('\n');
  assert.deepEqual(findLooseCode(fence('tsx', prose)), []);
});

it('finds several files in one reply', () => {
  const text = `First:\n${fence('tsx', COMPONENT)}\n\nAnd the styles:\n${fence(
    'css',
    ':root {\n  --a: 1;\n  --b: 2;\n  --c: 3;\n  --d: 4;\n  --e: 5;\n  --f: 6;\n  --g: 7;\n  --h: 8;\n}',
  )}`;
  assert.equal(findLooseCode(text).length, 2);
});

it('tells the model what happened and exactly what to do', () => {
  const observation = looseCodeObservation(findLooseCode(fence('tsx', COMPONENT)));

  // Recovery works when the message is concrete: the consequence, then the move.
  assert.match(observation, /^ERROR/);
  assert.match(observation, /Nothing was written/);
  assert.match(observation, /apply_patch envelope/);
  assert.match(observation, /\*\*\* Add File:/);
  // And it must not invite the model to repeat the code in prose as well.
  assert.match(observation, /Do not repeat the code in prose/);
});

it('replaces the unapplied block in the shown message', () => {
  // The model re-sends the code as a patch, so leaving the original in the
  // transcript would show the same file twice — once as text that was never
  // applied, once as a real diff.
  const cleaned = stripLooseCode(`Here it is:\n\n${fence('tsx', COMPONENT)}\n\nDone.`);

  assert.doesNotMatch(cleaned, /setCount/);
  assert.match(cleaned, /lines of tsx moved into a patch/);
  assert.match(cleaned, /Here it is:/);
  assert.match(cleaned, /Done\./);
});

it('leaves legitimate snippets in the shown message', () => {
  const text = `Add this:\n\n${fence('css', '.item {\n  flex-shrink: 0;\n}')}\n`;
  assert.equal(stripLooseCode(text), text);
});
