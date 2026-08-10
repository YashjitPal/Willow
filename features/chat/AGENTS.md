# features/chat

The Chat app. A thread of messages, a composer, and an LLM-backed response
stream. Loaded as the "Chat" tab in Willow Studio.

## Files

| Path | Role |
| --- | --- |
| `src/ChatView.tsx` | The chat tab surface (1750 lines). Threads, streaming, live mode, model selection, scroll machinery. |
| `src/ChatResponseChrome.tsx` | The decorated container around an LLM response: `ResponseActions` and `ThinkingStepsSidebar` (412 lines). |
| `src/UserMessageBubble.tsx` | One user turn: the clamp-to-4-lines bubble and its expand/collapse transition (122 lines). |
| `src/GeminiThinkingVisualizer.tsx` | The three-dot Lottie "thinking" indicator. |
| `src/gemini-thinking-dots.ts` | The ~9KB single-line Lottie payload for the above, alone in a file so it stops wrecking greps. |
| `src/chat-message.ts` | The `ChatMsg` shape plus its save/serialize/sanitize helpers. |
| `src/chat-history.ts` | Converts stored `ChatMsg[]` into the AI wire format, inlining attachment bytes. |
| `src/chat-model.ts` | The system prompt and provider/model/key resolution for a send. |
| `deferred-prompt-blocks.md` | Prompt blocks for features Willow has not built yet, parked drop-in ready. Not dead text — see below. |
| `src/chat-timing.ts` | `waitForBrowserPaint()` — yields one frame so an intermediate render is actually seen. |
| `src/chat-turn-store.ts` | Module-level registry of in-flight turns, so a response outlives ChatView. |
| `src/chat-turn-runner.ts` | Drives one turn to completion, independent of React. Owns finalisation and checkpointing. |
| `src/composer/Composer.tsx` | `InputBar`, the prompt box (885 lines). Attachments, tool chips, send, and the two JSX branches. |
| `src/composer/composer-options.tsx` | The composer's static option tables: `TOOLS`, `TOOL_SYMBOLS`, `THEMES`, `MODES` and their types. |
| `src/composer/composer-icons.tsx` | `SpotifyIcon` and `ModelIcon` — inline SVG/provider glyphs. |
| `src/composer/ModesMenu.tsx` | The mode dropdown. |
| `src/composer/ThemesMenu.tsx` | The theme dropdown. |
| `src/composer/use-composer-dictation.ts` | The whole dictation subsystem: recording, transcription, caret restoration (343 lines). |
| `src/composer/use-composer-models.ts` | Resolves the selected model/effort id and derives the pill labels. |
| `src/composer/use-composer-textarea-autosize.ts` | The RAF-throttled textarea measurement, and the two flags the layout derives from it. |
| `src/composer/use-composer-chat-layout.ts` | `useCollapsedChatPaddingRight` and `useFullscreenShellCentering` — the two chat-variant layout measurements. |
| `src/composer/DictationWaveform.tsx` | Canvas mic waveform shown while dictating (234 lines). |
| `src/composer/PlusDropdownMenu.tsx` | The + button dropdown (attachments, code, images, etc.). |

## Architecture

Chat owns the UI, not the LLM call — `@willow/ai/chat` owns that. `ChatView`
holds the thread state in its own `useState` and resets it locally.

Chat, Code and Media are three independent agents, and as of the split below
this package has **no edge to either of the others' feature packages** in either
direction. Two things used to cross that line and neither belonged to the
feature it lived in:

- `ModelsMenu`, the model + effort picker. Chat owned it and re-exported it
  through `Composer.tsx` so Code could import it; it now lives in
  `@willow/ui/models/ModelsMenu`, which both features import sideways. It takes
  props and holds no chat state, so nothing had to change but the path.
- `newChatSignal` / `triggerNewChat`, once `src/chat-store.ts`. Despite the
  name, **Chat never subscribed** — Code's top bar fires it and Code's sidebar
  listens. It is now `@willow/core/new-chat-signal`.

