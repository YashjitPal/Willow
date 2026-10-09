import { startTransition } from 'react';
import type { StudioExperience } from '@willow/core/types';
import { isHarnessId } from '@willow/harness/harnesses';
import { closeHarnessTab, openHarnessTab } from '@willow/harness/harness-store';
import { goToSparkDot, goToSparkDots, goToSparkHome, isSparkLocation, navigateSpark } from '@willow/spark/spark-store';
import type { ViewType } from '../sidebar/Sidebar';
import type { RailDestinationId } from './AppRail';
import { $railReturns } from './rail-returns';

type StudioMode = 'develop' | 'chat' | 'media';

/** The shell's own steps, which the rail takes as the sidebar's rows do, and where it is. */
export interface RailShell {
  /** Where the rail is lit now. */
  current: RailDestinationId;
  /** Whether the main shell is on show, rather than a Media or Code project (or Willow TV) outside it. */
  onShell: boolean;
  currentView: ViewType;
  studioExperience: StudioExperience;
  setCurrentView: (view: ViewType) => unknown;
  onModeChange: (mode: StudioMode) => unknown;
  onStudioExperienceChange: (experience: StudioExperience) => unknown;
  /** Opens one of Willow's addresses. */
  navigate: (to: string) => void;
}

/** Where the rail is lit in the main shell: the agent tab in front, else the surface on show. */
export const railCurrentFor = (place: {
  harnessTab: RailDestinationId | null;
  currentView: ViewType;
  studioExperience: StudioExperience;
  studioMode: StudioMode;
  sparkPage: string;
}): RailDestinationId => {
  if (place.harnessTab) return place.harnessTab;
  if (place.currentView === 'customize') return 'customize';
  if (place.currentView !== 'home') return 'home';
  if (place.studioExperience === 'spark') return place.sparkPage === 'dots' ? 'dots' : 'spark';
  if (place.studioMode === 'develop') return 'code';
  if (place.studioMode === 'media') return 'media';
  return 'home';
};

/**
 * The same steps the sidebar's own rows take to reach each place. Media and Code go back to the
 * project the user left them on (`rail-returns.ts`), from anywhere but that project — their landing
 * included, which a reload behind an agent tab comes back on — and from the project to the landing.
 */
export const navigateRail = (destination: RailDestinationId, shell: RailShell): void => {
  // From outside the main shell, its surfaces are reached through `/`, which the shell turns
  // into the address of the surface it then shows.
  const toShell = () => {
    if (!shell.onShell) shell.navigate('/');
  };
  if (isHarnessId(destination)) {
    openHarnessTab(destination);
    toShell();
    return;
  }
  if (destination === 'code' || destination === 'media') {
    const left = destination === shell.current && !shell.onShell ? null : $railReturns.get()[destination];
    if (left) {
      // React Router moves the address in a transition. The shell's switch goes in the same one:
      // on its own it lands first, and paints the landing for a frame before the project. An agent
      // tab in front stays until the project has replaced the shell (App closes it then): closing a
      // store's tab cannot wait for a transition, and would uncover the landing behind it.
      startTransition(() => {
        shell.setCurrentView('home');
        shell.onModeChange(destination === 'code' ? 'develop' : 'media');
        shell.navigate(left);
      });
      return;
    }
  }
  closeHarnessTab();
  switch (destination) {
    case 'home':
      toShell();
      if (shell.studioExperience === 'chat' && shell.currentView === 'home') shell.onModeChange('chat');
      else shell.onStudioExperienceChange('chat');
      return;
    case 'code':
    case 'media':
      toShell();
      shell.setCurrentView('home');
      shell.onModeChange(destination === 'code' ? 'develop' : 'media');
      return;
    case 'dots': {
      toShell();
      shell.onStudioExperienceChange('spark');
      shell.setCurrentView('home');
      // From Bots itself, the bots list; from anywhere else, the bot left open there.
      const bot = shell.current === 'dots' ? null : $railReturns.get().dots;
      if (bot) goToSparkDot(bot);
      else goToSparkDots();
      return;
    }
    case 'customize':
      if (shell.studioExperience === 'spark') shell.onStudioExperienceChange('chat');
      shell.setCurrentView('customize');
      return;
    case 'spark': {
      toShell();
      // From Spark itself, its home; from anywhere else, the page left open there.
      const page = shell.current === 'spark' ? null : $railReturns.get().spark;
      if (page && isSparkLocation(page)) navigateSpark(page);
      else goToSparkHome();
      shell.onStudioExperienceChange('spark');
    }
  }
};
