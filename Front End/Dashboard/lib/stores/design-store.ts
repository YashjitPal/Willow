import { atom } from 'nanostores';

export interface DesignNodeData {
  id: string;
  prompt: string;
  code: string;
  fileName?: string;
  timestamp: number;
  layoutData?: { x: number; y: number };
  customSize?: { width: number; height: number }; // User-resized display dims on canvas
  thumbnailUrl?: string; // Cached data-URL snapshot for prompt-box attachment
}

export const designNodesStore = atom<DesignNodeData[]>([]);

export function addDesignNode(node: Omit<DesignNodeData, 'id' | 'timestamp'>) {
  const currentNodes = designNodesStore.get();

  // Basic auto-layout next to the last node
  let x = 100;
  const y = 100;
  if (currentNodes.length > 0) {
    const lastNode = currentNodes[currentNodes.length - 1];
    x = (lastNode.layoutData?.x ?? 0) + 600; // 600px spacing
  }

  const newNode: DesignNodeData = {
    ...node,
    id: `design-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: Date.now(),
    layoutData: node.layoutData || { x, y }
  };

  designNodesStore.set([...currentNodes, newNode]);

  // Generate thumbnail asynchronously after adding
  generateThumbnail(newNode.id, newNode.code);

  return newNode;
}

/** Render code in a hidden iframe, capture to canvas, store as data-URL */
function generateThumbnail(nodeId: string, code: string) {
  const cleaned = (code || '')
    .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]lucide-react['"];?/g, 'const {$1} = window.require("lucide-react");')
    .replace(/import\s*React\s*,\s*\{([\s\S]*?)\}\s*from\s*['"]react['"];?/g, 'const {$1} = React;')
    .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]react['"];?/g, 'const {$1} = React;')
    .replace(/import\s+[^'"]+['"][^'"]+['"];?/g, '')
    .replace(/export\s+default\s+function\s+\w+/g, 'function App')
    .replace(/export\s+default\s+/g, 'const App = ')
    .replace(/export\s+function\s+(\w+)/g, 'function $1')
    .replace(/export\s+const\s+/g, 'const ');

  const html = `<!DOCTYPE html><html class="dark"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"><\/script><script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script><script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script><script>tailwind.config={darkMode:'class'}<\/script><style>*{animation:none!important;transition:none!important}html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif}#root{width:100%;height:100%}::-webkit-scrollbar{display:none}</style></head><body><div id="root"></div><script type="text/babel" data-presets="react,typescript,env">const React=window.React;window.require=(m)=>{if(m==='react')return React;if(m==='lucide-react')return new Proxy({},{get:(_,p)=>(props)=>React.createElement('span')});return{}};try{${cleaned};const C=typeof App!=='undefined'?App:null;if(C)ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C))}catch(e){}<\/script></body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:960px;height:960px;border:none;opacity:0;pointer-events:none;';
  iframe.sandbox.add('allow-scripts');
  iframe.sandbox.add('allow-same-origin');
  document.body.appendChild(iframe);

  iframe.srcdoc = html;
  iframe.onload = () => {
    // Wait for React + Tailwind to render
    setTimeout(async () => {
      try {
        const { default: html2canvas } = await import('html2canvas');
        const body = iframe.contentDocument?.body;
        if (!body) { cleanup(); return; }

        const canvas = await html2canvas(body, {
          width: 960,
          height: 960,
          scale: 0.15,       // tiny output — we only need 64px
          useCORS: true,
          backgroundColor: '#0a0a0a',
          logging: false,
        });

        const dataUrl = canvas.toDataURL('image/png');

        // Write thumbnail into the store
        const nodes = designNodesStore.get();
        designNodesStore.set(
          nodes.map(n => n.id === nodeId ? { ...n, thumbnailUrl: dataUrl } : n)
        );
      } catch {
        // Silently fail — thumbnail just won't be available
      }
      cleanup();
    }, 1500); // generous delay for CDN scripts
  };

  const cleanup = () => {
    try { document.body.removeChild(iframe); } catch { /* already removed */ }
  };
  // Safety net: remove iframe if it takes too long
  setTimeout(cleanup, 10000);
}

export function updateDesignNodeLayout(id: string, layoutData: { x: number; y: number }) {
  const currentNodes = designNodesStore.get();
  designNodesStore.set(
    currentNodes.map(node =>
      node.id === id ? { ...node, layoutData } : node
    )
  );
}

export function updateDesignNodeSize(id: string, size: { width: number; height: number }) {
  const currentNodes = designNodesStore.get();
  designNodesStore.set(
    currentNodes.map(node =>
      node.id === id ? { ...node, customSize: size } : node
    )
  );
}

export function clearDesignNodeSize(id: string) {
  const currentNodes = designNodesStore.get();
  designNodesStore.set(
    currentNodes.map(node =>
      node.id === id ? { ...node, customSize: undefined } : node
    )
  );
}

export function removeDesignNode(id: string) {
  const currentNodes = designNodesStore.get();
  designNodesStore.set(currentNodes.filter(node => node.id !== id));
}

export function clearDesignNodes() {
  designNodesStore.set([]);
}

// Viewport mode: desktop (16:9) or mobile (~9:19.5)
export const designViewportMode = atom<'desktop' | 'mobile'>('desktop');

// Currently selected node IDs on the canvas (shared with chat)
export const selectedDesignNodeIds = atom<string[]>([]);

// Atom to signal which node should be focused/highlighted on the canvas
export const focusedDesignNodeId = atom<string | null>(null);

export function focusDesignNode(id: string) {
  focusedDesignNodeId.set(id);
  // Auto-clear after a short delay so it can be triggered again
  setTimeout(() => focusedDesignNodeId.set(null), 2000);
}
