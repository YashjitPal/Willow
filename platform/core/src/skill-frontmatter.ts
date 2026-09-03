/**
 * `SKILL.md` frontmatter — a port of `codex-rs/skills/src/parser.rs`.
 *
 * A skill is a folder with a `SKILL.md` at its root. The file opens with a YAML
 * frontmatter block naming the skill and describing when to use it; everything
 * after the block is the instructions.
 *
 *     ---
 *     name: Brand voice
 *     description: Use when writing user-facing copy for the marketing site.
 *     metadata:
 *       short-description: Marketing copy rules
 *     ---
 *
 *     Write in second person...
 *
 * ## Why this lives in `platform/core`
 *
 * Three surfaces need it. Spark already reads and writes `SKILL.md` for its
 * import/export buttons with a regex that only understands `name` and
 * `description`; the Code tab's Agent harness needs the full shape; and Chat is
 * the stated next consumer of the same library. A parser that disagrees with
 * itself between surfaces means a skill that imports in one place and fails in
 * another, so there is one.
 *
 * ## The one deliberate difference from upstream
 *
 * Upstream parses the block with `serde_yaml`, which is strict — and because it
 * is strict, upstream carries a 90-line `repair_frontmatter_scalar_fields` pass
 * whose entire job is to re-quote prose that YAML rejects. Its own comment
 * explains why:
 *
 *   "Some third-party skills use prose like `description: Build for AWS: ECS`
 *    or `argument-hint: <duration: e.g. 7d>`."
 *
 * This is a line-oriented parser over the three fields that actually exist, so
 * that whole class of failure cannot occur: everything after the first `: ` is
 * the value, colons and brackets included. The repair pass is therefore not
 * ported — it would be dead code guarding against a strictness we do not have.
 *
 * What that costs: this does not accept YAML shapes the three fields never use
 * — block scalars (`description: |`), flow mappings, anchors. Upstream would.
 * A skill relying on one gets a clear parse error rather than silent mangling,
 * which is the right trade for a format whose entire schema is three strings.
 */

/** `MAX_NAME_LEN`. */
export const MAX_SKILL_NAME_LEN = 64;

/** `ParsedSkillFrontmatter`. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  shortDescription?: string;
}

/**
 * `SkillParseError`, rendered.
 *
 * The messages are upstream's, formatted the same way, because they surface to
 * whoever is authoring the skill and "missing field `description`" is
 * actionable in a way that "invalid skill" is not.
 */
export type SkillParseFailure =
  | { kind: 'missing-frontmatter'; message: string }
  | { kind: 'missing-field'; field: string; message: string }
  | { kind: 'invalid-field'; field: string; message: string };

export type SkillParseResult =
  | { ok: true; value: SkillFrontmatter }
  | { ok: false; error: SkillParseFailure };

const missingFrontmatter = (): SkillParseResult => ({
  ok: false,
  error: {
    kind: 'missing-frontmatter',
    message: 'missing YAML frontmatter delimited by ---',
  },
});

const missingField = (field: string): SkillParseResult => ({
  ok: false,
  error: { kind: 'missing-field', field, message: `missing field \`${field}\`` },
});

const invalidField = (field: string, reason: string): SkillParseResult => ({
  ok: false,
  error: { kind: 'invalid-field', field, message: `invalid ${field}: ${reason}` },
});

/** `sanitize_single_line`: collapse all whitespace runs to single spaces. */
export const sanitizeSingleLine = (raw: string): string =>
  raw.split(/\s+/).filter(Boolean).join(' ');

/**
 * `extract_frontmatter`.
 *
 * The first line must be exactly `---` (trimmed), and the block runs to the
 * next such line. An unterminated or empty block is *not* frontmatter — it is a
 * markdown horizontal rule at the top of a file, which is a legal thing to
 * write and must not be misread as metadata.
 */
export function extractFrontmatter(contents: string): string | null {
  const lines = contents.split(/\r?\n/);
  if (lines.length === 0 || lines[0]!.trim() !== '---') return null;

  const body: string[] = [];
  let foundClosing = false;
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') {
      foundClosing = true;
      break;
    }
    body.push(line);
  }

  if (body.length === 0 || !foundClosing) return null;
  return body.join('\n');
}

