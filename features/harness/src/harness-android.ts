/**
 * Agent tabs on Willow's Android app, which has no rail: the sidebar opens them (apps/studio
 * Sidebar), and Android's back gesture closes the one in front, after it has gone back through
 * the agents' own pages, whose history the app's WebView shares with this page.
 */
import { isAndroidApp } from '@willow/core/android-bridge';
import { $harnessTab, closeHarnessTab } from './harness-store';

const MARK = 'willowAgentTab';

const marked = () => (window.history.state as Record<string, unknown> | null)?.[MARK] === true;

export function followAndroidBack(): () => void {
  if (!isAndroidApp()) return () => undefined;
  // The router's own state is kept on the entry, so going back reads as staying put to it.
  const unsubscribe = $harnessTab.subscribe((tab) => {
    if (tab !== null && !marked()) {
      window.history.pushState({ ...((window.history.state as object | null) ?? {}), [MARK]: true }, '');
    }
  });
  const onPop = () => {
    if (!marked() && $harnessTab.get() !== null) closeHarnessTab();
  };
  window.addEventListener('popstate', onPop);
  return () => {
    unsubscribe();
    window.removeEventListener('popstate', onPop);
  };
}
