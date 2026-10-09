import { sparkLocation } from '../../spark-store';
import { insertSparkDot, sparkDots, updateSparkDot, type SparkDot, type SparkDotUpdate } from '../dots-store';
import { create } from '../lib/create-store';

/**
 * The Codex bot store the character and creation components read, backed by
 * Willow's `sparkDots`. Every Willow bot is a durable orbit bot.
 */
export type DotIdentity = 'orbit' | 'orbit-draft' | 'legacy' | 'legacy-draft';

export type DotRuntime = 'cloud' | 'local';

export type DotStatus = 'creating' | 'ready' | 'paused';

export interface Dot {
  /** The Willow bot id; the bot lives at `/spark/dots/:id`. */
  conversationId: string;
  name: string | null;
  identity: DotIdentity;
  presetId: string;
  /** Serialized ORBAST1 appearance once the user customizes the character. */
  appearance: Uint8Array | null;
  legacyAvatar: string | null;
  petId: string | null;
  runtime: DotRuntime;
  status: DotStatus;
  isPrimary: boolean;
  isPinned: boolean;
  createdAt: number;
}

interface DotStore {
  dots: Dot[];
  activeConversationId: string | null;
  addDot: (dot: Dot) => void;
  updateDot: (conversationId: string, patch: Partial<Dot>) => void;
}

const decodeAppearance = (encoded: string | null) => (encoded == null ? null : Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));

const encodeAppearance = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** One `Bot` per Willow bot object, so unchanged bots keep their identity across updates. */
const cache = new Map<string, { source: SparkDot; isPrimary: boolean; dot: Dot }>();

function toDots(sparkDotList: SparkDot[]): Dot[] {
  const primaryId = sparkDotList.at(-1)?.id;
  const dots = sparkDotList.map((source) => {
    const isPrimary = source.id === primaryId;
    const cached = cache.get(source.id);
    if (cached?.source === source && cached.isPrimary === isPrimary) return cached.dot;
    const dot: Dot = {
      conversationId: source.id,
      name: source.name,
      identity: 'orbit',
      presetId: source.presetId,
      appearance: cached?.source.appearance === source.appearance ? cached.dot.appearance : decodeAppearance(source.appearance),
      legacyAvatar: null,
      petId: source.petId,
      runtime: 'cloud',
      status: source.status,
      isPrimary,
      isPinned: false,
      createdAt: source.createdAt,
    };
    cache.set(source.id, { source, isPrimary, dot });
    return dot;
  });
  for (const id of cache.keys()) if (!sparkDotList.some((dot) => dot.id === id)) cache.delete(id);
  return dots;
}

const activeDotId = () => {
  const location = sparkLocation.get();
  return location.page === 'dots' ? (location.dotId ?? null) : null;
};

export const useDotStore = create<DotStore>(() => ({
  dots: toDots(sparkDots.get().dots),
  activeConversationId: activeDotId(),
  addDot: (dot) => insertSparkDot({ id: dot.conversationId, name: dot.name, presetId: dot.presetId, status: dot.status === 'creating' ? 'creating' : 'ready' }),
  updateDot: (conversationId, patch) => {
    const update: SparkDotUpdate = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.presetId !== undefined) update.presetId = patch.presetId;
    if (patch.petId !== undefined) update.petId = patch.petId;
    if (patch.status !== undefined) update.status = patch.status === 'creating' ? 'creating' : 'ready';
    if (patch.appearance !== undefined) update.appearance = patch.appearance == null ? null : encodeAppearance(patch.appearance);
    updateSparkDot(conversationId, update);
  },
}));

sparkDots.listen(({ dots }) => useDotStore.setState({ dots: toDots(dots) }));
sparkLocation.listen(() => {
  const activeConversationId = activeDotId();
  if (activeConversationId !== useDotStore.getState().activeConversationId) useDotStore.setState({ activeConversationId });
});

export const useDot = (conversationId: string | null | undefined) =>
  useDotStore((s) => s.dots.find((d) => d.conversationId === conversationId) ?? null);