/** The instructions: everything after the closing `---`. */
export function extractSkillBody(contents: string): string {
  const lines = contents.split(/\r?\n/);
  if (lines.length === 0 || lines[0]!.trim() !== '---') return contents.trim();

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.trim() === '---') {
      return lines.slice(index + 1).join('\n').trim();
    }
  }
  return '';
}

/** Strips one layer of matching quotes, the way a YAML scalar would lose them. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    const inner = trimmed.slice(1, -1);
    // YAML escapes a single quote by doubling it.
    return first === "'" ? inner.replace(/''/g, "'") : inner;
  }
  return trimmed;
}

interface Fields {
  name?: string;
  description?: string;
  shortDescription?: string;
}

/**
 * Reads the three fields out of the block.
 *
 * Line-oriented and deliberately shallow: top-level `key: value`, plus exactly
 * one nested level so `metadata:` / `  short-description:` resolves. Nesting is
 * tracked by indentation, which is all the schema needs — there is no third
 * level anywhere in the format.
 *
 * A comment line and a `#` at end of an unquoted value are both dropped, since
 * YAML would drop them and a description ending in a stray comment reads as a
 * mistake either way.
 */
function readFields(frontmatter: string): Fields {
  const fields: Fields = {};
  /** The top-level key whose nested block we are inside, if any. */
  let parentKey: string | null = null;
  let parentIndent = 0;

  for (const raw of frontmatter.split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;

    const indent = raw.length - raw.replace(/^ +/, '').length;
    const separator = raw.indexOf(':');
    if (separator === -1) continue;

    const key = raw.slice(0, separator).trim();
    // Everything after the *first* colon is the value. This is what makes
    // `description: Build for AWS: ECS` work without upstream's repair pass.
    let value = raw.slice(separator + 1);

    if (parentKey !== null && indent <= parentIndent) parentKey = null;

    if (value.trim() === '') {
      // A key with no value opens a nested block.
      parentKey = key;
      parentIndent = indent;
      continue;
    }

    // An unquoted `#` preceded by whitespace starts a comment.
    if (!/^\s*["']/.test(value)) {
      const comment = value.search(/(?:^|\s)#/);
      if (comment !== -1) value = value.slice(0, comment);
    }

    const clean = sanitizeSingleLine(unquote(value));

    if (parentKey === 'metadata' && key === 'short-description') {
      fields.shortDescription = clean;
      continue;
    }
    if (parentKey !== null) continue;

    if (key === 'name') fields.name = clean;
    else if (key === 'description') fields.description = clean;
  }

  return fields;
}

/**
 * `parse_skill_frontmatter_metadata`.
 *
 * `defaultName` is used when the block omits `name` or leaves it blank —
 * upstream passes the skill's directory name, which is what makes a `SKILL.md`
 * with only a description still loadable.
 */
export function parseSkillFrontmatter(
  contents: string,
  defaultName: () => string,
): SkillParseResult {
  const frontmatter = extractFrontmatter(contents);
  if (frontmatter === null) return missingFrontmatter();

  const fields = readFields(frontmatter);

  const name = fields.name && fields.name !== '' ? fields.name : sanitizeSingleLine(defaultName());
  const description = fields.description ?? '';
  const shortDescription =
    fields.shortDescription && fields.shortDescription !== ''
      ? fields.shortDescription
      : undefined;

  // `validate_len(&name, MAX_NAME_LEN, "name")` — empty is a missing field, too
  // long is an invalid one, and the two get different messages upstream.
  if (name === '') return missingField('name');
  if ([...name].length > MAX_SKILL_NAME_LEN) {
    return invalidField('name', `exceeds maximum length of ${MAX_SKILL_NAME_LEN} characters`);
  }
  if (description === '') return missingField('description');

  return { ok: true, value: { name, description, shortDescription } };
}

/**
 * Renders frontmatter back out, for export.
 *
 * Kept beside the parser so the round trip is provably lossless for the fields
 * the format has — Spark builds this string by hand today in two places, and
 * the two had already drifted from what its own importer accepts.
 */
export function renderSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  body: string,
): string {
  const lines = ['---', `name: ${frontmatter.name}`, `description: ${frontmatter.description}`];
  if (frontmatter.shortDescription) {
    lines.push('metadata:', `  short-description: ${frontmatter.shortDescription}`);
  }
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}