`@willow/media` and `@willow/studio` are still imported from here, and Media and
Spark still import this package's composer. Those are live couplings, not
oversights; the invariant is specifically about the three agent surfaces.

## The deferred prompt blocks

`CHAT_SYSTEM_PROMPT` was adapted from a production prompt that described four
capabilities Willow has no executor for: media generation, `<Image of X>`
diagram tags, a `<GenerateWidget>` widget schema, and a personalization ladder
over a user-profile store. They were held out of the shipped prompt on one rule —
**a prompt block that describes a tool the harness never declares does not add
capability, it teaches the model to announce work it never does.** The user reads
that as a bug, not as a missing feature.

They were not thrown away. All four sit verbatim in `deferred-prompt-blocks.md`,
already converted to Willow's naming and stripped of the source's plan tiers, so
each is a paste away. The gate for moving one back up into `chat-model.ts` is not
"is the UI ready" — it is **is the tool declared to the model on that turn**. For
media that means `enableMediaTools` in `@willow/ai/chat`, which chat mode leaves
off precisely because media is a different agent.

The file has no importer, so `gemini-cards.test.mjs` asserts it exists and still
holds all four blocks. That test is load-bearing: the prompt it was extracted
from was never committed, so if the file goes, the text is gone.

## The big one

`ChatView.tsx` was 2069 lines before the modules above were split out. What is
left is genuinely interconnected: the send pipeline, live mode, and the scroll /
height-reserve machinery all close over `ChatView`'s own state, so the next split
has to move state, not just code. Extract bottom-up — a self-contained leaf and
the values it needs as parameters — never by cutting the file at a line number.

### What the recent splits looked like

Two shapes, same as `features/media`. `chat-message.ts`, `chat-timing.ts`, and
`gemini-thinking-dots.ts` were already closure-free and moved verbatim.
`chat-history.ts` and `chat-model.ts` took `useCallback` bodies that read only
their declared deps and made those deps an input object, leaving a thin wrapper
in `ChatView` with an unchanged dep array:

```ts
const buildAiHistory = useCallback(
  (sourceMessages: ChatMsg[]) => buildChatAiHistory({
    sourceMessages,
    attachmentBlobs: attachmentBlobsRef.current,
    loadAttachment: loadLocalFSChatAttachment,
  }),
  [loadLocalFSChatAttachment],
);
```

Both shapes are mechanical, and that is the point: the moved code should come out
identical to the original modulo indentation, which you can check with a
whitespace-normalized diff against the pre-split file. `chat-model.ts` is the one
that does *not* satisfy that check — the inline provider cast became a
`ChatProvider` alias (same union, same order) and `getShortModelName` stayed
private to the new file.

### The composer split, and the rule that made it safe

`Composer.tsx` was 2036 lines and is now 885, across the modules listed above
plus `ModelsMenu`, which was extracted here and has since moved on to
`@willow/ui`. It ran out of extractable leaves after that one, so the remaining
four splits are **hooks**, and they follow one rule:

> A block can become a hook when every free identifier it reads is an outer
> value it only *reads*. Then the body moves byte-for-byte, because a hook body
> sits at the same indentation depth as a component body, and only the wrapper
> is new code.

Probe the free identifiers before writing anything. Three things then have to
hold, none of which a typecheck will tell you about:

- **Hoist anything declared below the call.** Hook arguments are evaluated at the
  call site. `isPlusMenuOpen` and `textareaRef` were declared ~20 lines *below*
  the dictation block and were safe only because the reads sat inside
  `useCallback` bodies that run after render; passing them as arguments makes
  them render-time reads, so they moved above the call. That is the one edit in
  `Composer.tsx` that is not a deletion.
- **The hook call goes exactly where the block was.** Same slot, and for
  `use-composer-chat-layout` the two calls are in the original order — hook order
  *is* effect order.
