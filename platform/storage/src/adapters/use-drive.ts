import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@willow/auth/AuthContext';
import { DriveService, FileContent, DriveFile } from './google-drive';

const driveSaveQueues = new Map<string, Promise<unknown>>();

async function withDriveSaveLock<T>(projectName: string, operation: () => Promise<T>): Promise<T> {
  const lockName = `willow-drive-save:${projectName}`;
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks?.request) return locks.request(lockName, operation);

  const previous = driveSaveQueues.get(lockName) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  driveSaveQueues.set(lockName, current);
  try {
    return await current;
  } finally {
    if (driveSaveQueues.get(lockName) === current) driveSaveQueues.delete(lockName);
  }
}

/**
 * Hook to use Google Drive functionality
 * Automatically syncs access token from auth context
 */
export function useDrive() {
  const { driveAccessToken, isDriveConnected } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionGenerationRef = useRef(0);
  const activeDriveTokenRef = useRef<string | null>(null);
  const driveClientRef = useRef<DriveService | null>(null);
  const driveAbortRef = useRef<AbortController | null>(null);
  const activeSaveCountRef = useRef(0);

  // Only the explicitly granted Drive-scoped token may reach DriveService.
  useEffect(() => {
    connectionGenerationRef.current += 1;
    driveAbortRef.current?.abort();
    const ready = isDriveConnected && !!driveAccessToken;
    activeDriveTokenRef.current = ready ? driveAccessToken : null;
    const controller = ready ? new AbortController() : null;
    driveAbortRef.current = controller;
    driveClientRef.current = ready ? new DriveService(driveAccessToken, controller!.signal) : null;
    activeSaveCountRef.current = 0;
    setIsReady(ready);
    setIsSaving(false);
    setError(null);
    return () => controller?.abort();
  }, [driveAccessToken, isDriveConnected]);

  /**
   * Save a checkpoint of the current project
   */
  const saveCheckpoint = useCallback(async (projectName: string, files: FileContent[]) => {
    if (!isReady || !driveAccessToken || !isDriveConnected || activeDriveTokenRef.current !== driveAccessToken) {
      setError('Drive not ready. Please sign in with Google.');
      return null;
    }

    const generation = connectionGenerationRef.current;
    const client = driveClientRef.current;
    if (!client) return null;
    activeSaveCountRef.current += 1;
    setIsSaving(true);
    setError(null);

    try {
      const checkpointId = await withDriveSaveLock(projectName, () => client.saveCheckpoint(projectName, files));
      if (connectionGenerationRef.current !== generation) return null;
      return checkpointId;
    } catch (err: any) {
      console.error('[useDrive] Save checkpoint error:', err);
      if (connectionGenerationRef.current === generation) {
        setError(err.message || 'Failed to save checkpoint');
      }
      return null;
    } finally {
      if (connectionGenerationRef.current === generation) {
        activeSaveCountRef.current = Math.max(0, activeSaveCountRef.current - 1);
        setIsSaving(activeSaveCountRef.current > 0);
      }
    }
  }, [driveAccessToken, isDriveConnected, isReady]);

  /**
   * List all checkpoints for a project
   */
  const listCheckpoints = useCallback(async (projectName: string): Promise<DriveFile[]> => {
    if (!isReady || !driveAccessToken || !isDriveConnected || activeDriveTokenRef.current !== driveAccessToken) return [];

    const generation = connectionGenerationRef.current;
    const client = driveClientRef.current;
    if (!client) return [];
    try {
      const checkpoints = await client.listCheckpoints(projectName);
      return connectionGenerationRef.current === generation ? checkpoints : [];
    } catch (err: any) {
      console.error('[useDrive] List checkpoints error:', err);
      return [];
    }
  }, [driveAccessToken, isDriveConnected, isReady]);

  /**
   * Load files from a specific checkpoint
   */
  const loadCheckpoint = useCallback(async (checkpointId: string): Promise<FileContent[]> => {
    if (!isReady || !driveAccessToken || !isDriveConnected || activeDriveTokenRef.current !== driveAccessToken) return [];

    const generation = connectionGenerationRef.current;
    const client = driveClientRef.current;
    if (!client) return [];
    try {
      const files = await client.loadCheckpoint(checkpointId);
      return connectionGenerationRef.current === generation ? files : [];
    } catch (err: any) {
      console.error('[useDrive] Load checkpoint error:', err);
      if (connectionGenerationRef.current === generation) {
        setError(err.message || 'Failed to load checkpoint');
      }
      return [];
    }
  }, [driveAccessToken, isDriveConnected, isReady]);

  /** Load a project's non-mutating `latest` generation for reopen. */
  const loadLatestProject = useCallback(async (projectName: string): Promise<FileContent[] | null> => {
    if (!isReady || !driveAccessToken || !isDriveConnected || activeDriveTokenRef.current !== driveAccessToken) return null;

    const generation = connectionGenerationRef.current;
    const client = driveClientRef.current;
    if (!client) return null;
    try {
      const files = await client.loadLatestProject(projectName);
      return connectionGenerationRef.current === generation ? files : null;
    } catch (err: any) {
      console.error('[useDrive] Load latest project error:', err);
      if (connectionGenerationRef.current === generation) {
        setError(err.message || 'Failed to load latest project');
      }
      return null;
    }
  }, [driveAccessToken, isDriveConnected, isReady]);

  /**
   * List all projects saved in Drive
   */
  const listProjects = useCallback(async (): Promise<DriveFile[]> => {
    if (!isReady || !driveAccessToken || !isDriveConnected || activeDriveTokenRef.current !== driveAccessToken) return [];

    const generation = connectionGenerationRef.current;
    const client = driveClientRef.current;
    if (!client) return [];
    try {
      const projects = await client.listProjects();
      return connectionGenerationRef.current === generation ? projects : [];
    } catch (err: any) {
      console.error('[useDrive] List projects error:', err);
      return [];
    }
  }, [driveAccessToken, isDriveConnected, isReady]);

  /**
   * Clear any error
   */
  const clearError = useCallback(() => setError(null), []);

  return {
    isReady,
    isSaving,
    error,
    saveCheckpoint,
    listCheckpoints,
    loadCheckpoint,
    loadLatestProject,
    listProjects,
    clearError,
  };
}
