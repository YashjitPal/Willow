// React.lazy for a page that has to open on the frame it is asked for. `preload()` fetches the chunk
// ahead of time; once it has arrived the page renders directly instead of suspending, which plain
// React.lazy does on its first render even when the module is already in memory.
import React from 'react';

export type PreloadableLazy<P extends object> = React.FC<P> & { preload: () => Promise<void> };

export function preloadableLazy<P extends object>(load: () => Promise<{ default: React.ComponentType<P> }>): PreloadableLazy<P> {
  let loaded: React.ComponentType<P> | undefined;
  let pending: Promise<void> | undefined;
  const fetchModule = () => (pending ??= load().then(
    (module) => { loaded = module.default; },
    (error: unknown) => { pending = undefined; throw error; },
  ));
  const Lazy = React.lazy(async () => {
    await fetchModule();
    return { default: loaded as React.ComponentType<P> };
  });
  const Page = (props: P) => {
    const Component = (loaded ?? Lazy) as React.ComponentType<P>;
    return <Component {...props} />;
  };
  // Settles either way: a failed fetch is reported by the page itself when it renders.
  return Object.assign(Page, { preload: () => fetchModule().catch(() => {}) });
}