- **Count effects across every module afterwards.** Sum `useEffect` +
  `useLayoutEffect` over the whole split set and compare to the pre-split file:
  20 → 20 here (Composer 4, Modes 3, Themes 3, Models 4, dictation 2, models 1,
  autosize 1, chat-layout 2). A lost effect is a behaviour the UI silently stops
  doing, and nothing else catches it.

Dependency arrays move **byte-for-byte**, unchanged. A reordered or trimmed array
silently changes when a recording restarts or a measurement re-runs.

Three behaviours in the moved code look like bugs and are not — the hook JSDoc
says so too, but in short: `ALL_MODELS` is deliberately **not** memoised (the
selection-sync effect is meant to run every render; its idempotence guard is what
stops the loop), the autosize effect measures under *forced collapsed padding*
with `overflowY` pinned hidden because a scrollbar makes `scrollHeight` claim an
extra wrapped line, and it disables `transition` for the whole measurement so the
`scrollHeight` reads cannot land mid-animation.

That restore (`style.transition = ''` after a forced reflow) now only matters to
the **non-chat** composer. The chat variant has no size transition at all: its
box snaps on wrap, unwrap, send and paste, because Gemini's does — every element
in Gemini's composer size chain computes to `transition-duration: 0s`, and its
only authored height transitions are on `.pre-fullscreen` / `.fullscreen`, which
are the near-fullscreen toggle rather than ordinary wrapping. Note that
`.textarea-wrapper`'s padding **is** the composer's height (40px collapsed
against 78px expanded), so putting any `transition` on it animates the whole box
growing and shrinking. See `apps/studio/test/composer-size-snap.test.mjs`.

The composer's zero-state → docked slide (below) is a separate mechanism and does
**not** animate ordinary wrapping — measured frame by frame, no ancestor of the
composer ever carries a transform during a wrap or a collapse. Removing the size
transitions did not touch it.

What is left in `Composer.tsx` is `InputBar`'s two JSX return branches, each
closing over ~40 values. Splitting those means writing a props contract, not
moving text — do not attempt it as a mechanical extraction.

The composer's dropdowns animate through CSS keyframes declared in
`apps/studio/index.html` plus a 150ms `setTimeout` before `onClose`. There is no
`AnimatePresence` or `motion.*` anywhere in `Composer.tsx` — do not "restore"
any.

**Do not move a `motion.div` that is a direct child of `AnimatePresence`.** In
`ChatView` that means the `ThinkingStepsSidebar` and `RichResourcePanel`
wrappers and the thread-entrance div. Extracting a wrapper puts a component
boundary where Framer Motion tracks presence, and a broken exit animation is not
something a typecheck would catch.

### There is exactly one composer

`ChatView` renders **one** `InputBar`, in the footer, for both the zero state and
an active thread. It used to render two — one inside Media's `HeroSection`, one
in the footer — bridged by a shared `layoutId`. That was the bug, not the
mechanism: on send React tore one down and built the other, and Framer covered
the seam by inverse-scaling a wrapper whose children are not layout nodes, so the
text, the model pill and the icons visibly squashed for the whole 250ms.

Now the single node carries `layout` and slides. Measured, both states:
`[574, 381, 660, 64]` centred and `[574, 713, 660, 64]` docked — same x, same
width, same height, so the projection is a pure translate with no scale term.
**Keep it that way.** Anything that changes the composer's size between the two
states puts the squash back.

The slide is **one-directional**, and that asymmetry is deliberate — do not
"fix" it into a symmetric transition. Recorded off Gemini at 55fps: opening a
chat animates the fieldset `bottom: 50vh -> 0` with
`translateY(50%) -> translateY(-50%)` over 250ms on `cubic-bezier(0.2, 0, 0, 1)`
(14 frames spanning 253ms, y travelling 380.8 -> 712.6), but pressing **New
chat** does not move it at all: `[582, 380.8, 660, 64]` on the first frame of
the segment and every frame after, with `position`, `bottom` and `transform`
all constant. Only the greeting animates, via its own `willow-lm-fade-in-up`.
So `transition.layout` reads its duration off `hasStarted`, which is already
false on the render that commits the move back to centre.

