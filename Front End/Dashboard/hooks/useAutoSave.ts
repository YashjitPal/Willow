import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '@/lib/sandpack';
import { useDrive } from './useDrive';
import { useLocalFS } from '../context/LocalFSContext';

/**
 * Hook that auto-saves project to Google Drive / Local Folder when files change
 * @param projectName - Name of the project (folder name in Drive)
 * @param enabled - Whether auto-save is enabled
 * @param debounceMs - How long to wait after last change before saving (default 5000ms)
 */
export function useAutoSave(projectName: string, enabled: boolean = true, debounceMs: number = 5000) {
  const { saveCheckpoint, isReady, isSaving, error } = useDrive();
  const { saveLocalFSProject, isLocalFolderConnected } = useLocalFS();
  const filesMap = useStore(workbenchStore.files);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const save = useCallback(async () => {
    if (!enabled) return;

    const files = workbenchStore.getAllFiles();
    if (files.length === 0) return;

    // Save to Google Drive if connected
    if (isReady) {
      await saveCheckpoint(projectName, files);
    }

    // Save to Local File System if connected
    if (isLocalFolderConnected) {
      await saveLocalFSProject(projectName, files);
    }
  }, [isReady, isLocalFolderConnected, enabled, projectName, saveCheckpoint, saveLocalFSProject]);

  // Debounced save when files change
  useEffect(() => {
    if (!enabled || (!isReady && !isLocalFolderConnected)) return;

    // Clear previous timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer. Null the ref when it fires so "timerRef.current is set"
    // always means "a save is still pending" (the unmount flush relies on it).
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      save();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [filesMap, enabled, isReady, isLocalFolderConnected, debounceMs, save]);

  // Manual save function
  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await save();
  }, [save]);

  // Flush a pending debounced save on unmount. The debounce timer dies with the
  // component, so without this the last <debounceMs of edits before leaving the
  // editor never reached Drive / the local folder. save() itself no-ops when
  // the store has no files, so a teardown-time flush can never save an empty
  // project over a real one.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void saveRef.current();
      }
    };
  }, []);

  return {
    isSaving,
    error,
    isReady: isReady || isLocalFolderConnected,
    saveNow,
  };
}
