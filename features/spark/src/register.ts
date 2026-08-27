/** Spark's local-disk contribution.
 *
 * Tasks and schedules intentionally live below Spark/, while Skills is a
 * workspace-level folder so Chat can consume the same library later.
 */
import { registerSyncedFolder } from '@willow/storage/local-sync';
import {
  applySparkSyncedCollection,
  parseSparkSchedule,
  parseSparkSkill,
  parseSparkTask,
  loadSparkTaskRecordsForSync,
  sparkState,
  isSparkStateHydratedForScope,
  type SparkSchedule,
  type SparkSkill,
  type SparkTask,
} from './spark-store';

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

descriptor<SparkTask>('spark-tasks', 'Spark/Tasks', 'tasks', (state) => state.tasks, parseSparkTask);
descriptor<SparkSchedule>('spark-schedules', 'Spark/Schedules', 'schedules', (state) => state.schedules, parseSparkSchedule);
descriptor<SparkSkill>('skills', 'Skills', 'skills', (state) => state.skills, parseSparkSkill);
