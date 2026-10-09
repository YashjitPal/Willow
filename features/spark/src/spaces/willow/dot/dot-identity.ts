import { sparkDotName } from '../../../dots/dots-store';
import { useDotStore, type Dot } from './state/dot-store';

/**
 * Pages' demo content names bots by slot rather than by id, since every Willow
 * user has their own dots: slot `n` is their `n`th bot, oldest first, wrapping
 * around when they have fewer. With no bots at all, a slot names nobody.
 */
export const seedDotId = (slot: number) => `seed-dot-${slot}`;

const seedSlot = (id: string) => {
  const match = /^seed-dot-(\d+)$/.exec(id);
  return match == null ? null : Number(match[1]);
};

const byAge = (dots: readonly Dot[]) => [...dots].sort((a, b) => a.createdAt - b.createdAt);

/** The bot an id names: one of the user's bots by id, or the bot a demo slot stands for. */
export function resolveDot(dots: readonly Dot[], id: string | null | undefined): Dot | null {
  if (id == null) return null;
  const slot = seedSlot(id);
  if (slot == null) return dots.find((dot) => dot.conversationId === id) ?? null;
  if (dots.length === 0) return null;
  const ordered = byAge(dots);
  return ordered[slot % ordered.length];
}

/** The distinct bots a list of ids names, in the order first named. */
export function resolveDots(dots: readonly Dot[], ids: Iterable<string>): Dot[] {
  const resolved = new Map<string, Dot>();
  for (const id of ids) {
    const dot = resolveDot(dots, id);
    if (dot != null && !resolved.has(dot.conversationId)) resolved.set(dot.conversationId, dot);
  }
  return [...resolved.values()];
}

export const dotName = (dot: Pick<Dot, 'name'>) => sparkDotName(dot);

export function useResolvedDot(id: string | null | undefined) {
  return useDotStore((state) => resolveDot(state.dots, id));
}

export function useDots() {
  return useDotStore((state) => state.dots);
}
