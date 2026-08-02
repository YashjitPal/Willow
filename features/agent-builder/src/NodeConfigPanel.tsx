/**
 * NodeConfigPanel — config editor for the Agent Builder node types that have
 * no bespoke panel (everything except Agent + Guardrails, which keep their own
 * rich panels). Renders per-type fields and writes the canonical config into
 * node.data.config, which the backend normalizer consumes on save.
 *
 * Also powers the Start node's state-variable declarations.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, BookOpen, Copy } from 'lucide-react';
import { useUserDataContext } from '@willow/auth/UserDataContext';
import { getAgentBuilderClient, type McpServer, type NodeDataContract, type VectorStore } from './agent-builder';
import { formatJsonSchemaIssues, validateJsonSchemaDefinition } from '@willow/core/json-schema';
import { VariablePicker, type WorkflowVariableSource } from './VariablePicker';

type Cfg = Record<string, any>;

interface Props {
  nodeType: string;
  nodeName: string;
  config: Cfg;
  contract?: NodeDataContract;
  onNameChange: (name: string) => void;
  onConfigChange: (config: Cfg) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  variableSources?: WorkflowVariableSource[];
}

const VAR_TYPES = ['string', 'number', 'boolean', 'object', 'list'];

const panelMotion = {
  initial: { opacity: 0, x: 20, scale: 0.98 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: 15, scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 450, damping: 35, mass: 0.8 },
};

const label = 'text-white text-[14px] font-medium';
const inputCls =
  'w-full bg-[#2b2b2b] rounded-lg px-3 h-9 text-white text-[13px] outline-none placeholder:text-[#6a6a6a]';
const textareaCls =
  'w-full bg-[#2b2b2b] rounded-lg px-3 py-2 text-white text-[13px] outline-none placeholder:text-[#6a6a6a] resize-none leading-relaxed font-mono';
const selectCls =
  'bg-[#2b2b2b] rounded-lg px-2 h-9 text-white text-[13px] outline-none border-none';

const TITLES: Record<string, string> = {
  start: 'Start', end: 'End', note: 'Note', subflow: 'Subflow', fileSearch: 'File search',
  mcp: 'MCP', ifElse: 'If / else', while: 'While', userApproval: 'Human approval',
  transform: 'Transform', setState: 'Set state',
};

const SUBTITLES: Record<string, string> = {
  start: 'Declare workflow inputs and global state',
  end: 'Define the workflow output',
  subflow: 'Run a pinned published workflow as a reusable step',
  note: 'Annotation — ignored at runtime',
  fileSearch: 'Retrieve passages from vector stores',
  mcp: 'Call a tool on an MCP server',
  ifElse: 'Branch on CEL conditions',
  while: 'Loop while a CEL condition holds',
  userApproval: 'Pause for human approval',
  transform: 'Reshape data with CEL expressions',
  setState: 'Write to global state variables',
};

export const NodeConfigPanel: React.FC<Props> = ({ nodeType, nodeName, config, contract, onNameChange, onConfigChange, onDelete, onDuplicate, variableSources = [] }) => {
  const [localName, setLocalName] = useState(nodeName);
  useEffect(() => setLocalName(nodeName), [nodeName, nodeType]);

  const set = (patch: Cfg) => onConfigChange({ ...config, ...patch });

  return (
    <motion.div
      {...panelMotion}
      className="absolute inset-x-3 top-16 max-h-[calc(100%-148px)] w-auto bg-[#1a1a1a] rounded-[20px] shadow-2xl flex flex-col z-20 pointer-events-auto border border-[#2b2b2b] md:inset-x-auto md:right-6 md:top-6 md:max-h-[calc(100%-48px)] md:w-[350px]"
    >
      <div className="p-5 pb-8 flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-white text-[16px] font-semibold tracking-wide">{TITLES[nodeType] ?? nodeType}</h2>
          <div className="flex items-center gap-3 text-[#a1a1aa]">
            <button className="hover:text-white transition-colors"><BookOpen size={16} strokeWidth={2.5} /></button>
            {onDuplicate && <button type="button" title={`Duplicate ${TITLES[nodeType] ?? nodeType}`} aria-label={`Duplicate ${TITLES[nodeType] ?? nodeType}`} onClick={onDuplicate} className="hover:text-white transition-colors"><Copy size={16} strokeWidth={2.5} /></button>}
            {onDelete && (
              <button type="button" title={`Delete ${TITLES[nodeType] ?? nodeType}`} aria-label={`Delete ${TITLES[nodeType] ?? nodeType}`} onClick={onDelete} className="hover:text-red-400 transition-colors">
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <p className="text-[#a1a1aa] text-[13px] -mt-2.5 tracking-wide shrink-0">{SUBTITLES[nodeType] ?? ''}</p>

        {nodeType !== 'note' && (
          <div className="flex items-center justify-between gap-4 shrink-0">
            <label className={label}>Name</label>
            <input
              className="w-[210px] bg-[#2b2b2b] rounded-lg px-3 h-8 text-white text-[13px] outline-none placeholder:text-[#6a6a6a]"
              value={localName}
              placeholder={TITLES[nodeType]}
              onChange={(e) => { setLocalName(e.target.value); onNameChange(e.target.value); }}
            />
          </div>
        )}

        {nodeType === 'start' && <StartFields config={config} set={set} />}
        {nodeType === 'ifElse' && <IfElseFields config={config} set={set} variableSources={variableSources} />}
        {nodeType === 'while' && <WhileFields config={config} set={set} variableSources={variableSources} />}
        {nodeType === 'subflow' && <SubflowFields config={config} set={set} />}
        {nodeType === 'transform' && <TransformFields config={config} set={set} variableSources={variableSources} />}
        {nodeType === 'setState' && <SetStateFields config={config} set={set} variableSources={variableSources} />}
        {nodeType === 'userApproval' && <UserApprovalFields config={config} set={set} variableSources={variableSources} />}
        {nodeType === 'fileSearch' && <FileSearchFields config={config} set={set} variableSources={variableSources} />}
        {nodeType === 'mcp' && <McpFields config={config} set={set} />}
        {nodeType === 'end' && <EndFields config={config} set={set} variableSources={variableSources} />}
        {nodeType === 'note' && <NoteFields config={config} set={set} />}
        {['subflow', 'fileSearch', 'mcp', 'ifElse', 'while', 'userApproval', 'transform', 'setState'].includes(nodeType) && (
          <ErrorPolicyFields config={config} set={set} />
        )}

        {contract && (
          <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-[#2b2b2b]">
            <span className={label}>Data contract</span>
            <ContractGroup title="Inputs" fields={contract.inputs} />
            <ContractGroup title="Outputs" fields={contract.outputs} />
          </div>
        )}
      </div>
    </motion.div>
  );
};

const ContractGroup: React.FC<{
  title: string;
  fields: NodeDataContract['inputs'];
}> = ({ title, fields }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[#8a8a8a] text-[11px] font-semibold uppercase tracking-wide">{title}</span>
    {fields.length === 0 ? (
      <span className="text-[#5f5f5f] text-[12px]">None</span>
    ) : (
      <div className="flex flex-col gap-1">
        {fields.map((field) => (
          <div key={`${title}-${field.name}`} className="flex items-center justify-between gap-2 bg-[#222] rounded-md px-2.5 py-1.5">
            <span className="text-[#d4d4d4] text-[12px] font-mono truncate">{field.name}</span>
            <span className="text-[#8a8a8a] text-[10px] uppercase tracking-wide shrink-0">
              {field.type}{field.required ? ' *' : ''}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

// --- helpers ---------------------------------------------------------------

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-col gap-1.5">{children}</div>
);

const AddButton: React.FC<{ onClick: () => void; text: string }> = ({ onClick, text }) => (
  <button onClick={onClick} className="flex items-center gap-1.5 text-[#a1a1aa] hover:text-white transition-colors text-[13px] font-medium self-start">
    <Plus size={14} strokeWidth={2.5} /> {text}
  </button>
);

const SubflowFields: React.FC<{ config: Cfg; set: (p: Cfg) => void }> = ({ config, set }) => {
  const { apiKeys } = useUserDataContext();
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; latestVersion: number }>>([]);
  useEffect(() => {
    let cancelled = false;
    getAgentBuilderClient(apiKeys).listWorkflows().then(({ workflows: rows }) => {
      if (!cancelled) setWorkflows(rows.filter((workflow) => workflow.latestVersion > 0));
    }).catch(() => { if (!cancelled) setWorkflows([]); });
    return () => { cancelled = true; };
  }, [apiKeys]);
  const selected = workflows.find((workflow) => workflow.id === config.workflowId);
  const inputs = Array.isArray(config.inputMappings) ? config.inputMappings : [];
  const outputs = Array.isArray(config.outputMappings) ? config.outputMappings : [];
  return (
    <div className="flex flex-col gap-4">
      <Row><label className={label}>Workflow</label><select className={selectCls} value={config.workflowId ?? ''} onChange={(event) => { const workflow = workflows.find((item) => item.id === event.target.value); set({ workflowId: event.target.value, version: workflow?.latestVersion ?? 0 }); }}><option value="">Select published workflow</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></Row>
      <Row><label className={label}>Pinned version</label><select className={selectCls} disabled={!selected} value={config.version ?? ''} onChange={(event) => set({ version: Number(event.target.value) })}><option value="">Select version</option>{Array.from({ length: selected?.latestVersion ?? 0 }, (_, index) => index + 1).reverse().map((version) => <option key={version} value={version}>Version {version}</option>)}</select></Row>
      <Row><label className={label}>Maximum depth</label><input type="number" min={1} max={32} step={1} className={inputCls} value={config.maxDepth ?? 8} onChange={(event) => set({ maxDepth: Math.max(1, Math.min(32, Math.round(Number(event.target.value) || 8))) })} /></Row>
      <div className="flex flex-col gap-2"><label className={label}>Inputs</label>{inputs.map((mapping: Cfg, index: number) => <div key={index} className="rounded-md border border-[#333] bg-[#222] p-2"><div className="flex gap-2"><input className={`${inputCls} h-8`} placeholder="Child input" value={mapping.target ?? ''} onChange={(event) => set({ inputMappings: inputs.map((item: Cfg, itemIndex: number) => itemIndex === index ? { ...item, target: event.target.value } : item) })} /><button type="button" onClick={() => set({ inputMappings: inputs.filter((_: unknown, itemIndex: number) => itemIndex !== index) })} className="text-[#777] hover:text-red-300"><Trash2 size={13} /></button></div><input className={`${inputCls} mt-2 h-8 font-mono`} placeholder="{{workflow.input_as_text}} or $cel: ..." value={typeof mapping.value === 'string' ? mapping.value : JSON.stringify(mapping.value ?? '')} onChange={(event) => set({ inputMappings: inputs.map((item: Cfg, itemIndex: number) => itemIndex === index ? { ...item, value: event.target.value } : item) })} /></div>)}<AddButton text="Map input" onClick={() => set({ inputMappings: [...inputs, { target: 'input_as_text', value: '{{workflow.input_as_text}}' }] })} /></div>
      <div className="flex flex-col gap-2"><label className={label}>Outputs</label>{outputs.map((mapping: Cfg, index: number) => <div key={index} className="rounded-md border border-[#333] bg-[#222] p-2"><div className="flex gap-2"><input className={`${inputCls} h-8`} placeholder="Output name" value={mapping.name ?? ''} onChange={(event) => set({ outputMappings: outputs.map((item: Cfg, itemIndex: number) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><select className={`${selectCls} h-8`} value={mapping.type ?? 'string'} onChange={(event) => set({ outputMappings: outputs.map((item: Cfg, itemIndex: number) => itemIndex === index ? { ...item, type: event.target.value } : item) })}>{mapping.type && !VAR_TYPES.includes(mapping.type) && <option value={mapping.type}>{mapping.type} (unsupported)</option>}{VAR_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button type="button" onClick={() => set({ outputMappings: outputs.filter((_: unknown, itemIndex: number) => itemIndex !== index) })} className="text-[#777] hover:text-red-300"><Trash2 size={13} /></button></div><input className={`${inputCls} mt-2 h-8 font-mono`} placeholder="child.output or child.state.value" value={mapping.expression ?? ''} onChange={(event) => set({ outputMappings: outputs.map((item: Cfg, itemIndex: number) => itemIndex === index ? { ...item, expression: event.target.value } : item) })} /></div>)}<AddButton text="Map output" onClick={() => set({ outputMappings: [...outputs, { name: 'result', type: 'string', expression: 'child.output' }] })} /></div>
    </div>
  );
};

type ErrorPolicy = 'fail' | 'continue' | 'branch';

/** Shared node failure policy. Legacy continueOnError is read but cleared when editing. */
const ErrorPolicyFields: React.FC<{ config: Cfg; set: (p: Cfg) => void }> = ({ config, set }) => {
  const value: ErrorPolicy = config.onError === 'branch' || config.onError === 'continue'
    ? config.onError
    : config.continueOnError === true
      ? 'continue'
      : 'fail';
  return (
    <div className="border-t border-[#333] pt-4 flex flex-col gap-2">
      <label className={label} htmlFor="node-error-policy">On error</label>
      <select
        id="node-error-policy"
        className={selectCls}
        value={value}
        onChange={(event) => set({ onError: event.target.value as ErrorPolicy, continueOnError: undefined })}
      >
        <option value="fail">Stop workflow</option>
        <option value="continue">Continue on default path</option>
        <option value="branch">Route through error handle</option>
      </select>
      <p className="text-[#6a6a6a] text-[11.5px]">
        {value === 'branch' ? 'Connect the red Error handle to choose the recovery path.' : value === 'continue' ? 'The error is exposed in this node output before the normal path continues.' : 'Errors stop the run and are reported in the preview trace.'}
      </p>
    </div>
  );
};

