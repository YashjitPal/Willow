/**
 * Which Customize tab to open on, asked for from outside the page.
 *
 * Customize restores the tab it was left on, so a surface that sends the user to one
 * tab in particular — Settings → Personal Intelligence → Connected Apps, the settings
 * menu's Skills row, the retired `/connected-apps` address — sets this before the view
 * changes. The page takes it as it mounts, or at once if it is already showing.
 */
import { atom } from 'nanostores';

export type CustomizeTab = 'discover' | 'connectors' | 'skills';

export const $customizeTabRequest = atom<CustomizeTab | null>(null);

export const requestCustomizeTab = (tab: CustomizeTab): void => {
  $customizeTabRequest.set(tab);
};
