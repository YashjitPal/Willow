/**
 * Skills in the Code harness.
 *
 * A skill is a `SKILL.md`: frontmatter naming it and saying when it applies,
 * then instructions, plus any supporting files it ships. Users add them in
 * Customize → Skills and Spark → Skills; both publish into the shared library in
 * `@willow/core/skill-library`, which is all this module reads.
 *
 * ## Progressive disclosure
 *
 * The system prompt carries one line per skill — name, description, locator —
 * and the bodies are fetched with `read_skill` only when a skill applies. A
 * skill can be pages of reference material; sending every body every turn would
 * cost more context than the task. This is the design Codex's skills use, and
 * the trigger rules below keep its two non-obvious rules: several mentions mean
 * use them all, and a skill does not carry over into later turns by itself.
 *
 * ## Mentions
 *
 * `$name` anywhere (Codex's sigil, with its exclusions for shell variables like
 * `$PATH`), the linked form `[$name](skill://id)` a menu inserts, and `/name` as
 * the first word of a message — the form Customize's "Use now" produces.
 * Matching squashes both sides to letters and digits, because a mention ends at
 * the first space: a skill called "Brand voice" can only be written `$BrandVoice`.
 */

import type { LibrarySkill } from '@willow/core/skill-library';
import { nextId } from './protocol';
import type { HarnessTool } from './tools';

const SKILL_SCHEME = 'skill://';
const SKILL_FILENAME = 'SKILL.md';
const MAX_SKILL_RESPONSE_CHARS = 120_000;
const MAX_CATALOG_SKILLS = 60;

const COMMON_ENV_VARS = new Set(['PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TERM', 'XDG_CONFIG_HOME']);

const isMentionChar = (character: string): boolean => /^[A-Za-z0-9_:-]$/.test(character);

const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface SkillMentions {
  names: Set<string>;
  paths: Set<string>;
}

/** `$name`, `[$name](skill://id)`, and a leading `/name`. */
export function extractSkillMentions(text: string): SkillMentions {
  const names = new Set<string>();
  const paths = new Set<string>();

  const leadingSlash = /^\s*\/([A-Za-z][\w:-]*)(?=\s|$)/.exec(text);
  if (leadingSlash) names.add(leadingSlash[1]!);

  let index = 0;
  while (index < text.length) {
    if (text[index] === '[' && text[index + 1] === '$') {
      const linked = /^\[\$([A-Za-z0-9_:-]+)\]\s*\(([^)\s]+)\)/.exec(text.slice(index));
      if (linked) {
        if (!COMMON_ENV_VARS.has(linked[1]!.toUpperCase())) {
          names.add(linked[1]!);
          paths.add(linked[2]!);
        }
        index += linked[0].length;
        continue;
      }
    }
    if (text[index] !== '$' || !isMentionChar(text[index + 1] ?? '')) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < text.length && isMentionChar(text[end]!)) end += 1;
    const name = text.slice(index + 1, end);
    if (!COMMON_ENV_VARS.has(name.toUpperCase()) && !/^\d+$/.test(name)) names.add(name);
    index = end;
  }

  return { names, paths };
}

const normalizeLocator = (value: string): string => (value.startsWith(SKILL_SCHEME) ? value.slice(SKILL_SCHEME.length) : value);

/** The skills a message names, matched by id or by name. */
export function skillsMentionedIn(text: string, skills: readonly LibrarySkill[]): LibrarySkill[] {
  const mentions = extractSkillMentions(text);
  if (mentions.names.size === 0 && mentions.paths.size === 0) return [];
  const wanted = new Set<string>();
  for (const name of mentions.names) wanted.add(squash(name));
  for (const path of mentions.paths) wanted.add(squash(normalizeLocator(path).split('/')[0]!));
  return skills.filter((skill) => wanted.has(squash(skill.id)) || wanted.has(squash(skill.name)));
}

export const skillLocator = (skill: LibrarySkill): string => `${SKILL_SCHEME}${skill.id}`;

function findSkill(skills: readonly LibrarySkill[], handle: string): LibrarySkill | undefined {
  const needle = normalizeLocator(handle.trim()).split('/')[0]!;
  const exact = skills.find((skill) => skill.id === needle || skill.name.toLowerCase() === needle.toLowerCase());
  if (exact) return exact;
  const squashed = squash(needle);
  return skills.find((skill) => squash(skill.id) === squashed || squash(skill.name) === squashed);
}

