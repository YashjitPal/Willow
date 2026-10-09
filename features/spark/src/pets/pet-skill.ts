export interface HatchPetSkill {
  name: string;
  description: string;
  instructions: string;
}

/**
 * The Hatch Pet SKILL.md as a Spark skill: its front matter for the name and
 * description, its body for the instructions, with the skill's folder and the
 * pet library put in for `<skill>` and `<library>`.
 */
export const hatchPetSkill = (text: string, skillDirectory: string, library: string): HatchPetSkill => {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  const front = match?.[1] ?? '';
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(front)?.[1].trim() ?? '';
  return {
    name: field('name') || 'hatch-pet',
    description: field('description'),
    instructions: (match?.[2] ?? normalized).trim().replaceAll('<skill>', skillDirectory).replaceAll('<library>', library),
  };
};
