# Spark Runtime Invariants

This directory owns Spark's forked Codex turn loop, stream parser, Patch applier,
and event sink. Keep the protocol and the visible timeline separate.

## Three Different Streams

1. **Patch protocol:** `*** Begin Patch` through `*** End Patch` is the literal
   freeform file-edit grammar. It is parsed by `ResponseStreamParser` and applied
   by `applyPatchEnvelope`. Never insert `Work Title` or status prose inside
   this envelope.
2. **Visible work prose:** Codex-style preambles and progress updates are ordinary
   model-authored prose immediately before a Patch or tool call. The runtime moves
   that prose into `work-log` events for the Spark processing timeline instead
   of including it in the final answer. `work-log` is an internal event name,
   not a model-facing protocol: there is no `*** Work Log:` marker.
3. **Provider events:** native Google Search and native Code Execution arrive from
   `platform/ai` through `onToolCallStart`. They create tool rows in Spark. They
   are not Patch rows. If the model did not precede one with visible prose, do not
   fabricate a narration line.

4. **Final-response boundary:** Spark may emit `*** Final Response` after a
   substantive work batch. The marker is stripped by `ResponseStreamParser`.
   Prose before it belongs to the work timeline; prose after it is the complete
   user-facing response. No tool, Patch, or progress update may follow it.

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
the model emits no preamble around a native tool, preserve the truthful tool row
instead of inventing a status sentence.

## Work Logs

The original Codex prompt asks the model for concise preambles before tool calls
and occasional progress updates during longer work. Spark calls those visible
sentences “work logs” after the runtime has classified them for the timeline.
Only prose actually emitted by the model belongs there. Do not synthesize file
names, Patch success messages, tool descriptions, or generic continuation text.
Do not introduce a separate Work Log marker protocol.

Spark's overlay strengthens the cadence for its general-purpose work surface:
one factual update before the first meaningful action, then as many distinct
updates around meaningful phases as the work genuinely supports. There is no
fixed count and no required placement before or after a tool call. Each
newline-separated update remains its own timeline entry. These remain
model-authored prose, never harness-generated narration; a simple phase may
still have only one update. Stop when another sentence would only pad or repeat
the timeline.
Work titles and narration are plain text without Markdown decoration. This
display rule never modifies the literal contents of a user's file Patch.

## Headings

`Work Title` is the stable heading for the whole work batch. The runtime supplies
a task-derived fallback when a Patch, native tool, or harness call starts before
the model has emitted a title. Do not leave the heading as the generic `Working`
when a real task prompt is available.

## Keep The Codex Base Whole

Spark's system prompt is composed from the complete vendored Codex prompt. The
Spark overlay changes only the identity, environment/tool boundaries, private
workspace rules, capability declarations, `Work Title`, and the final-response
boundary. Do not replace the composed prompt with a shortened Spark summary. Local
workspace, App, and MCP actions use the Codex text-call protocol; only genuine
provider-native Search and Code Execution arrive as provider events.

When changing this contract, update the focused tests in
`apps/studio/test/spark-harness-turn-loop.test.mjs` and run the Spark harness
tests plus `npm run typecheck`.
