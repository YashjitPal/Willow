/**
 * The Code harness's stream parser.
 *
 * A model's reply arrives in arbitrary pieces, and the parser has to find action
 * tags in it without ever showing a half tag as prose or losing a byte of a
 * file. Every case here is run at several chunk sizes, from one character at a
 * time to the whole reply at once: a parser that only works at one size works
 * by accident.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { StreamParser, cleanFileBody, parseTag } = await importTs(
  path.join(repoRoot, 'features', 'code', 'src', 'harness', 'stream-parser.ts'),
);

const CHUNK_SIZES = [1, 2, 3, 5, 8, 13, 64, Infinity];

function parse(text, size) {
  const events = { text: '', opened: [], blocks: [] };
  const parser = new StreamParser({
    onText: (chunk) => {
      events.text += chunk;
    },
    onBlockOpen: (block) => events.opened.push({ kind: block.kind, attrs: block.attrs }),
    onBlock: (block) => events.blocks.push({ kind: block.kind, tag: block.tag, attrs: block.attrs, body: block.body, complete: block.complete }),
  });
  const step = Number.isFinite(size) ? size : text.length || 1;
  for (let i = 0; i < text.length; i += step) parser.push(text.slice(i, i + step));
  parser.end();
  return events;
}

/** Runs `check` against the parse at every chunk size. */
function atEverySize(text, check) {
  for (const size of CHUNK_SIZES) {
    try {
      check(parse(text, size));
    } catch (error) {
      error.message = `[chunk size ${size}] ${error.message}`;
      throw error;
    }
  }
}

it('hides tool results and feedback a model imitates in its own reply', () => {
  const reply =
    'Checked it.\n<tool_result name="check_project">\nBuild: OK\n</tool_result>\n' +
    '<willow_feedback>\nApplied: created /App.tsx.\n</willow_feedback>\nAll good.\n' +
    '<tool_result name="read_file">\nnever closed\n<willow-edit path="/App.tsx">\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n</willow-edit>\nDone.';
  atEverySize(reply, (events) => {
    assert.equal(events.text.replace(/\s+/g, ' ').trim(), 'Checked it. All good. Done.');
    // An echo left open does not swallow the real action after it.
    assert.deepEqual(events.blocks.map((block) => block.kind), ['edit']);
  });
});

it('separates prose from a write and keeps the file byte for byte', () => {
  const file = 'export default function App() {\n  return <div className="a > b">{`<x>`}</div>;\n}\n';
  atEverySize(`I'll build it.\n<willow-write path="/App.tsx">\n${file}</willow-write>\nDone.`, (events) => {
    assert.equal(events.text.replace(/\s+/g, ' ').trim(), "I'll build it. Done.");
    assert.equal(events.blocks.length, 1);
    assert.equal(events.blocks[0].kind, 'write');
    assert.equal(events.blocks[0].attrs.path, '/App.tsx');
    assert.equal(cleanFileBody(events.blocks[0].body), file);
    assert.equal(events.blocks[0].complete, true);
    assert.deepEqual(events.opened, [{ kind: 'write', attrs: { path: '/App.tsx' } }]);
  });
});

it('finds a tag that starts mid-sentence', () => {
  atEverySize('Let me fix that.<willow-delete path="/old.tsx" />Gone.', (events) => {
    assert.equal(events.text, 'Let me fix that.Gone.');
    assert.deepEqual(events.blocks.map((block) => [block.kind, block.attrs.path]), [['delete', '/old.tsx']]);
  });
});

