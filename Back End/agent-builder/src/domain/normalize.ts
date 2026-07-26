/**
 * Graph normalization: accepts either the canonical WorkflowGraph or the
 * frontend's raw React Flow shape ({nodes: [{id, type, position, data}],
 * edges: [{id, source, target, sourceHandle, targetHandle}]}) and produces a
 * canonical graph with defaulted per-type configs and unique variable names.
 */

import type {
  AgentNodeConfig,
  JsonObject,
  JsonValue,
  NodeType,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from './types.ts';

const TYPE_ALIASES: Record<string, NodeType> = {
  start: 'start',
  agent: 'agent',
  subflow: 'subflow',
  'sub-flow': 'subflow',
  workflowcall: 'subflow',
  'workflow-call': 'subflow',
  end: 'end',
  note: 'note',
  filesearch: 'fileSearch',
  'file-search': 'fileSearch',
  file_search: 'fileSearch',
  guardrail: 'guardrail',
  guardrails: 'guardrail',
  mcp: 'mcp',
  ifelse: 'ifElse',
  'if-else': 'ifElse',
  if_else: 'ifElse',
  while: 'while',
  userapproval: 'userApproval',
  'user-approval': 'userApproval',
  user_approval: 'userApproval',
  approval: 'userApproval',
  transform: 'transform',
  setstate: 'setState',
  'set-state': 'setState',
  set_state: 'setState',
};

export function normalizeNodeType(raw: string): NodeType | undefined {
  return TYPE_ALIASES[raw.toLowerCase().replace(/\s+/g, '')] ?? TYPE_ALIASES[raw.toLowerCase()];
}

/** "My Cool Agent!" -> my_cool_agent */
export function toVarName(name: string): string {
  const v = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return v || 'node';
}

function defaultLabel(type: NodeType): string {
  switch (type) {
    case 'start': return 'Start';
    case 'agent': return 'Agent';
    case 'subflow': return 'Subflow';
    case 'end': return 'End';
    case 'note': return 'Note';
    case 'fileSearch': return 'File search';
    case 'guardrail': return 'Guardrails';
    case 'mcp': return 'MCP';
    case 'ifElse': return 'If else';
    case 'while': return 'While';
    case 'userApproval': return 'User approval';
    case 'transform': return 'Transform';
    case 'setState': return 'Set state';
  }
}

export function defaultConfigFor(type: NodeType): JsonObject {
  switch (type) {
    case 'start':
      return {
        inputVariables: [],
        stateVariables: [],
      };
    case 'agent': {
      const cfg: AgentNodeConfig = {
        instructions: '',
        model: 'gemini-3-flash',
        includeChatHistory: true,
        writeToConversationHistory: true,
        tools: [],
        outputFormat: 'text',
        continueOnError: false,
        onError: 'fail',
      };
      return cfg as unknown as JsonObject;
    }
    case 'subflow':
      return { workflowId: '', version: 1, inputMappings: [], outputMappings: [], onError: 'fail', maxDepth: 8 };
    case 'end':
      return {};
    case 'note':
      return { text: '' };
    case 'fileSearch':
      return { vectorStoreIds: [], query: '{{workflow.input_as_text}}', onError: 'fail' };
    case 'guardrail':
      return {
        pii: false,
        moderation: false,
        jailbreak: false,
        hallucination: false,
        continueOnError: false,
        onTripwire: 'branch',
      };
    case 'mcp':
      return { serverId: '', tool: '', arguments: {}, requireApproval: 'never', onError: 'fail' };
    case 'ifElse':
      return { branches: [{ id: 'if', label: 'If', condition: 'true' }], onError: 'fail' };
    case 'while':
      return { condition: 'false', maxIterations: 100, onError: 'fail' };
    case 'userApproval':
      return { message: 'Approve to continue?', onError: 'fail' };
    case 'transform':
      return { outputs: [], onError: 'fail' };
    case 'setState':
      return { assignments: [], onError: 'fail' };
  }
}

interface RawNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  name?: string;
  config?: JsonObject;
  data?: JsonObject;
  [k: string]: JsonValue | undefined | { x: number; y: number } | JsonObject;
}

interface RawEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface NormalizeResult {
  graph: WorkflowGraph;
  /** id -> normalized variable name */
  varNames: Map<string, string>;
}

