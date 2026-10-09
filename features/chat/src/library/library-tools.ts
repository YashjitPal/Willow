/**
 * The chat's `create_schedule` and `create_skill`.
 *
 * Gemini's chat saves both from a conversation — "Every Saturday at 10 AM, send me…"
 * becomes a scheduled action, "Create a skill…" a skill — and shows what it saved as a card
 * under the reply (`tools/ui-research/captures/spark/137-create-with-gemini/`). Willow's
 * schedules and skills are Spark's, so these write through the writer Spark registers
 * (`@willow/core/spark-library`): a schedule asked for here is on Spark's Schedules page and
 * runs where Spark's run, and a skill is in the library "/" reads.
 *
 * Offered on every turn that can save anything — not in a temporary chat, which keeps
 * nothing, and not on an endpoint with tools turned off.
 */
import { skillLibrary } from '@willow/core/skill-library';
import {
  formatScheduleDue,
  LIBRARY_WEEKDAYS,
  librarySchedules,
  normalizeSkillName,
  scheduleInputFrom,
  skillInputFrom,
  type LibraryCreatedSkill,
  type LibraryScheduleFrequency,
  type LibraryScheduleInput,
  type SparkLibraryWriter,
} from '@willow/core/spark-library';

export const CREATE_SCHEDULE = 'create_schedule';
export const CREATE_SKILL = 'create_skill';

export const isLibraryToolCall = (name: string): boolean => name === CREATE_SCHEDULE || name === CREATE_SKILL;

/**
 * What a turn saved, as its card first showed it. The card reads the schedule or skill
 * live while it exists; this is what it falls back to once it is gone, and what it was.
 */
export type ChatCreatedItem =
  | {
    id: string;
    kind: 'schedule';
    /** The Spark schedule's id. */
    recordId: string;
    title: string;
    frequency: LibraryScheduleFrequency;
    weekdays: string[];
    time: string;
    instructions: string;
    createdAt: number;
  }
  | {
    id: string;
    kind: 'skill';
    /** The Spark skill's id. */
    recordId: string;
    name: string;
    description: string;
    instructions: string;
    createdAt: number;
  };

const SCHEDULE_DECLARATION = {
  name: CREATE_SCHEDULE,
  description: 'Save a scheduled action: a task you carry out on your own, every day or on chosen weekdays at about a set time, with the result waiting for the user. '
    + 'They see it as a card with an on/off switch. Call it only when the user asks for something to happen on a schedule.',
  parameters: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING', description: 'A short name, at most six words, such as "Indoor gardening tip".' },
      frequency: { type: 'STRING', enum: ['Daily', 'Weekly'] },
      weekdays: {
        type: 'ARRAY',
        items: { type: 'STRING', enum: [...LIBRARY_WEEKDAYS] },
        description: 'For a weekly action, the days it runs. Leave it out for a daily one.',
      },
      time: { type: 'STRING', description: "When the result should be ready, as 24-hour HH:mm in the user's own time, such as \"10:00\"." },
      instructions: {
        type: 'STRING',
        description: 'What to do on each run, written as the request you will be given then, such as "Give me one short gardening tip for indoor plants."',
      },
    },
    required: ['title', 'frequency', 'time', 'instructions'],
  },
};

const SKILL_DECLARATION = {
  name: CREATE_SKILL,
  description: 'Save a skill: reusable instructions the user applies by typing "/" and its name, and that are used whenever a request fits. '
    + 'They see it as a card. Call it only when the user asks you to create or save a skill.',
  parameters: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING', description: 'Short and kebab-case, such as "article-key-takeaways".' },
      description: { type: 'STRING', description: 'What it does and when to use it, in one or two sentences.' },
      instructions: {
        type: 'STRING',
        description: 'The skill itself, in Markdown: a "#" title, one line on its purpose, then a "## Workflow" of numbered steps, and any rules after.',
      },
    },
    required: ['name', 'description', 'instructions'],
  },
};

export const libraryChatTools = (enabled: boolean): { functionDeclarations: any[] }[] => (enabled
  ? [{ functionDeclarations: [SCHEDULE_DECLARATION, SKILL_DECLARATION] }]
  : []);

export const libraryInstructions = (enabled: boolean): string => (enabled ? `
## Scheduled actions and skills
You can save a scheduled action with ${CREATE_SCHEDULE} and a skill with ${CREATE_SKILL}. Save one only when the user asks for it — something to happen every day or on certain days at a time ("every Saturday at 10 AM, send me a gardening tip"), or a skill — never on your own initiative.
- A scheduled action runs on its own each time it comes due; write its instructions as the request you will be given then. If the user has not said when it should run, ask before saving.
- A scheduled action always repeats, every day or on chosen weekdays. There are no one-time reminders: for something that should happen once ("remind me tomorrow at 9"), say so instead of saving one that repeats.
- If the user asks for a skill without saying what it should do, ask what it should do before saving anything. Otherwise write the whole skill yourself; do not ask them to.
- After ${CREATE_SCHEDULE}, the action is on screen as a card. Reply with one short sentence saying when it will be ready, such as: I'll have that indoor gardening tip ready for you by 10 AM every Saturday.
- After ${CREATE_SKILL}, the skill is on screen as a card. Reply in a sentence or two that it is saved and active, and how to use it, such as: Done. The skill is saved and active. Whenever you want to use it, just paste an article and ask for the takeaways.
- Never repeat what the card shows, and never say something was saved when the call failed.
`.trim() : '');

