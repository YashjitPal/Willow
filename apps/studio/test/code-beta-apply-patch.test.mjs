/**
 * The V4A patch engine.
 *
 * This is the one place in Code Beta where a bug silently corrupts a user's
 * project rather than showing an error, so it is the piece most worth pinning.
 * Everything here exercises `parsePatch` / `applyPatch` directly — no React, no
 * store, no model.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const patcher = await importTs(
  path.join(repoRoot, 'features', 'code-beta', 'src', 'harness', 'runtime', 'apply-patch.ts'),
);

const { parsePatch, applyPatch, normalizePath, renderDiff, PatchParseError, PatchApplyError } = patcher;

const apply = (files, patch) => applyPatch(files, parsePatch(patch));

it('creates a file from an Add File operation', () => {
  const { files, changes } = apply(
    {},
    `*** Begin Patch
*** Add File: /App.tsx
+export default function App() {
+  return <p>hi</p>;
+}
*** End Patch`,
  );

  assert.equal(files['/App.tsx'], 'export default function App() {\n  return <p>hi</p>;\n}\n');
  assert.equal(changes[0].kind, 'add');
  assert.equal(changes[0].added, 3);
});

it('applies an update hunk against matching context', () => {
  const before = { '/a.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;\n' };
  const { files, changes } = apply(
    before,
    `*** Begin Patch
*** Update File: /a.ts
@@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;
*** End Patch`,
  );

  assert.equal(files['/a.ts'], 'const a = 1;\nconst b = 22;\nconst c = 3;\n');
  assert.equal(changes[0].added, 1);
  assert.equal(changes[0].removed, 1);
  assert.equal(changes[0].fuzz, 0);
});

it('leaves the input file map untouched', () => {
  // A failed or partial patch must never mutate the live project, so the
  // applier is required to work on a copy.
  const before = { '/a.ts': 'x\n' };
  const snapshot = { ...before };
  apply(before, `*** Begin Patch\n*** Add File: /b.ts\n+y\n*** End Patch`);
  assert.deepEqual(before, snapshot);
});

it('matches context that differs only in trailing whitespace', () => {
  // Models reliably get hunk shape right and whitespace wrong. Rejecting these
  // patches wastes a whole round trip on an unambiguously correct edit.
  const before = { '/a.ts': 'const a = 1;   \nconst b = 2;\n' };
  const { files, changes } = apply(
    before,
    `*** Begin Patch
*** Update File: /a.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** End Patch`,
  );

  assert.equal(files['/a.ts'], 'const a = 1;   \nconst b = 3;\n');
  assert.ok(changes[0].fuzz > 0, 'should report that fuzzy matching was needed');
});

it('preserves the file\'s own text when a context line matched fuzzily', () => {
  // The model's copy of a context line is not authoritative; writing it back
  // would silently reformat lines the user never asked to change.
  const before = { '/a.ts': '  indented();\nother();\n' };
  const { files } = apply(
    before,
    `*** Begin Patch
*** Update File: /a.ts
@@
indented();
-other();
+changed();
*** End Patch`,
  );

  assert.equal(files['/a.ts'], '  indented();\nchanged();\n');
});

it('uses an @@ header to disambiguate a repeated snippet', () => {
  const before = {
    '/a.ts': [
      'function one() {',
      '  return 0;',
      '}',
      'function two() {',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  };

  const { files } = apply(
    before,
    `*** Begin Patch
*** Update File: /a.ts
@@ function two() {
-  return 0;
+  return 2;
*** End Patch`,
  );

  assert.match(files['/a.ts'], /function one\(\) \{\n  return 0;/);
  assert.match(files['/a.ts'], /function two\(\) \{\n  return 2;/);
});

it('deletes and renames files', () => {
  const start = { '/old.ts': 'value\n', '/gone.ts': 'x\n' };

  const { files } = apply(
    start,
    `*** Begin Patch
*** Delete File: /gone.ts
*** Update File: /old.ts
*** Move to: /new.ts
@@
-value
+renamed
*** End Patch`,
  );

  assert.equal(files['/gone.ts'], undefined);
  assert.equal(files['/old.ts'], undefined);
  assert.equal(files['/new.ts'], 'renamed\n');
});

it('rejects a patch whose context cannot be found', () => {
  assert.throws(
    () =>
      apply(
        { '/a.ts': 'real content\n' },
        `*** Begin Patch\n*** Update File: /a.ts\n@@\n-nothing like this\n+x\n*** End Patch`,
      ),
    PatchApplyError,
  );
});

it('rejects adding a file that already exists and updating one that does not', () => {
  assert.throws(
    () => apply({ '/a.ts': 'x\n' }, `*** Begin Patch\n*** Add File: /a.ts\n+y\n*** End Patch`),
    PatchApplyError,
  );
  assert.throws(
    () => apply({}, `*** Begin Patch\n*** Update File: /a.ts\n@@\n-x\n+y\n*** End Patch`),
    PatchApplyError,
  );
});

it('rejects a malformed envelope', () => {
  assert.throws(() => parsePatch('just some prose'), PatchParseError);
  assert.throws(() => parsePatch('*** Begin Patch\n*** Add File: /a\n+x\n'), PatchParseError);
});

it('normalises paths to the sandbox root and refuses escapes', () => {
  assert.equal(normalizePath('App.tsx'), '/App.tsx');
  assert.equal(normalizePath('./components/Card.tsx'), '/components/Card.tsx');
  // `src/` is stripped: the sandbox serves from the root, and allowing both
  // forms creates two keys for one file.
  assert.equal(normalizePath('src/App.tsx'), '/App.tsx');
  assert.equal(normalizePath('/src/lib/x.ts'), '/lib/x.ts');
  assert.throws(() => normalizePath('../outside.ts'), PatchParseError);
  assert.throws(() => normalizePath('C:/Windows/system32'), PatchParseError);
});

it('renders a diff of what actually landed, not of the submitted hunks', () => {
  // After fuzzy matching the hunks no longer describe the result, so the diff
  // is computed from before/after rather than replayed from the patch.
  const { changes } = apply(
    { '/a.ts': 'one\ntwo\nthree\n' },
    `*** Begin Patch\n*** Update File: /a.ts\n@@\n one\n-two\n+2\n three\n*** End Patch`,
  );

  const diff = renderDiff(changes[0]);
  const added = diff.filter((line) => line.type === 'add').map((line) => line.content);
  const removed = diff.filter((line) => line.type === 'del').map((line) => line.content);

  assert.deepEqual(added, ['2']);
  assert.deepEqual(removed, ['two']);
  assert.ok(diff.some((line) => line.type === 'hunk'));
});

it('applies several file operations from one envelope', () => {
  const { files, changes } = apply(
    { '/a.ts': 'a\n' },
    `*** Begin Patch
*** Update File: /a.ts
@@
-a
+A
*** Add File: /b.ts
+b
*** End Patch`,
  );

  assert.equal(files['/a.ts'], 'A\n');
  assert.equal(files['/b.ts'], 'b\n');
  assert.equal(changes.length, 2);
});