Verified on ours the same way, with a positive control — a probe element
animating a known 250ms transform sampled by the same rAF loop. Control 16
intermediate frames at 60fps, composer 0 intermediate `y` and 0 non-identity
transform writes on the projection subtree. **Always run that control.** An
occluded Chrome window stops producing frames even with focus emulation on, and
the first attempt sampled at 3fps and reported a "snap" that meant nothing.

Two invariants hold it together:

- The lift wrapper owns **position only, never a transform**. Framer's projection
  writes `transform` on the node below it; a transform on the wrapper makes the
  two fight and the animation jumps on frame one.
- `layoutDependency={hasStarted}` is **required**. `layout` alone leaves it
  undefined, and `MeasureLayout` then snapshots on every commit and animates any
  delta — which is what made send-from-fullscreen squash, since `handleSubmit`
  collapses the shell from `calc(100dvh - 114px)` to ~64px in one commit.

The zero state pins the composer to the chat area's centre and pins the greeting
with it, so scrolling slides the recents list under a stationary composer. That
is Gemini's behaviour, measured: its fieldset centre sits at exactly viewport/2
and never scrolls. `HeroSection`'s `pinnedComposer` prop is what suppresses its
own `InputBar` and its own greeting.

### The greeting hangs off the composer, not off the page

`PinnedChatGreeting` (exported from `MediaHome`) renders **inside** the
composer's `motion.div`, `absolute bottom-full` with a 40px margin. That is
deliberate and it is the only construction that reproduces Gemini, so do not
"simplify" it back into `HeroSection`.

Gemini's greeting is not positioned against the viewport at all. It is the last
child of `.top-section-container`, a `flex-direction: column;
justify-content: flex-end` box whose height Angular maintains inline as
`--top-section-container-height`. At an 826px viewport that height is 324.8px
from a top of 56, putting its bottom edge on 380.8 — the composer's top edge is
381. So the gap between the greeting *block* and the composer is **zero**; the
visible 40px is `padding-bottom: 40px` on `.assistant-messages-primary-container`,
between the h1 and the composer.

Because the composer's centre is pinned (`bottom: 50vh` +
`transform: translateY(50%)`), growing it moves its *top* edge up, Angular
shrinks that height, and the flex-end child rides up. Anchoring to the
composer's own box gets the identical result with no measurement and no lag.
Measured on ours: type until the box grows 182px and the greeting rises 91px —
exactly half — with the gap still 40 and the centre still 413.

The `--initial-input-half-height: 32px` that Gemini writes inline on the
fieldset is a red herring. All 73 readable stylesheets were searched; **no rule
consumes it**. Do not build anything on it.

Incognito uses a tighter 32px gap. That value is Willow's own, pre-existing, and
**not** verified against Gemini's temporary-chat zero state.

**Line endings: read the worktree, not this list.** `core.autocrlf=true` and there
is no `.gitattributes`, so every blob is stored LF and checked out CRLF. On disk
today `ChatView.tsx` (2769), `Composer.tsx` (1139), `ChatResponseChrome.tsx` (470)
and `MediaHome.tsx` (1027) are pure CRLF with zero bare LF;
`composer/PlusDropdownMenu.tsx` is genuinely mixed (168 CRLF / 104 LF) in the blob
itself. Match the file you are in, and check it rather than trusting these counts.

Two consequences that have each already cost a debugging session:

- Git Bash `sed`/`awk` silently rewrite a file to LF. Re-normalise after any
  scripted line-addressed edit.
- A source-text test anchored on `;\n` matches nothing here. Use `;\r?\n`.
  `chat-turn-gap.test.mjs` passed only while its target happened to be checked
  out LF, which is not a state to depend on.

## Opening a chat

