// React Flow node and edge renderers for the Agent Builder canvas.
//
// Every node the canvas can draw lives here, plus the two registries React Flow
// needs (`nodeTypes`, `edgeTypes`) and the custom connection/edge painters.
//
// The individual node components are intentionally NOT exported. React Flow
// never references them by identity — it looks them up by string key through
// `nodeTypes` — so the registry is the only real entry point, and keeping the
// components private means adding a node type is a single-file change.
//
// To add a node type: write the component, add one line to `nodeTypes`, and
// give it a matching entry wherever the palette is built in AgentBuilder.tsx.
//
// These are presentational. They read node `data` and canvas connection state;
// they do not fetch, save, or mutate the workflow. The one exception is
// AgentNode, which subscribes to `evaluationGraderCounts` to show a badge.

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore as useNanoStore } from '@nanostores/react';
import {
  Handle,
  Position,
  getBezierPath,
  useNodeConnections,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from '@xyflow/react';
import {
  Square,
  StickyNote,
  Database,
  ShieldCheck,
  Blocks,
  Split,
  RefreshCw,
  ThumbsUp,
  Shuffle,
  CircleDashed,
  Plus,
  Play,
  Check,
} from 'lucide-react';
import { evaluationGraderCounts } from './agent-builder-store';

const StartNode = ({ data, selected }: any) => {
  const connections = useNodeConnections({ handleType: 'source' });
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
  const connections = useNodeConnections({ handleType: 'target' });
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
  const targetConnections = useNodeConnections({ handleType: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  
  const sourceConnections = useNodeConnections({ handleType: 'source' });
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

/**
 * Most workflow nodes have one input and one output. Keep their canvas
 * representation deliberately compact while still exposing real handles so
 * loaded graphs and newly dropped nodes behave consistently.
 */
const LinearNode = ({ data, selected, title, subtitle, accent, Icon, allowMultipleInputs = false }: any) => {
  const targetConnections = useNodeConnections({ handleType: 'target' });
  const sourceConnections = useNodeConnections({ handleType: 'source' });
  const errorConnections = useNodeConnections({ handleType: 'source', handleId: 'error' });
  const titleText = data?.label || title;
  const hasErrorBranch = data?.config?.onError === 'branch';
  const targetConnectable = allowMultipleInputs || targetConnections.length === 0;
  const sourceConnectable = !sourceConnections.some((connection: any) => !connection.sourceHandle);

  return (
    <div className={`flex items-center justify-center gap-4 py-3 px-3 bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={targetConnectable}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`}
      />
      <div className="w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0" style={{ backgroundColor: accent }}>
        <Icon size={20} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
      </div>
      <div className="flex flex-col">
        <span className="text-white text-[16px] font-semibold tracking-wide leading-tight">{titleText}</span>
        <span className="text-[#a1a1aa] text-[12px] font-normal tracking-wide leading-tight">{subtitle || title}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={sourceConnectable}
        style={{ right: 0, transform: 'translate(50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`}
      />
      {hasErrorBranch && (
        <Handle
          type="source"
          id="error"
          position={Position.Right}
          isConnectable={errorConnections.length === 0}
          title="Error route"
          style={{ right: 0, top: 'calc(50% + 24px)', transform: 'translate(50%, -50%)' }}
          className={`!w-3.5 !h-3.5 !bg-[#2b1717] !border-[2.5px] !border-red-400/80 transition-all ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} hover:!w-4 hover:!h-4 hover:!z-50 !z-40`}
        />
      )}
    </div>
  );
};

/** Nodes with two mutually-exclusive outgoing routes (approval and loops). */
const BranchNode = ({ data, selected, title, subtitle, accent, Icon, firstHandle, firstLabel, secondHandle, secondLabel, allowMultipleInputs = false }: any) => {
  const targetConnections = useNodeConnections({ handleType: 'target' });
  const firstConnections = useNodeConnections({ handleType: 'source', handleId: firstHandle });
  const secondConnections = useNodeConnections({ handleType: 'source', handleId: secondHandle });
  const errorConnections = useNodeConnections({ handleType: 'source', handleId: 'error' });
  const titleText = data?.label || title;
  const hasErrorBranch = data?.config?.onError === 'branch';
  const handleClass = `!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`;

  return (
    <div className={`flex flex-col gap-2 p-3 min-w-[190px] bg-[#2b2b2b] rounded-[24px] shadow-2xl border-[2.5px] transition-colors ${selected ? 'border-white/40' : 'border-[#404040]'} group relative animate-node-drop`}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={allowMultipleInputs || targetConnections.length === 0}
        style={{ left: 0, transform: 'translate(-50%, -50%)' }}
        className={handleClass}
      />
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0" style={{ backgroundColor: accent }}>
          <Icon size={20} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="text-black" />
        </div>
        <div className="flex flex-col">
          <span className="text-white text-[16px] font-semibold tracking-wide leading-tight">{titleText}</span>
          <span className="text-[#a1a1aa] text-[12px] font-normal tracking-wide leading-tight">{subtitle || title}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="relative flex h-8 items-center justify-end rounded-xl bg-[#1a1a1a] px-3">
          <span className="text-[#a1a1aa] text-[12px] font-medium tracking-wide">{firstLabel}</span>
          <Handle type="source" id={firstHandle} position={Position.Right} isConnectable={firstConnections.length === 0} style={{ right: -12, transform: 'translate(50%, -50%)' }} className={handleClass} />
        </div>
        <div className="relative flex h-8 items-center justify-end rounded-xl bg-[#1a1a1a] px-3">
          <span className="text-[#a1a1aa] text-[12px] font-medium tracking-wide">{secondLabel}</span>
          <Handle type="source" id={secondHandle} position={Position.Right} isConnectable={secondConnections.length === 0} style={{ right: -12, transform: 'translate(50%, -50%)' }} className={handleClass} />
        </div>
        {hasErrorBranch && (
          <div className="relative flex h-8 items-center justify-end rounded-xl bg-[#301b1b] px-3">
            <span className="text-red-300 text-[12px] font-medium tracking-wide">Error</span>
            <Handle type="source" id="error" position={Position.Right} isConnectable={errorConnections.length === 0} title="Error route" style={{ right: -12, transform: 'translate(50%, -50%)' }} className={`${handleClass} !bg-[#2b1717] !border-red-400/80`} />
          </div>
        )}
      </div>
    </div>
  );
};

const NoteNode = ({ data, selected }: any) => {
  const text = String(data?.config?.text ?? '').trim();
  return (
    <div className={`w-[220px] rounded-[8px] border bg-[#28251c] p-3 shadow-xl transition-colors ${selected ? 'border-[#facc15]/70' : 'border-[#4a432d]'} animate-node-drop`}>
      <div className="flex items-center gap-2 text-[#facc15]">
        <StickyNote size={16} strokeWidth={2.25} />
        <span className="text-[12px] font-semibold uppercase tracking-wide">{data?.label || 'Note'}</span>
      </div>
      <div className={`mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed ${text ? 'text-[#d6d0be]' : 'italic text-[#77715f]'}`}>
        {text || 'Add a note for collaborators'}
      </div>
    </div>
  );
};

const FileSearchNode = ({ data, selected }: any) => (
  <LinearNode data={data} selected={selected} title="File search" subtitle="Retrieve passages" accent="#6ee7b7" Icon={Database} />
);

const SubflowNode = ({ data, selected }: any) => (
  <LinearNode data={data} selected={selected} title="Subflow" subtitle="Pinned workflow" accent="#59c3c3" Icon={Blocks} />
);

const McpNode = ({ data, selected }: any) => (
  <LinearNode data={data} selected={selected} title="MCP" subtitle="Call a tool" accent="#c4b5fd" Icon={Blocks} />
);

const TransformNode = ({ data, selected }: any) => (
  <LinearNode data={data} selected={selected} title="Transform" subtitle="Reshape data" accent="#fb923c" Icon={Shuffle} />
);

const UserApprovalNode = ({ data, selected }: any) => (
  <BranchNode data={data} selected={selected} title="Human approval" subtitle="Human review" accent="#f9a8d4" Icon={ThumbsUp} firstHandle="approved" firstLabel="Approved" secondHandle="rejected" secondLabel="Rejected" />
);

const WhileNode = ({ data, selected }: any) => (
  <BranchNode data={data} selected={selected} title="While" subtitle="Repeat conditionally" accent="#f59e0b" Icon={RefreshCw} firstHandle="loop" firstLabel="Loop" secondHandle="done" secondLabel="Done" allowMultipleInputs />
);

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

const AgentNode = ({ id, data, selected }: any) => {
  const graderCounts = useNanoStore(evaluationGraderCounts);
  const attachedGraderCount = graderCounts[id] ?? 0;
  const targetConnections = useNodeConnections({ handleType: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  
  const sourceConnections = useNodeConnections({ handleType: 'source' });
  const errorConnections = useNodeConnections({ handleType: 'source', handleId: 'error' });
  const hasErrorBranch = data?.onError === 'branch';
  const isSourceConnected = sourceConnections.some((connection: any) => !connection.sourceHandle);

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
      {attachedGraderCount > 0 && <span className="absolute -top-2 right-3 rounded-full border border-cyan-700/70 bg-[#153238] px-1.5 py-0.5 text-[9px] font-semibold text-cyan-200">{attachedGraderCount} grader{attachedGraderCount === 1 ? '' : 's'}</span>}
      <Handle 
        type="source" 
        position={Position.Right} 
        isConnectable={!isSourceConnected}
        style={{ right: 0, transform: 'translate(50%, -50%)' }}
        className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`} 
      />
      {hasErrorBranch && (
        <Handle
          type="source"
          id="error"
          position={Position.Right}
          isConnectable={errorConnections.length === 0}
          title="Error route"
          style={{ right: 0, top: 'calc(50% + 24px)', transform: 'translate(50%, -50%)' }}
          className={`!w-3.5 !h-3.5 !bg-[#2b1717] !border-[2.5px] !border-red-400/80 transition-all ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} hover:!w-4 hover:!h-4 hover:!z-50 !z-40`}
        />
      )}
    </div>
  );
};

const IfElseNode = ({ data, selected }: any) => {
  const targetConnections = useNodeConnections({ handleType: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  const errorConnections = useNodeConnections({ handleType: 'source', handleId: 'error' });
  const sourceConnections = useNodeConnections({ handleType: 'source' });
  const hasErrorBranch = data?.config?.onError === 'branch';
  const branches = Array.isArray(data?.config?.branches) && data.config.branches.length > 0
    ? data.config.branches
    : [{ id: 'if', label: 'If' }];

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

      {branches.map((branch: any, index: number) => (
        <div key={String(branch.id)} className="relative w-full h-[42px] bg-[#1a1a1a] rounded-xl flex items-center justify-end px-4">
          <span className="text-[#a1a1aa] text-[15px] font-medium tracking-wide">{branch.label || (index === 0 ? 'If' : String(branch.id))}</span>
          <Handle
            type="source"
            id={String(branch.id)}
            position={Position.Right}
            isConnectable={!sourceConnections.some((connection: any) => connection.sourceHandle === String(branch.id))}
            style={{ right: -12, transform: 'translate(50%, -50%)' }}
            className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`}
          />
        </div>
      ))}

      <div className="relative w-full h-[42px] bg-[#1a1a1a] rounded-xl flex items-center justify-end px-4">
        <span className="text-[#a1a1aa] text-[15px] font-medium tracking-wide">Else</span>
        <Handle
          type="source"
          id="else"
          position={Position.Right}
          isConnectable={!sourceConnections.some((connection: any) => connection.sourceHandle === 'else')}
          style={{ right: -12, transform: 'translate(50%, -50%)' }}
          className={`!w-3.5 !h-3.5 !bg-black !border-[2.5px] transition-colors ${selected ? '!border-white/40' : '!border-[#404040]'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-200 hover:!w-4 hover:!h-4 hover:!z-50 !z-40`}
        />
      </div>
      {hasErrorBranch && (
        <div className="relative w-full h-[42px] bg-[#301b1b] rounded-xl flex items-center justify-end px-4">
          <span className="text-red-300 text-[15px] font-medium tracking-wide">Error</span>
          <Handle
            type="source"
            id="error"
            position={Position.Right}
            isConnectable={!errorConnections.length}
            title="Error route"
            style={{ right: -12, transform: 'translate(50%, -50%)' }}
            className={`!w-3.5 !h-3.5 !bg-[#2b1717] !border-[2.5px] !border-red-400/80 transition-all ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} hover:!w-4 hover:!h-4 hover:!z-50 !z-40`}
          />
        </div>
      )}
    </div>
  );
};

const GuardrailNode = ({ data, selected }: any) => {
  const targetConnections = useNodeConnections({ handleType: 'target' });
  const isTargetConnected = targetConnections.length > 0;
  
  const passConnections = useNodeConnections({ handleType: 'source', handleId: 'pass' });
  const isPassConnected = passConnections.length > 0;
  
  const failConnections = useNodeConnections({ handleType: 'source', handleId: 'fail' });
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
  subflow: SubflowNode,
  note: NoteNode,
  fileSearch: FileSearchNode,
  mcp: McpNode,
  ifElse: IfElseNode,
  while: WhileNode,
  userApproval: UserApprovalNode,
  transform: TransformNode,
  guardrail: GuardrailNode,
  end: EndNode,
  setState: SetStateNode,
  placeholder: PlaceholderNode,
};

export { nodeTypes, edgeTypes, CustomConnectionLine };
