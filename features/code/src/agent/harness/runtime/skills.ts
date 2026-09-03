/**
 * The `skills.list` and `skills.read` tools, and `$mention` resolution.
 *
 * Ports of `codex-rs/ext/skills/src/tools/{list,read}.rs` and
 * `codex-rs/skills/src/mentions.rs`.
 *
 * ## The two-step, and why it is two steps
 *
 * The prompt carries a one-line catalog entry per skill; the body is fetched on
 * demand. Upstream calls this progressive disclosure and it is the whole design:
 * a skill can be a folder of reference documents and scripts, and sending all of
 * them every turn would cost more context than the task. So the model reads the
 * catalog, decides, and calls `skills.read`.
 *
 * `skills.list` exists for the case where the catalog was bounded — a large
 * library is truncated in the prompt with a note, and `list` is how the model
 * sees the rest. It is paginated at 20 entries, as upstream is.
 *
 * ## `$mentions`
 *
 * Upstream's sigil is `$`, not `@` — `TOOL_MENTION_SIGIL` in `mentions.rs`. It
 * also accepts a linked form, `[$name](skill://id)`, which is what a UI inserts
 * when the user picks a skill from a menu rather than typing its name.
 *
 * The exclusion list is the part that looks arbitrary and is not: `$PATH`,
 * `$HOME`, `$USER` and friends are never skill mentions, because a prompt about
 * shell configuration is full of them. Upstream hard-codes the same twelve.
 */

import {
  extractSkillBody,
  parseSkillFrontmatter,
  type SkillFrontmatter,
} from '@willow/core/skill-frontmatter';
import type { LibrarySkill } from '@willow/core/skill-library';
import { skillLocator, truncateBytes } from '../overlay/skills-prompt';
import type { ToolHandler, ToolResult } from './protocol';

/** `MAX_HANDLE_BYTES`. */
const MAX_HANDLE_BYTES = 2_048;
/** `MAX_SKILL_RESPONSE_BYTES`. */
const MAX_SKILL_RESPONSE_BYTES = 512 * 1024;
/** `MAX_SKILLS_PER_PAGE`. */
const MAX_SKILLS_PER_PAGE = 20;

/** `SKILL_PATH_PREFIX`. */
const SKILL_PATH_PREFIX = 'skill://';
/** `SKILL_FILENAME`. */
const SKILL_FILENAME = 'SKILL.md';
/** `TOOL_MENTION_SIGIL`. */
const TOOL_MENTION_SIGIL = '$';

/* ------------------------------------------------------------------------ */
/* Tool descriptions, verbatim                                               */
/* ------------------------------------------------------------------------ */

/** `list.rs`'s spec description. */
export const SKILLS_LIST_DESCRIPTION =
  "List skills owned by the requested authority. Returns each skill's authority, " +
  'package, and main_resource. Pass the package to skills.read, and pass ' +
  'next_cursor back as cursor to continue.';

/**
 * `read.rs`'s spec description, minus its executor-filesystem sentence.
 *
 * That sentence tells the model `skill_root` is "the skill's absolute directory
 * in the executor filesystem and can be used to locate bundled scripts". There
 * is no such filesystem here and no `skill_root` in the response, so keeping it
 * would point the model at a path that does not exist.
 */
export const SKILLS_READ_DESCRIPTION =
  'Read one page from a skill. Pass its provided package directly. Omit resource ' +
  "to read SKILL.md; to read another file, use the same package and pass the " +
  "file's path as resource. If the package is not provided, use skills.list to " +
  'find it. Pass next_cursor back as cursor to continue the same snapshot; omit ' +
  'cursor to read again.';

/* ------------------------------------------------------------------------ */
/* Mentions                                                                  */
/* ------------------------------------------------------------------------ */

/** `is_common_env_var`. A prompt about shell config is full of these. */
const COMMON_ENV_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'PWD',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'TERM',
  'XDG_CONFIG_HOME',
]);

const isCommonEnvVar = (name: string): boolean => COMMON_ENV_VARS.has(name.toUpperCase());

/** `is_mention_name_char`. */
const isMentionNameChar = (character: string): boolean => /^[A-Za-z0-9_:-]$/.test(character);

export interface ToolMentions {
  /** Bare `$name` mentions. */
  names: Set<string>;
  /** Paths from the linked `[$name](path)` form. */
  paths: Set<string>;
}

/**
 * `extract_tool_mentions`.
 *
 * Scans for `$name` and for `[$name](path)`. The linked form records the path
 * *and* the name, so a menu insertion still matches by name if the path does
 * not resolve.
 */
