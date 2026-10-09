import type { LibrarySkill } from '@willow/core/skill-library';

/** Supporting files ride along until this much text, then only their names do. */
const SKILL_FILES_BUDGET = 12000;

const list = (names: readonly string[]): string =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * A skill the user picked with "/": its instructions, for this turn only. Chat has no
 * `read_skill` tool (the Code harness's progressive disclosure), so the body goes in whole and
 * its supporting files follow while they fit.
 */
export const mentionedSkillsBlock = (skills: readonly LibrarySkill[] = []): string => skills.map((skill) => {
  const lines = [
    `## The "${skill.name}" skill`,
    `The user invoked this skill with /${skill.name} for this message. Follow its instructions:`,
    '',
    skill.instructions.trim(),
  ];
  const files = Object.entries(skill.files ?? {});
  if (files.length > 0) {
    let budget = SKILL_FILES_BUDGET;
    const included: string[] = [];
    const named: string[] = [];
    for (const [path, body] of files) {
      if (body.length <= budget) {
        included.push(`### ${path}\n${body.trim()}`);
        budget -= body.length;
      } else named.push(path);
    }
    if (included.length > 0) lines.push('', 'Its supporting files:', '', ...included);
    if (named.length > 0) lines.push('', `It also ships ${list(named)}, too long to include here.`);
  }
  return lines.join('\n');
}).join('\n\n');

/** Apps the user named with "@": Gemini routes the message to them, so the model is told to. */
export const mentionedAppsBlock = (apps: readonly string[] = []): string => (apps.length === 0 ? '' : [
  '## Apps the user named',
  `The user named ${list(apps)} with "@" in this message. Answer it with ${apps.length === 1 ? 'that app\'s' : 'those apps\''} tools, calling them before you answer.`,
].join('\n'));
