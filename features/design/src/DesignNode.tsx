import React, { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';

// 1440px = above all Tailwind breakpoints (sm:640, md:768, lg:1024, xl:1280, 2xl:1536)
export const VIEWPORTS = {
  desktop: { width: 1440, screenHeight: 900 },
  mobile:  { width: 375, screenHeight: 812 },
} as const;

export const CANVAS_SCALE = 0.35;

const MIN_DISPLAY_WIDTH = 200;
const MIN_DISPLAY_HEIGHT = 150;

function cleanCode(code: string) {
  return (code || '')
    .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]lucide-react['"];?/g, 'const {$1} = window.require("lucide-react");')
    .replace(/import\s*React\s*,\s*\{([\s\S]*?)\}\s*from\s*['"]react['"];?/g, 'const {$1} = React;')
    .replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]react['"];?/g, 'const {$1} = React;')
    .replace(/import\s+[^'"]+['"][^'"]+['"];?/g, '')
    .replace(/export\s+default\s+function\s+\w+/g, 'function App')
    .replace(/export\s+default\s+/g, 'const App = ')
    .replace(/export\s+function\s+(\w+)/g, 'function $1')
    .replace(/export\s+const\s+/g, 'const ');
}

function buildPreviewHtml(cleaned: string, screenHeight: number) {
  return `<!DOCTYPE html><html class="dark"><head><meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
<script src="https://unpkg.com/lucide@latest"><\/script>
<script>tailwind.config={darkMode:'class',theme:{extend:{height:{'screen':'var(--screen-h)'},minHeight:{'screen':'var(--screen-h)'},maxHeight:{'screen':'var(--screen-h)'}}}}<\/script>
<style>:root{--screen-h:${screenHeight}px}*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;animation:none!important;transition:none!important}html{width:100%;min-height:100%;overflow:hidden;color:#fff;font-family:system-ui,sans-serif}body{width:100%;min-height:100%;overflow:hidden}#root{width:100%;min-height:100vh;display:flex;flex-direction:column}#root>*{flex:1 1 auto}::-webkit-scrollbar{display:none}</style></head><body><div id="root"></div>
<script type="text/babel" data-presets="react,typescript,env">
const React=window.React;
const createLucideIcon=(name)=>({size=24,color="currentColor",className=""}={})=>React.createElement('div',{className:"inline-flex items-center justify-center "+(className||''),style:{width:size,height:size,color}},React.createElement('i',{'data-lucide':name}));
window.require=(m)=>{if(m==='react')return React;if(m==='lucide-react')return new Proxy({},{get:(_,p)=>createLucideIcon(p.toLowerCase())});return{}};
window.addEventListener('message',function(e){if(e.data&&e.data.type==='update-screen-height'){document.documentElement.style.setProperty('--screen-h',e.data.height+'px')}});
function freezeRuntime(){var id=window.setTimeout(function(){},0);while(id>=0){window.clearTimeout(id);window.clearInterval(id);id--}window.setTimeout=function(){return 0};window.setInterval=function(){return 0};window.clearTimeout=function(){};window.clearInterval=function(){};window.requestAnimationFrame=function(){return 0};window.cancelAnimationFrame=function(){};window.queueMicrotask=function(){};var all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){var el=all[i];if(el.getAnimations){var anims=el.getAnimations();for(var j=0;j<anims.length;j++)anims[j].cancel()}}var media=document.querySelectorAll('video,audio');for(var i=0;i<media.length;i++){try{media[i].pause();media[i].src='';media[i].load()}catch(e){}}window.fetch=function(){return Promise.resolve(new Response('',{status:0}))};window.XMLHttpRequest=function(){this.open=function(){};this.send=function(){};this.abort=function(){};this.setRequestHeader=function(){}};window.WebSocket=function(){this.send=function(){};this.close=function(){}};window.EventSource=function(){this.close=function(){}};var OrigMO=window.MutationObserver;if(OrigMO){var obs=[];var origProto=OrigMO.prototype.observe;window.MutationObserver=function(){this.observe=function(){};this.disconnect=function(){};this.takeRecords=function(){return[]}}}var OrigRO=window.ResizeObserver;if(OrigRO){window.ResizeObserver=function(){this.observe=function(){};this.disconnect=function(){};this.unobserve=function(){}}}var OrigIO=window.IntersectionObserver;if(OrigIO){window.IntersectionObserver=function(){this.observe=function(){};this.disconnect=function(){};this.unobserve=function(){};this.takeRecords=function(){return[]}}}}
try{${cleaned};const C=typeof App!=='undefined'?App:null;if(C){ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C));setTimeout(()=>{if(window.lucide&&window.lucide.createIcons)window.lucide.createIcons();function waitForTailwind(){var styles=document.querySelectorAll('style');var hasTw=false;for(var i=0;i<styles.length;i++){if(styles[i].textContent&&styles[i].textContent.length>500){hasTw=true;break}}if(hasTw){document.fonts.ready.then(function(){setTimeout(function(){var h=document.getElementById('root');window.parent.postMessage({type:'design-render-ready',contentHeight:h?h.scrollHeight:0},'*');freezeRuntime()},100)})}else{setTimeout(waitForTailwind,100)}}waitForTailwind()},200)}else{window.parent.postMessage({type:'design-render-ready',contentHeight:0},'*');freezeRuntime()}}catch(e){window.parent.postMessage({type:'design-render-ready',contentHeight:0},'*');freezeRuntime()}
<\/script></body></html>`;
}

export const DesignNode = memo(({ data, selected }: any) => {
  const { code, viewportMode = 'desktop', fileName } = data;
  const vp = viewportMode as keyof typeof VIEWPORTS;
  const vpDefaults = VIEWPORTS[vp];

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>(vpDefaults.screenHeight);
  const [isResizing, setIsResizing] = useState(false);
  const [localSize, setLocalSize] = useState<{ w: number; h: number } | null>(null);

  // --- Display dimensions: localSize > customSize > defaults ---
  const defaultDisplayW = Math.round(vpDefaults.width * CANVAS_SCALE);
  const defaultDisplayH = Math.round(contentHeight * CANVAS_SCALE);
  const displayWidth = localSize?.w ?? data.customSize?.width ?? defaultDisplayW;
  const displayHeight = localSize?.h ?? data.customSize?.height ?? defaultDisplayH;

  // Target viewport dims (what the iframe renders at — changes live during resize)
  const targetVpWidth = Math.round(displayWidth / CANVAS_SCALE);
  const targetVpScreenH = Math.round(displayHeight / CANVAS_SCALE);

  // --- Preview HTML: only rebuilds on code or viewport MODE change, NOT resize ---
  const [debouncedCode, setDebouncedCode] = useState(code);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCode(code), 150);
    return () => clearTimeout(t);
  }, [code]);

  const previewHtml = useMemo(
    () => buildPreviewHtml(cleanCode(debouncedCode), vpDefaults.screenHeight),
    [debouncedCode, vpDefaults.screenHeight],
  );

  // Ready resets only on code/viewport-mode changes (not resize)
  useEffect(() => { setReady(false); }, [previewHtml]);

  // Fallback reveal
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 8000);
    return () => clearTimeout(t);
  }, [previewHtml]);

  // Listen for render-ready
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type !== 'design-render-ready') return;
      const h = e.data.contentHeight || vpDefaults.screenHeight;
      setContentHeight(Math.max(h, vpDefaults.screenHeight));
      setReady(true);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [vpDefaults.screenHeight]);

  // --- Resize: update dimensions live, browser reflows content naturally ---
  // We do NOT send update-screen-height during resize — that would stretch
  // h-screen sections to fill the new height, collapsing multi-section layouts.
  // Instead, the iframe just grows/shrinks to show more/less of the page.
  const handleResizeStart = useCallback(() => { setIsResizing(true); }, []);
  const handleResize = useCallback((_: any, params: { width: number; height: number }) => {
    setLocalSize({ w: params.width, h: params.height });
  }, []);
  const handleResizeEnd = useCallback((_: any, params: { width: number; height: number }) => {
    setLocalSize({ w: params.width, h: params.height });
    setIsResizing(false);
  }, []);

  // Reset on viewport mode change
  useEffect(() => {
    setLocalSize(null);
    setContentHeight(vpDefaults.screenHeight);
  }, [vp]);

  const displayFileName = fileName ? `${fileName}.tsx` : 'App.tsx';

  return (
    <div
      className="flex flex-col group relative"
      style={{
        width: displayWidth,
        height: displayHeight,
        contentVisibility: 'auto',
        containIntrinsicSize: `${displayWidth}px ${displayHeight}px`,
        boxShadow: '0 25px 25px rgba(0, 0, 0, 0.15)',
      }}
    >
      <NodeResizer
        isVisible={true}
        minWidth={MIN_DISPLAY_WIDTH}
        minHeight={MIN_DISPLAY_HEIGHT}
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        color="rgba(168, 140, 255, 0.5)"
      />

      <div className="absolute inset-0 z-20 cursor-pointer" />

      <div className="absolute -top-[6px] left-0 bg-[#171717]/60 backdrop-blur-xl text-gray-300 text-xs px-3 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-30 shadow-[0_8px_32px_rgba(0,0,0,0.4)] pointer-events-none transform -translate-y-full">
        {displayFileName}
      </div>

      {isResizing && (
        <div className="absolute -bottom-7 right-0 bg-[#171717]/80 backdrop-blur text-gray-300 text-[10px] px-2 py-0.5 rounded font-mono z-30 pointer-events-none">
          {targetVpWidth} x {targetVpScreenH}
        </div>
      )}

      <div
        className="relative"
        style={{
          height: '100%',
          borderStyle: 'solid',
          borderColor: selected ? 'rgba(168, 140, 255, 0.5)' : 'transparent',
          borderWidth: 'calc(2px / var(--zoom, 1))',
          borderRadius: 'calc(12px / var(--zoom, 1))',
          transition: 'border-color 0.35s ease',
          background: '#0a0a0a',
          overflow: 'hidden',
        }}
      >
        {/* Iframe — stays visible during resize, browser reflows content naturally */}
        <iframe
          ref={iframeRef}
          srcDoc={previewHtml}
          sandbox="allow-scripts"
          title={displayFileName}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: targetVpWidth,
            height: Math.max(contentHeight, targetVpScreenH),
            transform: `scale(${CANVAS_SCALE})`,
            transformOrigin: 'top left',
            border: 'none',
            pointerEvents: 'none',
            display: 'block',
            opacity: ready ? 1 : 0,
          }}
        />

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: 0.4 }}>
            <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}

        <Handle type="target" position={Position.Left} className="!w-1.5 !h-1.5 !bg-white/15 !border-0 !-left-1 z-30" />
        <Handle type="source" position={Position.Right} className="!w-1.5 !h-1.5 !bg-white/15 !border-0 !-right-1 z-30" />
      </div>
    </div>
  );
}, (prev, next) => {
  // Only re-render when data we actually USE changes.
  // Ignore positionAbsoluteX/Y, dragging, width, height from ReactFlow —
  // those change every drag/zoom frame and would cause 60fps re-renders.
  return prev.selected === next.selected
    && prev.data === next.data;
});
DesignNode.displayName = 'DesignNode';
