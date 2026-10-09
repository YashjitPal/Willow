/**
 * The Deep Research tool the model is given on a turn sent with the "Deep research" chip.
 *
 * It does not research — it proposes. `create_research_plan` publishes the plan card; the
 * research itself starts only when the user presses Start research (see `research-runner`),
 * which is Gemini's flow: plan, confirm, run.
 */
import { RESEARCH_PLAN_REPLY, type ResearchRecord } from './research-types';

export const CREATE_RESEARCH_PLAN = 'create_research_plan';

export const isResearchToolCall = (name: string): boolean => name === CREATE_RESEARCH_PLAN;

export const researchChatTools = (enabled: boolean): { functionDeclarations: any[] }[] => (enabled ? [{
  functionDeclarations: [{
    name: CREATE_RESEARCH_PLAN,
    description: 'Propose a Deep Research plan for the user to approve. The research runs only after they press Start research.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'A short title for the research, at most six words, in Title Case.' },
        steps: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Three to eight concrete research steps, each one full sentence starting with a verb (Find, Investigate, Compare, Identify, Research…).',
        },
      },
      required: ['title', 'steps'],
    },
  }],
}] : []);

export const researchInstructions = (enabled: boolean): string => (enabled ? `
The user turned on "Deep research" for this message. Do not answer the question yourself and do not search. Instead call ${CREATE_RESEARCH_PLAN} with a plan for researching it: a short title and three to eight concrete research steps.
After the call, reply with exactly this sentence and nothing else: ${RESEARCH_PLAN_REPLY}
If the user asks to change an earlier plan, call ${CREATE_RESEARCH_PLAN} again with the revised plan and reply with the same sentence.
`.trim() : '');

export interface ResearchToolHost {
  publish: (record: ResearchRecord) => void;
  newId?: () => string;
  /** The user's request, for the record. */
  query: string;
}

export const createResearchToolExecutor = (host: ResearchToolHost) => async (name: string, args: any) => {
  if (name !== CREATE_RESEARCH_PLAN) return { status: 'error', error: `Unknown tool ${name}.` };
  const title = typeof args?.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 120) : 'Research';
  const steps = Array.isArray(args?.steps)
    ? args.steps.filter((s: unknown): s is string => typeof s === 'string' && !!s.trim()).map((s: string) => s.trim()).slice(0, 8)
    : [];
  if (!steps.length) return { status: 'error', error: 'The plan needs at least one step. Call again with a `steps` array.' };
  host.publish({
    id: host.newId?.() ?? `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    query: host.query,
    steps,
    status: 'plan',
    thoughts: [],
    sources: [],
  });
  return { status: 'ok', result: `The plan card is showing. Reply with exactly: ${RESEARCH_PLAN_REPLY}` };
};
