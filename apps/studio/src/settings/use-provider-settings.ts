import React from 'react';
import { useStore } from '@nanostores/react';
import { useAuth } from '@willow/auth/AuthContext';
import { type ProviderId } from '@willow/ai/providers/endpoints';
import {
  $providerState,
  ensureProviderStateLoaded,
  resetProviderScope,
  updateProviderConfig,
  type ProviderConfig,
  type ProviderParams,
} from './provider-settings';

export type { ProviderConfig, ProviderParams };

/**
 * Subscribe a Models & API surface to the shared provider store.
 *
 * Safe to call from more than one mounted component: the scope reset and the
 * one-time eviction of remotely stored keys are both single-flighted in
 * `provider-settings.ts`, so the second caller re-uses the first one's work
 * rather than issuing its own.
 */
export const useProviderSettings = (setModelConfig: React.Dispatch<React.SetStateAction<any>>) => {
  const { user } = useAuth();
  const providerState = useStore($providerState);
  const uid = user?.uid ?? null;

  // Clear the previous account's keys before the browser paints the new account.
  React.useLayoutEffect(() => {
    resetProviderScope(uid);
  }, [uid]);

  React.useEffect(() => {
    void ensureProviderStateLoaded(user ?? null, setModelConfig);
  }, [user, setModelConfig]);

  const handleUpdateConfig = React.useCallback(
    (provider: ProviderId, config: ProviderConfig) =>
      updateProviderConfig(provider, config, user ?? null, setModelConfig),
    [user, setModelConfig],
  );

  return { providerState, handleUpdateConfig };
};
