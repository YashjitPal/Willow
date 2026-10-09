import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const AGENT_ACCESS_KEY = 'willow.agentAccess';

let agentAccess = true;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadSettings(): Promise<void> {
  try {
    agentAccess = (await AsyncStorage.getItem(AGENT_ACCESS_KEY)) !== 'off';
  } catch {
    agentAccess = true;
  }
  emit();
}

/** "Let agents use this phone". On unless the owner turned it off. */
export function getAgentAccess(): boolean {
  return agentAccess;
}

export function setAgentAccess(on: boolean): void {
  agentAccess = on;
  emit();
  AsyncStorage.setItem(AGENT_ACCESS_KEY, on ? 'on' : 'off').catch(() => {});
}

export function useAgentAccess(): boolean {
  return useSyncExternalStore(subscribe, getAgentAccess);
}
