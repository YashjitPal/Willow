import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { atom, type WritableAtom } from 'nanostores';
import { TestStore } from '@willow/ai/computer-use/test-store';
import { clearPreviewErrors } from '@willow/core/error-store';
import { SandpackStore } from '../runtime/sandpack/sandpack-store';
import { createHarnessStore, type HarnessStore } from '../harness/harness-store';
import { createPreviewControl, type PreviewControl } from '../workbench/preview-control';

/**
 * Everything one Code screen owns: its files, the live transcript of its turn,
 * what its turn asks of its preview, and its testing overlay.
 *
 * Each screen has its own — the Code home and every open project — so several
 * can be mounted at once, and a turn running in a hidden one never writes into
 * the one on show.
 *
 * A screen's root makes it (`useCodeScreenSession`) and provides it to the
 * screen's tree through `CodeSessionContext`; code outside React (the harness,
 * the preview session) is handed it.
 */
export interface CodeSession {
  /** The shell's name for the screen (`apps/studio` App.tsx). */
  readonly screenKey: string;
  readonly workbench: SandpackStore;
  readonly harness: HarnessStore;
  readonly preview: PreviewControl;
  readonly test: TestStore;
  /** False while the screen is hidden: it keeps working, but takes no input. */
  readonly onShow: WritableAtom<boolean>;
  /** Bumped by this screen's New chat button; its sidebar starts over. */
  readonly newChat: WritableAtom<number>;
}

export const createCodeSession = (screenKey: string, isOnShow = false): CodeSession => {
  const onShow = atom(isOnShow);
  return {
    screenKey,
    workbench: new SandpackStore(),
    harness: createHarnessStore(() => onShow.get()),
    preview: createPreviewControl(),
    test: new TestStore(),
    onShow,
    newChat: atom(0),
  };
};

export const CodeSessionContext = createContext<CodeSession | null>(null);

export const useCodeSession = (): CodeSession => {
  const session = useContext(CodeSessionContext);
  if (!session) throw new Error('A Code screen rendered outside its CodeSessionContext.');
  return session;
};

/**
 * The Code screen last on show, while it is mounted. Visual editing acts on
 * it: it is the one the user was looking at, and a hidden screen takes no input.
 */
export const $activeCodeSession = atom<CodeSession | null>(null);

/* Never written: what visual editing reads while no Code screen is mounted. */
const idleWorkbench = new SandpackStore();

/** The files of the active screen, for the visual-editing engine. */
export const activeWorkbench = (): SandpackStore => $activeCodeSession.get()?.workbench ?? idleWorkbench;

/**
 * Bumped when a different screen comes on show than the one last on show. The
 * preview's problems list and visual editing's undo history are one per tab,
 * and were the previous screen's.
 */
export const $codeScreenSwitches = atom(0);

let lastShown: WeakRef<CodeSession> | null = null;
$activeCodeSession.listen((session) => {
  if (!session || lastShown?.deref() === session) return;
  const switched = lastShown !== null;
  lastShown = new WeakRef(session);
  if (!switched) return;
  clearPreviewErrors();
  $codeScreenSwitches.set($codeScreenSwitches.get() + 1);
});

/**
 * A message from this screen's preview: posted by its frame, or a build error
 * its own preview build posted to this window (`BundleOptions.screen`). Every
 * mounted screen hears every frame's messages.
 */
export const isOwnPreviewMessage = (session: CodeSession, event: MessageEvent): boolean =>
  event.source === session.test.getIframeRef()?.contentWindow
  || (event.source === window && (event.data as { screen?: unknown } | null)?.screen === session.screenKey);

/** A screen root's session, for as long as the root is mounted. */
export function useCodeScreenSession(screenKey: string, isOnShow: boolean): CodeSession {
  const [session] = useState(() => createCodeSession(screenKey, isOnShow));
  useLayoutEffect(() => {
    session.onShow.set(isOnShow);
    if (isOnShow) $activeCodeSession.set(session);
  }, [session, isOnShow]);
  useLayoutEffect(() => () => {
    if ($activeCodeSession.get() === session) $activeCodeSession.set(null);
  }, [session]);
  return session;
}
