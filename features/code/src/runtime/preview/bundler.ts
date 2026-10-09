import * as esbuild from 'esbuild-wasm';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import {
  CDN_NAMESPACE,
  PackageFetchError,
  RUNTIME_PROVIDED,
  collectPackageImports,
  cssModule,
  describeUrl,
  fetchModule,
  isNodeBuiltin,
  packageUrl,
  readProjectDependencies,
  resolveCdnImport,
} from './packages';

let esbuildInitialized = false;
let initializationPromise: Promise<void> | null = null;

export async function initBundler(): Promise<void> {
  // Already initialized
  if (esbuildInitialized) return;
  
  // Already initializing, wait for it
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      // Node (the test runner) finds the wasm itself and rejects `wasmURL`.
      await esbuild.initialize(
        typeof window === 'undefined' ? { worker: false } : { wasmURL: esbuildWasmUrl, worker: false },
      );
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
      initializationPromise = null;
      throw error;
    }
  })();
  return initializationPromise;
}

export interface BundleOptions {
  /** Tag JSX with `data-willow-source` for visual editing. */
  injectSourceLocations?: boolean;
  /**
   * Fail the build on a missing project file or a Node built-in instead of
   * rendering a placeholder. The harness checks with this on; the live preview
   * keeps the forgiving behaviour so a half-finished project still renders.
   */
  strict?: boolean;
  /**
   * The Code screen building, named in the build errors posted to this window,
   * so each screen's preview reports its own (`isOwnPreviewMessage`).
   */
  screen?: string;
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

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.avif', '.tiff', '.heic', '.heif', '.apng', '.jfif', '.pjpeg', '.pjp', '.cur'];

// Find file with extensions
function findFile(files: Record<string, string>, basePath: string): string | null {
  const extensions = [
    '', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '.css',
    ...IMAGE_EXTENSIONS,
    '/index.tsx', '/index.ts', '/index.jsx', '/index.js'
  ];
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (files[fullPath] !== undefined) return fullPath;
  }
  return null;
}

/**
 * `@/components/Button` and `~/lib/utils`, the aliases shadcn-style projects use.
 *
 * Both mean "from the project root" here. A project that keeps its sources under
 * `/src/` is tried second, so an imported project resolves either way.
 */
function resolveAlias(files: Record<string, string>, specifier: string): string | null {
  const match = /^[@~]\/(.*)$/.exec(specifier);
  if (!match) return null;
  return findFile(files, `/${match[1]}`) ?? findFile(files, `/src/${match[1]}`);
}

