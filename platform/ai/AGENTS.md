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