export function extractToolMentions(text: string): ToolMentions {
  const names = new Set<string>();
  const paths = new Set<string>();

  let index = 0;
  while (index < text.length) {
    if (text[index] === '[') {
      const linked = parseLinkedMention(text, index);
      if (linked) {
        if (!isCommonEnvVar(linked.name)) {
          names.add(linked.name);
          paths.add(linked.path);
        }
        index = linked.end;
        continue;
      }
    }

    if (text[index] !== TOOL_MENTION_SIGIL) {
      index += 1;
      continue;
    }

    const start = index + 1;
    if (start >= text.length || !isMentionNameChar(text[start]!)) {
      index += 1;
      continue;
    }

    let end = start + 1;
    while (end < text.length && isMentionNameChar(text[end]!)) end += 1;

    const name = text.slice(start, end);
    if (!isCommonEnvVar(name)) names.add(name);
    index = end;
  }

  return { names, paths };
}

/** `parse_linked_tool_mention`. */
function parseLinkedMention(
  text: string,
  start: number,
): { name: string; path: string; end: number } | null {
  if (text[start + 1] !== TOOL_MENTION_SIGIL) return null;

  const nameStart = start + 2;
  if (nameStart >= text.length || !isMentionNameChar(text[nameStart]!)) return null;

  let nameEnd = nameStart + 1;
  while (nameEnd < text.length && isMentionNameChar(text[nameEnd]!)) nameEnd += 1;
  if (text[nameEnd] !== ']') return null;

  let pathStart = nameEnd + 1;
  while (pathStart < text.length && /\s/.test(text[pathStart]!)) pathStart += 1;
  if (text[pathStart] !== '(') return null;

  let pathEnd = pathStart + 1;
  while (pathEnd < text.length && text[pathEnd] !== ')') pathEnd += 1;
  if (text[pathEnd] !== ')') return null;

  const path = text.slice(pathStart + 1, pathEnd).trim();
  if (path === '') return null;

  return { name: text.slice(nameStart, nameEnd), path, end: pathEnd + 1 };
}

/** `normalize_skill_path`. */
export const normalizeSkillPath = (path: string): string =>
  path.startsWith(SKILL_PATH_PREFIX) ? path.slice(SKILL_PATH_PREFIX.length) : path;

/** `is_skill_filename`. */
export const isSkillFilename = (path: string): boolean =>
  (path.split(/[/\\]/).pop() ?? path).toUpperCase() === SKILL_FILENAME.toUpperCase();

/**
 * Squashes a name to what a `$mention` of it can possibly look like.
 *
 * A mention terminates at the first character outside `[A-Za-z0-9_:-]`, so a
 * skill called "Brand voice" **cannot** be written `$Brand voice` — the space
 * ends the name and only `$Brand` is captured. The only way to name it is
 * `$BrandVoice` or `$brandvoice`.
 *
 * So both sides are squashed to letters and digits before comparing. Without
 * this, upstream's own trigger rule — "If the user names a skill (with
 * `$SkillName` or plain text)" — is unsatisfiable for every skill whose name
 * has a space in it, which is most of them.
 */
const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The skills a message names.
 *
 * Matched on id and on name, because a user types the name they see in the
 * catalog and a menu inserts the id. Both are compared squashed — see above.
 */
export function skillsMentionedIn(text: string, skills: LibrarySkill[]): LibrarySkill[] {
  const mentions = extractToolMentions(text);
  if (mentions.names.size === 0 && mentions.paths.size === 0) return [];

  const wanted = new Set<string>();
  for (const name of mentions.names) wanted.add(squash(name));
  for (const path of mentions.paths) wanted.add(squash(normalizeSkillPath(path)));

  return skills.filter(
    (skill) => wanted.has(squash(skill.id)) || wanted.has(squash(skill.name)),
  );
}

/* ------------------------------------------------------------------------ */
/* The tools                                                                 */
/* ------------------------------------------------------------------------ */

/** Resolves a locator, a bare id, or a name to a skill. */
function findSkill(skills: LibrarySkill[], handle: string): LibrarySkill | undefined {
  const needle = normalizeSkillPath(handle.trim()).toLowerCase();
  return skills.find(
    (skill) => skill.id.toLowerCase() === needle || skill.name.toLowerCase() === needle,
  );
}

/** `validate_handle`. */
function validateHandle(field: string, value: string): string | null {
  if (value.trim() === '') return `${field} must not be empty`;
  if (new TextEncoder().encode(value).length > MAX_HANDLE_BYTES) {
    return `${field} exceeds maximum length of ${MAX_HANDLE_BYTES} bytes`;
  }
  return null;
}

/** The full `SKILL.md` for a skill, frontmatter included. */
function skillDocument(skill: LibrarySkill): string {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.shortDescription) {
    lines.push('metadata:', `  short-description: ${skill.shortDescription}`);
  }
  lines.push('---', '', skill.instructions.trim(), '');
  return lines.join('\n');
}

