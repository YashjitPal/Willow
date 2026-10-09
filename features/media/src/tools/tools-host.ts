// What the Tools pages need from the Media view: MediaView owns the project, its gallery, the
// models and keys, and generation; the Tools pages reach them only through this, as the
// Scenebuilder does through its `SceneHost`.
import type React from 'react';
import type { MediaItem } from '../types';
import type { GenerationStart } from '../agent/agent-session';

export interface ToolsHost {
  /** The account's scope (user + root + workspace), which tools are saved under. */
  scopeId: string;
  projectId?: string;
  projectName: string;
  /** The Media query (`?projectId=…`) every Tools address keeps. */
  search: string;
  navigate(to: { pathname: string; search: string }, options?: { replace?: boolean }): void;
  /** Every item in the open project. */
  readonly mediaItems: MediaItem[];
  listProjects(): { id: string; name: string }[];
  loadProjectMedia(projectId: string): Promise<MediaItem[]>;
  /** Copies another project's item into this one and returns the copy. */
  adoptMedia(item: MediaItem): MediaItem;
  /** Uploads files into the project and resolves with the finished items. */
  importFiles(files: File[]): Promise<MediaItem[]>;
  imageModels: { id: string; name: string }[];
  videoModels: { id: string; name: string }[];
  /** The prompt box's current picks, used when a tool names no model Willow has. */
  defaultImageModel: string;
  defaultVideoModel: string;
  /** The agent's own generation start: placeholder tiles now, `done` once each finishes. */
  startImages(spec: { prompt: string; model: string; ratio: string; count: number; references: MediaItem[] }): GenerationStart;
  startVideos(spec: { prompt: string; model: string; ratio: string; duration: string; count: number; frames: MediaItem[] }): GenerationStart;
  geminiKeys: string[];
  modelConfig: unknown;
  apiKeys: unknown;
  openSettings(): void;
  /** MediaView's own sidebar, which the Tools pages draw so the frame never moves. */
  renderSidebar(): React.ReactNode;
  /** Opens that sidebar as a drawer: on a phone it is not drawn in place (see MediaSidebar). */
  openNav(): void;
}
