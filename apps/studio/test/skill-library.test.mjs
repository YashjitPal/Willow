/**
 * Skills, as the platform holds them.
 *
 * A skill is a `SKILL.md`: YAML frontmatter naming it and saying when it
 * applies, then instructions. Spark and Customize → Skills each publish their
 * skills into one shared library in `platform/core`, and the Code harness reads
 * that library. The harness's own use of skills — the prompt catalog, mentions,
 * `read_skill` — is covered in code-harness-tools.test.mjs.
 *
 * The frontmatter rules follow `codex-rs/skills/src/parser.rs`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

const frontmatter = await importTs(path.join(repoRoot, 'platform', 'core', 'src', 'skill-frontmatter.ts'));
const library = await importTs(path.join(repoRoot, 'platform', 'core', 'src', 'skill-library.ts'));

const skill = (over = {}) => ({
  id: 'brand-voice',
  name: 'Brand voice',
  description: 'Use when writing user-facing copy.',
  instructions: 'Write in second person. Never use exclamation marks.',
  enabled: true,
  ...over,
});

/* ====================================================================== */
/* SKILL.md frontmatter                                                   */
/* ====================================================================== */

it('parses SKILL.md frontmatter the way upstream does', () => {
  const parsed = frontmatter.parseSkillFrontmatter(
    [
      '---',
      'name: Brand voice',
      'description: Use when writing user-facing copy for the marketing site.',
      'metadata:',
      '  short-description: Marketing copy rules',
      '---',
      '',
      'Write in second person.',
    ].join('\n'),
    () => 'fallback',
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.name, 'Brand voice');
  assert.equal(parsed.value.description, 'Use when writing user-facing copy for the marketing site.');
  // The nested `metadata.short-description` is the one field a flat parser misses.
  assert.equal(parsed.value.shortDescription, 'Marketing copy rules');
});

it("applies upstream's validation rules and messages", () => {
  // A leading `---` with no close is a markdown rule, not metadata.
  for (const bad of ['no frontmatter at all', '---\nname: x\ndescription: y', '---\n---\nbody']) {
    const result = frontmatter.parseSkillFrontmatter(bad, () => 'fallback');
    assert.equal(result.ok, false, `should reject: ${JSON.stringify(bad)}`);
    assert.equal(result.error.message, 'missing YAML frontmatter delimited by ---');
  }

  const noDescription = frontmatter.parseSkillFrontmatter('---\nname: x\n---\nbody', () => 'fallback');
  assert.equal(noDescription.ok, false);
  assert.equal(noDescription.error.message, 'missing field `description`');

  // A missing name falls back, which is what makes a description-only skill load.
  const noName = frontmatter.parseSkillFrontmatter('---\ndescription: does a thing\n---\nbody', () => 'my-folder');
  assert.equal(noName.ok, true);
  assert.equal(noName.value.name, 'my-folder');

  const longName = frontmatter.parseSkillFrontmatter(`---\nname: ${'x'.repeat(65)}\ndescription: y\n---\n`, () => 'fallback');
  assert.equal(longName.ok, false);
  assert.equal(longName.error.message, 'invalid name: exceeds maximum length of 64 characters');

  const messy = frontmatter.parseSkillFrontmatter('---\nname:    Brand    voice\ndescription:  a   b\n---\n', () => 'fallback');
  assert.equal(messy.value.name, 'Brand voice');
  assert.equal(messy.value.description, 'a b');
});

it('accepts the prose that forces upstream to carry a repair pass', () => {
  // Everything after the first colon is the value, so `Build for AWS: ECS`
  // parses where a strict YAML parser would reject it.
  for (const [line, expected] of [
    ['description: Build for AWS: ECS', 'Build for AWS: ECS'],
    ['description: <duration: e.g. 7d>', '<duration: e.g. 7d>'],
    ['description: [bracketed] thing', '[bracketed] thing'],
  ]) {
    const parsed = frontmatter.parseSkillFrontmatter(`---\nname: x\n${line}\n---\n`, () => 'fallback');
    assert.equal(parsed.ok, true, `should accept: ${line}`);
    assert.equal(parsed.value.description, expected);
  }
  const quoted = frontmatter.parseSkillFrontmatter("---\nname: x\ndescription: 'it''s fine'\n---\n", () => 'fallback');
  assert.equal(quoted.value.description, "it's fine");
});

it('round-trips a document through render and parse', () => {
  const original = skill({ shortDescription: 'Copy rules' });
  const document = frontmatter.renderSkillFrontmatter(
    { name: original.name, description: original.description, shortDescription: original.shortDescription },
    original.instructions,
  );
  const parsed = frontmatter.parseSkillFrontmatter(document, () => 'fallback');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.name, original.name);
  assert.equal(parsed.value.shortDescription, original.shortDescription);
  assert.equal(frontmatter.extractSkillBody(document), original.instructions);
});

/* ====================================================================== */
/* The shared library                                                     */
/* ====================================================================== */

