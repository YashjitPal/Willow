/**
 * Customize → Skills, persisted and published.
 *
 * The page used to keep its skills in component state, so a skill created there
 * vanished on reload and no agent could ever read it. This store keeps the
 * page's choices in localStorage and publishes the result into the shared skill
 * library (`@willow/core/skill-library`) under the `customize` source, beside
 * Spark's — which is what the Code harness reads when it lists and applies
 * skills.
 *
 * Imported for its side effect from `app/register-features.ts`, so the library
 * has these skills from the first turn of a session, not only after the
 * Customize page has been opened.
 */

import { useStore } from '@nanostores/react';
import { atom } from 'nanostores';
import { useCallback, useMemo } from 'react';
import { extractSkillBody, parseSkillFrontmatter } from '@willow/core/skill-frontmatter';
import { publishSkills, type LibrarySkill } from '@willow/core/skill-library';
import { SKILLS_DATA, type CustomizeItem } from './customize-data';

export interface SkillEdits {
  title: string;
  description: string;
  instructions: string;
}

export interface CustomizeSkillsState {
  activeIds: string[];
  inactiveIds: string[];
  /** Skills the user created or uploaded. */
  custom: CustomizeItem[];
  /** Edits to any skill, built-in or custom, keyed by item id. */
  edits: Record<string, SkillEdits>;
}

const STORAGE_KEY = 'willow:customize:skills';

const DEFAULT_STATE: CustomizeSkillsState = {
  activeIds: ['apple-music-playlist'],
  inactiveIds: [],
  custom: [],
  edits: {},
};

function normalizeState(value: unknown): CustomizeSkillsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_STATE;
  const parsed = value as Partial<CustomizeSkillsState>;
  return {
    activeIds: Array.isArray(parsed.activeIds) ? parsed.activeIds.filter((id): id is string => typeof id === 'string') : DEFAULT_STATE.activeIds,
    inactiveIds: Array.isArray(parsed.inactiveIds) ? parsed.inactiveIds.filter((id): id is string => typeof id === 'string') : [],
    custom: Array.isArray(parsed.custom) ? parsed.custom.filter((item) => item && typeof item.id === 'string') : [],
    edits: parsed.edits && typeof parsed.edits === 'object' && !Array.isArray(parsed.edits) ? parsed.edits : {},
  };
}

function readState(): CustomizeSkillsState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

export const customizeSkills = atom<CustomizeSkillsState>(readState());

const slugify = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/** The page's active and inactive skills, as library entries. */
export function toLibrarySkills(state: CustomizeSkillsState): LibrarySkill[] {
  const byId = new Map<string, CustomizeItem>();
  for (const item of SKILLS_DATA) byId.set(item.id, item);
  for (const item of state.custom) byId.set(item.id, item);

  const used = new Set<string>();
  const entries: LibrarySkill[] = [];
  const add = (id: string, enabled: boolean) => {
    const item = byId.get(id);
    if (!item) return;
    const edits = state.edits[id];
    const name = (edits?.title || item.title || item.slug || id).trim();
    const instructions = (edits?.instructions ?? item.instructions ?? '').trim();
    const description = (edits?.description ?? item.description ?? item.subtitle ?? '').trim();
    if (!name || !instructions) return;
    let skillId = item.slug || slugify(name) || id;
    while (used.has(skillId)) skillId = `${skillId}-2`;
    used.add(skillId);
    entries.push({ id: skillId, name, description: description || name, instructions, enabled });
  };
  for (const id of state.activeIds) add(id, true);
  for (const id of state.inactiveIds) add(id, false);
  return entries;
}

function commit(next: CustomizeSkillsState): void {
  customizeSkills.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Private mode: the session still works, it just will not be remembered. */
  }
  publishSkills(toLibrarySkills(next), 'customize');
}

export function updateCustomizeSkills(update: (state: CustomizeSkillsState) => CustomizeSkillsState): void {
  commit(update(customizeSkills.get()));
}

/** The whole state from outside the page (`settings.json`), held to the shape `readState` keeps. */
export function replaceCustomizeSkills(value: unknown): void {
  commit(normalizeState(value));
}

publishSkills(toLibrarySkills(customizeSkills.get()), 'customize');

type SetterArg<T> = T | ((previous: T) => T);
const resolve = <T,>(next: SetterArg<T>, previous: T): T =>
  typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;

/**
 * The store in the shape the Customize page already used: four `useState`-like
 * pairs. Keeping that shape is what let the page move onto the store without
 * rewriting every handler.
 */
export function useCustomizeSkills() {
  const state = useStore(customizeSkills);
  const activeSkillIds = useMemo(() => new Set(state.activeIds), [state.activeIds]);
  const inactiveSkillIds = useMemo(() => new Set(state.inactiveIds), [state.inactiveIds]);

  const setActiveSkillIds = useCallback((next: SetterArg<Set<string>>) => {
    updateCustomizeSkills((current) => ({ ...current, activeIds: [...resolve(next, new Set(current.activeIds))] }));
  }, []);
  const setInactiveSkillIds = useCallback((next: SetterArg<Set<string>>) => {
    updateCustomizeSkills((current) => ({ ...current, inactiveIds: [...resolve(next, new Set(current.inactiveIds))] }));
  }, []);
  const setCustomSkills = useCallback((next: SetterArg<CustomizeItem[]>) => {
    updateCustomizeSkills((current) => ({ ...current, custom: resolve(next, current.custom) }));
  }, []);
  const setSavedSkillsData = useCallback((next: SetterArg<Record<string, SkillEdits>>) => {
    updateCustomizeSkills((current) => ({ ...current, edits: resolve(next, current.edits) }));
  }, []);

  return {
    activeSkillIds,
    setActiveSkillIds,
    inactiveSkillIds,
    setInactiveSkillIds,
    customSkills: state.custom,
    setCustomSkills,
    savedSkillsData: state.edits,
    setSavedSkillsData,
  };
}

/**
 * A skill file, read for Upload or Replace.
 *
 * Accepts the three shapes a user is likely to have: a `SKILL.md` with
 * frontmatter (the format Codex, Claude and Spark use), the JSON this page's
 * Download produces, or plain Markdown — which becomes the instructions, named
 * after the file.
 */
export function parseSkillFile(content: string, fileName = 'skill'): SkillEdits | null {
  const text = content.replace(/^\uFEFF/, '');
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/^SKILL$/i, '').trim();

  if (/^\s*\{/.test(text)) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const instructions = String(parsed.instructions ?? parsed.body ?? '').trim();
      if (!instructions) return null;
      return {
        title: String(parsed.title ?? parsed.name ?? parsed.slug ?? (stem || 'Uploaded skill')).trim(),
        description: String(parsed.description ?? '').trim(),
        instructions,
      };
    } catch {
      return null;
    }
  }

  const frontmatter = parseSkillFrontmatter(text, () => stem || 'Uploaded skill');
  if (frontmatter.ok) {
    const instructions = extractSkillBody(text);
    if (!instructions) return null;
    return { title: frontmatter.value.name, description: frontmatter.value.description, instructions };
  }

  const instructions = text.trim();
  if (!instructions) return null;
  const heading = /^#\s+(.+)$/m.exec(instructions)?.[1]?.trim();
  return { title: heading || stem || 'Uploaded skill', description: '', instructions };
}
