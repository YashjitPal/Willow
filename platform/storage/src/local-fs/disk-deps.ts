/**
 * The provider-scope helpers every name-addressed disk writer needs.
 *
 * `resolveCurrentProjectName` is the important one: a project folder can be
 * renamed while a multi-second save is still in flight, and a write addressed
 * to the stale name would resurrect the old folder as a phantom project. Every
 * name-addressed path in ./code-disk and ./media-disk redirects through it.
 *
 * These are passed in rather than imported because they close over provider
 * state (the directory handle, the user profile, the in-flight rename map).
 */
export interface DiskDeps {
  getActiveHandle: () => Promise<FileSystemDirectoryHandle | null>;
  getSanitizedWorkspaceName: () => string;
  resolveCurrentProjectName: (name: string) => string;
}