The load effect keyed on `activeChatId` has three guards that all exist for a
recorded failure. None are optional.

**A generation counter, not a cleanup.** `loadGenerationRef` is bumped on *entry*
and re-checked after each await. It cannot be an effect cleanup: the effect's deps
include `chatTitle` and `chatSessionId`, which `loadChat` itself writes, so a
cleanup would make every load cancel itself. Two checks are required, one per
await — attachment hydration awaits one IndexedDB read *per attachment*, so a
lighter chat clicked afterwards can overtake a heavier one mid-hydration.
Check 1 must precede `revokeAllAttachmentObjectUrls()`, or a superseded load
revokes the *winner's* object URLs and every image in the fresh thread goes blank.
The `setMessages`/`setChatTitle`/`setChatSessionId` block must sit behind one
check with no await between: autosave persists under `chatTitle || chatSessionId`,
so a stale winner writes one chat's messages into another chat's file on disk.

**A third render state, not `hasStarted === false`.** `showBlankThread` empties
the conversation area while a body loads; `isThreadDocked = hasStarted ||
showBlankThread` keeps the composer where it is. Forcing `hasStarted` false would
also drive the composer's docked-vs-centred layout, and that direction is a
deliberate 0-duration snap — the composer would teleport to screen centre and
slide back on every chat open. `layoutDependency` and `transition.layout` must
both track `isThreadDocked`; splitting them re-introduces the squash.

**A selection epoch, because `activeChatId` moves for reasons that are not a user
selection.** Only `selectLocalFSInboxChat` bumps `chatSelectionEpoch`; rename,
temp-id adoption, delete and scope switches all call `setActiveChatId` directly.
Consume the epoch *before* the identity guard's early return — consuming after it
leaves a bump unclaimed, and the next internal id move reads as a user selection.
The raise also requires `!forceReload`: that flag deliberately bypasses the
identity guard and means "same chat, background disk sync", so blanking on it
wipes a live conversation every time the 3s poll finds a change.

Release is in a `finally`, and again on unmount. The top-loading reason lives in a
module-level store that outlives `key={chatResetKey}`, so a dropped reason leaves
the green progress bar running forever.

**Chunked reveal.** A loaded thread paints its newest `REVEAL_INITIAL_COUNT`
messages, then walks backwards a chunk per frame. Keep the first chunk ≥ 8: the
open-scroll jump targets `messages[length - 1 - 4]`, and if that element is not
mounted the jump silently no-ops and the chat opens scrolled to the *top*. Derive
`messageIndex` from the full array (`revealOffset + visibleIndex`) or slice-index
0 takes the `messageIndex === 0` branch and every chunk shifts the thread by 52px.
Each chunk mounts *above* the viewport, so it must `flushSync` and then correct
`scrollTop` by the height delta inside the same frame — the same cure the
ResizeObservers use for the same class of jerk. The reveal is inert during
generation, and `handleSend` materialises the whole thread first.

## Background turns

A response keeps running when the user leaves the chat, and resumes live when
they come back. It has to survive an unmount, not just a chat switch: the
Code/Media tabs, New Chat and Incognito all tear ChatView down outright.

So the turn is not component state. `chat-turn-store.ts` holds a record; the
component is a *listener* on it. Leaving detaches; it does not stop the turn.

**Keyed by `turnId`, never by chat id.** A chat is renamed out from under a
running turn (temp id → real title) mid-stream. `saveLocalFSChat` and
`renameLocalFSChat` announce the move as `willow_chat_id_moved` and the store
rebinds; `chatIdHistory` is the fallback so a missed event degrades to
stale-but-findable. `setActiveChatId` is *not* a usable signal — it deliberately
declines when the user is viewing another chat, which is exactly this case.

