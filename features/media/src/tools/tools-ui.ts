// The dialogs any Tools page can open, provided by `ToolsSurface` so they outlive the page that
// asked (a remix navigates away while its snackbar shows).
import React from 'react';
import type { MediaItem } from '../types';
import type { MediaPickRequest } from './tool-sdk-host';
import type { ToolEntry } from './tools-store';
import type { ToolsHost } from './tools-host';

export interface ToolsUi {
  host: ToolsHost;
  openShare(entry: ToolEntry): void;
  /** Flow's delete confirmation; resolves true once the tool is gone. */
  confirmDelete(entry: ToolEntry): Promise<boolean>;
  /** The community preview: resolves true for Open in project. */
  previewCommunity(entry: ToolEntry): Promise<boolean>;
  pickMedia(request: MediaPickRequest): Promise<MediaItem[] | null>;
  openIconDialog(entry: ToolEntry): void;
  openFeatured(entry: ToolEntry): void;
  openDescription(entry: ToolEntry): void;
  /** A picture from the project or an upload, as a data URL at most `max` px. */
  pickImage(max: number): Promise<string | null>;
}

export const ToolsUiContext = React.createContext<ToolsUi | null>(null);

export function useToolsUi(): ToolsUi {
  const ui = React.useContext(ToolsUiContext);
  if (!ui) throw new Error('useToolsUi outside ToolsSurface');
  return ui;
}
