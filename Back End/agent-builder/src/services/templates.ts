/**
 * Built-in workflow starters.
 *
 * Agent Builder opens with templates so users can inspect a working graph
 * before adding their own nodes. Templates are plain React Flow-shaped JSON
 * and are normalized by WorkflowService on creation.
 */

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  categories: string[];
  tags: string[];
  riskLevel: 'low' | 'medium' | 'high';
  verification: {
    cases: Array<{
      name: string;
      input: { input_as_text: string };
      approval?: boolean;
      expectedStatus: 'completed';
      expectedOutputContains: string;
      expectedNodeIds: string[];
    }>;
  };
  graph: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
}

export interface WorkflowTemplateRiskFactor {
  code: 'MODEL_GENERATION' | 'HUMAN_DECISION' | 'SENSITIVE_DATA' | 'KNOWLEDGE_RETRIEVAL' | 'BOUNDED_LOOP' | 'RECOVERY_PATH' | 'EXTERNAL_ACTION';
  level: 'low' | 'medium' | 'high';
  nodeId: string;
  message: string;
}

const riskRank = { low: 0, medium: 1, high: 2 } as const;

/** Explain a catalog risk badge using capabilities that are actually present in the graph. */
export function analyzeTemplateRisk(graph: WorkflowTemplate['graph']): WorkflowTemplateRiskFactor[] {
  const factors: WorkflowTemplateRiskFactor[] = [];
  for (const node of graph.nodes) {
    const id = String(node.id ?? 'unknown');
    const type = String(node.type ?? '');
    const config = ((node.config ?? (node.data as Record<string, unknown> | undefined)?.config ?? {}) as Record<string, unknown>);
    if (type === 'mcp') factors.push({ code: 'EXTERNAL_ACTION', level: 'high', nodeId: id, message: 'Invokes an external MCP tool that can affect another system.' });
    else if (type === 'userApproval') factors.push({ code: 'HUMAN_DECISION', level: 'medium', nodeId: id, message: 'Pauses execution for a human decision before continuing.' });
    else if (type === 'guardrail' && config.pii === true) factors.push({ code: 'SENSITIVE_DATA', level: 'medium', nodeId: id, message: 'Inspects input for personally identifiable information.' });
    else if (type === 'agent' && (config.onError === 'branch' || (node.data as Record<string, unknown> | undefined)?.onError === 'branch')) factors.push({ code: 'RECOVERY_PATH', level: 'medium', nodeId: id, message: 'Uses a recoverable failure branch whose fallback behavior should be reviewed.' });
    else if (type === 'fileSearch') factors.push({ code: 'KNOWLEDGE_RETRIEVAL', level: 'low', nodeId: id, message: 'Retrieves context from a configured knowledge store.' });
    else if (type === 'while') factors.push({ code: 'BOUNDED_LOOP', level: 'low', nodeId: id, message: 'Repeats work within a configured iteration bound.' });
    else if (type === 'agent') factors.push({ code: 'MODEL_GENERATION', level: 'low', nodeId: id, message: 'Generates model output without a direct external action.' });
  }
  return factors.sort((left, right) => riskRank[right.level] - riskRank[left.level]);
}

export function templateRiskLevel(graph: WorkflowTemplate['graph']): WorkflowTemplate['riskLevel'] {
  return analyzeTemplateRisk(graph)[0]?.level ?? 'low';
}

const agent = (id: string, label: string, x: number, instructions: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'agent',
  position: { x, y: 160 },
  data: {
    label,
    instructions,
    model: 'mock/echo',
    includeChatHistory: false,
    writeToConversationHistory: false,
    outputFormat: 'text',
    continueOnError: false,
    // Built-in starters should be deployable with production token budgets
    // without requiring users to discover three hidden finite-bound fields.
    modelParams: { maxTokens: 1024 },
    maxTurns: 4,
    maxInputTokensPerCall: 4096,
    tools: [],
    ...extra,
  },
});

