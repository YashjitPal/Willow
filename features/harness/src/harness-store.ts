import { atom } from 'nanostores';
import type { HarnessId } from './harnesses';

/** The agent tab in front, or null while one of Willow's own destinations is. */
export const $harnessTab = atom<HarnessId | null>(null);

/** The agent tab opened last, which the agents' page keeps showing while Willow's own destinations are in front. */
export const $harnessLast = atom<HarnessId | null>(null);

export const openHarnessTab = (id: HarnessId): void => {
  $harnessLast.set(id);
  $harnessTab.set(id);
};

export const closeHarnessTab = (): void => {
  $harnessTab.set(null);
};
