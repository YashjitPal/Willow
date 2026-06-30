import React, { useEffect, useCallback, useState, useRef } from 'react';
import { ReactFlow, ReactFlowProvider, Panel, applyNodeChanges, NodeChange, Node, useStore as useRFStore, useReactFlow, useStoreApi, SelectionMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@nanostores/react';
import { designNodesStore, updateDesignNodeLayout, updateDesignNodeSize, clearDesignNodeSize, removeDesignNode, focusedDesignNodeId, designViewportMode, selectedDesignNodeIds } from '../../lib/stores/design-store';
import { DesignNode, VIEWPORTS, CANVAS_SCALE } from './DesignNode';
import { Trash2, MousePointer2, Pencil, Hand, Palette, Image as ImageIcon, Star, Monitor, Smartphone } from 'lucide-react';

// Custom dot-grid background using direct DOM updates (no React re-renders).
// Subscribes to the ReactFlow store and mutates SVG attributes directly,
// so pan/zoom runs at native speed without triggering React reconciliation.
const DotGrid: React.FC = () => {
  const store = useStoreApi();
  const patternRef = useRef<SVGPatternElement>(null);
  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const gap = 28;
    const dotSize = 2;
    const canvasEl = document.querySelector('.design-canvas-flow') as HTMLElement | null;

    const update = () => {
      const [x, y, zoom] = store.getState().transform;
      const scaledGap = gap * zoom;
      const scaledSize = dotSize * zoom;
      if (patternRef.current) {
        patternRef.current.setAttribute('x', String(x % scaledGap));
        patternRef.current.setAttribute('y', String(y % scaledGap));
        patternRef.current.setAttribute('width', String(scaledGap));
        patternRef.current.setAttribute('height', String(scaledGap));
      }
      if (circleRef.current) {
        circleRef.current.setAttribute('cx', String(scaledSize / 2));
        circleRef.current.setAttribute('cy', String(scaledSize / 2));
        circleRef.current.setAttribute('r', String(scaledSize / 2));
      }
      // Keep --zoom CSS variable in sync for zoom-independent UI elements
      if (canvasEl) canvasEl.style.setProperty('--zoom', String(zoom));
    };

    update();
    return store.subscribe(update);
  }, [store]);

  return (
    <svg
      className="react-flow__background"
      style={{ position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, pointerEvents: 'none', zIndex: -1 }}
    >
      <pattern
        ref={patternRef}
        id="design-dot-pattern"
        patternUnits="userSpaceOnUse"
      >
        <circle ref={circleRef} fill="#27272a" />
      </pattern>
      <rect x="0" y="0" width="100%" height="100%" fill="url(#design-dot-pattern)" />
    </svg>
  );
};

// Zoom display using direct DOM updates (no React re-renders during zoom).
const ZoomDisplay: React.FC = () => {
  const store = useStoreApi();
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const zoom = store.getState().transform[2];
      if (textRef.current) {
        textRef.current.textContent = `${Math.round(zoom * 100)}%`;
      }
    };
    update();
    return store.subscribe(update);
  }, [store]);

  return (
    <Panel position="bottom-right" className="mb-6 mr-6">
      <div ref={textRef} className="flex items-center justify-center px-3 py-1.5 h-8 bg-[#171717]/60 backdrop-blur-xl rounded-xl text-white text-xs font-semibold shadow-[0_8px_32px_rgba(0,0,0,0.4)]" />
    </Panel>
  );
};

const nodeTypes = { design: DesignNode };

