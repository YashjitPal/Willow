import type { SettingsSection } from '@willow/core/settings-file';
import { readProjectRegistry, writeProjectRegistry } from '@willow/projects/registry';

const PROJECTS_UPDATED_EVENT = 'willow_projects_updated';

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Stars the file gave to projects this copy hasn't found on disk yet. */
const heldStars = new Set<string>();

const registryStars = (): string[] =>
  readProjectRegistry().filter((project) => project.isStarred === true).map((project) => project.id);

/** Stars `starred`, unstars the rest, and holds a star for an id no project here has yet. */
const starProjects = (starred: ReadonlySet<string>): void => {
  const list = readProjectRegistry();
  heldStars.clear();
  for (const id of starred) if (!list.some((project) => project.id === id)) heldStars.add(id);
  let changed = false;
  const next = list.map((project) => {
    const star = starred.has(project.id);
    if ((project.isStarred === true) === star) return project;
    changed = true;
    return { ...project, isStarred: star };
  });
  if (!changed) return;
  writeProjectRegistry(next);
  window.dispatchEvent(new Event(PROJECTS_UPDATED_EVENT));
};

const giveHeldStars = (): void => {
  if (!heldStars.size || !readProjectRegistry().some((project) => heldStars.has(project.id))) return;
  starProjects(new Set([...registryStars(), ...heldStars]));
};

const starredIn = (value: unknown): string[] =>
  isObject(value) && Array.isArray(value.starred) ? value.starred.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];

/**
 * `settings.json`'s `projects`: starred projects, by the id each keeps in its `.willow.json`, which
 * outlives this browser's list. A copy starting over finds its projects on disk a moment after the
 * file is read, so a star the file gives a project not found yet is held, kept in the file, and
 * given when the project appears.
 */
export const projectStarsSection: SettingsSection = {
  order: 72,
  read: () => ({ starred: [...new Set([...registryStars(), ...heldStars])].sort() }),
  apply: (value) => {
    if (isObject(value) && Array.isArray(value.starred)) starProjects(new Set(starredIn(value)));
  },
  subscribe: (onChange) => {
    const onProjects = () => {
      giveHeldStars();
      onChange();
    };
    window.addEventListener(PROJECTS_UPDATED_EVENT, onProjects);
    return () => window.removeEventListener(PROJECTS_UPDATED_EVENT, onProjects);
  },
  merge: (fromFile, local) => ({ starred: [...new Set([...starredIn(fromFile), ...starredIn(local)])].sort() }),
};
