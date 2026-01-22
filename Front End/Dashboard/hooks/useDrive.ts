import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { driveService, FileContent, DriveFile } from '../lib/driveService';

/**
 * Hook to use Google Drive functionality
 * Automatically syncs access token from auth context
 */
export function useDrive() {
  const { accessToken, user } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync access token with drive service
  useEffect(() => {
    console.log('[useDrive] Token sync - accessToken:', accessToken ? 'present' : 'null', 'user:', user?.email);
    if (accessToken) {
      driveService.setAccessToken(accessToken);
      setIsReady(true);
      console.log('[useDrive] Drive is ready');
    } else {
      driveService.setAccessToken(null);
      setIsReady(false);
      console.log('[useDrive] Drive is NOT ready - no token');
    }
  }, [accessToken, user]);

  /**
   * Save a checkpoint of the current project
   */
  const saveCheckpoint = useCallback(async (projectName: string, files: FileContent[]) => {
    if (!isReady) {
      setError('Drive not ready. Please sign in with Google.');
      return null;
    }

    setIsSaving(true);
    setError(null);

    try {
      const checkpointId = await driveService.saveCheckpoint(projectName, files);
      return checkpointId;
    } catch (err: any) {
      console.error('[useDrive] Save checkpoint error:', err);
      setError(err.message || 'Failed to save checkpoint');
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [isReady]);

  /**
   * List all checkpoints for a project
   */
  const listCheckpoints = useCallback(async (projectName: string): Promise<DriveFile[]> => {
    if (!isReady) return [];
    
    try {
      return await driveService.listCheckpoints(projectName);
    } catch (err: any) {
      console.error('[useDrive] List checkpoints error:', err);
      return [];
    }
  }, [isReady]);

  /**
   * Load files from a specific checkpoint
   */
  const loadCheckpoint = useCallback(async (checkpointId: string): Promise<FileContent[]> => {
    if (!isReady) return [];
    
    try {
      return await driveService.loadCheckpoint(checkpointId);
    } catch (err: any) {
      console.error('[useDrive] Load checkpoint error:', err);
      setError(err.message || 'Failed to load checkpoint');
      return [];
    }
  }, [isReady]);

  /**
   * List all projects saved in Drive
   */
  const listProjects = useCallback(async (): Promise<DriveFile[]> => {
    if (!isReady) return [];
    
    try {
      return await driveService.listProjects();
    } catch (err: any) {
      console.error('[useDrive] List projects error:', err);
      return [];
    }
  }, [isReady]);

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
    listProjects,
    clearError,
  };
}
