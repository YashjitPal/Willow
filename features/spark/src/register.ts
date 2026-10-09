/** Spark's local-disk contribution.
 *
 * Tasks and schedules intentionally live below Spark/, while Skills is a
 * workspace-level folder so Chat can consume the same library later.
 */
import { registerSyncedFolder } from '@willow/storage/local-sync';
import { registerSkillHydrator } from '@willow/core/skill-library';
import { registerSparkLibraryWriter } from '@willow/core/spark-library';
import {
  applySparkSyncedCollection,
  createSparkSchedule,
  createSparkSkill,
  deleteSparkSchedule,
  hydrateSparkState,
  parseSparkSchedule,
  parseSparkSkill,
  parseSparkTask,
  loadSparkTaskRecordsForSync,
  sparkState,
  isSparkStateHydratedForScope,
  toLibrarySchedule,
  updateSparkSchedule,
  type SparkSchedule,
  type SparkSkill,
  type SparkTask,
} from './spark-store';
import { SPARK_TASKS_FOLDER } from './spark-disk';
import { getNextScheduleRunAt } from './spark-schedule-time';
// Bots' own folder, Spark/Dots: each bot with its whole conversation.
import './dots/dots-folder';
// MCP through the desktop app's companion — servers that send no CORS headers, and programs on this computer — for
// every surface that connects servers, the Code tab included.
import './mcp-relay';

const descriptor = <T extends { id: string }>(
  id: string,
  folder: string,
  collection: 'tasks' | 'schedules' | 'skills',
  read: (state: ReturnType<typeof sparkState.get>) => T[],
  parse: (contents: string, id: string) => T | null,
) => {
  registerSyncedFolder(id, {
    folder,
    extension: '.json',
    isPaused: (ctx) => !isSparkStateHydratedForScope(ctx.scopeId),
    async readLocal(ctx) {
      const localRecords = read(sparkState.get());
      const records = collection === 'tasks'
        ? await loadSparkTaskRecordsForSync(localRecords as unknown as SparkTask[], ctx.scopeId)
        : localRecords;
      return records.map((record) => ({
        id: record.id,
        contents: JSON.stringify(record, null, 2),
      }));
    },
    async applyRemote(items) {
      const records = items
        .map((item) => parse(item.contents, item.id))
        .filter((record): record is T => Boolean(record));
      applySparkSyncedCollection(
        collection,
        records as unknown as SparkTask[] | SparkSchedule[] | SparkSkill[],
      );
    },
  });
};

descriptor<SparkTask>('spark-tasks', SPARK_TASKS_FOLDER, 'tasks', (state) => state.tasks, parseSparkTask);
descriptor<SparkSchedule>('spark-schedules', 'Spark/Schedules', 'schedules', (state) => state.schedules, parseSparkSchedule);
descriptor<SparkSkill>('skills', 'Skills', 'skills', (state) => state.skills, parseSparkSkill);

/*
 * Let other surfaces read the skill library without opening Spark first.
 *
 * `hydrateSparkState` is otherwise only called by `SparkWorkspace`, so
 * `state.skills` is empty until the Spark tab has been visited — which made
 * skills silently absent from the Code tab's Agent in any session that had not
 * been there. The store publishes into `@willow/core/skill-library` on every
 * change; this is the other half, so a reader can pull the library into
 * existence rather than waiting for Spark to be mounted.
 *
 * Registered here rather than in the store because `register.ts` is where Spark
 * declares its contributions, and it is already imported for side effects by
 * `apps/studio/src/app/register-features.ts`.
 */
registerSkillHydrator((scopeId) => {
  if (!isSparkStateHydratedForScope(scopeId)) hydrateSparkState(scopeId);
});

/*
 * How Chat's `create_schedule` and `create_skill` tools reach Spark's store. A write
 * hydrates first: one into an unread state would publish over the user's saved schedules.
 */
const ensureHydrated = (scopeId: string) => {
  if (!isSparkStateHydratedForScope(scopeId)) hydrateSparkState(scopeId);
};

registerSparkLibraryWriter({
  hydrate: ensureHydrated,
  createSchedule(scopeId, input) {
    ensureHydrated(scopeId);
    const schedule = createSparkSchedule({ ...input, enabled: true, nextRunAt: getNextScheduleRunAt(input) });
    return schedule ? toLibrarySchedule(schedule) : null;
  },
  setScheduleEnabled(scopeId, scheduleId, enabled) {
    ensureHydrated(scopeId);
    const existing = sparkState.get().schedules.find((schedule) => schedule.id === scheduleId);
    if (!existing) return null;
    // Switched back on, it waits for its next slot rather than catching up on the missed ones.
    const schedule = updateSparkSchedule(scheduleId, enabled ? { enabled, nextRunAt: getNextScheduleRunAt(existing) } : { enabled });
    return schedule ? toLibrarySchedule(schedule) : null;
  },
  deleteSchedule(scopeId, scheduleId) {
    ensureHydrated(scopeId);
    return deleteSparkSchedule(scheduleId);
  },
  createSkill(scopeId, input) {
    ensureHydrated(scopeId);
    const skill = createSparkSkill({ ...input, source: 'gemini', enabled: true });
    return skill ? { id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions } : null;
  },
});
