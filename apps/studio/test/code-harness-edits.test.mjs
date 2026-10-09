/**
 * How the Code harness changes files: SEARCH/REPLACE edits, the V4A patch it
 * also accepts, and the working copy both land in.
 *
 * These are the places where a bug silently corrupts a user's project instead
 * of showing an error, so they are pinned case by case.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (file) => path.join(repoRoot, 'features', 'code', 'src', 'harness', file);

const { parseSearchReplace, applySearchReplace } = await importTs(harness('search-replace.ts'));
const { parsePatch, applyPatch, PatchApplyError, PatchParseError } = await importTs(harness('apply-patch.ts'));
const { Workspace, PathError, lineDelta } = await importTs(harness('workspace.ts'));

const edit = (source, body) => applySearchReplace(source, parseSearchReplace(body).blocks, '/a.ts');

/* ====================================================================== */
/* SEARCH/REPLACE                                                         */
/* ====================================================================== */

it('replaces an exact match and keeps the rest of the file', () => {
  const source = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
  const result = edit(source, '<<<<<<< SEARCH\nconst b = 2;\n=======\nconst b = 22;\n>>>>>>> REPLACE');
  assert.equal(result.content, 'const a = 1;\nconst b = 22;\nconst c = 3;\n');
  assert.equal(result.applied, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.fuzzy, false);
});

it('applies several blocks in order', () => {
  const source = 'a\nb\nc\nd\n';
  const result = edit(source, [
    '<<<<<<< SEARCH', 'b', '=======', 'B', '>>>>>>> REPLACE',
    '<<<<<<< SEARCH', 'd', '=======', 'D', '>>>>>>> REPLACE',
  ].join('\n'));
  assert.equal(result.content, 'a\nB\nc\nD\n');
});

it('matches whitespace the model got wrong, and keeps the file\'s indentation', () => {
  const source = 'function f() {\n    if (x) {\n        go();\n    }\n}\n';
  // Two-space SEARCH against a four-space file: the replacement is shifted to match.
  const result = edit(source, '<<<<<<< SEARCH\n  if (x) {\n    go();\n  }\n=======\n  if (x) {\n    go();\n    done();\n  }\n>>>>>>> REPLACE');
  assert.equal(result.content, 'function f() {\n    if (x) {\n        go();\n        done();\n    }\n}\n');
  assert.equal(result.fuzzy, true);
});

it('matches when the model dropped a blank line', () => {
  const source = 'import a from "a";\n\nexport default a;\n';
  const result = edit(source, '<<<<<<< SEARCH\nimport a from "a";\nexport default a;\n=======\nimport a from "a";\nexport default { a };\n>>>>>>> REPLACE');
  assert.equal(result.content, 'import a from "a";\nexport default { a };\n');
});

it('replaces part of a line when that part occurs once', () => {
  const source = '<button className="bg-blue-500 px-4">Go</button>\n';
  const result = edit(source, '<<<<<<< SEARCH\nbg-blue-500\n=======\nbg-emerald-600\n>>>>>>> REPLACE');
  assert.equal(result.content, '<button className="bg-emerald-600 px-4">Go</button>\n');
});

it('refuses an ambiguous partial match rather than guessing', () => {
  const source = 'gap-2\ngap-2\n';
  const result = edit(source, '<<<<<<< SEARCH\ngap\n=======\nspace\n>>>>>>> REPLACE');
  assert.equal(result.applied, 0);
  assert.equal(result.content, source);
});

it('explains a failed SEARCH with the closest real lines, numbered', () => {
  const source = 'export function Card() {\n  return <div className="card">Hello</div>;\n}\n';
  const result = edit(source, '<<<<<<< SEARCH\n  return <div className="cards">Hello</div>;\n=======\n  return null;\n>>>>>>> REPLACE');
  assert.equal(result.applied, 0);
  assert.match(result.failures[0].message, /did not match \/a\.ts/);
  assert.match(result.failures[0].message, /2 \|   return <div className="card">Hello<\/div>;/);
});

it('applies the blocks that match even when a later one fails', () => {
  const result = edit('one\ntwo\n', [
    '<<<<<<< SEARCH', 'one', '=======', '1', '>>>>>>> REPLACE',
    '<<<<<<< SEARCH', 'missing', '=======', 'x', '>>>>>>> REPLACE',
  ].join('\n'));
  assert.equal(result.content, '1\ntwo\n');
  assert.equal(result.applied, 1);
  assert.deepEqual(result.failures.map((failure) => failure.index), [2]);
});