/**
 * Merge frontend `data` into a canonical config. Recognizes the fields the
 * canvas persists today (label, instructions, config for guardrails) plus the
 * full canonical config if the frontend sends one under data.config /
 * data.* directly.
 */
function extractConfig(type: NodeType, raw: RawNode): { name: string; config: JsonObject } {
  const data = (raw.data ?? {}) as JsonObject;
  const explicit = (raw.config ?? undefined) as JsonObject | undefined;
  const base = defaultConfigFor(type);

  let name =
    (typeof raw.name === 'string' && raw.name) ||
    (typeof data.label === 'string' && data.label) ||
    defaultLabel(type);

  let config: JsonObject = { ...base };

  if (explicit) {
    config = { ...base, ...explicit };
  } else {
    // Frontend react-flow data mapping
    if (type === 'agent') {
      if (typeof data.instructions === 'string') config.instructions = data.instructions;
      // full agent config may ride along under data
      for (const key of [
        'model', 'userMessage', 'includeChatHistory', 'writeToConversationHistory',
        'reasoningEffort', 'verbosity', 'modelParams', 'promptCache', 'tools', 'toolChoice', 'parallelToolCalls', 'resetToolChoice', 'outputFormat',
        'outputSchema', 'outputSchemaName', 'continueOnError', 'onError', 'maxTurns', 'maxInputTokensPerCall', 'modelTimeoutMs',
      ]) {
        if (data[key] !== undefined) config[key] = data[key];
      }
    } else if (type === 'guardrail') {
      const g = (data.config ?? {}) as JsonObject;
      for (const key of ['pii', 'moderation', 'jailbreak', 'hallucination', 'continueOnError']) {
        if (typeof g[key] === 'boolean') config[key] = g[key];
      }
      if (typeof g.onTripwire === 'string') config.onTripwire = g.onTripwire;
      if (g.input !== undefined) config.input = g.input;
      if (g.settings !== undefined) config.settings = g.settings;
    } else if (data.config && typeof data.config === 'object' && !Array.isArray(data.config)) {
      config = { ...base, ...(data.config as JsonObject) };
    } else {
      // allow config fields directly on data for all other types
      for (const [k, v] of Object.entries(data)) {
        if (k === 'label') continue;
        if (k in base) config[k] = v;
      }
    }
  }

  const explicitlySetsOnError = explicit?.onError !== undefined || data.onError !== undefined;
  if ((type === 'agent' || type === 'mcp') && !explicitlySetsOnError && config.continueOnError === true) {
    config.onError = 'continue';
  }

  return { name, config };
}

