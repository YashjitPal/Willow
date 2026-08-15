import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { AuthProvider } from '@willow/auth/AuthContext';
import { GlobalTooltips } from '@willow/ui/Tooltip';
import { GlobalCopyToast } from '@willow/ui/CopyToast';
import { configureImageProxy } from '@willow/ui/image-source';
import { handleSpotifyCallback } from '@willow/personal';
// Side-effect import: lets features register with platform machinery before
// anything renders. Must stay above the render call.
import './app/register-features';

/*
 * The OAuth popup, handled before anything else exists.
 *
 * Spotify sends its consent popup back to `/oauth/spotify?code=…`, which the SPA
 * rewrite serves `index.html` — so without this check the popup would boot a second
 * complete copy of Willow to read two query parameters and close itself. Instead it
 * posts the code to the window that opened it and stops here.
 *
 * Above `configureImageProxy` and the render on purpose: everything below is setup
 * for a UI this window will never show.
 */
const isOAuthPopup = handleSpotifyCallback();

// Where remote images are fetched from. `platform/ui` reads no environment of
// its own — it also runs under Node in the test suite, where `import.meta.env`
// does not exist — so the app injects the endpoint once, here, before anything
// renders. Unset (the default, and the only option on a static host like GitHub
// Pages) means images load directly with no referer, which needs no server. Set
// to `/api/image` on Vercel to route them through `api/image.js`, which also
// requires `IMAGE_PROXY_HOSTS`. See platform/ui/src/image-source.ts.
configureImageProxy(import.meta.env.VITE_IMAGE_PROXY);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/*
 * Hands off from the static boot shell in `index.html` to the real app.
 *
 * The two frames matter. React's commit only puts nodes in the DOM; the browser
 * has not painted them yet, so fading the shell out on the commit alone
 * uncovers an empty `#root` for one frame — a black flash exactly where the
 * shell was supposed to prevent one. The first rAF fires before that paint, the
 * second after it, at which point the real chrome is genuinely on screen.
 *
 * `opacity` then `remove()`: the node has to survive its own 120ms transition,
 * and it stays interaction-inert throughout (`pointer-events: none` comes with
 * the dismissed state) so it cannot swallow a click aimed at the app beneath.
 *
 * Idempotent and self-cancelling — under StrictMode this runs twice in dev, and
 * the second pass finds nothing to do.
 */
const dismissBootShell = () => {
  const shell = document.getElementById('willow-boot');
  if (!shell || shell.dataset.dismissed === 'true') return;
  shell.dataset.dismissed = 'true';
  const remove = () => shell.remove();
  shell.addEventListener('transitionend', remove, { once: true });
  // Belt and braces: `transitionend` never fires if the transition is disabled
  // (reduced motion) or the tab is backgrounded mid-fade.
  window.setTimeout(remove, 400);
};

// Wrapped rather than returned early — a module has no top level to return from,
// and `if (isOAuthPopup) throw` would put a red error in the popup's console for a
// flow that worked. The popup has already posted its code and called `close()`;
// this branch is only what stops the closing window from mounting React first.
if (!isOAuthPopup) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      {/*
        Replaces the browser's native `title=` bubble with Gemini's tooltip
        app-wide. Mounted here rather than inside App so it survives every route,
        and outside the router because it needs neither. See platform/ui/Tooltip.
      */}
      <GlobalTooltips />
      {/*
        Gemini's "Copied to clipboard" snackbar. Mounted at the root for the same
        reason as the tooltips — it is raised from `features/chat` through a
        `platform/ui` store and rendered into its own overlay host on `<body>`,
        so it needs neither the router nor App state.
      */}
      <GlobalCopyToast />
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </React.StrictMode>
  );

  requestAnimationFrame(() => requestAnimationFrame(dismissBootShell));
}
