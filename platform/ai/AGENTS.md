# platform/ai

LLM provider clients, streaming chat, computer-use session management, transcription,
and model defaults. If it talks to an AI API, it lives here.

## Files

| Path | Role |
| --- | --- |
| `src/chat.ts` | Streaming chat with Anthropic/OpenAI/Gemini (1458 lines). Handles tool calls, attachments, prompt caching. |
| `src/live.ts` | Live-mode streaming (Gemini's bidirectional WebSocket API). |
| `src/computer-use/session.ts` | Computer-use session orchestrator (1796 lines). Manages screenshot → action → result loop. |
| `src/computer-use/test-store.ts` | Nanostore for computer-use test state. |
| `src/transcription.ts` | Audio → text via provider transcription APIs. |
| `src/models/defaults.ts` | Default model per provider, plus the `@models` alias target. |
| `src/models/efforts.ts` | Effort-level (thinking time) metadata per model. |
| `src/providers/endpoints.ts` | Base URLs and endpoint builders for each provider. |

## The two big files

- **`chat.ts`** (1458 lines) — a multi-provider streaming client. It normalizes
  Anthropic/OpenAI/Gemini into one interface, handles tool calls (including
  multi-turn loops), attachments (base64 or URLs), and prompt caching. Every
  feature that does LLM chat (Chat, Code, Media, Agents, Spark) calls this.

- **`computer-use/session.ts`** (1796 lines) — the computer-use orchestrator.
  Manages the screenshot → LLM → action → result loop, keeps a live action log,
  and decides when to stop (user approval, max turns, task complete).

Both are used as-is; splitting them means threading state across files or lifting it
into nanostores. Feasible, but not trivial.

## Dependency constraint

**`platform/ai` must never import from `features/` or `apps/`.** It can import
sibling platform packages (`@willow/core`, `@models`) and that is all.

## One binding, resolved live

A turn's endpoint, wire format, tool policy and key bucket come from
`resolveProviderBinding` in `src/providers/profiles.ts`. **Every surface must go
through it** — Chat, the Workbench's two generation paths, Spark, Design and
visual editing all do.

Do not read `apiFormat` / `toolPolicy` / `baseUrl` off a saved model. That is where
they used to come from and it was wrong in two directions at once: a catalogue
model never carried them, so it silently fell back to the provider's default format
however Settings was set, and a custom model carried a copy frozen when it was
added, so editing the dropdown afterwards changed the screen and not the request.
Only Chat resolved the profile, so one setting meant different things in different
parts of the app. `savedModel.profileId` still selects *which* profile; it no
longer supplies the values.

`apiKeysForBinding` returns the whole bucket, in order. `streamChat` rotates
through it on an auth rejection — see `namesAuthRejection`, which deliberately
excludes quota and rate limits, since the next key is throttled too.

### Tool policy means the same thing on every provider

- `provider-native` — the endpoint's own built-ins, plus Willow's declarations.
- `function-calling` — declarations only. This is the relay setting: the caller is
  expected to supply `webSearchTools` so the turn still has a search tool.
- `disabled` — nothing, on all three adapters. The Gemini path had to be gated
  explicitly for this; it used to withhold only the built-ins, which made the one
  dropdown mean "no tools" on OpenAI and Anthropic and "no search" here.

**Exactly one search mechanism per turn.** `web_search` is also the name of
Anthropic's and OpenAI's built-ins, so a caller declares Willow's client tool only
when no server-side one is going out. `ChatView` computes that from
`nativeToolFormatForProvider`, the same predicate `chat.ts` gates on.

## Gemini Streaming Boundaries

`src/chat.ts` exposes several distinct callback channels. Keep them distinct when
adding or repairing provider integrations:

- `onToolCallStart` means a real provider tool invocation, such as native Google
  Search or native Code Execution. Consumers may render a tool row from it.
- `onPhase` is lifecycle state (`thinking`, `searching`, `executing`, or
  `responding`), not user-facing narration.
- `onThought` carries provider reasoning/thought-summary material. It must remain
  private in Spark and must not be converted into Spark `Work Log` entries.
- `onToken` carries answer text, not Patch metadata.

Spark's literal `*** Begin Patch` / `*** End Patch` protocol belongs to
`features/spark/src/harness/runtime`; this adapter must not inject Patch markers or
hardcoded “searching”/“running code” prose. If a provider emits no narration, the
truthful tool callback is still sufficient.

When changing native tool streaming, preserve step-identity deduplication: a
repeated delta for one provider step must not create duplicate UI rows, while a
second step must remain visible even if its query is identical. Update the focused
Gemini/Spark tests when changing this behavior.

<!-- related-packages -->

## Related packages

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/design`](../../features/design/AGENTS.md) — the design surface
- [`features/media`](../../features/media/AGENTS.md) — AI image and video generation
- [`features/spark`](../../features/spark/AGENTS.md) — scheduling / background-task agent

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
