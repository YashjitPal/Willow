# Spark Runtime Invariants

This directory owns Spark's forked Codex turn loop, stream parser, Patch applier,
and event sink. Keep the protocol and the visible timeline separate.

## Three Different Streams

1. **Patch protocol:** `*** Begin Patch` through `*** End Patch` is the literal
   freeform file-edit grammar. It is parsed by `ResponseStreamParser` and applied
   by `applyPatchEnvelope`. Never insert `Work Title`, `Work Log`, or status prose
   inside this envelope.
2. **Work metadata:** `*** Work Title:` and `*** Work Log:` are Spark-only lines
   outside the Patch grammar. They become the visible narration entries in the
   Spark processing timeline. They should describe real, user-safe milestones.
3. **Provider events:** native Google Search and native Code Execution arrive from
   `platform/ai` through `onToolCallStart`. They create tool rows in Spark. They
   are not Patch rows and must not be represented by a fabricated narration line.

## Thought Summaries Are Private

Gemini's `thought_summary` stream is delivered through the transport's
`onThought` callback. Spark's main sink intentionally discards it. Do not route
`onThought`, `thought_summary`, `reasoning`, or provider thinking deltas into
`workLog` or `activityLog`; doing that exposes the wrong channel and makes Spark
look like it is showing model thoughts.

## Native Search And Code Execution

Search and Code Execution are enabled by passing the model options through the
harness. A real provider invocation emits exactly one corresponding tool row
(deduplicated by the provider step identity where available). Do not add a fixed
sentence such as “I'm searching the web for the information this task needs.” If
the model emits no Work Log around a native tool, preserve the truthful tool row
instead of inventing a status sentence.

## More Timeline Lines

The Spark profile asks the model for moderate-length Work Logs around meaningful
research, Patch, and verification phases. More lines must come from distinct
observable milestones, not repeated synonyms or hidden chain-of-thought. It is
valid for several Work Logs to occur consecutively without a tool call; the UI
groups consecutive narration under one timeline branch and shows the clock only
on that branch's first row. A tool row starts a new branch.

## Headings

`Work Title` is the stable heading for the whole work batch. The runtime supplies
a task-derived fallback when a Patch, native tool, or harness call starts before
the model has emitted a title. Do not leave the heading as the generic `Working`
when a real task prompt is available.

When changing this contract, update the focused tests in
`apps/studio/test/spark-harness-turn-loop.test.mjs` and run the Spark harness
tests plus `npm run typecheck`.