it('drops a code fence wrapped around actions, and its closing partner', () => {
  const reply = 'Here it is:\n\n```xml\n<willow-write path="/a.ts">\nexport const a = 1;\n</willow-write>\n<willow-write path="/b.ts">\nexport const b = 2;\n</willow-write>\n```\n\nAll set.';
  atEverySize(reply, (events) => {
    assert.doesNotMatch(events.text, /```/);
    assert.match(events.text, /Here it is:/);
    assert.match(events.text, /All set\./);
    assert.deepEqual(events.blocks.map((block) => block.attrs.path), ['/a.ts', '/b.ts']);
  });
});

it('leaves an ordinary code block in prose alone', () => {
  const reply = 'The fix:\n```css\n.a { flex-shrink: 0; }\n```\nThat is it.';
  atEverySize(reply, (events) => {
    assert.equal(events.text, reply);
    assert.equal(events.blocks.length, 0);
  });
});

it('treats an attribute-only action as complete with or without a closer', () => {
  atEverySize(
    '<willow-dependency name="lucide-react" version="^0.460.0"></willow-dependency>\n<willow-rename from="/a.tsx" to="/b.tsx">\nok',
    (events) => {
      assert.deepEqual(events.blocks.map((block) => block.kind), ['dependency', 'rename']);
      assert.equal(events.blocks[0].attrs.version, '^0.460.0');
      assert.equal(events.blocks[1].attrs.to, '/b.tsx');
      assert.doesNotMatch(events.text, /willow/);
    },
  );
});

it('closes a write whose closer was forgotten when the next action starts', () => {
  atEverySize('<willow-write path="/a.ts">\nexport const a = 1;\n<willow-write path="/b.ts">\nexport const b = 2;\n</willow-write>', (events) => {
    assert.equal(events.blocks.length, 2);
    assert.equal(cleanFileBody(events.blocks[0].body), 'export const a = 1;\n');
    assert.equal(cleanFileBody(events.blocks[1].body), 'export const b = 2;\n');
  });
});

it('never shows stray closers or unknown willow tags as prose', () => {
  atEverySize('Done.\n</willow-write>\n<willow-frobnicate x="1" />', (events) => {
    assert.equal(events.text.trim(), 'Done.');
    assert.deepEqual(events.blocks.map((block) => [block.kind, block.tag]), [['ignored', 'willow-frobnicate']]);
  });
});

it('passes through angle brackets that are not ours', () => {
  const reply = 'Use a <div> wrapper when a < b and <willowy> is fine.';
  atEverySize(reply, (events) => {
    assert.equal(events.text, reply);
    assert.equal(events.blocks.length, 0);
  });
});

it('reports a reply that ends inside a block as incomplete', () => {
  atEverySize('<willow-write path="/App.tsx">\nexport default function App() {\n  return <div', (events) => {
    assert.equal(events.blocks.length, 1);
    assert.equal(events.blocks[0].complete, false);
    assert.match(events.blocks[0].body, /return <div$/);
  });
});

it('reads tool calls in JSON and attribute form', () => {
  atEverySize('<willow-tool name="read_file">{"path": "/App.tsx"}</willow-tool><willow-tool name="list_files" />', (events) => {
    assert.deepEqual(events.blocks.map((block) => [block.kind, block.attrs.name, block.body.trim()]), [
      ['tool', 'read_file', '{"path": "/App.tsx"}'],
      ['tool', 'list_files', ''],
    ]);
  });
});

it('accepts a V4A patch envelope as an action', () => {
  const patch = '*** Begin Patch\n*** Update File: /a.ts\n@@\n-const a = 1;\n+const a = 2;\n*** End Patch';
  atEverySize(`Fixing.\n${patch}\nDone.`, (events) => {
    assert.equal(events.blocks.length, 1);
    assert.equal(events.blocks[0].kind, 'patch');
    assert.match(events.blocks[0].body, /^\*\*\* Begin Patch\n\*\*\* Update File: \/a\.ts/);
    assert.match(events.blocks[0].body, /\*\*\* End Patch$/);
    assert.doesNotMatch(events.text, /\*\*\*/);
  });
});

it('keeps markdown emphasis that merely starts like a patch', () => {
  const reply = 'This is ***very*** important and **bold**.';
  atEverySize(reply, (events) => {
    assert.equal(events.text, reply);
    assert.equal(events.blocks.length, 0);
  });
});

it('tolerates the bolt format the Code tab used before', () => {
  atEverySize('<boltArtifact id="a" title="A"><boltAction type="file" filePath="src/App.tsx">\nexport default () => null;\n</boltAction><boltAction type="shell">npm i</boltAction></boltArtifact>', (events) => {
    assert.deepEqual(events.blocks.map((block) => [block.kind, block.attrs.path]), [['write', 'src/App.tsx']]);
    assert.doesNotMatch(events.text, /bolt|npm/);
  });
});

it('honours quoted attribute values containing ">"', () => {
  const tag = parseTag('<willow-tool name="search_files" query="a > b">');
  assert.equal(tag.attrs.query, 'a > b');
  atEverySize('<willow-tool name="search_files" query="a > b" />', (events) => {
    assert.equal(events.blocks[0].attrs.query, 'a > b');
  });
});

it('cleans a file body the way the model meant it', () => {
  assert.equal(cleanFileBody('\nconst a = 1;\n'), 'const a = 1;\n');
  assert.equal(cleanFileBody('\n```tsx\nconst a = 1;\n```\n'), 'const a = 1;\n');
  assert.equal(cleanFileBody('\n&lt;div&gt;hi&lt;/div&gt;\n'), '<div>hi</div>\n');
  // A real file that happens to mention &lt; keeps it.
  assert.equal(cleanFileBody('\nconst s = "&lt;";\nconst t = <b />;\n'), 'const s = "&lt;";\nconst t = <b />;\n');
});

it('stays linear on a large file', () => {
  const body = 'const line = "x";\n'.repeat(20_000);
  const parser = new StreamParser({ onText: () => {}, onBlock: (block) => assert.equal(block.body.length, body.length + 1) });
  const started = Date.now();
  parser.push('<willow-write path="/big.ts">\n');
  for (let i = 0; i < body.length; i += 4) parser.push(body.slice(i, i + 4));
  parser.push('</willow-write>');
  parser.end();
  assert.ok(Date.now() - started < 4_000, `parsing took ${Date.now() - started}ms`);
});