it('deletes with an empty REPLACE and tolerates a forgotten closing marker', () => {
  assert.equal(edit('a\nb\nc\n', '<<<<<<< SEARCH\nb\n=======\n>>>>>>> REPLACE').content, 'a\nc\n');
  assert.equal(edit('a\nb\n', '<<<<<<< SEARCH\nb\n=======\nB').content, 'a\nB\n');
});

it('says what is wrong with a body that has no blocks', () => {
  assert.match(parseSearchReplace('just the new file contents').error, /no SEARCH\/REPLACE blocks/);
  assert.match(parseSearchReplace('   ').error, /empty/);
});

it('accepts the Cline spelling of the markers', () => {
  const result = edit('x\n', '------- SEARCH\nx\n=======\ny\n+++++++ REPLACE');
  assert.equal(result.content, 'y\n');
});

/* ====================================================================== */
/* V4A patches                                                            */
/* ====================================================================== */

const patch = (files, text) => applyPatch(files, parsePatch(text));

it('applies a V4A patch with fuzzy context, keeping the file\'s own text', () => {
  const { files, changes } = patch({ '/a.ts': '  indented();\nother();\n' }, '*** Begin Patch\n*** Update File: /a.ts\n@@\nindented();\n-other();\n+changed();\n*** End Patch');
  assert.equal(files['/a.ts'], '  indented();\nchanged();\n');
  assert.ok(changes[0].fuzz > 0);
});

it('adds, deletes and moves files in one envelope', () => {
  const { files } = patch(
    { '/old.ts': 'value\n', '/gone.ts': 'x\n' },
    '*** Begin Patch\n*** Delete File: /gone.ts\n*** Update File: /old.ts\n*** Move to: /new.ts\n@@\n-value\n+renamed\n*** Add File: /b.ts\n+b\n*** End Patch',
  );
  assert.deepEqual(Object.keys(files).sort(), ['/b.ts', '/new.ts']);
  assert.equal(files['/new.ts'], 'renamed\n');
});

it('rejects a patch it cannot place, without touching the input', () => {
  const before = { '/a.ts': 'real\n' };
  assert.throws(() => patch(before, '*** Begin Patch\n*** Update File: /a.ts\n@@\n-nothing\n+x\n*** End Patch'), PatchApplyError);
  assert.deepEqual(before, { '/a.ts': 'real\n' });
  assert.throws(() => parsePatch('prose'), PatchParseError);
});

/* ====================================================================== */
/* The working copy                                                       */
/* ====================================================================== */

it('resolves the paths models write to the project\'s own', () => {
  const root = new Workspace({ '/App.tsx': 'x' });
  assert.equal(root.resolvePath('App.tsx'), '/App.tsx');
  assert.equal(root.resolvePath('./components/Card.tsx'), '/components/Card.tsx');
  // Projects made here keep sources at the root, so `src/` is a habit to drop.
  assert.equal(root.resolvePath('src/App.tsx'), '/App.tsx');
  assert.equal(root.resolvePath('/src/lib/x.ts'), '/lib/x.ts');
  assert.throws(() => root.resolvePath('../outside.ts'), PathError);
  assert.throws(() => root.resolvePath('C:/Windows/x'), PathError);
  assert.throws(() => root.resolvePath('/components/'), PathError);

  // An imported project with a real `src/` folder keeps it.
  const imported = new Workspace({ '/src/App.tsx': 'x', '/src/main.tsx': 'y' });
  assert.equal(imported.resolvePath('src/App.tsx'), '/src/App.tsx');
  assert.equal(imported.resolvePath('/App.tsx'), '/src/App.tsx');
  assert.equal(imported.resolvePath('src/components/New.tsx'), '/src/components/New.tsx');
});

it('records what the turn changed relative to where it began', () => {
  const workspace = new Workspace({ '/a.ts': 'a\n', '/b.ts': 'b\n' });
  workspace.write('/a.ts', 'A\n');
  workspace.write('/c.ts', 'c\n');
  workspace.delete('/b.ts');
  workspace.write('/c.ts', 'c2\n');
  assert.deepEqual(workspace.changes().map((change) => [change.path, change.kind]), [
    ['/a.ts', 'modified'],
    ['/b.ts', 'deleted'],
    ['/c.ts', 'created'],
  ]);

  // Writing a file back to how it started is no change at all.
  workspace.write('/a.ts', 'a\n');
  assert.equal(workspace.changes().some((change) => change.path === '/a.ts'), false);
});

it('counts added and removed lines for the transcript', () => {
  assert.deepEqual(lineDelta('a\nb\nc\n', 'a\nB\nc\nd\n'), { added: 2, removed: 1 });
  assert.deepEqual(lineDelta(null, 'a\nb\n'), { added: 2, removed: 0 });
});