**Exactly one writer.** `claimChatTurnSettlement` decides synchronously, with no
await, whether the attached view or the runner persists the result. An attached
view finalises through its own state and the autosave effect writes; otherwise
the runner writes. `saveLocalFSChat` is a whole-file replace, so two writers
means the loser's array wins outright — and zero writers means the turn is lost.
That is why **`detachTurn` on unmount is load-bearing**: a dead listener left
attached makes the runner claim `'view'`, call into an unmounted tree, and drop
the record without saving.

**Only the attached listener touches React.** An unwatched turn just grows
`record.content`. `streaming` is one component-wide value, so this is what stops
a background chat painting over the displayed one. For the same reason the
settle path compare-and-clears `generationAbortRef` and `streamingClearRafRef` —
a turn finishing in another chat must not kill the displayed chat's stop button.

**Abort on:** delete, scope/workspace/account switch, sign-out, incognito
unmount, and the stop button (attached turn only). **Never on** unmount or chat
switch. Delete is the sharp one: `saveLocalFSChat` clears the tombstone and
re-adds the id, so a completion landing after a delete *resurrects* the chat in
IndexedDB, in Recents and on disk, and it survives the reconciler. Hence
`willow_chat_deleted`, dispatched before the body is removed.

**Reload.** Nothing survives a tab close mid-request, so the runner checkpoints
the partial response every `CHECKPOINT_INTERVAL_MS` as `wasStopped: true` — the
existing "ended early but keep it" shape, which `hasSavedMessageContent` retains
even when empty and the thread renders with the divider. Do **not** try to save
from `beforeunload`/`pagehide`: an IndexedDB transaction started during unload
routinely never commits, so it only appears to work. The 2s floor is deliberate
too — every save bumps the chat timestamp, and Recents sorts newest-first, so a
tighter cadence re-shoves the chat to the top of the sidebar on every tick.

**Naming.** `fetchTitle` has no cancellation and outlives unmount, and
`messagesRef` is frozen at whatever the dead component last saw — for a
backgrounded turn, the empty placeholder, which `hasSavedMessageContent` drops.
Landing after the runner's save, that would write the user message alone and
*erase the reply*. It therefore prefers the live record when one is running.

## Dependencies

Imports from 7 Willow packages: `@willow/ui` (11), `@willow/ai` (6),
`@willow/core` (5, attachments and the GitHub import), then `@willow/storage`,
`@willow/auth`, `@willow/media`, and `@willow/studio`.

The last two are cross-feature and worth knowing about. `ChatView` renders
Media's `HeroSection`, `BottomPanel` and `PinnedChatGreeting` directly — in the
zero state `pinnedComposer` reduces the hero to the glow alone, suppressing both
its `InputBar` (so the footer's composer stays the single one) and its greeting
(which `ChatView` renders itself, inside the composer's box). The composer
reaches up into the Studio shell for `BackgroundContext`.

**Chat does not import Code, and that is deliberate.** Chat, Code and Media are
three separate agents with three separate system prompts and harnesses; nothing
in this package parses Code's artifact envelope or shares its history. The one
former exception was the composer's `GithubImportDialog`, which lived in
`features/code/src/github/` and was imported from here — despite Code never
using it. It now sits in `@willow/ui/github/`, dialog and GitHub client
together; importing a repo produces a `'github'` `ComposerAttachment`, a kind
`@willow/core` already declared. See
[`platform/ui`](../../platform/ui/AGENTS.md) for why it landed there.

Chats and their attachments persist through
`@willow/storage/local-fs/LocalFSContext`; blobs are cached in a
`Map<string, Blob>` ref in `ChatView` and re-read from storage on a miss.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/media`](../media/AGENTS.md) — AI image and video generation
- [`platform/ai`](../../platform/ai/AGENTS.md) — model clients, chat orchestration, computer use
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../../platform/core/AGENTS.md) — utilities, types, constants
- [`platform/storage`](../../platform/storage/AGENTS.md) — persistence, adapters, sync
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/code`](../code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/media`](../media/AGENTS.md) — AI image and video generation
- [`features/spark`](../spark/AGENTS.md) — scheduling / background-task agent

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
