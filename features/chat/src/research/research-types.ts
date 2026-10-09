/**
 * Deep Research, as a record carried on assistant messages.
 *
 * Two messages hold one: the plan ("Here's a research plan for that topic…") with its plan
 * card, and — once the user presses Start research — the run ("I'm on it…") with its
 * progress card and the panel's thinking, sources and report.
 */
export type ResearchStatus = 'planning' | 'plan' | 'running' | 'done' | 'canceled' | 'error';
export type ResearchPhase = 'starting' | 'researching' | 'analyzing' | 'writing';

export interface ResearchSource {
  url: string;
  title: string;
  domain: string;
}

export interface ResearchThought {
  heading: string;
  body: string;
}

export interface ResearchRecord {
  id: string;
  title: string;
  /** What the user asked for, in their words. */
  query: string;
  /** The "Research Websites" items, one sentence each. */
  steps: string[];
  status: ResearchStatus;
  /** Set on the plan once Start research has been pressed: its buttons are spent. */
  started?: boolean;
  phase?: ResearchPhase;
  thoughts: ResearchThought[];
  sources: ResearchSource[];
  /** The finished report, Markdown. */
  report?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export const RESEARCH_PLAN_REPLY = "Here's a research plan for that topic. If you need to update it, let me know!";
export const RESEARCH_STARTED_REPLY = "I'm on it. I'll let you know when your research is done. In the meantime, you can leave this chat.";
export const RESEARCH_DONE_REPLY = "I've completed your research. Feel free to ask me follow-up questions or request changes.";

/** The progress card's second line. */
export const researchStatusLine = (record: ResearchRecord): string => {
  if (record.status === 'done') {
    return new Date(record.finishedAt ?? Date.now()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (record.status === 'canceled') return 'Research canceled';
  if (record.status === 'error') return record.error || "This research didn't finish.";
  if (record.phase === 'writing') return 'Creating your report...';
  if (record.phase === 'analyzing') return 'Analyzing results...';
  if (record.phase === 'researching') return 'Researching websites...';
  return 'Starting research...';
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A record read back from disk. A run that was still going when it was saved has no job
 * behind it any more (the page was reloaded), so it comes back as interrupted — the caller
 * swaps in the live record when one is still running in this session.
 */
export const sanitizeSavedResearch = (value: unknown): ResearchRecord | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const statuses: ResearchStatus[] = ['planning', 'plan', 'running', 'done', 'canceled', 'error'];
  let status = statuses.includes(raw.status as ResearchStatus) ? raw.status as ResearchStatus : 'error';
  if (status === 'planning') return undefined;
  let error = str(raw.error) || undefined;
  if (status === 'running') {
    status = 'error';
    error = "This research was interrupted before it finished.";
  }
  return {
    id: str(raw.id) || `research_${Date.now().toString(36)}`,
    title: str(raw.title) || 'Research',
    query: str(raw.query),
    steps: Array.isArray(raw.steps) ? raw.steps.filter((s): s is string => typeof s === 'string') : [],
    status,
    started: raw.started === true || undefined,
    phase: (['starting', 'researching', 'analyzing', 'writing'] as const).find((p) => p === raw.phase),
    thoughts: Array.isArray(raw.thoughts)
      ? raw.thoughts.filter((t): t is ResearchThought => !!t && typeof (t as ResearchThought).heading === 'string' && typeof (t as ResearchThought).body === 'string')
      : [],
    sources: Array.isArray(raw.sources)
      ? raw.sources.filter((s): s is ResearchSource => !!s && typeof (s as ResearchSource).url === 'string').map((s) => ({ url: s.url, title: str(s.title), domain: str(s.domain) }))
      : [],
    report: str(raw.report) || undefined,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined,
    finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : undefined,
    error,
  };
};