const DesignCanvasInner = () => {
  const storedNodes = useStore(designNodesStore);
  const focusedNodeId = useStore(focusedDesignNodeId);
  const { fitView } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<'cursor' | 'hand'>('cursor');
  const viewportMode = useStore(designViewportMode);
  // Cache data objects so references stay stable when nothing changed —
  // this prevents DesignNode memo from failing on every store sync
  const dataCacheRef = useRef<Record<string, { data: any; code: string; vm: string; fn?: string; csW?: number; csH?: number }>>({});
  // Defer nanostore selection writes so they don't overlap with click+drag start frame
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isHand = activeTool === 'hand';

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'v' || e.key === 'V') setActiveTool('cursor');
      if (e.key === 'h' || e.key === 'H') setActiveTool('hand');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.length) {
        selectedNodeIds.forEach(id => removeDesignNode(id));
        setSelectedNodeIds([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeIds]);

  // Sync store → local ReactFlow nodes (also when viewportMode changes)
  useEffect(() => {
    const vp = VIEWPORTS[viewportMode as keyof typeof VIEWPORTS];
    const defaultW = Math.round(vp.width * CANVAS_SCALE);

    const flowNodes: Node[] = storedNodes.map(n => {
      // Reuse cached data object if nothing relevant changed
      const cached = dataCacheRef.current[n.id];
      if (cached && cached.code === n.code && cached.vm === viewportMode && cached.fn === n.fileName
          && cached.csW === n.customSize?.width && cached.csH === n.customSize?.height) {
        return {
          id: n.id,
          type: 'design' as const,
          position: n.layoutData || { x: 0, y: 0 },
          width: n.customSize?.width ?? defaultW,
          ...(n.customSize ? { height: n.customSize.height } : {}),
          data: cached.data,
        };
      }
      const data = { ...n, viewportMode };
      dataCacheRef.current[n.id] = { data, code: n.code, vm: viewportMode, fn: n.fileName, csW: n.customSize?.width, csH: n.customSize?.height };
      return {
        id: n.id,
        type: 'design' as const,
        position: n.layoutData || { x: 0, y: 0 },
        width: n.customSize?.width ?? defaultW,
        ...(n.customSize ? { height: n.customSize.height } : {}),
        data,
      };
    });
    setNodes(prev => {
      const oldIds = prev.map(n => n.id).sort().join(',');
      const newIds = flowNodes.map(n => n.id).sort().join(',');
      if (oldIds !== newIds || prev.length !== flowNodes.length) return flowNodes;

      // Viewport mode changed — update data but preserve dragged positions
      if (prev.length > 0 && prev[0]?.data?.viewportMode !== viewportMode) {
        return prev.map(n => ({ ...n, data: { ...n.data, viewportMode } }));
      }

      return prev;
    });
  }, [storedNodes, viewportMode]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const hasSelectionChange = changes.some(c => c.type === 'select');

    setNodes(nds => {
      const next = applyNodeChanges(changes, nds);
      changes.forEach(c => {
        // @ts-ignore
        if (c.type === 'position' && c.position && !c.dragging) {
          updateDesignNodeLayout(c.id, c.position);
        }
        // Persist custom size when resize ends
        // @ts-ignore
        if (c.type === 'dimensions' && c.dimensions && !c.resizing) {
          // @ts-ignore
          updateDesignNodeSize(c.id, { width: c.dimensions.width, height: c.dimensions.height });
        }
      });

      // Only sync selection store when selection actually changed — deferred to
      // avoid overlapping with click+drag frame
      if (hasSelectionChange) {
        const nowSelected = next.filter(n => n.selected).map(n => n.id);
        clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = setTimeout(() => selectedDesignNodeIds.set(nowSelected));
      }

      return next;
    });
  }, []);

  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    const ids = sel.map(n => n.id);
    setSelectedNodeIds(ids);
    clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = setTimeout(() => selectedDesignNodeIds.set(ids));
  }, []);

  // Handle single-click on a node (onSelectionChange only fires for multi-select)
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeIds([node.id]);
    clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = setTimeout(() => selectedDesignNodeIds.set([node.id]));
  }, []);

  // Clicking empty canvas deselects
  const onPaneClick = useCallback(() => {
    setSelectedNodeIds([]);
    clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = setTimeout(() => selectedDesignNodeIds.set([]));
  }, []);

  // Focus node triggered from sidebar
  useEffect(() => {
    if (focusedNodeId) {
      fitView({ nodes: [{ id: focusedNodeId }], duration: 500, padding: 0.3 });
    }
  }, [focusedNodeId, fitView]);

  // Clear custom sizes when viewport mode changes (reset to defaults)
  useEffect(() => {
    storedNodes.forEach(n => {
      if (n.customSize) clearDesignNodeSize(n.id);
    });
  }, [viewportMode]);

  const deleteSelected = useCallback(() => {
    selectedNodeIds.forEach(id => removeDesignNode(id));
    setSelectedNodeIds([]);
  }, [selectedNodeIds]);

  return (
    <div className="w-full h-full relative bg-[#0c0c0c]" style={{ cursor: isHand ? 'grab' : 'default' }}>
      {/* Override ReactFlow selection visuals */}
      <style>{`
        .design-canvas-flow .react-flow__viewport { will-change: transform; }
        .design-canvas-flow .react-flow__node { will-change: transform; }
        .design-canvas-flow .react-flow__node iframe { will-change: transform; }
        .design-canvas-flow .react-flow__selection { background: rgba(147,180,255,0.06) !important; border: 1px solid rgba(147,180,255,0.25) !important; border-radius: 8px !important; }
        .design-canvas-flow .react-flow__node.selected > div { /* handled in DesignNode via selected prop */ }
        .design-canvas-flow .react-flow__nodesselection-rect { background: transparent !important; border: none !important; }
        .design-canvas-flow .react-flow__resize-control.handle { width: 8px !important; height: 8px !important; border: 2px solid rgba(168,140,255,0.6) !important; border-radius: 2px !important; background: #1a1a2e !important; }
        .design-canvas-flow .react-flow__resize-control.handle:hover { background: rgba(168,140,255,0.3) !important; border-color: rgba(168,140,255,0.8) !important; }
        .design-canvas-flow .react-flow__resize-control.line { border-color: transparent !important; }
        .design-canvas-flow .react-flow__resize-control.line:hover { border-color: rgba(168,140,255,0.3) !important; }
        .design-canvas-flow .react-flow__resize-control { z-index: 25 !important; pointer-events: auto !important; }
        .design-canvas-flow .react-flow__node:not(.selected) .react-flow__resize-control { opacity: 0 !important; pointer-events: none !important; }
      `}</style>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
        minZoom={0.05}
        maxZoom={3}
        elevateNodesOnSelect
        proOptions={{ hideAttribution: true }}
        panOnDrag={isHand ? [0, 1, 2] : [1, 2]}
        nodesDraggable={!isHand}
        selectionOnDrag={!isHand}
        selectionMode={SelectionMode.Partial}
        nodesConnectable={false}
        className="design-canvas-flow"
      >
        <DotGrid />
        <ZoomDisplay />

        {/* Right-edge: original vertical toolbar */}
        <Panel position="top-right" className="mt-6 mr-6 flex items-center h-full">
          <div className="flex flex-col items-center gap-2.5 px-2 py-2.5 bg-[#171717]/60 backdrop-blur-xl rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all">
            {/* Cursor Button */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'cursor' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Cursor (V)"
              onClick={() => setActiveTool('cursor')}
            >
              <MousePointer2 size={16} strokeWidth={2} />
            </button>

            {/* Edit Button */}
            <button
              className="w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white"
              title="Edit"
            >
              <Pencil size={16} strokeWidth={2} className="relative left-[1px] top-[1px]" />
            </button>

            {/* Hand Tool */}
            <button
              className={`w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 ${activeTool === 'hand' ? 'bg-[#32323e] text-white' : 'text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white'}`}
              title="Hand tool (H)"
              onClick={() => setActiveTool('hand')}
            >
              <Hand size={18} strokeWidth={2} />
            </button>

            {/* Divider */}
            <div className="w-5 h-[1px] bg-[#333333] my-1" />

            {/* Palette Tool */}
            <button
              className="w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white"
              title="Color Palette"
            >
              <Palette size={18} strokeWidth={2} />
            </button>

            {/* Image Tool */}
            <button
              className="w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white"
              title="Image"
            >
              <ImageIcon size={18} strokeWidth={2} />
            </button>

            {/* Divider */}
            <div className="w-5 h-[1px] bg-[#333333] my-1" />

            {/* Star Tool */}
            <button
              className="w-[33px] h-[33px] rounded-full transition-colors flex items-center justify-center shrink-0 text-[#a1a1aa] hover:bg-[#2b2b2b] hover:text-white"
              title="Star"
            >
              <Star size={18} strokeWidth={2} />
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {/* Top-right: viewport toggle — outside ReactFlow to avoid Panel overlap */}
      <div className="absolute top-4 right-4 z-20">
        <div className="flex flex-col gap-1 p-1 bg-[#171717]/60 backdrop-blur-xl rounded-xl">
          <button
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${viewportMode === 'desktop' ? 'bg-white/10 text-white' : 'text-white/30 hover:bg-white/10 hover:text-white'}`}
            title="Desktop (16:9)"
            onClick={() => designViewportMode.set('desktop')}
          >
            <Monitor size={15} strokeWidth={2} />
          </button>
          <button
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${viewportMode === 'mobile' ? 'bg-white/10 text-white' : 'text-white/30 hover:bg-white/10 hover:text-white'}`}
            title="Mobile (9:19.5)"
            onClick={() => designViewportMode.set('mobile')}
          >
            <Smartphone size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Action Bar for selected nodes */}
      {selectedNodeIds.length > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-[#171717]/60 backdrop-blur-xl rounded-full px-4 py-2 flex items-center gap-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <span className="text-sm text-gray-300 font-medium">{selectedNodeIds.length} selected</span>
          <div className="w-px h-4 bg-white/10" />
          <button
            onClick={deleteSelected}
            className="flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
          >
            <Trash2 size={16} /> Delete
          </button>
        </div>
      )}
    </div>
  );
};

export const DesignCanvas = React.memo(() => (
  <ReactFlowProvider>
    <DesignCanvasInner />
  </ReactFlowProvider>
));