// --- Start -----------------------------------------------------------------

const StartFields: React.FC<{ config: Cfg; set: (p: Cfg) => void }> = ({ config, set }) => {
  const stateVars: any[] = config.stateVariables ?? [];
  const update = (i: number, patch: Cfg) =>
    set({ stateVariables: stateVars.map((v, idx) => (idx === i ? { ...v, ...patch } : v)) });
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className={label}>Input</span>
        <div className="flex items-center justify-between bg-[#2b2b2b] rounded-lg px-3 h-9">
          <span className="text-white text-[13px]">input_as_text</span>
          <span className="text-[#a1a1aa] text-[11px] font-bold tracking-wider">STRING</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className={label}>State variables</span>
        {stateVars.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className="flex-1 bg-[#2b2b2b] rounded-lg px-2.5 h-8 text-white text-[12.5px] outline-none" placeholder="name" value={v.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} />
            <select className="bg-[#2b2b2b] rounded-lg px-1.5 h-8 text-white text-[12px] outline-none" value={v.type ?? 'string'} onChange={(e) => update(i, { type: e.target.value })}>
              {VAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="text-[#6a6a6a] hover:text-red-400 transition-colors" onClick={() => set({ stateVariables: stateVars.filter((_, idx) => idx !== i) })}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <AddButton text="Add state variable" onClick={() => set({ stateVariables: [...stateVars, { name: '', type: 'string', initialValue: '' }] })} />
      </div>
    </>
  );
};

// --- If / else -------------------------------------------------------------

const IfElseFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; variableSources: WorkflowVariableSource[] }> = ({ config, set, variableSources }) => {
  // The canvas If/else node exposes a single condition handle ('if') + else.
  const branches: any[] = config.branches?.length ? config.branches : [{ id: 'if', label: 'If', condition: '' }];
  const first = branches[0];
  return (
    <Row>
      <div className="flex items-center justify-between"><span className={label}>Condition (CEL)</span><VariablePicker sources={variableSources} mode="expression" onInsert={(value) => set({ branches: branches.map((branch, index) => index === 0 ? { ...branch, condition: `${first.condition ?? ''}${value}` } : branch) })} /></div>
      <textarea
        rows={3}
        className={textareaCls}
        placeholder={'e.g. classifier.output_parsed.category == "billing"'}
        value={first.condition ?? ''}
        onChange={(e) => set({ branches: branches.map((branch, index) => index === 0 ? { ...branch, id: branch.id ?? 'if', label: branch.label ?? 'If', condition: e.target.value } : branch) })}
      />
      <p className="text-[#6a6a6a] text-[11.5px]">If true → the <b className="text-[#a1a1aa]">if</b> handle; otherwise the <b className="text-[#a1a1aa]">else</b> handle.</p>
    </Row>
  );
};

