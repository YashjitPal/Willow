/**
 * The seam between the harness and the workbench.
 *
 * The harness thinks in a plain `{ path: contents }` map and a working copy; the
 * workbench keeps files in the sandpack store and drives the preview off it.
 * This module is the only place that knows both: it reads the project when the
 * turn starts, gives the turn the tools that need the workbench (the live
 * preview, the image model, the Design canvas), and commits the result in one
 * step when it ends.
 *
 * ## Why one commit at the end
 *
 * The preview rebuilds when generation finishes. Writing files into the store
 * as they arrive would show the first build half a project — `App.tsx` importing
 * components that do not exist yet — and the code panel would churn under a
 * user who is reading it. Committing once means the preview's next build is the
 * project the harness already built and ran itself.
 *
 * The one exception is the preview tools: to test or inspect the app mid-turn,
 * the session loads the working copy into the preview early, but only after it
 * passes the same build check — so the preview never shows a broken half.
 *
 * The commit is a merge, not a replacement: only paths the turn changed are
 * written, so an edit the user made in the code panel while the turn ran is not
 * lost to a snapshot taken before it.
 */

import type { LibrarySkill } from '@willow/core/skill-library';
import type { McpBoundTool } from '@willow/ai/mcp/mcp-store';
import type { GeneratedImage } from '@willow/ai/image-generation';
import { apiKeysForBinding, resolveProviderBinding } from '@willow/ai/providers/profiles';
import { collectSavedModelsInCatalogOrder, getModelCategory, liveModelId } from '@willow/core/model-catalog';
import { addDesignNode } from '@willow/design/design-store';
import type { SandpackStore } from '../runtime/sandpack/sandpack-store';
import type { CodeSession } from '../session/code-session';
import { selectedElements } from '../visual-editing/engine/visual-editor-store';
import { makeBrowserTools } from './browser/browser-tools';
import { PreviewSession } from './browser/preview-session';
import type { CodeToolId } from './code-tools';
import { compactHistory, recentlyChangedPaths, type HistoryEntry } from './context';
import { makeDesignTool } from './design-tool';
import { makeImageTool, type ImageFormat, type ImageModelResolution } from './image-tool';
import { resolveHarnessModel } from './model';
import type { TurnMode, TurnOutcome } from './protocol';
import { runTurn, type TurnAttachment, type TurnResult } from './turn';
import { createBrowserChecker, formatCheckReport, reportHasErrors } from './verify';
import type { Workspace } from './workspace';

export interface ImageAsset {
  name: string;
  /** Where the image is saved in the project, e.g. `/assets/logo.png`. */
  path: string;
  dataUrl: string;
}

/** What the preview tools need from the workbench UI. */
export interface WorkbenchEnvironment {
  /**
   * Brings the preview into view. `force` is set when the preview has no size
   * at all (a narrow screen showing the chat), and only then may it hide the chat.
   */
  showPreview?: (force: boolean) => void;
  /** Stops the turn, for the Stop button on the preview's testing pill. */
  requestStop?: () => void;
}

export interface WorkbenchTurnOptions {
  prompt: string;
  attachments?: TurnAttachment[];
  /** Images the user attached, which the app may import. Saved only if it does. */
  imageAssets?: ImageAsset[];
  history: HistoryEntry[];
  mode: TurnMode;
  /** The tool picked in the composer for this message. */
  selectedTool?: CodeToolId | null;
  modelConfig: unknown;
  selectedModelId?: string;
  apiKeys: unknown;
  skills?: LibrarySkill[];
  connectors?: McpBoundTool[];
  environment?: WorkbenchEnvironment;
  signal: AbortSignal;
  onFirstOutput?: () => void;
  /** The screen running the turn: its files, its live transcript, its preview. */
  session: CodeSession;
  /** False once that screen has unmounted: a turn left behind writes nothing. */
  isLive?: () => boolean;
}

export interface WorkbenchTurnResult extends TurnOutcome {
  /** True when files were written to the workbench. */
  committed: boolean;
  /** The whole project after the commit, for the message's Revert/Preview snapshot. */
  snapshot: Record<string, string> | null;
}

