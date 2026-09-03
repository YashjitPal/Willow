/**
 * The shared skill library.
 *
 * One list of skills, readable by every surface that wants them. This exists
 * because Willow already had the folder and not the seam: Spark registers
 * `<workspace>/Skills/` as a synced folder, and its own registration says why —
 *
 *   "Tasks and schedules intentionally live below Spark/, while Skills is a
 *    workspace-level folder so Chat can consume the same library later."
 *
 * The folder was always meant to be shared; the library it syncs into was
 * private to Spark's store. This is the missing half.
 *
 * ## Why here rather than in a feature
 *
 * The repo rule is that anything two features need moves down to `platform/*`,
 * and three want this: Spark (which owns the sync), the Code tab's Agent
 * harness, and Chat. It also has to be `platform/` for the layering rule —
 * `features/spark` already imports from `features/code`, so having `code` reach
 * back into `spark` would close a cycle between two features.
 *
 * ## Who writes, who reads
 *
 * **Spark publishes; everyone else reads.** Spark owns the editor UI and the
 * synced-folder registration, so it remains the single writer — `publishSkills`
 * is called from its store whenever its skill collection changes, and nothing
 * else calls it. That keeps one owner for `Skills/` on disk, which the
 * synced-folder registry requires anyway (it rejects a second registration of
 * the same folder).
 *
 * This store is therefore a mirror, not a second source of truth. It is
 * deliberately not persisted: Spark's state already is, and a second cache of
 * the same rows is how the two drift.
 */

import { atom } from 'nanostores';

/**
 * One skill in the library.
 *
 * `name`, `description` and `shortDescription` come from `SKILL.md` frontmatter
 * (see `./skill-frontmatter`). `instructions` is the body after the block.
 *
 * `files` carries a skill's supporting documents — upstream skills routinely
 * ship `references/`, `scripts/` and `assets/` alongside `SKILL.md`, and its
 * progressive-disclosure guidance is built around the model opening them one at
 * a time. Empty for a skill that is only a `SKILL.md`, which is most of them.
 */
export interface LibrarySkill {
  /** Stable id. Also the on-disk filename stem. */
  id: string;
  name: string;
  description: string;
  shortDescription?: string;
  instructions: string;
  /** Supporting files, keyed by path relative to the skill's own folder. */
  files?: Record<string, string>;
  /** A disabled skill stays in the library and out of every prompt. */
  enabled: boolean;
}

const EMPTY: LibrarySkill[] = [];

export const skillLibrary = atom<LibrarySkill[]>(EMPTY);

/**
 * Replaces the library. Spark's store is the only caller.
 *
 * Skips the write when nothing changed. The publisher is driven by a store
 * subscription that fires on every Spark state change — task edits, schedule
 * edits, run progress — and re-setting an identical array would wake every
 * `useStore(skillLibrary)` in the app on each one.
 */
export function publishSkills(skills: LibrarySkill[]): void {
  const current = skillLibrary.get();
  if (current.length === skills.length && current.every((skill, index) => same(skill, skills[index]!))) {
    return;
  }
  skillLibrary.set(skills);
}

const same = (a: LibrarySkill, b: LibrarySkill): boolean =>
  a.id === b.id &&
  a.name === b.name &&
  a.description === b.description &&
  a.shortDescription === b.shortDescription &&
  a.instructions === b.instructions &&
  a.enabled === b.enabled;

/* ------------------------------------------------------------------------ */
/* Hydration                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * How the library gets filled the first time someone asks for it.
 *
 * This exists because of a gap that is invisible until you hit it. Spark reads
 * its persisted state in `hydrateSparkState`, and the only caller is
 * `SparkWorkspace` — so `sparkState.skills` is empty until the user opens the
 * Spark tab. A user who opened the Code tab in a fresh session and asked the
 * Agent to use a skill would get nothing, with no error and no explanation,
 * and it would start working later for no reason they could see.
 *
 * So the owner registers a hydrator and every reader triggers it. This is the
 * same shape as `platform/storage`'s `registerSyncedFolder` and
 * `project-contributors`: the platform layer declares a slot, the feature that
 * owns the data fills it, and `platform/*` still imports nothing from
 * `features/`.
 */
type SkillHydrator = (scopeId: string) => void;

let hydrator: SkillHydrator | null = null;
const hydratedScopes = new Set<string>();

/** Called once, from the owning feature's `register.ts`. */
export function registerSkillHydrator(next: SkillHydrator): void {
  hydrator = next;
}

/**
 * Makes sure the library has been loaded for this scope.
 *
 * Cheap to call repeatedly: each scope is hydrated once per session. Storage
 * keys are scoped by user and workspace, so the scope has to be part of the
 * key — hydrating "the library" without one would serve a signed-out user the
 * previous account's skills.
 */
export function ensureSkillsHydrated(scopeId: string): void {
  if (!hydrator || hydratedScopes.has(scopeId)) return;
  hydratedScopes.add(scopeId);
  hydrator(scopeId);
}

/** Test hook. The app never needs this. */
export function resetSkillHydration(): void {
  hydratedScopes.clear();
  hydrator = null;
  skillLibrary.set(EMPTY);
}

/**
 * The skills a turn may actually use.
 *
 * Pass the scope so the library can load itself if nobody has yet — see
 * `ensureSkillsHydrated`. It is optional only so a test can read the store
 * without standing up a hydrator.
 */
export const enabledSkills = (scopeId?: string): LibrarySkill[] => {
  if (scopeId) ensureSkillsHydrated(scopeId);
  return skillLibrary.get().filter((skill) => skill.enabled);
};