// --- While -----------------------------------------------------------------

const WhileFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; variableSources: WorkflowVariableSource[] }> = ({ config, set, variableSources }) => (
  <>
    <Row>
      <div className="flex items-center justify-between"><span className={label}>Condition (CEL)</span><VariablePicker sources={variableSources} mode="expression" onInsert={(value) => set({ condition: `${config.condition ?? ''}${value}` })} /></div>
      <textarea rows={3} className={textareaCls} placeholder="e.g. state.i < size(state.items)" value={config.condition ?? ''} onChange={(e) => set({ condition: e.target.value })} />
    </Row>
    <div className="flex items-center justify-between gap-3">
      <label className={label}>Max iterations</label>
      <input
        type="number"
        min={1}
        max={10000}
        step={1}
        className="w-24 bg-[#2b2b2b] rounded-lg px-3 h-9 text-white text-[13px] outline-none"
        value={config.maxIterations ?? 100}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isFinite(parsed)) return;
          set({ maxIterations: Math.max(1, Math.min(10000, Math.trunc(parsed))) });
        }}
      />
    </div>
    <div className="flex items-center justify-between gap-3">
      <label className={label}>On max iterations</label>
      <select className={selectCls} value={config.onMaxIterations ?? 'fail'} onChange={(e) => set({ onMaxIterations: e.target.value })}>
        <option value="fail">fail</option>
        <option value="break">break</option>
      </select>
    </div>
  </>
);

