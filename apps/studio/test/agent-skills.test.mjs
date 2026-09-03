/**
 * Skills, against upstream Codex.
 *
 * A skill is a folder with a `SKILL.md` at its root: YAML frontmatter naming it
 * and saying when it applies, then instructions. The harness shows the model a
 * one-line catalog entry per skill and lets it fetch bodies on demand, which
 * upstream calls progressive disclosure.
 *
 * References:
 *
 * - `codex-rs/skills/src/parser.rs`              — frontmatter rules and messages
 * - `codex-rs/skills/src/mentions.rs`            — the `$name` sigil
 * - `codex-rs/ext/skills/src/catalog_prompt.rs`  — the prompt catalog
 * - `codex-rs/ext/skills/src/tools/{list,read}.rs` — the two tools
 * - `codex-rs/ext/skills/src/{render,tools/mod}.rs` — the byte and page limits
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const harness = (...segments) =>
  path.join(repoRoot, 'features', 'code', 'src', 'agent', 'harness', ...segments);

const frontmatter = await importTs(
  path.join(repoRoot, 'platform', 'core', 'src', 'skill-frontmatter.ts'),
);
const library = await importTs(
  path.join(repoRoot, 'platform', 'core', 'src', 'skill-library.ts'),
);
const skills = await importTs(harness('runtime', 'skills.ts'));
const skillsPrompt = await importTs(harness('overlay', 'skills-prompt.ts'));
const policy = await importTs(harness('overlay', 'tool-policy.ts'));
const agentModule = await importTs(harness('runtime', 'agent.ts'));

const { runTurn } = agentModule;
const MODEL = { label: 'Test Model', options: { provider: 'gemini', model: 'test', apiKey: 'k' } };

const skill = (over = {}) => ({
  id: 'brand-voice',
  name: 'Brand voice',
  description: 'Use when writing user-facing copy.',
  instructions: 'Write in second person. Never use exclamation marks.',
  enabled: true,
  ...over,
});

function scriptedTransport(responses) {
  const seen = [];
  let round = 0;
  const transport = async (messages, _options, onToken, _onStart, systemPrompt) => {
    seen.push({ messages, systemPrompt });
    const body = responses[round] ?? '';
    round += 1;
    for (let i = 0; i < body.length; i += 7) onToken(body.slice(i, i + 7));
  };
  transport.rounds = seen;
  return transport;
}

async function run(responses, extra = {}) {
  let files = {};
  const events = [];
  const transport = scriptedTransport(responses);
  await runTurn({
    prompt: extra.prompt ?? 'do the thing',
    history: [],
    files: () => ({ ...files }),
    writeFiles: (next) => {
      files = { ...next };
    },
    model: MODEL,
    transport,
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return { files, events, transport };
}

const observationsSent = (transport) =>
  transport.rounds
    .flatMap(({ messages }) => messages)
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n');

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

it('applies upstream\'s validation rules and messages', () => {
  // `MissingFrontmatter`. A leading `---` with no close is a markdown rule, not
  // metadata, and must not be read as such.
  for (const bad of [
    'no frontmatter at all',
    '---\nname: x\ndescription: y',
    '---\n---\nbody',
  ]) {
    const result = frontmatter.parseSkillFrontmatter(bad, () => 'fallback');
    assert.equal(result.ok, false, `should reject: ${JSON.stringify(bad)}`);
    assert.equal(result.error.message, 'missing YAML frontmatter delimited by ---');
  }

  // `MissingField("description")` — description is required, name is not.
  const noDescription = frontmatter.parseSkillFrontmatter(
    '---\nname: x\n---\nbody',
    () => 'fallback',
  );
  assert.equal(noDescription.ok, false);
  assert.equal(noDescription.error.message, 'missing field `description`');

  // A missing name falls back, which is what makes a description-only skill load.
  const noName = frontmatter.parseSkillFrontmatter(
    '---\ndescription: does a thing\n---\nbody',
    () => 'my-folder',
  );
  assert.equal(noName.ok, true);
  assert.equal(noName.value.name, 'my-folder');

  // `InvalidField { field: "name", reason: "exceeds maximum length of 64 characters" }`
  const longName = frontmatter.parseSkillFrontmatter(
    `---\nname: ${'x'.repeat(65)}\ndescription: y\n---\n`,
    () => 'fallback',
  );
  assert.equal(longName.ok, false);
  assert.equal(longName.error.message, 'invalid name: exceeds maximum length of 64 characters');
  assert.equal(frontmatter.MAX_SKILL_NAME_LEN, 64);

  // `sanitize_single_line` — whitespace runs collapse, including newlines.
  const messy = frontmatter.parseSkillFrontmatter(
    '---\nname:    Brand    voice\ndescription:  a   b\n---\n',
    () => 'fallback',
  );
  assert.equal(messy.value.name, 'Brand voice');
  assert.equal(messy.value.description, 'a b');
});

it('accepts the prose that forces upstream to carry a repair pass', () => {
  /*
   * Upstream parses frontmatter with `serde_yaml`, which rejects an unquoted
   * value containing `: `. It therefore carries a 90-line
   * `repair_frontmatter_scalar_fields` whose own comment gives the reason:
   *
   *   "Some third-party skills use prose like `description: Build for AWS: ECS`
   *    or `argument-hint: <duration: e.g. 7d>`."
   *
   * This parser takes everything after the *first* colon as the value, so the
   * whole class of failure cannot occur and the repair pass is not ported.
   */
  for (const [line, expected] of [
    ['description: Build for AWS: ECS', 'Build for AWS: ECS'],
    ['description: <duration: e.g. 7d>', '<duration: e.g. 7d>'],
    ['description: [bracketed] thing', '[bracketed] thing'],
    ['description: 100% @ once', '100% @ once'],
  ]) {
    const parsed = frontmatter.parseSkillFrontmatter(
      `---\nname: x\n${line}\n---\n`,
      () => 'fallback',
    );
    assert.equal(parsed.ok, true, `should accept: ${line}`);
    assert.equal(parsed.value.description, expected);
  }

  // Quotes are still honoured, and a doubled single quote unescapes.
  const quoted = frontmatter.parseSkillFrontmatter(
    "---\nname: x\ndescription: 'it''s fine'\n---\n",
    () => 'fallback',
  );
  assert.equal(quoted.value.description, "it's fine");
});

