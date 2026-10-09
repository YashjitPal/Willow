// A catalog tool's files, each its own chunk so a tool's code is fetched only when it opens.
// Apart from `catalog.ts` because `import.meta.glob` exists only under Vite.
import type { ToolFile } from './runtime/compiler';

const sources = import.meta.glob<{ files: ToolFile[] }>('./catalog/sources/*.json', { import: 'default' });

export async function loadCatalogFiles(id: string): Promise<ToolFile[]> {
  const load = sources[`./catalog/sources/${id}.json`];
  if (!load) throw new Error(`No files for tool ${id}`);
  const { files } = await load();
  return files.map((f) => ({ path: f.path, content: f.content }));
}
