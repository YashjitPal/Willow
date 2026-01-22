import * as esbuild from 'esbuild-wasm';

let esbuildInitialized = false;
let initializationPromise: Promise<void> | null = null;

export async function initBundler(): Promise<void> {
  // Already initialized
  if (esbuildInitialized) return;
  
  // Already initializing, wait for it
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      await esbuild.initialize({
        wasmURL: '/esbuild.wasm',
        worker: false
      });
      esbuildInitialized = true;
      console.log('[Bundler] Initialized successfully');
    } catch (error: any) {
      // "Already initialized" is not an error - it means HMR reloaded
      if (error.message?.includes('initialize') && error.message?.includes('once')) {
        console.log('[Bundler] Already initialized (HMR reload)');
        esbuildInitialized = true;
        return;
      }
      console.error('[Bundler] Init failed:', error);
      throw error;
    }
  })();
  return initializationPromise;
}

// Resolve a path relative to a directory
function resolvePath(importPath: string, fromDir: string): string {
  if (importPath.startsWith('/')) return importPath;
  
  if (importPath.startsWith('./')) {
    // Relative import: ./components/Header from /App.tsx (dir = /)
    const parts = fromDir.split('/').filter(Boolean);
    const importParts = importPath.slice(2).split('/');
    return '/' + [...parts, ...importParts].join('/');
  }
  
  if (importPath.startsWith('../')) {
    // Parent directory import
    const parts = fromDir.split('/').filter(Boolean);
    let remaining = importPath;
    while (remaining.startsWith('../')) {
      parts.pop();
      remaining = remaining.slice(3);
    }
    return '/' + [...parts, ...remaining.split('/')].filter(Boolean).join('/');
  }
  
  // Bare import (module name)
  return importPath;
}

// Get directory from file path
function getDir(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

// Find file with extensions
function findFile(files: Record<string, string>, basePath: string): string | null {
  const extensions = ['', '.tsx', '.ts', '.jsx', '.js', '.css', '/index.tsx', '/index.ts', '/index.js'];
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (files[fullPath]) return fullPath;
  }
  return null;
}