const start = { id: 'start', type: 'start', position: { x: 40, y: 160 }, data: { label: 'Start' } };
const end = (id: string, label: string, x: number, output: string) => ({
  id,
  type: 'end',
  position: { x, y: 160 },
  data: { label, config: { output } },
});

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'single-agent',
    name: 'Single agent',
    description: 'A minimal Start to Agent to End workflow for a first run.',
    categories: ['Core'],
    tags: ['starter', 'chat'],
    riskLevel: 'low',
    verification: { cases: [{ name: 'Echo response', input: { input_as_text: 'template single path' }, expectedStatus: 'completed', expectedOutputContains: 'template single path', expectedNodeIds: ['start', 'agent', 'end'] }] },
    graph: {
      nodes: [
        start,
        agent('agent', 'Answer', 300, 'Answer the user clearly and concisely. Use the user message as the task.'),
        end('end', 'End', 560, '{{answer.output_text}}'),
      ],
      edges: [
        { id: 'start-agent', source: 'start', target: 'agent' },
        { id: 'agent-end', source: 'agent', target: 'end' },
      ],
    },
  },
  {
    id: 'router',
    name: 'Router and specialists',
    description: 'Classify a request, route it with If / else, then answer with a focused agent.',
    categories: ['Core', 'Logic'],
    tags: ['routing', 'structured-output'],
    riskLevel: 'low',
    verification: { cases: [{ name: 'Question branch', input: { input_as_text: 'template router question' }, expectedStatus: 'completed', expectedOutputContains: 'template router question', expectedNodeIds: ['start', 'classifier', 'router', 'question', 'question-end'] }] },
    graph: {
      nodes: [
        start,
        agent(
          'classifier',
          'Classify request',
          300,
          'Classify the request as either question or fact. Return JSON with a category field.',
          {
            model: 'mock/json',
            outputFormat: 'json',
            outputSchemaName: 'classification',
            outputSchema: {
              type: 'object',
              properties: { category: { type: 'string', enum: ['question', 'fact'] } },
              required: ['category'],
              additionalProperties: false,
            },
          },
        ),
        {
          id: 'router',
          type: 'ifElse',
          position: { x: 560, y: 160 },
          data: {
            label: 'Route',
            config: {
              branches: [
                { id: 'question', label: 'Question', condition: 'classify_request.output_parsed.category == "question"' },
              ],
            },
          },
        },
        agent('question', 'Question specialist', 820, 'Answer the question directly with a helpful explanation.'),
        agent('fact', 'Fact specialist', 820, 'Find the relevant facts in the request and respond with a concise factual answer.'),
        end('question-end', 'Question answer', 1080, '{{question_specialist.output_text}}'),
        end('fact-end', 'Fact answer', 1080, '{{fact_specialist.output_text}}'),
      ],
      edges: [
        { id: 'start-classifier', source: 'start', target: 'classifier' },
        { id: 'classifier-router', source: 'classifier', target: 'router' },
        { id: 'router-question', source: 'router', sourceHandle: 'question', target: 'question' },
        { id: 'router-fact', source: 'router', sourceHandle: 'else', target: 'fact' },
        { id: 'question-end', source: 'question', target: 'question-end' },
        { id: 'fact-end', source: 'fact', target: 'fact-end' },
      ],
    },
  },
  {
    id: 'human-review',
    name: 'Human review',
    description: 'Draft a response, pause for approval, and route approved or rejected work.',
    categories: ['Core', 'Logic'],
    tags: ['approval', 'human-in-the-loop'],
    riskLevel: 'medium',
    verification: {
      cases: [
        { name: 'Approved draft', input: { input_as_text: 'template approved draft' }, approval: true, expectedStatus: 'completed', expectedOutputContains: 'template approved draft', expectedNodeIds: ['start', 'draft', 'approval', 'approved'] },
        { name: 'Rejected draft', input: { input_as_text: 'template rejected draft' }, approval: false, expectedStatus: 'completed', expectedOutputContains: 'rejected', expectedNodeIds: ['start', 'draft', 'approval', 'rejected'] },
      ],
    },
    graph: {
      nodes: [
        start,
        agent('draft', 'Draft response', 300, 'Draft a response to the user. Do not send or publish anything.'),
        {
          id: 'approval',
          type: 'userApproval',
          position: { x: 560, y: 160 },
          data: { label: 'Human review', config: { message: 'Approve this draft? {{draft_response.output_text}}' } },
        },
        end('approved', 'Approved', 820, '{{draft_response.output_text}}'),
        end('rejected', 'Rejected', 820, 'The draft was rejected and was not sent.'),
      ],
      edges: [
        { id: 'start-draft', source: 'start', target: 'draft' },
        { id: 'draft-approval', source: 'draft', target: 'approval' },
        { id: 'approval-approved', source: 'approval', sourceHandle: 'approved', target: 'approved' },
        { id: 'approval-rejected', source: 'approval', sourceHandle: 'rejected', target: 'rejected' },
      ],
    },
  },
  {
    id: 'guarded-support-triage', name: 'Guarded support triage',
    description: 'Screen an inbound support request, classify urgency, and route to a safe response.',
    categories: ['Support', 'Safety'], tags: ['guardrails', 'triage', 'routing'], riskLevel: 'medium',
    verification: { cases: [{ name: 'Safe support request', input: { input_as_text: 'template support request' }, expectedStatus: 'completed', expectedOutputContains: 'template support request', expectedNodeIds: ['start', 'guard', 'triage', 'safe-end'] }] },
    graph: { nodes: [
      { id: 'start', type: 'start', position: { x: 40, y: 160 }, config: { inputVariables: [{ name: 'customer_tier', type: 'string', defaultValue: 'standard' }], stateVariables: [] } },
      { id: 'guard', type: 'guardrail', position: { x: 280, y: 160 }, config: { pii: true, moderation: false, jailbreak: false, hallucination: false, onTripwire: 'branch' } },
      agent('triage', 'Triage', 520, 'Classify urgency and answer safely. Return concise support guidance.'),
      end('safe-end', 'Support response', 780, '{{triage.output_text}}'), end('blocked-end', 'Escalated safely', 520, 'This request requires secure human review.'),
    ], edges: [
      { id: 'sg', source: 'start', target: 'guard' }, { id: 'gt', source: 'guard', sourceHandle: 'pass', target: 'triage' },
      { id: 'gb', source: 'guard', sourceHandle: 'fail', target: 'blocked-end' }, { id: 'te', source: 'triage', target: 'safe-end' },
    ] },
  },
  {
    id: 'retrieval-qa', name: 'Retrieval Q&A', description: 'Retrieve grounded context from a configured vector store, then answer with citations.',
    categories: ['Knowledge', 'RAG'], tags: ['file-search', 'grounding', 'citations'], riskLevel: 'low',
    verification: { cases: [{ name: 'Grounded retrieval path', input: { input_as_text: 'template knowledge question' }, expectedStatus: 'completed', expectedOutputContains: 'knowledge.txt', expectedNodeIds: ['start', 'search', 'answer', 'answer-end'] }] },
    graph: { nodes: [start,
      { id: 'search', type: 'fileSearch', position: { x: 300, y: 160 }, config: { vectorStoreIds: ['vs_configure_me'], query: '{{workflow.input_as_text}}', maxResults: 5, scoreThreshold: 0, onError: 'branch' } },
      agent('answer', 'Grounded answer', 560, 'Answer only from the retrieved context. Cite supporting sources by filename and chunk index. State when the context is insufficient.', { userMessage: 'Question: {{workflow.input_as_text}}\nRetrieved sources: {{file_search.results}}' }),
      end('answer-end', 'Answer', 820, '{{grounded_answer.output_text}}'), end('search-error', 'Retrieval unavailable', 560, 'Knowledge retrieval is unavailable. Configure a vector store and retry.'),
    ], edges: [{ id: 'ss', source: 'start', target: 'search' }, { id: 'sa', source: 'search', target: 'answer' }, { id: 'se', source: 'search', sourceHandle: 'error', target: 'search-error' }, { id: 'ae', source: 'answer', target: 'answer-end' }] },
  },
  {
    id: 'structured-extraction-router', name: 'Structured extraction router', description: 'Extract a typed request record and route it to the correct handler.',
    categories: ['Automation', 'Logic'], tags: ['extraction', 'json-schema', 'routing'], riskLevel: 'low',
    verification: { cases: [{ name: 'Structured route', input: { input_as_text: 'template structured request' }, expectedStatus: 'completed', expectedOutputContains: '"department":"sales"', expectedNodeIds: ['start', 'extract', 'route', 'sales-end'] }] },
    graph: { nodes: [start, agent('extract', 'Extract request', 300, 'Extract department and summary.', { model: 'mock/json', outputFormat: 'json', outputSchemaName: 'request', outputSchema: { type: 'object', properties: { department: { type: 'string', enum: ['sales', 'support'] }, summary: { type: 'string' } }, required: ['department', 'summary'], additionalProperties: false } }),
      { id: 'route', type: 'ifElse', position: { x: 560, y: 160 }, config: { branches: [{ id: 'sales', label: 'Sales', condition: 'extract_request.output_parsed.department == "sales"' }] } },
      end('sales-end', 'Sales record', 820, '{{extract_request.output_parsed}}'), end('support-end', 'Support record', 820, '{{extract_request.output_parsed}}')],
      edges: [{ id: 'se', source: 'start', target: 'extract' }, { id: 'er', source: 'extract', target: 'route' }, { id: 'rs', source: 'route', sourceHandle: 'sales', target: 'sales-end' }, { id: 'ro', source: 'route', sourceHandle: 'else', target: 'support-end' }] },
  },
  {
    id: 'approved-mcp-action', name: 'Human-approved MCP action', description: 'Prepare an external action, require human approval, then invoke an MCP tool.',
    categories: ['Automation', 'Human review'], tags: ['mcp', 'approval', 'external-action'], riskLevel: 'high',
    verification: { cases: [{ name: 'Rejected external action', input: { input_as_text: 'template external action' }, approval: false, expectedStatus: 'completed', expectedOutputContains: 'not approved', expectedNodeIds: ['start', 'prepare', 'approval', 'rejected'] }] },
    graph: { nodes: [start, agent('prepare', 'Prepare action', 300, 'Describe the proposed external action without executing it. Return only the structured action record.', {
      model: 'mock/json',
      outputFormat: 'json',
      outputSchemaName: 'proposed_action',
      outputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'], additionalProperties: false },
    }),
      { id: 'approval', type: 'userApproval', position: { x: 560, y: 160 }, config: { message: 'Approve external action? {{prepare_action.output_text}}' } },
      { id: 'action-guard', type: 'guardrail', position: { x: 800, y: 40 }, config: { pii: true, moderation: false, jailbreak: false, hallucination: false, onTripwire: 'branch' } },
      { id: 'action', type: 'mcp', position: { x: 1040, y: 100 }, config: { serverId: 'configure_mcp_server', tool: 'configure_tool', arguments: { input: '{{prepare_action.output_parsed.action}}' }, requireApproval: 'always', onError: 'branch' } },
      end('done', 'Action result', 1080, '{{action.output_text}}'), end('rejected', 'Not executed', 820, 'The external action was not approved.'), end('failed', 'Action failed', 1080, 'The approved external action failed safely.')],
      edges: [{ id: 'sp', source: 'start', target: 'prepare' }, { id: 'pa', source: 'prepare', target: 'approval' }, { id: 'ag', source: 'approval', sourceHandle: 'approved', target: 'action-guard' }, { id: 'gp', source: 'action-guard', sourceHandle: 'pass', target: 'action' }, { id: 'gf', source: 'action-guard', sourceHandle: 'fail', target: 'failed' }, { id: 'ar', source: 'approval', sourceHandle: 'rejected', target: 'rejected' }, { id: 'ad', source: 'action', target: 'done' }, { id: 'af', source: 'action', sourceHandle: 'error', target: 'failed' }] },
  },
  {
    id: 'iterative-refinement', name: 'Iterative refinement', description: 'Refine a draft through a bounded loop using typed workflow state.',
    categories: ['Logic', 'Writing'], tags: ['while', 'state', 'iteration'], riskLevel: 'low',
    verification: { cases: [{ name: 'Two refinement passes', input: { input_as_text: 'template refine draft' }, expectedStatus: 'completed', expectedOutputContains: 'template refine draft', expectedNodeIds: ['start', 'loop', 'refine', 'save', 'end'] }] },
    graph: { nodes: [
      { id: 'start', type: 'start', position: { x: 40, y: 160 }, config: { inputVariables: [], stateVariables: [{ name: 'iteration', type: 'number', initialValue: 0 }, { name: 'draft', type: 'string', initialValue: '' }] } },
      { id: 'loop', type: 'while', position: { x: 300, y: 160 }, config: { condition: 'state.iteration < 2', maxIterations: 3, onMaxIterations: 'break' } },
      agent('refine', 'Refine draft', 560, 'Improve the current draft for clarity.', { userMessage: 'Input: {{workflow.input_as_text}}\nCurrent: {{state.draft}}' }),
      { id: 'save', type: 'setState', position: { x: 820, y: 160 }, config: { assignments: [{ name: 'draft', expression: 'refine_draft.output_text' }, { name: 'iteration', expression: 'state.iteration + 1' }] } },
      end('end', 'Refined result', 560, '{{state.draft}}')],
      edges: [{ id: 'sl', source: 'start', target: 'loop' }, { id: 'lr', source: 'loop', sourceHandle: 'loop', target: 'refine' }, { id: 'rs', source: 'refine', target: 'save' }, { id: 'sb', source: 'save', target: 'loop' }, { id: 'le', source: 'loop', sourceHandle: 'done', target: 'end' }] },
  },
  {
    id: 'resilient-tool-fallback', name: 'Resilient tool fallback', description: 'Branch recoverably when a primary tool-backed agent fails.',
    categories: ['Reliability', 'Automation'], tags: ['error-branch', 'fallback', 'resilience'], riskLevel: 'medium',
    verification: { cases: [{ name: 'Primary failure fallback', input: { input_as_text: 'template fallback request' }, expectedStatus: 'completed', expectedOutputContains: 'template fallback request', expectedNodeIds: ['start', 'primary', 'fallback', 'fallback-end'] }] },
    graph: { nodes: [start, agent('primary', 'Primary tool path', 300, 'Use the primary integration.', { model: 'mock/fail', onError: 'branch' }), agent('fallback', 'Fallback answer', 560, 'Provide a safe fallback answer without external tools.'), end('success', 'Primary result', 560, '{{primary_tool_path.output_text}}'), end('fallback-end', 'Fallback result', 820, '{{fallback_answer.output_text}}')],
      edges: [{ id: 'sp', source: 'start', target: 'primary' }, { id: 'ps', source: 'primary', target: 'success' }, { id: 'pf', source: 'primary', sourceHandle: 'error', target: 'fallback' }, { id: 'fe', source: 'fallback', target: 'fallback-end' }] },
  },
];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}
