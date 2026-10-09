/**
 * `apply_patch` against the real disk, for the desktop app's native runtime.
 *
 * The patch grammar and applier are the web runtime's (`../runtime/apply-patch`);
 * only where files come from and go to changes. Files are read once per envelope,
 * patched in memory, and written back, so a patch that fails to apply writes
 * nothing.
 *
 * Line endings and a UTF-8 byte-order mark are kept as the file had them: the
 * applier works in `\n`, and a Windows project's CRLF files stay CRLF.
 *
 * Approvals follow Codex's writable roots. With the `ask` policy, edits inside the
 * task's project folder apply without asking, as they do under Codex's
 * workspace-write sandbox, and edits anywhere else ask first; a task with no
 * project folder asks for every edit. Full access never asks.
 */

import type { DiskPatchEngine } from '../runtime/agent';
import { PatchApplyError, type FileChange, type FileMap } from '../runtime/apply-patch';
import type { NativeApprovals } from './native-approvals';
import type { SparkNativeHost } from './native-host';
import type { NativePaths } from './native-paths';

export const PATCH_REJECTED = 'patch rejected by user';

interface FileFormat {
  crlf: boolean;
  bom: boolean;
}

export interface DiskPatchOptions {
  host: SparkNativeHost;
  paths: NativePaths;
  approvals: NativeApprovals;
  /** Where edits apply without asking under the `ask` policy; null asks for every edit. */
  writableRoot: string | null;
  signal?: AbortSignal;
}

const BOM = '\uFEFF';

export const createDiskPatchEngine = (options: DiskPatchOptions): DiskPatchEngine => {
  const { host, paths, approvals } = options;
  const formats = new Map<string, FileFormat>();
  const key = (path: string) => (paths.windows ? path.toLowerCase() : path);

  return {
    normalizePath: (raw, line) => paths.forPatch(raw, line),

    async read(targets) {
      const files = await host.read(targets);
      const map: FileMap = {};
      files.forEach((file, index) => {
        const path = targets[index]!;
        if (!file.exists) return;
        if (file.isDirectory) throw new PatchApplyError(`${paths.display(path)} is a folder, not a file.`, path);
        if (file.binary) throw new PatchApplyError(`${paths.display(path)} is a binary file; apply_patch edits text files only.`, path);
        if (file.tooLarge || typeof file.text !== 'string') throw new PatchApplyError(`${paths.display(path)} is too large to patch.`, path);
        const bom = file.text.startsWith(BOM);
        const body = bom ? file.text.slice(1) : file.text;
        formats.set(key(path), { crlf: body.includes('\r\n'), bom });
        map[path] = body.replace(/\r\n/g, '\n');
      });
      return map;
    },

    async write(files, changes) {
      await approve(changes);
      for (const change of changes) {
        if (change.kind === 'delete') {
          await host.remove(change.path);
          continue;
        }
        const target = change.movePath ?? change.path;
        const text = files[target];
        if (text === undefined) continue;
        await host.write(target, restore(text, formats.get(key(change.path))));
        if (change.movePath && key(change.movePath) !== key(change.path)) await host.remove(change.path);
      }
    },
  };

  async function approve(changes: FileChange[]): Promise<void> {
    if (approvals.mode() === 'full') return;
    const touched = [...new Set(changes.flatMap((change) => (change.movePath ? [change.path, change.movePath] : [change.path])))];
    const outside = touched.filter((path) => !options.writableRoot || !paths.isInside(options.writableRoot, path));
    if (!outside.length) return;
    const decision = await approvals.request({ kind: 'patch', cwd: paths.cwd, paths: outside }, options.signal);
    if (decision === 'deny') throw new Error(PATCH_REJECTED);
    if (decision === 'task') approvals.allowAll();
  }
};

const restore = (text: string, format: FileFormat | undefined): string => {
  const body = format?.crlf ? text.replace(/\r?\n/g, '\r\n') : text;
  return format?.bom ? `${BOM}${body}` : body;
};
