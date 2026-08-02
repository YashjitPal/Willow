import { atom } from 'nanostores';

export interface PreviewError {
  id: string;
  type: string;
  message: string;
  timestamp: number;
}

// All collected preview errors
export const previewErrors = atom<PreviewError[]>([]);

// Whether the error panel is open
export const isErrorPanelOpen = atom<boolean>(false);

// Add a new error (with deduplication — same type+message within 3s is ignored)
export function addPreviewError(type: string, message: string) {
  const now = Date.now();
  const current = previewErrors.get();

  // Deduplicate: skip if same type+message was added within 3 seconds
  const isDuplicate = current.some(
    (e) => e.type === type && e.message === message && now - e.timestamp < 3000
  );
  if (isDuplicate) return;

  const newError: PreviewError = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    timestamp: now,
  };

  previewErrors.set([...current, newError]);
}

// Clear all errors
export function clearPreviewErrors() {
  previewErrors.set([]);
}

// Remove a single error
export function removePreviewError(id: string) {
  previewErrors.set(previewErrors.get().filter((e) => e.id !== id));
}

// Toggle the error panel
export function toggleErrorPanel() {
  isErrorPanelOpen.set(!isErrorPanelOpen.get());
}
