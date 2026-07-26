import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUserDataContext } from '../../context/UserDataContext';
import {
  getAgentBuilderClient,
  type McpConnector,
  type McpServer,
  type ModelInfo,
  type NodeDataContract,
  type VectorStore,
  type VectorStoreFile,
  type WorkflowPresence,
  type WorkflowReviewThread,
  type WorkflowTemplate,
} from '../../lib/agentBuilder';
import { formatJsonSchemaIssues, validateJsonSchemaDefinition } from '../../lib/jsonSchemaValidation';
import { useStore as useNanoStore } from '@nanostores/react';
import { useAgentBuilderBackend } from '../../hooks/useAgentBuilderBackend';
import { RunPanel } from './RunPanel';
import { CodeExportModal } from './CodeExportModal';
import { EvaluationPanel } from './EvaluationPanel';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { PublishWorkflowModal } from './PublishWorkflowModal';
import { ChatPreviewPanel } from './ChatPreviewPanel';
import { ChatKitDeployPanel } from './ChatKitDeployPanel';
import { BatchRunPanel } from './BatchRunPanel';
import { RunHistoryPanel } from './RunHistoryPanel';
import { NodeConfigPanel } from './NodeConfigPanel';
import { VariablePicker, type WorkflowVariableSource } from './VariablePicker';
import { CollaborationPanel } from './CollaborationPanel';
import { WorkflowSecretsPanel } from './WorkflowSecretsPanel';
import {
  backendStatus,
  autosaveConflict,
  saveStatus,
  currentWorkflow,
  requestedWorkflowId,
  remoteDraftReloadEpoch,
  evaluationGraderCounts,
  debugBreakpoints,
  toggleDebugBreakpoint,
  evaluationPanelOpen,
  requestedEvaluationNodeId,
  versionPanelOpen,
  firePreview,
  fireCode,
  publishDialogOpen,
  runPanelOpen,
  runState,
} from '../../lib/stores/agent-builder-store';
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
  useNodeConnections,
  useOnViewportChange,
  Controls,
  MiniMap,
  ViewportPortal,
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
  ThumbsUp, // For Human approval
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
  Copy,

  ChevronDown,
  ExternalLink,
  Search,
  Check,
  Globe,
  Code,
  Settings,
  X,
  Plus as PlusIcon,
  Wand2,
  LayoutTemplate,
  Loader2,
  CircleAlert,
  TriangleAlert,
  History,
  Upload,
  FilePlus2,
  MessageSquare,
  Rocket,
  CircleDot,
  Users,
  Image as ImageIcon,
  AudioLines,
  Video,
  KeyRound,
  PanelLeft,
} from 'lucide-react';

// Custom node types
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

// Initial nodes for canvas. Every executable path ends explicitly so the
// starter is immediately publishable and has no implicit terminal behavior.
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
  },
  {
    id: '3',
    type: 'end',
    data: { label: 'End', config: {} },
    position: { x: 550, y: 125 },
  }
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'custom', style: { stroke: '#404040', strokeWidth: 2.5 } },
  { id: 'e2-3', source: '2', target: '3', type: 'custom', style: { stroke: '#404040', strokeWidth: 2.5 } },
];

const toWorkflowVarName = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_{2,}/g, '_') || 'node';