/**
 * Pages a body on a byte budget.
 *
 * `next_cursor` is a byte offset. Upstream caches a snapshot per cursor and
 * says so in the tool description ("continue the same snapshot while it is
 * cached"); here the library is in memory and immutable for the turn, so the
 * offset is enough and there is nothing to cache.
 */
function page(contents: string, cursor: string | undefined): {
  slice: string;
  nextCursor: string | null;
} {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(contents);
  const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;

  if (start >= bytes.length) return { slice: '', nextCursor: null };

  const end = Math.min(bytes.length, start + MAX_SKILL_RESPONSE_BYTES);
  const slice = new TextDecoder().decode(bytes.slice(start, end));
  return { slice, nextCursor: end < bytes.length ? String(end) : null };
}

/**
 * Builds the two tools over a snapshot of the library.
 *
 * A snapshot rather than a live read: a turn's catalog is in its system prompt,
 * so a skill appearing or vanishing mid-turn would make `skills.read` disagree
 * with what the model was told it had.
 */
export function makeSkillTools(skills: LibrarySkill[]): ToolHandler[] {
  return [
    {
      id: 'skills.list',
      run: async (args): Promise<ToolResult> => {
        const cursor = typeof args.cursor === 'string' ? args.cursor : undefined;
        const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
        const window = skills.slice(start, start + MAX_SKILLS_PER_PAGE);
        const next = start + window.length;

        return {
          observation: JSON.stringify({
            skills: window.map((skill) => ({
              name: truncateBytes(skill.name, 256),
              description: skill.shortDescription || skill.description,
              package: skillLocator(skill),
              main_resource: SKILL_FILENAME,
            })),
            next_cursor: next < skills.length ? String(next) : null,
          }),
        };
      },
    },
    {
      id: 'skills.read',
      run: async (args): Promise<ToolResult> => {
        const handle = typeof args.package === 'string' ? args.package : '';
        const invalid = validateHandle('package', handle);
        if (invalid) return { observation: `skills.read: ${invalid}`, failed: true };

        const skill = findSkill(skills, handle);
        if (!skill) {
          return {
            observation:
              `No skill matches ${JSON.stringify(handle)}. Call skills.list to see what ` +
              'is available.',
            failed: true,
          };
        }

        const resourceRaw = typeof args.resource === 'string' ? args.resource.trim() : '';
        if (resourceRaw) {
          const invalidResource = validateHandle('resource', resourceRaw);
          if (invalidResource) {
            return { observation: `skills.read: ${invalidResource}`, failed: true };
          }
        }

        // Omitted, or naming SKILL.md itself, reads the document.
        const wantsMain = resourceRaw === '' || isSkillFilename(resourceRaw);
        const resource = wantsMain ? SKILL_FILENAME : stripSkillPrefix(resourceRaw, skill);

        const contents = wantsMain ? skillDocument(skill) : skill.files?.[resource];
        if (contents === undefined) {
          const available = Object.keys(skill.files ?? {});
          return {
            observation:
              `${skill.name} has no resource ${JSON.stringify(resource)}.` +
              (available.length > 0
                ? ` It provides: ${available.join(', ')}.`
                : ' It provides only SKILL.md.'),
            failed: true,
          };
        }

        const { slice, nextCursor } = page(
          contents,
          typeof args.cursor === 'string' ? args.cursor : undefined,
        );

        return {
          observation: JSON.stringify({
            resource,
            contents: slice,
            next_cursor: nextCursor,
          }),
        };
      },
    },
  ];
}

/** A resource may arrive as `skill://<id>/references/x.md` or bare. */
function stripSkillPrefix(resource: string, skill: LibrarySkill): string {
  const withoutScheme = normalizeSkillPath(resource);
  const prefix = `${skill.id}/`;
  return withoutScheme.startsWith(prefix)
    ? withoutScheme.slice(prefix.length)
    : withoutScheme;
}

/**
 * Turns a `SKILL.md` document into a library skill.
 *
 * Used by an importer: the file is the interchange format, so anything that
 * accepts one — a drop target, a paste box, a folder read — comes through here.
 */
export function skillFromDocument(
  id: string,
  contents: string,
  files?: Record<string, string>,
): { ok: true; skill: LibrarySkill } | { ok: false; error: string } {
  const parsed = parseSkillFrontmatter(contents, () => id);
  if (parsed.ok !== true) return { ok: false, error: parsed.error.message };

  const frontmatter: SkillFrontmatter = parsed.value;
  return {
    ok: true,
    skill: {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      shortDescription: frontmatter.shortDescription,
      instructions: extractSkillBody(contents),
      files,
      enabled: true,
    },
  };
}