/** The full `SKILL.md`, frontmatter included, since the model is told to read it completely. */
export function skillDocument(skill: LibrarySkill): string {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.shortDescription) lines.push('metadata:', `  short-description: ${skill.shortDescription}`);
  lines.push('---', '', skill.instructions.trim(), '');
  return lines.join('\n');
}

/** The prompt section: one line per skill, then how to use them. Empty when there are none. */
export function renderSkillsSection(skills: readonly LibrarySkill[]): string {
  if (skills.length === 0) return '';
  const shown = skills.slice(0, MAX_CATALOG_SKILLS);
  const lines = shown.map((skill) => {
    const description = (skill.shortDescription || skill.description || '').replace(/\s+/g, ' ').trim();
    return `- ${skill.name}: ${description ? `${description} ` : ''}(${skillLocator(skill)})`;
  });
  if (skills.length > shown.length) lines.push(`- …and ${skills.length - shown.length} more; ask read_skill for one by name.`);

  return [
    '# Skills',
    '',
    'Skills are instructions for how certain kinds of work are done here — Willow\'s own and the ones the user installed. Each entry is a name, when it applies, and a locator.',
    '',
    ...lines,
    '',
    'How to use them:',
    '- If the user names a skill (`$Name`, `/name`, or in plain words), or the task clearly matches a skill\'s description, you must use that skill for this turn. Several mentions mean use them all. Skills do not carry over to later turns unless mentioned again.',
    '- Before acting, read the skill completely with `read_skill` (pass the locator as "name"). If it points to other files, read the ones the task needs with `"file"`. Read skills yourself; do not guess at their contents.',
    '- Follow the skill where it applies to this project. If part of it cannot apply here (it assumes a server, another language, or a tool you do not have), say so in one line and do the closest thing that works in this app.',
    '- Mention which skill you are using in your opening sentence. If a named skill is not in this list, say so briefly and continue.',
  ].join('\n');
}

/** `read_skill`, over a snapshot of the library taken when the turn began. */
export function makeSkillTools(skills: readonly LibrarySkill[]): HarnessTool[] {
  if (skills.length === 0) return [];
  return [
    {
      name: 'read_skill',
      description: "Reads a skill's SKILL.md, or one of its other files.",
      signature: '{"name": "skill://brand-voice", "file"?: "references/tone.md"}',
      readOnly: true,
      source: 'skill',
      startStep: (args) => {
        const handle = String(args.name ?? args.skill ?? args.package ?? args.locator ?? '');
        const skill = findSkill(skills, handle);
        return { id: nextId('step'), kind: 'skill', name: skill?.name ?? (normalizeLocator(handle) || 'skill'), status: 'running' };
      },
      async run(args, context) {
        const handle = String(args.name ?? args.skill ?? args.package ?? args.locator ?? '').trim();
        if (!handle) return { output: 'read_skill needs a "name".', isError: true, step: { status: 'error' } };
        const skill = findSkill(skills, handle);
        if (!skill) {
          return {
            output: `No skill matches ${JSON.stringify(handle)}. Installed skills: ${skills.map((entry) => `${entry.name} (${skillLocator(entry)})`).join(', ')}.`,
            isError: true,
            step: { status: 'error', error: 'not found' },
          };
        }

        const rawFile = String(args.file ?? args.resource ?? '').trim();
        const fromLocator = normalizeLocator(handle).split('/').slice(1).join('/');
        const file = (rawFile || fromLocator).replace(/^\.?\//, '');
        const wantsMain = !file || file.toUpperCase().endsWith(SKILL_FILENAME.toUpperCase());

        const contents = wantsMain ? skillDocument(skill) : skill.files?.[file];
        if (contents === undefined) {
          const available = Object.keys(skill.files ?? {});
          return {
            output: `${skill.name} has no file ${JSON.stringify(file)}.${available.length > 0 ? ` It provides: ${available.join(', ')}.` : ' It provides only SKILL.md.'}`,
            isError: true,
            step: { name: skill.name, status: 'error' },
          };
        }

        const clipped = contents.length > MAX_SKILL_RESPONSE_CHARS
          ? `${contents.slice(0, MAX_SKILL_RESPONSE_CHARS)}\n[…truncated]`
          : contents;
        const extra = wantsMain && skill.files && Object.keys(skill.files).length > 0
          ? `\n\nOther files in this skill: ${Object.keys(skill.files).join(', ')}`
          : '';
        if (wantsMain) context?.readSkills?.add(skill.id);
        return {
          output: `<skill name="${skill.name}" file="${wantsMain ? SKILL_FILENAME : file}">\n${clipped}\n</skill>${extra}`,
          step: { name: skill.name, status: 'done' },
        };
      },
    },
  ];
}
