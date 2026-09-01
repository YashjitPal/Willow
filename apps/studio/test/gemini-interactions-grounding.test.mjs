/**
 * Grounding on the Interactions transport, executed against a scripted stream.
 *
 * The regression this file exists for was reported as "Willow used to show the
 * search pill every time the model used search… it used to show which paragraph
 * used which website, but now it's not showing that". Nothing had been removed:
 * the transport changed shape underneath the reader.
 *
 * Measured on gemini-3.7-flash by teeing a live stream:
 *
 *  - `google_search_result` now carries `result: [{ search_suggestions: '<style>…' }]`
 *    and NO urls at all. The old reader wanted `result[].url`, so it found nothing
 *    and `onCitations` never fired — no sources, therefore no pill.
 *  - the grounding arrives as `text_annotation_delta`:
 *    `{ annotations: [{ start_index, end_index, url, title, type: 'url_citation' }] }`
 *    — which is both halves at once, the sources AND the spans. That event was not
 *    read at all, and `citations: []` was hardcoded at the emit, so even a turn that
 *    did produce sources could never produce an inline chip.
 *
 * The event bodies below are copied from that capture, redirect URLs and all.
 */
import { it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './ts-module.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const { streamChat } = await importTs(path.join(repoRoot, 'platform', 'ai', 'src', 'chat.ts'));

const sse = (events) => events
  .map((event) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('');

/** 11 bytes at a time: a frame and a JSON fragment both split mid-token. */
const streamOf = (text) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (offset >= bytes.length) return { value: undefined, done: true };
        const value = bytes.slice(offset, offset + 11);
        offset += 11;
        return { value, done: false };
      },
    }),
  };
};

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';
const YT = `${REDIRECT}AUZIYQFmQXXyqrdluVGsKTjZZggyFpVzkhkXaNg7`;
const BMJ = `${REDIRECT}AUZIYQFBScbPkihiHT-zJDaabAWpTRfs-yM7E21FHaU`;

/** "Nepal floods. " + "Malaria case. " = 14 + 14 characters. */
const FIRST = 'Nepal floods. ';
const SECOND = 'Malaria case. ';

const ROUND = [
  { event_type: 'interaction.created', interaction: { id: 'int_1', status: 'in_progress' } },
  { event_type: 'step.start', index: 0, step: { id: 'call_1', type: 'google_search_call' } },
  { event_type: 'step.delta', index: 0, delta: { type: 'google_search_call', arguments: { queries: ['bbc news top story'] } } },
  { event_type: 'step.start', index: 1, step: { call_id: 'call_1', type: 'google_search_result' } },
  /* The shape that broke it: suggestions HTML, no urls. */
  { event_type: 'step.delta', index: 1, delta: { type: 'google_search_result', is_error: false, result: [{ search_suggestions: '<style>.chip{}</style>' }] } },
  { event_type: 'step.start', index: 2, step: { type: 'model_output' } },
  { event_type: 'step.delta', index: 2, delta: { type: 'text', text: FIRST } },
  { event_type: 'step.delta', index: 2, delta: { type: 'text', text: SECOND } },
  {
    event_type: 'step.delta',
    index: 3,
    delta: {
      type: 'text_annotation_delta',
      annotations: [
        { start_index: 0, end_index: 13, url: YT, title: 'youtube.com', type: 'url_citation' },
        /* The same page citing the same sentence twice, with a wider range — the
           live capture had four of these for two sources. */
        { start_index: 0, end_index: 13, url: YT, title: 'youtube.com', type: 'url_citation' },
        { start_index: 14, end_index: 27, url: BMJ, title: 'bmj.com', type: 'url_citation' },
      ],
    },
  },
  { event_type: 'interaction.completed', interaction: { id: 'int_1', status: 'completed' } },
];

const runTurn = async (events) => {
  const original = globalThis.fetch;
  let text = '';
  let citations = null;
  globalThis.fetch = async () => ({ ok: true, status: 200, body: streamOf(sse(events)) });
  try {
    await streamChat(
      [{ role: 'user', content: 'what is the top story on bbc news' }],
      {
        provider: 'gemini',
        model: 'gemini-3.7-flash',
        apiKey: 'test-key',
        thinkingLevel: 1,
        includeThoughts: true,
        enableSearch: true,
        enableCodeExecution: true,
        toolPolicy: 'provider-native',
      },
      (token) => { text += token; },
      () => {},
      'system prompt',
      () => {},
      async () => ({ status: 'ok' }),
      () => {},
      (value) => { citations = value; },
    );
  } finally {
    globalThis.fetch = original;
  }
  return { text, citations };
};

