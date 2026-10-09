// What was deleted in this browser, per folder and project, so a copy still in the project folder
// (its file was not reachable when it was deleted, or went to the Recycle Bin and came back) is not
// read back as something this browser merely lacks.

const MAX_REMEMBERED = 200;

/** The folder part of a scope (`${uid}::${rootId}`): the files are the folder's, whoever is signed in. */
const folderOf = (scopeId: string): string => scopeId.split('::').slice(1).join('::');

const keyOf = (kind: string, scopeId: string, projectId: string): string =>
  `willow:media:deleted:v1:${kind}:${folderOf(scopeId)}:${projectId}`;

const storage = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

function readIds(key: string): string[] {
  try {
    const ids = JSON.parse(storage()?.getItem(key) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberDeleted(kind: string, scopeId: string, projectId: string, id: string): void {
  if (!projectId || !id) return;
  const key = keyOf(kind, scopeId, projectId);
  try {
    storage()?.setItem(key, JSON.stringify([id, ...readIds(key).filter((known) => known !== id)].slice(0, MAX_REMEMBERED)));
  } catch {
    // Unremembered, a copy left in the folder may come back: nothing is lost that way.
  }
}

/** Whether each id was deleted here, as remembered now. */
export function deletedHere(kind: string, scopeId: string, projectId: string): (id: string) => boolean {
  const ids = new Set(readIds(keyOf(kind, scopeId, projectId)));
  return (id) => ids.has(id);
}
