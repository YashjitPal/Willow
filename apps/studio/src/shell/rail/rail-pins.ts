/**
 * Which destinations the app rail pins, and in what order: Codex's sidebar
 * customization (`inline-sidebar-customization-state-by-account-id-v2`), ported
 * rule for rule. Fixed destinations always show; the pinnable ones live in
 * Explore (the rail's "…"), and up to eight of them can be pinned into the rail.
 *
 * - An override decides whether a destination is pinned; without one,
 *   `visibleByDefault` does, until eight are pinned.
 * - Pinning moves a destination to the end of the order, so it lands last in the
 *   rail; unpinning leaves its place in the order alone.
 * - Reordering moves only pinned destinations, and ids this build does not know
 *   keep their slots, so a newer build's arrangement survives a downgrade.
 */
import { atom } from 'nanostores';

export const RAIL_PIN_LIMIT = 8;

export interface RailCustomization {
  version: 2;
  order: string[];
  pinOverrides: Record<string, boolean>;
}

export interface RailPinnable {
  id: string;
  visibleByDefault?: boolean;
}

export const EMPTY_RAIL_CUSTOMIZATION: RailCustomization = { version: 2, order: [], pinOverrides: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored value, or the empty customization when it is missing or malformed. */
export const parseRailCustomization = (value: unknown): RailCustomization => {
  if (!isRecord(value) || value.version !== 2) return EMPTY_RAIL_CUSTOMIZATION;
  const order = Array.isArray(value.order) ? value.order.filter((id): id is string => typeof id === 'string') : [];
  const pinOverrides: Record<string, boolean> = {};
  if (isRecord(value.pinOverrides)) {
    for (const [id, pinned] of Object.entries(value.pinOverrides)) {
      if (typeof pinned === 'boolean') pinOverrides[id] = pinned;
    }
  }
  return { version: 2, order, pinOverrides };
};

/** The stored order resolved against what exists now; new destinations take their default position. */
const resolveOrder = (order: readonly string[], destinations: readonly RailPinnable[]): string[] => {
  const remaining = new Set(destinations.map(({ id }) => id));
  const resolved: string[] = [];
  for (const id of order) {
    if (!remaining.has(id)) continue;
    resolved.push(id);
    remaining.delete(id);
  }
  destinations.forEach(({ id }, index) => {
    if (remaining.has(id)) resolved.splice(Math.min(index, resolved.length), 0, id);
  });
  return resolved;
};

/** The stored order with every current destination in it, unknown ids kept where they were. */
const completeOrder = (order: readonly string[], destinations: readonly RailPinnable[]): string[] => {
  if (order.length === 0) return destinations.map(({ id }) => id);
  const merged = [...new Set(order)];
  const known = new Set(merged);
  const resolved = resolveOrder(merged, destinations);
  resolved.forEach((id, index) => {
    if (known.has(id)) return;
    const next = resolved.slice(index + 1).find((candidate) => known.has(candidate));
    merged.splice(next === undefined ? merged.length : merged.indexOf(next), 0, id);
    known.add(id);
  });
  return merged;
};

const normalized = (state: RailCustomization, destinations: readonly RailPinnable[]): RailCustomization => ({
  version: 2,
  pinOverrides: state.pinOverrides,
  order: completeOrder(state.order, destinations),
});

/** Pinned ids: explicit pins first, then defaults, at most eight. */
export const pinnedRailIds = (state: RailCustomization, destinations: readonly RailPinnable[]): string[] => {
  const { pinOverrides } = state;
  const existing = new Set(destinations.map(({ id }) => id));
  const pinned = Object.keys(pinOverrides).filter((id) => pinOverrides[id] && existing.has(id));
  for (const { id, visibleByDefault } of destinations) {
    if (pinned.length >= RAIL_PIN_LIMIT) break;
    if (visibleByDefault && pinOverrides[id] == null) pinned.push(id);
  }
  return pinned;
};

/** Every pinnable id in rail order, split into the pinned ones and the rest. */
export const splitRailDestinations = (state: RailCustomization, destinations: readonly RailPinnable[]) => {
  const pinned = new Set(pinnedRailIds(state, destinations));
  const pinnedIds: string[] = [];
  const exploreOnlyIds: string[] = [];
  for (const id of resolveOrder(state.order, destinations)) (pinned.has(id) ? pinnedIds : exploreOnlyIds).push(id);
  return { pinnedIds, exploreOnlyIds };
};

/** Pins or unpins one destination; `limited` when pinning would pass eight. */
export const toggleRailPin = (
  state: RailCustomization,
  destinations: readonly RailPinnable[],
  id: string,
): { state: RailCustomization; limited: boolean } => {
  const current = normalized(state, destinations);
  const pinned = pinnedRailIds(current, destinations);
  const isPinned = pinned.includes(id);
  if (!isPinned && pinned.length >= RAIL_PIN_LIMIT) return { state, limited: true };
  return {
    limited: false,
    state: {
      version: 2,
      pinOverrides: { ...current.pinOverrides, [id]: !isPinned },
      order: isPinned ? current.order : [...current.order.filter((entry) => entry !== id), id],
    },
  };
};

/** Moves one pinned destination to where another is; everything unpinned keeps its place. */
export const moveRailPin = (
  state: RailCustomization,
  destinations: readonly RailPinnable[],
  fromId: string,
  toId: string,
): RailCustomization => {
  const { pinnedIds } = splitRailDestinations(state, destinations);
  const from = pinnedIds.indexOf(fromId);
  const to = pinnedIds.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return state;
  const moved = [...pinnedIds];
  moved.splice(to, 0, ...moved.splice(from, 1));
  const queue = [...moved];
  const wanted = resolveOrder(state.order, destinations).map((id) => (pinnedIds.includes(id) ? queue.shift() ?? id : id));
  const current = normalized(state, destinations);
  const eligible = new Set(destinations.map(({ id }) => id));
  const order: string[] = [];
  for (const id of current.order) {
    const next = eligible.has(id) ? wanted.shift() : id;
    if (next !== undefined) order.push(next);
  }
  order.push(...wanted);
  return { version: 2, pinOverrides: current.pinOverrides, order };
};

const STORAGE_KEY = 'willow:rail-customization:v2';

const readStored = (): RailCustomization => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseRailCustomization(JSON.parse(raw)) : EMPTY_RAIL_CUSTOMIZATION;
  } catch {
    return EMPTY_RAIL_CUSTOMIZATION;
  }
};

export const $railCustomization = atom<RailCustomization>(
  typeof window === 'undefined' ? EMPTY_RAIL_CUSTOMIZATION : readStored(),
);

export const saveRailCustomization = (state: RailCustomization): void => {
  $railCustomization.set(state);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage quota / private browsing */
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) $railCustomization.set(readStored());
  });
}