export function normalizeGraph(
  input: unknown,
  options: { migrateLegacyTerminal?: boolean } = {},
): NormalizeResult {
  if (!input || typeof input !== 'object') {
    throw new Error('graph must be an object with nodes and edges');
  }
  const rawNodes = (input as { nodes?: unknown }).nodes;
  const rawEdges = (input as { edges?: unknown }).edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    throw new Error('graph must have nodes[] and edges[]');
  }

  const nodes: WorkflowNode[] = [];
  const seenIds = new Set<string>();

  for (const rn of rawNodes as RawNode[]) {
    if (!rn || typeof rn !== 'object' || typeof rn.id !== 'string') {
      throw new Error('every node needs a string id');
    }
    if (!rn.id.trim()) throw new Error('node id cannot be empty');
    if (seenIds.has(rn.id)) throw new Error(`duplicate node id '${rn.id}'`);
    seenIds.add(rn.id);
    const typeStr = typeof rn.type === 'string' ? rn.type : '';
    if (typeStr === 'placeholder') continue; // canvas artifact, not executable
    const type = normalizeNodeType(typeStr);
    if (!type) throw new Error(`unknown node type '${typeStr}' (node '${rn.id}')`);
    const { name, config } = extractConfig(type, rn);
    nodes.push({
      id: rn.id,
      type,
      name,
      position:
        rn.position && typeof rn.position.x === 'number' && typeof rn.position.y === 'number'
          ? { x: rn.position.x, y: rn.position.y }
          : undefined,
      config,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: WorkflowEdge[] = [];
  let edgeSeq = 0;
  for (const re of rawEdges as RawEdge[]) {
    if (!re || typeof re.source !== 'string' || typeof re.target !== 'string') {
      throw new Error('every edge needs source and target');
    }
    // drop edges touching placeholders / unknown nodes silently only if
    // the endpoint was a placeholder we removed; otherwise validation will flag it
    if (!nodeIds.has(re.source) || !nodeIds.has(re.target)) {
      const rawNode = (rawNodes as RawNode[]).find(
        (n) => n.id === re.source || n.id === re.target,
      );
      const isPlaceholder =
        (rawNodes as RawNode[]).some((n) => n.type === 'placeholder' && (n.id === re.source || n.id === re.target));
      if (isPlaceholder || !rawNode) {
        if (isPlaceholder) continue;
      }
    }
    edgeSeq += 1;
    const sourceNode = nodes.find((node) => node.id === re.source);
    const targetNode = nodes.find((node) => node.id === re.target);
    // Notes are canvas annotations, never part of executable topology.
    if (sourceNode?.type === 'note' || targetNode?.type === 'note') continue;
    edges.push({
      id: typeof re.id === 'string' && re.id ? re.id : `edge_${edgeSeq}`,
      source: re.source,
      target: re.target,
      sourceHandle: re.sourceHandle ?? null,
      targetHandle: re.targetHandle ?? null,
    });
  }

  // Legacy handle mapping: frontend ifElse uses 'if' as the sole condition handle.
  for (const e of edges) {
    const src = nodes.find((n) => n.id === e.source);
    if (src?.type === 'ifElse' && e.sourceHandle && e.sourceHandle !== 'else') {
      const branches = (src.config.branches ?? []) as Array<JsonObject>;
      if (!branches.some((b) => b.id === e.sourceHandle)) {
        // map unknown handle to first branch if it exists
        if (branches.length && e.sourceHandle === 'if') e.sourceHandle = String(branches[0].id);
      }
    }
  }

  // Older saved/published graphs predate the explicit End node. Migrate only
  // those graphs so replay/import remains compatible; graphs that already
  // contain End are validated strictly rather than silently repaired.
  if (options.migrateLegacyTerminal && !nodes.some((node) => node.type === 'end')) {
    let endId = 'end_legacy';
    let suffix = 2;
    while (seenIds.has(endId)) endId = `end_legacy_${suffix++}`;
    seenIds.add(endId);
    nodes.push({ id: endId, type: 'end', name: 'End', position: undefined, config: {} });

    const usedEdgeIds = new Set(edges.map((edge) => edge.id));
    let migrationEdge = 1;
    const connect = (source: string, sourceHandle: string | null) => {
      let id = `edge_legacy_end_${migrationEdge++}`;
      while (usedEdgeIds.has(id)) id = `edge_legacy_end_${migrationEdge++}`;
      usedEdgeIds.add(id);
      edges.push({ id, source, target: endId, sourceHandle, targetHandle: null });
    };
    const branchHandles = (node: WorkflowNode): string[] | undefined => {
      if (node.type === 'ifElse') {
        return [...((node.config.branches ?? []) as JsonObject[]).map((branch) => String(branch.id)), 'else'];
      }
      if (node.type === 'guardrail') return ['pass', 'fail'];
      if (node.type === 'userApproval') return ['approved', 'rejected'];
      if (node.type === 'while') return ['loop', 'done'];
      return undefined;
    };
    for (const node of nodes) {
      if (node.type === 'end' || node.type === 'note') continue;
      const handles = branchHandles(node);
      if (handles) {
        for (const handle of handles) {
          if (!edges.some((edge) => edge.source === node.id && edge.sourceHandle === handle)) {
            connect(node.id, handle);
          }
        }
      } else if (!edges.some((edge) => edge.source === node.id)) {
        connect(node.id, null);
      }
    }
  }

  // Unique variable names per node.
  const varNames = new Map<string, string>();
  const used = new Set<string>(['workflow', 'state', 'input_as_text']);
  for (const n of nodes) {
    let v = toVarName(n.name);
    if (used.has(v)) {
      let k = 2;
      while (used.has(`${v}_${k}`)) k++;
      v = `${v}_${k}`;
    }
    used.add(v);
    varNames.set(n.id, v);
  }

  return { graph: { nodes, edges }, varNames };
}
