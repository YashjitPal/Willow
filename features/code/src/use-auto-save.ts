import { useEffect, useRef, useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from './runtime/sandpack';
import { useDrive } from '@willow/storage/adapters/use-drive';
import { useLocalFS } from '@willow/storage/local-fs/LocalFSContext';

/**
 * Hook that auto-saves project to Google Drive / Local Folder when files change
 * @param projectName - Name of the project (folder name in Drive)
 * @param enabled - Whether auto-save is enabled
 * @param debounceMs - How long to wait after last change before saving (default 5000ms)
 */
export function useAutoSave(projectName: string, enabled: boolean = true, debounceMs: number = 5000) {
  const { saveCheckpoint, isReady, isSaving: isDriveSaving, error: driveError } = useDrive();
  const { saveLocalFSProject, isLocalFolderConnected } = useLocalFS();
  const filesMap = useStore(workbenchStore.files);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const [isQueueSaving, setIsQueueSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);

  const enqueueSave = useCallback(async () => {
    if (!enabled) return;

    // Capture an immutable snapshot now. Each snapshot is persisted only after
    // the previous one settles, so an older async save can never finish last
    // and overwrite a newer project state.
    const files = workbenchStore.getAllFiles().map(file => ({ ...file }));

    const generation = ++saveGenerationRef.current;
    const saveToDrive = isReady;
    const saveToLocalFS = isLocalFolderConnected;
    if (!saveToDrive && !saveToLocalFS) return;

    pendingSaveCountRef.current += 1;
    if (mountedRef.current) {
      setIsQueueSaving(true);
      setHasUnsavedChanges(true);
      setLocalSaveError(null);
    }

    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const failures: string[] = [];

        // Run independent destinations together, and handle them independently:
        // a Drive rejection must never prevent the durable local-folder save.
        await Promise.all([
          saveToLocalFS
            ? saveLocalFSProject(projectName, files)
                .then(saved => {
                  if (!saved) failures.push('Local folder save failed');
                })
                .catch((err: unknown) => {
                  console.error('[useAutoSave] Local save failed:', err);
                  failures.push(err instanceof Error ? err.message : 'Local folder save failed');
                })
            : Promise.resolve(),
          saveToDrive
            ? saveCheckpoint(projectName, files).then(checkpointId => {
                if (!checkpointId) failures.push('Google Drive save failed');
              })
            : Promise.resolve(),
        ]);

        if (!mountedRef.current) return;
        if (failures.length > 0) {
          setLocalSaveError(failures.join('; '));
        } else if (saveGenerationRef.current === generation) {
          setHasUnsavedChanges(false);
          setLocalSaveError(null);
        }
      })
      .finally(() => {
        pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
        if (mountedRef.current && pendingSaveCountRef.current === 0) {
          setIsQueueSaving(false);
        }
      });

    saveQueueRef.current = operation;
    await operation;
  }, [enabled, isReady, isLocalFolderConnected, projectName, saveCheckpoint, saveLocalFSProject]);

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
      void enqueueSave();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [filesMap, enabled, isReady, isLocalFolderConnected, debounceMs, enqueueSave]);

  // Manual save function
  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await enqueueSave();
  }, [enqueueSave]);

  // Flush a pending debounced save on unmount. The debounce timer dies with the
  // component, so without this the last <debounceMs of edits before leaving the
  // editor never reached Drive / the local folder. Empty snapshots are
  // intentional: they prune the last deleted file instead of resurrecting it.
  const saveRef = useRef(enqueueSave);
  useEffect(() => { saveRef.current = enqueueSave; }, [enqueueSave]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      const shouldFlush = !!timerRef.current;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      mountedRef.current = false;
      if (shouldFlush) {
        void saveRef.current();
      }
    };
  }, []);

  return {
    isSaving: isQueueSaving || isDriveSaving,
    error: localSaveError || driveError,
    isReady: isReady || isLocalFolderConnected,
    hasUnsavedChanges,
    saveNow,
  };
}