it('reads the sources out of the annotations, since the results no longer carry any', async () => {
  const { citations } = await runTurn(ROUND);
  assert.ok(citations, 'no citations at all is the reported bug: no pill, no chips');
  assert.equal(citations.sources.length, 2, 'one entry per page, however many sentences cite it');
  assert.deepEqual(citations.sources.map((source) => source.title), ['youtube.com', 'bmj.com']);
});

/*
 * The redirect host is the redirector, not the publisher. Labelling a chip with it
 * would put `vertexaisearch.cloud.google.com` on every source in the thread.
 */
it('labels each source with the publisher, not the grounding redirector', async () => {
  const { citations } = await runTurn(ROUND);
  assert.deepEqual(citations.sources.map((source) => source.domain), ['youtube.com', 'bmj.com']);
  assert.ok(citations.sources.every((source) => source.uri.startsWith(REDIRECT)), 'the uri is still the redirect that resolves');
});

it('keeps the spans, which is what puts a chip on a sentence', async () => {
  const { citations, text } = await runTurn(ROUND);
  assert.equal(citations.citations.length, 2, 'a duplicate range is one chip, not two');
  assert.deepEqual(citations.citations[0], { startIndex: 0, endIndex: 13, sourceIndices: [0] });
  assert.deepEqual(citations.citations[1], { startIndex: 14, endIndex: 27, sourceIndices: [1] });
  assert.equal(text.slice(0, 13), 'Nepal floods.', 'and the offsets index the answer as streamed');
});

it('merges two pages citing one sentence into a single chip', async () => {
  const shared = ROUND.map((event) => (event.delta?.type === 'text_annotation_delta'
    ? {
      ...event,
      delta: {
        type: 'text_annotation_delta',
        annotations: [
          { start_index: 0, end_index: 13, url: YT, title: 'youtube.com', type: 'url_citation' },
          { start_index: 0, end_index: 13, url: BMJ, title: 'bmj.com', type: 'url_citation' },
        ],
      },
    }
    : event));
  const { citations } = await runTurn(shared);
  assert.equal(citations.citations.length, 1);
  assert.deepEqual(citations.citations[0].sourceIndices, [0, 1]);
});

it('clamps an annotation that reaches past the answer', async () => {
  const overrun = ROUND.map((event) => (event.delta?.type === 'text_annotation_delta'
    ? {
      ...event,
      delta: {
        type: 'text_annotation_delta',
        annotations: [{ start_index: 0, end_index: 9999, url: YT, title: 'youtube.com', type: 'url_citation' }],
      },
    }
    : event));
  const { citations, text } = await runTurn(overrun);
  assert.equal(citations.citations[0].endIndex, text.length, 'a chip cannot end past the text it is indexed against');
});

it('ignores an annotation type it cannot read rather than guessing a chip', async () => {
  const unknown = ROUND.map((event) => (event.delta?.type === 'text_annotation_delta'
    ? {
      ...event,
      delta: {
        type: 'text_annotation_delta',
        annotations: [
          { start_index: 0, end_index: 13, url: YT, title: 'youtube.com', type: 'something_new' },
          { start_index: 14, end_index: 27, url: BMJ, title: 'bmj.com', type: 'url_citation' },
        ],
      },
    }
    : event));
  const { citations } = await runTurn(unknown);
  assert.equal(citations.sources.length, 1, 'only the type whose shape is known');
  assert.equal(citations.sources[0].title, 'bmj.com');
});

it('still reads a result list that does carry urls', async () => {
  const withUrls = ROUND.map((event) => (event.delta?.type === 'google_search_result'
    ? {
      ...event,
      delta: {
        type: 'google_search_result',
        is_error: false,
        result: [{ url: 'https://www.bbc.co.uk/news', title: 'BBC News', rendered_content: 'Top stories' }],
      },
    }
    : event));
  const { citations } = await runTurn(withUrls);
  assert.ok(
    citations.sources.some((source) => source.uri === 'https://www.bbc.co.uk/news'),
    'the older shape must keep working — a deployment that sends it is not wrong',
  );
});