const createVirtualFsPlugin = (files: Record<string, string>) => ({
  name: 'virtual-fs',
  setup(build: esbuild.PluginBuild) {
    const fileKeys = Object.keys(files);
    console.log('[Bundler Plugin] Available files:', fileKeys);
    
    // Handle external packages (react, react-dom)
    build.onResolve({ filter: /^(react|react-dom)$/ }, (args) => {
      return { path: args.path, external: true };
    });

    // Handle entry point
    build.onResolve({ filter: /^__entry__$/ }, () => {
      return { path: '__entry__', namespace: 'entry' };
    });

    // Handle all other imports
    build.onResolve({ filter: /.*/ }, (args) => {
      // Skip if already in entry namespace resolving to virtual-fs
      if (args.namespace === 'entry') {
        const resolved = findFile(files, args.path.startsWith('/') ? args.path : '/' + args.path);
        if (resolved) {
          console.log('[Bundler] Entry resolved:', args.path, '->', resolved);
          return { path: resolved, namespace: 'virtual-fs' };
        }
      }
      
      if (args.namespace === 'virtual-fs') {
        const fromDir = args.importer ? getDir(args.importer) : '/';
        const resolvedPath = resolvePath(args.path, fromDir);
        const found = findFile(files, resolvedPath);
        
        if (found) {
          console.log('[Bundler] Resolved:', args.path, 'from', args.importer, '->', found);
          return { path: found, namespace: 'virtual-fs' };
        }
        
        // If it's a relative import and not found, this is an error
        if (args.path.startsWith('./') || args.path.startsWith('../') || args.path.startsWith('/')) {
          console.error('[Bundler] FAILED to resolve:', args.path, 'from', args.importer);
          console.error('[Bundler] Tried path:', resolvedPath);
          console.error('[Bundler] Available files:', fileKeys);
          // Return an error loader
          return {
            path: args.path,
            namespace: 'missing-file',
          };
        }
      }
      
      // Non-relative imports that aren't react/react-dom - mark as external
      console.warn('[Bundler] External module:', args.path);
      return { path: args.path, external: true };
    });
    
    // Handler for missing files - returns error component
    build.onLoad({ filter: /.*/, namespace: 'missing-file' }, (args) => {
      return {
        contents: `
          export default function MissingComponent() {
            return React.createElement('div', {
              style: { color: 'red', padding: '20px', background: '#1f2937' }
            }, 'Error: Could not find module "${args.path}"');
          }
        `,
        loader: 'tsx',
      };
    });

    // Load entry point
    build.onLoad({ filter: /.*/, namespace: 'entry' }, () => {
      const entryPaths = ['/App.tsx', '/App.jsx', '/App.js', '/src/App.tsx'];
      const entry = entryPaths.find(p => files[p]);
      
      if (!entry) {
        const available = Object.keys(files).join(', ');
        throw new Error(`No App.tsx found. Available: ${available}`);
      }
      
      console.log('[Bundler] Entry point:', entry);

      return {
        contents: `
          import App from '${entry}';
          import React from 'react';
          import ReactDOM from 'react-dom';
          
          window.__renderApp = function() {
            console.log('[Preview] Rendering App...', typeof App, App);
            
            // Validate App is a valid component
            if (typeof App !== 'function' && typeof App !== 'object') {
              console.error('[Preview] Invalid App:', App);
              document.getElementById('root').innerHTML = 
                '<div class="error-display">Error: App is not a valid component. Got: ' + typeof App + '</div>';
              return;
            }
            
            // Handle case where App might be { default: Component }
            const AppComponent = App.default || App;
            
            if (typeof AppComponent !== 'function') {
              console.error('[Preview] AppComponent is not a function:', AppComponent);
              document.getElementById('root').innerHTML = 
                '<div class="error-display">Error: App component is not a function. Check your export.</div>';
              return;
            }
            
            try {
              const root = ReactDOM.createRoot(document.getElementById('root'));
              const wrapped = React.createElement(window.ErrorBoundary || React.Fragment, null, 
                React.createElement(AppComponent)
              );
              root.render(wrapped);
              console.log('[Preview] App rendered successfully');
            } catch (e) {
              console.error('[Preview] Render error:', e);
              document.getElementById('root').innerHTML = '<div class="error-display">' + e.stack + '</div>';
            }
          };
        `,
        loader: 'tsx',
      };
    });

    // Load virtual files
    build.onLoad({ filter: /.*/, namespace: 'virtual-fs' }, (args) => {
      const content = files[args.path];
      if (content === undefined) {
        throw new Error(`File not found: ${args.path}`);
      }
      
      // CSS files - inject as style tag
      if (args.path.endsWith('.css')) {
        return {
          contents: `
            const style = document.createElement('style');
            style.textContent = ${JSON.stringify(content)};
            document.head.appendChild(style);
          `,
          loader: 'js',
        };
      }
      
      return { contents: content, loader: 'tsx' };
    });
  },
});

export async function bundleFiles(files: Record<string, string>): Promise<string> {
  await initBundler();
  
  console.log('[Bundler] Building with files:', Object.keys(files));
  
  try {
    const result = await esbuild.build({
      entryPoints: ['__entry__'],
      bundle: true,
      write: false,
      plugins: [createVirtualFsPlugin(files)],
      define: { 'process.env.NODE_ENV': '"production"' },
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      format: 'iife',
      globalName: '__Bundle',
      logLevel: 'warning',
    });

    console.log('[Bundler] Build successful, output size:', result.outputFiles[0].text.length);
    return result.outputFiles[0].text;
  } catch (err: any) {
    console.error('[Bundler] Build failed:', err);
    throw err;
  }
}

