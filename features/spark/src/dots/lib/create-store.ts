import { useSyncExternalStore } from 'react';

/**
 * zustand's `create`, as far as the Codex bot components use it: a store hook
 * that takes a selector, with `getState`, `setState` and `subscribe` on it.
 * Selectors must return stable values, as in zustand 5.
 */
type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void;

export interface StoreApi<T> {
  getState: () => T;
  setState: SetState<T>;
  subscribe: (listener: (state: T, previous: T) => void) => () => void;
}

export type UseBoundStore<T> = {
  (): T;
  <U>(selector: (state: T) => U): U;
} & StoreApi<T>;

export function create<T>(initializer: (set: SetState<T>, get: () => T, api: StoreApi<T>) => T): UseBoundStore<T> {
  let state: T;
  const listeners = new Set<(state: T, previous: T) => void>();
  const getState = () => state;
  const setState: SetState<T> = (partial, replace) => {
    const next = typeof partial === 'function' ? (partial as (current: T) => Partial<T>)(state) : partial;
    if (Object.is(next, state)) return;
    const previous = state;
    state = replace ? (next as T) : { ...state, ...next };
    listeners.forEach((listener) => listener(state, previous));
  };
  const subscribe = (listener: (state: T, previous: T) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const api: StoreApi<T> = { getState, setState, subscribe };
  state = initializer(setState, getState, api);

  function useBoundStore<U>(selector?: (state: T) => U) {
    const select = () => (selector ? selector(state) : state);
    return useSyncExternalStore(subscribe, select, select);
  }
  return Object.assign(useBoundStore, api) as UseBoundStore<T>;
}
