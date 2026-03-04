import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUserDataContext } from '../../context/UserDataContext';
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
  useHandleConnections,
  useOnViewportChange
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
  ExternalLink,
  Search,
  Check,
  Globe,
  Code,
  Settings,
  X,
  Plus as PlusIcon,
  Wand2
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
    // Reverted border-[2px] border-dashed back to border-[2.5px]
    // Reverted rounded-[18px] back to rounded-[24px]
    // Increased opacity to /80 and added backdrop-blur-md and backdrop-saturate-150 for a beautiful glass effect over other nodes
    <div className={`flex items-center justify-center gap-2.5 py-3 px-4 bg-[#232323]/80 backdrop-blur-md backdrop-saturate-150 rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <Handle 
        type="target" 
        position={Position.Left} 
        isConnectable={false}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
      {/* We add h-11 here strictly to force the exact same vertical height as before, but without any width/padding, so it stays horizontally compact */}
      <div className="h-11 flex items-center justify-center">
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
              animation: 'handleAppear 0s 0.25s backwards'
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
              animation: 'handleAppear 0s 0.25s backwards'
            }}
            className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
          />
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

interface APIModel {
  name: string;
  displayName: string;
  description: string;
}

const formatModelName = (displayName: string) => {
  return displayName.replace(/^Gemini\s+/, '').replace(/\s+Preview$|\s+Experimental$/, '');
};

const AgentConfigPanel: React.FC<AgentConfigPanelProps> = ({ nodeName, onNameChange, instructions, onInstructionsChange }) => {
  const { apiKeys } = useUserDataContext();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLDivElement>(null);

  // Local state for the input to allow immediate typing before the flow state updates
  const [localName, setLocalName] = useState(nodeName);
  const [localInstructions, setLocalInstructions] = useState(instructions);
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false);

  // Model Selector State
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [models, setModels] = useState<APIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<APIModel | null>({
    name: 'models/gemini-3-flash',
    displayName: 'Gemini 3 Flash',
    description: ''
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, right: 0, width: 0 });

  // Output Format State
  const [isAgentFormatDropdownOpen, setIsAgentFormatDropdownOpen] = useState(false);
  const agentFormatDropdownRef = useRef<HTMLDivElement>(null);
  const agentFormatDropdownButtonRef = useRef<HTMLDivElement>(null);
  const [agentFormatDropdownPosition, setAgentFormatDropdownPosition] = useState({ top: 0, left: 0, right: 0, width: 0 });
  const [selectedAgentFormat, setSelectedAgentFormat] = useState('Text');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (
        agentFormatDropdownRef.current && !agentFormatDropdownRef.current.contains(target) &&
        agentFormatDropdownButtonRef.current && !agentFormatDropdownButtonRef.current.contains(target)
      ) {
        setIsAgentFormatDropdownOpen(false);
      }
    };
    if (isAgentFormatDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isAgentFormatDropdownOpen]);

  useEffect(() => {
    // If Format is set to Image but the newly selected model does not support images, revert to Text
    if (selectedAgentFormat === 'Image' && selectedModel && !selectedModel.name.toLowerCase().includes('image')) {
      setSelectedAgentFormat('Text');
    }
  }, [selectedModel, selectedAgentFormat]);

  // Tools Selector State
  const [isToolsDropdownOpen, setIsToolsDropdownOpen] = useState(false);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);
  const toolsDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const [toolsDropdownPosition, setToolsDropdownPosition] = useState({ top: 0, left: 0, right: 0 });

  // MCP Modal State
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);
  const [mcpTab, setMcpTab] = useState<'All' | 'Hosted' | 'Third-party'>('All');
  const [mcpView, setMcpView] = useState<'list' | 'connect' | 'connector'>('list');
  const [selectedConnector, setSelectedConnector] = useState<{name: string, iconUrl: string, color: string, features?: string[]} | null>(null);
  const [mcpForm, setMcpForm] = useState({
    url: '',
    label: '',
    description: '',
    authType: 'Access token / API key',
    token: ''
  });
  const [isMcpAuthDropdownOpen, setIsMcpAuthDropdownOpen] = useState(false);
  const mcpAuthDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mcpAuthDropdownRef.current && !mcpAuthDropdownRef.current.contains(event.target as globalThis.Node)) {
        setIsMcpAuthDropdownOpen(false);
      }
    };
    
    if (isMcpAuthDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMcpAuthDropdownOpen]);

  // File Search Modal State
  const [isFileSearchModalOpen, setIsFileSearchModalOpen] = useState(false);

  // Code Interpreter Modal State
  const [isCodeInterpreterModalOpen, setIsCodeInterpreterModalOpen] = useState(false);

  // Function Modal State
  const [isFunctionModalOpen, setIsFunctionModalOpen] = useState(false);

  // JSON Schema Modal State
  const [isJsonSchemaModalOpen, setIsJsonSchemaModalOpen] = useState(false);
  const [jsonSchemaMode, setJsonSchemaMode] = useState<'Simple' | 'Advanced'>('Simple');
  const [jsonSchemaName, setJsonSchemaName] = useState('response_schema');
  const [jsonSchemaProperties, setJsonSchemaProperties] = useState<Array<{ id: number, name: string, type: string, description: string }>>([{ id: Date.now(), name: '', type: 'String', description: '' }]);
  const [jsonSchemaRaw, setJsonSchemaRaw] = useState('{\n  "type": "object",\n  "properties": {\n    \n  }\n}');

  // Custom Tool Modal State
  const [isCustomToolModalOpen, setIsCustomToolModalOpen] = useState(false);
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('Text');
  const formatDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (formatDropdownRef.current && !formatDropdownRef.current.contains(event.target as globalThis.Node)) {
        setIsFormatDropdownOpen(false);
      }
    };
    
    if (isFormatDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFormatDropdownOpen]);

  useOnViewportChange({
    onStart: () => {
      setIsModelDropdownOpen(false);
      setIsToolsDropdownOpen(false);
      setIsFormatDropdownOpen(false);
    }
  });

  // Fetch Models from Gemini API using user's API key from Settings
  const geminiApiKey = apiKeys?.gemini?.[0];
  useEffect(() => {
    const fetchModels = async () => {
      if (!geminiApiKey) return;

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`);
        if (response.ok) {
          const data = await response.json();
          
          if (!data.models || !Array.isArray(data.models)) {
            return;
          }

          // Filter to only models matching user's requested keywords: flash, pro, flash-lite
          const filtered = data.models.filter((m: any) => {
            const lowerName = m.name.toLowerCase();
            return lowerName.includes('flash') || lowerName.includes('pro');
          }).map((m: any) => ({
            name: m.name,
            displayName: m.displayName || m.name.split('/').pop() || m.name,
            description: m.description || '',
          }));

          if (filtered.length > 0) {
            setModels(filtered);
            // Default to the first "3 flash" or "flash" model found in the real data
            // Default to '3 flash' -> any '3' -> any 'flash' -> first model found
            const defaultModel = filtered.find((m: any) => m.name.toLowerCase().includes('gemini-3') && m.name.toLowerCase().includes('flash')) || 
                                 filtered.find((m: any) => m.name.toLowerCase().includes('gemini-3')) || 
                                 filtered.find((m: any) => m.name.toLowerCase().includes('flash')) || 
                                 filtered[0];
            setSelectedModel(defaultModel);
          }
        }
      } catch (error) {
        // Silently fail - dropdown will remain empty
      }
    };

    fetchModels();
  }, [geminiApiKey]);

  // Handle Model Dropdown Click Outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;

      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        dropdownButtonRef.current && !dropdownButtonRef.current.contains(target)
      ) {
         // If clicking randomly in the canvas, just hide the dropdown instantly (react flow behavior)
        setIsModelDropdownOpen(false);
      }
    };
    
    if (isModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  // Handle Tools Dropdown Click Outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;

      if (
        toolsDropdownRef.current && !toolsDropdownRef.current.contains(target) &&
        toolsDropdownButtonRef.current && !toolsDropdownButtonRef.current.contains(target)
      ) {
         setIsToolsDropdownOpen(false);
      }
    };
    
    if (isToolsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isToolsDropdownOpen]);

  // Track position of the dropdown button for exactly placing the portal
  useLayoutEffect(() => {
    if (isModelDropdownOpen && dropdownButtonRef.current) {
      const rect = dropdownButtonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
        right: window.innerWidth - rect.right,
        width: rect.width
      });
    }
  }, [isModelDropdownOpen, isExpanded]);

  // Track position of the tools dropdown button
  useLayoutEffect(() => {
    if (isToolsDropdownOpen && toolsDropdownButtonRef.current) {
      const rect = toolsDropdownButtonRef.current.getBoundingClientRect();
      setToolsDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
        right: window.innerWidth - rect.right
      });
    }
  }, [isToolsDropdownOpen, isExpanded]);

  // Track position of the output format dropdown button
  useLayoutEffect(() => {
    if (isAgentFormatDropdownOpen && agentFormatDropdownButtonRef.current) {
      const rect = agentFormatDropdownButtonRef.current.getBoundingClientRect();
      setAgentFormatDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
        right: window.innerWidth - rect.right,
        width: rect.width
      });
    }
  }, [isAgentFormatDropdownOpen, isExpanded]);

  // Sync state when props change (switching nodes of same type)
  useEffect(() => {
    setLocalName(nodeName);
    setLocalInstructions(instructions);
  }, [nodeName, instructions]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 15, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 35, mass: 0.8 }}
      className="absolute right-6 top-6 w-[340px] bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto"
      style={{
        maxHeight: 'calc(100% - 48px)', // Leaves 24px (top-6) and 24px (bottom-6) spacing when fully expanded
      }}
    >
      <div 
        ref={scrollContainerRef}
        className="p-5 flex-1 flex flex-col gap-[18px] min-h-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden relative"
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

        <div className="flex items-center justify-between shrink-0 relative">
          <label className="text-white text-[14.5px] font-medium">Model</label>
          <div 
            ref={dropdownButtonRef}
            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            className="flex items-center gap-1.5 text-gray-300 cursor-pointer hover:text-white transition-colors"
          >
            <span className="text-[14px] font-medium">
              {selectedModel 
                ? (formatModelName(selectedModel.displayName).length > 25 
                  ? formatModelName(selectedModel.displayName).slice(0, 25) + '...' 
                  : formatModelName(selectedModel.displayName))
                : 'Select a model...'}
            </span>
            <ChevronDown size={16} className={`text-[#a1a1aa] transition-transform duration-200 ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
          </div>

          {createPortal(
            <AnimatePresence>
              {isModelDropdownOpen && (
                <motion.div
                  ref={dropdownRef}
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  className="fixed w-[280px] bg-[#1f1f1f] border border-[#333] rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] z-[99999] overflow-hidden flex flex-col"
                  style={{
                    top: dropdownPosition.top,
                    right: dropdownPosition.right
                  }}
                >
                  {/* Search Header */}
                  <div className="p-3 border-b border-[#333] shrink-0">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a1a1aa]" size={14} />
                      <input
                        type="text"
                        className="w-full bg-[#111] text-white text-[13px] rounded-lg pl-9 pr-3 py-2 outline-none border border-transparent focus:border-[#444] transition-colors placeholder:text-[#6a6a6a]"
                        placeholder="Select a model..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  {/* Model List */}
                  <div className="max-h-[260px] overflow-y-auto [&::-webkit-scrollbar]:hidden scrollbar-none pb-1">
                    {models
                      .filter(m => 
                        m.displayName.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((model) => (
                      <div
                        key={model.name}
                        onClick={() => {
                          setSelectedModel(model);
                          setIsModelDropdownOpen(false);
                        }}
                        className="flex items-center gap-3 px-3 py-2.5 mx-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[#252525]"
                      >
                        <div className="shrink-0 flex items-center justify-center w-4 h-4">
                          {selectedModel?.name === model.name && <Check size={14} className="text-white" />}
                        </div>
                        <span className="text-white text-[13px] font-medium">{formatModelName(model.displayName)}</span>
                      </div>
                    ))}
                    
                    {models.filter(m => m.displayName.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                      <div className="px-5 py-4 text-center text-[#a1a1aa] text-[13px]">
                        No models found
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
        </div>

        <div className="flex items-center justify-between shrink-0 relative">
          <label className="text-white text-[14.5px] font-medium">Tools</label>
          <button 
            ref={toolsDropdownButtonRef}
            onClick={() => setIsToolsDropdownOpen(!isToolsDropdownOpen)}
            className="text-[#a1a1aa] hover:text-white transition-colors p-[5px] -mr-1 rounded hover:bg-[#2b2b2b]"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>

          {/* Tools Selector Dropdown (Portaled to avoid clipping) */}
          {createPortal(
            <AnimatePresence>
              {isToolsDropdownOpen && (
                <motion.div 
                  ref={toolsDropdownRef}
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="fixed bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl z-[999999] overflow-hidden flex flex-col pointer-events-auto"
                  style={{
                    top: toolsDropdownPosition.top,
                    right: toolsDropdownPosition.right - 5,
                    width: '240px'
                  }}
                >
                  <div className="flex flex-col py-2">
                    {/* Hosted Section */}
                    <div className="px-3 pb-1.5 text-[11.5px] text-[#888] font-medium tracking-wide">Hosted</div>
                    <button 
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        setIsMCPModalOpen(true);
                      }}
                      className="flex items-center gap-3 px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group"
                    >
                      <Blocks size={15} strokeWidth={1.5} className="text-[#a1a1aa] group-hover:text-white transition-colors" />
                      MCP server
                    </button>
                    <button 
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        setIsFileSearchModalOpen(true);
                      }}
                      className="flex items-center gap-3 px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group"
                    >
                      <Database size={15} strokeWidth={1.5} className="text-[#a1a1aa] group-hover:text-white transition-colors" />
                      File search
                    </button>
                    <button className="flex items-center gap-3 px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group">
                      <Globe size={15} strokeWidth={1.5} className="text-[#a1a1aa] group-hover:text-white transition-colors" />
                      Web search
                    </button>
                    <button 
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        setIsCodeInterpreterModalOpen(true);
                      }}
                      className="flex items-center gap-3 px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group"
                    >
                      <Code size={15} strokeWidth={1.5} className="text-[#a1a1aa] group-hover:text-white transition-colors" />
                      Code Interpreter
                    </button>

                    <div className="h-[1px] bg-[#333] my-1.5 mx-3" />

                    {/* Local Section */}
                    <div className="px-3 py-1.5 pt-1 text-[11.5px] text-[#888] font-medium tracking-wide">Local</div>
                    <button 
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        setIsFunctionModalOpen(true);
                      }}
                      className="flex items-center gap-3 px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group"
                    >
                      <div className="w-[15px] h-[15px] flex items-center justify-center font-mono text-[11px] font-bold text-[#a1a1aa] group-hover:text-white transition-colors leading-none tracking-tighter">
                        {"{f}"}
                      </div>
                      Function
                    </button>
                    <button 
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        setIsCustomToolModalOpen(true);
                      }}
                      className="flex items-center gap-[11px] px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group"
                    >
                      <Settings size={15} strokeWidth={1.5} className="ml-[1px] text-[#a1a1aa] group-hover:text-white transition-colors" />
                      Custom
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
        </div>

        {/* Wrapper for the last visible element and the expandable content to prevent flex gap collapse jumping on unmount */}
        <div className="flex flex-col shrink-0 relative">
          <div className="flex items-center justify-between">
            <label className="text-white text-[14.5px] font-medium">Output format</label>
            <div 
              ref={agentFormatDropdownButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                setIsAgentFormatDropdownOpen(!isAgentFormatDropdownOpen);
              }}
              className="flex items-center gap-1.5 text-gray-300 cursor-pointer hover:text-white transition-colors py-1 pl-3 pr-1 rounded-md hover:bg-[#2b2b2b] -mr-1"
            >
              <span className="text-[14px] font-medium">{selectedAgentFormat}</span>
              <ChevronDown size={16} className={`text-[#a1a1aa] transition-transform duration-200 ${isAgentFormatDropdownOpen ? 'rotate-180' : ''}`} />
            </div>

            {createPortal(
              <AnimatePresence>
                {isAgentFormatDropdownOpen && (
                  <motion.div
                    ref={agentFormatDropdownRef}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.15 }}
                    className="fixed bg-[#2b2b2b] border border-[#333] rounded-[10px] shadow-xl py-1 z-[999999] overflow-hidden"
                    style={{
                      top: agentFormatDropdownPosition.top,
                      right: agentFormatDropdownPosition.right,
                      width: '140px'
                    }}
                  >
                    {['Text', 'JSON', ...(selectedModel?.name.toLowerCase().includes('image') ? ['Image'] : [])].map((formatOption) => (
                      <button
                        key={formatOption}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAgentFormat(formatOption);
                          setIsAgentFormatDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3.5 py-2 text-[13.5px] flex items-center justify-between transition-colors ${
                          selectedAgentFormat === formatOption 
                            ? 'text-white bg-[#333] font-medium' 
                            : 'text-[#a1a1aa] hover:bg-[#333] hover:text-white'
                        }`}
                      >
                        {formatOption}
                        {selectedAgentFormat === formatOption && (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>,
              document.body
            )}
          </div>

          {/* Conditional JSON Schema Button */}
          <AnimatePresence initial={false}>
            {selectedAgentFormat === 'JSON' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ 
                  height: 'auto', 
                  opacity: 1,
                  transition: { 
                    height: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2, delay: 0.05 }
                  }
                }}
                exit={{ 
                  height: 0, 
                  opacity: 0,
                  transition: { 
                    height: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
                    opacity: { duration: 0.1 }
                  }
                }}
                className="overflow-hidden"
              >
                <div className="mt-2.5 w-[fit-content]">
                  <button 
                    onClick={() => {
                      setJsonSchemaMode('Simple');
                      setJsonSchemaName('response_schema');
                      setJsonSchemaProperties([{ id: Date.now(), name: '', type: 'String', description: '' }]);
                      setJsonSchemaRaw('{\n  "type": "object",\n  "properties": {\n    \n  }\n}');
                      setIsJsonSchemaModalOpen(true);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#2b2b2b] hover:bg-[#333] transition-colors rounded-full"
                  >
                    <Plus size={14} className="text-[#a1a1aa]" />
                    <span className="text-white text-[13px] font-medium pr-1">Add schema</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* --- Expanded Content --- */}
          <AnimatePresence initial={false}>
            {(isExpanded || isClosing) && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ 
                  height: 'auto', 
                  transition: { 
                    height: { type: "spring", stiffness: 70, damping: 20, mass: 1.5, restDelta: 2 }
                  }
                }}
                exit={{ 
                  height: 0, 
                  transition: { 
                    height: { duration: 0.35, ease: [0.32, 0.72, 0, 1] }
                  }
                }}
                className="overflow-hidden"
                onUpdate={(latest) => {
                  const el = document.querySelector('[data-expand-container]') as HTMLElement;
                  if (!el) return;
                  if (isExpanded && typeof latest.height === 'number' && el.scrollHeight > 0 && Math.abs(latest.height - el.scrollHeight) < 3) {
                    el.style.overflow = 'visible';
                  }
                }}
                onAnimationStart={() => {
                  const el = document.querySelector('[data-expand-container]') as HTMLElement;
                  if (el) el.style.overflow = 'hidden';
                }}
                data-expand-container
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
                const isScrolled = scrollContainerRef.current && scrollContainerRef.current.scrollTop > 0;
                
                if (isScrolled) {
                  // If scrolled down, scroll up smoothly first, then animate collapse
                  scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                  setIsClosing(true);
                  setTimeout(() => {
                    setIsExpanded(false);
                    setIsClosing(false);
                  }, 300);
                } else {
                  // If already at the top, collapse instantly without the artificial 300ms delay
                  setIsExpanded(false);
                }
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

      {/* Add MCP Server Modal */}
      {createPortal(
        <AnimatePresence>
          {isMCPModalOpen && (
            <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => {
                  setIsMCPModalOpen(false);
                  setMcpView('list');
                }}
              />

              {/* Modal Content */}
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98, height: 580 }}
                animate={{ opacity: 1, y: 0, scale: 1, height: mcpView === 'list' ? 580 : mcpView === 'connect' ? 720 : (520 + (selectedConnector?.features?.length || 0) * 36) }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[600px] rounded-[16px] shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Close Button OVERLAY (always visible) */}
                <button 
                  onClick={() => {
                    setIsMCPModalOpen(false);
                    setMcpView('list');
                  }}
                  className="absolute top-5 right-5 text-gray-400 hover:text-black dark:hover:text-white transition-colors p-1 z-[100]"
                >
                  <X size={20} strokeWidth={2} />
                </button>

                <AnimatePresence mode="wait">
                  {mcpView === 'list' ? (
                    <motion.div
                      key="mcp-list"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="flex flex-col h-full"
                    >
                      {/* Modal Header for List View */}
                      <div className="px-6 pt-6 pb-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative">
                        <h2 className="text-[20px] font-semibold text-black dark:text-white mb-4">Add MCP server</h2>
                        
                        <div className="flex items-center justify-between">
                          {/* Tabs */}
                          <div className="flex items-center bg-[#f1f1f1] dark:bg-[#2b2b2b] p-1 rounded-[10px]">
                            {(['All', 'Hosted', 'Third-party'] as const).map(tab => (
                              <button
                                key={tab}
                                onClick={() => setMcpTab(tab)}
                                className={`px-3 py-1.5 rounded-[8px] text-[13.5px] font-medium transition-all ${
                                  mcpTab === tab 
                                    ? 'bg-white dark:bg-[#3d3d3d] text-black dark:text-white shadow-sm' 
                                    : 'text-[#666] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white'
                                }`}
                              >
                                {tab}
                              </button>
                            ))}
                          </div>

                          <button 
                            onClick={() => {
                              setMcpView('connect');
                              setMcpForm({
                                url: '',
                                label: '',
                                description: '',
                                authType: 'None',
                                token: ''
                              });
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[#f1f1f1] dark:bg-[#2b2b2b] hover:bg-[#e5e5e5] dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                          >
                            <PlusIcon size={14} strokeWidth={2.5} />
                            Server
                          </button>
                        </div>
                      </div>

                      {/* Modal Content Scrollable Area (List View) */}
                      <div 
                        className="px-6 pb-6 overflow-y-auto flex-1 [&::-webkit-scrollbar]:hidden"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                      >
                        {/* Built-in Section */}
                        {(mcpTab === 'All' || mcpTab === 'Hosted') && (
                          <div className="mb-8">
                            <h3 className="text-[14px] font-medium text-black dark:text-white mb-4 flex items-center gap-2 mt-2">
                              Built-in connectors <span className="text-gray-400 dark:text-[#6a6a6a] font-normal">— maintained by the platform</span>
                            </h3>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {[
                                { name: 'Gmail', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg', color: '#EA4335', features: ['Search messages', 'Read recent emails'] },
                                { name: 'Google Calendar', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg', color: '#4285F4', features: ['Search events', 'Fetch event details'] },
                                { name: 'Google Drive', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg', color: '#0F9D58', features: ['Search files', 'List recent files', 'Fetch file contents'] },
                                { name: 'Outlook Email', iconUrl: 'https://api.iconify.design/vscode-icons/file-type-outlook.svg', color: '#0078D4', features: ['Search messages', 'Read recent emails', 'Send emails'] },
                                { name: 'Outlook Calendar', iconUrl: 'https://api.iconify.design/vscode-icons/file-type-outlook.svg', color: '#0078D4', features: ['Search events', 'Fetch event details'] },
                                { name: 'Sharepoint', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Microsoft_Office_SharePoint_%282019%E2%80%932025%29.svg/512px-Microsoft_Office_SharePoint_%282019%E2%80%932025%29.svg.png?_=20190925170659', color: '#0364B8', features: ['Search documents', 'List site contents', 'Fetch document contents'] },
                                { name: 'Microsoft Teams', iconUrl: 'https://api.iconify.design/logos/microsoft-teams.svg', color: '#6264A7', features: ['List channels', 'Read messages', 'Send messages'] },
                                { name: 'Dropbox', iconUrl: '/icons/dropbox.svg', color: '#0061FF', features: ['Search files', 'List recent files', 'Fetch file contents'] },
                              ].map(connector => (
                                <div 
                                  key={connector.name} 
                                  onClick={() => {
                                    setSelectedConnector(connector);
                                    setMcpView('connector');
                                    // Pre-fill form for this connector
                                    setMcpForm({
                                      url: `https://mcp.${connector.name.toLowerCase().replace(' ', '')}.com/api/mcp/mcp`,
                                      label: `${connector.name.toLowerCase().replace(' ', '_')}_mcp`,
                                      description: '',
                                      authType: 'Access token / API key',
                                      token: ''
                                    });
                                  }}
                                  className="flex flex-col justify-center gap-3 p-4 bg-transparent border border-gray-200 dark:border-[#333] rounded-xl hover:bg-[#f9f9f9] dark:hover:bg-[#1a1a1a] cursor-pointer transition-all duration-200 group min-h-[90px] active:scale-[0.98]"
                                >
                                  <div className="w-8 h-8 rounded-md flex items-center justify-center p-1" style={{ backgroundColor: `${connector.color || '#444'}15` }}>
                                    <img src={connector.iconUrl} alt={`${connector.name} icon`} className="w-full h-full object-contain" draggable={false} />
                                  </div>
                                  <span className="text-[13.5px] font-medium text-gray-800 dark:text-[#a0a0a0] group-hover:text-black dark:group-hover:text-white transition-colors">{connector.name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Third Party Section */}
                        {(mcpTab === 'All' || mcpTab === 'Third-party') && (
                          <div className="mb-4">
                            <h3 className="text-[14px] font-medium text-black dark:text-white mb-4 flex items-center gap-2 mt-2">
                              Third party servers <span className="text-gray-400 dark:text-[#6a6a6a] font-normal">— created and maintained by others</span>
                            </h3>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {[
                                { name: 'Zapier', iconUrl: 'https://api.iconify.design/logos/zapier-icon.svg', color: '#FF4A00', features: ['Gmail', 'Notion', '8,000+ other apps'] },
                                { name: 'Shopify', iconUrl: 'https://api.iconify.design/logos/shopify.svg', color: '#95BF47', features: ['Manage products', 'Read orders', 'Update inventory'] },
                                { name: 'Intercom', iconUrl: 'https://api.iconify.design/logos/intercom.svg', color: '#000000', features: ['Manage conversations', 'Search users'] },
                                { name: 'Stripe', iconUrl: 'https://api.iconify.design/logos/stripe.svg', color: '#635BFF', features: ['List customers', 'Read payments', 'Create invoices'] },
                                { name: 'Square', iconUrl: 'https://api.iconify.design/logos/square.svg', color: '#000000', features: ['Manage catalog', 'Process payments', 'List orders'] },
                                { name: 'Cloudflare Browser', iconUrl: 'https://api.iconify.design/logos/cloudflare.svg', color: '#F38020', features: ['Manage zones', 'Read DNS records', 'Purge cache'] },
                                { name: 'HubSpot', iconUrl: 'https://api.iconify.design/logos/hubspot.svg', color: '#FF7A59', features: ['Manage contacts', 'Read deals', 'Update companies'] },
                                { name: 'Pipedream', iconUrl: 'https://api.iconify.design/logos/pipedream.svg', color: '#14C882', features: ['Trigger workflows', 'Execute code'] },
                                { name: 'PayPal', iconUrl: 'https://api.iconify.design/logos/paypal.svg', color: '#00457C', features: ['List transactions', 'Manage subscriptions'] },

                              ].map(connector => (
                                <div 
                                  key={connector.name} 
                                  onClick={() => {
                                    setSelectedConnector(connector);
                                    setMcpView('connector');
                                    // Pre-fill form for this connector
                                    setMcpForm({
                                      url: `https://mcp.${connector.name.toLowerCase().replace(' ', '')}.com/api/mcp/mcp`,
                                      label: `${connector.name.toLowerCase().replace(' ', '_')}_mcp`,
                                      description: '',
                                      authType: 'Access token / API key',
                                      token: ''
                                    });
                                  }}
                                  className="flex flex-col justify-center gap-3 p-4 bg-transparent border border-gray-200 dark:border-[#333] rounded-xl hover:bg-[#f9f9f9] dark:hover:bg-[#1a1a1a] cursor-pointer transition-all duration-200 group min-h-[90px] active:scale-[0.98]"
                                >
                                  <div className="w-8 h-8 rounded-md flex items-center justify-center p-1" style={{ backgroundColor: `${connector.color || '#444'}15` }}>
                                    <img src={connector.iconUrl} alt={`${connector.name} icon`} className="w-full h-full object-contain" draggable={false} />
                                  </div>
                                  <span className="text-[13.5px] font-medium text-gray-800 dark:text-[#a0a0a0] group-hover:text-black dark:group-hover:text-white transition-colors">{connector.name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ) : mcpView === 'connector' && selectedConnector ? (
                    <motion.div
                      key="mcp-connector"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="flex flex-col h-full"
                    >
                      {/* Scrollable form area */}
                      <div 
                        className="flex-1 overflow-y-auto px-8 pt-[60px] [&::-webkit-scrollbar]:hidden"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                      >
                        <div className="flex flex-col items-center max-w-[400px] w-full mx-auto">
                          {/* App Icon Header */}
                          <div className="w-[72px] h-[72px] bg-white dark:bg-[#2b2b2b] rounded-[18px] shadow-sm border border-gray-100 dark:border-[#333] flex items-center justify-center mb-5 p-3" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                            <img src={selectedConnector.iconUrl} alt={`${selectedConnector.name} icon`} className="w-full h-full object-contain" draggable={false} />
                          </div>
                          
                          <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">Connect to {selectedConnector.name} MCP</h2>
                          <p className="text-[13px] text-gray-500 dark:text-[#888] mb-8 select-all">{mcpForm.url}</p>

                          {/* Permissions List */}
                          {selectedConnector.features && selectedConnector.features.length > 0 && (
                            <div className="w-full bg-[#f4f4f4] dark:bg-[#262626] rounded-[12px] p-5 mb-6 flex flex-col gap-3.5">
                              {selectedConnector.features.map((feature, idx) => (
                                <div key={idx} className="flex items-center gap-3 text-[14px] text-gray-800 dark:text-[#ddd] font-medium">
                                  <svg className="w-[20px] h-[20px] text-black dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" strokeWidth="2.5" />
                                    <path d="M8 12.5l3 3 5-6" strokeWidth="2.5" />
                                  </svg>
                                  {feature}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Description Input */}
                          <div className="w-full mb-4">
                            <input 
                              type="text" 
                              placeholder="Description (optional)"
                              autoComplete="one-time-code"
                              className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] px-4 py-3 text-[14.5px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                              value={mcpForm.description}
                              onChange={(e) => setMcpForm({...mcpForm, description: e.target.value})}
                            />
                          </div>

                          {/* API Key Input */}
                          <div className="w-full relative mb-4">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-[#a0a0a0]">
                              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                              </svg>
                            </div>
                            <input 
                              type="password" 
                              placeholder={`Enter your ${selectedConnector.name} API key`}
                              autoComplete="one-time-code"
                              className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] pl-[44px] pr-[44px] py-3 text-[14.5px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                              value={mcpForm.token}
                              onChange={(e) => setMcpForm({...mcpForm, token: e.target.value})}
                            />
                            <button className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 transition-colors">
                              <svg className="w-[20px] h-[20px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/>
                              </svg>
                            </button>
                          </div>

                          <a href="#" className="text-[13.5px] text-gray-600 dark:text-[#a0a0a0] font-medium hover:text-black dark:hover:text-white transition-colors flex items-center gap-1.5 mt-2">
                            Get API key 
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </a>
                        </div>
                      </div>

                      {/* Footer Actions (sticky at bottom) */}
                      <div className="flex items-center justify-between w-full px-8 pb-6 pt-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                        <button 
                          onClick={() => setMcpView('list')}
                          className="flex items-center gap-1.5 px-3 py-2 bg-[#f4f4f4] dark:bg-[#2b2b2b] hover:bg-[#eaeaea] dark:hover:bg-[#3d3d3d] rounded-[10px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                        >
                          <svg className="w-4 h-4 ml-[-2px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                          Back
                        </button>
                        <button className="flex items-center gap-2 px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[10px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="13 2 13 9 20 9" />
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                            <path d="M9 13l2 2 4-4" />
                          </svg>
                          Connect
                        </button>
                      </div>
                    </motion.div>
                  ) : mcpView === 'connect' ? (
                    <motion.div
                      key="mcp-connect"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="flex flex-col h-full"
                    >
                      {/* Form area */}
                      <div 
                        className="flex-1 overflow-visible px-8 pt-10 relative z-20"
                      >
                        <div className="flex flex-col items-center max-w-[400px] w-full mx-auto pb-4">
                          {/* Form Header */}
                          <div className="w-14 h-14 bg-white dark:bg-[#2b2b2b] rounded-[16px] shadow-sm border border-gray-100 dark:border-[#333] flex items-center justify-center mb-6">
                            <svg className="w-6 h-6 text-black dark:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                              <line x1="10" y1="9" x2="8" y2="9" />
                            </svg>
                          </div>
                          
                          <h2 className="text-[18px] font-semibold text-black dark:text-white mb-8">Connect to MCP Server</h2>

                          {/* URL Field */}
                          <div className="flex flex-col gap-1.5 w-full mb-5">
                            <label className="text-[13.5px] font-medium text-black dark:text-white text-left">URL</label>
                            <p className="text-[12px] text-gray-500 dark:text-[#888] text-left mb-0.5 mt-[-2px]">Only use MCP servers you trust and verify</p>
                            <input 
                              type="text" 
                              placeholder="https://mcp.example.com"
                              autoComplete="one-time-code"
                              className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                              value={mcpForm.url}
                              onChange={(e) => setMcpForm({...mcpForm, url: e.target.value})}
                            />
                          </div>

                          {/* Label Field */}
                          <div className="flex flex-col gap-1.5 w-full mb-5">
                            <label className="text-[13.5px] font-medium text-black dark:text-white text-left">Label</label>
                            <input 
                              type="text" 
                              placeholder="my_mcp_server"
                              autoComplete="one-time-code"
                              className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                              value={mcpForm.label}
                              onChange={(e) => setMcpForm({...mcpForm, label: e.target.value})}
                            />
                          </div>

                          {/* Description Field */}
                          <div className="flex flex-col gap-1.5 w-full mb-5">
                            <label className="text-[13.5px] font-medium text-black dark:text-white flex items-center gap-1.5 justify-start">
                              Description <span className="font-normal text-gray-400 dark:text-[#666]">(optional)</span>
                            </label>
                            <input 
                              type="text" 
                              placeholder="My MCP Server"
                              autoComplete="off"
                              className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                              value={mcpForm.description}
                              onChange={(e) => setMcpForm({...mcpForm, description: e.target.value})}
                            />
                          </div>

                          {/* Authentication Field */}
                          <div className="flex flex-col gap-1.5 w-full pb-6 relative z-50">
                            <label className="text-[13.5px] font-medium text-black dark:text-white flex items-center gap-1.5 justify-start">
                              Authentication 
                              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path strokeWidth="2" strokeLinecap="round" d="M12 16v-4m0-4h.01"/></svg>
                            </label>
                            
                            <div className="relative" ref={mcpAuthDropdownRef}>
                              <button 
                                onClick={(e) => {
                                  e.preventDefault();
                                  setIsMcpAuthDropdownOpen(!isMcpAuthDropdownOpen);
                                }}
                                className="w-full text-left border border-gray-200 dark:border-[#333] rounded-[10px] px-3.5 py-2.5 text-[14px] outline-none cursor-pointer hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white flex items-center justify-between"
                              >
                                {mcpForm.authType}
                                <ChevronDown className="w-[18px] h-[18px] text-gray-500 pointer-events-none stroke-[2px]" />
                              </button>

                              <AnimatePresence>
                                {isMcpAuthDropdownOpen && (
                                  <motion.div
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-[#2b2b2b] border border-gray-100 dark:border-[#333] rounded-[10px] shadow-lg py-1 z-50 overflow-hidden"
                                  >
                                    {['Access token / API key', 'Basic Auth', 'None'].map((authOption) => (
                                      <button
                                        key={authOption}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          setMcpForm({...mcpForm, authType: authOption});
                                          setIsMcpAuthDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-3.5 py-2 text-[13.5px] flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${
                                          mcpForm.authType === authOption 
                                            ? 'text-black dark:text-white font-medium' 
                                            : 'text-gray-600 dark:text-[#a1a1aa]'
                                        }`}
                                      >
                                        <svg 
                                          className={`w-3.5 h-3.5 shrink-0 ${mcpForm.authType === authOption ? 'opacity-100' : 'opacity-0'}`} 
                                          viewBox="0 0 24 24" 
                                          fill="none" 
                                          stroke="currentColor" 
                                          strokeWidth="3" 
                                          strokeLinecap="round" 
                                          strokeLinejoin="round"
                                        >
                                          <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        {authOption}
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            
                            <div className="relative mt-[2px]">
                              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 dark:text-[#a0a0a0]">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                                </svg>
                              </div>
                              <input 
                                type="password" 
                                placeholder="Add your access token"
                                autoComplete="one-time-code"
                                className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] pl-[38px] pr-10 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                                value={mcpForm.token}
                                onChange={(e) => setMcpForm({...mcpForm, token: e.target.value})}
                              />
                              <button className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions (sticky at bottom) */}
                      <div className="flex items-center justify-between w-full px-8 pb-8 pt-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] relative z-10">
                        <button 
                          onClick={() => setMcpView('list')}
                          className="flex items-center gap-1.5 px-3 py-2 bg-[#f4f4f4] dark:bg-[#2b2b2b] hover:bg-[#eaeaea] dark:hover:bg-[#3d3d3d] rounded-[10px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                        >
                          <svg className="w-4 h-4 ml-[-2px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                          Back
                        </button>
                        <button className="flex items-center gap-2 px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[10px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="13 2 13 9 20 9" />
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                            <path d="M9 13l2 2 4-4" />
                          </svg>
                          Connect
                        </button>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* File Search Modal */}
      {createPortal(
        <AnimatePresence>
          {isFileSearchModalOpen && (
            <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => setIsFileSearchModalOpen(false)}
              />

              {/* Modal Content */}
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[500px] h-[500px] rounded-[16px] shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-6 pt-6 pb-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative">
                  <h2 className="text-[20px] font-semibold text-black dark:text-white">Attach files to file search</h2>
                </div>

                {/* Body Content */}
                <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex flex-col items-center justify-center w-full max-w-[320px] mx-auto cursor-pointer">
                    <div className="w-12 h-12 bg-white dark:bg-[#2b2b2b] rounded-xl shadow-sm border border-gray-100 dark:border-[#333] flex items-center justify-center mb-4">
                      <svg className="w-6 h-6 text-black dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <h3 className="text-[15.5px] font-semibold text-black dark:text-white mb-2 transition-colors">Drag your files here or click to upload</h3>
                    <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] text-center mb-5">Information in attached files will be available to this response.</p>
                    <div className="flex items-center justify-center w-full">
                      <button className="px-4 py-2 bg-gray-200 dark:bg-[#333] hover:bg-gray-300 dark:hover:bg-[#404040] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors">
                        Upload
                      </button>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end w-full px-6 py-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsFileSearchModalOpen(false)}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button className="px-4 py-2 bg-gray-100 dark:bg-[#2a2a2a] dark:text-[#555] text-gray-400 rounded-[8px] text-[13.5px] font-medium transition-colors cursor-not-allowed">
                      Attach
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
      {/* Code Interpreter Modal */}
      {createPortal(
        <AnimatePresence>
          {isCodeInterpreterModalOpen && (
            <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => setIsCodeInterpreterModalOpen(false)}
              />

              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[500px] h-[500px] rounded-[16px] shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 pt-6 pb-2 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative">
                  <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">Code interpreter</h2>
                  <p className="text-[14px] text-gray-500 dark:text-[#a0a0a0]">Run Python code and analyze uploaded files.</p>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex flex-col items-center justify-center w-full max-w-[320px] mx-auto cursor-pointer">
                    <div className="w-12 h-12 bg-white dark:bg-[#2b2b2b] rounded-xl shadow-sm border border-gray-100 dark:border-[#333] flex items-center justify-center mb-4">
                      <svg className="w-6 h-6 text-black dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <h3 className="text-[15.5px] font-semibold text-black dark:text-white mb-2 transition-colors">Drag your files here or click to upload</h3>
                    <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] text-center mb-5">Adding files is optional.</p>
                    <div className="flex items-center justify-center w-full">
                      <button className="px-4 py-2 bg-gray-200 dark:bg-[#333] hover:bg-gray-300 dark:hover:bg-[#404040] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors">
                        Select files
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end w-full px-6 py-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsCodeInterpreterModalOpen(false)}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]">
                      Add
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Function Modal */}
      {createPortal(
        <AnimatePresence>
          {isFunctionModalOpen && (
            <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => setIsFunctionModalOpen(false)}
              />

              {/* Modal Content */}
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[650px] rounded-[16px] shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-7 pt-7 pb-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative">
                  <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">Function</h2>
                  <p className="text-[14px] text-gray-600 dark:text-[#a0a0a0]">
                    The model will intelligently decide to call functions based on input it receives from the user. <a href="#" className="underline hover:text-gray-800 dark:hover:text-white transition-colors">Learn more.</a>
                  </p>
                </div>

                {/* Body Content */}
                <div className="flex-1 px-7 pb-2 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[14.5px] font-semibold text-black dark:text-white">Definition</h3>
                    <div className="flex items-center gap-4">
                      <button className="flex items-center gap-1.5 text-[13px] font-medium text-black dark:text-white hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <svg className="w-[15px] h-[15px] fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M 6.5 1.25 C 6.5 4.15 4.15 6.5 1.25 6.5 C 4.15 6.5 6.5 8.85 6.5 11.75 C 6.5 8.85 8.85 6.5 11.75 6.5 C 8.85 6.5 6.5 4.15 6.5 1.25 Z" />
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                        Generate
                      </button>
                    </div>
                  </div>

                  {/* Code Editor Area */}
                  <div className="w-full bg-white dark:bg-[#252525] border border-gray-200 dark:border-[#333] rounded-[10px] flex flex-col overflow-hidden h-[260px]">
                    <textarea 
                      className="flex-1 w-full p-4 font-mono text-[13px] text-gray-800 dark:text-[#e0e0e0] leading-[1.6] bg-transparent resize-none outline-none focus:ring-0 placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                      placeholder="Write your function definition here..."
                    />
                    
                    {/* Inline Footer of Code Block */}
                    <div className="w-full border-t border-gray-200 dark:border-[#333] bg-[#fdfdfd] dark:bg-[#2a2a2a] p-3 text-[13px] text-gray-600 dark:text-[#a0a0a0] flex items-center gap-1.5 shrink-0">
                      <span>Add</span>
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                      <code className="bg-gray-100 dark:bg-[#1f1f1f] px-1.5 py-0.5 rounded-[6px] text-[12.5px] font-mono border border-gray-200 dark:border-[#404040] text-black dark:text-[#d4d4d4] shrink-0">"strict": true</code>
                      <span className="truncate">to ensure the model's response always follows this schema.</span>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end w-full px-7 py-5 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setIsFunctionModalOpen(false)}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]">
                      Add
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* JSON Schema Modal */}
      {createPortal(
        <AnimatePresence>
          {isJsonSchemaModalOpen && (
            <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => setIsJsonSchemaModalOpen(false)}
              />

              <motion.div
                layout
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ 
                  layout: { type: "spring", stiffness: 400, damping: 30 },
                  default: { type: "spring", stiffness: 400, damping: 30 }
                }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[650px] rounded-[16px] overflow-hidden shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <motion.div 
                  layout 
                  transition={{ layout: { type: "spring", stiffness: 400, damping: 30 } }}
                  className="px-7 pt-7 pb-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative flex justify-between items-start"
                >
                  <div>
                    <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">Structured output (JSON)</h2>
                    <p className="text-[14px] text-gray-600 dark:text-[#a0a0a0]">
                      The model will generate a JSON object that matches this schema.
                    </p>
                  </div>
                  
                  {/* Simple/Advanced Toggle */}
                  <div className="flex bg-[#e5e5e5] dark:bg-[#2b2b2b] rounded-lg p-1 shrink-0">
                    <button 
                      onClick={() => setJsonSchemaMode('Simple')}
                      className={`px-4 py-1.5 rounded-md text-[13.5px] font-medium transition-colors ${jsonSchemaMode === 'Simple' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white'}`}
                    >
                      Simple
                    </button>
                    <button 
                      onClick={() => setJsonSchemaMode('Advanced')}
                      className={`px-4 py-1.5 rounded-md text-[13.5px] font-medium transition-colors ${jsonSchemaMode === 'Advanced' ? 'bg-[#1a1a1a] text-white shadow-sm' : 'text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white'}`}
                    >
                      Advanced
                    </button>
                  </div>
                </motion.div>

                <motion.div 
                  layout 
                  transition={{ layout: { type: "spring", stiffness: 400, damping: 30 } }}
                  className={`flex-1 px-7 pb-2 bg-[#fafafa] dark:bg-[#1e1e1e] flex flex-col gap-5 overflow-y-auto [&::-webkit-scrollbar]:hidden ${jsonSchemaMode === 'Advanced' ? 'h-[50vh]' : 'max-h-[50vh]'}`}
                >
                  <motion.div layout className="flex flex-col gap-2.5">
                    <label className="text-[14px] font-semibold text-black dark:text-white">Name</label>
                    <input 
                      type="text" 
                      value={jsonSchemaName}
                      onChange={(e) => setJsonSchemaName(e.target.value)}
                      className="w-full border border-gray-200 dark:border-[#333] rounded-[6px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                    />
                  </motion.div>

                  {jsonSchemaMode === 'Simple' ? (
                    <div className="flex flex-col gap-3">
                      <label className="text-[14px] font-semibold text-black dark:text-white">Properties</label>
                      
                      <div className="flex items-center text-[12.5px] text-gray-400 dark:text-[#6a6a6a] font-medium px-2">
                         <div className="w-[30%]">Name</div>
                         <div className="w-[25%]">Type</div>
                         <div className="flex-1">Description</div>
                      </div>

                      <AnimatePresence initial={false}>
                        {jsonSchemaProperties.map((prop, idx) => (
                          <motion.div 
                            key={prop.id}
                            initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                            animate={{ opacity: 1, height: 'auto', overflow: 'hidden' }}
                            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                          >
                            <div className="flex gap-2 items-center pb-1">
                              <input 
                                type="text"
                                value={prop.name}
                                onChange={(e) => {
                                  const newProps = [...jsonSchemaProperties];
                                  newProps[idx].name = e.target.value;
                                  setJsonSchemaProperties(newProps);
                                }}
                                className="w-[30%] border border-gray-200 dark:border-[#333] rounded-[6px] px-3.5 py-2 text-[13.5px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white"
                              />
                              <select
                                value={prop.type}
                                onChange={(e) => {
                                  const newProps = [...jsonSchemaProperties];
                                  newProps[idx].type = e.target.value;
                                  setJsonSchemaProperties(newProps);
                                }}
                                className="w-[25%] border border-gray-200 dark:border-[#333] rounded-[6px] px-3 py-2 text-[13.5px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white appearance-none cursor-pointer"
                              >
                                <option value="String">String</option>
                                <option value="Number">Number</option>
                                <option value="Boolean">Boolean</option>
                                <option value="Object">Object</option>
                                <option value="Array">Array</option>
                              </select>
                              <input 
                                type="text"
                                value={prop.description}
                                onChange={(e) => {
                                  const newProps = [...jsonSchemaProperties];
                                  newProps[idx].description = e.target.value;
                                  setJsonSchemaProperties(newProps);
                                }}
                                className="flex-1 border border-gray-200 dark:border-[#333] rounded-[6px] px-3.5 py-2 text-[13.5px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white"
                              />
                              {jsonSchemaProperties.length > 1 && (
                                <button 
                                  onClick={() => {
                                    const newProps = [...jsonSchemaProperties];
                                    newProps.splice(idx, 1);
                                    setJsonSchemaProperties(newProps);
                                  }}
                                  className="p-2 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                                  title="Remove property"
                                >
                                  <Trash2 size={16} strokeWidth={2} />
                                </button>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      <button 
                        onClick={() => setJsonSchemaProperties([...jsonSchemaProperties, { id: Date.now(), name: '', type: 'String', description: '' }])}
                        className="w-[fit-content] mt-2 flex items-center justify-center gap-1.5 px-4 py-1.5 bg-[#e5e5e5] hover:bg-[#d4d4d4] dark:bg-[#2b2b2b] dark:hover:bg-[#333] transition-colors rounded-full text-black dark:text-white text-[13.5px] font-medium"
                      >
                        <Plus size={14} className="text-gray-500 dark:text-[#a1a1aa]" /> Add
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      <label className="text-[14px] font-semibold text-black dark:text-white">Raw JSON Schema</label>
                      <textarea
                        value={jsonSchemaRaw}
                        onChange={(e) => setJsonSchemaRaw(e.target.value)}
                        className="w-full h-[calc(50vh-150px)] min-h-[300px] border border-gray-200 dark:border-[#333] rounded-[8px] p-3.5 text-[13.5px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-white dark:bg-[#121212] text-black dark:text-[#d4d4d4] font-mono resize-none"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </motion.div>

                <motion.div 
                  layout 
                  transition={{ layout: { type: "spring", stiffness: 400, damping: 30 } }}
                  className="flex items-center justify-between w-full px-7 py-5 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]"
                >
                  <button className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-[#2b2b2b] dark:hover:bg-[#333] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" className="fill-current">
                      <path d="M 6.5 1.25 C 6.5 4.15 4.15 6.5 1.25 6.5 C 4.15 6.5 6.5 8.85 6.5 11.75 C 6.5 8.85 8.85 6.5 11.75 6.5 C 8.85 6.5 6.5 4.15 6.5 1.25 Z" />
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                    </svg>
                    Generate
                  </button>
                  
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setIsJsonSchemaModalOpen(false)}
                      className="px-4 py-2 bg-transparent hover:bg-gray-100 dark:hover:bg-[#2b2b2b] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]"
                    >
                      Update
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Custom Tool Modal */}
      {createPortal(
        <AnimatePresence>
          {isCustomToolModalOpen && (
            <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => setIsCustomToolModalOpen(false)}
              />

              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[650px] rounded-[16px] shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-7 pt-7 pb-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative">
                  <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">Custom tool</h2>
                  <p className="text-[14px] text-gray-600 dark:text-[#a0a0a0]">
                    The model will intelligently decide to call custom tools based on input it receives from the user. <a href="#" className="underline hover:text-gray-800 dark:hover:text-white transition-colors">Learn more.</a>
                  </p>
                </div>

                <div className="flex-1 px-7 pb-2 bg-[#fafafa] dark:bg-[#1e1e1e] flex flex-col gap-5">
                  <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                    <label className="text-[14px] font-semibold text-black dark:text-white sm:w-[100px] shrink-0">Name</label>
                    <input 
                      type="text" 
                      placeholder="coding_tool"
                      className="w-full border border-gray-200 dark:border-[#333] rounded-[8px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label className="text-[14px] font-semibold text-black dark:text-white">Description</label>
                    <textarea 
                      placeholder="Describe what your tool should do, e.g. execute arbitrary code."
                      className="w-full h-[180px] resize-none border border-gray-200 dark:border-[#333] rounded-[8px] px-3.5 py-3 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4 sm:items-center pt-2">
                    <label className="text-[14px] font-semibold text-black dark:text-white sm:w-[100px] shrink-0">Format</label>
                    <div 
                      className="relative w-full"
                      ref={formatDropdownRef}
                    >
                      <button 
                        onClick={() => setIsFormatDropdownOpen(!isFormatDropdownOpen)}
                        className="w-full text-left border border-gray-200 dark:border-[#333] rounded-[8px] px-3.5 py-2.5 text-[14px] outline-none cursor-pointer hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white flex items-center justify-between"
                      >
                        {selectedFormat}
                        <ChevronDown className="w-[16px] h-[16px] text-gray-500 pointer-events-none stroke-[2.5px]" />
                      </button>

                      <AnimatePresence>
                        {isFormatDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            transition={{ duration: 0.15 }}
                            className="absolute top-full left-0 mt-1 w-[160px] bg-white dark:bg-[#2b2b2b] border border-gray-100 dark:border-[#333] rounded-[8px] shadow-lg py-1 z-50 overflow-hidden"
                          >
                            {['Text', 'JSON'].map((format) => (
                              <button
                                key={format}
                                onClick={() => {
                                  setSelectedFormat(format);
                                  setIsFormatDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3.5 py-2 text-[13.5px] flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${
                                  selectedFormat === format 
                                    ? 'text-black dark:text-white font-medium' 
                                    : 'text-gray-600 dark:text-[#a1a1aa]'
                                }`}
                              >
                                <svg 
                                  className={`w-3.5 h-3.5 ${selectedFormat === format ? 'opacity-100' : 'opacity-0'}`} 
                                  viewBox="0 0 24 24" 
                                  fill="none" 
                                  stroke="currentColor" 
                                  strokeWidth="3" 
                                  strokeLinecap="round" 
                                  strokeLinejoin="round"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                {format}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end w-full px-7 py-5 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setIsCustomToolModalOpen(false)}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]">
                      Add
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

    </motion.div>
  );
};

const InputTextIcon: React.FC<{ className?: string; size?: number }> = ({ className, size = 16 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="16" height="16" x="4" y="4" rx="4" />
    <path d="M8 8h3" />
    <path d="M14 8h2" />
    <path d="M8 12h5" />
    <path d="M8 16h8" />
  </svg>
);

const StartConfigPanel: React.FC = () => {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('String');
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const types = ['String', 'Number', 'Boolean', 'Object', 'List'];

  useOnViewportChange({
    onStart: () => {
      setIsAddMenuOpen(false);
    }
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Use globalThis.Node to disambiguate from ReactFlow's Node type
      const target = event.target as globalThis.Node;
      const el = event.target as HTMLElement;

      if (
        menuRef.current && !menuRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        // If the click is inside the main StartConfigPanel itself (but outside the popup/add button), 
        // we deliberately trigger the smooth fade out.
        // If the click is entirely outside the StartConfigPanel (e.g. on the React Flow canvas),
        // we do nothing and let React Flow native unmount routine completely obliterate the pane instantly.
        if (panelRef.current && !panelRef.current.contains(target)) {
          return;
        }

        setIsAddMenuOpen(false);
      }
    };

    if (isAddMenuOpen) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isAddMenuOpen]);

  return (
    <motion.div 
      ref={panelRef}
      initial={{ opacity: 0, x: 20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 15, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 35, mass: 0.8 }}
      className="absolute right-6 top-6 w-[340px] bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto"
    >
      <div className="p-5 flex-1 flex flex-col min-h-0 relative">
        <h2 className="text-white text-[16px] font-semibold tracking-wide">
          Start
        </h2>
        <p className="text-[#a1a1aa] text-[13px] mt-1 tracking-wide">
          Define the workflow inputs
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <h3 className="text-white text-[14.5px] font-medium tracking-wide">Input variables</h3>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-white">
              <InputTextIcon className="text-[#22c55e]" size={16} />
              <span className="text-[14.5px]">input_as_text</span>
            </div>
            <span className="text-[#a1a1aa] text-[13px]">string</span>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <h3 className="text-white text-[14.5px] font-medium tracking-wide">State variables</h3>
          <button 
            ref={buttonRef}
            onClick={(e) => {
              e.stopPropagation();
              setIsAddMenuOpen(!isAddMenuOpen);
            }}
            className="flex items-center justify-center gap-1.5 w-[76px] h-[32px] bg-[#2b2b2b] hover:bg-[#333] transition-colors rounded-full text-white text-[14px] font-medium"
          >
            <Plus size={16} strokeWidth={2.5} className="text-[#a1a1aa]" /> Add
          </button>
        </div>

        {/* Add State Variable Popup Menu */}
        <AnimatePresence>
          {isAddMenuOpen && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute right-0 top-[102%] w-[400px] bg-[#2a2a2a] rounded-[16px] shadow-xl p-4 flex flex-col gap-4 border border-[#3a3a3a] z-50"
            >
              {/* Type Selector Tabs */}
              <div className="flex items-center bg-[#141414] rounded-[10px] p-1 w-full justify-between">
                {types.map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`flex-1 min-w-max px-3 py-1.5 rounded-[8px] text-[13px] font-medium transition-colors ${
                      selectedType === type
                        ? 'bg-[#3b3b3b] text-white shadow-sm'
                        : 'text-[#a1a1aa] hover:text-white hover:bg-[#222]'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {/* Name Input */}
              <div className="flex flex-col gap-2">
                <label className="text-white text-[14px] font-medium">Name</label>
                <input
                  type="text"
                  placeholder="Enter the variable name"
                  className="w-full bg-[#3b3b3b]/50 border-transparent rounded-[8px] px-3 py-2 text-[14px] text-white placeholder:text-[#888] focus:outline-none focus:ring-0 focus:border-transparent transition-colors font-medium"
                />
              </div>

              {/* Default Value Input */}
              <div className="flex flex-col gap-2">
                <label className="text-white text-[14px] font-medium flex items-center gap-1.5">
                  Default value <span className="text-[#6a6a6a] text-[13px] font-normal">Optional</span>
                </label>
                <input
                  type="text"
                  placeholder="New variable"
                  className="w-full bg-[#3b3b3b]/50 border-transparent rounded-[8px] px-3 py-2 text-[14px] text-white placeholder:text-[#888] focus:outline-none focus:ring-0 focus:border-transparent transition-colors font-medium"
                />
              </div>

              {/* Save Button */}
              <div className="flex justify-end mt-1">
                <button
                  onClick={() => setIsAddMenuOpen(false)}
                  className="px-5 py-2 bg-white hover:bg-gray-100 text-black text-[14px] font-medium rounded-full transition-colors"
                >
                  Save
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
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

  // Sync state when props change (switching nodes of same type)
  useEffect(() => {
    setLocalName(nodeName);
  }, [nodeName]);

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
    <motion.div 
      initial={{ opacity: 0, x: 20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 15, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 35, mass: 0.8 }}
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
              <InputTextIcon className="text-[#22c55e]" size={16} />
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
    </motion.div>
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
            
            <AnimatePresence mode="popLayout">
              {isSidebarCollapsed && nodes.find(n => n.selected && n.type === 'start') && (
                <StartConfigPanel key="start-panel" />
              )}
              
              {isSidebarCollapsed && nodes.find(n => n.selected && n.type === 'agent') && (() => {
                const selectedAgentNode = nodes.find(n => n.selected && n.type === 'agent');
                return selectedAgentNode ? (
                  <AgentConfigPanel 
                    key="agent-panel"
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
                ) : null;
              })()}
              
              {isSidebarCollapsed && nodes.find(n => n.selected && n.type === 'guardrail') && (() => {
                const selectedGuardrailNode = nodes.find(n => n.selected && n.type === 'guardrail');
                return selectedGuardrailNode ? (
                  <GuardrailConfigPanel 
                    key="guardrail-panel"
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
                ) : null;
              })()}
            </AnimatePresence>

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