// --- Transform -------------------------------------------------------------

const TransformFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; variableSources: WorkflowVariableSource[] }> = ({ config, set, variableSources }) => {
  const outs: any[] = config.outputs ?? [];
  const update = (i: number, patch: Cfg) => set({ outputs: outs.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) });
  return (
    <div className="flex flex-col gap-2.5">
      <span className={label}>Outputs</span>
      {outs.map((o, i) => (
        <div key={i} className="flex flex-col gap-1.5 bg-[#222] rounded-lg p-2.5">
          <div className="flex items-center gap-1.5">
            <input className="flex-1 bg-[#2b2b2b] rounded-lg px-2.5 h-8 text-white text-[12.5px] outline-none" placeholder="field name" value={o.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} />
            <select className="bg-[#2b2b2b] rounded-lg px-1.5 h-8 text-white text-[12px] outline-none" value={o.type ?? 'string'} onChange={(e) => update(i, { type: e.target.value })}>
              {VAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="text-[#6a6a6a] hover:text-red-400" onClick={() => set({ outputs: outs.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button>
          </div>
          <div className="flex items-center gap-1"><input className="min-w-0 flex-1 bg-[#2b2b2b] rounded-lg px-2.5 h-8 text-white text-[12.5px] outline-none font-mono" placeholder="CEL expression" value={o.expression ?? ''} onChange={(e) => update(i, { expression: e.target.value })} /><VariablePicker sources={variableSources} mode="expression" onInsert={(value) => update(i, { expression: `${o.expression ?? ''}${value}` })} /></div>
        </div>
      ))}
      <AddButton text="Add output" onClick={() => set({ outputs: [...outs, { name: '', type: 'string', expression: '' }] })} />
    </div>
  );
};

// --- Set state -------------------------------------------------------------

const SetStateFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; variableSources: WorkflowVariableSource[] }> = ({ config, set, variableSources }) => {
  const asg: any[] = config.assignments ?? [];
  const stateNames = [...new Set(variableSources.filter((source) => source.kind === 'state').map((source) => source.path.split('.')[0]).filter(Boolean))];
  const update = (i: number, patch: Cfg) => set({ assignments: asg.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) });
  return (
    <div className="flex flex-col gap-2.5">
      <span className={label}>Assignments</span>
      {asg.map((a, i) => (
        <div key={i} className="flex flex-col gap-1.5 bg-[#222] rounded-lg p-2.5">
          <div className="flex items-center gap-1.5">
            <select className="flex-1 bg-[#2b2b2b] rounded-lg px-2.5 h-8 text-white text-[12.5px] outline-none" value={a.name ?? ''} onChange={(e) => update(i, { name: e.target.value })}>
              <option value="">Select state variable</option>
              {a.name && !stateNames.includes(a.name) && <option value={a.name}>{a.name} (undeclared)</option>}
              {stateNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button className="text-[#6a6a6a] hover:text-red-400" onClick={() => set({ assignments: asg.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button>
          </div>
          <div className="flex items-center gap-1"><input className="min-w-0 flex-1 bg-[#2b2b2b] rounded-lg px-2.5 h-8 text-white text-[12.5px] outline-none font-mono" placeholder="CEL expression, e.g. state.i + 1" value={a.expression ?? ''} onChange={(e) => update(i, { expression: e.target.value })} /><VariablePicker sources={variableSources} mode="expression" onInsert={(value) => update(i, { expression: `${a.expression ?? ''}${value}` })} /></div>
        </div>
      ))}
      <AddButton text="Add assignment" onClick={() => set({ assignments: [...asg, { name: '', expression: '' }] })} />
    </div>
  );
};

// --- Human approval --------------------------------------------------------

const UserApprovalFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; variableSources: WorkflowVariableSource[] }> = ({ config, set, variableSources }) => (
  <>
  <Row>
    <div className="flex items-center justify-between"><span className={label}>Approval message</span><VariablePicker sources={variableSources} onInsert={(value) => set({ message: `${config.message ?? ''}${value}` })} /></div>
    <textarea rows={4} className={textareaCls.replace(' font-mono', '')} placeholder="Send this draft? {{drafter.output_text}}" value={config.message ?? ''} onChange={(e) => set({ message: e.target.value })} />
    <p className="text-[#6a6a6a] text-[11.5px]">Routes to <b className="text-[#a1a1aa]">approved</b> / <b className="text-[#a1a1aa]">rejected</b>.</p>
  </Row>
  <Row>
    <span className={label}>Timeout (seconds)</span>
    <input type="number" min={0} max={604800} step={1} className={inputCls} placeholder="No timeout" value={config.timeoutMs ? config.timeoutMs / 1000 : ''} onChange={(e) => set({ timeoutMs: e.target.value === '' ? 0 : Math.max(0, Math.min(604800000, Math.round(Number(e.target.value) * 1000))) })} />
    <p className="text-[#6a6a6a] text-[11.5px]">Leave blank or use 0 to wait indefinitely.</p>
  </Row>
  </>
);

const ExecutionPolicyFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; defaultTimeout: number }> = ({ config, set, defaultTimeout }) => {
  const policy = config.executionPolicy ?? {};
  const update = (patch: Cfg) => set({ executionPolicy: { ...policy, ...patch } });
  return (
    <div className="border-t border-[#333] pt-4 flex flex-col gap-3">
      <span className="text-[#a1a1aa] text-[12px] font-medium uppercase">Execution</span>
      <div className="grid grid-cols-2 gap-2">
        <Row>
          <span className={label}>Timeout (ms)</span>
          <input type="number" min={100} max={600000} step={1} className={inputCls} placeholder={String(defaultTimeout)} value={policy.timeoutMs ?? ''} onChange={(e) => update({ timeoutMs: e.target.value === '' ? undefined : Math.max(100, Math.min(600000, Math.round(Number(e.target.value) || defaultTimeout))) })} />
        </Row>
        <Row>
          <span className={label}>Retries</span>
          <input type="number" min={0} max={5} step={1} className={inputCls} value={policy.maxRetries ?? 0} onChange={(e) => update({ maxRetries: Math.max(0, Math.min(5, Math.round(Number(e.target.value) || 0))) })} />
        </Row>
        <Row>
          <span className={label}>Backoff (ms)</span>
          <input type="number" min={0} max={60000} step={1} className={inputCls} value={policy.retryBackoffMs ?? 250} onChange={(e) => update({ retryBackoffMs: Math.max(0, Math.min(60000, Math.round(Number(e.target.value) || 0))) })} />
        </Row>
        <Row>
          <span className={label}>On timeout</span>
          <select className={inputCls} value={policy.timeoutBehavior ?? 'raise_exception'} onChange={(e) => update({ timeoutBehavior: e.target.value })}>
            <option value="raise_exception">Raise exception</option>
            <option value="error_as_result">Error as result</option>
          </select>
        </Row>
      </div>
    </div>
  );
};

// --- File search -----------------------------------------------------------

const FileSearchFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; variableSources: WorkflowVariableSource[] }> = ({ config, set, variableSources }) => {
  const { apiKeys } = useUserDataContext();
  const [stores, setStores] = useState<VectorStore[]>([]);
  const selected: string[] = config.vectorStoreIds ?? [];
  useEffect(() => {
    getAgentBuilderClient(apiKeys).listVectorStores().then((r) => setStores(r.stores)).catch(() => {});
  }, [apiKeys]);
  const toggle = (id: string) => set({ vectorStoreIds: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] });
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className={label}>Vector stores</span>
        {stores.length === 0 && <p className="text-[#6a6a6a] text-[12px]">No vector stores yet. Create one via the backend / Tools.</p>}
        {stores.map((s) => (
          <label key={s.id} className="flex items-center gap-2.5 bg-[#2b2b2b] rounded-lg px-3 h-9 cursor-pointer">
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="accent-white" />
            <span className="text-white text-[13px] flex-1">{s.name}</span>
            <span className="text-[#6a6a6a] text-[11px]">{s.fileCount} files</span>
          </label>
        ))}
      </div>
      <Row>
        <div className="flex items-center justify-between"><span className={label}>Query</span><VariablePicker sources={variableSources} onInsert={(value) => set({ query: `${config.query ?? ''}${value}` })} /></div>
        <input className={inputCls} placeholder="{{workflow.input_as_text}}" value={config.query ?? '{{workflow.input_as_text}}'} onChange={(e) => set({ query: e.target.value })} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row>
          <span className={label}>Max results</span>
          <input type="number" min={1} max={50} step={1} className={inputCls} value={config.maxResults ?? 10} onChange={(e) => set({ maxResults: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))) })} />
        </Row>
        <Row>
          <span className={label}>Score threshold</span>
          <input type="number" min={0} max={1} step={0.05} className={inputCls} value={config.scoreThreshold ?? 0} onChange={(e) => set({ scoreThreshold: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
        </Row>
      </div>
      <ExecutionPolicyFields config={config} set={set} defaultTimeout={60000} />
    </>
  );
};

// --- MCP -------------------------------------------------------------------

const McpFields: React.FC<{ config: Cfg; set: (p: Cfg) => void }> = ({ config, set }) => {
  const { apiKeys } = useUserDataContext();
  const [servers, setServers] = useState<McpServer[]>([]);
  useEffect(() => {
    getAgentBuilderClient(apiKeys).listMcpServers().then((r) => setServers(r.servers)).catch(() => {});
  }, [apiKeys]);
  const server = servers.find((s) => s.id === config.serverId);
  const [argsText, setArgsText] = useState(JSON.stringify(config.arguments ?? {}, null, 2));
  useEffect(() => setArgsText(JSON.stringify(config.arguments ?? {}, null, 2)), [config.serverId]);
  return (
    <>
      <Row>
        <span className={label}>Server</span>
        <select className={inputCls} value={config.serverId ?? ''} onChange={(e) => set({ serverId: e.target.value, tool: '' })}>
          <option value="">Select a server…</option>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.status})</option>)}
        </select>
        {servers.length === 0 && <p className="text-[#6a6a6a] text-[11.5px]">No MCP servers registered. Add one from the Tools menu.</p>}
      </Row>
      <Row>
        <span className={label}>Tool</span>
        <select className={inputCls} value={config.tool ?? ''} onChange={(e) => set({ tool: e.target.value })}>
          <option value="">Select a tool…</option>
          {(server?.tools ?? []).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
      </Row>
      <Row>
        <span className={label}>Arguments (JSON, supports {'{{...}}'})</span>
        <textarea rows={4} className={textareaCls} value={argsText}
          onChange={(e) => {
            setArgsText(e.target.value);
            try { set({ arguments: JSON.parse(e.target.value) }); } catch { /* keep typing */ }
          }}
        />
      </Row>
      <div className="flex items-center justify-between">
        <label className={label}>Require approval</label>
        <select className={selectCls} value={config.requireApproval ?? 'never'} onChange={(e) => set({ requireApproval: e.target.value })}>
          <option value="never">never</option>
          <option value="always">always</option>
        </select>
      </div>
      {config.requireApproval === 'always' && (
        <Row>
          <span className={label}>Approval timeout (seconds)</span>
          <input type="number" min={0} max={604800} step={1} className={inputCls} placeholder="No timeout" value={config.approvalTimeoutMs ? config.approvalTimeoutMs / 1000 : ''} onChange={(e) => set({ approvalTimeoutMs: e.target.value === '' ? 0 : Math.max(0, Math.round(Number(e.target.value) * 1000)) })} />
          <p className="text-[#6a6a6a] text-[11.5px]">Leave blank or use 0 to wait indefinitely. Tool execution timeout starts after approval.</p>
        </Row>
      )}
      <ExecutionPolicyFields config={config} set={set} defaultTimeout={300000} />
    </>
  );
};

