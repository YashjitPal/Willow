import type { ProviderKeys } from '../domain/types.ts';
import { COLLECTIONS, type Storage } from '../storage/index.ts';
import { DEFAULT_WORKSPACE_ID } from './governance.ts';

export const LEGACY_PROVIDER_KEYS_ID = 'provider_keys';
const SCOPED_PROVIDER_KEYS_PREFIX = `${LEGACY_PROVIDER_KEYS_ID}:`;
const updateQueues = new WeakMap<Storage, Map<string, Promise<void>>>();

export function providerKeysStorageId(workspaceId = DEFAULT_WORKSPACE_ID): string {
  return workspaceId === DEFAULT_WORKSPACE_ID
    ? LEGACY_PROVIDER_KEYS_ID
    : `${SCOPED_PROVIDER_KEYS_PREFIX}${workspaceId}`;
}

export function isProviderKeysStorageId(id: string): boolean {
  return id === LEGACY_PROVIDER_KEYS_ID || id.startsWith(SCOPED_PROVIDER_KEYS_PREFIX);
}

export async function loadProviderKeys(storage: Storage, workspaceId = DEFAULT_WORKSPACE_ID): Promise<ProviderKeys | undefined> {
  return storage.get<ProviderKeys>(COLLECTIONS.settings, providerKeysStorageId(workspaceId));
}

export async function storeProviderKeys(storage: Storage, workspaceId: string, keys: ProviderKeys): Promise<void> {
  await storage.put(COLLECTIONS.settings, providerKeysStorageId(workspaceId), keys, workspaceId);
}

/** Serialize read-modify-write credential changes per storage/workspace. Without
 * this, concurrent provider rotations can silently restore a key that another
 * request just cleared or discard a different provider's new key. */
export async function updateProviderKeys(
  storage: Storage,
  workspaceId: string,
  update: (current: ProviderKeys) => ProviderKeys,
): Promise<ProviderKeys> {
  let queues = updateQueues.get(storage);
  if (!queues) {
    queues = new Map();
    updateQueues.set(storage, queues);
  }
  const previous = queues.get(workspaceId) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => turn);
  queues.set(workspaceId, queued);
  await previous.catch(() => undefined);
  try {
    const current = (await loadProviderKeys(storage, workspaceId)) ?? {};
    const next = update(structuredClone(current));
    await storeProviderKeys(storage, workspaceId, next);
    return structuredClone(next);
  } finally {
    release();
    if (queues.get(workspaceId) === queued) queues.delete(workspaceId);
  }
}