export function generatePreviewHTML(scriptCode: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18.2.0/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.development.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { min-height: 100vh; background: transparent; color: white; font-family: system-ui, -apple-system, sans-serif; }
    #root { min-height: 100vh; }
    
    /* Beautiful Error UI */
    .error-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: transparent;
    }
    .error-card {
      max-width: 480px;
      width: 100%;
      background: rgba(15, 15, 20, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 
        0 4px 24px rgba(0, 0, 0, 0.4),
        0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    }
    .error-icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.05));
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .error-icon svg {
      width: 28px;
      height: 28px;
      color: #f87171;
    }
    .error-title {
      font-size: 18px;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .error-subtitle {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 20px;
    }
    .error-message {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 16px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
      color: #f87171;
      line-height: 1.6;
      overflow-x: auto;
      max-height: 200px;
      overflow-y: auto;
      word-break: break-word;
    }
    .error-message::-webkit-scrollbar { width: 6px; height: 6px; }
    .error-message::-webkit-scrollbar-track { background: transparent; }
    .error-message::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    // Error display function
    function showError(type, message) {
      document.getElementById('root').innerHTML = \`
        <div class="error-container">
          <div class="error-card">
            <div class="error-icon">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 class="error-title">\${type}</h2>
            <p class="error-subtitle">Something went wrong while rendering your app</p>
            <div class="error-message">\${message}</div>
          </div>
        </div>
      \`;
    }

    // Polyfill require for bundled code
    window.require = function(m) {
      if (m === 'react') return window.React;
      if (m === 'react-dom') return window.ReactDOM;
      console.warn('[Preview] Unknown module:', m);
      return new Proxy({}, {
        get: (_, prop) => function() {
          return React.createElement('span', {
            style: { color: '#f87171', fontSize: '12px' }
          }, '⚠️ ' + m + '.' + String(prop));
        }
      });
    };
    
    // Error Boundary
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, info) {
        console.error('React Error:', error, info);
      }
      render() {
        if (this.state.hasError) {
          showError('React Error', this.state.error?.message || String(this.state.error));
          return null;
        }
        return this.props.children;
      }
    }
    window.ErrorBoundary = ErrorBoundary;
    
    // Global error handler
    window.onerror = function(msg) {
      showError('Runtime Error', msg);
      return true;
    };
    
    try {
      ${scriptCode}
      if (window.__renderApp) {
        window.__renderApp();
      } else {
        showError('Initialization Error', '__renderApp function not defined');
      }
    } catch (err) {
      console.error('Script error:', err);
      showError('Script Error', err.message || String(err));
    }
  </script>
</body>
</html>`;
}

export async function createPreviewURL(files: Record<string, string>): Promise<string> {
  try {
    const code = await bundleFiles(files);
    const html = generatePreviewHTML(code);
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  } catch (err: any) {
    console.error('[Bundler] createPreviewURL failed:', err);
    // Return beautiful error page
    const errorHtml = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      min-height: 100vh; 
      background: transparent; 
      display: flex; 
      align-items: center; 
      justify-content: center;
      padding: 24px;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .error-card {
      max-width: 480px;
      width: 100%;
      background: rgba(15, 15, 20, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    }
    .error-icon {
      width: 56px; height: 56px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.05));
      border-radius: 16px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 20px;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .error-title { font-size: 18px; font-weight: 600; color: #fff; margin-bottom: 8px; }
    .error-subtitle { font-size: 14px; color: rgba(255,255,255,0.5); margin-bottom: 20px; }
    .error-message {
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      padding: 16px;
      font-family: monospace;
      font-size: 13px;
      color: #f87171;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="error-icon">
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#f87171">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    </div>
    <h2 class="error-title">Build Error</h2>
    <p class="error-subtitle">Failed to compile your code</p>
    <div class="error-message">${err.message || err}</div>
  </div>
</body>
</html>`;
    const blob = new Blob([errorHtml], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }
}

export const transpile = async () => { throw new Error('Deprecated'); };
