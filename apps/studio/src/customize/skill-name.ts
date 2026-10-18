/**
 * A skill's name, by Gemini's skill-editor rules: lowercase letters, numbers and single hyphens between them, 1 to
 * 64 characters, and not another of the user's skills. The field rewrites what is typed into that shape as it goes.
 */

export const SKILL_NAME_PATTERN = /^[\p{Ll}\p{Lo}\p{N}\p{M}](-?[\p{Ll}\p{Lo}\p{N}\p{M}])*$/u;

export const SKILL_NAME_MAX = 64;

export const SKILL_ERRORS = {
  nameFormat: 'Use lowercase letters, numbers and hyphens only. Must not start or end with a hyphen (1–64 chars).',
  nameEmpty: 'Enter a skill name',
  nameTaken: 'Skill name already exists. Enter a different name.',
  description: 'Enter a skill description',
  instructions: 'Enter skill instructions',
} as const;

/** What the name field keeps of a keystroke: lowercased, spaces to hyphens, one hyphen at a time, nothing else. */
export const slugSkillName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{Ll}\p{Lo}\p{N}\p{M}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

export const isSkillNameInvalid = (name: string): boolean => {
  const trimmed = name.trim();
  return Boolean(trimmed) && (trimmed.length > SKILL_NAME_MAX || !SKILL_NAME_PATTERN.test(trimmed));
};

/** Another skill has it; a skill keeps its own name. */
export const isSkillNameTaken = (name: string, original: string, existing: readonly string[]): boolean => {
  const trimmed = name.trim();
  return Boolean(trimmed) && trimmed !== original.trim() && existing.includes(trimmed);
};

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
}

export const canSaveSkill = (draft: SkillDraft, original: string, existing: readonly string[]): boolean =>
  Boolean(draft.name.trim() && draft.description.trim() && draft.instructions.trim())
  && !isSkillNameTaken(draft.name, original, existing)
  && !isSkillNameInvalid(draft.name);

/**
 * The messages under each field. The name, description and instructions ones wait for a press of Create or Save
 * (`validated`); a taken name shows at once.
 */
export const skillErrors = (draft: SkillDraft, original: string, existing: readonly string[], validated: boolean) => ({
  name: validated && !draft.name.trim()
    ? SKILL_ERRORS.nameEmpty
    : validated && isSkillNameInvalid(draft.name) ? SKILL_ERRORS.nameFormat : null,
  taken: isSkillNameTaken(draft.name, original, existing) ? SKILL_ERRORS.nameTaken : null,
  description: validated && !draft.description.trim() ? SKILL_ERRORS.description : null,
  instructions: validated && !draft.instructions.trim() ? SKILL_ERRORS.instructions : null,
});