// --- End -------------------------------------------------------------------

const EndFields: React.FC<{ config: Cfg; set: (p: Cfg) => void; variableSources: WorkflowVariableSource[] }> = ({ config, set, variableSources }) => {
  const [schemaText, setSchemaText] = useState(config.outputSchema ? JSON.stringify(config.outputSchema, null, 2) : '');
  const [schemaError, setSchemaError] = useState<string | null>(null);
  useEffect(() => {
    setSchemaText(config.outputSchema ? JSON.stringify(config.outputSchema, null, 2) : '');
    setSchemaError(null);
  }, [config.outputSchema]);
  return (
    <>
      <Row>
        <div className="flex items-center justify-between"><span className={label}>Output</span><VariablePicker sources={variableSources} onInsert={(value) => set({ output: `${config.output ?? ''}${value}` })} /></div>
        <textarea rows={4} className={textareaCls.replace(' font-mono', '')} placeholder="Template or $cel: expression. Defaults to the last agent's text." value={config.output ?? ''} onChange={(e) => set({ output: e.target.value })} />
        <p className="text-[#6a6a6a] text-[11.5px]">e.g. <span className="font-mono">{'{{agent.output_text}}'}</span> or <span className="font-mono">$cel: state.results</span></p>
      </Row>
      <Row>
        <div className="flex items-center justify-between">
          <span className={label}>Output schema</span>
          {config.outputSchema && <button className="text-[#8a8a8a] hover:text-white text-[11.5px]" onClick={() => { setSchemaText(''); setSchemaError(null); set({ outputSchema: undefined }); }}>Clear</button>}
        </div>
        <textarea rows={8} className={textareaCls} placeholder={'{"type":"object","properties":{},"required":[],"additionalProperties":false}'} value={schemaText} onChange={(e) => {
          const value = e.target.value;
          setSchemaText(value);
          if (!value.trim()) { setSchemaError(null); set({ outputSchema: undefined }); return; }
          try {
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Schema must be a JSON object.');
            const issues = validateJsonSchemaDefinition(parsed);
            if (issues.length > 0) throw new Error(formatJsonSchemaIssues(issues));
            setSchemaError(null);
            set({ outputSchema: parsed });
          } catch (error) {
            setSchemaError((error as Error).message);
          }
        }} />
        {schemaError && <p className="whitespace-pre-line text-red-300 text-[11.5px]">{schemaError}</p>}
        <p className="text-[#6a6a6a] text-[11.5px]">When set, the run fails unless the final output matches this strict JSON Schema.</p>
      </Row>
    </>
  );
};

// --- Note ------------------------------------------------------------------

const NoteFields: React.FC<{ config: Cfg; set: (p: Cfg) => void }> = ({ config, set }) => (
  <Row>
    <span className={label}>Note</span>
    <textarea rows={5} className={textareaCls.replace(' font-mono', '')} placeholder="Annotation for your team…" value={config.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
  </Row>
);

export default NodeConfigPanel;
