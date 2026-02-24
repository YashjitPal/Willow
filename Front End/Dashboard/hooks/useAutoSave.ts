import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '@/lib/sandpack';
import { useDrive } from './useDrive';

/**
 * Hook that auto-saves project to Google Drive when files change
 * @param projectName - Name of the project (folder name in Drive)
 * @param enabled - Whether auto-save is enabled
 * @param debounceMs - How long to wait after last change before saving (default 5000ms)
 */
export function useAutoSave(projectName: string, enabled: boolean = true, debounceMs: number = 5000) {
  const { saveCheckpoint, isReady, isSaving, error } = useDrive();
  const filesMap = useStore(workbenchStore.files);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const save = useCallback(async () => {
    if (!isReady || !enabled) return;

    const files = workbenchStore.getAllFiles();
    if (files.length === 0) return;

    console.log('[AutoSave] Saving checkpoint for:', projectName, 'with', files.length, 'files');

    const checkpointId = await saveCheckpoint(projectName, files);
    if (checkpointId) {
      console.log('[AutoSave] Checkpoint saved:', checkpointId);
    }
  }, [isReady, enabled, projectName, saveCheckpoint]);

  // Debounced save when files change
  useEffect(() => {
    if (!enabled || !isReady) return;
    
    // Clear previous timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    // Set new timer
    timerRef.current = setTimeout(() => {
      save();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [filesMap, enabled, isReady, debounceMs, save]);

  // Manual save function
  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    await save();
  }, [save]);

  return {
    isSaving,
    error,
    isReady,
    saveNow,
  };
}