it('round-trips a document through parse and render', () => {
  const original = skill({ shortDescription: 'Copy rules' });
  const document = frontmatter.renderSkillFrontmatter(
    {
      name: original.name,
      description: original.description,
      shortDescription: original.shortDescription,
    },
    original.instructions,
  );

  const parsed = frontmatter.parseSkillFrontmatter(document, () => 'fallback');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.name, original.name);
  assert.equal(parsed.value.description, original.description);
  assert.equal(parsed.value.shortDescription, original.shortDescription);
  assert.equal(frontmatter.extractSkillBody(document), original.instructions);

  // And the harness's importer agrees with the parser.
  const imported = skills.skillFromDocument('brand-voice', document);
  assert.equal(imported.ok, true);
  assert.equal(imported.skill.name, original.name);
  assert.equal(imported.skill.instructions, original.instructions);
  assert.equal(imported.skill.enabled, true);

  const rejected = skills.skillFromDocument('x', 'not a skill');
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /missing YAML frontmatter/);
});

/* ====================================================================== */
/* $mentions                                                              */
/* ====================================================================== */

it('extracts mentions with upstream\'s sigil and its exclusions', () => {
  // `TOOL_MENTION_SIGIL` is `$`, not `@`.
  const plain = skills.extractToolMentions('please use $BrandVoice on this');
  assert.deepEqual([...plain.names], ['BrandVoice']);

  // `is_mention_name_char` allows letters, digits, `_`, `-` and `:`.
  assert.deepEqual([...skills.extractToolMentions('$a-b_c:d').names], ['a-b_c:d']);

  // The linked form a menu inserts records both the name and the path.
  const linked = skills.extractToolMentions('use [$BrandVoice](skill://brand-voice) here');
  assert.deepEqual([...linked.names], ['BrandVoice']);
  assert.deepEqual([...linked.paths], ['skill://brand-voice']);

  /*
   * `is_common_env_var`. This looks arbitrary and is not: a prompt about shell
   * configuration is full of `$PATH` and `$HOME`, and reading those as skill
   * mentions would fire a skill on every such message.
   */
  for (const name of ['PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TERM', 'XDG_CONFIG_HOME']) {
    assert.equal(
      skills.extractToolMentions(`echo $${name}`).names.size,
      0,
      `$${name} must not be a mention`,
    );
  }

  // A bare sigil, or one followed by punctuation, is not a mention.
  assert.equal(skills.extractToolMentions('paid $ and $.').names.size, 0);
  // A digit *is* a valid name char upstream (`is_mention_name_char` covers
  // `0..9`), so `$5` extracts as the name "5" and then matches no skill. Left
  // as upstream has it rather than special-cased.
  assert.deepEqual([...skills.extractToolMentions('costs $5').names], ['5']);

  // `normalize_skill_path` / `is_skill_filename`
  assert.equal(skills.normalizeSkillPath('skill://brand-voice'), 'brand-voice');
  assert.equal(skills.normalizeSkillPath('brand-voice'), 'brand-voice');
  assert.equal(skills.isSkillFilename('a/b/SKILL.md'), true);
  assert.equal(skills.isSkillFilename('a\\b\\skill.md'), true);
  assert.equal(skills.isSkillFilename('references/x.md'), false);
});