it('merges each owner\'s skills without letting one replace the other', () => {
  library.resetSkillHydration();
  library.publishSkills([skill()], 'spark');
  library.publishSkills([skill({ id: 'tone', name: 'Tone' })], 'customize');
  assert.deepEqual(library.skillLibrary.get().map((entry) => entry.id), ['brand-voice', 'tone']);

  // Customize publishing again replaces only its own list.
  library.publishSkills([skill({ id: 'layout', name: 'Layout' })], 'customize');
  assert.deepEqual(library.skillLibrary.get().map((entry) => entry.id), ['brand-voice', 'layout']);

  // A duplicate id keeps the first owner's version.
  library.publishSkills([skill({ id: 'brand-voice', name: 'Shadow' }), skill({ id: 'layout', name: 'Layout' })], 'customize');
  assert.equal(library.skillLibrary.get().find((entry) => entry.id === 'brand-voice').name, 'Brand voice');

  // Spark's single-argument call still means Spark.
  library.publishSkills([]);
  assert.deepEqual(library.skillLibrary.get().map((entry) => entry.id), ['brand-voice', 'layout']);
  library.resetSkillHydration();
});

it('publishes only on a real change', () => {
  library.resetSkillHydration();
  library.publishSkills([skill()]);
  const afterFirst = library.skillLibrary.get();
  library.publishSkills([skill()]);
  assert.equal(library.skillLibrary.get(), afterFirst, 'an identical publish must not re-set');
  library.publishSkills([skill({ instructions: 'changed' })]);
  assert.notEqual(library.skillLibrary.get(), afterFirst);

  // `enabledSkills` is what a turn actually gets.
  library.publishSkills([skill(), skill({ id: 'off', enabled: false })]);
  assert.deepEqual(library.enabledSkills().map((entry) => entry.id), ['brand-voice']);
  library.resetSkillHydration();
});

it('loads the library on first read, once per scope, from every owner', () => {
  library.resetSkillHydration();
  const calls = [];
  library.registerSkillHydrator((scopeId) => {
    calls.push(`spark:${scopeId}`);
    library.publishSkills([skill()], 'spark');
  });
  library.registerSkillHydrator((scopeId) => calls.push(`other:${scopeId}`));

  assert.deepEqual(calls, []);
  assert.deepEqual(library.enabledSkills('user-123').map((entry) => entry.id), ['brand-voice']);
  library.enabledSkills('user-123');
  assert.deepEqual(calls, ['spark:user-123', 'other:user-123']);

  // A different scope hydrates again: storage keys are scoped by user.
  library.enabledSkills('guest');
  assert.equal(calls.length, 4);
  library.resetSkillHydration();
});

it('keeps platform free of the features that fill it', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'platform', 'core', 'src', 'skill-library.ts'), 'utf8');
  assert.doesNotMatch(source, /from ['"][^'"]*(features|spark|apps)/i);

  const register = fs.readFileSync(path.join(repoRoot, 'features', 'spark', 'src', 'register.ts'), 'utf8');
  assert.match(register, /registerSkillHydrator\(/);
  assert.match(register, /'skills', 'Skills'/, 'Spark still owns the Skills folder');
});

/* ====================================================================== */
/* Customize → Skills                                                     */
/* ====================================================================== */

const customize = await importTs(path.join(repoRoot, 'apps', 'studio', 'src', 'customize', 'customize-skills.ts'));

it('publishes the Customize page\'s skills under their own source', () => {
  const entries = customize.toLibrarySkills({
    activeIds: ['custom-1'],
    inactiveIds: ['custom-2'],
    custom: [
      { id: 'custom-1', type: 'skill', title: 'Landing pages', subtitle: '', description: 'Use for marketing pages', instructions: 'Hero first.' },
      { id: 'custom-2', type: 'skill', title: 'Off one', subtitle: '', description: 'x', instructions: 'y' },
    ],
    edits: { 'custom-1': { title: 'Landing pages', description: 'Use for marketing pages', instructions: 'Hero first, then proof.' } },
  });
  assert.deepEqual(entries.map((entry) => [entry.id, entry.enabled]), [['landing-pages', true], ['off-one', false]]);
  assert.equal(entries[0].instructions, 'Hero first, then proof.', 'edits win over the stored item');

  const view = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'customize', 'CustomizeView.tsx'), 'utf8');
  assert.match(view, /useCustomizeSkills\(\)/, 'the page reads the persisted store');
  assert.doesNotMatch(view, /useState<Set<string>>\(new Set\(\['apple-music-playlist'\]\)\)/, 'skills are no longer component state');
  assert.match(view, /handleUploadFile/, 'Upload is wired');

  const register = fs.readFileSync(path.join(repoRoot, 'apps', 'studio', 'src', 'app', 'register-features.ts'), 'utf8');
  assert.match(register, /customize\/customize-skills/, 'published at startup, not only once the page opens');
});

it('reads a SKILL.md, the page\'s own JSON, or plain Markdown on upload', () => {
  const md = customize.parseSkillFile('---\nname: Brand voice\ndescription: Copy rules\n---\n\nWrite plainly.', 'SKILL.md');
  assert.deepEqual(md, { title: 'Brand voice', description: 'Copy rules', instructions: 'Write plainly.' });

  const json = customize.parseSkillFile(JSON.stringify({ title: 'Tone', description: 'd', instructions: 'Be kind.' }), 'tone.json');
  assert.deepEqual(json, { title: 'Tone', description: 'd', instructions: 'Be kind.' });

  const plain = customize.parseSkillFile('# Accessibility\n\nAlways label inputs.', 'a11y.md');
  assert.equal(plain.title, 'Accessibility');
  assert.match(plain.instructions, /Always label inputs/);

  assert.equal(customize.parseSkillFile('   ', 'empty.md'), null);
});