const createVirtualFsPlugin = (files: Record<string, string>, options: BundleOptions = {}) => ({
  name: 'virtual-fs',
  setup(build: esbuild.PluginBuild) {
    const injectSourceLocations = options.injectSourceLocations ?? false;
    const strict = options.strict ?? false;
    const fileKeys = Object.keys(files);
    const dependencies = readProjectDependencies(files);
    const packageImports = collectPackageImports(files);
    console.log('[Bundler Plugin] Available files:', fileKeys);
    
    // React and React DOM are the preview page's own UMD globals.
    build.onResolve({ filter: RUNTIME_PROVIDED }, (args) => {
      return { path: args.path, external: true };
    });

    // Handle entry point
    build.onResolve({ filter: /^__entry__$/ }, () => {
      return { path: '__entry__', namespace: 'entry' };
    });

    // Imports found inside a module that came from the CDN.
    build.onResolve({ filter: /.*/, namespace: CDN_NAMESPACE }, (args) => {
      const importer = (args.pluginData as { url?: string } | undefined)?.url ?? args.importer;
      return { path: resolveCdnImport(args.path, importer), namespace: CDN_NAMESPACE };
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
        const aliased = resolveAlias(files, args.path);
        if (aliased) return { path: aliased, namespace: 'virtual-fs' };

        const fromDir = args.importer ? getDir(args.importer) : '/';
        const resolvedPath = resolvePath(args.path, fromDir);
        const found = findFile(files, resolvedPath);
        
        if (found) {
          console.log('[Bundler] Resolved:', args.path, 'from', args.importer, '->', found);
          return { path: found, namespace: 'virtual-fs' };
        }
        
        // If it's a relative import and not found, this is an error
        const isLocal = args.path.startsWith('./') || args.path.startsWith('../') || args.path.startsWith('/') || /^[@~]\//.test(args.path);
        if (isLocal) {
          if (strict) {
            return {
              errors: [{
                text: `Could not resolve "${args.path}" from ${args.importer}: no such file in the project.`,
              }],
            };
          }
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

      if (isNodeBuiltin(args.path)) {
        if (strict) {
          return {
            errors: [{
              text: `"${args.path}" is a Node.js module. The preview runs in a browser, where it does not exist.`,
            }],
          };
        }
        console.warn('[Bundler] External module:', args.path);
        return { path: args.path, external: true };
      }

      // Any other bare import is an npm package, fetched from the CDN.
      return {
        path: packageUrl(args.path, dependencies, packageImports),
        namespace: CDN_NAMESPACE,
      };
    });

    build.onLoad({ filter: /.*/, namespace: CDN_NAMESPACE }, async (args) => {
      try {
        const module = await fetchModule(args.path);
        const pathname = new URL(module.url).pathname;
        if (/\.css$/i.test(pathname)) {
          return { contents: cssModule(module.contents, module.url), loader: 'js', pluginData: { url: module.url } };
        }
        if (/\.json$/i.test(pathname)) {
          return { contents: module.contents, loader: 'json', pluginData: { url: module.url } };
        }
        return { contents: module.contents, loader: 'js', pluginData: { url: module.url } };
      } catch (error) {
        const message = error instanceof PackageFetchError
          ? error.message
          : `Could not load ${describeUrl(args.path)}: ${(error as Error).message}`;
        return { errors: [{ text: message }] };
      }
    });

    // Handler for missing files - returns error component
    build.onLoad({ filter: /.*/, namespace: 'missing-file' }, (args) => {
      return {
        contents: `
          export default function MissingComponent() {
            return React.createElement('div', {
              style: { color: 'red', padding: '20px', background: '#1f2937' }
            }, 'Error: Could not find module ${JSON.stringify(args.path).slice(1, -1)}');
          }
        `,
        loader: 'tsx',
      };
    });

    // Load entry point
    build.onLoad({ filter: /.*/, namespace: 'entry' }, () => {
      const entryPaths = ['/App.tsx', '/App.jsx', '/App.js', '/src/App.tsx', '/src/App.jsx'];
      const entry = entryPaths.find(p => files[p] !== undefined);
      
      if (!entry) {
        const available = Object.keys(files).join(', ');
        throw new Error(`No App.tsx found. Available: ${available}`);
      }
      
      console.log('[Bundler] Entry point:', entry);

      // Interpolated so a loader that rewrites import specifiers in source text
      // (the test runner's) leaves this generated module alone.
      const react = 'react';
      const reactDom = 'react-dom';

      return {
        contents: `
          import App from '${entry}';
          import React from '${react}';
          import ReactDOM from '${reactDom}';
          
          // Cache the React root for reuse across hot updates
          window.__reactRoot = null;
          
          window.__renderApp = function() {
            console.log('[Preview] Rendering App...', typeof App, App);
            
            // Validate App is a valid component
            if (typeof App !== 'function' && typeof App !== 'object') {
              console.error('[Preview] Invalid App:', App);
              showError('Component Error', 'App is not a valid component. Got: ' + typeof App);
              return;
            }
            
            // Handle case where App might be { default: Component }
            const AppComponent = App.default || App;
            
            if (typeof AppComponent !== 'function' && !(AppComponent && AppComponent.$$typeof)) {
              console.error('[Preview] AppComponent is not a function:', AppComponent);
              showError('Component Error', 'App component is not a function. Check your export.');
              return;
            }
            
            try {
              // Reuse existing root if available, otherwise create new one
              // This prevents full remount on hot updates, preserving scroll and avoiding animation replay
              if (!window.__reactRoot) {
                window.__reactRoot = ReactDOM.createRoot(document.getElementById('root'));
              }
              const wrapped = React.createElement(window.ErrorBoundary || React.Fragment, null, 
                React.createElement(AppComponent)
              );
              window.__reactRoot.render(wrapped);
              console.log('[Preview] App rendered successfully');
            } catch (e) {
              console.error('[Preview] Render error:', e);
              showError('Render Error', e.message || String(e));
              // Clear cached root on error so next render creates fresh one
              window.__reactRoot = null;
            }
          };
        `,
        loader: 'tsx',
      };
    });

    // Load virtual files
    build.onLoad({ filter: /.*/, namespace: 'virtual-fs' }, async (args) => {
      const content = files[args.path];
      if (content === undefined) {
        throw new Error(`File not found: ${args.path}`);
      }

      const lowerPath = args.path.toLowerCase();

      // Image files - export data URL as default export
      if (IMAGE_EXTENSIONS.some(ext => lowerPath.endsWith(ext))) {
        // An SVG written as markup rather than uploaded as a data URL still has
        // to be usable as an <img src>.
        const trimmed = content.trimStart();
        const value = lowerPath.endsWith('.svg') && (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml'))
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
          : content;
        return {
          contents: `export default ${JSON.stringify(value)};`,
          loader: 'js',
        };
      }

      if (lowerPath.endsWith('.json')) {
        return { contents: content, loader: 'json' };
      }

      if (lowerPath.endsWith('.md') || lowerPath.endsWith('.txt')) {
        return { contents: content, loader: 'text' };
      }

      // CSS files - inject as style tag
      if (lowerPath.endsWith('.css')) {
        return {
          contents: `
            const style = document.createElement('style');
            style.textContent = ${JSON.stringify(content)};
            document.head.appendChild(style);
          `,
          loader: 'js',
        };
      }

      // ✨ NEW: Apply Babel source location injection for TSX/JSX files
      if (injectSourceLocations && (args.path.endsWith('.tsx') || args.path.endsWith('.jsx'))) {
        try {
          // Normalize file name (remove leading slash for display)
          const fileName = args.path.startsWith('/') ? args.path.substring(1) : args.path;

          // Babel is only needed for visual editing, so it loads on first use.
          const { injectSourceLocations: injectSourceLocationsToCode } = await import('./babel-source-plugin');
          const augmentedCode = injectSourceLocationsToCode(content, fileName);

          return {
            contents: augmentedCode,
            loader: 'tsx'
          };
        } catch (error) {
          // Fallback to original content if Babel fails
          console.error('[Bundler] Babel transform failed for', args.path, ':', error);
          return { contents: content, loader: 'tsx' };
        }
      }

      return { contents: content, loader: 'tsx' };
    });
  },
});

export async function bundleFiles(
  files: Record<string, string>,
  options: BundleOptions = {}
): Promise<string> {
  await initBundler();

  console.log('[Bundler] Building with files:', Object.keys(files));

  try {
    const result = await esbuild.build({
      entryPoints: ['__entry__'],
      bundle: true,
      write: false,
      plugins: [createVirtualFsPlugin(files, options)],
      define: {
        'process.env.NODE_ENV': '"production"',
        'process.env': '{}',
        'import.meta.env': '{"MODE":"production","DEV":false,"PROD":true}',
      },
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      format: 'iife',
      globalName: '__Bundle',
      logLevel: 'warning',
      logLimit: 0,
    });

    console.log('[Bundler] Build successful, output size:', result.outputFiles[0].text.length);
    return result.outputFiles[0].text;
  } catch (err: any) {
    // A strict build is the harness checking the model's work; its failure is
    // the result, handed back to the model, not an app error.
    if (!options.strict) console.error('[Bundler] Build failed:', err);
    throw err;
  }
}

// Default shadcn/ui CSS variables for the preview
// These provide baseline theme colors that can be read by the visual editor
const DEFAULT_THEME_CSS = `
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.5rem;
    --warning: 38 92% 50%;
    --warning-foreground: 0 0% 100%;
    --success: 142 76% 36%;
    --success-foreground: 0 0% 100%;
    --sidebar: 0 0% 98%;
    --sidebar-foreground: 240 5.3% 26.1%;
    --sidebar-primary: 240 5.9% 10%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 4.8% 95.9%;
    --sidebar-accent-foreground: 240 5.9% 10%;
    --sidebar-border: 240 5.9% 90%;
    --sidebar-ring: 240 5.9% 10%;
  }

  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 240 10% 3.9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 240 4.9% 83.9%;
    --warning: 38 92% 50%;
    --warning-foreground: 0 0% 100%;
    --success: 142 76% 36%;
    --success-foreground: 0 0% 100%;
    --sidebar: 240 5.9% 10%;
    --sidebar-foreground: 240 4.8% 95.9%;
    --sidebar-primary: 224.3 76.3% 48%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 240 4.8% 95.9%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
  }
`;

export interface PreviewHTMLOptions {
  /**
   * The `type` of the message an error is posted to the parent with.
   *
   * The live preview uses `PREVIEW_ERROR`, which the workbench turns into toasts
   * and the error panel. The harness's own runtime check renders the same page
   * in a hidden frame, and must not raise toasts for a build the user has not
   * seen yet, so it listens on a channel of its own.
   */
  errorMessageType?: string;
  /** Extra script run before anything else in the page. */
  headScript?: string;
}

export function generatePreviewHTML(scriptCode: string, customThemeCSS?: string, options: PreviewHTMLOptions = {}): string {
  // Merge custom theme CSS with defaults (custom takes precedence via CSS cascade)
  const themeCSS = customThemeCSS
    ? `${DEFAULT_THEME_CSS}\n/* Custom theme overrides */\n${customThemeCSS}`
    : DEFAULT_THEME_CSS;
  const errorMessageType = JSON.stringify(options.errorMessageType ?? 'PREVIEW_ERROR');
  const headScript = options.headScript ? `<script>${options.headScript.replace(/<\/script/gi, '<\\/script')}</script>` : '';

  return `<!DOCTYPE html>
<html class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${headScript}
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18.2.0/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.development.js"></script>
  <style data-template>
    /* Theme CSS Variables */
    ${themeCSS}

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { min-height: 100vh; background: hsl(var(--background)); color: hsl(var(--foreground)); font-family: system-ui, -apple-system, sans-serif; }
    #root { min-height: 100vh; }
    
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    // Error display function
    function showError(type, message) {
      // Notify parent window (for popup display and visual editor exit)
      try {
        window.parent.postMessage({ type: ${errorMessageType}, errorType: type, message: message }, '*');
      } catch (e) {}
    }

    // The automatic JSX runtime, for packages compiled against it.
    var __jsxRuntime = {
      Fragment: React.Fragment,
      jsx: function(type, props, key) {
        var config = props || {};
        if (key !== undefined) { config = Object.assign({}, config, { key: key }); }
        return React.createElement(type, config);
      }
    };
    __jsxRuntime.jsxs = __jsxRuntime.jsx;
    __jsxRuntime.jsxDEV = __jsxRuntime.jsx;

    // Modules the page provides; everything else is bundled in.
    var __providedModules = {
      'react': window.React,
      'react-dom': window.ReactDOM,
      'react-dom/client': window.ReactDOM,
      'react/jsx-runtime': __jsxRuntime,
      'react/jsx-dev-runtime': __jsxRuntime
    };

    // Polyfill require for bundled code
    window.require = function(m) {
      if (Object.prototype.hasOwnProperty.call(__providedModules, m)) return __providedModules[m];
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

    // ✨ HOT UPDATE LISTENER - Allows instant preview updates without iframe reload
    // Used by visual editing to apply changes without page refresh
    window.__hotUpdateReady = false;
    window.__applyHotUpdate = function(newScriptCode) {
      console.log('[Preview] Applying hot update...');
      try {
        // Capture scroll position BEFORE any DOM changes
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        // Remove dynamically injected styles (from CSS imports in the bundle)
        // Keep the template style (marked with data-template attribute)
        document.querySelectorAll('head style:not([data-template])').forEach(s => s.remove());

        // Remove old bundle script if exists
        const oldScript = document.getElementById('__bundle_script');
        if (oldScript) oldScript.remove();

        // Create and inject new script
        // NOTE: We do NOT clear root.innerHTML - React will take over naturally
        // This prevents the page from collapsing to zero height and resetting scroll
        const script = document.createElement('script');
        script.id = '__bundle_script';
        script.textContent = newScriptCode;
        document.body.appendChild(script);

        // Re-render the app
        if (window.__renderApp) {
          window.__renderApp();
          console.log('[Preview] Hot update applied successfully');

          // Restore scroll position with multiple attempts
          // React rendering is async, so we need to wait for content to be tall enough
          const restoreScroll = (attempt) => {
            if (attempt > 10) {
              console.log('[Preview] Scroll restore: gave up after 10 attempts');
              return;
            }

            // Check if document is tall enough to scroll to the target position
            const maxScrollY = document.documentElement.scrollHeight - window.innerHeight;
            if (scrollY <= maxScrollY || attempt > 5) {
              window.scrollTo(scrollX, scrollY);
              // Verify scroll was applied
              if (Math.abs(window.scrollY - scrollY) < 5 || scrollY <= maxScrollY) {
                console.log('[Preview] Scroll restored to:', scrollX, scrollY);
                return;
              }
            }

            // Content not ready yet, try again
            requestAnimationFrame(() => restoreScroll(attempt + 1));
          };

          requestAnimationFrame(() => restoreScroll(0));

          // Notify parent that hot update is complete
          window.parent.postMessage({ type: 'HOT_UPDATE_COMPLETE' }, '*');
          return true;
        } else {
          showError('Hot Update Error', '__renderApp function not defined after update');
          return false;
        }
      } catch (err) {
        console.error('[Preview] Hot update error:', err);
        showError('Hot Update Error', err.message || String(err));
        window.parent.postMessage({ type: 'HOT_UPDATE_ERROR', message: err.message }, '*');
        return false;
      }
    };

    // Listen for hot update messages from parent
    window.addEventListener('message', function(event) {
      if (event.data?.type === 'HOT_UPDATE') {
        console.log('[Preview] Received hot update message');
        window.__applyHotUpdate(event.data.scriptCode);
      }
    });

    window.__hotUpdateReady = true;

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

// Extract CSS variable definitions from project CSS files
export function extractThemeCSSFromFiles(files: Record<string, string>): string | undefined {
  // Look for common CSS files that might contain theme variables
  const cssFilePatterns = [
    '/globals.css',
    '/index.css',
    '/styles.css',
    '/app.css',
    '/src/globals.css',
    '/src/index.css',
    '/src/styles.css',
    '/src/app.css',
  ];

  const cssContents: string[] = [];

  // Check for known CSS files
  for (const pattern of cssFilePatterns) {
    if (files[pattern]) {
      cssContents.push(files[pattern]);
    }
  }

  // Also find any other CSS files that might have :root or .dark selectors
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.css') && !cssFilePatterns.includes(path)) {
      // Only include if it has CSS variable definitions
      if (content.includes('--') && (content.includes(':root') || content.includes('.dark'))) {
        cssContents.push(content);
      }
    }
  }

  if (cssContents.length === 0) {
    return undefined;
  }

  return cssContents.join('\n\n');
}

export async function createPreviewURL(
  files: Record<string, string>,
  options: BundleOptions = {}
): Promise<string> {
  try {
    const code = await bundleFiles(files, options);
    // Extract custom theme CSS from project files
    const customThemeCSS = extractThemeCSSFromFiles(files);
    const html = generatePreviewHTML(code, customThemeCSS);
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  } catch (err: any) {
    console.error('[Bundler] createPreviewURL failed:', err);
    // Post each error to the parent window so the error panel picks them up
    const errors = err.errors || [];
    if (errors.length > 0) {
      for (const e of errors) {
        const loc = e.location ? `${e.location.file}:${e.location.line}:${e.location.column}` : '';
        const msg = loc ? `${loc}: ${e.text}` : e.text;
        window.postMessage({ type: 'PREVIEW_ERROR', errorType: 'Build Error', message: msg, screen: options.screen }, '*');
      }
    } else {
      window.postMessage({ type: 'PREVIEW_ERROR', errorType: 'Build Error', message: err.message || String(err), screen: options.screen }, '*');
    }
    // Return a minimal blank page so preview isn't completely empty
    const fallbackHtml = `<!DOCTYPE html>
<html><head><style>*{margin:0;padding:0;box-sizing:border-box;}body{min-height:100vh;background:#1c1c1c;}</style></head>
<body></body></html>`;
    const blob = new Blob([fallbackHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    // Add hash to mark this as a build error so the caller can detect it
    return url + '#build-error';
  }
}

export const transpile = async () => { throw new Error('Deprecated'); };

/**
 * ✨ HOT UPDATE: Bundle files and return just the script code for hot updating
 * This allows the preview to update without a full iframe reload
 */
export async function bundleForHotUpdate(
  files: Record<string, string>,
  options: BundleOptions = {}
): Promise<string> {
  try {
    const scriptCode = await bundleFiles(files, options);
    console.log('[Bundler] Hot update bundle ready, size:', scriptCode.length);
    return scriptCode;
  } catch (err: any) {
    console.error('[Bundler] Hot update bundle failed:', err);
    // Post errors so the error panel picks them up
    const errors = err.errors || [];
    if (errors.length > 0) {
      for (const e of errors) {
        const loc = e.location ? `${e.location.file}:${e.location.line}:${e.location.column}` : '';
        const msg = loc ? `${loc}: ${e.text}` : e.text;
        window.postMessage({ type: 'PREVIEW_ERROR', errorType: 'Build Error', message: msg, screen: options.screen }, '*');
      }
    } else {
      window.postMessage({ type: 'PREVIEW_ERROR', errorType: 'Build Error', message: err.message || String(err), screen: options.screen }, '*');
    }
    throw err;
  }
}