it('resolves a mention to a skill by id or by name', () => {
  const list = [skill(), skill({ id: 'a11y', name: 'Accessibility' })];

  assert.deepEqual(
    skills.skillsMentionedIn('use $brand-voice', list).map((s) => s.id),
    ['brand-voice'],
  );
  // By display name, case-insensitively — that is what the user reads in the
  // catalog, so it is what they type.
  assert.deepEqual(
    skills.skillsMentionedIn('use $Accessibility', list).map((s) => s.id),
    ['a11y'],
  );

  /*
   * The case that makes the trigger rule work at all.
   *
   * A mention ends at the first character outside `[A-Za-z0-9_:-]`, so a skill
   * named "Brand voice" cannot be written `$Brand voice` — the space truncates
   * it to `$Brand`. `$BrandVoice` is the only way to name it, so both sides are
   * compared with separators squashed out.
   */
  assert.deepEqual(
    skills.skillsMentionedIn('apply $BrandVoice to the header', list).map((s) => s.id),
    ['brand-voice'],
  );
  assert.deepEqual(
    skills.skillsMentionedIn('apply $brandvoice', list).map((s) => s.id),
    ['brand-voice'],
  );
  // "Multiple mentions mean use them all."
  assert.equal(skills.skillsMentionedIn('$brand-voice and $a11y', list).length, 2);
  assert.equal(skills.skillsMentionedIn('nothing named here', list).length, 0);
});

/* ====================================================================== */
/* The catalog                                                            */
/* ====================================================================== */

