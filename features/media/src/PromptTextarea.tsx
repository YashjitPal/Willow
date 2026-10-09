// The boundary other controls use to read the composer's prompt.
//
// MediaView owns the prompt as a store rather than as state, because MediaView renders the
// whole Media page inline: as state, every keystroke re-rendered all of it. Subscribe through
// `PromptValue` (or the field itself, PromptEditor.tsx) and never in MediaView's own render, or a
// keystroke re-renders the page again.

import React from 'react';
import { useStore } from '@nanostores/react';
import type { WritableAtom } from 'nanostores';

export type PromptStore = WritableAtom<string>;

/** Hands `children` the current prompt, re-rendering only this subtree when it changes. */
export function PromptValue({
  store,
  children,
}: {
  store: PromptStore;
  children: (prompt: string) => React.ReactNode;
}) {
  const prompt = useStore(store);
  return <>{children(prompt)}</>;
}
