// Keeps a failure inside one of Media's full-page editors (the Scenebuilder, the image and video
// views, the character pages) from taking the whole app down with it. Without a boundary, React
// unmounts everything on an error in render — including an editor's code failing to load, which
// the dev server causes whenever it answers mid-edit — and the window goes blank.
import React from 'react';

/** The page's own copy of a module that failed to load stays failed until the page reloads. */
export const isChunkLoadError = (error: unknown): boolean =>
  error instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message);

export class EditorBoundary extends React.Component<
  { onError: (error: Error) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error('[media] An editor failed:', error);
    this.props.onError(error);
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