function readProject(sandpackStore: SandpackStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(sandpackStore.files.get())) {
    if (entry?.content !== undefined) out[path] = entry.content;
  }
  return out;
}

/** True when any project file refers to the asset by path or file name. */
function isReferenced(asset: ImageAsset, files: Record<string, string>): boolean {
  const name = asset.path.split('/').pop()!;
  return Object.entries(files).some(([path, contents]) => path !== asset.path && !contents.startsWith('data:') && (contents.includes(asset.path) || contents.includes(name)));
}

/** Writes the working copy's changes, and the attached images it uses, into the workbench. */
function applyToWorkbench(sandpackStore: SandpackStore, workspace: Workspace, assets: ImageAsset[]): boolean {
  const changes = workspace.changes();
  const referenced = assets.filter((asset) => isReferenced(asset, workspace.files));
  if (changes.length === 0 && referenced.length === 0) return false;

  const next = { ...sandpackStore.files.get() };
  for (const change of changes) {
    if (change.after === null) delete next[change.path];
    else next[change.path] = { type: 'file', content: change.after };
  }
  for (const asset of referenced) {
    if (!next[asset.path]) next[asset.path] = { type: 'file', content: asset.dataUrl };
  }

  sandpackStore.files.set(next);
  sandpackStore.hasUserCode.set(true);
  sandpackStore.activeSnapshotId.set(null);
  return true;
}

/** The first Gemini image model the user added, with its key; nothing is ever substituted. */
function resolveImageModel(modelConfig: unknown, apiKeys: unknown): ImageModelResolution {
  const model = collectSavedModelsInCatalogOrder(modelConfig)
    .find((entry) => getModelCategory(entry) === 'image' && entry.providerId === 'gemini');
  if (!model) {
    return {
      missing: 'No image was made: the user has no Gemini image model added. Tell them they can add one (for example Nano Banana) in Settings → Models. For now use a placeholder — a CSS gradient or https://picsum.photos — and say so.',
    };
  }
  const binding = resolveProviderBinding(modelConfig, 'gemini', { profileId: model.profileId });
  const apiKey = apiKeysForBinding(binding, 'gemini', apiKeys)[0];
  if (!apiKey) return { missing: 'No image was made: the Gemini API key is missing. The user can add it in Settings → Models.' };
  return { model: liveModelId(model.modelId || model.id), name: String(model.name || model.modelId), apiKey, baseUrl: binding.baseUrl };
}

/** Photos are far smaller as JPEG; a path ending .png or .webp keeps that format. */
async function encodeImage(image: GeneratedImage, format: ImageFormat): Promise<GeneratedImage> {
  const mimeType = `image/${format}`;
  if (image.mimeType === mimeType || typeof document === 'undefined') return image;
  const blob = await (await fetch(`data:${image.mimeType};base64,${image.data}`)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const url = canvas.toDataURL(mimeType, 0.88);
  return url.startsWith(`data:${mimeType}`) ? { mimeType, data: url.slice(url.indexOf(',') + 1) } : image;
}

/** The elements picked in Visual Edits, as the Visual Edits tool's context. */
function visualSelectionNote(): string | null {
  const picked = selectedElements.get();
  if (picked.length === 0) return null;
  const lines = picked.slice(0, 12).map((element, index) => {
    const text = element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60);
    const where = element.sourceLocation ? ` — /${element.sourceLocation.fileName.replace(/^\//, '')}:${element.sourceLocation.line}` : '';
    return `${index + 1}. <${element.tagName.toLowerCase()}>${text ? ` "${text}"` : ''}${where}`;
  });
  return `The user has these elements selected in Visual Edits — "this" and "these" mean them:\n${lines.join('\n')}`;
}

function exposeForDebugging(result: TurnResult, mode: TurnMode): void {
  if (typeof window === 'undefined') return;
  const globals = window as unknown as Record<string, unknown>;
  const turn = {
    mode,
    reason: result.reason,
    error: result.error,
    systemPrompt: result.transcript.systemPrompt,
    messages: result.transcript.messages.map((message) => ({
      role: message.role,
      content: message.content,
      attachments: message.attachments?.map((attachment) => attachment.name ?? attachment.mimeType),
    })),
    steps: result.steps,
  };
  globals.willowHarness = { lastTurn: turn };
}