export interface LibraryToolHost {
  /** The storage scope the schedule or skill is saved under. */
  scopeId: string;
  writer: SparkLibraryWriter;
  publish: (item: ChatCreatedItem) => void;
  newId?: () => string;
}

type ToolResult = { status: 'ok'; result: string } | { status: 'error'; error: string };

const createdId = (): string => `created_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sameSchedule = (a: LibraryScheduleInput, b: LibraryScheduleInput): boolean =>
  a.title === b.title
  && a.frequency === b.frequency
  && a.time === b.time
  && a.instructions === b.instructions
  && a.weekdays.join() === b.weekdays.join();

/**
 * One executor per turn, and a repeat is never a second copy. A turn whose stream dropped
 * is retried from the start, and one a closed tab left unfinished is taken over by another,
 * and both call again for what may already be saved: a call this turn already answered gets
 * that answer again, and a schedule identical to one that is on — or a skill identical to
 * one in the library — is shown rather than saved twice.
 */
export const createLibraryToolExecutor = (host: LibraryToolHost) => {
  const savedThisTurn = new Map<string, ToolResult>();
  return async (name: string, args: any): Promise<ToolResult> => {
    const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    host.writer.hydrate(host.scopeId);
    if (name === CREATE_SCHEDULE) {
      const parsed = scheduleInputFrom(input);
      if ('error' in parsed) return { status: 'error', error: parsed.error };
      const { title, frequency, weekdays, time, instructions } = parsed.input;
      const key = JSON.stringify([CREATE_SCHEDULE, title, frequency, weekdays, time, instructions]);
      const repeat = savedThisTurn.get(key);
      if (repeat) return repeat;
      const schedule = librarySchedules.get().find((existing) => existing.enabled && sameSchedule(existing, parsed.input))
        ?? host.writer.createSchedule(host.scopeId, parsed.input);
      if (!schedule) return { status: 'error', error: 'The scheduled action could not be saved. Tell the user it was not saved.' };
      host.publish({
        id: host.newId?.() ?? createdId(),
        kind: 'schedule',
        recordId: schedule.id,
        title: schedule.title,
        frequency: schedule.frequency,
        weekdays: [...schedule.weekdays],
        time: schedule.time,
        instructions: schedule.instructions,
        createdAt: Date.now(),
      });
      const result: ToolResult = {
        status: 'ok',
        result: `Saved the scheduled action "${schedule.title}" (${formatScheduleDue(schedule)}). It is switched on, and the card is showing below your reply.`,
      };
      savedThisTurn.set(key, result);
      return result;
    }
    if (name === CREATE_SKILL) {
      const wanted = normalizeSkillName(input.name);
      const key = JSON.stringify([CREATE_SKILL, wanted]);
      const repeat = savedThisTurn.get(key);
      if (repeat) return repeat;
      const body = typeof input.instructions === 'string' ? input.instructions.trim() : '';
      const same = body
        ? skillLibrary.get().find((skill) => normalizeSkillName(skill.name) === wanted && skill.instructions.trim() === body)
        : undefined;
      let skill: LibraryCreatedSkill | null;
      if (same) {
        skill = { id: same.id, name: same.name, description: same.description, instructions: same.instructions };
      } else {
        const parsed = skillInputFrom(input, skillLibrary.get().map((existing) => existing.name));
        if ('error' in parsed) return { status: 'error', error: parsed.error };
        skill = host.writer.createSkill(host.scopeId, parsed.input);
      }
      if (!skill) return { status: 'error', error: 'The skill could not be saved. Tell the user it was not saved.' };
      host.publish({
        id: host.newId?.() ?? createdId(),
        kind: 'skill',
        recordId: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        createdAt: Date.now(),
      });
      const result: ToolResult = {
        status: 'ok',
        result: `Saved the skill "${skill.name}". It is active: the user can apply it by typing /${skill.name}, and it is used whenever a request fits its description. The card is showing below your reply.`,
      };
      savedThisTurn.set(key, result);
      return result;
    }
    return { status: 'error', error: `Unknown tool ${name}.` };
  };
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Created items as a saved chat holds them; anything unreadable is dropped. */
export const sanitizeChatCreatedItems = (value: unknown): ChatCreatedItem[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((raw): ChatCreatedItem[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const id = str(item.id);
    const recordId = str(item.recordId);
    const createdAt = typeof item.createdAt === 'number' ? item.createdAt : 0;
    if (!id || !recordId) return [];
    if (item.kind === 'schedule' && str(item.title) && str(item.time)) {
      return [{
        id,
        kind: 'schedule',
        recordId,
        title: str(item.title),
        frequency: item.frequency === 'Weekly' ? 'Weekly' : 'Daily',
        weekdays: Array.isArray(item.weekdays) ? item.weekdays.filter((day): day is string => typeof day === 'string') : [],
        time: str(item.time),
        instructions: str(item.instructions),
        createdAt,
      }];
    }
    if (item.kind === 'skill' && str(item.name)) {
      return [{
        id,
        kind: 'skill',
        recordId,
        name: str(item.name),
        description: str(item.description),
        instructions: str(item.instructions),
        createdAt,
      }];
    }
    return [];
  });
  return items.length ? items : undefined;
};
