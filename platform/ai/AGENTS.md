# platform/ai

LLM provider clients, streaming chat, computer-use session management, transcription,
and model defaults. If it talks to an AI API, it lives here.

## Files

| Path | Role |
| --- | --- |
| `src/chat.ts` | Streaming chat with Anthropic/OpenAI/Gemini (1458 lines). Handles tool calls, attachments, prompt caching. |
| `src/live.ts` | Live-mode streaming (Gemini's bidirectional WebSocket API). |
| `src/computer-use/session.ts` | Computer-use session orchestrator (1796 lines). Manages screenshot → action → result loop. |
| `src/computer-use/test-store.ts` | The testing overlay's state (`TestStore`): each Code screen makes its own (`features/code/src/session/code-session.ts`); `testStore` is the one `runComputerUseTask` moves when handed an iframe. |
| `src/transcription.ts` | A recording → text through an API model: which models can take audio (`transcriptionRoute`), their keys through the profile binding, the fallback list (`transcriptionCandidates`), the three wire routes. |
| `src/dictation/dictation-session.ts` | One dictation take on any browser or webview. `planDictation` (pure) picks what listens and the fallback chain; `startDictation` records, listens and transcribes. See *Dictation runs everywhere*. |
| `src/dictation/browser-recognizer.ts` | The Web Speech API for one take. Reports a broken recognizer (loudly or silently broken) instead of restarting into it. |
| `src/dictation/on-device-transcription.ts` · `whisper-worker.ts` | Whisper on this device, in a module worker; the silence threshold. |
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

## A computer-use task drives the surface it is handed

`runComputerUseTask` takes either the Workbench preview's iframe or a
`ComputerUseDriver` (`settle`, `screenshot`, `execute`, `url`), and knows nothing else
about where the page lives. The iframe is wrapped in `iframeDriver` and is the only
target that moves the preview's cursor overlay (`testStore`); Spark's remote browser
supplies a driver that works over postMessage (see `features/spark/AGENTS.md`).
`options.systemPrompt` and `options.maxTurns` replace the preview-oriented defaults.

**A driver's `screenshot` should not throw for a page it merely cannot capture.** The
loop reads a throw after an action as "this surface cannot be controlled" and ends the
task with a message written for the preview iframe. Spark's driver hands the model a
stand-in image instead, so it can go back or elsewhere.

## Callers declare their own tools

`chat.ts` declares no product tools of its own. A harness passes its function
declarations through `toolDeclarations` and executes them in `onToolCall`; a call
with no executor is answered with an explicit "not available" error, never a
canned result. The Media agent's suite used to live here, with a mock executor
behind it, and both are gone — see `features/media/AGENTS.md`.

`enableMediaTools` now only marks a Media agent turn. It keeps that turn on the
GenerateContent stream, because the Interactions path returns no history and the
agent's next turn continues from the history this one returns. It declares
nothing by itself.

A message's attachments are resolved concurrently (`geminiAttachmentParts`), each
being a Files API round trip, and an aborted Gemini stream's `response` promise is
pre-handled in `runStreamCall` so Stop does not raise an unhandled rejection.

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

## Dictation runs everywhere

The composer's mic (`features/chat/src/composer/use-composer-dictation.ts`, which the
design composer re-exports) is a thin hook over `startDictation`. Three facts shaped it:

- **A browser's recognizer may have nothing behind it.** Chrome's talks to Google.
  Chromium builds without Google's key (Brave, Electron, WebView2 — so the Windows
  desktop app) have the constructor and no service, and fail either loudly (`network`,
  `service-not-allowed`) or silently: `speechstart`, then `end` with no result and no
  error, every session. Firefox has none. The old hook restarted into the silent failure
  forever: the mic "listened" and then nothing came back.
- **So every take records.** A MediaRecorder runs beside the recognizer. When the
  recognizer broke, the recording is transcribed by a keyed model (Gemini, then OpenAI's
  transcribe models), and failing that by Whisper on this device. No route is a dead end.
- **Whether anyone spoke is the recording's call.** The loudest 100ms under
  `SILENCE_LEVEL` (RMS) is silence: "" back, nothing sent anywhere. Whisper answers
  silence with "Thank you."

Routes, from `systemDefaults.transcription`:

| Setting | Listens with | Transcribes the recording with, in order |
| --- | --- | --- |
| Browser speech recognition (`chrome-native`, the default) | the browser's recognizer; the recording alone where there is none | keyed models, then this device — only when the recognizer gave nothing |
| A Gemini or OpenAI model | the recording | that model, the other keyed models, this device |
| On this device (`on-device-whisper`) | the recording | this device only; the audio never leaves it |

A selected model that can't take audio, or has no key, is reported (`unusableSelection`)
and the take uses the browser's route. Settings lists only `canTranscribeAudio` models.

**Wire routes** (`transcriptionRoute`). Every Gemini model that reads input hears audio
(inline data; the 3.5 Transcribe model goes over Interactions). OpenAI's `whisper-*` and
`*-transcribe` models answer only on `/audio/transcriptions`, multipart: sent a chat
completion with audio they 404, which is why choosing one used to do nothing. The audio
chat models (`gpt-audio`, `gpt-4o-audio-preview`) take `input_audio`. Keys and base URLs
come from `resolveProviderBinding`, like every turn's.

**On this device** is transformers.js, imported inside the worker from jsDelivr
(`@huggingface/transformers@4.3.0/+esm`) rather than from npm: the package pulls `sharp`
and `onnxruntime-node` into the bundle. `onnx-community/whisper-tiny`, q8, on WASM: 39 MB
once, then cached by the browser; 4.8s for 6s of speech here, warm. `whisper-base` (q8)
was 73 MB and 11.7s for the same 6s. The worker starts loading the moment a take knows it
may need it (the recognizer broke, there is none, or on-device is chosen), so the
download overlaps the speaking.

**The desktop app** gives its own pages the microphone (`tabs::permission` in
`apps/desktop/src-tauri`), so WebView2, WKWebView and WebKitGTK don't ask on top of the
system's prompt. macOS also needs the usage strings in `src-tauri/Info.plist` (WKWebView
ends the app on a microphone or recognizer request without them) and the audio-input
entitlement; WebKitGTK has no `getUserMedia` until `enable-media-stream` is set, per tab.
WebView2 and WebKitGTK have no working recognizer, so there a take always goes by the
recording.

Tests: `apps/studio/test/chrome-native-dictation.test.mjs` runs the recognizer wrapper
against a scripted fake; `dictation-plan.test.mjs` covers the plan, the routes and the
silence check.

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