it('renders the catalog with upstream\'s trigger rules intact', () => {
  const section = skillsPrompt.renderSkillsSection([skill()]);

  assert.match(section, /^## Skills/m);
  assert.match(section, /^### Available skills/m);
  assert.match(section, /- Brand voice: Use when writing user-facing copy\. \(skill: skill:\/\/brand-voice\)/);

  /*
   * The trigger rules are the load-bearing paragraph and are upstream's word
   * for word. They carry the two things a paraphrase loses: that a skill fires
   * on a description match even when unnamed, and that skills do not persist
   * across turns.
   */
  assert.match(
    section,
    /If the user names a skill \(with `\$SkillName` or plain text\) OR the task clearly matches a skill's description shown above, you must use that skill for that turn\. Multiple mentions mean use them all\. Do not carry skills across turns unless re-mentioned\./,
  );
  // And the rule that a sub-agent must not be asked to interpret a skill.
  assert.match(section, /Do not delegate reading, summarizing, or interpreting skill instructions to a subagent/);
  assert.match(section, /Progressive disclosure applies to selecting relevant files/);

  // The short description wins in the catalog — that is what it is for, so the
  // line stays one line while `skills.read` gets the long form.
  const short = skillsPrompt.renderSkillsSection([
    skill({ shortDescription: 'Copy rules', description: 'A much longer explanation.' }),
  ]);
  assert.match(short, /- Brand voice: Copy rules \(/);

  // Absent rather than empty: a "Skills" heading with nothing under it reads to
  // the model as "you have skills, here are none".
  assert.equal(skillsPrompt.renderSkillsSection([]), '');
});

it('truncates a name on a byte budget without splitting a character', () => {
  assert.equal(skillsPrompt.MAX_SKILL_NAME_BYTES, 256);
  const emoji = '🎨'.repeat(100);
  const truncated = skillsPrompt.truncateBytes(emoji, 10);
  assert.ok(new TextEncoder().encode(truncated).length <= 10);
  // Whole characters only — a split surrogate would render as a replacement char.
  assert.ok([...truncated].every((character) => character === '🎨'));
});

/* ====================================================================== */
/* The two tools                                                          */
/* ====================================================================== */

it('offers the skill tools only when the library has something in it', () => {
  assert.deepEqual([...policy.SKILL_TOOLS].sort(), ['skills.list', 'skills.read']);

  const without = policy.toolsForTurn({ mode: 'default', goalActive: false });
  assert.ok(!without.includes('skills.read'));

  const with_ = policy.toolsForTurn({
    mode: 'default',
    goalActive: false,
    skillsAvailable: true,
  });
  assert.ok(with_.includes('skills.list'));
  assert.ok(with_.includes('skills.read'));
});

it('reads a skill through skills.read, paginated as upstream is', async () => {
  const tools = new Map(skills.makeSkillTools([skill()]).map((tool) => [tool.id, tool]));
  const context = { readFiles: () => ({}), writeFiles: () => {}, emit: () => 'id', patch: () => {} };

  const result = await tools.get('skills.read').run({ package: 'skill://brand-voice' }, context);
  const payload = JSON.parse(result.observation);

  // Omitting `resource` reads SKILL.md, frontmatter included — the model is
  // told to read it "completely", and the frontmatter is part of the document.
  assert.equal(payload.resource, 'SKILL.md');
  assert.match(payload.contents, /^---/);
  assert.match(payload.contents, /name: Brand voice/);
  assert.match(payload.contents, /Write in second person/);
  assert.equal(payload.next_cursor, null);

  // A bare id works too, since the catalog shows a locator but a model may
  // reasonably pass either.
  assert.equal(
    JSON.parse((await tools.get('skills.read').run({ package: 'brand-voice' }, context)).observation)
      .resource,
    'SKILL.md',
  );

  // Supporting files, which is what the progressive-disclosure guidance is for.
  const withFiles = new Map(
    skills
      .makeSkillTools([skill({ files: { 'references/tone.md': '# Tone\nBe plain.' } })])
      .map((tool) => [tool.id, tool]),
  );
  const reference = await withFiles
    .get('skills.read')
    .run({ package: 'brand-voice', resource: 'references/tone.md' }, context);
  assert.match(JSON.parse(reference.observation).contents, /Be plain\./);

  // A fully-qualified resource resolves to the same file.
  const qualified = await withFiles
    .get('skills.read')
    .run({ package: 'brand-voice', resource: 'skill://brand-voice/references/tone.md' }, context);
  assert.equal(JSON.parse(qualified.observation).resource, 'references/tone.md');
});

it('tells the model what went wrong rather than returning nothing', async () => {
  const tools = new Map(
    skills.makeSkillTools([skill({ files: { 'references/tone.md': 'x' } })]).map((t) => [t.id, t]),
  );
  const context = { readFiles: () => ({}), writeFiles: () => {}, emit: () => 'id', patch: () => {} };

  const unknown = await tools.get('skills.read').run({ package: 'nope' }, context);
  assert.equal(unknown.failed, true);
  assert.match(unknown.observation, /No skill matches "nope"/);
  // Naming the recovery is the point: the model can call `skills.list` next.
  assert.match(unknown.observation, /skills\.list/);

  const empty = await tools.get('skills.read').run({}, context);
  assert.equal(empty.failed, true);
  assert.match(empty.observation, /package must not be empty/);

  const oversized = await tools
    .get('skills.read')
    .run({ package: 'x'.repeat(3_000) }, context);
  assert.equal(oversized.failed, true);
  assert.match(oversized.observation, /exceeds maximum length of 2048 bytes/);

  // A missing resource lists what the skill actually has.
  const missing = await tools
    .get('skills.read')
    .run({ package: 'brand-voice', resource: 'references/nope.md' }, context);
  assert.equal(missing.failed, true);
  assert.match(missing.observation, /has no resource "references\/nope\.md"/);
  assert.match(missing.observation, /It provides: references\/tone\.md/);
});

it('pages skills.list at 20, as upstream does', async () => {
  const many = Array.from({ length: 45 }, (_, index) =>
    skill({ id: `skill-${index}`, name: `Skill ${index}` }),
  );
  const tools = new Map(skills.makeSkillTools(many).map((tool) => [tool.id, tool]));
  const context = { readFiles: () => ({}), writeFiles: () => {}, emit: () => 'id', patch: () => {} };

  const first = JSON.parse((await tools.get('skills.list').run({}, context)).observation);
  assert.equal(first.skills.length, 20);
  assert.equal(first.next_cursor, '20');
  // Each entry carries the handle the model passes to `skills.read`.
  assert.equal(first.skills[0].package, 'skill://skill-0');
  assert.equal(first.skills[0].main_resource, 'SKILL.md');

  const second = JSON.parse(
    (await tools.get('skills.list').run({ cursor: first.next_cursor }, context)).observation,
  );
  assert.equal(second.skills.length, 20);
  assert.equal(second.next_cursor, '40');

  const last = JSON.parse(
    (await tools.get('skills.list').run({ cursor: '40' }, context)).observation,
  );
  assert.equal(last.skills.length, 5);
  assert.equal(last.next_cursor, null, 'the final page ends the walk');
});

/* ====================================================================== */
/* End to end                                                             */
/* ====================================================================== */

it('puts the catalog in the prompt and keeps the bodies out of it', async () => {
  const { transport } = await run(['Nothing to change.\n'], {
    skills: [skill()],
  });

  const { systemPrompt } = transport.rounds[0];
  assert.match(systemPrompt, /## Skills/);
  assert.match(systemPrompt, /- Brand voice: Use when writing user-facing copy\./);
  /*
   * The body is *not* in the prompt. This is the whole economy of progressive
   * disclosure: a skill can be a folder of references, and sending them every
   * turn would cost more context than the task.
   */
  assert.doesNotMatch(systemPrompt, /Never use exclamation marks/);
});

it('sends no Skills section at all when the library is empty', async () => {
  const { transport } = await run(['Nothing to change.\n']);
  assert.doesNotMatch(transport.rounds[0].systemPrompt, /## Skills/);
});

it('restates a named skill with the locator needed to fetch it', async () => {
  /*
   * The catalog's trigger rules already say a named skill must be used, but a
   * mention is a stronger signal than a description match. Restating it with
   * the locator saves the model turning `$BrandVoice` back into
   * `skill://brand-voice` by scanning the catalog, which it gets wrong when two
   * skills share a word.
   */
  const { transport } = await run(['Reading it now.\n'], {
    prompt: 'apply $BrandVoice to the header copy',
    skills: [skill()],
  });

  const firstUserMessage = transport.rounds[0].messages.find((m) => m.role === 'user').content;
  assert.match(firstUserMessage, /<mentioned_skills>/);
  assert.match(firstUserMessage, /Brand voice — package: skill:\/\/brand-voice/);

  // No mention, no note — it must not ride along on every message.
  const quiet = await run(['Fine.\n'], { prompt: 'hello', skills: [skill()] });
  assert.doesNotMatch(
    quiet.transport.rounds[0].messages.find((m) => m.role === 'user').content,
    /<mentioned_skills>/,
  );
});

it('lets the model actually read a skill mid-turn', async () => {
  const { transport } = await run(
    [
      `*** Call: skills.read
{"package": "skill://brand-voice"}
*** End Call
`,
      'Got it — second person, no exclamation marks.\n',
    ],
    { skills: [skill()] },
  );

  const sent = observationsSent(transport);
  assert.match(sent, /Never use exclamation marks/);
  assert.doesNotMatch(sent, /ERROR/);
});

it('withholds the skill tools when there is no library, with a clear reason', async () => {
  // `ALLOWED_TOOLS` still lists them, so the refusal names the reason rather
  // than reporting a tool the harness plainly has as unknown.
  const { transport } = await run([
    `*** Call: skills.read
{"package": "skill://anything"}
*** End Call
`,
    'Understood.\n',
  ]);

  assert.match(observationsSent(transport), /Unknown tool "skills\.read"/);
});

/* ====================================================================== */
/* The shared library                                                     */
/* ====================================================================== */

it('shares one library, published by Spark and read by the harness', () => {
  /*
   * Willow already had the folder and not the seam. Spark's own registration
   * says why the folder is workspace-level:
   *
   *   "Skills is a workspace-level folder so Chat can consume the same library
   *    later."
   *
   * So the library lives in `platform/core` — the repo rule is that anything two
   * features need moves down — and Spark publishes into it. It cannot go the
   * other way: `features/spark` already imports `features/code`, so having
   * `code` read `spark` would close a cycle between two features.
   */
  const register = fs.readFileSync(
    path.join(repoRoot, 'features', 'spark', 'src', 'register.ts'),
    'utf8',
  );
  assert.match(register, /registerSyncedFolder/);
  assert.match(register, /'skills', 'Skills'/, 'Spark still owns the Skills folder');

  const store = fs.readFileSync(
    path.join(repoRoot, 'features', 'spark', 'src', 'spark-store.ts'),
    'utf8',
  );
  assert.match(store, /publishSkills\(/, 'Spark publishes into the shared library');

  const sidebar = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  // Read with the scope, so the library loads itself if Spark has not been
  // opened — see the hydration test below.
  assert.match(sidebar, /skills: enabledSkills\(chatScopeId/, 'the Code tab reads it');

  /*
   * And the harness itself knows nothing about where skills came from — it
   * takes a `LibrarySkill[]`, the same way it takes `extraTools`.
   *
   * Checked as an import rather than as the word "spark", because a prose
   * comment may legitimately cite Spark's runtime doc; what must not exist is a
   * dependency.
   */
  for (const file of [
    harness('runtime', 'agent.ts'),
    harness('runtime', 'skills.ts'),
    harness('overlay', 'skills-prompt.ts'),
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"][^'"]*spark/i,
      `${path.basename(file)} must not import from Spark`,
    );
  }
});

it('loads the library on first read, without Spark having been opened', () => {
  /*
   * The gap this closes was invisible until you hit it.
   *
   * Spark reads its persisted state in `hydrateSparkState`, and the only caller
   * is `SparkWorkspace` — so `state.skills` is empty until the Spark tab has
   * been visited. A user who opened the Code tab in a fresh session and asked
   * the Agent to use a skill got nothing: no error, no explanation, and it
   * would start working later for no reason they could see.
   *
   * So the owner registers a hydrator and every reader triggers it, which is
   * the same shape as `registerSyncedFolder` and `project-contributors`.
   */
  library.resetSkillHydration();

  const hydratedFor = [];
  library.registerSkillHydrator((scopeId) => {
    hydratedFor.push(scopeId);
    library.publishSkills([skill()]);
  });

  // Nothing loaded until someone asks.
  assert.deepEqual(hydratedFor, []);

  const first = library.enabledSkills('user-123');
  assert.deepEqual(hydratedFor, ['user-123']);
  assert.deepEqual(first.map((entry) => entry.id), ['brand-voice']);

  // Once per scope — this is called on every send, so it must be cheap.
  library.enabledSkills('user-123');
  library.enabledSkills('user-123');
  assert.deepEqual(hydratedFor, ['user-123']);

  /*
   * A different scope hydrates again. Storage keys are scoped by user and
   * workspace, so loading "the library" without a scope would serve a
   * signed-out user the previous account's skills.
   */
  library.enabledSkills('guest');
  assert.deepEqual(hydratedFor, ['user-123', 'guest']);

  library.resetSkillHydration();
});

it('wires the hydrator from the feature that owns the skills', () => {
  // Spark declares it in `register.ts`, which `register-features.ts` already
  // imports for side effects — the same place its synced folders are declared.
  const register = fs.readFileSync(
    path.join(repoRoot, 'features', 'spark', 'src', 'register.ts'),
    'utf8',
  );
  assert.match(register, /registerSkillHydrator\(/);
  assert.match(register, /hydrateSparkState\(scopeId\)/);

  // And the Code tab passes its scope, or the hydrator never fires.
  const sidebar = fs.readFileSync(
    path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'),
    'utf8',
  );
  assert.match(sidebar, /enabledSkills\(chatScopeId \|\| 'guest'\)/);

  // The layering rule still holds: platform declares the slot, it does not
  // reach up into the feature that fills it.
  const libSource = fs.readFileSync(
    path.join(repoRoot, 'platform', 'core', 'src', 'skill-library.ts'),
    'utf8',
  );
  assert.doesNotMatch(libSource, /from ['"][^'"]*(features|spark)/i);
});

it('publishes only on a real change', () => {
  // The publisher is driven by a subscription that fires on every Spark state
  // change — task edits, run progress, schedule ticks — so re-setting an
  // identical array would wake every reader on each one.
  const first = [skill()];
  library.publishSkills(first);
  const afterFirst = library.skillLibrary.get();

  library.publishSkills([skill()]);
  assert.equal(library.skillLibrary.get(), afterFirst, 'an identical publish must not re-set');

  library.publishSkills([skill({ instructions: 'changed' })]);
  assert.notEqual(library.skillLibrary.get(), afterFirst);

  // `enabledSkills` is what a turn actually gets.
  library.publishSkills([skill(), skill({ id: 'off', enabled: false })]);
  assert.deepEqual(library.enabledSkills().map((s) => s.id), ['brand-voice']);
});