const replaceNamespaces = (value: unknown, replacements: Map<string, string>): unknown => {
  if (typeof value === 'string') {
    let next = value;
    for (const [from, to] of replacements) {
      next = next.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*(?:\\.|\\[))`, 'g'), to);
    }
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => replaceNamespaces(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, replaceNamespaces(child, replacements)]));
  }
  return value;
};

const nodeNamespaces = (sourceNodes: Node[]): Map<string, string> => {
  const result = new Map<string, string>();
  const used = new Set(['workflow', 'state', 'input_as_text']);
  for (const node of sourceNodes) {
    const base = toWorkflowVarName(String(node.data?.label ?? 'Node'));
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    result.set(node.id, name);
  }
  return result;
};

const nextGraphId = (base: string, used: Set<string>): string => {
  let candidate = `${base}_copy`;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_copy_${suffix++}`;
  used.add(candidate);
  return candidate;
};

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

  // Keep keyboard users from getting trapped in the editor when it is dismissed.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12" role="presentation">
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-instructions-title"
          >
            {/* Header Area inside Modal */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0 border-b border-[#333]">
              <h2 id="edit-instructions-title" className="text-white text-[16px] font-semibold tracking-wide">Edit instructions</h2>
              <button type="button" aria-label="Add context" className="flex items-center gap-1.5 text-[#a1a1aa] hover:text-white transition-colors">
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
                type="button"
                aria-label="Cancel editing instructions"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-[#333333] hover:bg-[#404040] text-white text-[14px] font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button"
                aria-label="Save instructions"
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
  nodeId: string;
  nodeName: string;
  attachedGraderCount?: number;
  contract?: NodeDataContract;
  onNameChange: (newName: string) => void;
  instructions: string;
  onInstructionsChange: (newInstructions: string) => void;
  userMessage?: string;
  onUserMessageChange?: (newMessage: string) => void;
  // Backend persistence (optional so the panel still works standalone)
  initialModelId?: string;
  initialOutputFormat?: string;
  onModelChange?: (modelName: string) => void;
  onOutputFormatChange?: (fmt: string) => void;
  config?: Record<string, any>;
  onConfigChange?: (patch: Record<string, any>) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  agentOptions?: Array<{ id: string; name: string }>;
  variableSources?: WorkflowVariableSource[];
}

interface APIModel {
  name: string;
  displayName: string;
  description: string;
  provider: string;
  inputModalities: ModelInfo['inputModalities'];
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  limitsSource: ModelInfo['limitsSource'];
  limitsCatalogVersion?: string;
}

const formatModelName = (displayName: string) => {
  return displayName.replace(/^Gemini\s+/, '').replace(/\s+Preview$|\s+Experimental$/, '');
};

type AgentErrorPolicy = 'fail' | 'continue' | 'branch';
const getAgentErrorPolicy = (cfg?: Record<string, any>): AgentErrorPolicy => (
  cfg?.onError === 'branch' || cfg?.onError === 'continue'
    ? cfg.onError
    : cfg?.continueOnError === true
      ? 'continue'
      : 'fail'
);

interface JsonSchemaPropertyDraft {
  id: number;
  name: string;
  type: string;
  description: string;
  nullable: boolean;
  enumValues: string;
  arrayItemType: string;
}

function buildAgentJsonSchemaDraft(
  mode: 'Simple' | 'Advanced',
  raw: string,
  propertyDrafts: JsonSchemaPropertyDraft[],
): { schema?: Record<string, unknown>; error?: string } {
  let schema: Record<string, unknown>;
  if (mode === 'Advanced') {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: '$: schema must be an object' };
      }
      schema = parsed as Record<string, unknown>;
    } catch (error) {
      return { error: `Invalid JSON: ${(error as Error).message}` };
    }
  } else {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const typeMap: Record<string, string> = {
      String: 'string',
      Number: 'number',
      Boolean: 'boolean',
      Object: 'object',
      Array: 'array',
    };
    for (const property of propertyDrafts) {
      const name = property.name.trim();
      if (!name) continue;
      if (properties[name]) return { error: `$.properties: property name '${name}' is duplicated` };
      const propertyType = typeMap[property.type] ?? 'string';
      const propertySchema: Record<string, unknown> = {
        type: property.nullable ? [propertyType, 'null'] : propertyType,
        ...(property.description.trim() ? { description: property.description.trim() } : {}),
      };
      if (property.type === 'Array') {
        const itemType = typeMap[property.arrayItemType] ?? 'string';
        propertySchema.items = itemType === 'object'
          ? { type: 'object', properties: {}, required: [], additionalProperties: false }
          : { type: itemType };
      }
      if (property.type === 'Object') {
        Object.assign(propertySchema, { properties: {}, required: [], additionalProperties: false });
      }
      if (property.enumValues.trim() && ['String', 'Number'].includes(property.type)) {
        const values = property.enumValues.split(',').map((value) => value.trim()).filter(Boolean);
        const parsedValues = property.type === 'Number' ? values.map(Number) : values;
        if (parsedValues.length === 0 || parsedValues.some((value) => typeof value === 'number' && !Number.isFinite(value))) {
          return { error: `$.properties.${name}.enum: enum contains an invalid value` };
        }
        propertySchema.enum = property.nullable ? [...parsedValues, null] : parsedValues;
      }
      properties[name] = propertySchema;
      required.push(name);
    }
    if (required.length === 0) return { error: '$.properties: add at least one named property' };
    schema = { type: 'object', properties, required, additionalProperties: false };
  }

  if (schema.type !== 'object') return { error: '$.type: Agent output schema root type must be object' };
  const issues = validateJsonSchemaDefinition(schema);
  return issues.length > 0 ? { error: formatJsonSchemaIssues(issues) } : { schema };
}

const AgentConfigPanel: React.FC<AgentConfigPanelProps> = ({
  nodeId,
  nodeName,
  attachedGraderCount = 0,
  contract,
  onNameChange,
  instructions,
  onInstructionsChange,
  userMessage,
  onUserMessageChange,
  initialModelId,
  initialOutputFormat,
  onModelChange,
  onOutputFormatChange,
  config,
  onConfigChange,
  onDelete,
  onDuplicate,
  agentOptions = [],
  variableSources = [],
}) => {
  const { apiKeys } = useUserDataContext();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLDivElement>(null);

  // Local state for the input to allow immediate typing before the flow state updates
  const [localName, setLocalName] = useState(nodeName);
  const [localInstructions, setLocalInstructions] = useState(instructions);
  const [localUserMessage, setLocalUserMessage] = useState(userMessage ?? '');
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false);
  const [includeChatHistory, setIncludeChatHistory] = useState(config?.includeChatHistory !== false);
  const [writeToConversationHistory, setWriteToConversationHistory] = useState(Boolean(config?.writeToConversationHistory));
  const [onErrorPolicy, setOnErrorPolicy] = useState<AgentErrorPolicy>(getAgentErrorPolicy(config));
  const [parallelToolCalls, setParallelToolCalls] = useState(config?.parallelToolCalls !== false);
  const [resetToolChoice, setResetToolChoice] = useState(config?.resetToolChoice !== false);
  const [reasoningEffort, setReasoningEffort] = useState(config?.reasoningEffort ?? 'medium');
  const [verbosity, setVerbosity] = useState(config?.verbosity ?? 'medium');
  const [maxTurns, setMaxTurns] = useState<number>(Number(config?.maxTurns ?? 8));
  const [maxInputTokensPerCall, setMaxInputTokensPerCall] = useState<string>(config?.maxInputTokensPerCall == null ? '' : String(config.maxInputTokensPerCall));
  const [modelTimeoutMs, setModelTimeoutMs] = useState<number>(Number(config?.modelTimeoutMs ?? 120000));
  const initialToolChoice = typeof config?.toolChoice === 'object' ? `tool:${config.toolChoice.name}` : config?.toolChoice ?? 'auto';
  const [toolChoice, setToolChoice] = useState<string>(initialToolChoice);
  const [modelParams, setModelParams] = useState({
    temperature: Number(config?.modelParams?.temperature ?? 1),
    maxTokens: Number(config?.modelParams?.maxTokens ?? 2048),
    topP: Number(config?.modelParams?.topP ?? 1),
  });
  const updateConfig = (patch: Record<string, any>) => onConfigChange?.(patch);
  const configuredTools = Array.isArray(config?.tools) ? config.tools as Array<Record<string, any>> : [];
  const configuredHandoffs = Array.isArray(config?.handoffs) ? config.handoffs as Array<{ targetNodeId: string; toolName?: string; description?: string }> : [];
  const availableHandoffTargets = agentOptions.filter((candidate) => candidate.id !== nodeId && !configuredHandoffs.some((handoff) => handoff.targetNodeId === candidate.id));
  const addHandoff = () => {
    const target = availableHandoffTargets[0];
    if (!target) return;
    const slug = target.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'agent';
    updateConfig({ handoffs: [...configuredHandoffs, { targetNodeId: target.id, toolName: `transfer_to_${slug}`, description: `Transfer control to ${target.name}.` }] });
  };
  const updateHandoff = (index: number, patch: Record<string, string>) => updateConfig({ handoffs: configuredHandoffs.map((handoff, candidateIndex) => candidateIndex === index ? { ...handoff, ...patch } : handoff) });
  const removeHandoff = (index: number) => updateConfig({ handoffs: configuredHandoffs.filter((_, candidateIndex) => candidateIndex !== index) });
  const specificToolChoices = (() => {
    const used = new Set<string>();
    return configuredTools.flatMap((tool) => {
      if (tool.kind === 'mcp') return [];
      const raw = tool.kind === 'web_search' ? 'web_search' : tool.kind === 'file_search' ? 'file_search' : tool.kind === 'code_interpreter' ? 'run_code' : String(tool.name || 'tool');
      const base = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool';
      let name = base;
      let index = 2;
      while (used.has(name)) name = `${base}_${index++}`;
      used.add(name);
      return [name];
    });
  })();
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null);
  const addAgentTool = (tool: Record<string, any>) => {
    const singleton = tool.kind === 'web_search' || tool.kind === 'code_interpreter';
    const identity = tool.name ?? tool.serverId ?? (Array.isArray(tool.vectorStoreIds) ? tool.vectorStoreIds.join(',') : '');
    if (configuredTools.some((candidate) =>
      candidate.kind === tool.kind &&
      (singleton || (candidate.name ?? candidate.serverId ?? (Array.isArray(candidate.vectorStoreIds) ? candidate.vectorStoreIds.join(',') : '')) === identity)
    )) return;
    updateConfig({ tools: [...configuredTools, tool] });
  };
  const saveAgentTool = (tool: Record<string, any>) => {
    if (editingToolIndex === null) {
      addAgentTool(tool);
      return;
    }
    updateConfig({
      tools: configuredTools.map((candidate, index) => index === editingToolIndex ? tool : candidate),
    });
    setEditingToolIndex(null);
  };
  const removeAgentTool = (index: number) => {
    updateConfig({ tools: configuredTools.filter((_, candidateIndex) => candidateIndex !== index) });
    if (editingToolIndex === index) setEditingToolIndex(null);
  };

  // Model Selector State
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'audio' | 'video'>('all');
  const [models, setModels] = useState<APIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<APIModel | null>(
    initialModelId
      ? { name: initialModelId.replace(/^models\//, ''), displayName: formatModelName(initialModelId.replace(/^models\//, '')), description: '', provider: '', inputModalities: [], limitsSource: 'unknown' }
      : {
          name: 'models/gemini-3-flash',
          displayName: 'Gemini 3 Flash',
          description: '',
          provider: 'gemini',
          inputModalities: ['text', 'image', 'audio', 'video'],
          limitsSource: 'unknown',
        }
  );
  const filteredModels = models.filter((model) =>
    model.displayName.toLowerCase().includes(searchQuery.toLowerCase())
      && (mediaFilter === 'all' || model.inputModalities.includes(mediaFilter))
  );
  const selectedInputModalities = selectedModel?.inputModalities ?? [];
  const normalizedSelectedModel = selectedModel?.name.toLowerCase().replace(/^models\//, '') ?? '';
  const isOpenAiReasoningModel = /^(gpt-5|o1|o3|o4)/.test(normalizedSelectedModel);
  const supportsReasoningControl = isOpenAiReasoningModel || /^gemini-(2\.5|[3-9])/.test(normalizedSelectedModel);
  const supportsVerbosityControl = normalizedSelectedModel.startsWith('gpt-5');
  const selectedContextLimit = selectedModel?.contextWindowTokens;
  const selectedOutputLimit = selectedModel?.maxOutputTokens;
  const configuredInputLimit = maxInputTokensPerCall === '' ? undefined : Number(maxInputTokensPerCall);
  const configuredEnvelopeExceedsContext = selectedContextLimit !== undefined && configuredInputLimit !== undefined
    && configuredInputLimit + modelParams.maxTokens > selectedContextLimit;
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, right: 0, width: 0 });

  // Output Format State
  const [isAgentFormatDropdownOpen, setIsAgentFormatDropdownOpen] = useState(false);
  const agentFormatDropdownRef = useRef<HTMLDivElement>(null);
  const agentFormatDropdownButtonRef = useRef<HTMLDivElement>(null);
  const [agentFormatDropdownPosition, setAgentFormatDropdownPosition] = useState({ top: 0, left: 0, right: 0, width: 0 });
  const [selectedAgentFormat, setSelectedAgentFormat] = useState(
    initialOutputFormat ? (initialOutputFormat.charAt(0).toUpperCase() + initialOutputFormat.slice(1)) : 'Text'
  );

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

  // Tools Selector State
  const [isToolsDropdownOpen, setIsToolsDropdownOpen] = useState(false);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);
  const toolsDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const [toolsDropdownPosition, setToolsDropdownPosition] = useState({ top: 0, left: 0, right: 0 });

  // MCP Modal State
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);
  const [mcpTab, setMcpTab] = useState<'All' | 'Hosted' | 'Third-party'>('All');
  const [mcpView, setMcpView] = useState<'list' | 'connect' | 'connector'>('list');
  type ConnectorPresentation = McpConnector & { iconUrl?: string; color?: string };
  const [selectedConnector, setSelectedConnector] = useState<ConnectorPresentation | null>(null);
  const [mcpForm, setMcpForm] = useState({
    url: '',
    label: '',
    description: '',
    authType: 'Access token / API key',
    token: '',
    username: '',
    password: '',
  });
  const [isMcpAuthDropdownOpen, setIsMcpAuthDropdownOpen] = useState(false);
  const mcpAuthDropdownRef = useRef<HTMLDivElement>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpConnectors, setMcpConnectors] = useState<McpConnector[]>([]);
  const [isMcpConfigModalOpen, setIsMcpConfigModalOpen] = useState(false);
  const [mcpConfigServer, setMcpConfigServer] = useState<McpServer | null>(null);
  const [mcpAvailableTools, setMcpAvailableTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [mcpAllowedTools, setMcpAllowedTools] = useState<string[]>([]);
  const [mcpRequireApproval, setMcpRequireApproval] = useState<'never' | 'always'>('never');
  const [mcpApprovalTimeoutMs, setMcpApprovalTimeoutMs] = useState(0);
  const [toolDialogBusy, setToolDialogBusy] = useState(false);
  const [toolDialogError, setToolDialogError] = useState<string | null>(null);
  const mcpToolDiscoveryRequestRef = useRef(0);

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
  const [vectorStores, setVectorStores] = useState<VectorStore[]>([]);
  const [selectedVectorStoreIds, setSelectedVectorStoreIds] = useState<string[]>([]);
  const [selectedVectorStoreId, setSelectedVectorStoreId] = useState<string | null>(null);
  const [selectedVectorStoreFiles, setSelectedVectorStoreFiles] = useState<VectorStoreFile[]>([]);
  const [newVectorStoreName, setNewVectorStoreName] = useState('');
  const [fileSearchMaxResults, setFileSearchMaxResults] = useState(8);
  const [fileSearchScoreThreshold, setFileSearchScoreThreshold] = useState(0);
  const [vectorStoreBusy, setVectorStoreBusy] = useState(false);
  const [cancellingVectorFileIds, setCancellingVectorFileIds] = useState<Set<string>>(new Set());
  const [vectorIngestionPollVersion, setVectorIngestionPollVersion] = useState(0);
  const vectorFileInputRef = useRef<HTMLInputElement>(null);

  // Code Interpreter Modal State
  const [isCodeInterpreterModalOpen, setIsCodeInterpreterModalOpen] = useState(false);
  const [codeInterpreterTimeoutMs, setCodeInterpreterTimeoutMs] = useState(5000);
  const [codeInterpreterFiles, setCodeInterpreterFiles] = useState<Array<{ name: string; content: string; mimeType?: string }>>([]);
  const codeInterpreterFileInputRef = useRef<HTMLInputElement>(null);

  // Web Search Modal State
  const [isWebSearchModalOpen, setIsWebSearchModalOpen] = useState(false);
  const [webSearchMaxResults, setWebSearchMaxResults] = useState(5);
  const [toolExecutionPolicy, setToolExecutionPolicy] = useState({
    timeoutMs: 60000,
    maxRetries: 0,
    retryBackoffMs: 250,
    timeoutBehavior: 'error_as_result' as 'error_as_result' | 'raise_exception',
  });
  const hydrateToolExecutionPolicy = (tool: Record<string, any>, defaultTimeout: number) => {
    const policy = tool.executionPolicy ?? {};
    setToolExecutionPolicy({
      timeoutMs: Number(policy.timeoutMs ?? tool.timeoutMs ?? defaultTimeout),
      maxRetries: Number(policy.maxRetries ?? 0),
      retryBackoffMs: Number(policy.retryBackoffMs ?? 250),
      timeoutBehavior: policy.timeoutBehavior === 'raise_exception' ? 'raise_exception' : 'error_as_result',
    });
  };
  const toolExecutionPolicyFields = (
    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-gray-200 pt-5 dark:border-[#333]">
      <label className="flex flex-col gap-1.5 text-[12px] font-medium text-black dark:text-white">
        Timeout (ms)
        <input type="number" min={100} max={600000} step={1} value={toolExecutionPolicy.timeoutMs} onChange={(event) => { const value = Number(event.target.value); setToolExecutionPolicy((current) => ({ ...current, timeoutMs: Number.isFinite(value) ? Math.max(100, Math.min(600000, Math.round(value))) : 300000 })); }} className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 font-normal dark:border-[#333] dark:bg-[#242424] dark:text-white" />
      </label>
      <label className="flex flex-col gap-1.5 text-[12px] font-medium text-black dark:text-white">
        Retries
        <input type="number" min={0} max={5} step={1} value={toolExecutionPolicy.maxRetries} onChange={(event) => setToolExecutionPolicy((current) => ({ ...current, maxRetries: Math.max(0, Math.min(5, Math.round(Number(event.target.value) || 0))) }))} className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 font-normal dark:border-[#333] dark:bg-[#242424] dark:text-white" />
      </label>
      <label className="flex flex-col gap-1.5 text-[12px] font-medium text-black dark:text-white">
        Backoff (ms)
        <input type="number" min={0} max={60000} value={toolExecutionPolicy.retryBackoffMs} onChange={(event) => setToolExecutionPolicy((current) => ({ ...current, retryBackoffMs: Math.max(0, Math.min(60000, Number(event.target.value) || 0)) }))} className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 font-normal dark:border-[#333] dark:bg-[#242424] dark:text-white" />
      </label>
      <label className="flex flex-col gap-1.5 text-[12px] font-medium text-black dark:text-white">
        Failure behavior
        <select value={toolExecutionPolicy.timeoutBehavior} onChange={(event) => setToolExecutionPolicy((current) => ({ ...current, timeoutBehavior: event.target.value as 'error_as_result' | 'raise_exception' }))} className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 font-normal dark:border-[#333] dark:bg-[#242424] dark:text-white">
          <option value="error_as_result">Error as result</option>
          <option value="raise_exception">Raise exception</option>
        </select>
      </label>
    </div>
  );

  // Function Modal State
  const [isFunctionModalOpen, setIsFunctionModalOpen] = useState(false);
  const [functionDefinition, setFunctionDefinition] = useState(
    '{\n' +
    '  "name": "lookup",\n' +
    '  "description": "Look up a value",\n' +
    '  "parameters": {\n' +
    '    "type": "object",\n' +
    '    "properties": { "query": { "type": "string" } },\n' +
    '    "required": ["query"]\n' +
    '  },\n' +
    '  "execution": { "mode": "js", "code": "return args.query;" }\n' +
    '}',
  );

  // JSON Schema Modal State
  const [isJsonSchemaModalOpen, setIsJsonSchemaModalOpen] = useState(false);
  const [jsonSchemaMode, setJsonSchemaMode] = useState<'Simple' | 'Advanced'>('Simple');
  const [jsonSchemaName, setJsonSchemaName] = useState('response_schema');
  const [jsonSchemaProperties, setJsonSchemaProperties] = useState<JsonSchemaPropertyDraft[]>([{ id: Date.now(), name: '', type: 'String', description: '', nullable: false, enumValues: '', arrayItemType: 'String' }]);
  const [jsonSchemaRaw, setJsonSchemaRaw] = useState('{\n  "type": "object",\n  "properties": {\n    \n  }\n}');
  const jsonSchemaDraft = buildAgentJsonSchemaDraft(jsonSchemaMode, jsonSchemaRaw, jsonSchemaProperties);
  const openJsonSchemaEditor = () => {
    const existing = config?.outputSchema as Record<string, any> | undefined;
    setJsonSchemaName(String(config?.outputSchemaName ?? 'response_schema'));
    if (!existing) {
      setJsonSchemaMode('Simple');
      setJsonSchemaProperties([{ id: Date.now(), name: '', type: 'String', description: '', nullable: false, enumValues: '', arrayItemType: 'String' }]);
      setJsonSchemaRaw('{\n  "type": "object",\n  "properties": {},\n  "required": [],\n  "additionalProperties": false\n}');
      setIsJsonSchemaModalOpen(true);
      return;
    }
    setJsonSchemaRaw(JSON.stringify(existing, null, 2));
    const properties = existing.type === 'object' && existing.properties && typeof existing.properties === 'object' && !Array.isArray(existing.properties)
      ? Object.entries(existing.properties as Record<string, any>)
      : [];
    const simple = properties.every(([, property]) => {
      const types = Array.isArray(property?.type) ? property.type : [property?.type];
      return types.filter((type: unknown) => type !== 'null').length === 1
        && ['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(types.find((type: unknown) => type !== 'null'));
    });
    if (simple) {
      const labelFor = (type: string) => type === 'integer' ? 'Number' : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
      setJsonSchemaMode('Simple');
      setJsonSchemaProperties(properties.length ? properties.map(([name, property], index) => {
        const types = Array.isArray(property.type) ? property.type : [property.type];
        const primaryType = String(types.find((type: unknown) => type !== 'null') ?? 'string');
        const itemType = String(property.items?.type ?? 'string');
        return {
          id: Date.now() + index,
          name,
          type: labelFor(primaryType),
          description: String(property.description ?? ''),
          nullable: types.includes('null'),
          enumValues: Array.isArray(property.enum) ? property.enum.filter((value: unknown) => value !== null).join(', ') : '',
          arrayItemType: labelFor(itemType),
        };
      }) : [{ id: Date.now(), name: '', type: 'String', description: '', nullable: false, enumValues: '', arrayItemType: 'String' }]);
    } else {
      setJsonSchemaMode('Advanced');
    }
    setIsJsonSchemaModalOpen(true);
  };
  const saveJsonSchema = () => {
    if (!jsonSchemaDraft.schema) return;
    updateConfig({ outputSchema: jsonSchemaDraft.schema, outputSchemaName: jsonSchemaName.trim() || 'response_schema', outputFormat: 'json' });
    setSelectedAgentFormat('JSON');
    setIsJsonSchemaModalOpen(false);
  };

  // Custom Tool Modal State
  const [isCustomToolModalOpen, setIsCustomToolModalOpen] = useState(false);
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('Text');
  const [customToolName, setCustomToolName] = useState('');
  const [customToolDescription, setCustomToolDescription] = useState('');
  const formatDropdownRef = useRef<HTMLDivElement>(null);

  const openAttachedToolEditor = async (tool: Record<string, any>, index: number) => {
    setToolDialogError(null);
    setEditingToolIndex(index);
    hydrateToolExecutionPolicy(tool ?? {}, 300000);
    if (tool.kind === 'function') {
      const { kind: _kind, ...definition } = tool;
      setFunctionDefinition(JSON.stringify(definition, null, 2));
      setIsFunctionModalOpen(true);
      return;
    }
    if (tool.kind === 'custom') {
      hydrateToolExecutionPolicy(tool, 5000);
      setCustomToolName(String(tool.name ?? ''));
      setCustomToolDescription(String(tool.description ?? ''));
      setSelectedFormat(tool.format === 'json' ? 'JSON' : 'Text');
      setIsCustomToolModalOpen(true);
      return;
    }
    if (tool.kind === 'file_search') {
      hydrateToolExecutionPolicy(tool, 60000);
      setSelectedVectorStoreIds(Array.isArray(tool.vectorStoreIds) ? tool.vectorStoreIds : []);
      setFileSearchMaxResults(Number(tool.maxResults ?? 8));
      setFileSearchScoreThreshold(Number(tool.scoreThreshold ?? 0));
      setIsFileSearchModalOpen(true);
      return;
    }
    if (tool.kind === 'web_search') {
      hydrateToolExecutionPolicy(tool, 20000);
      setWebSearchMaxResults(Number(tool.maxResults ?? 5));
      setIsWebSearchModalOpen(true);
      return;
    }
    if (tool.kind === 'code_interpreter') {
      hydrateToolExecutionPolicy(tool, 5000);
      setCodeInterpreterTimeoutMs(Number(tool.timeoutMs ?? 5000));
      setCodeInterpreterFiles(Array.isArray(tool.files) ? tool.files : []);
      setIsCodeInterpreterModalOpen(true);
      return;
    }
    if (tool.kind === 'mcp') {
      let server = mcpServers.find((candidate) => candidate.id === tool.serverId);
      if (!server) {
        try {
          const response = await getAgentBuilderClient(apiKeys).listMcpServers();
          setMcpServers(response.servers);
          server = response.servers.find((candidate) => candidate.id === tool.serverId);
        } catch (error) {
          setToolDialogError((error as Error).message);
        }
      }
      if (server) void openMcpConfig(server, tool, index);
      else setToolDialogError('The attached MCP server is no longer registered.');
      return;
    }
    setEditingToolIndex(null);
  };

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

  useEffect(() => {
    if (!isMCPModalOpen) return;
    let cancelled = false;
    setToolDialogError(null);
    Promise.all([
      getAgentBuilderClient(apiKeys).listMcpServers(),
      getAgentBuilderClient(apiKeys).listMcpConnectors(),
    ])
      .then(([serversResponse, connectorsResponse]) => {
        if (cancelled) return;
        setMcpServers(serversResponse.servers);
        setMcpConnectors(connectorsResponse.connectors);
      })
      .catch((error) => {
        if (!cancelled) setToolDialogError((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKeys, isMCPModalOpen]);

  const refreshVectorStores = useCallback(async () => {
    const response = await getAgentBuilderClient(apiKeys).listVectorStores();
    setVectorStores(response.stores);
    setSelectedVectorStoreId((current) => {
      if (current && response.stores.some((store) => store.id === current)) return current;
      return response.stores[0]?.id ?? null;
    });
    return response.stores;
  }, [apiKeys]);

  useEffect(() => {
    if (!isFileSearchModalOpen) return;
    let cancelled = false;
    setToolDialogError(null);
    refreshVectorStores()
      .catch((error) => {
        if (!cancelled) setToolDialogError((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [isFileSearchModalOpen, refreshVectorStores]);

  useEffect(() => {
    if (!isFileSearchModalOpen || !selectedVectorStoreId) {
      setSelectedVectorStoreFiles([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await getAgentBuilderClient(apiKeys).getVectorStore(selectedVectorStoreId);
        if (cancelled) return;
        setSelectedVectorStoreFiles(response.files);
        setVectorStores((current) => current.map((store) => (
          store.id === response.store.id ? response.store : store
        )));
        if (response.files.some((file) => file.status === 'processing')) {
          timer = setTimeout(poll, 750);
        }
      } catch {
        if (!cancelled) setSelectedVectorStoreFiles([]);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [apiKeys, isFileSearchModalOpen, selectedVectorStoreId, vectorIngestionPollVersion]);

  useOnViewportChange({
    onStart: () => {
      setIsModelDropdownOpen(false);
      setIsToolsDropdownOpen(false);
      setIsFormatDropdownOpen(false);
    }
  });

  // Discover provider models through the Agent Builder backend. This keeps
  // provider keys in request headers and exposes the same model ids used by
  // the run engine (Gemini, OpenAI, Anthropic, and mock).
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await getAgentBuilderClient(apiKeys).listModels();
        const discovered = response.models.map((model) => ({
          name: model.id,
          displayName: model.displayName || model.id,
          description: model.description || '',
          provider: model.provider,
          inputModalities: model.inputModalities,
          contextWindowTokens: model.contextWindowTokens,
          maxOutputTokens: model.maxOutputTokens,
          limitsSource: model.limitsSource,
          limitsCatalogVersion: model.limitsCatalogVersion,
        }));
        if (discovered.length > 0) {
          setModels(discovered);
          // Don't override a model that was restored from the saved workflow.
          if (initialModelId) {
            const restored = discovered.find((model) => model.name.replace(/^models\//, '') === initialModelId.replace(/^models\//, ''));
            if (restored) setSelectedModel(restored);
          } else {
            const defaultModel =
              discovered.find((model) => model.name === 'mock/echo') ||
              discovered.find((model) => model.name.toLowerCase().includes('flash')) ||
              discovered[0];
            setSelectedModel(defaultModel);
            onModelChange?.(defaultModel.name);
          }
        }
      } catch (error) {
        // Silently fail - dropdown will remain empty
      }
    };

    fetchModels();
  }, [apiKeys, initialModelId]);

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
    setLocalUserMessage(userMessage ?? '');
    setIncludeChatHistory(config?.includeChatHistory !== false);
    setWriteToConversationHistory(Boolean(config?.writeToConversationHistory));
    setParallelToolCalls(config?.parallelToolCalls !== false);
    setResetToolChoice(config?.resetToolChoice !== false);
    setToolChoice(typeof config?.toolChoice === 'object' ? `tool:${config.toolChoice.name}` : config?.toolChoice ?? 'auto');
    setOnErrorPolicy(getAgentErrorPolicy(config));
    setReasoningEffort(config?.reasoningEffort ?? 'medium');
    setVerbosity(config?.verbosity ?? 'medium');
    setMaxTurns(Number(config?.maxTurns ?? 8));
    setMaxInputTokensPerCall(config?.maxInputTokensPerCall == null ? '' : String(config.maxInputTokensPerCall));
    setModelTimeoutMs(Number(config?.modelTimeoutMs ?? 120000));
    setModelParams({
      temperature: Number(config?.modelParams?.temperature ?? 1),
      maxTokens: Number(config?.modelParams?.maxTokens ?? 2048),
      topP: Number(config?.modelParams?.topP ?? 1),
    });
  }, [nodeName, instructions, userMessage, config]);

  const attachFunctionTool = () => {
    setToolDialogError(null);
    try {
      const parsed = JSON.parse(functionDefinition) as Record<string, any>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Function definition must be a JSON object.');
      }
      if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
        throw new Error('Function definition needs a name.');
      }
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(parsed.name.trim())) {
        throw new Error('Function name must start with a letter or underscore and contain at most 64 letters, numbers, underscores, or hyphens.');
      }
      if (parsed.parameters !== undefined && (
        !parsed.parameters || typeof parsed.parameters !== 'object' || Array.isArray(parsed.parameters) ||
        parsed.parameters.type !== 'object' ||
        (parsed.parameters.properties !== undefined && (!parsed.parameters.properties || typeof parsed.parameters.properties !== 'object' || Array.isArray(parsed.parameters.properties))) ||
        (parsed.parameters.required !== undefined && (!Array.isArray(parsed.parameters.required) || parsed.parameters.required.some((name: unknown) => typeof name !== 'string')))
      )) {
        throw new Error('Function parameters must be an object JSON schema with object properties and string required names.');
      }
      const execution = parsed.execution;
      if (!execution || typeof execution !== 'object' ||
          !['js', 'http', 'client'].includes(execution.mode)) {
        throw new Error("Function execution.mode must be 'js', 'http', or 'client'.");
      }
      if (execution.mode === 'js' && typeof execution.code !== 'string') {
        throw new Error('JavaScript functions need execution.code.');
      }
      if (execution.mode === 'http' && typeof execution.url !== 'string') {
        throw new Error('HTTP functions need execution.url.');
      }
      saveAgentTool({
        kind: 'function',
        name: parsed.name.trim(),
        description: typeof parsed.description === 'string' ? parsed.description : '',
        parameters: parsed.parameters && typeof parsed.parameters === 'object'
          ? parsed.parameters
          : { type: 'object', properties: {} },
        execution,
        executionPolicy: parsed.executionPolicy,
      });
      setEditingToolIndex(null);
      setIsFunctionModalOpen(false);
    } catch (error) {
      setToolDialogError((error as Error).message);
    }
  };

  const attachCustomTool = () => {
    const name = customToolName.trim();
    if (!name) {
      setToolDialogError('Custom tools need a name.');
      return;
    }
    saveAgentTool({
      kind: 'custom',
      name,
      description: customToolDescription.trim(),
      format: selectedFormat === 'JSON' ? 'json' : 'text',
      executionPolicy: toolExecutionPolicy,
    });
    setCustomToolName('');
    setCustomToolDescription('');
    setEditingToolIndex(null);
    hydrateToolExecutionPolicy({}, 5000);
    setToolDialogError(null);
    setIsCustomToolModalOpen(false);
  };

  const attachFileSearchTool = () => {
    if (!selectedVectorStoreIds.length) {
      setToolDialogError('Select at least one vector store.');
      return;
    }
    saveAgentTool({
      kind: 'file_search',
      vectorStoreIds: selectedVectorStoreIds,
      maxResults: Math.max(1, Math.min(50, Math.round(fileSearchMaxResults))),
      scoreThreshold: Math.max(0, Math.min(1, fileSearchScoreThreshold)),
      executionPolicy: toolExecutionPolicy,
    });
    setSelectedVectorStoreIds([]);
    setEditingToolIndex(null);
    setToolDialogError(null);
    setIsFileSearchModalOpen(false);
  };

  const attachWebSearchTool = () => {
    saveAgentTool({
      kind: 'web_search',
      maxResults: Math.max(1, Math.min(10, Math.round(webSearchMaxResults))),
      executionPolicy: toolExecutionPolicy,
    });
    setEditingToolIndex(null);
    setToolDialogError(null);
    setIsWebSearchModalOpen(false);
  };

  const attachCodeInterpreterTool = () => {
    saveAgentTool({
      kind: 'code_interpreter',
      timeoutMs: Math.max(100, Math.min(120000, Math.round(codeInterpreterTimeoutMs))),
      files: codeInterpreterFiles,
      executionPolicy: { ...toolExecutionPolicy, timeoutMs: Math.max(100, Math.min(120000, Math.round(codeInterpreterTimeoutMs))) },
    });
    setEditingToolIndex(null);
    setToolDialogError(null);
    setIsCodeInterpreterModalOpen(false);
  };

  const addCodeInterpreterFiles = async (incoming: FileList | File[]) => {
    setToolDialogError(null);
    const files = Array.from(incoming);
    const existingBytes = codeInterpreterFiles.reduce((total, file) => total + new Blob([file.content]).size, 0);
    let totalBytes = existingBytes;
    const additions: Array<{ name: string; content: string; mimeType?: string }> = [];
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        setToolDialogError(`${file.name} is larger than 2 MB.`);
        continue;
      }
      if (totalBytes + file.size > 5 * 1024 * 1024) {
        setToolDialogError('Code Interpreter attachments are limited to 5 MB total.');
        break;
      }
      const content = await file.text();
      additions.push({ name: file.name, content, mimeType: file.type || 'text/plain' });
      totalBytes += file.size;
    }
    setCodeInterpreterFiles((current) => {
      const byName = new Map(current.map((file) => [file.name, file]));
      additions.forEach((file) => byName.set(file.name, file));
      return [...byName.values()];
    });
  };

  const createVectorStore = async () => {
    const name = newVectorStoreName.trim();
    if (!name) {
      setToolDialogError('Give the vector store a name.');
      return;
    }
    setVectorStoreBusy(true);
    setToolDialogError(null);
    try {
      const response = await getAgentBuilderClient(apiKeys).createVectorStore(name);
      const stores = await refreshVectorStores();
      const created = stores.find((store) => store.id === response.store.id) ?? response.store;
      setSelectedVectorStoreId(created.id);
      setNewVectorStoreName('');
    } catch (error) {
      setToolDialogError((error as Error).message);
    } finally {
      setVectorStoreBusy(false);
    }
  };

  const uploadVectorStoreFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedVectorStoreId) return;
    if (file.size > 10 * 1024 * 1024) {
      setToolDialogError('Files must be 10 MB or smaller.');
      return;
    }
    setVectorStoreBusy(true);
    setToolDialogError(null);
    try {
      if (file.size === 0) throw new Error('The selected file is empty.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const response = await getAgentBuilderClient(apiKeys).addVectorStoreFileBase64(
        selectedVectorStoreId,
        file.name,
        btoa(binary),
        file.type || 'application/octet-stream',
      );
      setSelectedVectorStoreFiles((current) => [
        response.file,
        ...current.filter((item) => item.id !== response.file.id),
      ]);
      setVectorIngestionPollVersion((current) => current + 1);
      await refreshVectorStores();
    } catch (error) {
      setToolDialogError((error as Error).message);
    } finally {
      setVectorStoreBusy(false);
    }
  };

  const cancelVectorStoreFile = async (fileId: string) => {
    if (!selectedVectorStoreId) return;
    setCancellingVectorFileIds((current) => new Set(current).add(fileId));
    setToolDialogError(null);
    try {
      const response = await getAgentBuilderClient(apiKeys)
        .cancelVectorStoreFileIngestion(selectedVectorStoreId, fileId);
      setSelectedVectorStoreFiles((current) => current.map((file) => (
        file.id === fileId ? response.file : file
      )));
      setVectorIngestionPollVersion((current) => current + 1);
    } catch (error) {
      setToolDialogError((error as Error).message);
    } finally {
      setCancellingVectorFileIds((current) => {
        const next = new Set(current);
        next.delete(fileId);
        return next;
      });
    }
  };

  const deleteVectorStoreFile = async (fileId: string) => {
    if (!selectedVectorStoreId) return;
    setVectorStoreBusy(true);
    setToolDialogError(null);
    try {
      await getAgentBuilderClient(apiKeys).deleteVectorStoreFile(selectedVectorStoreId, fileId);
      await refreshVectorStores();
      const response = await getAgentBuilderClient(apiKeys).getVectorStore(selectedVectorStoreId);
      setSelectedVectorStoreFiles(response.files);
    } catch (error) {
      setToolDialogError((error as Error).message);
    } finally {
      setVectorStoreBusy(false);
    }
  };

  const deleteVectorStore = async (storeId: string) => {
    setVectorStoreBusy(true);
    setToolDialogError(null);
    try {
      await getAgentBuilderClient(apiKeys).deleteVectorStore(storeId);
      setSelectedVectorStoreIds((current) => current.filter((id) => id !== storeId));
      await refreshVectorStores();
    } catch (error) {
      setToolDialogError((error as Error).message);
    } finally {
      setVectorStoreBusy(false);
    }
  };

  const openMcpConfig = async (server: McpServer, tool?: Record<string, any>, index: number | null = null) => {
    const requestId = ++mcpToolDiscoveryRequestRef.current;
    setToolDialogBusy(true);
    setToolDialogError(null);
    setMcpAvailableTools([]);
    setMcpAllowedTools([]);
    setEditingToolIndex(index);
    if (!tool) hydrateToolExecutionPolicy({}, 300000);
    setMcpConfigServer(server);
    setMcpRequireApproval(tool?.requireApproval === 'always' ? 'always' : 'never');
    setMcpApprovalTimeoutMs(Number(tool?.approvalTimeoutMs ?? 0));
    setIsMcpConfigModalOpen(true);
    try {
      const response = await getAgentBuilderClient(apiKeys).listMcpTools(server.id);
      if (requestId !== mcpToolDiscoveryRequestRef.current) return;
      const tools = response.tools ?? [];
      setMcpAvailableTools(tools);
      const savedAllowedTools = Array.isArray(tool?.allowedTools) ? tool.allowedTools as string[] : null;
      setMcpAllowedTools(savedAllowedTools ?? tools.map((candidate) => candidate.name));
    } catch (error) {
      if (requestId === mcpToolDiscoveryRequestRef.current) {
        setToolDialogError((error as Error).message);
      }
    } finally {
      if (requestId === mcpToolDiscoveryRequestRef.current) {
        setToolDialogBusy(false);
      }
    }
  };

  const saveMcpTool = () => {
    if (!mcpConfigServer) return;
    saveAgentTool({
      kind: 'mcp',
      serverId: mcpConfigServer.id,
      allowedTools: mcpAllowedTools,
      requireApproval: mcpRequireApproval,
      approvalTimeoutMs: mcpApprovalTimeoutMs,
      executionPolicy: toolExecutionPolicy,
    });
    setEditingToolIndex(null);
    setIsMcpConfigModalOpen(false);
    setIsMCPModalOpen(false);
    setMcpView('list');
  };

  const connectAndAttachMcp = async () => {
    if (!mcpForm.url.trim()) {
      setToolDialogError('MCP server URL is required.');
      return;
    }
    if (mcpForm.authType === 'Basic Auth' && (!mcpForm.username.trim() || !mcpForm.password)) {
      setToolDialogError('Basic Auth requires both a username and password.');
      return;
    }
    setToolDialogBusy(true);
    setToolDialogError(null);
    try {
      const basicAuth = mcpForm.authType === 'Basic Auth'
        ? { type: 'basic' as const, username: mcpForm.username.trim(), password: mcpForm.password }
        : undefined;
      const response = await getAgentBuilderClient(apiKeys).addMcpServer({
        url: mcpForm.url.trim(),
        label: mcpForm.label.trim() || 'mcp_server',
        connector: selectedConnector?.key,
        description: mcpForm.description.trim() || undefined,
        authType: mcpForm.authType,
        token: mcpForm.token || undefined,
        auth: basicAuth,
        connect: true,
      });
      if (response.warning) throw new Error(response.warning);
      setMcpServers((current) => [
        response.server,
        ...current.filter((server) => server.id !== response.server.id),
      ]);
      await openMcpConfig(response.server);
    } catch (error) {
      setToolDialogError((error as Error).message);
      setToolDialogBusy(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 15, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 35, mass: 0.8 }}
      className="absolute inset-x-3 top-16 max-h-[calc(100%-148px)] w-auto bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto md:inset-x-auto md:right-6 md:top-6 md:max-h-[calc(100%-48px)] md:w-[340px]"
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
            <button type="button" title="Duplicate agent" aria-label="Duplicate agent" onClick={onDuplicate} className="hover:text-white transition-colors"><Copy size={16} strokeWidth={2.5} /></button>
            <button type="button" title="Delete agent" aria-label="Delete agent" onClick={onDelete} className="hover:text-red-400 transition-colors"><Trash2 size={16} strokeWidth={2.5} /></button>
          </div>
        </div>
        <p className="text-[#a1a1aa] text-[13px] -mt-3.5 tracking-wide shrink-0">Call the model with your instructions and tools</p>
        
        {/* Main Settings */}
        <div className="flex items-center justify-between gap-4 mt-2 shrink-0">
          <label className="text-white text-[14.5px] font-medium">Name</label>
          <div className="w-[min(240px,60%)] h-[32px] bg-[#2b2b2b] rounded-lg px-3 flex items-center">
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
               <VariablePicker sources={variableSources} onInsert={(value) => { const next = `${localInstructions}${value}`; setLocalInstructions(next); onInstructionsChange(next); }} />
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
              type="button"
              title="Expand instructions"
              aria-label="Expand instructions"
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

        <div className="flex flex-col gap-2 mt-1 shrink-0">
          <div className="flex items-center justify-between"><label className="text-white text-[14.5px] font-medium">User message</label><VariablePicker sources={variableSources} onInsert={(value) => { const next = `${localUserMessage}${value}`; setLocalUserMessage(next); onUserMessageChange?.(next); }} /></div>
          <textarea
            value={localUserMessage}
            onChange={(event) => {
              setLocalUserMessage(event.target.value);
              onUserMessageChange?.(event.target.value);
            }}
            placeholder="Optional message template for this agent"
            className="w-full h-16 bg-[#2b2b2b] rounded-xl p-3 text-white text-[13px] resize-none outline-none placeholder:text-[#6a6a6a]"
          />
        </div>

        <div className="flex items-center justify-between mt-1 shrink-0">
          <label className="text-white text-[14.5px] font-medium">Include chat history</label>
          <button
            type="button"
            aria-label="Include chat history"
            aria-pressed={includeChatHistory}
            onClick={() => {
              const next = !includeChatHistory;
              setIncludeChatHistory(next);
              updateConfig({ includeChatHistory: next });
            }}
            className={`w-[42px] h-[24px] rounded-full flex items-center px-0.5 cursor-pointer ${includeChatHistory ? 'bg-white justify-end' : 'bg-[#404040] justify-start'}`}
          >
            <span className={`w-[20px] h-[20px] rounded-full shadow-sm ${includeChatHistory ? 'bg-black' : 'bg-[#a1a1aa]'}`} />
          </button>
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
                    <div className="mt-2 flex items-center gap-1 rounded-lg bg-[#181818] p-1">
                      {([
                        { value: 'all', label: 'All models', icon: null },
                        { value: 'image', label: 'Image input', icon: <ImageIcon size={13} /> },
                        { value: 'audio', label: 'Audio input', icon: <AudioLines size={13} /> },
                        { value: 'video', label: 'Video input', icon: <Video size={13} /> },
                      ] as const).map((filter) => (
                        <button
                          key={filter.value}
                          type="button"
                          title={filter.label}
                          aria-label={filter.label}
                          aria-pressed={mediaFilter === filter.value}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMediaFilter(filter.value);
                          }}
                          className={`flex h-7 min-w-7 flex-1 items-center justify-center rounded-md text-[10px] transition-colors ${mediaFilter === filter.value ? 'bg-[#333] text-white' : 'text-[#888] hover:text-white'}`}
                        >
                          {filter.icon ?? 'All'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Model List */}
                  <div className="max-h-[260px] overflow-y-auto [&::-webkit-scrollbar]:hidden scrollbar-none pb-1">
                    {filteredModels.map((model) => (
                      <div
                        key={model.name}
                        onClick={() => {
                          setSelectedModel(model);
                          onModelChange?.(model.name.replace(/^models\//, ''));
                          if (model.maxOutputTokens !== undefined && modelParams.maxTokens > model.maxOutputTokens) {
                            const nextParams = { ...modelParams, maxTokens: model.maxOutputTokens };
                            setModelParams(nextParams);
                            updateConfig({ modelParams: nextParams });
                          }
                          setIsModelDropdownOpen(false);
                        }}
                        className="flex items-center gap-3 px-3 py-2.5 mx-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[#252525]"
                      >
                        <div className="shrink-0 flex items-center justify-center w-4 h-4">
                          {selectedModel?.name === model.name && <Check size={14} className="text-white" />}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-white text-[13px] font-medium">{formatModelName(model.displayName)}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[#777]">
                          {model.inputModalities.includes('image') && <ImageIcon size={11} aria-label="Image input" />}
                          {model.inputModalities.includes('audio') && <AudioLines size={11} aria-label="Audio input" />}
                          {model.inputModalities.includes('video') && <Video size={11} aria-label="Video input" />}
                        </span>
                      </div>
                    ))}
                    
                    {filteredModels.length === 0 && (
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

        {selectedModel && selectedInputModalities.length > 0 && !selectedInputModalities.includes('audio') && (
          <div className={`-mt-1 text-[10.5px] leading-relaxed ${selectedInputModalities.includes('image') ? 'text-[#888]' : 'text-amber-300/80'}`}>
            {selectedInputModalities.includes('image')
              ? 'Image attachments are supported. Audio and video require a compatible Gemini model.'
              : 'This model is text-only. Media attachments will fail validation.'}
          </div>
        )}

        <div className="flex items-center justify-between shrink-0 relative">
          <label className="text-white text-[14.5px] font-medium">Tools</label>
          <button 
            ref={toolsDropdownButtonRef}
            onClick={() => setIsToolsDropdownOpen(!isToolsDropdownOpen)}
            className="text-[#a1a1aa] hover:text-white transition-colors p-[5px] -mr-1 rounded hover:bg-[#2b2b2b]"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
          {configuredTools.length > 0 && (
            <div className="absolute left-0 top-8 flex flex-wrap gap-1.5 max-w-[260px]">
              {configuredTools.map((tool, index) => {
                const editable = ['function', 'custom', 'file_search', 'web_search', 'code_interpreter', 'mcp'].includes(String(tool.kind));
                const mcpServer = tool.kind === 'mcp' ? mcpServers.find((server) => server.id === tool.serverId) : null;
                const label = String(tool.name ?? mcpServer?.label ?? tool.kind).replaceAll('_', ' ');
                return (
                  <div
                    key={`${tool.kind}-${index}`}
                    className="flex items-center rounded-md bg-[#252525] text-[#c4c4c4] text-[10px] overflow-hidden"
                  >
                    <button
                      type="button"
                      title={editable ? `Configure ${label}` : label}
                      onClick={() => editable && void openAttachedToolEditor(tool, index)}
                      className={`px-2 py-1 capitalize ${editable ? 'hover:text-white' : 'cursor-default'}`}
                    >
                      {label}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      title={`Remove ${label}`}
                      onClick={() => removeAgentTool(index)}
                      className="self-stretch px-1.5 hover:bg-[#333] hover:text-white"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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
                        setToolDialogError(null);
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
                        setToolDialogError(null);
                        setEditingToolIndex(null);
                        setSelectedVectorStoreIds([]);
                        setFileSearchMaxResults(8);
                        setFileSearchScoreThreshold(0);
                        hydrateToolExecutionPolicy({}, 60000);
                        setIsFileSearchModalOpen(true);
                      }}
                      className="flex items-center gap-3 px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group"
                    >
                      <Database size={15} strokeWidth={1.5} className="text-[#a1a1aa] group-hover:text-white transition-colors" />
                      File search
                    </button>
                    <button
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        setToolDialogError(null);
                        setEditingToolIndex(null);
                        setWebSearchMaxResults(5);
                        hydrateToolExecutionPolicy({}, 20000);
                        setIsWebSearchModalOpen(true);
                      }}
                      className="flex items-center gap-3 px-3 py-2 text-left text-[13px] text-[#e0e0e0] hover:bg-[#2b2b2b] transition-colors w-full group"
                    >
                      <Globe size={15} strokeWidth={1.5} className="text-[#a1a1aa] group-hover:text-white transition-colors" />
                      Web search
                    </button>
                    <button 
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        setToolDialogError(null);
                        setEditingToolIndex(null);
                        setCodeInterpreterTimeoutMs(5000);
                        setCodeInterpreterFiles([]);
                        hydrateToolExecutionPolicy({}, 5000);
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
                        setToolDialogError(null);
                        setEditingToolIndex(null);
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
                        setToolDialogError(null);
                        setEditingToolIndex(null);
                        setCustomToolName('');
                        setCustomToolDescription('');
                        setSelectedFormat('Text');
                        hydrateToolExecutionPolicy({}, 5000);
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

        <div className="flex shrink-0 flex-col gap-2 border-t border-[#2b2b2b] pt-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-white">Handoffs</div>
              <div className="text-[10.5px] text-[#777]">Let the model transfer to a specialist agent</div>
            </div>
            <button type="button" title="Add agent handoff" aria-label="Add agent handoff" disabled={availableHandoffTargets.length === 0} onClick={addHandoff} className="flex h-7 w-7 items-center justify-center rounded text-[#999] hover:bg-[#2b2b2b] hover:text-white disabled:opacity-30"><Plus size={15} /></button>
          </div>
          {configuredHandoffs.map((handoff, index) => (
            <div key={`${handoff.targetNodeId}-${index}`} className="rounded-md border border-[#303030] bg-[#222] p-2">
              <div className="flex items-center gap-2">
                <select value={handoff.targetNodeId} onChange={(event) => updateHandoff(index, { targetNodeId: event.target.value })} aria-label={`Handoff ${index + 1} target`} className="h-7 min-w-0 flex-1 rounded border border-[#353535] bg-[#292929] px-2 text-[11px] text-white outline-none">
                  {agentOptions.filter((candidate) => candidate.id !== nodeId && (candidate.id === handoff.targetNodeId || !configuredHandoffs.some((item, itemIndex) => itemIndex !== index && item.targetNodeId === candidate.id))).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                </select>
                <button type="button" title="Remove handoff" aria-label={`Remove handoff ${index + 1}`} onClick={() => removeHandoff(index)} className="text-[#777] hover:text-red-300"><Trash2 size={13} /></button>
              </div>
              <input value={handoff.toolName ?? ''} onChange={(event) => updateHandoff(index, { toolName: event.target.value })} aria-label={`Handoff ${index + 1} tool name`} placeholder="transfer_to_specialist" className="mt-2 h-7 w-full rounded border border-[#353535] bg-[#292929] px-2 font-mono text-[10.5px] text-white outline-none placeholder:text-[#666]" />
              <input value={handoff.description ?? ''} onChange={(event) => updateHandoff(index, { description: event.target.value })} aria-label={`Handoff ${index + 1} description`} placeholder="When should the model transfer?" className="mt-2 h-7 w-full rounded border border-[#353535] bg-[#292929] px-2 text-[10.5px] text-white outline-none placeholder:text-[#666]" />
            </div>
          ))}
          {configuredHandoffs.length === 0 && <div className="rounded-md border border-dashed border-[#303030] px-2 py-2 text-center text-[10.5px] text-[#666]">No specialist handoffs configured</div>}
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
                    {['Text', 'JSON'].map((formatOption) => (
                      <button
                        key={formatOption}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAgentFormat(formatOption);
                          onOutputFormatChange?.(formatOption === 'JSON' ? 'json' : 'text');
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
                    onClick={openJsonSchemaEditor}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#2b2b2b] hover:bg-[#333] transition-colors rounded-full"
                  >
                    {config?.outputSchema ? <Settings size={14} className="text-[#a1a1aa]" /> : <Plus size={14} className="text-[#a1a1aa]" />}
                    <span className="text-white text-[13px] font-medium pr-1">{config?.outputSchema ? 'Edit schema' : 'Add schema'}</span>
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
                <label className="flex flex-col gap-1.5 text-white text-[13px]">
                  <span className="flex items-center justify-between gap-3">
                    Max output tokens
                    <input
                      type="number"
                      min={1}
                      max={selectedOutputLimit ?? 1000000}
                      step={1}
                      value={modelParams.maxTokens}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isInteger(value) || value < 1 || value > (selectedOutputLimit ?? 1000000)) return;
                        const next = { ...modelParams, maxTokens: value };
                        setModelParams(next);
                        updateConfig({ modelParams: next });
                      }}
                      className="h-8 w-28 rounded-md bg-[#2b2b2b] px-2 text-right outline-none"
                    />
                  </span>
                  <span className="text-[11px] text-[#777]">
                    {selectedOutputLimit ? `Model maximum: ${selectedOutputLimit.toLocaleString()}` : 'Model maximum is not published by this provider.'}
                  </span>
                </label>
                {([
                  ['temperature', 'Temperature', 0, 2, 0.05],
                  ['topP', 'Top P', 0, 1, 0.05],
                ] as const).filter(() => !isOpenAiReasoningModel).map(([key, label, min, max, step]) => (
                  <label key={key} className="flex flex-col gap-1.5">
                    <span className="flex items-center justify-between text-white text-[14px]">
                      <span>{label}</span>
                      <span className="text-[#a1a1aa] text-[12px]">
                        {Number(modelParams[key]).toFixed(2)}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={modelParams[key]}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        const next = { ...modelParams, [key]: value };
                        setModelParams(next);
                        updateConfig({ modelParams: next });
                      }}
                      className="w-full accent-white"
                    />
                  </label>
                ))}
                {(supportsReasoningControl || supportsVerbosityControl) && <div className={`grid gap-3 ${supportsReasoningControl && supportsVerbosityControl ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {supportsReasoningControl && (
                  <label className="flex flex-col gap-1.5 text-white text-[13px]">
                    Reasoning
                    <select
                      value={reasoningEffort}
                      onChange={(event) => {
                        setReasoningEffort(event.target.value);
                        updateConfig({ reasoningEffort: event.target.value });
                      }}
                      className="h-8 bg-[#2b2b2b] rounded-md px-2 text-[#d4d4d4] outline-none"
                    >
                      {['minimal', 'low', 'medium', 'high'].map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                  )}
                  {supportsVerbosityControl && (
                  <label className="flex flex-col gap-1.5 text-white text-[13px]">
                    Verbosity
                    <select
                      value={verbosity}
                      onChange={(event) => {
                        setVerbosity(event.target.value);
                        updateConfig({ verbosity: event.target.value });
                      }}
                      className="h-8 bg-[#2b2b2b] rounded-md px-2 text-[#d4d4d4] outline-none"
                    >
                      {['low', 'medium', 'high'].map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                  )}
                </div>}
                <label className="flex items-center justify-between text-white text-[13px]">
                  Max agent turns
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={maxTurns}
                    onChange={(event) => {
                      const value = Math.max(1, Math.min(32, Number(event.target.value) || 1));
                      setMaxTurns(value);
                      updateConfig({ maxTurns: value });
                    }}
                    className="w-20 h-8 bg-[#2b2b2b] rounded-md px-2 text-right outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-white text-[13px]">
                  <span className="flex items-center justify-between gap-3">Max input tokens / call
                  <input
                    type="number"
                    min={1}
                    max={selectedContextLimit ?? 10000000}
                    step={1}
                    value={maxInputTokensPerCall}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setMaxInputTokensPerCall(raw);
                      if (raw === '') {
                        updateConfig({ maxInputTokensPerCall: undefined });
                        return;
                      }
                      const value = Number(raw);
                      if (Number.isInteger(value) && value >= 1 && value <= (selectedContextLimit ?? 10000000)) {
                        updateConfig({ maxInputTokensPerCall: value });
                      }
                    }}
                    onBlur={() => {
                      const value = Number(maxInputTokensPerCall);
                      if (maxInputTokensPerCall !== '' && (!Number.isInteger(value) || value < 1 || value > (selectedContextLimit ?? 10000000))) {
                        setMaxInputTokensPerCall(config?.maxInputTokensPerCall == null ? '' : String(config.maxInputTokensPerCall));
                      }
                    }}
                    title="Maximum request size accepted by each model call"
                    className="w-24 h-8 bg-[#2b2b2b] rounded-md px-2 text-right outline-none"
                  />
                  </span>
                  <span className={`text-[11px] ${configuredEnvelopeExceedsContext ? 'text-amber-400' : 'text-[#777]'}`}>
                    {configuredEnvelopeExceedsContext
                      ? `Input plus output exceeds the ${selectedContextLimit?.toLocaleString()} token context window.`
                      : selectedContextLimit
                        ? `Context window: ${selectedContextLimit.toLocaleString()}. Blank keeps automatic provider behavior.`
                        : 'Blank keeps automatic provider behavior; this model has no verified context limit.'}
                  </span>
                </label>
                <label className="flex items-center justify-between gap-3 text-white text-[13px]">
                  Model timeout (seconds)
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={modelTimeoutMs / 1000}
                    onChange={(event) => {
                      const entered = Number(event.target.value) || 0;
                      const seconds = entered <= 0 ? 0 : Math.max(0.1, Math.min(600, entered));
                      const value = Math.round(seconds * 1000);
                      setModelTimeoutMs(value);
                      updateConfig({ modelTimeoutMs: value });
                    }}
                    title="Maximum time for each model call. Use 0 for no timeout."
                    className="w-20 h-8 bg-[#2b2b2b] rounded-md px-2 text-right outline-none"
                  />
                </label>
                {(/^(gpt-|o[134])/.test(normalizedSelectedModel) || normalizedSelectedModel.startsWith('claude-')) && (
                  <div className="flex flex-col gap-2 rounded-md border border-[#303030] bg-[#222] p-2.5">
                    <div className="flex items-center justify-between gap-3 text-[13px] text-white">
                      <span>Prompt cache</span>
                      <select value={config?.promptCache?.policy ?? 'auto'} onChange={(event) => updateConfig({ promptCache: { policy: event.target.value } })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-[#d4d4d4] outline-none">
                        <option value="auto">Provider default</option>
                        <option value="enabled">Enabled</option>
                        {!/^(gpt-|o[134])/.test(normalizedSelectedModel) && <option value="disabled">Disabled</option>}
                      </select>
                    </div>
                    {config?.promptCache?.policy === 'enabled' && /^(gpt-|o[134])/.test(normalizedSelectedModel) && <input value={config?.promptCache?.key ?? ''} maxLength={64} onChange={(event) => updateConfig({ promptCache: { ...config?.promptCache, key: event.target.value || undefined } })} placeholder="Stable cache key (optional)" className="h-8 rounded-md bg-[#2b2b2b] px-2 font-mono text-[11px] text-white outline-none placeholder:text-[#666]" />}
                    {config?.promptCache?.policy === 'enabled' && (
                      <select value={config?.promptCache?.retention ?? (/^(gpt-|o[134])/.test(normalizedSelectedModel) ? 'in-memory' : '5m')} onChange={(event) => updateConfig({ promptCache: { ...config?.promptCache, retention: event.target.value } })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-[11px] text-[#d4d4d4] outline-none">
                        {/^(gpt-|o[134])/.test(normalizedSelectedModel) ? <><option value="in-memory">In-memory</option><option value="24h">24 hours</option></> : <><option value="5m">5 minutes</option><option value="1h">1 hour</option></>}
                      </select>
                    )}
                    <p className="text-[10px] leading-relaxed text-[#666]">Cache metadata is traced, but cache keys are redacted from public traces.</p>
                  </div>
                )}
                <label className="flex items-center justify-between gap-3 text-white text-[13px]">
                  Tool choice
                  <select
                    value={toolChoice}
                    onChange={(event) => {
                      const next = event.target.value;
                      setToolChoice(next);
                      updateConfig({ toolChoice: next.startsWith('tool:') ? { name: next.slice(5) } : next });
                    }}
                    className="h-8 min-w-28 rounded-md bg-[#2b2b2b] px-2 text-[#d4d4d4] outline-none"
                  >
                    <option value="auto">Automatic</option>
                    <option value="required" disabled={configuredTools.length === 0}>Required</option>
                    <option value="none">Disabled</option>
                    {specificToolChoices.map((name) => <option key={name} value={`tool:${name}`}>Require {name}</option>)}
                  </select>
                </label>
              </div>

              {/* Advanced */}
              <div className="flex flex-col gap-4 mt-2">
                <h3 className="text-[#a1a1aa] text-[13px] font-medium tracking-wide">Advanced</h3>
                
                <label className="flex items-center justify-between gap-3 text-white text-[13px]">
                  On error
                  <select
                    value={onErrorPolicy}
                    onChange={(event) => {
                      const next = event.target.value as AgentErrorPolicy;
                      setOnErrorPolicy(next);
                      updateConfig({ onError: next, continueOnError: undefined });
                    }}
                    title={onErrorPolicy === 'branch' ? 'Connect the red Error handle to recover from failures.' : undefined}
                    className="h-8 min-w-40 rounded-md bg-[#2b2b2b] px-2 text-[#d4d4d4] outline-none"
                  >
                    <option value="fail">Stop workflow</option>
                    <option value="continue">Continue on default path</option>
                    <option value="branch">Route through error handle</option>
                  </select>
                </label>
                <p className="text-[#6a6a6a] text-[11px] -mt-2">
                  {onErrorPolicy === 'branch' ? 'Connect the red Error handle to choose the recovery path.' : onErrorPolicy === 'continue' ? 'Expose the error in this node output and continue normally.' : 'Errors stop the run and appear in the preview trace.'}
                </p>

                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Write to conversation history</label>
                  <button
                    type="button"
                    aria-pressed={writeToConversationHistory}
                    onClick={() => {
                      const next = !writeToConversationHistory;
                      setWriteToConversationHistory(next);
                      updateConfig({ writeToConversationHistory: next });
                    }}
                    className={`w-[42px] h-[24px] rounded-full flex items-center px-0.5 cursor-pointer ${writeToConversationHistory ? 'bg-white justify-end' : 'bg-[#404040] justify-start'}`}
                  >
                    <span className={`w-[20px] h-[20px] rounded-full shadow-sm ${writeToConversationHistory ? 'bg-black' : 'bg-[#a1a1aa]'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Parallel tool calls</label>
                  <button
                    type="button"
                    aria-pressed={parallelToolCalls}
                    onClick={() => {
                      const next = !parallelToolCalls;
                      setParallelToolCalls(next);
                      updateConfig({ parallelToolCalls: next });
                    }}
                    className={`w-[42px] h-[24px] rounded-full flex items-center px-0.5 cursor-pointer ${parallelToolCalls ? 'bg-white justify-end' : 'bg-[#404040] justify-start'}`}
                  >
                    <span className={`w-[20px] h-[20px] rounded-full shadow-sm ${parallelToolCalls ? 'bg-black' : 'bg-[#a1a1aa]'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-white text-[14px]">Reset tool choice after call</label>
                  <button
                    type="button"
                    aria-pressed={resetToolChoice}
                    onClick={() => {
                      const next = !resetToolChoice;
                      setResetToolChoice(next);
                      updateConfig({ resetToolChoice: next });
                    }}
                    className={`w-[42px] h-[24px] rounded-full flex items-center px-0.5 cursor-pointer ${resetToolChoice ? 'bg-white justify-end' : 'bg-[#404040] justify-start'}`}
                  >
                    <span className={`w-[20px] h-[20px] rounded-full shadow-sm ${resetToolChoice ? 'bg-black' : 'bg-[#a1a1aa]'}`} />
                  </button>
                </div>
              </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {contract && (
            <div className="flex flex-col gap-2 pt-[18px] mt-[18px] border-t border-[#333]">
              <h3 className="text-[#a1a1aa] text-[13px] font-medium tracking-wide">Data contract</h3>
              {[['Inputs', contract.inputs], ['Outputs', contract.outputs]].map(([title, fields]) => (
                <div key={title as string} className="flex flex-col gap-1.5">
                  <span className="text-[#777] text-[10px] font-semibold uppercase tracking-wide">{title as string}</span>
                  {(fields as NodeDataContract['inputs']).map((field) => (
                    <div key={`${title}-${field.name}`} className="flex items-center justify-between gap-2 bg-[#222] rounded-md px-2.5 py-1.5">
                      <span className="text-[#d4d4d4] text-[11.5px] font-mono truncate">{field.name}</span>
                      <span className="text-[#777] text-[10px] uppercase shrink-0">{field.type}{field.required ? ' *' : ''}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
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
          <button type="button" onClick={() => { requestedEvaluationNodeId.set(nodeId); evaluationPanelOpen.set(true); }} className="flex items-center gap-1.5 text-[#a1a1aa] hover:text-white transition-colors">
            <span className="text-[14px] font-medium">Evaluate{attachedGraderCount > 0 ? ` (${attachedGraderCount})` : ''}</span>
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
                                token: '',
                                username: '',
                                password: '',
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
                        {mcpServers.length > 0 && (
                          <div className="mb-8">
                            <h3 className="text-[14px] font-medium text-black dark:text-white mb-3 mt-2">Connected servers</h3>
                            <div className="flex flex-col gap-2">
                              {mcpServers.map((server) => (
                                <div
                                  key={server.id}
                                  className="flex items-center gap-3 rounded-[8px] border border-gray-200 dark:border-[#333] px-3 py-3"
                                >
                                  <Blocks size={16} className="text-gray-500 dark:text-[#a1a1aa]" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[13px] font-medium text-black dark:text-white truncate">{server.label}</div>
                                    <div className="text-[11px] text-gray-500 dark:text-[#777]">{server.status}</div>
                                  </div>
                                  <button
                                    disabled={toolDialogBusy}
                                    onClick={() => void openMcpConfig(server)}
                                    className="h-8 px-3 rounded-[8px] bg-[#1a1a1a] dark:bg-white text-white dark:text-black text-[12px] font-medium disabled:opacity-40"
                                  >
                                    Attach
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {toolDialogError && (
                          <div className="mb-4 rounded-[8px] bg-red-50 dark:bg-[#2a1717] px-3 py-2 text-red-600 dark:text-red-300 text-[12px]">
                            {toolDialogError}
                          </div>
                        )}

                        {/* Built-in Section */}
                        {(mcpTab === 'All' || mcpTab === 'Hosted') && (
                          <div className="mb-8">
                            <h3 className="text-[14px] font-medium text-black dark:text-white mb-4 flex items-center gap-2 mt-2">
                              Built-in connectors <span className="text-gray-400 dark:text-[#6a6a6a] font-normal">— maintained by the platform</span>
                            </h3>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {mcpConnectors.filter((connector) => connector.tier === 'hosted').map(connector => (
                                <div 
                                  key={connector.key}
                                  onClick={() => {
                                    setSelectedConnector(connector);
                                    setMcpView('connector');
                                    setMcpForm({
                                      url: connector.url ?? '',
                                      label: `${connector.key}_mcp`,
                                      description: '',
                                      authType: connector.authHint === 'none' ? 'None' : 'Access token / API key',
                                      token: '',
                                      username: '',
                                      password: '',
                                    });
                                  }}
                                  className="flex flex-col justify-center gap-3 p-4 bg-transparent border border-gray-200 dark:border-[#333] rounded-xl hover:bg-[#f9f9f9] dark:hover:bg-[#1a1a1a] cursor-pointer transition-all duration-200 group min-h-[90px] active:scale-[0.98]"
                                >
                                  <div className="w-8 h-8 rounded-md flex items-center justify-center p-1" style={{ backgroundColor: `${connector.color || '#444'}15` }}>
                                    {connector.iconUrl ? <img src={connector.iconUrl} alt={`${connector.name} icon`} className="w-full h-full object-contain" draggable={false} /> : <Blocks size={18} />}
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
                              {mcpConnectors.filter((connector) => connector.tier === 'third-party').map(connector => (
                                <div 
                                  key={connector.key}
                                  onClick={() => {
                                    setSelectedConnector(connector);
                                    setMcpView('connector');
                                    setMcpForm({
                                      url: connector.url ?? '',
                                      label: `${connector.key}_mcp`,
                                      description: '',
                                      authType: connector.authHint === 'none' ? 'None' : 'Access token / API key',
                                      token: '',
                                      username: '',
                                      password: '',
                                    });
                                  }}
                                  className="flex flex-col justify-center gap-3 p-4 bg-transparent border border-gray-200 dark:border-[#333] rounded-xl hover:bg-[#f9f9f9] dark:hover:bg-[#1a1a1a] cursor-pointer transition-all duration-200 group min-h-[90px] active:scale-[0.98]"
                                >
                                  <div className="w-8 h-8 rounded-md flex items-center justify-center p-1" style={{ backgroundColor: `${connector.color || '#444'}15` }}>
                                    {connector.iconUrl ? <img src={connector.iconUrl} alt={`${connector.name} icon`} className="w-full h-full object-contain" draggable={false} /> : <Blocks size={18} />}
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
                      <div className="relative flex items-center justify-between w-full px-8 pb-6 pt-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                        {toolDialogError && <span className="absolute left-8 bottom-16 text-red-500 text-[12px] max-w-[420px]">{toolDialogError}</span>}
                        <button 
                          onClick={() => setMcpView('list')}
                          className="flex items-center gap-1.5 px-3 py-2 bg-[#f4f4f4] dark:bg-[#2b2b2b] hover:bg-[#eaeaea] dark:hover:bg-[#3d3d3d] rounded-[10px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                        >
                          <svg className="w-4 h-4 ml-[-2px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                          Back
                        </button>
                        <button
                          disabled={toolDialogBusy}
                          onClick={() => void connectAndAttachMcp()}
                          className="flex items-center gap-2 px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[10px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e] disabled:opacity-40"
                        >
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
                            
                            {mcpForm.authType === 'Basic Auth' ? (
                              <div className="mt-[2px] flex flex-col gap-2">
                                <input
                                  type="text"
                                  placeholder="Username"
                                  autoComplete="username"
                                  className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                                  value={mcpForm.username}
                                  onChange={(e) => setMcpForm({ ...mcpForm, username: e.target.value })}
                                />
                                <input
                                  type="password"
                                  placeholder="Password"
                                  autoComplete="new-password"
                                  className="w-full border border-gray-200 dark:border-[#333] rounded-[10px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                                  value={mcpForm.password}
                                  onChange={(e) => setMcpForm({ ...mcpForm, password: e.target.value })}
                                />
                              </div>
                            ) : mcpForm.authType === 'None' ? null : (
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
                                  onChange={(e) => setMcpForm({ ...mcpForm, token: e.target.value })}
                                />
                                <button type="button" aria-label="Hide access token" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/>
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions (sticky at bottom) */}
                      <div className="flex items-center justify-between w-full px-8 pb-8 pt-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] relative z-10">
                        {toolDialogError && <span className="absolute left-8 bottom-20 text-red-500 text-[12px] max-w-[420px]">{toolDialogError}</span>}
                        <button 
                          onClick={() => setMcpView('list')}
                          className="flex items-center gap-1.5 px-3 py-2 bg-[#f4f4f4] dark:bg-[#2b2b2b] hover:bg-[#eaeaea] dark:hover:bg-[#3d3d3d] rounded-[10px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                        >
                          <svg className="w-4 h-4 ml-[-2px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                          Back
                        </button>
                        <button
                          disabled={toolDialogBusy}
                          onClick={() => void connectAndAttachMcp()}
                          className="flex items-center gap-2 px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[10px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e] disabled:opacity-40"
                        >
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
                onClick={() => {
                  setEditingToolIndex(null);
                  setIsFileSearchModalOpen(false);
                }}
              />

              {/* Modal Content */}
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[560px] h-[620px] rounded-[16px] shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-6 pt-6 pb-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative">
                  <h2 className="text-[20px] font-semibold text-black dark:text-white">
                    {editingToolIndex === null ? 'Attach files to file search' : 'Configure file search'}
                  </h2>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] mb-4">
                    Create a store, upload source files, then choose which stores this agent may search.
                  </p>
                  <div className="flex gap-2 mb-4">
                    <input
                      value={newVectorStoreName}
                      onChange={(event) => setNewVectorStoreName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void createVectorStore();
                      }}
                      placeholder="New vector store name"
                      className="min-w-0 flex-1 rounded-[8px] border border-gray-200 dark:border-[#333] bg-white dark:bg-[#242424] px-3 py-2 text-[12px] text-black dark:text-white outline-none focus:border-black dark:focus:border-white"
                    />
                    <button
                      type="button"
                      onClick={() => void createVectorStore()}
                      disabled={vectorStoreBusy || !newVectorStoreName.trim()}
                      className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1a1a1a] dark:bg-white px-3 py-2 text-[12px] font-medium text-white dark:text-black disabled:opacity-40"
                    >
                      {vectorStoreBusy ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />}
                      Create
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {vectorStores.map((store) => {
                      const checked = selectedVectorStoreIds.includes(store.id);
                      const active = selectedVectorStoreId === store.id;
                      const ingestionUsage = store.embeddingUsage?.ingestion;
                      const searchUsage = store.embeddingUsage?.search;
                      const embeddingCost = (ingestionUsage?.estimatedCostUsd ?? 0) + (searchUsage?.estimatedCostUsd ?? 0);
                      return (
                        <React.Fragment key={store.id}>
                        <div
                          className={`flex items-center gap-3 rounded-[8px] border px-3 py-3 cursor-pointer ${
                            checked
                              ? 'border-black dark:border-white bg-white dark:bg-[#292929]'
                              : 'border-gray-200 dark:border-[#333] hover:bg-white dark:hover:bg-[#242424]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedVectorStoreIds((current) =>
                              checked ? current.filter((id) => id !== store.id) : [...current, store.id]
                            )}
                            className="accent-black dark:accent-white"
                          />
                          <Database size={16} className="text-gray-500 dark:text-[#a1a1aa]" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-black dark:text-white truncate">{store.name}</div>
                            {(ingestionUsage || searchUsage) && (
                              <div className="mt-0.5 text-[10px] text-gray-400 dark:text-[#666]">
                                Embeddings · {ingestionUsage?.reportedInputTokens?.toLocaleString() ?? 0} ingest tokens · {searchUsage?.operations ?? 0} searches{embeddingCost > 0 ? ` · $${embeddingCost.toFixed(4)}` : ''}
                                {((ingestionUsage?.unpricedOperations ?? 0) + (searchUsage?.unpricedOperations ?? 0)) > 0 && <span className="ml-1 text-amber-600 dark:text-amber-300">unpriced</span>}
                              </div>
                            )}
                            <div className="text-[11px] text-gray-500 dark:text-[#777]">{store.fileCount} files · {store.chunkCount} chunks</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedVectorStoreId(store.id)}
                            className="shrink-0 rounded-[6px] border border-gray-200 dark:border-[#3a3a3a] px-2 py-1 text-[11px] font-medium text-black dark:text-white"
                          >
                            {active ? 'Selected' : 'Manage'}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${store.name}`}
                            title="Delete vector store"
                            onClick={() => void deleteVectorStore(store.id)}
                            disabled={vectorStoreBusy}
                            className="shrink-0 rounded-[6px] p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-[#2a1717] disabled:opacity-40"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {active && (
                          <div className="mt-2 rounded-[8px] border border-gray-200 bg-white p-3 dark:border-[#333] dark:bg-[#242424]">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-[#777]">Source files</span>
                              <button
                                type="button"
                                onClick={() => vectorFileInputRef.current?.click()}
                                disabled={vectorStoreBusy}
                                className="inline-flex items-center gap-1 rounded-[6px] border border-gray-200 dark:border-[#3a3a3a] px-2 py-1 text-[11px] font-medium text-black dark:text-white disabled:opacity-40"
                              >
                                <Upload size={12} />
                                Upload file
                              </button>
                            </div>
                            {selectedVectorStoreFiles.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                  {selectedVectorStoreFiles.map((file) => {
                                    const progress = file.totalUnits
                                      ? Math.round(((file.processedUnits ?? 0) / file.totalUnits) * 100)
                                      : 0;
                                    return (
                                      <div key={file.id} className="flex items-start justify-between gap-2 py-1 text-[11px] text-gray-500 dark:text-[#999]">
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-gray-700 dark:text-[#bbb]">{file.filename}</div>
                                          <div className={file.status === 'error' ? 'text-red-500' : file.status === 'cancelled' ? 'text-amber-600' : ''}>
                                            {file.status === 'processing' ? (file.stage ?? 'processing') : file.status}
                                            {file.status === 'processing' && file.totalUnits ? ` - ${progress}%` : ''}
                                          </div>
                                          {file.status === 'processing' && (
                                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-[#333]">
                                              <div
                                                className="h-full bg-emerald-500 transition-[width] duration-300"
                                                style={{ width: file.totalUnits ? `${progress}%` : '20%' }}
                                              />
                                            </div>
                                          )}
                                          {file.error && file.status !== 'ready' && (
                                            <div className="mt-0.5 truncate text-[10px] text-red-500" title={file.error}>{file.error}</div>
                                          )}
                                        </div>
                                        {file.status === 'processing' ? (
                                          <button
                                            type="button"
                                            aria-label={`Cancel ${file.filename}`}
                                            title="Cancel ingestion"
                                            onClick={() => void cancelVectorStoreFile(file.id)}
                                            disabled={cancellingVectorFileIds.has(file.id)}
                                            className="mt-0.5 shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-40"
                                          >
                                            <X size={12} />
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            aria-label={`Delete ${file.filename}`}
                                            title="Delete file"
                                            onClick={() => void deleteVectorStoreFile(file.id)}
                                            disabled={vectorStoreBusy}
                                            className="mt-0.5 shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-40"
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                            ) : (
                              <div className="text-[11px] text-gray-400 dark:text-[#777]">No files yet.</div>
                            )}
                          </div>
                        )}
                        </React.Fragment>
                      );
                    })}
                    {vectorStores.length === 0 && (
                      <div className="rounded-[8px] border border-dashed border-gray-300 dark:border-[#3a3a3a] p-6 text-center text-[12px] text-gray-500 dark:text-[#777]">
                        Create a vector store above to get started.
                      </div>
                    )}
                  </div>
                  <div className="mt-5 grid grid-cols-1 gap-4 border-t border-gray-200 pt-5 dark:border-[#333] sm:grid-cols-2">
                    <label className="flex flex-col gap-2 text-[12px] font-medium text-black dark:text-white">
                      Maximum results
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={fileSearchMaxResults}
                        onChange={(event) => setFileSearchMaxResults(Number(event.target.value))}
                        className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] font-normal outline-none focus:border-black dark:border-[#333] dark:bg-[#242424] dark:text-white dark:focus:border-white"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-[12px] font-medium text-black dark:text-white">
                      Score threshold <span className="font-normal text-gray-400">{fileSearchScoreThreshold.toFixed(2)}</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={fileSearchScoreThreshold}
                        onChange={(event) => setFileSearchScoreThreshold(Number(event.target.value))}
                        className="h-8 w-full accent-black dark:accent-white"
                      />
                    </label>
                    {mcpRequireApproval === 'always' && (
                      <label className="flex flex-col gap-2 text-[13px] font-medium text-black dark:text-white">
                        Approval timeout (seconds)
                        <input
                          type="number"
                          min={0}
                          max={604800}
                          step={1}
                          value={mcpApprovalTimeoutMs ? mcpApprovalTimeoutMs / 1000 : ''}
                          placeholder="No timeout"
                          onChange={(event) => setMcpApprovalTimeoutMs(event.target.value === '' ? 0 : Math.max(0, Math.min(604800000, Math.round(Number(event.target.value) * 1000))))}
                          className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] font-normal outline-none dark:border-[#333] dark:bg-[#242424] dark:text-white"
                        />
                        <span className="text-[11px] font-normal text-gray-500">0 waits indefinitely. Execution timeout starts after approval.</span>
                      </label>
                    )}
                  </div>
                  {toolExecutionPolicyFields}
                  {toolDialogError && <div className="text-red-500 text-[12px] mt-3">{toolDialogError}</div>}
                  <input
                    ref={vectorFileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,.html,.xml,.yaml,.yml,.log,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/json,text/csv"
                    onChange={(event) => void uploadVectorStoreFile(event)}
                    className="hidden"
                  />
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end w-full px-6 py-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setEditingToolIndex(null);
                        setIsFileSearchModalOpen(false);
                      }}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={!selectedVectorStoreIds.length}
                      onClick={attachFileSearchTool}
                      className="px-4 py-2 bg-[#1a1a1a] dark:bg-white text-white dark:text-black rounded-[8px] text-[13.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {editingToolIndex === null ? 'Attach' : 'Update'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
      {/* MCP Tool Configuration Modal */}
      {createPortal(
        <AnimatePresence>
          {isMcpConfigModalOpen && mcpConfigServer && (
            <div className="fixed inset-0 z-[99999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => {
                  setEditingToolIndex(null);
                  setIsMcpConfigModalOpen(false);
                }}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="relative flex max-h-[720px] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] bg-[#fafafa] shadow-2xl dark:bg-[#1e1e1e]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-b border-gray-200 px-6 pb-4 pt-6 dark:border-[#333]">
                  <h2 className="text-[20px] font-semibold text-black dark:text-white">
                    {editingToolIndex === null ? 'Attach' : 'Configure'} {mcpConfigServer.label}
                  </h2>
                  <p className="mt-1 text-[13px] text-gray-500 dark:text-[#888]">Choose which server tools this agent can call.</p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <span className="text-[13px] font-medium text-black dark:text-white">Allowed tools</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMcpAllowedTools(mcpAvailableTools.map((tool) => tool.name))}
                        className="text-[12px] font-medium text-gray-600 hover:text-black dark:text-[#aaa] dark:hover:text-white"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setMcpAllowedTools([])}
                        className="text-[12px] font-medium text-gray-600 hover:text-black dark:text-[#aaa] dark:hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  {toolDialogBusy ? (
                    <div className="py-8 text-center text-[13px] text-gray-500">Loading tools...</div>
                  ) : mcpAvailableTools.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {mcpAvailableTools.map((tool) => {
                        const checked = mcpAllowedTools.includes(tool.name);
                        return (
                          <label key={tool.name} className="flex cursor-pointer items-start gap-3 rounded-[8px] border border-gray-200 px-3 py-3 dark:border-[#333]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setMcpAllowedTools((current) => checked ? current.filter((name) => name !== tool.name) : [...current, tool.name])}
                              className="mt-0.5 accent-black dark:accent-white"
                            />
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium text-black dark:text-white">{tool.name}</span>
                              {tool.description && <span className="mt-0.5 block text-[11.5px] text-gray-500 dark:text-[#888]">{tool.description}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[8px] border border-gray-200 px-3 py-4 text-[12px] text-gray-500 dark:border-[#333]">This server did not report any tools.</div>
                  )}
                  <div className="mt-6 border-t border-gray-200 pt-5 dark:border-[#333]">
                    <label className="flex flex-col gap-2 text-[13px] font-medium text-black dark:text-white">
                      Approval policy
                      <select
                        value={mcpRequireApproval}
                        onChange={(event) => setMcpRequireApproval(event.target.value as 'never' | 'always')}
                        className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] font-normal outline-none dark:border-[#333] dark:bg-[#242424] dark:text-white"
                      >
                        <option value="never">Never require approval</option>
                        <option value="always">Always require approval</option>
                      </select>
                    </label>
                  </div>
                  {toolExecutionPolicyFields}
                  {toolDialogError && <div className="mt-4 text-[12px] text-red-500">{toolDialogError}</div>}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-[#333]">
                  <button
                    onClick={() => {
                      setEditingToolIndex(null);
                      setIsMcpConfigModalOpen(false);
                    }}
                    className="rounded-[8px] bg-gray-200 px-4 py-2 text-[13.5px] font-medium text-black dark:bg-[#2b2b2b] dark:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={toolDialogBusy || mcpAllowedTools.length === 0}
                    onClick={saveMcpTool}
                    className="rounded-[8px] bg-[#1a1a1a] px-5 py-2 text-[13.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
                  >
                    {editingToolIndex === null ? 'Attach' : 'Update'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
      {/* Web Search Modal */}
      {createPortal(
        <AnimatePresence>
          {isWebSearchModalOpen && (
            <div className="fixed inset-0 z-[9999999] flex items-center justify-center p-6 sm:p-12 pointer-events-auto">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60"
                onClick={() => {
                  setEditingToolIndex(null);
                  setIsWebSearchModalOpen(false);
                }}
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative flex w-full max-w-[500px] flex-col overflow-hidden rounded-[16px] bg-[#fafafa] shadow-2xl dark:bg-[#1e1e1e]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-6 pb-4 pt-6">
                  <h2 className="mb-2 text-[20px] font-semibold text-black dark:text-white">
                    {editingToolIndex === null ? 'Web search' : 'Configure web search'}
                  </h2>
                  <p className="text-[14px] text-gray-500 dark:text-[#a0a0a0]">Search the public web while the agent is running.</p>
                </div>
                <div className="px-6 py-5">
                  <label className="flex flex-col gap-2 text-[13px] font-medium text-black dark:text-white">
                    Maximum results
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={webSearchMaxResults}
                      onChange={(event) => setWebSearchMaxResults(Number(event.target.value))}
                      className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] font-normal outline-none focus:border-black dark:border-[#333] dark:bg-[#242424] dark:text-white dark:focus:border-white"
                    />
                  </label>
                  <p className="mt-2 text-[11.5px] text-gray-500 dark:text-[#888]">Between 1 and 10 results per search.</p>
                  {toolExecutionPolicyFields}
                </div>
                <div className="flex items-center justify-end gap-2 px-6 py-4">
                  <button
                    onClick={() => {
                      setEditingToolIndex(null);
                      setIsWebSearchModalOpen(false);
                    }}
                    className="rounded-[8px] bg-gray-200 px-4 py-2 text-[13.5px] font-medium text-black transition-colors hover:bg-gray-300 dark:bg-[#2b2b2b] dark:text-white dark:hover:bg-[#3d3d3d]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={attachWebSearchTool}
                    className="rounded-[8px] bg-[#1a1a1a] px-5 py-2 text-[13.5px] font-medium text-white dark:bg-white dark:text-[#1a1a1a]"
                  >
                    {editingToolIndex === null ? 'Add' : 'Update'}
                  </button>
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
                onClick={() => {
                  setEditingToolIndex(null);
                  setIsCodeInterpreterModalOpen(false);
                }}
              />

              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="relative bg-[#fafafa] dark:bg-[#1e1e1e] w-full max-w-[500px] max-h-[680px] rounded-[16px] shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 pt-6 pb-2 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e] z-10 relative">
                  <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">
                    {editingToolIndex === null ? 'Code interpreter' : 'Configure code interpreter'}
                  </h2>
                  <p className="text-[14px] text-gray-500 dark:text-[#a0a0a0]">Run sandboxed JavaScript and analyze attached text files.</p>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div
                    className="flex flex-col items-center justify-center w-full max-w-[380px] mx-auto cursor-pointer rounded-[12px] border border-dashed border-gray-300 p-5 dark:border-[#444]"
                    onClick={() => codeInterpreterFileInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void addCodeInterpreterFiles(event.dataTransfer.files);
                    }}
                  >
                    <div className="w-12 h-12 bg-white dark:bg-[#2b2b2b] rounded-xl shadow-sm border border-gray-100 dark:border-[#333] flex items-center justify-center mb-4">
                      <svg className="w-6 h-6 text-black dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <h3 className="text-[15.5px] font-semibold text-black dark:text-white mb-2 transition-colors">Drag your files here or click to upload</h3>
                    <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] text-center mb-5">Adding files is optional.</p>
                    <div className="flex items-center justify-center w-full">
                      <button type="button" className="px-4 py-2 bg-gray-200 dark:bg-[#333] hover:bg-gray-300 dark:hover:bg-[#404040] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors">
                        Select files
                      </button>
                    </div>
                    <input
                      ref={codeInterpreterFileInputRef}
                      type="file"
                      multiple
                      accept="text/*,.json,.csv,.md,.xml,.yaml,.yml,.js,.ts,.py"
                      className="hidden"
                      onChange={(event) => {
                        if (event.target.files) void addCodeInterpreterFiles(event.target.files);
                        event.target.value = '';
                      }}
                    />
                  </div>
                  {codeInterpreterFiles.length > 0 && (
                    <div className="mx-auto mt-4 flex w-full max-w-[380px] flex-col gap-2">
                      {codeInterpreterFiles.map((file) => (
                        <div key={file.name} className="flex items-center gap-2 rounded-[8px] border border-gray-200 px-3 py-2 dark:border-[#333]">
                          <FileText size={14} className="text-gray-500" />
                          <span className="min-w-0 flex-1 truncate text-[12px] text-black dark:text-white">{file.name}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            title={`Remove ${file.name}`}
                            onClick={() => setCodeInterpreterFiles((current) => current.filter((candidate) => candidate.name !== file.name))}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mx-auto mt-5 w-full max-w-[380px]">
                    <label className="flex w-full flex-col gap-2 text-[12px] font-medium text-black dark:text-white">
                      Execution timeout (milliseconds)
                      <input
                        type="number"
                        min={100}
                        max={120000}
                        step={100}
                        value={codeInterpreterTimeoutMs}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setCodeInterpreterTimeoutMs(Number.isFinite(value) ? Math.max(100, Math.min(120000, Math.round(value))) : 5000);
                        }}
                        className="rounded-[8px] border border-gray-200 bg-white px-3 py-2 text-[13px] font-normal outline-none focus:border-black dark:border-[#333] dark:bg-[#242424] dark:text-white dark:focus:border-white"
                      />
                    </label>
                    {toolExecutionPolicyFields}
                    {toolDialogError && <div className="mt-2 text-[11.5px] text-red-500">{toolDialogError}</div>}
                  </div>
                </div>

                <div className="flex items-center justify-end w-full px-6 py-4 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setEditingToolIndex(null);
                        setIsCodeInterpreterModalOpen(false);
                      }}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={attachCodeInterpreterTool}
                      className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]"
                    >
                      {editingToolIndex === null ? 'Add' : 'Update'}
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
                onClick={() => {
                  setEditingToolIndex(null);
                  setIsFunctionModalOpen(false);
                }}
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
                  <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">
                    {editingToolIndex === null ? 'Function' : 'Configure function'}
                  </h2>
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
                      value={functionDefinition}
                      onChange={(event) => {
                        setFunctionDefinition(event.target.value);
                        setToolDialogError(null);
                      }}
                      className="flex-1 w-full p-4 font-mono text-[13px] text-gray-800 dark:text-[#e0e0e0] leading-[1.6] bg-transparent resize-none outline-none focus:ring-0 placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                      placeholder="Write a JSON function definition..."
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
                    {toolDialogError && <span className="text-red-500 text-[12px] max-w-[260px]">{toolDialogError}</span>}
                    <button 
                      onClick={() => {
                        setEditingToolIndex(null);
                        setIsFunctionModalOpen(false);
                      }}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={attachFunctionTool}
                      className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]"
                    >
                      {editingToolIndex === null ? 'Add' : 'Update'}
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
                            <div className="flex items-center gap-3 px-1 pb-2 text-[12px] text-gray-500 dark:text-[#999]">
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" checked={prop.nullable} onChange={(event) => {
                                  const newProps = [...jsonSchemaProperties];
                                  newProps[idx].nullable = event.target.checked;
                                  setJsonSchemaProperties(newProps);
                                }} className="accent-black dark:accent-white" />
                                Nullable
                              </label>
                              {['String', 'Number'].includes(prop.type) && (
                                <input value={prop.enumValues} onChange={(event) => {
                                  const newProps = [...jsonSchemaProperties];
                                  newProps[idx].enumValues = event.target.value;
                                  setJsonSchemaProperties(newProps);
                                }} placeholder="Allowed values, comma separated" className="h-7 min-w-0 flex-1 rounded border border-gray-200 bg-transparent px-2 text-[11.5px] text-black outline-none dark:border-[#333] dark:text-white" />
                              )}
                              {prop.type === 'Array' && (
                                <label className="ml-auto flex items-center gap-2">Items
                                  <select value={prop.arrayItemType} onChange={(event) => {
                                    const newProps = [...jsonSchemaProperties];
                                    newProps[idx].arrayItemType = event.target.value;
                                    setJsonSchemaProperties(newProps);
                                  }} className="h-7 rounded border border-gray-200 bg-transparent px-2 text-[11.5px] text-black outline-none dark:border-[#333] dark:text-white">
                                    <option value="String">String</option>
                                    <option value="Number">Number</option>
                                    <option value="Boolean">Boolean</option>
                                    <option value="Object">Object</option>
                                  </select>
                                </label>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      <button 
                        onClick={() => setJsonSchemaProperties([...jsonSchemaProperties, { id: Date.now(), name: '', type: 'String', description: '', nullable: false, enumValues: '', arrayItemType: 'String' }])}
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
                  {jsonSchemaDraft.error && <div className="whitespace-pre-line rounded-md border border-red-300/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-300">{jsonSchemaDraft.error}</div>}
                </motion.div>

                <motion.div 
                  layout 
                  transition={{ layout: { type: "spring", stiffness: 400, damping: 30 } }}
                  className="flex items-center justify-end w-full px-7 py-5 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]"
                >
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setIsJsonSchemaModalOpen(false)}
                      className="px-4 py-2 bg-transparent hover:bg-gray-100 dark:hover:bg-[#2b2b2b] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={saveJsonSchema}
                      disabled={!jsonSchemaDraft.schema}
                      className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e] disabled:cursor-not-allowed disabled:opacity-40"
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
                onClick={() => {
                  setEditingToolIndex(null);
                  hydrateToolExecutionPolicy({}, 5000);
                  setIsCustomToolModalOpen(false);
                }}
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
                  <h2 className="text-[20px] font-semibold text-black dark:text-white mb-2">
                    {editingToolIndex === null ? 'Custom tool' : 'Configure custom tool'}
                  </h2>
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
                      value={customToolName}
                      onChange={(event) => {
                        setCustomToolName(event.target.value);
                        setToolDialogError(null);
                      }}
                      className="w-full border border-gray-200 dark:border-[#333] rounded-[8px] px-3.5 py-2.5 text-[14px] outline-none hover:border-gray-300 dark:hover:border-[#444] focus:border-black dark:focus:border-white transition-colors bg-transparent text-black dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#6a6a6a]"
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label className="text-[14px] font-semibold text-black dark:text-white">Description</label>
                    <textarea 
                      placeholder="Describe what your tool should do, e.g. execute arbitrary code."
                      value={customToolDescription}
                      onChange={(event) => setCustomToolDescription(event.target.value)}
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

                  {toolExecutionPolicyFields}
                </div>

                <div className="flex items-center justify-end w-full px-7 py-5 shrink-0 bg-[#fafafa] dark:bg-[#1e1e1e]">
                  <div className="flex items-center gap-3">
                    {toolDialogError && <span className="text-red-500 text-[12px] max-w-[260px]">{toolDialogError}</span>}
                    <button 
                      onClick={() => {
                        setEditingToolIndex(null);
                        hydrateToolExecutionPolicy({}, 5000);
                        setIsCustomToolModalOpen(false);
                      }}
                      className="px-4 py-2 bg-gray-200 dark:bg-[#2b2b2b] hover:bg-gray-300 dark:hover:bg-[#3d3d3d] rounded-[8px] text-[13.5px] font-medium text-black dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={attachCustomTool}
                      className="px-5 py-2 bg-[#1a1a1a] dark:bg-white hover:bg-black dark:hover:bg-gray-100 rounded-[8px] text-[13.5px] font-medium text-white dark:text-[#1a1a1a] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-white dark:focus:ring-offset-[#1e1e1e]"
                    >
                      {editingToolIndex === null ? 'Add' : 'Update'}
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

const StartConfigPanel: React.FC<{ config: Record<string, any>; onConfigChange: (config: Record<string, any>) => void }> = ({ config, onConfigChange }) => {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('String');
  const [variableKind, setVariableKind] = useState<'input' | 'state'>('input');
  const [variableName, setVariableName] = useState('');
  const [variableDescription, setVariableDescription] = useState('');
  const [defaultValue, setDefaultValue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const types = ['String', 'Number', 'Boolean', 'Object', 'List'];
  const inputVariables = (Array.isArray(config.inputVariables) ? config.inputVariables : []).filter((variable: any) => variable.name !== 'input_as_text');
  const stateVariables = Array.isArray(config.stateVariables) ? config.stateVariables : [];

  const removeVariable = (kind: 'input' | 'state', index: number) => {
    if (kind === 'input') onConfigChange({ ...config, inputVariables: inputVariables.filter((_: any, candidate: number) => candidate !== index) });
    else onConfigChange({ ...config, stateVariables: stateVariables.filter((_: any, candidate: number) => candidate !== index) });
  };

  const saveVariable = () => {
    const name = variableName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setFormError('Use a letter or underscore followed by letters, numbers, or underscores.');
      return;
    }
    if ([...inputVariables, ...stateVariables].some((variable: any) => variable.name === name)) {
      setFormError(`Variable '${name}' already exists.`);
      return;
    }
    const type = selectedType.toLowerCase() === 'list' ? 'list' : selectedType.toLowerCase();
    let parsedDefault: unknown = undefined;
    if (defaultValue.trim()) {
      try {
        if (type === 'number') {
          parsedDefault = Number(defaultValue);
          if (!Number.isFinite(parsedDefault)) throw new Error('Enter a valid number.');
        } else if (type === 'boolean') {
          if (!['true', 'false'].includes(defaultValue.trim().toLowerCase())) throw new Error('Enter true or false.');
          parsedDefault = defaultValue.trim().toLowerCase() === 'true';
        } else if (type === 'object' || type === 'list') {
          parsedDefault = JSON.parse(defaultValue);
          if (type === 'object' && (!parsedDefault || typeof parsedDefault !== 'object' || Array.isArray(parsedDefault))) throw new Error('Enter a JSON object.');
          if (type === 'list' && !Array.isArray(parsedDefault)) throw new Error('Enter a JSON array.');
        } else parsedDefault = defaultValue;
      } catch (error) {
        setFormError((error as Error).message);
        return;
      }
    }
    if (variableKind === 'input') {
      onConfigChange({
        ...config,
        inputVariables: [...inputVariables, { name, type, ...(variableDescription.trim() ? { description: variableDescription.trim() } : {}), ...(parsedDefault !== undefined ? { defaultValue: parsedDefault } : {}) }],
      });
    } else {
      onConfigChange({ ...config, stateVariables: [...stateVariables, { name, type, ...(parsedDefault !== undefined ? { initialValue: parsedDefault } : {}) }] });
    }
    setVariableName('');
    setVariableDescription('');
    setDefaultValue('');
    setFormError(null);
    setIsAddMenuOpen(false);
  };

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
      className="absolute inset-x-3 top-16 max-h-[calc(100%-148px)] w-auto bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto md:inset-x-auto md:right-6 md:top-6 md:max-h-[calc(100%-48px)] md:w-[340px]"
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
          {inputVariables.map((variable: any, index: number) => (
            <div key={variable.name || index} className="flex items-center gap-2 rounded-lg bg-[#242424] px-3 py-2">
              <InputTextIcon className="text-[#22c55e]" size={15} />
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] text-white">{variable.name}</div>{(variable.description || variable.defaultValue !== undefined) && <div className="truncate text-[10px] text-[#777]">{variable.description || `Default: ${JSON.stringify(variable.defaultValue)}`}</div>}</div>
              <span className="text-[10px] font-semibold uppercase text-[#888]">{variable.type}</span>
              <button type="button" title={`Delete ${variable.name}`} onClick={() => removeVariable('input', index)} className="text-[#666] hover:text-red-300"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <h3 className="text-white text-[14.5px] font-medium tracking-wide">State variables</h3>
          {stateVariables.map((variable: any, index: number) => (
            <div key={variable.name || index} className="flex items-center gap-2 rounded-lg bg-[#242424] px-3 py-2">
              <Database size={14} className="text-sky-400" />
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] text-white">{variable.name}</div>{variable.initialValue !== undefined && <div className="truncate text-[10px] text-[#777]">{JSON.stringify(variable.initialValue)}</div>}</div>
              <span className="text-[10px] font-semibold uppercase text-[#888]">{variable.type}</span>
              <button type="button" title={`Delete ${variable.name}`} onClick={() => removeVariable('state', index)} className="text-[#666] hover:text-red-300"><Trash2 size={13} /></button>
            </div>
          ))}
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
              <div className="grid grid-cols-2 rounded-[10px] bg-[#141414] p-1">
                <button type="button" onClick={() => setVariableKind('input')} className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium ${variableKind === 'input' ? 'bg-[#3b3b3b] text-white' : 'text-[#999]'}`}>Workflow input</button>
                <button type="button" onClick={() => setVariableKind('state')} className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium ${variableKind === 'state' ? 'bg-[#3b3b3b] text-white' : 'text-[#999]'}`}>State variable</button>
              </div>
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
                  value={variableName}
                  onChange={(event) => { setVariableName(event.target.value); setFormError(null); }}
                  className="w-full bg-[#3b3b3b]/50 border-transparent rounded-[8px] px-3 py-2 text-[14px] text-white placeholder:text-[#888] focus:outline-none focus:ring-0 focus:border-transparent transition-colors font-medium"
                />
              </div>

              {variableKind === 'input' && <div className="flex flex-col gap-2"><label className="text-white text-[14px] font-medium">Description <span className="text-[#6a6a6a] font-normal">Optional</span></label><input value={variableDescription} onChange={(event) => setVariableDescription(event.target.value)} placeholder="How this input is used" className="w-full rounded-[8px] bg-[#3b3b3b]/50 px-3 py-2 text-[14px] text-white outline-none placeholder:text-[#888]" /></div>}
              <div className="flex flex-col gap-2"><label className="text-white text-[14px] font-medium">Default value <span className="text-[#6a6a6a] font-normal">Optional</span></label><input value={defaultValue} onChange={(event) => { setDefaultValue(event.target.value); setFormError(null); }} placeholder={selectedType === 'Object' ? '{}' : selectedType === 'List' ? '[]' : variableKind === 'input' ? 'Makes this input optional' : 'Initial value'} className="w-full rounded-[8px] bg-[#3b3b3b]/50 px-3 py-2 text-[14px] text-white outline-none placeholder:text-[#888]" /></div>
              {formError && <div className="text-[12px] text-red-300">{formError}</div>}

              {/* Save Button */}
              <div className="flex justify-end mt-1">
                <button
                  onClick={saveVariable}
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
  onTripwire?: 'branch' | 'stop';
  input?: string;
  settings?: {
    piiEntities?: string[];
    piiMode?: 'block' | 'mask';
    moderationCategories?: string[];
    confidenceThreshold?: number;
    hallucinationVectorStoreId?: string;
    checkModel?: string;
  };
  };
  onConfigChange: (newConfig: any) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

const GuardrailConfigPanel: React.FC<GuardrailConfigPanelProps> = ({ nodeName, onNameChange, config, onConfigChange, onDelete, onDuplicate }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [localName, setLocalName] = useState(nodeName);
  const [vectorStores, setVectorStores] = useState<VectorStore[]>([]);
  const { apiKeys } = useUserDataContext();
  const settings = config.settings ?? {};
  const confidenceThreshold = typeof settings.confidenceThreshold === 'number' && Number.isFinite(settings.confidenceThreshold)
    ? Math.max(0, Math.min(1, settings.confidenceThreshold))
    : 0.7;

  useEffect(() => {
    if (!config.hallucination) return;
    getAgentBuilderClient(apiKeys).listVectorStores().then((response) => setVectorStores(response.stores)).catch(() => setVectorStores([]));
  }, [apiKeys, config.hallucination]);

  const updateSettings = (patch: Partial<NonNullable<typeof config.settings>>) => onConfigChange({
    ...config,
    settings: { ...settings, ...patch },
  });

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
      className="absolute inset-x-3 top-16 max-h-[calc(100%-148px)] w-auto bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto md:inset-x-auto md:right-6 md:top-6 md:max-h-[calc(100%-48px)] md:w-[340px]"
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
            <button type="button" title="Duplicate guardrail" aria-label="Duplicate guardrail" onClick={onDuplicate} className="hover:text-white transition-colors"><Copy size={16} strokeWidth={2.5} /></button>
            <button type="button" title="Delete guardrail" aria-label="Delete guardrail" onClick={onDelete} className="hover:text-red-400 transition-colors"><Trash2 size={16} strokeWidth={2.5} /></button>
          </div>
        </div>
        <p className="text-[#a1a1aa] text-[13px] -mt-3.5 tracking-wide shrink-0">Run moderation, PII, jailbreak or fact checks</p>

        {/* Name Setting */}
        <div className="flex items-center justify-between gap-4 mt-2 shrink-0">
          <label className="text-white text-[14.5px] font-medium">Name</label>
          <div className="w-[min(220px,60%)] h-[32px] bg-[#2b2b2b] rounded-lg px-3 flex items-center">
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

        <label className="flex flex-col gap-1.5 text-white text-[13px]">Input template
          <textarea rows={2} value={config.input ?? '{{workflow.input_as_text}}'} onChange={(event) => onConfigChange({ ...config, input: event.target.value })} className="w-full resize-none rounded-lg bg-[#2b2b2b] p-2.5 font-mono text-[12px] text-white outline-none" />
        </label>

        {/* Toggles */}
        <div className="flex flex-col gap-4 mt-2 mb-2">
          {renderToggle('Personally identifiable information', 'pii')}
          {renderToggle('Moderation', 'moderation')}
          {renderToggle('Jailbreak', 'jailbreak')}
          {renderToggle('Hallucination', 'hallucination')}
          {renderToggle('Continue on error', 'continueOnError')}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">On tripwire
            <select value={config.onTripwire ?? 'branch'} onChange={(event) => onConfigChange({ ...config, onTripwire: event.target.value as 'branch' | 'stop' })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none"><option value="branch">Route to fail</option><option value="stop">Stop run</option></select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Check model
            <input value={settings.checkModel ?? 'gemini-3-flash'} onChange={(event) => updateSettings({ checkModel: event.target.value })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none" />
          </label>
        </div>

        {(config.moderation || config.jailbreak || config.hallucination) && (
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Confidence threshold
            <div className="flex items-center gap-3"><input type="range" min={0} max={1} step={0.05} value={confidenceThreshold} onChange={(event) => updateSettings({ confidenceThreshold: Number(event.target.value) })} className="min-w-0 flex-1 accent-white" /><span className="w-9 text-right text-white">{confidenceThreshold.toFixed(2)}</span></div>
          </label>
        )}

        {config.pii && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between text-[12px] text-[#aaa]">PII action
              <select value={settings.piiMode ?? 'block'} onChange={(event) => updateSettings({ piiMode: event.target.value as 'block' | 'mask' })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none"><option value="block">Block</option><option value="mask">Mask and continue</option></select>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN', 'CREDIT_CARD', 'IP_ADDRESS', 'IBAN', 'API_KEY'].map((entity) => {
                const selected = settings.piiEntities ?? [];
                const checked = selected.length === 0 || selected.includes(entity);
                return <label key={entity} className="flex items-center gap-1.5 text-[10.5px] text-[#aaa]"><input type="checkbox" checked={checked} onChange={() => {
                  const all = ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN', 'CREDIT_CARD', 'IP_ADDRESS', 'IBAN', 'API_KEY'];
                  const active = selected.length === 0 ? all : selected;
                  const next = active.includes(entity) ? active.filter((value) => value !== entity) : [...active, entity];
                  updateSettings({ piiEntities: next });
                }} className="accent-white" />{entity.replaceAll('_', ' ')}</label>;
              })}
            </div>
          </div>
        )}

        {config.moderation && (
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Moderation categories
            <input value={(settings.moderationCategories ?? []).join(', ')} onChange={(event) => updateSettings({ moderationCategories: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="All categories" className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none placeholder:text-[#666]" />
          </label>
        )}

        {config.hallucination && (
          <label className="flex flex-col gap-1.5 text-[12px] text-[#aaa]">Knowledge source
            <select value={settings.hallucinationVectorStoreId ?? ''} onChange={(event) => updateSettings({ hallucinationVectorStoreId: event.target.value })} className="h-8 rounded-md bg-[#2b2b2b] px-2 text-white outline-none"><option value="">Select vector store</option>{vectorStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
          </label>
        )}
      </div>
    </motion.div>
  );
};

const TemplatePicker: React.FC<{
  onClose: () => void;
  onUse: (template: WorkflowTemplate) => void | Promise<void>;
}> = ({ onClose, onUse }) => {
  type CatalogTemplate = WorkflowTemplate & {
    tags?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    preview?: {
      nodes?: Array<{ id: string; type: string; name: string }>;
      edges?: Array<{ source: string; target: string; sourceHandle?: string }>;
      contracts?: NodeDataContract[];
      safetyFindings?: Array<{ code: string; severity: string; message: string; remediation?: string; nodeId?: string }>;
      riskFactors?: Array<{ code: string; level: 'low' | 'medium' | 'high'; nodeId: string; message: string }>;
    };
  };
  const { apiKeys } = useUserDataContext();
  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAgentBuilderClient(apiKeys).listWorkflowTemplates()
      .then((response) => {
        if (active) {
          const catalog = response.templates as CatalogTemplate[];
          setTemplates(catalog);
          setSelectedId((current) => current || catalog[0]?.id || '');
        }
      })
      .catch((err) => active && setError((err as Error).message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [apiKeys, reloadKey]);

  const categories = [...new Set(templates.flatMap((template) => template.categories))].sort();
  const tags = [...new Set(templates.flatMap((template) => template.tags ?? []))].sort();
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTemplates = templates.filter((template) => {
    if (category !== 'all' && !template.categories.includes(category)) return false;
    if (tag !== 'all' && !(template.tags ?? []).includes(tag)) return false;
    if (!normalizedQuery) return true;
    return [template.name, template.description, ...template.categories, ...(template.tags ?? [])]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const selectedTemplate = filteredTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0];
  const riskClass = selectedTemplate?.riskLevel === 'high'
    ? 'border-red-800/70 bg-red-950/30 text-red-200'
    : selectedTemplate?.riskLevel === 'medium'
      ? 'border-amber-800/70 bg-amber-950/30 text-amber-200'
      : 'border-green-900/70 bg-green-950/20 text-green-200';

  const createFromTemplate = async (template: CatalogTemplate) => {
    setCreatingId(template.id);
    setError(null);
    try {
      await onUse(template);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="flex h-[min(720px,calc(100%_-_48px))] w-[min(980px,calc(100%_-_48px))] flex-col overflow-hidden rounded-lg border border-[#303030] bg-[#1a1a1a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <LayoutTemplate size={17} className="text-[#93dfca]" />
            <div><h2 className="text-white text-[16px] font-semibold">Workflow templates</h2><p className="mt-0.5 text-[11px] text-[#777]">Inspect the graph shape and contracts before creating a workflow.</p></div>
          </div>
          <button title="Close templates" onClick={onClose} className="text-[#8a8a8a] hover:text-white"><X size={17} /></button>
        </div>
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[#777]"><Loader2 size={18} className="animate-spin" /><span className="text-[11px]">Loading template catalog</span></div>
        ) : error && templates.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><div className="max-w-md text-[12px] text-red-300">{error}</div><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="rounded-md border border-[#3a3a3a] px-3 py-1.5 text-[11px] text-[#bbb] hover:text-white">Retry</button></div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-[#303030] bg-[#171717]">
              <div className="space-y-2 border-b border-[#303030] p-3">
                <label className="flex h-9 items-center gap-2 rounded-md border border-[#333] bg-[#222] px-2.5"><Search size={13} className="text-[#666]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-white outline-none placeholder:text-[#666]" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Template category" className="h-8 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-[#bbb] outline-none"><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                  <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Template tag" className="h-8 rounded-md border border-[#333] bg-[#222] px-2 text-[10.5px] text-[#bbb] outline-none"><option value="all">All tags</option>{tags.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {filteredTemplates.map((template) => (
                  <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`mb-2 block w-full rounded-md border p-3 text-left ${selectedTemplate?.id === template.id ? 'border-[#555] bg-[#292929]' : 'border-[#2d2d2d] bg-[#202020] hover:border-[#444]'}`}>
                    <div className="flex items-start justify-between gap-2"><span className="text-[12px] font-semibold text-white">{template.name}</span><span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase ${template.riskLevel === 'high' ? 'border-red-800 text-red-300' : template.riskLevel === 'medium' ? 'border-amber-800 text-amber-300' : 'border-green-900 text-green-300'}`}>{template.riskLevel ?? 'low'}</span></div>
                    <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-[#888]">{template.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">{template.categories.map((value) => <span key={value} className="rounded bg-[#303030] px-1.5 py-0.5 text-[8px] uppercase text-[#999]">{value}</span>)}{(template.tags ?? []).slice(0, 3).map((value) => <span key={value} className="rounded border border-[#383838] px-1.5 py-0.5 text-[8px] text-[#777]">{value}</span>)}</div>
                  </button>
                ))}
                {filteredTemplates.length === 0 && <div className="flex h-48 flex-col items-center justify-center px-5 text-center"><LayoutTemplate size={18} className="mb-2 text-[#555]" /><div className="text-[11.5px] text-[#777]">No templates match these filters.</div><button type="button" onClick={() => { setQuery(''); setCategory('all'); setTag('all'); }} className="mt-2 text-[10.5px] text-[#aaa] hover:text-white">Clear filters</button></div>}
              </div>
            </aside>
            <main className="min-w-0 overflow-y-auto p-5">
              {selectedTemplate ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4"><div><h3 className="text-[15px] font-semibold text-white">{selectedTemplate.name}</h3><p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-[#888]">{selectedTemplate.description}</p></div><span className={`shrink-0 rounded-md border px-2 py-1 text-[9px] font-semibold uppercase ${riskClass}`}>{selectedTemplate.riskLevel ?? 'low'} risk</span></div>
                  <section className="rounded-md border border-[#303030] bg-[#181818]">
                    <div className="flex items-center justify-between border-b border-[#303030] px-3 py-2 text-[9px] font-semibold uppercase text-[#777]"><span>Node flow</span><span>{selectedTemplate.preview?.nodes?.length ?? 0} nodes | {selectedTemplate.preview?.edges?.length ?? 0} edges</span></div>
                    <div className="flex min-h-20 flex-wrap items-center gap-1.5 p-3">{(selectedTemplate.preview?.nodes ?? []).map((node, index, nodes) => <React.Fragment key={node.id}><div className="rounded-md border border-[#383838] bg-[#242424] px-2 py-1.5"><div className="text-[9px] font-semibold uppercase text-[#666]">{node.type}</div><div className="mt-0.5 max-w-28 truncate text-[10.5px] text-[#ddd]">{node.name}</div></div>{index < nodes.length - 1 && <ChevronRight size={12} className="text-[#555]" />}</React.Fragment>)}{!selectedTemplate.preview?.nodes?.length && <span className="text-[10.5px] text-[#666]">Node preview unavailable.</span>}</div>
                  </section>
                  <div className="grid grid-cols-2 gap-3">
                    <section className="rounded-md border border-[#303030] bg-[#202020] p-3"><div className="mb-2 text-[9px] font-semibold uppercase text-[#777]">Data contracts</div><div className="max-h-44 space-y-2 overflow-y-auto">{(selectedTemplate.preview?.contracts ?? []).filter((contract) => contract.outputs.length > 0).slice(0, 6).map((contract) => <div key={contract.nodeId}><div className="text-[10.5px] font-medium text-[#ccc]">{contract.nodeName}</div><div className="mt-1 flex flex-wrap gap-1">{contract.outputs.map((field) => <span key={field.name} className="rounded bg-[#292929] px-1.5 py-0.5 font-mono text-[8.5px] text-[#999]">{field.name}: {field.type}</span>)}</div></div>)}{!(selectedTemplate.preview?.contracts ?? []).some((contract) => contract.outputs.length > 0) && <div className="text-[10.5px] text-[#666]">No structured outputs declared.</div>}</div></section>
                    <section className="rounded-md border border-[#303030] bg-[#202020] p-3"><div className="mb-2 flex items-center justify-between text-[9px] font-semibold uppercase text-[#777]"><span>Risk and safety</span><span>{selectedTemplate.preview?.safetyFindings?.length ?? 0} findings</span></div><div className="max-h-44 space-y-2 overflow-y-auto">{(selectedTemplate.preview?.riskFactors ?? []).slice(0, 3).map((factor) => <div key={`${factor.code}-${factor.nodeId}`} className={`border-l-2 pl-2 ${factor.level === 'high' ? 'border-red-500' : factor.level === 'medium' ? 'border-amber-400' : 'border-green-600'}`}><div className="text-[9px] font-semibold text-[#aaa]">{factor.code.replaceAll('_', ' ')}</div><div className="mt-0.5 text-[10px] leading-relaxed text-[#888]">{factor.message}</div></div>)}{(selectedTemplate.preview?.safetyFindings ?? []).slice(0, 6).map((finding) => <div key={`${finding.code}-${finding.nodeId ?? ''}`} className={`border-l-2 pl-2 ${finding.severity === 'high' ? 'border-red-500' : 'border-amber-400'}`}><div className="text-[9px] font-semibold text-[#aaa]">{finding.code}</div><div className="mt-0.5 text-[10px] leading-relaxed text-[#888]">{finding.message}</div></div>)}{!selectedTemplate.preview?.safetyFindings?.length && <div className="text-[10.5px] text-green-300/70">No unsafe configuration findings.</div>}</div></section>
                  </div>
                  {error && <div className="rounded-md border border-red-900/60 bg-red-950/20 p-2.5 text-[11px] text-red-300">{error}</div>}
                  <div className="flex justify-end"><button type="button" disabled={creatingId !== null} onClick={() => void createFromTemplate(selectedTemplate)} className="flex h-9 items-center gap-1.5 rounded-md bg-white px-3.5 text-[11.5px] font-medium text-black hover:bg-[#e5e5e5] disabled:opacity-50">{creatingId === selectedTemplate.id ? <Loader2 size={13} className="animate-spin" /> : <LayoutTemplate size={13} />} Create workflow</button></div>
                </div>
              ) : <div className="flex h-full items-center justify-center text-[11px] text-[#666]">Select a template to inspect it.</div>}
            </main>
          </div>
        )}
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
  const { screenToFlowPosition, setCenter, fitView } = useReactFlow();

  // Backend wiring: autosave, run/preview streaming, publish, code export.
  const backend = useAgentBuilderBackend(nodes, edges, setNodes, setEdges);
  const backendState = useNanoStore(backendStatus);
  const saveState = useNanoStore(saveStatus);
  const wfInfo = useNanoStore(currentWorkflow);
  const breakpointsByWorkflow = useNanoStore(debugBreakpoints);
  const draftConflict = useNanoStore(autosaveConflict);
  const remoteReloadEpoch = useNanoStore(remoteDraftReloadEpoch);
  const graderCounts = useNanoStore(evaluationGraderCounts);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [mobilePaletteOpen, setMobilePaletteOpen] = useState(false);
  const [workflowSettingsOpen, setWorkflowSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticEditorNodeId, setDiagnosticEditorNodeId] = useState<string | null>(null);
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [nodeSearchQuery, setNodeSearchQuery] = useState('');
  const [nodeSearchIndex, setNodeSearchIndex] = useState(0);
  const nodeSearchInputRef = useRef<HTMLInputElement>(null);
  const [chatPreviewOpen, setChatPreviewOpen] = useState(false);
  const [chatDeployOpen, setChatDeployOpen] = useState(false);
  const [batchPanelOpen, setBatchPanelOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [workflowSecretsOpen, setWorkflowSecretsOpen] = useState(false);
  const [collaborationCanvasState, setCollaborationCanvasState] = useState<{
    threads: WorkflowReviewThread[];
    presence: WorkflowPresence[];
    localClientId: string;
  }>({ threads: [], presence: [], localClientId: '' });
  const [localCollaborationCursor, setLocalCollaborationCursor] = useState<{ x: number; y: number } | undefined>();
  const collaborationCursorFrame = useRef<number | null>(null);
  const pendingCollaborationPointer = useRef<{ x: number; y: number } | null>(null);
  const lastCollaborationCursorUpdate = useRef(0);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [workflowSettingsBusy, setWorkflowSettingsBusy] = useState(false);
  const [workflowSettingsError, setWorkflowSettingsError] = useState<string | null>(null);
  const [conflictAction, setConflictAction] = useState<'reload' | 'overwrite' | 'duplicate' | null>(null);
  const [conflictActionError, setConflictActionError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const graphClipboard = useRef<{ nodes: Node[]; edges: Edge[]; namespaces: Record<string, string>; pasteCount: number } | null>(null);
  useEffect(() => {
    graphClipboard.current = null;
  }, [wfInfo?.id]);
  const { apiKeys } = useUserDataContext();

  const handleClose = useCallback(async () => {
    if (!onClose || isClosing) return;
    setIsClosing(true);
    const canClose = await backend.flushDraft();
    if (canClose) onClose();
    else setIsClosing(false);
  }, [backend, isClosing, onClose]);

  const handleCollaborationStateChange = useCallback((state: {
    threads: WorkflowReviewThread[];
    presence: WorkflowPresence[];
    localClientId: string;
  }) => setCollaborationCanvasState(state), []);

  const handleCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!wfInfo) return;
    pendingCollaborationPointer.current = { x: event.clientX, y: event.clientY };
    const now = performance.now();
    if (now - lastCollaborationCursorUpdate.current < 200) return;
    if (collaborationCursorFrame.current !== null) return;
    collaborationCursorFrame.current = window.requestAnimationFrame(() => {
      collaborationCursorFrame.current = null;
      lastCollaborationCursorUpdate.current = performance.now();
      const point = pendingCollaborationPointer.current;
      if (point) setLocalCollaborationCursor(screenToFlowPosition(point));
    });
  }, [screenToFlowPosition, wfInfo]);

  const handleCanvasPointerLeave = useCallback(() => {
    pendingCollaborationPointer.current = null;
    if (collaborationCursorFrame.current !== null) window.cancelAnimationFrame(collaborationCursorFrame.current);
    collaborationCursorFrame.current = null;
    setLocalCollaborationCursor(undefined);
  }, []);

  useEffect(() => () => {
    if (collaborationCursorFrame.current !== null) window.cancelAnimationFrame(collaborationCursorFrame.current);
  }, []);

  useEffect(() => {
    setLocalCollaborationCursor(undefined);
    setCollaborationCanvasState({ threads: [], presence: [], localClientId: '' });
  }, [wfInfo?.id]);

  useEffect(() => {
    if (!wfInfo) {
      evaluationGraderCounts.set({});
      return;
    }
    let cancelled = false;
    getAgentBuilderClient(apiKeys).listEvaluations(wfInfo.id).then((response) => {
      if (cancelled) return;
      const counts: Record<string, number> = {};
      for (const definition of response.evaluations) {
        for (const grader of definition.graders) {
          if (grader.nodeId) counts[grader.nodeId] = (counts[grader.nodeId] ?? 0) + 1;
        }
      }
      evaluationGraderCounts.set(counts);
    }).catch(() => {
      if (!cancelled) evaluationGraderCounts.set({});
    });
    return () => { cancelled = true; };
  }, [apiKeys, wfInfo?.id]);

  const openWorkflowSettings = useCallback(() => {
    if (!wfInfo) return;
    setDiagnosticsOpen(false);
    setWorkflowName(wfInfo.name);
    setWorkflowDescription(wfInfo.description);
    setWorkflowSettingsError(null);
    setWorkflowSettingsOpen(true);
  }, [wfInfo]);

  const saveWorkflowSettings = useCallback(async () => {
    if (!workflowName.trim()) {
      setWorkflowSettingsError('Workflow name is required.');
      return;
    }
    setWorkflowSettingsBusy(true);
    setWorkflowSettingsError(null);
    try {
      await backend.updateMetadata(workflowName, workflowDescription);
      setWorkflowSettingsOpen(false);
    } catch (error) {
      setWorkflowSettingsError((error as Error).message);
    } finally {
      setWorkflowSettingsBusy(false);
    }
  }, [backend, workflowDescription, workflowName]);

  const useTemplate = useCallback(async (template: WorkflowTemplate) => {
    try {
      const { workflow } = await getAgentBuilderClient(apiKeys).createWorkflowFromTemplate({
        templateId: template.id,
      });
      setTemplatePickerOpen(false);
      requestedWorkflowId.set(workflow.id);
    } catch (error) {
      // Keep the picker open so its create action can surface the API error.
      throw error;
    }
  }, [apiKeys]);

  // Selector to grab the numeric zoom level from the internal React Flow store
  const zoom = useStore((s) => s.transform[2]);
  const zoomPercentage = Math.round(zoom * 100);
  const previewOpen = useNanoStore(runPanelOpen);
  const previewRun = useNanoStore(runState);
  const [selectedPreviewNodeId, setSelectedPreviewNodeId] = useState<string | null>(null);
  const [previewSelectionPinned, setPreviewSelectionPinned] = useState(false);

  const focusRunNode = useCallback((nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === target.id })));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    setCenter(
      target.position.x + (target.measured?.width ?? target.width ?? 180) / 2,
      target.position.y + (target.measured?.height ?? target.height ?? 64) / 2,
      { zoom: Math.max(zoom, 0.85), duration: 350 },
    );
  }, [nodes, setCenter, setEdges, setNodes, zoom]);

  const nodeSearchMatches = React.useMemo(() => {
    const query = nodeSearchQuery.trim().toLowerCase();
    return nodes
      .filter((node) => node.type !== 'placeholder')
      .filter((node) => {
        if (!query) return true;
        const label = String(node.data?.label ?? '');
        return `${label} ${node.type} ${node.id}`.toLowerCase().includes(query);
      });
  }, [nodeSearchQuery, nodes]);

  const focusNodeSearchMatch = useCallback((node: Node) => {
    focusRunNode(node.id);
    setNodeSearchOpen(false);
    setNodeSearchQuery('');
  }, [focusRunNode]);

  useEffect(() => {
    if (!nodeSearchOpen) return;
    nodeSearchInputRef.current?.focus();
  }, [nodeSearchOpen]);

  useEffect(() => {
    setNodeSearchIndex((current) => Math.min(current, Math.max(0, nodeSearchMatches.length - 1)));
  }, [nodeSearchMatches.length]);

  useEffect(() => {
    const handleNodeSearchShortcut = (event: KeyboardEvent) => {
      if (!backend.ready) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setNodeSearchOpen(true);
        setNodeSearchIndex(0);
        return;
      }
      if (!nodeSearchOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setNodeSearchOpen(false);
        return;
      }
      if (event.key === 'ArrowDown' && nodeSearchMatches.length > 0) {
        event.preventDefault();
        setNodeSearchIndex((current) => (current + 1) % nodeSearchMatches.length);
      } else if (event.key === 'ArrowUp' && nodeSearchMatches.length > 0) {
        event.preventDefault();
        setNodeSearchIndex((current) => (current - 1 + nodeSearchMatches.length) % nodeSearchMatches.length);
      } else if (event.key === 'Enter' && nodeSearchMatches[nodeSearchIndex]) {
        event.preventDefault();
        focusNodeSearchMatch(nodeSearchMatches[nodeSearchIndex]);
      }
    };
    window.addEventListener('keydown', handleNodeSearchShortcut);
    return () => window.removeEventListener('keydown', handleNodeSearchShortcut);
  }, [backend.ready, focusNodeSearchMatch, nodeSearchIndex, nodeSearchMatches, nodeSearchOpen]);

  const highlightActiveRunNode = useCallback((nodeId: string | null) => {
    setNodes((current) => current.map((node) => {
      const classes = new Set(String(node.className ?? '').split(/\s+/).filter(Boolean));
      if (node.id === nodeId) classes.add('agent-run-node-active');
      else classes.delete('agent-run-node-active');
      const className = [...classes].join(' ');
      if (className === (node.className ?? '')) return node;
      return { ...node, className: className || undefined };
    }));
  }, [setNodes]);

  const focusValidationIssue = useCallback((nodeId?: string, edgeId?: string) => {
    const target = nodeId ? nodes.find((node) => node.id === nodeId) : undefined;
    const edge = edgeId ? edges.find((candidate) => candidate.id === edgeId) : undefined;
    if (!target && !edge) return;
    if (target) {
      setDiagnosticEditorNodeId(target.id);
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === target.id })));
      setEdges((current) => current.map((candidate) => ({ ...candidate, selected: false })));
      setCenter(target.position.x + (target.measured?.width ?? target.width ?? 180) / 2, target.position.y + (target.measured?.height ?? target.height ?? 64) / 2, { zoom: Math.max(zoom, 0.85), duration: 350 });
    } else if (edge) {
      setDiagnosticEditorNodeId(null);
      const source = nodes.find((node) => node.id === edge.source);
      const destination = nodes.find((node) => node.id === edge.target);
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === source?.id || node.id === destination?.id })));
      setEdges((current) => current.map((candidate) => ({ ...candidate, selected: candidate.id === edge.id })));
      if (source && destination) {
        const sourceWidth = source.measured?.width ?? source.width ?? 180;
        const targetWidth = destination.measured?.width ?? destination.width ?? 180;
        const sourceHeight = source.measured?.height ?? source.height ?? 64;
        const targetHeight = destination.measured?.height ?? destination.height ?? 64;
        setCenter(
          (source.position.x + sourceWidth / 2 + destination.position.x + targetWidth / 2) / 2,
          (source.position.y + sourceHeight / 2 + destination.position.y + targetHeight / 2) / 2,
          { zoom: Math.max(zoom, 0.75), duration: 350 },
        );
      }
    }
    setDiagnosticsOpen(false);
  }, [edges, nodes, setCenter, setEdges, setNodes, zoom]);

  const [isSelectingNewNode, setIsSelectingNewNode] = useState(false);
  const [activePlaceholderId, setActivePlaceholderId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'pan' | 'select'>('pan');
  const connectingNodeId = useRef<string | null>(null);
  const connectingHandleId = useRef<string | null>(null);
  const lastConnectEndAt = useRef<number>(0);

  // Undo / Redo State
  const [past, setPast] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const coalescedEditRef = useRef<{ key: string; expiresAt: number } | null>(null);

  const getCleanState = useCallback((currentNodes: Node[], currentEdges: Edge[]) => {
    const activePlaceholderIds = new Set(currentNodes.filter(n => n.type === 'placeholder').map(n => n.id));
    
    const cleanNodes = currentNodes.filter(n => !activePlaceholderIds.has(n.id)).map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: structuredClone(n.data),
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
      ...(e.style ? { style: structuredClone(e.style) } : {}),
    })) as Edge[];
    
    return { nodes: cleanNodes, edges: cleanEdges };
  }, []);

  const takeSnapshot = useCallback(() => {
    coalescedEditRef.current = null;
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

  /** Capture one undo entry per short editing burst instead of per keystroke. */
  const takeCoalescedSnapshot = useCallback((key: string) => {
    const now = Date.now();
    const active = coalescedEditRef.current;
    if (!active || active.key !== key || active.expiresAt <= now) takeSnapshot();
    coalescedEditRef.current = { key, expiresAt: now + 700 };
  }, [takeSnapshot]);

  const resetHistory = useCallback(() => {
    coalescedEditRef.current = null;
    setPast([]);
    setFuture([]);
  }, []);

  const patchNodeData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    takeCoalescedSnapshot(`node:${nodeId}:data:${Object.keys(patch).sort().join(',')}`);
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
    if (Object.prototype.hasOwnProperty.call(patch, 'onError') && patch.onError !== 'branch') {
      setEdges((eds) => eds.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === 'error')));
    }
  }, [setEdges, setNodes, takeCoalescedSnapshot]);

  const patchNodeConfig = useCallback((nodeId: string, config: Record<string, unknown>) => {
    const current = nodes.find((node) => node.id === nodeId);
    const previous = (current?.data?.config ?? {}) as Record<string, unknown>;
    const changedKeys = [...new Set([...Object.keys(previous), ...Object.keys(config)])]
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(config[key]))
      .sort();
    takeCoalescedSnapshot(`node:${nodeId}:config:${changedKeys.join(',') || 'snapshot'}`);
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)));
    if (config.onError !== 'branch') {
      setEdges((eds) => eds.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === 'error')));
    }
  }, [nodes, setEdges, setNodes, takeCoalescedSnapshot]);

  useEffect(() => {
    resetHistory();
  }, [remoteReloadEpoch, resetHistory, wfInfo?.id]);

  const resolveDraftConflict = useCallback(async (action: 'reload' | 'overwrite' | 'duplicate') => {
    setConflictAction(action);
    setConflictActionError(null);
    try {
      if (action === 'reload') {
        await backend.reloadRemoteDraft();
        resetHistory();
      } else if (action === 'overwrite') await backend.overwriteRemoteDraft();
      else await backend.duplicateLocalDraft();
    } catch (error) {
      setConflictActionError((error as Error).message);
    } finally {
      setConflictAction(null);
    }
  }, [backend, resetHistory]);

  const deleteNodes = useCallback((nodeIds: string[], options?: { snapshot?: boolean }) => {
    const removableIds = new Set(nodes
      .filter((node) => nodeIds.includes(node.id) && node.type !== 'start' && node.type !== 'placeholder')
      .map((node) => node.id));
    if (removableIds.size === 0) return;
    if (options?.snapshot !== false) takeSnapshot();
    setNodes((current) => current.filter((node) => !removableIds.has(node.id)));
    setEdges((current) => current.filter((edge) => !removableIds.has(edge.source) && !removableIds.has(edge.target)));
  }, [nodes, setNodes, setEdges, takeSnapshot]);

  const deleteNode = useCallback((nodeId: string) => deleteNodes([nodeId]), [deleteNodes]);

  const duplicateNodes = useCallback((nodeIds: string[], offset = 48, sourceNodes = nodes, sourceEdges = edges, sourceNamespaceMap = nodeNamespaces(sourceNodes)) => {
    const sources = sourceNodes.filter((node) => nodeIds.includes(node.id) && node.type !== 'start' && node.type !== 'placeholder');
    if (sources.length === 0) return;
    takeSnapshot();
    const usedNodeIds = new Set(nodes.map((node) => node.id));
    const usedEdgeIds = new Set(edges.map((edge) => edge.id));
    const usedLabels = new Set(nodes.map((node) => String(node.data?.label ?? 'Node')));
    const idMap = new Map(sources.map((source) => [source.id, nextGraphId(source.id, usedNodeIds)]));
    const namespaceMap = new Map<string, string>();
    const labelMap = new Map<string, string>();
    for (const source of sources) {
      const oldLabel = String(source.data?.label ?? 'Node');
      let newLabel = `${oldLabel} copy`;
      let suffix = 2;
      while (usedLabels.has(newLabel)) newLabel = `${oldLabel} copy ${suffix++}`;
      usedLabels.add(newLabel);
      labelMap.set(source.id, newLabel);
    }
    const usedNamespaces = new Set(nodeNamespaces(nodes).values());
    for (const source of sources) {
      const base = toWorkflowVarName(labelMap.get(source.id)!);
      let nextNamespace = base;
      let suffix = 2;
      while (usedNamespaces.has(nextNamespace)) nextNamespace = `${base}_${suffix++}`;
      usedNamespaces.add(nextNamespace);
      namespaceMap.set(sourceNamespaceMap.get(source.id) ?? toWorkflowVarName(String(source.data?.label ?? 'Node')), nextNamespace);
    }
    const duplicates = sources.map((source): Node => {
      const clonedData = replaceNamespaces(structuredClone(source.data), namespaceMap) as Record<string, unknown>;
      clonedData.label = labelMap.get(source.id)!;
      return {
        id: idMap.get(source.id)!,
        type: source.type,
        position: { x: source.position.x + offset, y: source.position.y + offset },
        data: clonedData,
        selected: true,
        ...(source.parentId && idMap.has(source.parentId) ? { parentId: idMap.get(source.parentId)! } : {}),
      };
    });
    const duplicatedEdges = sourceEdges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge): Edge => ({
        id: nextGraphId(edge.id, usedEdgeIds),
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
        type: edge.type ?? 'custom',
        ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
        ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
        ...(edge.style ? { style: edge.style } : {}),
        selected: false,
      }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...duplicates]);
    setEdges((current) => [...current.map((edge) => ({ ...edge, selected: false })), ...duplicatedEdges]);
  }, [edges, nodes, setEdges, setNodes, takeSnapshot]);

  const duplicateNode = useCallback((nodeId: string) => duplicateNodes([nodeId]), [duplicateNodes]);

  const copyNodes = useCallback((nodeIds: string[]) => {
    const copiedNodes = nodes.filter((node) => nodeIds.includes(node.id) && node.type !== 'start' && node.type !== 'placeholder');
    const copiedIds = new Set(copiedNodes.map((node) => node.id));
    if (copiedNodes.length === 0) return;
    graphClipboard.current = {
      nodes: structuredClone(copiedNodes),
      edges: structuredClone(edges.filter((edge) => copiedIds.has(edge.source) && copiedIds.has(edge.target))),
      namespaces: Object.fromEntries([...nodeNamespaces(nodes)].filter(([id]) => copiedIds.has(id))),
      pasteCount: 0,
    };
  }, [edges, nodes]);

  const pasteNodes = useCallback(() => {
    const clipboard = graphClipboard.current;
    if (!clipboard) return;
    clipboard.pasteCount += 1;
    duplicateNodes(clipboard.nodes.map((node) => node.id), 48 * clipboard.pasteCount, clipboard.nodes, clipboard.edges, new Map(Object.entries(clipboard.namespaces)));
  }, [duplicateNodes]);

  useEffect(() => {
    const handleSelectionShortcut = (event: KeyboardEvent) => {
      if (!backend.ready) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      const selectedIds = nodes.filter((node) => node.selected).map((node) => node.id);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        if (selectedIds.length === 0) return;
        event.preventDefault();
        duplicateNodes(selectedIds);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (selectedIds.length === 0) return;
        event.preventDefault();
        copyNodes(selectedIds);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        if (!graphClipboard.current) return;
        event.preventDefault();
        pasteNodes();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedEdgeIds = edges.filter((edge) => edge.selected).map((edge) => edge.id);
        if (selectedIds.length === 0 && selectedEdgeIds.length === 0) return;
        event.preventDefault();
        // One keyboard delete is one logical edit, even when it removes both
        // nodes and independently selected edges. Keep a single undo entry.
        if (selectedEdgeIds.length > 0) takeSnapshot();
        deleteNodes(selectedIds, { snapshot: selectedEdgeIds.length === 0 });
        if (selectedEdgeIds.length > 0) {
          setEdges((current) => current.filter((edge) => !selectedEdgeIds.includes(edge.id)));
        }
      }
    };
    window.addEventListener('keydown', handleSelectionShortcut);
    return () => window.removeEventListener('keydown', handleSelectionShortcut);
  }, [backend.ready, copyNodes, deleteNodes, duplicateNodes, edges, nodes, pasteNodes, setEdges, takeSnapshot]);

  const selectedNodes = nodes.filter((node) => node.selected);
  const startConfig = (nodes.find((node) => node.type === 'start')?.data?.config as Record<string, any> | undefined) ?? {};
  const variableSources: WorkflowVariableSource[] = [
    { id: 'input:input_as_text', label: 'Workflow input: input_as_text', path: 'workflow.input_as_text', kind: 'input', type: 'string' },
    ...(Array.isArray(startConfig.inputVariables) ? startConfig.inputVariables : [])
      .filter((variable: any) => variable?.name && variable.name !== 'input_as_text')
      .map((variable: any) => ({ id: `input:${variable.name}`, label: `Workflow input: ${variable.name}`, path: `workflow.${variable.name}`, kind: 'input' as const, type: variable.type })),
    ...(Array.isArray(startConfig.stateVariables) ? startConfig.stateVariables : [])
      .filter((variable: any) => variable?.name)
      .map((variable: any) => ({ id: `state:${variable.name}`, label: `State: ${variable.name}`, path: `state.${variable.name}`, kind: 'state' as const, type: variable.type })),
    ...nodes.filter((node) => !['start', 'note'].includes(node.type as string)).flatMap((node) => {
      const nodeLabel = String(node.data?.label ?? node.id);
      const contract = wfInfo?.contracts?.find((candidate) => candidate.nodeId === node.id);
      const outputs = contract?.outputs?.length ? contract.outputs : [{ name: 'output_text', type: 'string' }];
      return outputs.map((output) => ({ id: `node:${node.id}:${output.name}`, label: `${nodeLabel}: ${output.name}`, path: `${node.id}.${output.name}`, kind: 'node' as const, type: output.type }));
    }),
  ];
  const variableSourcesForNode = (nodeId: string): WorkflowVariableSource[] => {
    const upstreamNodeIds = new Set<string>();
    const pending = [nodeId];
    while (pending.length > 0) {
      const targetId = pending.pop()!;
      edges.forEach((edge) => {
        if (edge.target !== targetId || upstreamNodeIds.has(edge.source)) return;
        upstreamNodeIds.add(edge.source);
        pending.push(edge.source);
      });
    }
    return variableSources.filter((source) => {
      if (source.kind !== 'node') return true;
      const sourceNode = nodes.find((node) => source.id.startsWith(`node:${node.id}:`));
      return Boolean(sourceNode && upstreamNodeIds.has(sourceNode.id));
    });
  };
  const diagnosticEditorNode = diagnosticEditorNodeId
    ? nodes.find((node) => node.id === diagnosticEditorNodeId)
    : undefined;
  const diagnosticNodeHasIssue = diagnosticEditorNodeId !== null && Boolean(wfInfo && [
    ...wfInfo.errorIssues,
    ...wfInfo.warningIssues,
    ...wfInfo.safetyFindings,
  ].some((issue) => issue.nodeId === diagnosticEditorNodeId));
  const diagnosticEditorVisible = Boolean(diagnosticEditorNode?.selected && diagnosticNodeHasIssue);

  useEffect(() => {
    if (diagnosticEditorNodeId && !diagnosticEditorVisible) setDiagnosticEditorNodeId(null);
  }, [diagnosticEditorNodeId, diagnosticEditorVisible]);

  const removableSelectedCount = selectedNodes.filter((node) => node.type !== 'start' && node.type !== 'placeholder').length;
  const workflowBreakpointIds = new Set(wfInfo ? breakpointsByWorkflow[wfInfo.id] ?? [] : []);
  const selectedExecutableNode = selectedNodes.length === 1 && !['note', 'placeholder'].includes(String(selectedNodes[0].type))
    ? selectedNodes[0]
    : null;
  const toggleSelectedBreakpoint = useCallback(() => {
    if (!wfInfo || !selectedExecutableNode) return;
    toggleDebugBreakpoint(wfInfo.id, selectedExecutableNode.id);
  }, [selectedExecutableNode, wfInfo]);

  useEffect(() => {
    const handleBreakpointShortcut = (event: KeyboardEvent) => {
      if (!backend.ready) return;
      if (event.key !== 'F9' || !selectedExecutableNode) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      toggleSelectedBreakpoint();
    };
    window.addEventListener('keydown', handleBreakpointShortcut);
    return () => window.removeEventListener('keydown', handleBreakpointShortcut);
  }, [backend.ready, selectedExecutableNode, toggleSelectedBreakpoint]);

  const autoLayout = useCallback(() => {
    const executable = nodes.filter((node) => node.type !== 'note' && node.type !== 'placeholder');
    const level = new Map<string, number>();
    const start = executable.find((node) => node.type === 'start');
    if (start) level.set(start.id, 0);
    for (let pass = 0; pass < executable.length; pass++) {
      for (const edge of edges) {
        if (edge.targetHandle === 'loop_back') continue;
        const sourceLevel = level.get(edge.source);
        if (sourceLevel === undefined) continue;
        if (nodes.find((node) => node.id === edge.target)?.type === 'while' && level.has(edge.target)) continue;
        level.set(edge.target, Math.max(level.get(edge.target) ?? 0, sourceLevel + 1));
      }
    }
    let fallbackLevel = Math.max(0, ...level.values()) + 1;
    for (const node of executable) if (!level.has(node.id)) level.set(node.id, fallbackLevel++);
    const rows = new Map<number, Node[]>();
    for (const node of executable) {
      const column = level.get(node.id)!;
      rows.set(column, [...(rows.get(column) ?? []), node]);
    }
    const positions = new Map<string, { x: number; y: number }>();
    for (const [column, row] of [...rows.entries()].sort(([a], [b]) => a - b)) {
      row.sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));
      row.forEach((node, index) => positions.set(node.id, { x: 80 + column * 300, y: 80 + index * 180 }));
    }
    nodes.filter((node) => node.type === 'note').sort((a, b) => a.id.localeCompare(b.id)).forEach((node, index) => {
      positions.set(node.id, { x: 80 + (index % 3) * 300, y: 120 + (Math.max(1, ...[...rows.values()].map((row) => row.length)) + Math.floor(index / 3)) * 180 });
    });
    const changed = nodes.some((node) => {
      const next = positions.get(node.id);
      return next && (next.x !== node.position.x || next.y !== node.position.y);
    });
    if (!changed) return;
    takeSnapshot();
    setNodes((current) => current.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node));
    window.setTimeout(() => void fitView({ padding: 0.18, maxZoom: 1, duration: 250 }), 0);
  }, [edges, fitView, nodes, setNodes, takeSnapshot]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    coalescedEditRef.current = null;
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
    coalescedEditRef.current = null;
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

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!backend.ready) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [backend.ready, redo, undo]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const validateConnection = useCallback((params: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }): string | null => {
    if (!params.source || !params.target) return 'Choose both a source and target node.';
    if (params.source === params.target) return 'A node cannot connect to itself.';
    const source = nodes.find((node) => node.id === params.source);
    const target = nodes.find((node) => node.id === params.target);
    if (!source || !target) return 'The connection endpoint no longer exists.';
    if (source.type === 'end') return 'End nodes cannot have outgoing connections.';
    if (target.type === 'start') return 'Start nodes cannot have incoming connections.';
    if (source.type === 'note' || target.type === 'note') return 'Notes are annotations and cannot be connected.';
    if (edges.some((edge) => edge.source === params.source && edge.target === params.target && (edge.sourceHandle ?? null) === (params.sourceHandle ?? null) && (edge.targetHandle ?? null) === (params.targetHandle ?? null))) return 'That connection already exists.';
    return null;
  }, [edges, nodes]);

  const onConnect = useCallback(
    (params: Connection) => {
      const error = validateConnection(params);
      if (error) {
        setConnectionError(error);
        window.setTimeout(() => setConnectionError(null), 3500);
        return;
      }
      takeSnapshot();
      connectSucceeded.current = true;
      setConnectionError(null);
      setEdges((eds) => addEdge({ ...params, type: 'custom', style: { stroke: '#404040', strokeWidth: 2.5 } }, eds));
    },
    [takeSnapshot, validateConnection]
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
        if (connectionState.toNode) {
          const error = validateConnection({
            source: connectingNodeId.current,
            sourceHandle: connectingHandleId.current,
            target: connectionState.toNode.id,
            targetHandle: connectionState.toHandle?.id ?? null,
          });
          setConnectionError(error ?? 'This connection is not allowed.');
          window.setTimeout(() => setConnectionError(null), 3500);
          connectingNodeId.current = null;
          connectingHandleId.current = null;
          return;
        }
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

        takeSnapshot();
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
    [screenToFlowPosition, setNodes, setEdges, takeSnapshot, validateConnection]
  );

  const abortPlaceholder = useCallback(() => {
    if (isSelectingNewNode && activePlaceholderId) {
      setNodes((nds) => nds.filter((n) => n.id !== activePlaceholderId));
      setEdges((eds) => eds.filter((e) => e.target !== activePlaceholderId && e.source !== activePlaceholderId));
      setIsSelectingNewNode(false);
      setActivePlaceholderId(null);
    }
  }, [isSelectingNewNode, activePlaceholderId, setNodes, setEdges, takeSnapshot]);

  const handleCanvasNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    abortPlaceholder();
    if (previewOpen && node.type !== 'note' && node.type !== 'placeholder') {
      setSelectedPreviewNodeId(node.id);
      setPreviewSelectionPinned(true);
    }
  }, [abortPlaceholder, previewOpen]);

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
      case 'subflow': return 'Subflow';
      case 'if-else': return 'If / else';
      case 'mcp': return 'MCP tool';
      case 'note': return 'Note';
      case 'guardrail': return 'Guardrails';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const handleSidebarClick = useCallback((newType: string) => {
    setMobilePaletteOpen(false);
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

  const validationEdgeIds = new Set(
    [...(wfInfo?.errorIssues ?? []), ...(wfInfo?.warningIssues ?? [])]
      .map((issue) => issue.edgeId)
      .filter((edgeId): edgeId is string => Boolean(edgeId)),
  );
  // Safety findings are rendered as errors when severity is high. Keep the
  // diagnostics summary aligned with the rows below instead of labelling all
  // findings as warnings.
  const safetyErrorCount = (wfInfo?.safetyFindings ?? []).filter((finding) => finding.severity === 'high').length;
  const safetyWarningCount = (wfInfo?.safetyFindings ?? []).length - safetyErrorCount;
  const validationNodeSeverity = new Map<string, 'error' | 'warning'>();
  for (const issue of wfInfo?.warningIssues ?? []) {
    if (issue.nodeId) validationNodeSeverity.set(issue.nodeId, 'warning');
  }
  for (const finding of wfInfo?.safetyFindings ?? []) {
    if (finding.nodeId && (!validationNodeSeverity.has(finding.nodeId) || finding.severity === 'high')) {
      validationNodeSeverity.set(finding.nodeId, finding.severity === 'high' ? 'error' : 'warning');
    }
  }
  for (const issue of wfInfo?.errorIssues ?? []) {
    if (issue.nodeId) validationNodeSeverity.set(issue.nodeId, 'error');
  }
  const canvasEdges = edges.map((edge) => validationEdgeIds.has(edge.id)
    ? { ...edge, style: { ...edge.style, stroke: '#f59e0b', strokeWidth: 3, strokeDasharray: '6 4' } }
    : edge);
  const canvasNodes = nodes.map((node) => {
    const classes = new Set(String(node.className ?? '').split(/\s+/).filter(Boolean));
    if (workflowBreakpointIds.has(node.id)) classes.add('agent-debug-breakpoint');
    else classes.delete('agent-debug-breakpoint');
    classes.delete('agent-validation-error');
    classes.delete('agent-validation-warning');
    classes.delete('agent-run-node-running');
    classes.delete('agent-run-node-ok');
    classes.delete('agent-run-node-error');
    const validationSeverity = validationNodeSeverity.get(node.id);
    if (validationSeverity) classes.add(`agent-validation-${validationSeverity}`);
    const runNodeStatus = previewOpen
      ? previewRun.nodeStatuses.find((status) => status.nodeId === node.id)?.status
      : undefined;
    if (runNodeStatus) classes.add(`agent-run-node-${runNodeStatus}`);
    const className = [...classes].join(' ');
    return className === (node.className ?? '') ? node : { ...node, className: className || undefined };
  });
  const openReviewThreads = collaborationCanvasState.threads.filter((thread) => thread.status === 'open');
  const nodeReviewCounts = new Map<string, number>();
  const edgeReviewCounts = new Map<string, number>();
  for (const thread of openReviewThreads) {
    if (thread.anchor.type === 'node') nodeReviewCounts.set(thread.anchor.nodeId, (nodeReviewCounts.get(thread.anchor.nodeId) ?? 0) + 1);
    if (thread.anchor.type === 'edge') edgeReviewCounts.set(thread.anchor.edgeId, (edgeReviewCounts.get(thread.anchor.edgeId) ?? 0) + 1);
  }
  const remotePresence = collaborationCanvasState.presence.filter((presence) => presence.clientId !== collaborationCanvasState.localClientId);
  const canvasNodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeCenter = (nodeId: string) => {
    const node = canvasNodeById.get(nodeId);
    if (!node) return undefined;
    return {
      x: node.position.x + (node.measured?.width ?? node.width ?? 190) / 2,
      y: node.position.y + (node.measured?.height ?? node.height ?? 72) / 2,
    };
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-[#0e0e0e] text-white" aria-busy={!backend.ready}>
      {/* Main Builder Area */}
      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden relative" inert={!backend.ready}>
        {/* Floating Sidebar (Nodes Palette) */}
        <div className={`absolute bottom-3 left-3 top-3 z-30 w-[min(260px,calc(100%-24px))] rounded-xl bg-[#1b1b1b] shadow-2xl overflow-y-auto overflow-x-hidden transition-all duration-200 [&::-webkit-scrollbar]:hidden ${mobilePaletteOpen ? 'flex' : 'hidden'} flex-col pt-2 pb-2 md:bottom-auto md:left-2 md:top-1/2 md:flex md:w-56 md:-translate-y-1/2 md:rounded-2xl md:pt-4 ${isSelectingNewNode ? 'ring-2 ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)]' : ''}`} style={{ maxHeight: 'min(680px, calc(100% - 24px))', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <div className="mb-2 flex h-9 shrink-0 items-center justify-between px-4 text-[12px] font-semibold text-[#bbb] md:hidden"><span>Nodes</span><button type="button" title="Close node palette" aria-label="Close node palette" onClick={() => setMobilePaletteOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-[#888] hover:bg-[#292929] hover:text-white"><X size={15} /></button></div>
          <button
            onClick={() => setTemplatePickerOpen(true)}
            className="mx-3 mb-3 flex items-center gap-2.5 rounded-lg border border-[#3a3a3a] bg-[#242424] px-3 py-2 text-left text-[13px] font-medium text-gray-200 transition-colors hover:border-[#5a5a5a] hover:bg-[#2d2d2d]"
          >
            <LayoutTemplate size={15} className="text-[#93dfca]" />
            Templates
          </button>

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
                onClick={() => handleSidebarClick('subflow')}
                onDragStart={(e) => onDragStart(e, 'subflow')}
                draggable
              >
                <div className="w-8 h-8 rounded-[10px] bg-[#59c3c3] flex items-center justify-center shrink-0"><Blocks size={16} strokeWidth={2.5} className="text-black" /></div>
                <span className="text-[14px] font-medium text-gray-200">Subflow</span>
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
                <span className="text-[14px] font-medium text-gray-200">Human approval</span>
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

        {templatePickerOpen && (
          <TemplatePicker
            onClose={() => setTemplatePickerOpen(false)}
            onUse={useTemplate}
          />
        )}

        {/* Canvas Area */}
        <div className="min-h-0 min-w-0 flex-1 relative bg-[#0c0c0c]" onPointerMove={handleCanvasPointerMove} onPointerLeave={handleCanvasPointerLeave}>
          {!mobilePaletteOpen && <button type="button" title="Open node palette" aria-label="Open node palette" onClick={() => setMobilePaletteOpen(true)} className="absolute bottom-3 left-3 z-20 flex h-10 w-10 items-center justify-center rounded-md border border-[#383838] bg-[#1b1b1b] text-[#bbb] shadow-xl hover:bg-[#282828] hover:text-white md:hidden"><PanelLeft size={18} /></button>}
          <ReactFlow
            nodes={canvasNodes}
            edges={canvasEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodesDelete={takeSnapshot}
            onEdgesDelete={takeSnapshot}
            onNodeDragStart={takeSnapshot}
            onNodeClick={handleCanvasNodeClick}
            onConnect={onConnect}
            isValidConnection={(connection) => validateConnection(connection) === null}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onPaneClick={onPaneClick}
            onMoveStart={onMoveStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            deleteKeyCode={null}
            panOnDrag={interactionMode === 'pan'}
            selectionOnDrag={interactionMode === 'select'}
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
              .react-flow__node.agent-run-node-active {
                z-index: 12 !important;
                filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.8)) drop-shadow(0 0 12px rgba(34, 211, 238, 0.45));
              }
              @keyframes agentRunNodePulse {
                0%, 100% { filter: drop-shadow(0 0 3px rgba(34, 211, 238, 0.65)); }
                50% { filter: drop-shadow(0 0 9px rgba(34, 211, 238, 0.95)); }
              }
              .react-flow__node.agent-run-node-running {
                z-index: 11 !important;
                animation: agentRunNodePulse 1.35s ease-in-out infinite;
              }
              .react-flow__node.agent-run-node-ok > div {
                box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.72), 0 0 12px rgba(74, 222, 128, 0.16) !important;
              }
              .react-flow__node.agent-run-node-error > div {
                box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.88), 0 0 15px rgba(248, 113, 113, 0.24) !important;
              }
              .react-flow__node.agent-debug-breakpoint::before {
                content: '';
                position: absolute;
                top: -5px;
                left: -5px;
                z-index: 50;
                width: 12px;
                height: 12px;
                border: 2px solid #181818;
                border-radius: 9999px;
                background: #f05252;
                box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.6);
                pointer-events: none;
              }
              .react-flow__node.agent-validation-error::after,
              .react-flow__node.agent-validation-warning::after {
                position: absolute;
                top: -8px;
                right: -8px;
                z-index: 55;
                display: flex;
                width: 18px;
                height: 18px;
                align-items: center;
                justify-content: center;
                border: 2px solid #181818;
                border-radius: 9999px;
                color: #111;
                content: '!';
                font-size: 11px;
                font-weight: 800;
                line-height: 1;
                pointer-events: none;
              }
              .react-flow__node.agent-validation-error::after {
                background: #f87171;
                box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.65);
              }
              .react-flow__node.agent-validation-warning::after {
                background: #fbbf24;
                box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.55);
              }
              .agent-builder-controls .react-flow__controls-button {
                width: 30px;
                height: 30px;
                border-color: #333;
                background: #1b1b1b;
                color: #c8c8c8;
              }
              .agent-builder-controls .react-flow__controls-button:hover {
                background: #303030;
                color: #fff;
              }
              .agent-builder-controls .react-flow__controls-button svg {
                fill: currentColor;
                max-width: 14px;
                max-height: 14px;
              }
              .agent-builder-minimap {
                overflow: hidden;
                border: 1px solid #333;
                border-radius: 8px;
                background: rgba(20, 20, 20, 0.92);
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
              }
            `}</style>
            <Background gap={28} size={2} color="#27272a" />
            <ViewportPortal>
              {remotePresence.flatMap((presence, presenceIndex) => presence.selectedNodeIds.map((nodeId) => {
                const node = canvasNodeById.get(nodeId);
                if (!node) return null;
                const width = node.measured?.width ?? node.width ?? 190;
                const height = node.measured?.height ?? node.height ?? 72;
                const inset = 3 + (presenceIndex % 3) * 3;
                return (
                  <div
                    key={`remote-selection:${presence.collaborator.subjectId}:${presence.clientId}:${nodeId}`}
                    className="pointer-events-none absolute rounded-[26px] border-2"
                    style={{
                      left: node.position.x - inset,
                      top: node.position.y - inset,
                      width: width + inset * 2,
                      height: height + inset * 2,
                      borderColor: presence.color ?? '#60a5fa',
                      opacity: 0.82,
                    }}
                  />
                );
              }))}
              {[...nodeReviewCounts.entries()].map(([nodeId, count]) => {
                const node = canvasNodeById.get(nodeId);
                if (!node) return null;
                const width = node.measured?.width ?? node.width ?? 190;
                return (
                  <button
                    key={`review-node:${nodeId}`}
                    type="button"
                    title={`${count} open review ${count === 1 ? 'thread' : 'threads'}`}
                    aria-label={`${count} open review ${count === 1 ? 'thread' : 'threads'} on ${String(node.data?.label ?? nodeId)}`}
                    onClick={() => { focusRunNode(nodeId); setCollaborationOpen(true); }}
                    className="pointer-events-auto absolute flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border-2 border-[#111] bg-[#f5f5f5] px-1.5 text-[9px] font-bold text-[#111] shadow-lg hover:bg-white"
                    style={{ left: node.position.x + width - 8, top: node.position.y - 12 }}
                  >
                    <MessageSquare size={11} fill="currentColor" />
                    {count > 1 && <span>{count}</span>}
                  </button>
                );
              })}
              {[...edgeReviewCounts.entries()].map(([edgeId, count]) => {
                const edge = edges.find((candidate) => candidate.id === edgeId);
                const source = edge ? nodeCenter(edge.source) : undefined;
                const target = edge ? nodeCenter(edge.target) : undefined;
                if (!source || !target) return null;
                return (
                  <button
                    key={`review-edge:${edgeId}`}
                    type="button"
                    title={`${count} open review ${count === 1 ? 'thread' : 'threads'} on this connection`}
                    onClick={() => setCollaborationOpen(true)}
                    className="pointer-events-auto absolute flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border-2 border-[#111] bg-[#f5f5f5] px-1.5 text-[9px] font-bold text-[#111] shadow-lg hover:bg-white"
                    style={{ left: (source.x + target.x) / 2 - 12, top: (source.y + target.y) / 2 - 12 }}
                  >
                    <MessageSquare size={11} fill="currentColor" />
                    {count > 1 && <span>{count}</span>}
                  </button>
                );
              })}
              {openReviewThreads.filter((thread) => thread.anchor.type === 'canvas').map((thread) => thread.anchor.type === 'canvas' && (
                <button
                  key={`review-canvas:${thread.id}`}
                  type="button"
                  title="Open canvas review thread"
                  onClick={() => setCollaborationOpen(true)}
                  className="pointer-events-auto absolute flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#111] bg-[#f5f5f5] text-[#111] shadow-lg hover:bg-white"
                  style={{ left: thread.anchor.x - 14, top: thread.anchor.y - 14 }}
                >
                  <MessageSquare size={12} fill="currentColor" />
                </button>
              ))}
              {remotePresence.map((presence) => presence.cursor && (
                <div
                  key={`remote-cursor:${presence.collaborator.subjectId}:${presence.clientId}`}
                  className="pointer-events-none absolute z-50 flex items-start"
                  style={{ left: presence.cursor.x, top: presence.cursor.y }}
                >
                  <MousePointer2 size={19} fill={presence.color ?? '#60a5fa'} stroke="#111" strokeWidth={1.5} />
                  <span className="ml-0.5 mt-3 max-w-40 truncate rounded px-1.5 py-0.5 text-[9px] font-semibold text-[#111] shadow" style={{ backgroundColor: presence.color ?? '#60a5fa' }}>
                    {presence.collaborator.displayName ?? presence.collaborator.subjectId}
                  </span>
                </div>
              ))}
            </ViewportPortal>
            <MiniMap
              className="agent-builder-minimap !mb-24 !mr-4 hidden md:block"
              nodeColor={(node) => node.type === 'start' ? '#93dfca' : node.type === 'end' ? '#d4d4d4' : node.type === 'agent' ? '#7a9efa' : '#777'}
              nodeStrokeColor="#111"
              nodeBorderRadius={4}
              pannable
              zoomable
            />
            <Controls className="agent-builder-controls !mb-4 !mr-4" showInteractive={false} />

            {selectedNodes.length > 1 && (
              <Panel position="top-center" className="mt-6">
                <div className="flex h-9 items-center gap-1 rounded-md border border-[#383838] bg-[#1b1b1b] px-2 shadow-xl">
                  <span className="px-2 text-[11px] text-[#aaa]">{selectedNodes.length} selected</span>
                  <button type="button" title="Duplicate selected" aria-label="Duplicate selected nodes" disabled={removableSelectedCount === 0} onClick={() => duplicateNodes(selectedNodes.map((node) => node.id))} className="flex h-7 w-7 items-center justify-center rounded text-[#aaa] hover:bg-[#303030] hover:text-white disabled:opacity-40"><Copy size={14} /></button>
                  <button type="button" title="Delete selected" aria-label="Delete selected nodes" disabled={removableSelectedCount === 0} onClick={() => deleteNodes(selectedNodes.map((node) => node.id))} className="flex h-7 w-7 items-center justify-center rounded text-[#aaa] hover:bg-red-950/50 hover:text-red-300 disabled:opacity-40"><Trash2 size={14} /></button>
                </div>
              </Panel>
            )}

            {selectedExecutableNode && (
              <Panel position="top-center" className="mt-6">
                <button
                  type="button"
                  title={`${workflowBreakpointIds.has(selectedExecutableNode.id) ? 'Remove' : 'Add'} breakpoint (F9)`}
                  aria-label={`${workflowBreakpointIds.has(selectedExecutableNode.id) ? 'Remove' : 'Add'} breakpoint on ${String(selectedExecutableNode.data?.label ?? selectedExecutableNode.id)}`}
                  onClick={toggleSelectedBreakpoint}
                  className={`flex h-9 items-center gap-2 rounded-md border px-3 text-[11px] font-medium shadow-xl transition-colors ${workflowBreakpointIds.has(selectedExecutableNode.id) ? 'border-red-700/70 bg-[#321c1c] text-red-200 hover:bg-[#402020]' : 'border-[#383838] bg-[#1b1b1b] text-[#aaa] hover:bg-[#282828] hover:text-white'}`}
                >
                  <CircleDot size={14} className={workflowBreakpointIds.has(selectedExecutableNode.id) ? 'text-red-400' : ''} />
                  Breakpoint
                </button>
              </Panel>
            )}

            {connectionError && (
              <Panel position="bottom-right" className="mb-[270px] mr-4">
                <div role="alert" className="flex max-w-80 items-start gap-2 rounded-md border border-red-900/70 bg-[#241717] px-3 py-2 text-[11px] text-red-200 shadow-xl">
                  <CircleAlert size={14} className="mt-0.5 shrink-0" />
                  <span>{connectionError}</span>
                </div>
              </Panel>
            )}
            
            <AnimatePresence mode="popLayout">
              {selectedNodes.length === 1 && (() => {
                const selectedStartNode = nodes.find((node) => node.selected && node.type === 'start');
                return selectedStartNode ? (
                  <StartConfigPanel
                    key="start-panel"
                    config={(selectedStartNode.data?.config as Record<string, any>) ?? { inputVariables: [], stateVariables: [] }}
                    onConfigChange={(nextConfig) => patchNodeConfig(selectedStartNode.id, nextConfig)}
                  />
                ) : null;
              })()}
              
              {selectedNodes.length === 1 && nodes.find(n => n.selected && n.type === 'agent') && (() => {
                const selectedAgentNode = nodes.find(n => n.selected && n.type === 'agent');
                return selectedAgentNode ? (
                  <AgentConfigPanel
                    key="agent-panel"
                    nodeId={selectedAgentNode.id}
                    nodeName={(selectedAgentNode.data?.label as string) || ''}
                    attachedGraderCount={graderCounts[selectedAgentNode.id] ?? 0}
                    contract={wfInfo?.contracts?.find((contract) => contract.nodeId === selectedAgentNode.id)}
                    initialModelId={(selectedAgentNode.data?.model as string) || undefined}
                    initialOutputFormat={(selectedAgentNode.data?.outputFormat as string) || undefined}
                    onModelChange={(modelName) => patchNodeData(selectedAgentNode.id, { model: modelName })}
                    onOutputFormatChange={(fmt) => patchNodeData(selectedAgentNode.id, { outputFormat: fmt })}
                    config={selectedAgentNode.data as Record<string, any>}
                    onConfigChange={(patch) => patchNodeData(selectedAgentNode.id, patch)}
                    onNameChange={(newName) => patchNodeData(selectedAgentNode.id, { label: newName })}
                    instructions={(selectedAgentNode.data?.instructions as string) || ''}
                    onInstructionsChange={(newInst) => patchNodeData(selectedAgentNode.id, { instructions: newInst })}
                    userMessage={(selectedAgentNode.data?.userMessage as string) || ''}
                    onUserMessageChange={(newMessage) => patchNodeData(selectedAgentNode.id, { userMessage: newMessage })}
                    onDelete={() => deleteNode(selectedAgentNode.id)}
                    onDuplicate={() => duplicateNode(selectedAgentNode.id)}
                    agentOptions={nodes.filter((node) => node.type === 'agent').map((node) => ({ id: node.id, name: String(node.data?.label ?? node.id) }))}
                    variableSources={variableSourcesForNode(selectedAgentNode.id)}
                  />
                ) : null;
              })()}
              
              {selectedNodes.length === 1 && nodes.find(n => n.selected && n.type === 'guardrail') && (() => {
                const selectedGuardrailNode = nodes.find(n => n.selected && n.type === 'guardrail');
                return selectedGuardrailNode ? (
                  <GuardrailConfigPanel 
                    key="guardrail-panel"
                    nodeName={(selectedGuardrailNode.data?.label as string) || ''}
                    onNameChange={(newName) => patchNodeData(selectedGuardrailNode.id, { label: newName })}
                    config={(selectedGuardrailNode.data?.config as any) || {}}
                    onConfigChange={(newConfig) => {
                      const hasActiveGuardrail = newConfig?.pii || newConfig?.moderation || newConfig?.jailbreak || newConfig?.hallucination || newConfig?.continueOnError;

                      // If all options are toggled off, instantly snip and delete any connections extending from the passing/failing handles.
                      if (!hasActiveGuardrail) {
                        setEdges((eds) => eds.filter(e => !(e.source === selectedGuardrailNode.id && (e.sourceHandle === 'pass' || e.sourceHandle === 'fail'))));
                      }

                      patchNodeConfig(selectedGuardrailNode.id, newConfig);
                    }}
                    onDelete={() => deleteNode(selectedGuardrailNode.id)}
                    onDuplicate={() => duplicateNode(selectedGuardrailNode.id)}
                  />
                ) : null;
              })()}

              {selectedNodes.length === 1 && (() => {
                const CONFIGURABLE = new Set(['end', 'note', 'subflow', 'fileSearch', 'mcp', 'ifElse', 'while', 'userApproval', 'transform', 'setState']);
                const sel = nodes.find(n => n.selected && CONFIGURABLE.has(n.type as string));
                return sel ? (
                  <NodeConfigPanel
                    key={`cfg-${sel.id}`}
                    nodeType={sel.type as string}
                    nodeName={(sel.data?.label as string) || ''}
                    config={(sel.data?.config as Record<string, any>) || {}}
                    contract={wfInfo?.contracts?.find((contract) => contract.nodeId === sel.id)}
                    onNameChange={(name) => patchNodeData(sel.id, { label: name })}
                    onConfigChange={(cfg) => patchNodeConfig(sel.id, cfg)}
                    onDelete={sel.type === 'start' ? undefined : () => deleteNode(sel.id)}
                    onDuplicate={sel.type === 'start' ? undefined : () => duplicateNode(sel.id)}
                    variableSources={variableSourcesForNode(sel.id)}
                  />
                ) : null;
              })()}
            </AnimatePresence>

            <Panel position="top-left" className="ml-3 mt-3 max-w-[calc(100vw-24px)] md:ml-6 md:mt-6 md:max-w-[calc(100vw-300px)]">
              <div className="no-scrollbar flex h-9 items-center gap-2.5 overflow-x-auto whitespace-nowrap rounded-xl bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-xl backdrop-blur-md md:h-8">
                {onClose && <button type="button" onClick={() => void handleClose()} disabled={isClosing} title="Close Agent Builder" aria-label="Close Agent Builder" className="flex items-center text-[#888] hover:text-white disabled:cursor-wait disabled:text-[#666]">{isClosing ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}</button>}
                <button type="button" onClick={openWorkflowSettings} title="Workflow settings" className="flex max-w-[180px] items-center gap-1.5 truncate hover:text-[#ddd]">
                  <span className="truncate">{wfInfo?.name ?? 'Workflow'}</span>
                  <Settings size={12} className="shrink-0 text-[#888]" />
                </button>
                <button
                  title="Version history"
                  aria-label="Version history"
                  onClick={() => versionPanelOpen.set(true)}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white"
                >
                  <History size={12} />
                  v{wfInfo?.latestVersion ?? 0}
                </button>
                {wfInfo && <span className="text-[10px] text-[#777]" title="Draft revision">r{wfInfo.draftRevision}</span>}
                <button
                  type="button"
                  title="Preview workflow"
                  aria-label="Preview workflow"
                  disabled={!wfInfo || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); firePreview(); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <Play size={12} className="fill-current" />
                  Preview
                </button>
                <button
                  type="button"
                  title="Evaluate workflow"
                  aria-label="Evaluate workflow"
                  disabled={!wfInfo || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); requestedEvaluationNodeId.set(null); evaluationPanelOpen.set(true); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <CircleDot size={12} />
                  Evaluate
                </button>
                <button
                  type="button"
                  title="Export workflow code"
                  aria-label="Export workflow code"
                  disabled={!wfInfo || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); fireCode(); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <Code size={12} />
                  Code
                </button>
                <button
                  type="button"
                  title="Publish workflow"
                  aria-label="Publish workflow"
                  disabled={!wfInfo || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); publishDialogOpen.set(true); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <Rocket size={12} />
                  Publish
                </button>
                <button
                  type="button"
                  title="Open ChatKit preview"
                  aria-label="Open ChatKit preview"
                  disabled={!wfInfo || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); setChatPreviewOpen(true); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <MessageSquare size={12} />
                  Chat
                </button>
                <button
                  type="button"
                  title="Run a published batch"
                  aria-label="Run a published batch"
                  disabled={!wfInfo || wfInfo.latestVersion < 1 || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); setBatchPanelOpen(true); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <FilePlus2 size={12} />
                  Batch
                </button>
                <button
                  type="button"
                  title="Deploy with ChatKit"
                  aria-label="Deploy with ChatKit"
                  disabled={!wfInfo || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); setChatDeployOpen(true); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <Rocket size={12} />
                  Deploy
                </button>
                <button
                  type="button"
                  title="Open workflow review"
                  aria-label="Open workflow review"
                  disabled={!wfInfo || backendState !== 'up'}
                  onClick={() => { setWorkflowSettingsOpen(false); setDiagnosticsOpen(false); setCollaborationOpen(true); }}
                  className="flex items-center gap-1 text-[#a1a1aa] hover:text-white disabled:opacity-40"
                >
                  <Users size={12} />
                  Review
                </button>
                <span className={`w-1.5 h-1.5 rounded-full ${backendState === 'up' ? 'bg-green-400' : backendState === 'down' ? 'bg-red-400' : 'bg-yellow-400'}`} title={`Backend ${backendState}`} />
                {saveState === 'saving' && <span className="text-[#a1a1aa]">Saving…</span>}
                {saveState === 'saved' && <span className="text-green-400">Saved</span>}
                {saveState === 'error' && <span className="text-red-400">Save failed</span>}
                {saveState === 'conflict' && <span className="text-amber-300">Autosave paused</span>}
                {wfInfo && wfInfo.errors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setDiagnosticsOpen((open) => !open); setWorkflowSettingsOpen(false); }}
                    className="flex items-center gap-1 text-red-300 hover:text-red-200"
                    title={wfInfo.errors.join('\n')}
                    aria-label={`${wfInfo.errors.length} validation errors`}
                  >
                    <CircleAlert size={13} />
                    {wfInfo.errors.length}
                  </button>
                )}
                {wfInfo && (wfInfo.warnings.length + wfInfo.safetyFindings.length) > 0 && (
                  <button
                    type="button"
                    onClick={() => { setDiagnosticsOpen((open) => !open); setWorkflowSettingsOpen(false); }}
                    className="flex items-center gap-1 text-amber-300 hover:text-amber-200"
                    title={[...wfInfo.warnings, ...wfInfo.safetyFindings.map((finding) => finding.message)].join('\n')}
                    aria-label={`${wfInfo.warnings.length + wfInfo.safetyFindings.length} validation warnings`}
                  >
                    <TriangleAlert size={13} />
                    {wfInfo.warnings.length + wfInfo.safetyFindings.length}
                  </button>
                )}
              </div>
              {workflowSettingsOpen && (
                <div className="mt-2 w-[min(320px,calc(100vw-24px))] rounded-md border border-[#353535] bg-[#1b1b1b] p-3 text-left shadow-2xl">
                  <div className="mb-3 text-[12px] font-semibold text-white">Workflow settings</div>
                  <label className="block text-[10px] font-medium uppercase text-[#777]">Name</label>
                  <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} maxLength={120} autoFocus className="mt-1 w-full rounded-md border border-[#383838] bg-[#111] px-2.5 py-2 text-[12px] text-white outline-none focus:border-[#666]" />
                  <label className="mt-3 block text-[10px] font-medium uppercase text-[#777]">Description</label>
                  <textarea value={workflowDescription} onChange={(event) => setWorkflowDescription(event.target.value)} maxLength={1000} rows={3} className="mt-1 w-full resize-none rounded-md border border-[#383838] bg-[#111] px-2.5 py-2 text-[12px] text-white outline-none focus:border-[#666]" />
                  <button type="button" disabled={!wfInfo || backendState !== 'up'} onClick={() => { setWorkflowSettingsOpen(false); setWorkflowSecretsOpen(true); }} className="mt-3 flex h-9 w-full items-center gap-2 rounded-md border border-[#383838] bg-[#202020] px-2.5 text-left text-[11px] text-[#bbb] hover:border-[#555] hover:text-white disabled:opacity-40"><KeyRound size={13} className="text-[#888]" /><span className="min-w-0 flex-1">Workflow secrets</span><ChevronRight size={12} className="text-[#666]" /></button>
                  {workflowSettingsError && <div className="mt-2 text-[11px] text-red-300">{workflowSettingsError}</div>}
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" disabled={workflowSettingsBusy} onClick={() => setWorkflowSettingsOpen(false)} className="rounded-md px-2.5 py-1.5 text-[11px] text-[#aaa] hover:bg-[#292929] hover:text-white">Cancel</button>
                    <button type="button" disabled={workflowSettingsBusy || !workflowName.trim()} onClick={() => void saveWorkflowSettings()} className="rounded-md bg-white px-3 py-1.5 text-[11px] font-medium text-black disabled:opacity-50">{workflowSettingsBusy ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              )}
              {diagnosticsOpen && wfInfo && (
                <div className="mt-2 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-md border border-[#353535] bg-[#1b1b1b] text-left shadow-2xl">
                  <div className="flex items-center justify-between border-b border-[#303030] px-3 py-2.5">
                    <div><div className="text-[12px] font-semibold text-white">Diagnostics</div><div className="mt-0.5 text-[10px] text-[#777]">{wfInfo.errorIssues.length + safetyErrorCount} errors, {wfInfo.warningIssues.length + safetyWarningCount} warnings</div></div>
                    <button type="button" title="Close diagnostics" aria-label="Close diagnostics" onClick={() => setDiagnosticsOpen(false)} className="text-[#777] hover:text-white"><X size={14} /></button>
                  </div>
                  <div className="max-h-80 divide-y divide-[#292929] overflow-y-auto">
                    {[
                      ...wfInfo.errorIssues.map((issue) => ({ ...issue, severity: 'error' as const })),
                      ...wfInfo.warningIssues.map((issue) => ({ ...issue, severity: 'warning' as const })),
                      ...wfInfo.safetyFindings.map((finding) => ({ ...finding, severity: finding.severity === 'high' ? 'error' as const : 'warning' as const })),
                    ].map((issue, index) => {
                      const node = issue.nodeId ? nodes.find((candidate) => candidate.id === issue.nodeId) : undefined;
                      const edgeId = 'edgeId' in issue ? issue.edgeId : undefined;
                      return (
                        <button key={`${issue.severity}-${issue.nodeId ?? edgeId ?? index}-${index}`} type="button" disabled={!node && !edgeId} onClick={() => focusValidationIssue(issue.nodeId, edgeId)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-[#232323] disabled:cursor-default disabled:hover:bg-transparent">
                          {issue.severity === 'error' ? <CircleAlert size={14} className="mt-0.5 shrink-0 text-red-300" /> : <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-300" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {issue.code && <span className="shrink-0 rounded bg-[#2b2b2b] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[#999]">{issue.code}</span>}
                              <div className="text-[11.5px] leading-relaxed text-[#ddd]">{issue.message}</div>
                            </div>
                            <div className="mt-1 text-[9.5px] uppercase text-[#666]">{node ? `${String(node.data?.label ?? node.id)} · click to focus` : edgeId ? `Connection ${edgeId}` : 'Workflow'}</div>
                            {issue.remediation && <div className="mt-1.5 text-[10.5px] leading-relaxed text-[#aab4c0]">{issue.remediation}</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Panel>

            <Panel position="top-right" className="mr-6 mt-6 hidden md:block">
              <div className="flex items-center justify-center px-3 py-1.5 h-8 bg-black/40 backdrop-blur-md rounded-xl text-white text-xs font-semibold shadow-xl">
                {zoomPercentage}%
              </div>
            </Panel>

            <Panel position="top-right" className="mr-3 mt-16 max-w-[calc(100vw-24px)] md:mr-4 md:mt-16 md:max-w-none">
              {!nodeSearchOpen ? (
                <button
                  type="button"
                  title="Search nodes (Ctrl/Cmd+K)"
                  aria-label="Search nodes"
                  onClick={() => { setNodeSearchOpen(true); setNodeSearchIndex(0); }}
                  className="flex h-9 items-center gap-2 rounded-md border border-[#383838] bg-[#1b1b1b]/95 px-3 text-[11px] text-[#aaa] shadow-xl backdrop-blur hover:bg-[#282828] hover:text-white"
                >
                  <Search size={14} />
                  <span>Search nodes</span>
                  <kbd className="rounded border border-[#444] bg-[#242424] px-1.5 py-0.5 text-[9px] text-[#777]">Ctrl K</kbd>
                </button>
              ) : (
                <div className="w-[min(310px,calc(100vw-24px))] overflow-hidden rounded-md border border-[#383838] bg-[#1b1b1b]/[.98] text-left shadow-2xl backdrop-blur">
                  <div className="flex items-center gap-2 border-b border-[#303030] px-2.5 py-2">
                    <Search size={14} className="shrink-0 text-[#777]" />
                    <input
                      ref={nodeSearchInputRef}
                      value={nodeSearchQuery}
                      onChange={(event) => { setNodeSearchQuery(event.target.value); setNodeSearchIndex(0); }}
                      placeholder="Name, type, or node ID"
                      aria-label="Search workflow nodes"
                      aria-controls="agent-builder-node-results"
                      className="min-w-0 flex-1 bg-transparent text-[11.5px] text-white outline-none placeholder:text-[#666]"
                    />
                    <button type="button" title="Close node search" aria-label="Close node search" onClick={() => setNodeSearchOpen(false)} className="rounded p-1 text-[#777] hover:bg-[#303030] hover:text-white"><X size={13} /></button>
                  </div>
                  <div
                    role="listbox"
                    id="agent-builder-node-results"
                    aria-label="Matching workflow nodes"
                    aria-activedescendant={nodeSearchMatches[nodeSearchIndex] ? `agent-builder-node-result-${nodeSearchMatches[nodeSearchIndex].id}` : undefined}
                    className="max-h-64 overflow-y-auto py-1"
                  >
                    {nodeSearchMatches.map((node, index) => {
                      const label = String(node.data?.label ?? node.id);
                      const active = index === nodeSearchIndex;
                      return (
                        <button
                          key={node.id}
                          id={`agent-builder-node-result-${node.id}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setNodeSearchIndex(index)}
                          onClick={() => focusNodeSearchMatch(node)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left ${active ? 'bg-[#303030]' : 'hover:bg-[#252525]'}`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${node.type === 'agent' ? 'bg-[#7a9efa]' : node.type === 'start' ? 'bg-[#93dfca]' : node.type === 'end' ? 'bg-[#d4d4d4]' : 'bg-[#777]'}`} />
                          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#ddd]">{label}</span>
                          <span className="shrink-0 text-[9.5px] text-[#666]">{node.type}</span>
                        </button>
                      );
                    })}
                    {nodeSearchMatches.length === 0 && <div className="px-3 py-5 text-center text-[11px] text-[#666]">No nodes match this search.</div>}
                  </div>
                  <div className="border-t border-[#303030] px-3 py-1.5 text-[9.5px] text-[#666]">Up/down to navigate · Enter to focus · Esc to close</div>
                </div>
              )}
            </Panel>

            {draftConflict && (
              <Panel position="top-left" className="ml-3 mt-16 md:ml-6">
                <div className="w-[min(370px,calc(100vw-24px))] rounded-md border border-amber-800/70 bg-[#241d13] p-3 text-left shadow-2xl">
                  <div className="flex items-start gap-2.5">
                    <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-amber-100">Draft changed elsewhere</div>
                      <div className="mt-1 text-[10.5px] leading-relaxed text-[#c9b58d]">Your local graph is preserved and autosave is paused. Local base r{draftConflict.expectedRevision}; remote r{draftConflict.currentRevision}.</div>
                    </div>
                  </div>
                  {conflictActionError && <div className="mt-2 rounded border border-red-900/60 bg-red-950/20 p-2 text-[10.5px] text-red-300">{conflictActionError}</div>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={conflictAction !== null} onClick={() => void resolveDraftConflict('reload')} className="flex h-8 items-center gap-1.5 rounded-md border border-[#5a4a31] px-2.5 text-[10.5px] text-[#e0c99d] hover:bg-[#302719] disabled:opacity-40">{conflictAction === 'reload' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Reload remote</button>
                    <button type="button" disabled={conflictAction !== null} onClick={() => void resolveDraftConflict('overwrite')} className="flex h-8 items-center gap-1.5 rounded-md border border-amber-700/70 bg-amber-950/30 px-2.5 text-[10.5px] text-amber-100 hover:bg-amber-950/50 disabled:opacity-40">{conflictAction === 'overwrite' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Overwrite remote</button>
                    <button type="button" disabled={conflictAction !== null} onClick={() => void resolveDraftConflict('duplicate')} className="flex h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-[10.5px] font-medium text-black hover:bg-[#e5e5e5] disabled:opacity-40">{conflictAction === 'duplicate' ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />} Duplicate local copy</button>
                  </div>
                </div>
              </Panel>
            )}
            
            <Panel position="bottom-center" className="mb-8">
              <div className="flex items-center gap-3 px-3 py-2 bg-[#2b2b2b] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <button type="button" title="Pan canvas" aria-label="Pan canvas" onClick={() => setInteractionMode('pan')} className={`w-10 h-10 rounded-full text-white transition-colors flex items-center justify-center shrink-0 ${interactionMode === 'pan' ? 'bg-[#404040]' : 'hover:bg-[#404040]'}`}>
                  <Hand size={20} strokeWidth={2} className="relative top-px" />
                </button>
                <button type="button" title="Select nodes" aria-label="Select nodes" onClick={() => setInteractionMode('select')} className={`w-10 h-10 text-white rounded-full transition-colors flex items-center justify-center shrink-0 ${interactionMode === 'select' ? 'bg-[#404040]' : 'hover:bg-[#404040]'}`}>
                  <MousePointer2 size={20} strokeWidth={2} />
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
                <button type="button" title="Auto layout" aria-label="Automatically arrange workflow" onClick={autoLayout} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-[#404040]">
                  <LayoutTemplate size={20} strokeWidth={2} />
                </button>
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </div>

      {/* Backend-driven overlays (portaled to document.body) */}
      {backend.ready && (
        <>
          <RunPanel
            backend={backend}
            inputVariables={((nodes.find((node) => node.type === 'start')?.data?.config as Record<string, any> | undefined)?.inputVariables ?? []).filter((variable: any) => variable.name !== 'input_as_text')}
            stateVariables={(nodes.find((node) => node.type === 'start')?.data?.config as Record<string, any> | undefined)?.stateVariables ?? []}
            onFocusNode={focusRunNode}
            onActiveNodeChange={highlightActiveRunNode}
            selectedPreviewNodeId={selectedPreviewNodeId}
            onPreviewNodeChange={setSelectedPreviewNodeId}
            previewSelectionPinned={previewSelectionPinned}
            onPreviewSelectionPinnedChange={setPreviewSelectionPinned}
          />
          <CodeExportModal backend={backend} />
          <EvaluationPanel
            agentNodes={nodes.filter((node) => node.type === 'agent').map((node) => ({ id: node.id, name: String(node.data?.label ?? 'Agent') }))}
            onFocusNode={focusRunNode}
          />
          <VersionHistoryPanel />
          <PublishWorkflowModal backend={backend} onFocusNode={focusRunNode} />
          <RunHistoryPanel backend={backend} />
          {wfInfo && (
            <BatchRunPanel
              open={batchPanelOpen}
              workflowId={wfInfo.id}
              workflowName={wfInfo.name}
              latestVersion={wfInfo.latestVersion}
              onClose={() => setBatchPanelOpen(false)}
            />
          )}
          {wfInfo && (
            <ChatPreviewPanel
              open={chatPreviewOpen}
              workflowId={wfInfo.id}
              latestVersion={wfInfo.latestVersion}
              onClose={() => setChatPreviewOpen(false)}
            />
          )}
          {wfInfo && (
            <ChatKitDeployPanel
              open={chatDeployOpen}
              workflowId={wfInfo.id}
              workflowName={wfInfo.name}
              latestVersion={wfInfo.latestVersion}
              onClose={() => setChatDeployOpen(false)}
            />
          )}
          {wfInfo && (
            <CollaborationPanel
              open={collaborationOpen}
              workflowId={wfInfo.id}
              selectedNodeIds={nodes.filter((node) => node.selected).map((node) => node.id)}
              cursor={localCollaborationCursor}
              onStateChange={handleCollaborationStateChange}
              onFocusNode={focusRunNode}
              onClose={() => setCollaborationOpen(false)}
            />
          )}
          {wfInfo && (
            <WorkflowSecretsPanel
              open={workflowSecretsOpen}
              workflowId={wfInfo.id}
              workflowName={wfInfo.name}
              onClose={() => setWorkflowSecretsOpen(false)}
            />
          )}
        </>
      )}
      {!backend.ready && (
        <div
          className="absolute inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-[#0e0e0e] text-[#8b8b93]"
          data-testid="agent-builder-initializing"
          role="status"
          aria-live="polite"
        >
          {backendState === 'down' ? (
            <>
              <CircleAlert size={20} className="text-[#b88a6d]" />
              <span className="text-[13px] text-[#aaaab1]">Agent Builder is unavailable</span>
              {onClose && (
                <button
                  type="button"
                  onClick={() => void handleClose()}
                  disabled={isClosing}
                  className="mt-1 flex h-8 items-center gap-1.5 rounded-md border border-[#38383c] bg-[#242427] px-3 text-[11.5px] font-medium text-[#d2d2d6] hover:bg-[#2c2c30] disabled:cursor-wait disabled:text-[#6f6f76]"
                >
                  {isClosing ? <Loader2 size={13} className="animate-spin" /> : <ChevronLeft size={13} />}
                  Back to agents
                </button>
              )}
            </>
          ) : (
            <>
              <Loader2 size={20} className="animate-spin text-[#93dfca]" />
              <span className="text-[12px]">Loading agent builder...</span>
            </>
          )}
        </div>
      )}
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
