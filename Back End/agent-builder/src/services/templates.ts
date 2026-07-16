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
  graph: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
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
    graph: {
      nodes: [
        start,
        agent(
          'classifier',
          'Classify request',
          300,
          'Classify the request as either question or fact. Return JSON with a category field.',
          {
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
                { id: 'question', label: 'Question', condition: 'classifier.output_parsed.category == "question"' },
              ],
            },
          },
        },
        agent('question', 'Question specialist', 820, 'Answer the question directly with a helpful explanation.'),
        agent('fact', 'Fact specialist', 820, 'Find the relevant facts in the request and respond with a concise factual answer.'),
        end('question-end', 'Question answer', 1080, '{{question.output_text}}'),
        end('fact-end', 'Fact answer', 1080, '{{fact.output_text}}'),
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
    graph: {
      nodes: [
        start,
        agent('draft', 'Draft response', 300, 'Draft a response to the user. Do not send or publish anything.'),
        {
          id: 'approval',
          type: 'userApproval',
          position: { x: 560, y: 160 },
          data: { label: 'Human review', config: { message: 'Approve this draft? {{draft.output_text}}' } },
        },
        end('approved', 'Approved', 820, '{{draft.output_text}}'),
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
];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}
