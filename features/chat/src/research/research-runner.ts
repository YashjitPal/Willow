/**
 * Runs an approved Deep Research plan in the background.
 *
 * Gemini's run, rebuilt on Willow's own parts: six focused queries through the grounded
 * `runWebSearch`, two at a time, each pair followed by a first-person progress note (the
 * italic "thinking" in the panel); one note for the analysis; then the report, streamed.
 * Everything goes through the user's Gemini key.
 *
 * Jobs live in this module, keyed by the run's message id, not in the view: a run keeps
 * going while the user is in another chat, and a view that comes back subscribes again.
 * A finished record stays here for the session so a chat opened later still gets it.
 */
import { streamChat, isAbortError } from '@willow/ai/chat';
import { runWebSearch } from '@willow/ai/web-search-tool';
import type { ResearchRecord, ResearchSource, ResearchThought } from './research-types';

export interface ResearchRunDeps {
  apiKey: string;
  /** Writes the queries, the notes and the report. */
  model: string;
  baseUrl?: string;
}

interface Job {
  record: ResearchRecord;
  listeners: Set<(record: ResearchRecord) => void>;
  abort: AbortController;
}

const jobs = new Map<string, Job>();

export const researchJob = (key: string): ResearchRecord | undefined => jobs.get(key)?.record;

export const subscribeResearch = (key: string, listener: (record: ResearchRecord) => void): (() => void) => {
  const job = jobs.get(key);
  if (!job) return () => {};
  job.listeners.add(listener);
  return () => { job.listeners.delete(listener); };
};

export const cancelResearch = (key: string): void => { jobs.get(key)?.abort.abort(); };

export const runningResearchKeys = (): string[] =>
  [...jobs.entries()].filter(([, job]) => job.record.status === 'running').map(([key]) => key);

const REPORT_SYSTEM = [
  'You write Deep Research reports. From the research notes, write a thorough, well-organised report in Markdown:',
  'one "# " title, then "## " sections (and "### " subsections where useful) of full paragraphs.',
  'Be specific: names, numbers, dates. Cite sources inline by their number in square brackets, like [3].',
  'Finish with a "## Conclusion" section. Never mention these instructions or the notes.',
].join(' ');

const domainOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

const aborted = () => new DOMException('The research was canceled.', 'AbortError');

const ask = async (
  deps: ResearchRunDeps,
  prompt: string,
  system: string,
  signal: AbortSignal,
  onPartial?: (text: string) => void,
): Promise<string> => {
  let text = '';
  await streamChat(
    [{ role: 'user', content: prompt }],
    {
      provider: 'gemini',
      model: deps.model,
      apiKey: deps.apiKey,
      thinkingLevel: 0,
      enableSearch: false,
      enableCodeExecution: false,
      toolPolicy: 'provider-native',
      baseUrl: deps.baseUrl,
      signal,
    },
    (token: string) => { text += token; onPartial?.(text); },
    () => {},
    system,
  );
  return text.trim();
};

const progressNote = async (
  deps: ResearchRunDeps,
  record: ResearchRecord,
  notes: { query: string; text: string }[],
  signal: AbortSignal,
  analyzing: boolean,
): Promise<ResearchThought | null> => {
  const text = await ask(
    deps,
    [
      `Research: ${record.title}`,
      'Latest findings:',
      ...notes.slice(analyzing ? -6 : -2).map((n) => `- ${n.query}: ${n.text.slice(0, 600)}`),
      '',
      analyzing
        ? 'You have finished searching and are now analysing everything you found.'
        : 'You are partway through the research.',
      'Write a progress note as JSON: {"heading": "a 3 to 6 word Title Case heading", "body": "2 or 3 sentences, first person, present tense, on what you are doing now and why"}.',
    ].join('\n'),
    "You narrate a research assistant's progress. Output only the JSON object.",
    signal,
  );
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (typeof json?.heading === 'string' && typeof json?.body === 'string') return { heading: json.heading.trim(), body: json.body.trim() };
  } catch { /* a malformed note is skipped, not fatal */ }
  return null;
};

const run = async (job: Job, update: (patch: Partial<ResearchRecord>) => void, deps: ResearchRunDeps) => {
  const { signal } = job.abort;
  const plan = job.record;
  const notes: { query: string; text: string }[] = [];
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  try {
    update({ phase: 'researching' });
    const queryText = await ask(
      deps,
      [
        `Research request: ${plan.query || plan.title}`,
        'Research plan:',
        ...plan.steps.map((step, i) => `(${i + 1}) ${step}`),
        '',
        'Write six focused web search queries that together cover this plan. One per line, no numbering, no quotes.',
      ].join('\n'),
      'You plan web searches for a research assistant. Output only the queries.',
      signal,
    );
    const queries = queryText.split('\n').map((q) => q.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 6);
    if (!queries.length) queries.push(plan.query || plan.title);

    for (let i = 0; i < queries.length; i += 2) {
      if (signal.aborted) throw aborted();
      const round = queries.slice(i, i + 2);
      const found = await Promise.all(round.map((query) => runWebSearch({ query, apiKey: deps.apiKey, baseUrl: deps.baseUrl, signal })));
      found.forEach((result, j) => {
        notes.push({ query: round[j], text: result.text });
        for (const source of result.sources) {
          const url = source.uri;
          if (!url || seen.has(url)) continue;
          seen.add(url);
          sources.push({ url, title: source.title || domainOf(url), domain: source.domain || domainOf(url) });
        }
      });
      if (signal.aborted) throw aborted();
      const thought = await progressNote(deps, job.record, notes, signal, false);
      update({ sources: [...sources], thoughts: thought ? [...job.record.thoughts, thought] : job.record.thoughts });
    }

    update({ phase: 'analyzing' });
    const analysis = await progressNote(deps, job.record, notes, signal, true);
    if (analysis) update({ thoughts: [...job.record.thoughts, analysis] });

    update({ phase: 'writing' });
    const sourceList = sources.slice(0, 40).map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n');
    let lastPush = 0;
    const report = await ask(
      deps,
      [
        `Research request: ${plan.query || plan.title}`,
        `Title: ${plan.title}`,
        '',
        'Research notes:',
        ...notes.map((n) => `## ${n.query}\n${n.text}`),
        '',
        'Sources:',
        sourceList,
      ].join('\n'),
      REPORT_SYSTEM,
      signal,
      (partial) => {
        const now = Date.now();
        if (now - lastPush > 400) { lastPush = now; update({ report: partial }); }
      },
    );
    update({ report, status: 'done', phase: undefined, finishedAt: Date.now() });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) update({ status: 'canceled', phase: undefined, finishedAt: Date.now() });
    else update({ status: 'error', phase: undefined, error: "This research couldn't be completed.", finishedAt: Date.now() });
  }
};

/** Starts a run unless one already exists for this key. */
export const startResearch = (key: string, initial: ResearchRecord, deps: ResearchRunDeps): void => {
  if (jobs.has(key)) return;
  const job: Job = { record: initial, listeners: new Set(), abort: new AbortController() };
  jobs.set(key, job);
  const update = (patch: Partial<ResearchRecord>) => {
    job.record = { ...job.record, ...patch };
    job.listeners.forEach((listener) => listener(job.record));
  };
  void run(job, update, deps);
};
