import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ReactFlow, 
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  Connection,
  Panel,
  useStore,
  ReactFlowProvider,
  Handle,
  Position,
  ConnectionLineType,
  ConnectionLineComponentProps,
  getBezierPath,
  BaseEdge,
  type EdgeProps,
  useReactFlow,
  useHandleConnections
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  Navigation, // For Agent
  MousePointer2, // New Agent
  Square, // For End (using square with rounded corners later)
  FileText, // For Note
  StickyNote, // New Note
  Database, // For File search
  ShieldCheck, // For Guardrails
  Blocks, // For MCP
  Split, // For If / else
  RefreshCw, // For While
  ThumbsUp, // For User approval
  Shuffle, // For Transform
  Focus, // For Set state
  CircleDashed,
  Plus,
  Hand,
  Undo2,
  Redo2,
  Play,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Trash2,

  ChevronDown,
  ExternalLink
} from 'lucide-react';

// Custom node types
const StartNode = ({ data, selected }: any) => {
  const connections = useHandleConnections({ type: 'source' });
  const isConnected = connections.length > 0;

  return (
    <div className={`flex items-center justify-center gap-4 py-3 px-3 bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <div className="w-11 h-11 rounded-[12px] bg-[#93dfca] flex items-center justify-center shrink-0">
        <Play size={20} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black fill-transparent relative left-[1.2px]" />
      </div>
      <span className="text-white text-lg font-normal tracking-wide">Start</span>
      <Handle 
        type="source" 
        position={Position.Right} 
        isConnectable={!isConnected}
        style={{ right: 0, transform: 'translate(50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
    </div>
  );
};

const EndNode = ({ data, selected }: any) => {
  const connections = useHandleConnections({ type: 'target' });
  const isConnected = connections.length > 0;

  return (
    <div className={`flex items-center justify-center gap-4 py-3 px-3 bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <Handle 
        type="target" 
        position={Position.Left} 
        isConnectable={!isConnected}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
      <div className="w-11 h-11 rounded-[12px] bg-[#93dfca] flex items-center justify-center shrink-0">
        <Square size={20} strokeWidth={2.75} rx={4.5} ry={4.5} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
      </div>
      <span className="text-white text-[16px] font-semibold tracking-wide">End</span>
    </div>
  );
};

const SetStateNode = ({ data, selected }: any) => {
  const targetConnections = useHandleConnections({ type: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  
  const sourceConnections = useHandleConnections({ type: 'source' });
  const isSourceConnected = sourceConnections.length > 0;

  return (
    <div className={`flex items-center justify-center gap-4 py-3 px-3 bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <Handle 
        type="target" 
        position={Position.Left} 
        isConnectable={!isTargetConnected}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
      <div className="w-11 h-11 rounded-[12px] bg-[#a855f7] flex items-center justify-center shrink-0">
        <CircleDashed size={20} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
      </div>
      <span className="text-white text-[16px] font-semibold tracking-wide">Set state</span>
      <Handle 
        type="source" 
        position={Position.Right} 
        isConnectable={!isSourceConnected}
        style={{ right: 0, transform: 'translate(50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
    </div>
  );
};

const PlaceholderNode = ({ data, selected }: any) => {
  return (
    <div className={`flex items-center justify-center gap-4 py-3 px-3 bg-[#2b2b2b]/30 rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <Handle 
        type="target" 
        position={Position.Left} 
        isConnectable={false}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
      <div className="w-11 h-11 rounded-[12px] border-[2px] border-dashed border-[#555] bg-[#232323] flex items-center justify-center shrink-0">
        <Plus size={20} className="text-[#a1a1aa]" strokeWidth={2.5} />
      </div>
      <span className="text-white text-[16px] font-normal tracking-wide">New node</span>
    </div>
  );
};

const AgentNode = ({ data, selected }: any) => {
  const targetConnections = useHandleConnections({ type: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  
  const sourceConnections = useHandleConnections({ type: 'source' });
  const isSourceConnected = sourceConnections.length > 0;

  return (
    <div className={`flex items-center justify-center gap-4 py-3 px-3 bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <Handle 
        type="target" 
        position={Position.Left} 
        isConnectable={!isTargetConnected}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
      <div className="w-11 h-11 rounded-[12px] bg-[#7a9efa] flex items-center justify-center shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="16 16 80 80" width="22" height="22" className="text-black relative left-[1.5px] top-[1.5px]">
          <path d="M 36 28 L 72 40 Q 84 44 75 47 L 63 51 Q 54 54 51 63 L 47 75 Q 44 84 40 72 L 28 36 Q 24 24 36 28 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="8.5"
                strokeLinejoin="round"
                strokeLinecap="round" />
        </svg>
      </div>
      <div className="flex flex-col">
        <span className="text-white text-lg font-normal tracking-wide leading-tight">{data.label || 'Agent'}</span>
        <span className="text-[#a1a1aa] text-sm font-normal tracking-wide leading-tight">Agent</span>
      </div>
      <Handle 
        type="source" 
        position={Position.Right} 
        isConnectable={!isSourceConnected}
        style={{ right: 0, transform: 'translate(50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
    </div>
  );
};

const IfElseNode = ({ data, selected }: any) => {
  const targetConnections = useHandleConnections({ type: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  
  const ifConnections = useHandleConnections({ type: 'source', id: 'if' });
  const isIfConnected = ifConnections.length > 0;
  
  const elseConnections = useHandleConnections({ type: 'source', id: 'else' });
  const isElseConnected = elseConnections.length > 0;

  return (
    <div className={`flex flex-col gap-2 p-3 bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      {/* Universal Target Handle */}
      <Handle 
        type="target" 
        position={Position.Left} 
        isConnectable={!isTargetConnected}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-[12px] bg-[#f4b13b] flex items-center justify-center shrink-0">
          <Split size={20} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black rotate-90" />
        </div>
        <span className="text-white text-lg font-normal tracking-wide">If / else</span>
      </div>

      {/* If Condition Block (Empty Dark Box) */}
      <div className="relative w-full h-[42px] bg-[#1a1a1a] rounded-xl flex items-center justify-end px-4">
        <Handle 
          type="source" 
          id="if"
          position={Position.Right} 
          isConnectable={!isIfConnected}
          style={{ right: -12, transform: 'translate(50%, -50%)' }}
          className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
        />
      </div>

      {/* Else Block */}
      <div className="relative w-full h-[42px] bg-[#1a1a1a] rounded-xl flex items-center justify-end px-4">
        <span className="text-[#a1a1aa] text-[15px] font-medium tracking-wide">Else</span>
        <Handle 
          type="source" 
          id="else"
          position={Position.Right} 
          isConnectable={!isElseConnected}
          style={{ right: -12, transform: 'translate(50%, -50%)' }}
          className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
        />
      </div>
    </div>
  );
};

const GuardrailNode = ({ data, selected }: any) => {
  const targetConnections = useHandleConnections({ type: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  
  const passConnections = useHandleConnections({ type: 'source', id: 'pass' });
  const isPassConnected = passConnections.length > 0;
  
  const failConnections = useHandleConnections({ type: 'source', id: 'fail' });
  const isFailConnected = failConnections.length > 0;

  // Check if at least one guardrail is active
  const hasActiveGuardrail = data.config?.pii || data.config?.moderation || data.config?.jailbreak || data.config?.hallucination || data.config?.continueOnError;

  return (
    <div className={`flex flex-col gap-2 p-3 bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      {/* Universal Target Handle */}
      <Handle 
        type="target" 
        position={Position.Left} 
        isConnectable={!isTargetConnected}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-[12px] bg-[#ffff80] flex items-center justify-center shrink-0">
          <ShieldCheck size={20} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
        </div>
        <span className="text-white text-[16px] font-semibold tracking-wide">{data.label || 'Guardrails'}</span>
      </div>

      {/* Pass & Fail Blocks Backgrounds (Animated) */}
      <AnimatePresence>
        {hasActiveGuardrail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 92, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col gap-2 overflow-hidden"
          >
            {/* Pass Block visual */}
            <div className="relative w-full h-[42px] bg-[#1a1a1a] rounded-xl flex items-center justify-end px-4 shrink-0">
              <span className="text-[#a1a1aa] text-[15px] font-medium tracking-wide">Pass</span>
            </div>

            {/* Fail Block visual */}
            <div className="relative w-full h-[42px] bg-[#1a1a1a] rounded-xl flex items-center justify-end px-4 shrink-0">
              <span className="text-[#a1a1aa] text-[15px] font-medium tracking-wide">Fail</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* React Flow Handles */}
      {/* Mounted when hasActiveGuardrail is true.
          Raw CSS animation keeps them invisible for 250ms (matching the expansion duration),
          then they snap into existence instantly. On collapse, React unmounts them immediately. */}
      {hasActiveGuardrail && (
        <>
          <style>{`
            @keyframes handleAppear {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}</style>
          <div style={{ animation: 'handleAppear 0s 0.25s backwards' }}>
            {/* Pass Handle */}
            <Handle 
              type="source" 
              id="pass"
              position={Position.Right} 
              isConnectable={!isPassConnected}
              style={{ 
                right: 0, 
                top: '85px', 
                transform: 'translate(50%, -50%)',
              }}
              className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
            />

            {/* Fail Handle */}
            <Handle 
              type="source" 
              id="fail"
              position={Position.Right} 
              isConnectable={!isFailConnected}
              style={{ 
                right: 0, 
                top: '135px', 
                transform: 'translate(50%, -50%)',
              }}
              className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
            />
          </div>
        </>
      )}
    </div>
  );
};

const CustomConnectionLine = ({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
}: ConnectionLineComponentProps) => {
  // Offset by 7px so the drag preview starts/ends at the circle edge, not inside the node
  const sourceOffset = fromPosition === Position.Right ? 7 : fromPosition === Position.Left ? -7 : 0;
  const targetOffset = toPosition === Position.Left ? -7 : toPosition === Position.Right ? 7 : 0;

  const [edgePath] = getBezierPath({
    sourceX: fromX + sourceOffset,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX + targetOffset,
    targetY: toY,
    targetPosition: toPosition || fromPosition,
  });

  return (
    <g>
      <path
        fill="none"
        stroke="#404040"
        strokeWidth={2.5}
        d={edgePath}
      />
    </g>
  );
};

const CustomBezierEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
}: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path"
        d={edgePath}
        fill="none"
        stroke={style?.stroke ?? '#404040'}
        strokeWidth={style?.strokeWidth ?? 2.5}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />
    </>
  );
};

const edgeTypes = {
  custom: CustomBezierEdge,
};

const nodeTypes = {
  start: StartNode,
  agent: AgentNode,
  ifElse: IfElseNode,
  guardrail: GuardrailNode,
  end: EndNode,
  setState: SetStateNode,
  placeholder: PlaceholderNode,
};

// Initial nodes for canvas
const initialNodes: Node[] = [
  {
    id: '1',
    type: 'start',
    data: { label: 'Start' },
    position: { x: 50, y: 125 },
  },
  {
    id: '2',
    type: 'agent',
    data: { label: 'Agent' },
    position: { x: 300, y: 125 },
  }
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'custom', style: { stroke: '#404040', strokeWidth: 2.5 } },
];

const InstructionsModal = ({ 
  isOpen, 
  onClose, 
  initialValue, 
  onSave 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  initialValue: string; 
  onSave: (val: string) => void; 
}) => {
  const [value, setValue] = useState(initialValue);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />
          
          {/* Modal Content */}
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-3xl h-[65vh] max-h-[700px] bg-[#222222] rounded-[12px] shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header Area inside Modal */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0 border-b border-[#333]">
              <h2 className="text-white text-[16px] font-semibold tracking-wide">Edit instructions</h2>
              <button className="flex items-center gap-1.5 text-[#a1a1aa] hover:text-white transition-colors">
                <span className="text-[13px] font-medium">Add context</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>
              </button>
            </div>

            {/* Text Area */}
            <div className="flex-1 p-6 pt-2 pb-0 flex flex-col">
              <textarea 
                className="w-full h-full bg-transparent text-white text-[15px] resize-none border-none outline-none leading-relaxed placeholder:text-[#6a6a6a]"
                placeholder="Describe desired model behavior (tone, tool usage, response style)"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end px-6 py-4 gap-3 shrink-0">
              <button 
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-[#333333] hover:bg-[#404040] text-white text-[14px] font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  onSave(value);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-white hover:bg-gray-100 text-black text-[14px] font-medium transition-colors"
              >
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

interface AgentConfigPanelProps {
  nodeName: string;
  onNameChange: (newName: string) => void;
  instructions: string;
  onInstructionsChange: (newInstructions: string) => void;
}

const AgentConfigPanel: React.FC<AgentConfigPanelProps> = ({ nodeName, onNameChange, instructions, onInstructionsChange }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Local state for the input to allow immediate typing before the flow state updates
  const [localName, setLocalName] = useState(nodeName);
  const [localInstructions, setLocalInstructions] = useState(instructions);
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false);

  return (
    <div 
      className="absolute right-6 top-6 w-[340px] bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto"
      style={{
        maxHeight: 'calc(100% - 48px)', // Leaves 24px (top-6) and 24px (bottom-6) spacing when fully expanded
      }}
    >
      <div 
        ref={scrollContainerRef}
        className="p-5 flex-1 flex flex-col gap-[18px] min-h-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        
        {/* Fixed Header */}
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-white text-[16px] font-semibold tracking-wide">
            {localName || 'Agent'}
          </h2>
          <div className="flex items-center gap-3 text-[#a1a1aa]">
            <button className="hover:text-white transition-colors"><BookOpen size={16} strokeWidth={2.5} /></button>
            <button className="hover:text-white transition-colors"><Trash2 size={16} strokeWidth={2.5} /></button>
          </div>
        </div>
        <p className="text-[#a1a1aa] text-[13px] -mt-3.5 tracking-wide shrink-0">Call the model with your instructions and tools</p>
        
        {/* Main Settings */}
        <div className="flex items-center justify-between gap-4 mt-2 shrink-0">
          <label className="text-white text-[14.5px] font-medium">Name</label>
          <div className="w-[240px] h-[32px] bg-[#2b2b2b] rounded-lg px-3 flex items-center">
            <input 
              type="text" 
              className="bg-transparent border-none outline-none text-white text-[14px] w-full placeholder:text-[#6a6a6a]" 
              placeholder="Agent" 
              value={localName}
              onChange={(e) => {
                setLocalName(e.target.value);
                onNameChange(e.target.value);
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-1 shrink-0">
          <div className="flex items-center justify-between">
            <label className="text-white text-[14.5px] font-medium">Instructions</label>
            <div className="flex items-center gap-2.5 text-[#a1a1aa]">
               <button className="hover:text-white transition-colors"><Plus size={16} strokeWidth={2.5} /></button>
                <button className="hover:text-white transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" className="fill-current">
                    <path d="M 6.5 1.25 C 6.5 4.15 4.15 6.5 1.25 6.5 C 4.15 6.5 6.5 8.85 6.5 11.75 C 6.5 8.85 8.85 6.5 11.75 6.5 C 8.85 6.5 6.5 4.15 6.5 1.25 Z" />
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                  </svg>
                </button>
            </div>
          </div>
          <div className="relative w-full h-[120px]">
            <textarea 
              className="w-full h-full bg-[#2b2b2b] rounded-xl p-3 pb-8 text-white text-[14px] resize-none border-none outline-none leading-relaxed placeholder:text-[#6a6a6a]"
              placeholder="Describe desired model behavior (tone, tool usage, response style)"
              value={localInstructions}
              onChange={(e) => {
                setLocalInstructions(e.target.value);
                onInstructionsChange(e.target.value);
              }}
            />
            {/* Expand / Maximize Icon */}
            <button 
              onClick={() => setIsInstructionsModalOpen(true)}
              className="absolute bottom-2.5 left-3 text-[#a1a1aa] hover:text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 4 20 4 20 9"/>
                <polyline points="9 20 4 20 4 15"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1 shrink-0">
          <label className="text-white text-[14.5px] font-medium">Include chat history</label>
          <div className="w-[42px] h-[24px] bg-white rounded-full flex items-center justify-end px-0.5 cursor-pointer">
            <div className="w-[20px] h-[20px] bg-black rounded-full shadow-sm" />
          </div>
        </div>

        <div className="flex items-center justify-between shrink-0">
          <label className="text-white text-[14.5px] font-medium">Model</label>
          <div className="flex items-center gap-1.5 text-gray-300 cursor-pointer hover:text-white">
            <span className="text-[14px] font-medium">gpt-4.1</span>
            <ChevronDown size={16} className="text-[#a1a1aa]" />
          </div>
        </div>

        <div className="flex items-center justify-between shrink-0">
          <label className="text-white text-[14.5px] font-medium">Tools</label>
          <button className="text-[#a1a1aa] hover:text-white transition-colors">
            <Plus size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Wrapper for the last visible element and the expandable content to prevent flex gap collapse jumping on unmount */}
        <div className="flex flex-col shrink-0">
          <div className="flex items-center justify-between">
            <label className="text-white text-[14.5px] font-medium">Output format</label>
            <div className="flex items-center gap-1.5 text-gray-300 cursor-pointer hover:text-white">
              <span className="text-[14px] font-medium">Text</span>
              <ChevronDown size={16} className="text-[#a1a1aa]" />
            </div>
          </div>

          {/* --- Expanded Content --- */}
          <AnimatePresence initial={false}>
            {(isExpanded || isClosing) && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ 
                  height: 'auto', 
                  transition: { 
                    height: { type: "spring", stiffness: 70, damping: 20, mass: 1.5 }
                  }
                }}
                exit={{ 
                  height: 0, 
                  transition: { 
                    height: { duration: 0.35, ease: [0.32, 0.72, 0, 1] }
                  }
                }}
                className="overflow-hidden"
              >
                <motion.div 
                  initial={{ y: -30, opacity: 0 }}
                  animate={{ 
                    y: 0, 
                    opacity: 1,
                    transition: { 
                      y: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
                      opacity: { duration: 0.25 }
                    }
                  }}
                  exit={{ 
                    y: -15, 
                    opacity: 0,
                    transition: { duration: 0.2 }
                  }}
                  className="flex flex-col gap-[18px] pt-[18px] pb-2"
                >
                
                {/* Model parameters */}
              <div className="flex flex-col gap-4">
                <h3 className="text-[#a1a1aa] text-[13px] font-medium tracking-wide">Model parameters</h3>
                
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-white text-[14px]">Temperature</label>
                    <span className="text-white text-[14px]">1.00</span>
                  </div>
                  <div className="w-full h-1 bg-[#404040] rounded-full relative mt-1">
                    <div className="absolute left-0 top-0 h-full w-1/2 bg-[#a1a1aa] rounded-full"></div>
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full border-2 border-[#1a1a1a]"></div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-white text-[14px]">Max tokens</label>
                    <span className="text-white text-[14px]">2048</span>
                  </div>
                  <div className="w-full h-1 bg-[#404040] rounded-full relative mt-1">
                    <div className="absolute left-0 top-0 h-full w-[10%] bg-[#a1a1aa] rounded-full"></div>
                    <div className="absolute left-[10%] top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full border-2 border-[#1a1a1a]"></div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-white text-[14px]">Top P</label>
                    <span className="text-white text-[14px]">1.00</span>
                  </div>
                  <div className="w-full h-1 bg-[#404040] rounded-full relative mt-1">
                    <div className="absolute left-0 top-0 h-full w-full bg-[#a1a1aa] rounded-full"></div>
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full border-2 border-[#1a1a1a]"></div>
                  </div>
                </div>
              </div>

              {/* ChatKit */}
              <div className="flex flex-col gap-4 mt-2">
                <h3 className="text-[#a1a1aa] text-[13px] font-medium tracking-wide">ChatKit</h3>
                
                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Display response in chat</label>
                  <div className="w-[42px] h-[24px] bg-white rounded-full flex items-center justify-end px-0.5 cursor-pointer">
                    <div className="w-[20px] h-[20px] bg-black rounded-full shadow-sm" />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Show in-progress messages</label>
                  <div className="w-[42px] h-[24px] bg-white rounded-full flex items-center justify-end px-0.5 cursor-pointer">
                    <div className="w-[20px] h-[20px] bg-black rounded-full shadow-sm" />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Show search sources</label>
                  <div className="w-[42px] h-[24px] bg-white rounded-full flex items-center justify-end px-0.5 cursor-pointer">
                    <div className="w-[20px] h-[20px] bg-black rounded-full shadow-sm" />
                  </div>
                </div>
              </div>

              {/* Advanced */}
              <div className="flex flex-col gap-4 mt-2">
                <h3 className="text-[#a1a1aa] text-[13px] font-medium tracking-wide">Advanced</h3>
                
                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Continue on error</label>
                  <div className="w-[42px] h-[24px] bg-[#404040] rounded-full flex items-center justify-start px-0.5 cursor-pointer">
                    <div className="w-[20px] h-[20px] bg-[#a1a1aa] rounded-full shadow-sm" />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Write to conversation history</label>
                  <div className="w-[42px] h-[24px] bg-white rounded-full flex items-center justify-end px-0.5 cursor-pointer">
                    <div className="w-[20px] h-[20px] bg-black rounded-full shadow-sm" />
                  </div>
                </div>
              </div>

              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>

      </div>

      {/* Footer Settings */}
      <div className="px-5 pb-5 pt-0 shrink-0 bg-[#1a1a1a] rounded-b-[20px]">
        <div className="flex items-center justify-between pt-[18px] border-t border-[#333]">
          <button 
            onClick={() => {
              if (isExpanded) {
                // Smooth scroll up before starting the collapse animation
                scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                setIsClosing(true);
                // Wait for scroll to visually complete before triggering framer motion exit 
                setTimeout(() => {
                  setIsExpanded(false);
                  setIsClosing(false);
                }, 300);
              } else {
                setIsExpanded(true);
              }
            }}
            className="flex items-center gap-1.5 text-[#a1a1aa] hover:text-white transition-colors"
          >
            {isExpanded ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg> : <ChevronDown size={16} strokeWidth={2.5} />}
            <span className="text-[14px] font-medium">{isExpanded ? 'Less' : 'More'}</span>
          </button>
          <button className="flex items-center gap-1.5 text-[#a1a1aa] hover:text-white transition-colors">
            <span className="text-[14px] font-medium">Evaluate</span>
            <ExternalLink size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <InstructionsModal 
        isOpen={isInstructionsModalOpen}
        onClose={() => setIsInstructionsModalOpen(false)}
        initialValue={localInstructions}
        onSave={(val) => {
          setLocalInstructions(val);
          onInstructionsChange(val);
        }}
      />
    </div>
  );
};

interface GuardrailConfigPanelProps {
  nodeName: string;
  onNameChange: (newName: string) => void;
  config: {
    pii?: boolean;
    moderation?: boolean;
    jailbreak?: boolean;
    hallucination?: boolean;
    continueOnError?: boolean;
  };
  onConfigChange: (newConfig: any) => void;
}

const GuardrailConfigPanel: React.FC<GuardrailConfigPanelProps> = ({ nodeName, onNameChange, config, onConfigChange }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [localName, setLocalName] = useState(nodeName);

  const handleToggle = (key: keyof typeof config) => {
    onConfigChange({
      ...config,
      [key]: !config[key],
    });
  };

  const renderToggle = (label: string, key: keyof typeof config) => (
    <div className="flex items-center justify-between shrink-0">
      <div className="flex items-center gap-1.5 text-white text-[14.5px] font-medium">
        {label}
      </div>
      <div 
        onClick={() => handleToggle(key)}
        className={`w-[42px] h-[24px] rounded-full flex items-center px-0.5 cursor-pointer transition-colors ${config[key] ? 'bg-white justify-end' : 'bg-[#404040] justify-start'}`}
      >
        <div className={`w-[20px] h-[20px] rounded-full shadow-sm ${config[key] ? 'bg-black' : 'bg-[#a1a1aa]'}`} />
      </div>
    </div>
  );

  return (
    <div 
      className="absolute right-6 top-6 w-[340px] bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto"
      style={{
        maxHeight: 'calc(100% - 48px)', // Leaves 24px (top-6) and 24px (bottom-6) spacing when fully expanded
      }}
    >
      <div 
        ref={scrollContainerRef}
        className="p-5 pb-8 flex-1 flex flex-col gap-[18px] min-h-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {/* Fixed Header */}
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-white text-[16px] font-semibold tracking-wide">
            {localName || 'Guardrails'}
          </h2>
          <div className="flex items-center gap-3 text-[#a1a1aa]">
            <button className="hover:text-white transition-colors"><BookOpen size={16} strokeWidth={2.5} /></button>
            <button className="hover:text-white transition-colors"><Trash2 size={16} strokeWidth={2.5} /></button>
          </div>
        </div>
        <p className="text-[#a1a1aa] text-[13px] -mt-3.5 tracking-wide shrink-0">Run moderation, PII, jailbreak or fact checks</p>

        {/* Name Setting */}
        <div className="flex items-center justify-between gap-4 mt-2 shrink-0">
          <label className="text-white text-[14.5px] font-medium">Name</label>
          <div className="w-[220px] h-[32px] bg-[#2b2b2b] rounded-lg px-3 flex items-center">
            <input 
              type="text" 
              className="bg-transparent border-none outline-none text-white text-[14px] w-full placeholder:text-[#6a6a6a]" 
              placeholder="Guardrails" 
              value={localName}
              onChange={(e) => {
                setLocalName(e.target.value);
                onNameChange(e.target.value);
              }}
            />
          </div>
        </div>

        {/* Input Setting */}
        <div className="flex items-center justify-between gap-4 shrink-0 mt-1">
          <label className="text-white text-[14.5px] font-medium">Input</label>
          <div className="w-[220px] h-[32px] bg-[#2b2b2b] rounded-lg px-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-white">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#93dfca]"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" stroke="currentColor" strokeWidth="2.5"></rect><line x1="9" x2="15" y1="9" y2="9" stroke="currentColor" strokeWidth="2.5"></line><line x1="9" x2="15" y1="15" y2="15" stroke="currentColor" strokeWidth="2.5"></line><line x1="9" x2="12" y1="12" y2="12" stroke="currentColor" strokeWidth="2.5"></line></svg>
              <span className="text-[14px]">input_as_text</span>
            </div>
            <div className="flex items-center gap-1.5 text-[#a1a1aa] text-[12px] font-bold tracking-wider">
              STRING
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 10 12 15 17 10"/></svg>
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-4 mt-2 mb-2">
          {renderToggle('Personally identifiable information', 'pii')}
          {renderToggle('Moderation', 'moderation')}
          {renderToggle('Jailbreak', 'jailbreak')}
          {renderToggle('Hallucination', 'hallucination')}
          {renderToggle('Continue on error', 'continueOnError')}
        </div>
      </div>
    </div>
  );
};

export const AgentBuilderContent: React.FC<{ onClose?: () => void, isSidebarCollapsed?: boolean }> = ({ onClose, isSidebarCollapsed }) => {
  return (
    <ReactFlowProvider>
      <AgentBuilderFlow onClose={onClose} isSidebarCollapsed={isSidebarCollapsed} />
    </ReactFlowProvider>
  );
};

const AgentBuilderFlow: React.FC<{ onClose?: () => void, isSidebarCollapsed?: boolean }> = ({ onClose, isSidebarCollapsed = false }) => {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const { screenToFlowPosition } = useReactFlow();

  // Selector to grab the numeric zoom level from the internal React Flow store
  const zoom = useStore((s) => s.transform[2]);
  const zoomPercentage = Math.round(zoom * 100);

  const [isSelectingNewNode, setIsSelectingNewNode] = useState(false);
  const [activePlaceholderId, setActivePlaceholderId] = useState<string | null>(null);
  const connectingNodeId = useRef<string | null>(null);
  const connectingHandleId = useRef<string | null>(null);
  const lastConnectEndAt = useRef<number>(0);

  // Undo / Redo State
  const [past, setPast] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);

  const getCleanState = useCallback((currentNodes: Node[], currentEdges: Edge[]) => {
    const activePlaceholderIds = new Set(currentNodes.filter(n => n.type === 'placeholder').map(n => n.id));
    
    const cleanNodes = currentNodes.filter(n => !activePlaceholderIds.has(n.id)).map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
      ...(n.measured ? { measured: n.measured } : {}),
      ...(n.width ? { width: n.width } : {}),
      ...(n.height ? { height: n.height } : {}),
    })) as Node[];
    
    const cleanEdges = currentEdges.filter(e => !activePlaceholderIds.has(e.target) && !activePlaceholderIds.has(e.source)).map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      type: 'custom',
      ...(e.style ? { style: e.style } : {}),
    })) as Edge[];
    
    return { nodes: cleanNodes, edges: cleanEdges };
  }, []);

  const takeSnapshot = useCallback(() => {
    setPast((p) => {
      const newState = getCleanState(nodes, edges);

      if (p.length > 0) {
        const lastState = p[p.length - 1];
        if (
          JSON.stringify(lastState.nodes) === JSON.stringify(newState.nodes) &&
          JSON.stringify(lastState.edges) === JSON.stringify(newState.edges)
        ) {
          return p;
        }
      }

      return [...p.slice(-29), newState];
    });
    setFuture([]);
  }, [nodes, edges]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previousState = past[past.length - 1];
    const newPast = past.slice(0, -1);
    
    const currentStateCleaned = getCleanState(nodes, edges);
    setFuture((f) => [currentStateCleaned, ...f]);
    setPast(newPast);
    setNodes(previousState.nodes);
    setEdges(previousState.edges);
    setIsSelectingNewNode(false);
    setActivePlaceholderId(null);
  }, [past, nodes, edges, getCleanState, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const nextState = future[0];
    const newFuture = future.slice(1);
    
    const currentStateCleaned = getCleanState(nodes, edges);
    setPast((p) => [...p, currentStateCleaned]);
    setFuture(newFuture);
    setNodes(nextState.nodes);
    setEdges(nextState.edges);
    setIsSelectingNewNode(false);
    setActivePlaceholderId(null);
  }, [future, nodes, edges, getCleanState, setNodes, setEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => {
      takeSnapshot();
      connectSucceeded.current = true;
      setEdges((eds) => addEdge({ ...params, type: 'custom', style: { stroke: '#404040', strokeWidth: 2.5 } }, eds));
    },
    [takeSnapshot]
  );

  const connectSucceeded = useRef(false);

  const onConnectStart = useCallback((_: any, { nodeId, handleId }: any) => {
    connectingNodeId.current = nodeId;
    connectingHandleId.current = handleId;
    connectSucceeded.current = false;
  }, []);

  const onConnectEnd = useCallback(
    (event: any, connectionState: any) => {
      lastConnectEndAt.current = Date.now();
      if (!connectingNodeId.current) return;

      if (!connectionState.isValid) {
        const clientX = event.changedTouches ? event.changedTouches[0].clientX : event.clientX;
        const clientY = event.changedTouches ? event.changedTouches[0].clientY : event.clientY;

        const rawPosition = screenToFlowPosition({ x: clientX, y: clientY });
        const position = {
          x: rawPosition.x,
          y: rawPosition.y - 36.5, // Offset by half the node height so the center-left handle perfectly hits the mouse
        };

        const id = `placeholder_${Date.now()}`;
        const newNode: Node = {
          id,
          type: 'placeholder',
          position,
          data: { label: '+ New node' },
        };

        const sourceNodeId = connectingNodeId.current!;
        const sourceHandleId = connectingHandleId.current || undefined;

        setNodes((nds) => nds.concat(newNode));
        setEdges((eds) =>
          eds.concat({
            id: `e_${sourceNodeId}-${id}`,
            source: sourceNodeId,
            target: id,
            sourceHandle: sourceHandleId,
            type: 'custom',
            style: { stroke: '#404040', strokeWidth: 2.5 },
          })
        );
        setIsSelectingNewNode(true);
        setActivePlaceholderId(id);
      }
      
      connectingNodeId.current = null;
      connectingHandleId.current = null;
    },
    [screenToFlowPosition, setNodes, setEdges, takeSnapshot]
  );

  const abortPlaceholder = useCallback(() => {
    if (isSelectingNewNode && activePlaceholderId) {
      setNodes((nds) => nds.filter((n) => n.id !== activePlaceholderId));
      setEdges((eds) => eds.filter((e) => e.target !== activePlaceholderId && e.source !== activePlaceholderId));
      setIsSelectingNewNode(false);
      setActivePlaceholderId(null);
    }
  }, [isSelectingNewNode, activePlaceholderId, setNodes, setEdges, takeSnapshot]);

  const onPaneClick = useCallback(() => {
    if (Date.now() - lastConnectEndAt.current < 200) return;
    abortPlaceholder();
  }, [abortPlaceholder]);

  const onMoveStart = useCallback(() => {
    abortPlaceholder();
  }, [abortPlaceholder]);

  const getDefaultLabelForType = (type: string) => {
    switch (type) {
      case 'agent': return 'Agent';
      case 'if-else': return 'If / else';
      case 'mcp': return 'MCP tool';
      case 'note': return 'Note';
      case 'guardrail': return 'Guardrails';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const handleSidebarClick = useCallback((newType: string) => {
    if (isSelectingNewNode && activePlaceholderId) {
      takeSnapshot();
      setNodes((nds) => nds.map((node) => {
        if (node.id === activePlaceholderId) {
          return { ...node, type: newType, data: { label: getDefaultLabelForType(newType) }, selected: true };
        }
        return { ...node, selected: false };
      }));
      setIsSelectingNewNode(false);
      setActivePlaceholderId(null);
    }
  }, [isSelectingNewNode, activePlaceholderId, setNodes, takeSnapshot]);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';

    const button = event.currentTarget as HTMLElement;
    const iconContainer = button.querySelector('div');
    const span = button.querySelector('span');
    
    if (iconContainer && span) {
      const dragEl = document.createElement('div');
      dragEl.style.position = 'absolute';
      dragEl.style.top = '-10000px';
      dragEl.style.left = '-10000px';
      
      dragEl.className = 'flex items-center gap-3 py-2 pl-2 pr-4 bg-[#1f1f1f] rounded-[14px] shadow-2xl';
      
      const bgClass = Array.from(iconContainer.classList).find(c => c.startsWith('bg-['));
      
      dragEl.innerHTML = `
        <div class="w-8 h-8 rounded-[10px] ${bgClass || ''} flex items-center justify-center shrink-0">
          ${iconContainer.innerHTML}
        </div>
        <span class="text-gray-200 text-[14px] font-medium pr-1">${span.textContent}</span>
      `;
      
      const svg = dragEl.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        // Clear any custom relative offsets used in the sidebar buttons
        svg.classList.remove('relative', 'left-[1.5px]', 'top-[1.5px]', 'top-px');
      }

      document.body.appendChild(dragEl);
      
      // Node height is ~48px (16px padding + 32px icon). Center of the left connecting circle is exactly halfway (24px).
      event.dataTransfer.setDragImage(dragEl, 0, 24);
      
      setTimeout(() => {
        if (document.body.contains(dragEl)) {
          document.body.removeChild(dragEl);
        }
      }, 0);
    }
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `dndnode_${Date.now()}`,
        type,
        position: {
          x: position.x,
          y: Math.round(position.y - 36.5),
        },
        data: { label: getDefaultLabelForType(type) },
        selected: true,
      };

      takeSnapshot();
      setNodes((nds) => (nds.map(n => ({ ...n, selected: false })) as Node[]).concat(newNode));
    },
    [screenToFlowPosition, setNodes, takeSnapshot]
  );

  return (
    <div className="flex flex-col h-full w-full bg-[#0e0e0e] text-white">
      {/* Main Builder Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Floating Sidebar (Nodes Palette) */}
        <div className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 w-56 bg-[#1b1b1b] rounded-2xl flex flex-col pt-4 pb-2 shadow-2xl overflow-y-auto overflow-x-hidden transition-all duration-300 [&::-webkit-scrollbar]:hidden ${isSelectingNewNode ? 'ring-2 ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)]' : ''}`} style={{ maxHeight: '680px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

          {/* Core Section */}
          <div className="mb-2">
            <h3 className="text-[13px] font-medium text-gray-400 px-5 mb-[16px]">Core</h3>
            <div className="flex flex-col gap-0.5 px-3">
              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('agent')}
                onDragStart={(e) => onDragStart(e, 'agent')} 
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#7a9efa] flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="8 8 92 92" width="24" height="24" className="text-black relative left-[1.5px] top-[1.5px]">
                    <path d="M 36 28 L 72 40 Q 84 44 75 47 L 63 51 Q 54 54 51 63 L 47 75 Q 44 84 40 72 L 28 36 Q 24 24 36 28 Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeLinejoin="round"
                          strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[14px] font-medium text-gray-200">Agent</span>
              </button>

              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('end')}
                onDragStart={(e) => onDragStart(e, 'end')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#93dfca] flex items-center justify-center shrink-0">
                  <Square size={16} strokeWidth={2.75} rx={4.5} ry={4.5} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">End</span>
              </button>

              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('note')}
                onDragStart={(e) => onDragStart(e, 'note')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#b8b8b8] flex items-center justify-center shrink-0">
                  <StickyNote size={16} strokeWidth={2.75} rx={3} ry={3} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">Note</span>
              </button>
            </div>
          </div>

          {/* Tools Section */}
          <div className="mb-2 mt-[16px]">
            <h3 className="text-[13px] font-medium text-gray-400 px-5 mb-[16px]">Tools</h3>
            <div className="flex flex-col gap-0.5 px-3">
              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('fileSearch')}
                onDragStart={(e) => onDragStart(e, 'fileSearch')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#fddd41] flex items-center justify-center shrink-0">
                  <Database size={16} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">File search</span>
              </button>

              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('guardrail')}
                onDragStart={(e) => onDragStart(e, 'guardrail')} 
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#ffff80] flex items-center justify-center shrink-0">
                  <ShieldCheck size={16} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">Guardrails</span>
              </button>

              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('mcp')}
                onDragStart={(e) => onDragStart(e, 'mcp')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#fddd41] flex items-center justify-center shrink-0">
                  <Blocks size={16} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">MCP</span>
              </button>
            </div>
          </div>

          {/* Logic Section */}
          <div className="mb-2 mt-[16px]">
            <h3 className="text-[13px] font-medium text-gray-400 px-5 mb-[16px]">Logic</h3>
            <div className="flex flex-col gap-0.5 px-3">
              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('ifElse')}
                onDragStart={(e) => onDragStart(e, 'ifElse')} 
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#f4b13b] flex items-center justify-center shrink-0">
                  <Split size={16} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black rotate-90" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">If / else</span>
              </button>

              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('while')}
                onDragStart={(e) => onDragStart(e, 'while')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#f4b13b] flex items-center justify-center shrink-0">
                  <RefreshCw size={16} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">While</span>
              </button>

              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('userApproval')}
                onDragStart={(e) => onDragStart(e, 'userApproval')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#f4b13b] flex items-center justify-center shrink-0">
                  <ThumbsUp size={16} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">User approval</span>
              </button>
            </div>
          </div>

          {/* Data Section */}
          <div className="mb-6 mt-[16px]">
            <h3 className="text-[13px] font-medium text-gray-400 px-5 mb-[16px]">Data</h3>
            <div className="flex flex-col gap-0.5 px-3">
              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('transform')}
                onDragStart={(e) => onDragStart(e, 'transform')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#a855f7] flex items-center justify-center shrink-0">
                  <Shuffle size={16} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">Transform</span>
              </button>

              <button 
                className="flex items-center gap-3 px-3 pl-2 py-2 hover:bg-[#141414] rounded-lg transition-colors group cursor-grab active:cursor-grabbing"
                onClick={() => handleSidebarClick('setState')}
                onDragStart={(e) => onDragStart(e, 'setState')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#a855f7] flex items-center justify-center shrink-0">
                  <CircleDashed size={16} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
                </div>
                <span className="text-[14px] font-medium text-gray-200">Set state</span>
              </button>
            </div>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 relative bg-[#0c0c0c]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodesDelete={takeSnapshot}
            onEdgesDelete={takeSnapshot}
            onNodeDragStart={takeSnapshot}
            onNodeClick={abortPlaceholder}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onPaneClick={onPaneClick}
            onMoveStart={onMoveStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            connectionLineType={ConnectionLineType.Bezier}
            connectionLineComponent={CustomConnectionLine}
            connectionLineContainerStyle={{ zIndex: 0 }}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ style: { stroke: '#404040', strokeWidth: 2.5 }, type: 'custom' }}
            className="xyflow-dark"
          >
            <style>{`
              @keyframes nodeDrop {
                0% { opacity: 0; }
                100% { opacity: 1; }
              }
              .animate-node-drop {
                animation: nodeDrop 0.2s ease-out forwards;
              }
            `}</style>
            <Background gap={28} size={2} color="#27272a" />
            
            {(() => {
              if (!isSidebarCollapsed) return null;
              
              const selectedAgentNode = nodes.find(n => n.selected && n.type === 'agent');
              if (selectedAgentNode) {
                return (
                  <AgentConfigPanel 
                    nodeName={(selectedAgentNode.data?.label as string) || ''}
                    onNameChange={(newName) => {
                      setNodes((nds) => 
                        nds.map((n) => {
                          if (n.id === selectedAgentNode.id) {
                            return { ...n, data: { ...n.data, label: newName } };
                          }
                          return n;
                        })
                      );
                    }}
                    instructions={(selectedAgentNode.data?.instructions as string) || ''}
                    onInstructionsChange={(newInst) => {
                      setNodes((nds) => 
                        nds.map((n) => {
                          if (n.id === selectedAgentNode.id) {
                            return { ...n, data: { ...n.data, instructions: newInst } };
                          }
                          return n;
                        })
                      );
                    }}
                  />
                );
              }
              
              const selectedGuardrailNode = nodes.find(n => n.selected && n.type === 'guardrail');
              if (selectedGuardrailNode) {
                return (
                  <GuardrailConfigPanel 
                    nodeName={(selectedGuardrailNode.data?.label as string) || ''}
                    onNameChange={(newName) => {
                      setNodes((nds) => 
                        nds.map((n) => {
                          if (n.id === selectedGuardrailNode.id) {
                            return { ...n, data: { ...n.data, label: newName } };
                          }
                          return n;
                        })
                      );
                    }}
                    config={(selectedGuardrailNode.data?.config as any) || {}}
                    onConfigChange={(newConfig) => {
                      const hasActiveGuardrail = newConfig?.pii || newConfig?.moderation || newConfig?.jailbreak || newConfig?.hallucination || newConfig?.continueOnError;

                      // If all options are toggled off, instantly snip and delete any connections extending from the passing/failing handles.
                      if (!hasActiveGuardrail) {
                        setEdges((eds) => eds.filter(e => !(e.source === selectedGuardrailNode.id && (e.sourceHandle === 'pass' || e.sourceHandle === 'fail'))));
                      }

                      setNodes((nds) => 
                        nds.map((n) => {
                          if (n.id === selectedGuardrailNode.id) {
                            return { ...n, data: { ...n.data, config: newConfig } };
                          }
                          return n;
                        })
                      );
                    }}
                  />
                );
              }
              
              return null;
            })()}

            <Panel position="top-right" className="mt-6 mr-6">
              <div className="flex items-center justify-center px-3 py-1.5 h-8 bg-black/40 backdrop-blur-md rounded-xl text-white text-xs font-semibold shadow-xl">
                {zoomPercentage}%
              </div>
            </Panel>
            
            <Panel position="bottom-center" className="mb-8">
              <div className="flex items-center gap-3 px-3 py-2 bg-[#2b2b2b] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <button className="w-10 h-10 bg-[#404040] rounded-full text-white transition-colors flex items-center justify-center shrink-0">
                  <Hand size={20} strokeWidth={2} className="relative top-px" />
                </button>
                <button className="w-10 h-10 text-white hover:bg-[#404040] rounded-full transition-colors flex items-center justify-center shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="16 16 76 76" width="22" height="22" className="relative left-[1px] top-[1px]">
                    <path d="M 36 28 L 72 40 Q 84 44 75 47 L 63 51 Q 54 54 51 63 L 47 75 Q 44 84 40 72 L 28 36 Q 24 24 36 28 Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="5"
                          strokeLinejoin="round"
                          strokeLinecap="round" />
                  </svg>
                </button>
                <button 
                  className={`w-10 h-10 rounded-full transition-colors flex items-center justify-center shrink-0 ${past.length > 0 ? 'text-white hover:bg-[#404040]' : 'text-gray-500 cursor-not-allowed opacity-50'}`}
                  onClick={undo}
                  disabled={past.length === 0}
                >
                  <Undo2 size={20} strokeWidth={2} />
                </button>
                <button 
                  className={`w-10 h-10 rounded-full transition-colors flex items-center justify-center shrink-0 ${future.length > 0 ? 'text-white hover:bg-[#404040]' : 'text-gray-500 cursor-not-allowed opacity-50'}`}
                  onClick={redo}
                  disabled={future.length === 0}
                >
                  <Redo2 size={20} strokeWidth={2} />
                </button>
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </div>
    </div>
  );
};

export const AgentBuilder: React.FC<{ onClose?: () => void, isSidebarCollapsed?: boolean }> = ({ onClose, isSidebarCollapsed }) => {
  return (
    <ReactFlowProvider>
      <AgentBuilderContent onClose={onClose} isSidebarCollapsed={isSidebarCollapsed} />
    </ReactFlowProvider>
  );
};

export default AgentBuilder;
