import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { AuthProvider } from '@willow/auth/AuthContext';
import { GlobalTooltips } from '@willow/ui/Tooltip';
import { configureImageProxy } from '@willow/ui/image-source';
// Side-effect import: lets features register with platform machinery before
// anything renders. Must stay above the render call.
import './app/register-features';

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

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/*
      Replaces the browser's native `title=` bubble with Gemini's tooltip
      app-wide. Mounted here rather than inside App so it survives every route,
      and outside the router because it needs neither. See platform/ui/Tooltip.
    */}
    <GlobalTooltips />
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
