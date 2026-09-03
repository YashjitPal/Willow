/**
 * The skills catalog, as upstream describes it to the model.
 *
 * A transcription of `codex-rs/ext/skills/src/catalog_prompt.rs` and the
 * relevant halves of `render.rs`.
 *
 * ## Why the catalog is in the prompt at all
 *
 * Because skill selection happens before any tool call. The model has to know a
 * skill *exists* and roughly when it applies in order to decide to read it, and
 * the catalog is one line per skill — name, description, locator — which is
 * cheap enough to send every turn. The body is not: that is what `skills.read`
 * is for, and upstream calls the two-step "progressive disclosure".
 *
 * ## What is verbatim and what is adapted
 *
 * Upstream has three variants of the usage text, chosen by where the skill
 * lives: `HostAliases` for skills on the host filesystem (the model opens the
 * path itself), and `ResourceAliases` / `Unaliased` for skills owned by an
 * execution environment (the model calls `skills.read`).
 *
 * Willow is the second case, and unambiguously so. Skills live in the
 * workspace's `Skills/` library, while `read_file` reads the *sandbox project* —
 * two different places. The model cannot open a skill by path, so `skills.read`
 * is the only access mechanism and the host-path variant would be a lie.
 *
 * So: the sections that are about **judgement** are upstream's word for word —
 * trigger rules, coordination, context hygiene, safety and fallback, and the
 * instruction that the main agent must read a skill itself rather than
 * delegating it. The sections that name an **access mechanism** are rewritten
 * for `skills.read`, which is the same surgery `prompt-overlay.ts` performs on
 * the shell section and for the same reason: upstream's guidance is right and
 * only its assumption about the environment is wrong.
 *
 * The trigger rules matter most and are the ones to leave alone. They are what
 * makes a skill fire without the user naming it — "OR the task clearly matches
 * a skill's description shown above, you must use that skill for that turn" —
 * and they carry the two rules people get wrong when paraphrasing: multiple
 * mentions mean use them all, and skills do not carry across turns.
 */

import type { LibrarySkill } from '@willow/core/skill-library';

/** `MAX_SKILL_NAME_BYTES` from `render.rs`. */
export const MAX_SKILL_NAME_BYTES = 256;

/** Upstream's intro for skills reached through a provider rather than a path. */
const SKILLS_INTRO =
  'A skill is a set of instructions provided through a `SKILL.md` source. Below ' +
  'is the list of skills that can be used. Each entry includes a name, a ' +
  'description, and a locator you pass to `skills.read`.';

/**
 * `SKILLS_HOW_TO_USE_*`, with the access-mechanism steps rewritten.
 *
 * Compare against `catalog_prompt.rs` before editing. The bullets under
 * *Trigger rules*, *Coordination and sequencing*, *Context hygiene* and *Safety
 * and fallback* are upstream's exactly; only *Discovery* and the numbered
 * progressive-disclosure steps are adapted, because those are the ones that
 * name filesystem paths and package locators.
 */
const SKILLS_HOW_TO_USE = `- Discovery: The list above is the skills available in this session (name + description + locator). Skill bodies are not on disk in this project — read them with \`skills.read\`.
- Trigger rules: If the user names a skill (with \`$SkillName\` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or its source can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, the main agent must read its \`SKILL.md\` completely before taking task actions. Pass the listed locator to \`skills.read\` as \`package\` and omit \`resource\`. If a read is paginated, follow \`next_cursor\` until EOF.
  2) When \`SKILL.md\` references another resource, pass the same \`package\` with that file's path as \`resource\`. Do not treat a skill locator as a path in the project — the project's own files are reached with \`read_file\`, and the two are different places.
  3) If \`SKILL.md\` points to extra folders such as \`references/\`, use its routing instructions to identify the resources required for the task. The main agent must read each required instruction or reference file itself before acting on it. Do not delegate reading, summarizing, or interpreting skill instructions to a subagent. Subagents may still perform task work when the selected skill allows it.
  4) Reuse templates or snippets a skill provides instead of recreating them.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Progressive disclosure applies to selecting relevant files, not partially reading a selected instruction file. Do not load unrelated references, scripts, or assets.
  - Avoid deep reference-chasing: prefer opening only files directly linked from \`SKILL.md\` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.`;

/** The locator a skill is addressed by. Upstream's `skill://` scheme. */
export const skillLocator = (skill: LibrarySkill): string => `skill://${skill.id}`;

/**
 * One catalog line.
 *
 * `render.rs`: `format!("- {name}: {description} ({locator_kind}: {locator})")`,
 * and the description is dropped rather than truncated when absent. The short
 * description wins when present, which is what it is for — upstream stores both
 * so the catalog can stay one line while `skills.read` gets the long form.
 */
export function renderSkillLine(skill: LibrarySkill): string {
  const name = truncateBytes(skill.name, MAX_SKILL_NAME_BYTES);
  const description = skill.shortDescription || skill.description;
  const locator = `skill: ${skillLocator(skill)}`;
  return description ? `- ${name}: ${description} (${locator})` : `- ${name}: (${locator})`;
}

/**
 * `render_available_skills_body`.
 *
 * Returns an empty string when there are no skills, so a workspace with none
 * pays nothing — the section is absent rather than present and empty, which
 * would otherwise read to the model as "you have skills, here are none".
 */
export function renderSkillsSection(skills: LibrarySkill[]): string {
  if (skills.length === 0) return '';

  return [
    '## Skills',
    SKILLS_INTRO,
    '### Available skills',
    ...skills.map(renderSkillLine),
    '',
    SKILLS_HOW_TO_USE,
  ].join('\n');
}

/** Truncates on a UTF-8 byte budget without splitting a character. */
export function truncateBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;

  let out = '';
  let used = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (used + size > maxBytes) break;
    out += character;
    used += size;
  }
  return out;
}
