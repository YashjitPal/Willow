import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { AuthProvider } from '@willow/auth/AuthContext';
import { GlobalTooltips } from '@willow/ui/Tooltip';
// Side-effect import: lets features register with platform machinery before
// anything renders. Must stay above the render call.
import './app/register-features';

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