export async function runWorkbenchTurn(options: WorkbenchTurnOptions): Promise<WorkbenchTurnResult> {
  const empty = (error: string): WorkbenchTurnResult => ({
    reason: 'error',
    error,
    steps: [],
    text: '',
    changedPaths: [],
    thinkingMs: 0,
    committed: false,
    snapshot: null,
  });

  let model;
  try {
    model = resolveHarnessModel(options.modelConfig, options.selectedModelId, options.apiKeys);
  } catch (error) {
    return empty((error as Error).message);
  }

  // The screen's own store: there is one per Code screen, not one per tab.
  const { workbench: sandpackStore, harness } = options.session;
  const assets = options.imageAssets ?? [];
  const files = readProject(sandpackStore);
  for (const asset of assets) {
    if (files[asset.path] === undefined) files[asset.path] = asset.dataUrl;
  }

  const promptNotes: string[] = [];
  if (assets.length > 0) {
    promptNotes.push(
      'The user attached these images. They are saved in the project, so the app can use them by importing the path (the import is a URL string usable as an <img src> or in CSS url()):\n' +
        assets.map((asset) => `- "${asset.name}" → ${asset.path}`).join('\n') +
        '\nAn image the app does not import is treated as a reference only and is not kept.',
    );
  }
  if (options.selectedTool === 'prototype') {
    const selection = visualSelectionNote();
    if (selection) promptNotes.push(selection);
  }

  const checker = createBrowserChecker();
  const isLive = () => options.isLive?.() !== false;
  const preview = new PreviewSession({
    session: options.session,
    syncFiles: (workspace) => isLive() && applyToWorkbench(sandpackStore, workspace, assets),
    showPreview: options.environment?.showPreview,
    requestStop: options.environment?.requestStop,
  });
  const extraTools = [
    ...makeBrowserTools(preview),
    makeImageTool({
      resolveModel: () => resolveImageModel(options.modelConfig, options.apiKeys),
      encode: encodeImage,
    }),
    makeDesignTool({
      addToCanvas: (design) => addDesignNode({ prompt: design.name, code: design.code, fileName: design.fileName }).id,
      validate: async (code) => {
        const report = await checker({ '/App.tsx': code, '/package.json': '{"dependencies":{"lucide-react":"^0.460.0"}}' }, { signal: options.signal });
        return reportHasErrors(report) ? formatCheckReport(report) : null;
      },
    }),
  ];

  sandpackStore.isGenerating.set(true);
  harness.clear();

  let result: TurnResult;
  try {
    result = await runTurn({
      prompt: options.prompt,
      attachments: options.attachments,
      promptNotes,
      history: compactHistory(options.history),
      recentPaths: recentlyChangedPaths(options.history),
      files,
      mode: options.mode,
      selectedTool: options.selectedTool,
      model,
      skills: options.skills,
      connectors: options.connectors,
      extraTools,
      checker,
      signal: options.signal,
      onUpdate: (state) => { if (isLive()) harness.publish(state); },
      onWriting: (path) => { if (isLive()) sandpackStore.setCurrentEditingFile(path); },
      onFirstOutput: options.onFirstOutput,
    });
  } catch (error) {
    preview.dispose();
    if (isLive()) {
      sandpackStore.setCurrentEditingFile(null);
      sandpackStore.isGenerating.set(false);
    }
    return empty((error as Error).message);
  }
  // Before the commit, so the preview's final build is a normal one at full width.
  preview.dispose();

  exposeForDebugging(result, options.mode);

  // Assets that were only passed in as references are not changes.
  const committed = isLive() && applyToWorkbench(sandpackStore, result.workspace, assets);
  if (isLive()) {
    sandpackStore.setCurrentEditingFile(null);
    // Cleared after the commit, so the preview's "generation finished" rebuild sees the new files.
    sandpackStore.isGenerating.set(false);
  }

  return {
    reason: result.reason,
    error: result.error,
    steps: result.steps,
    text: result.text,
    changedPaths: result.changedPaths,
    awaitingApproval: result.awaitingApproval,
    thinkingMs: result.thinkingMs,
    committed,
    snapshot: committed ? readProject(sandpackStore) : null,
  };
}
