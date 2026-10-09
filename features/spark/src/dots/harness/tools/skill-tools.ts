/**
 * `improve_skill`: improving a skill already in Willow, as Hermes's agents patch theirs — one exact passage swapped,
 * or the instructions rewritten, when using it showed what was missing or wrong. Only skills kept in Willow's own
 * store can change; skills from elsewhere are left alone. The store comes in as `deps`, so this module stays light.
 */
import { fail, ok, stringArg, type DotToolEntry } from './tool-env';

export interface EditableSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export interface SkillStore {
  skills: () => EditableSkill[];
  update: (id: string, patch: { instructions?: string; description?: string }) => EditableSkill | null;
}

export const improveSkillTool = (store: SkillStore): DotToolEntry => ({
  doc: {
    name: 'improve_skill',
    args: '{"skill": "name", "replace": "exact passage", "with": "…"} or {"skill": "name", "instructions": "…", "description": "…"}',
    description: 'Improve a skill saved in Willow when using it showed a step missing, wrong or worth sharpening: swap one exact passage ("replace" and "with"), or give its whole new "instructions"; "description" changes when it applies. Keep it a method, not a record of one time.',
  },
  handler: {
    id: 'improve_skill',
    async run(args) {
      const name = stringArg(args, 'skill');
      if (!name) return fail('Give the "skill" to improve, by its name.');
      const skill = store.skills().find((entry) => entry.name.toLowerCase() === name.replace(/^\//, '').toLowerCase());
      if (!skill) return fail(`No skill saved in Willow is called "${name}". Skills from elsewhere cannot be changed here; save a new one with create_skill.`);
      const patch: { instructions?: string; description?: string } = {};
      if (typeof args.replace === 'string') {
        if (typeof args.with !== 'string') return fail('Give "with": the text that replaces the passage.');
        const at = args.replace ? skill.instructions.indexOf(args.replace) : -1;
        if (at === -1) return fail('That passage is not in the skill. Quote it exactly, or give the whole new "instructions".');
        if (skill.instructions.indexOf(args.replace, at + 1) !== -1) return fail('That passage appears more than once. Quote more of it, so it is found once.');
        patch.instructions = `${skill.instructions.slice(0, at)}${args.with}${skill.instructions.slice(at + args.replace.length)}`;
      } else if (typeof args.instructions === 'string' && args.instructions.trim()) {
        patch.instructions = args.instructions;
      }
      const description = stringArg(args, 'description');
      if (description) patch.description = description;
      if (!patch.instructions && !patch.description) return fail('Say what changes: "replace" and "with", new "instructions", or a new "description".');
      const saved = store.update(skill.id, patch);
      if (!saved) return fail('The skill could not be saved. Tell the user plainly, and do not say it was improved.');
      return ok(`Improved the skill "${saved.name}"; it is used this way from now on.`);
    },
  },
});
