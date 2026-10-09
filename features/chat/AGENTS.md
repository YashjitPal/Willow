# features/chat

The Chat app. A thread of messages, a composer, and an LLM-backed response
stream. Loaded as the "Chat" tab in Willow Studio.

## Files

| Path | Role |
| --- | --- |
| `src/ChatView.tsx` | The chat tab surface (1750 lines). Threads, streaming, live mode, model selection, scroll machinery. |
| `src/MobileModelPicker.tsx` | The top-bar model pill shown below 961px, with its ripple and `ModelsMenu`. Its own module so the notebook page mounts the same picker: `App` lazy-loads it into `NotebookPage`'s `renderModelPicker`. The Code landing mounts it too, passing `onSelect` for its own model handling. |
| `src/use-compact-viewport.ts` | `useCompactViewport()` — true at 960px and below, Gemini's phone and tablet layout. Every narrow JSX branch in Chat and Notebooks keys on it, so CSS and JS switch at the same width. |
| `src/ChatResponseChrome.tsx` | The decorated container around an LLM response: `ResponseActions` and `ThinkingStepsSidebar` (412 lines). |
| `src/UserMessageBubble.tsx` | One user turn: the clamp-to-4-lines bubble and its expand/collapse transition (122 lines). |
| `src/GeminiThinkingVisualizer.tsx` | The three-dot Lottie "thinking" indicator. |
| `src/gemini-thinking-dots.ts` | The ~9KB single-line Lottie payload for the above, alone in a file so it stops wrecking greps. |
| `src/chat-message.ts` | The `ChatMsg` shape plus its save/serialize/sanitize helpers. |
| `src/chat-history.ts` | Converts stored `ChatMsg[]` into the AI wire format, inlining attachment bytes. |
| `src/chat-model.ts` | The system prompt and provider/model/key resolution for a send. Also carries the three deferred prompt blocks as comments — see below. |
| `src/chat-timing.ts` | `waitForBrowserPaint()` — yields one frame so an intermediate render is actually seen. |
| `src/chat-turn-store.ts` | Module-level registry of in-flight turns, so a response outlives ChatView. |
| `src/chat-turn-runner.ts` | Drives one turn to completion, independent of React. Owns finalisation and checkpointing. |
| `src/chat-turn-setup.ts` | Everything a turn is built from besides its history: system prompt, personal/canvas/search tools, provider options, notebook and Gem grounding. Shared by the composer's send and a resumed turn, so the two cannot drift. |
| `src/chat-turn-takeover.ts` | The cross-tab half: every saved turn is a `chat-turn` background job, and a tab that inherits one regenerates the reply from the chat file. |
| `src/ChatTurnTakeover.tsx` | Mounted once at the app root (lazy); registers the takeover with this tab's storage, keys and model config. |
| `src/composer/Composer.tsx` | `InputBar`, the prompt box (885 lines). Attachments, tool chips, send, and the two JSX branches. |
| `src/composer/composer-options.tsx` | The composer's static option tables: `TOOLS`, `TOOL_SYMBOLS`, `THEMES`, `MODES` and their types. |
| `src/composer/composer-icons.tsx` | `SpotifyIcon` and `ModelIcon` — inline SVG/provider glyphs. |
| `src/composer/ModesMenu.tsx` | The mode dropdown. |
| `src/composer/ThemesMenu.tsx` | The theme dropdown. |
| `src/composer/use-composer-dictation.ts` | The composer's side of dictation over `@willow/ai/dictation`: the take's phases, placeholder and status text, the reveal, caret restoration (262 lines). See *Dictation: the mic beside Submit*. |
| `src/composer/use-composer-models.ts` | Resolves the selected model/effort id and derives the pill labels. |
| `src/composer/use-composer-textarea-autosize.ts` | The RAF-throttled textarea measurement, and the two flags the layout derives from it. |
| `src/composer/use-composer-chat-layout.ts` | `useCollapsedChatPaddingRight` and `useFullscreenShellCentering` — the two chat-variant layout measurements. |
| `src/composer/DictationWaveform.tsx` | Canvas mic waveform shown while dictating, drawn at the screen's pixel density (246 lines). |
| `src/composer/PlusDropdownMenu.tsx` | The + button dropdown (attachments, code, images, etc.). |
| `src/composer/ComposerCompanion.tsx` | The creation tools' companion row (aspect ratio, length, vocals, genre, sources) and its menus / phone sheets; the tools' placeholders. |
| `src/composer/mentions/` | The composer's "@" (models, apps) and "/" (skills) menus laid over `InputBar`, their text logic, what a send carries for them, and `chat-apps.ts`, the app list "@" and the "Connecting to" line share. |
| `src/media/` | Generated image / video / music: tool declarations and executor, generators, the cards, the luminous player, the image viewer, the zero-state gallery and its template data, the video discovery card, the `/images` page and its templates. |
| `src/chat-page-store.ts` | The sidebar's creation pages (`/images`, `/videos`): the request the shell sends and the page ChatView reports back. |
| `src/research/` | Deep Research: the plan tool, the background runner, the plan and progress cards, the side panel. |
| `src/library/` | Scheduled actions and skills a chat saves: `create_schedule` / `create_skill` and their executor, and the cards. See *Scheduled actions and skills*. |

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
  name, **Chat never subscribed** — Code's top bar fired it and Code's sidebar
  listened. It is now each Code screen's own `newChat`
  (`@willow/code/session/code-session`), so one screen's New chat button never
  resets another screen's chat.

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

They were not thrown away. All four are kept verbatim **as comments**, each
annotated with the slot it goes back into and the tool that has to exist first,
already converted to Willow's naming and stripped of the source's plan tiers so
a paste needs no second pass. They are comments and not string constants on
purpose: an unused `const` gets cleaned up by the next person or linter, and a
half-wired one gets accidentally concatenated into a live prompt.

Where each one sits is the point:

- The three chat-surface blocks are directly below `CHAT_SYSTEM_PROMPT` in
  `src/chat-model.ts`.
- The media block is **not here**. It sits above `buildMediaAgentSystemPrompt`
  in `features/media/src/agent/agent-tools.ts`, the prompt of the one agent
  whose turns set `enableMediaTools: true` and can therefore honestly claim it.

The gate for moving one up into a prompt is not "is the UI ready" — it is **is
the tool declared to the model on that turn**.

`gemini-cards.test.mjs` asserts all four are still present, and that none has
become live code (it strips comments and re-checks). That test is load-bearing:
the prompt they were extracted from was never committed, so if the comments go,
the text is gone.

## Chat context: notebooks and Gems

Two atoms say what a chat belongs to: `$chatNotebookId`
(`@willow/notebooks/notebook-chat-store`) and `$chatGemId` (`@willow/gems/gem-chat-store`). The shell sets
one when you open a notebook or `/gem/<id>`, and clears both on New chat.

When a chat is selected from history, ChatView restores each atom: the notebook from
the notebook's `chatIds`, the Gem from `gemIdForChat`. It does this on a change of
`chatSelectionEpoch`, which moves only on a real user selection, so an atom set on
purpose is never overwritten by an autosave.

With a Gem active, ChatView does four things:

- It shows `GemZeroState` in place of the hero.
- It puts the Gem's prompt block ahead of the notebook grounding.
- It records the chat under the Gem.
- It passes the Gem's default tool to the composer as `defaultTool`, only before the
  first turn. `defaultTool` is `undefined` (leave the selection alone), `null` (clear
  it) or a `ToolId` (select it).

## The plus menu

`composer/PlusDropdownMenu.tsx` is Gemini's plus menu, transcribed rather than
designed. Every value in it was read off the running gemini.google.com over CDP and
cross-checked against Gemini's own authored CSS, fetched with
`CSS.getStyleSheetText` across all 100 stylesheets. The two agreed everywhere they
could disagree, so **do not "tidy" the numbers** — a change here is a drift from the
original, not a refinement.

| | Measured |
| --- | --- |
| Panel | `#1f1f1f`, radius 20px, padding 8px, shadow `0 0 20px rgba(0,0,0,0.28)` |
| Widths | root 249px, More uploads 220px, More tools 253px |
| Row | 36px tall, radius 12px, padding `0 8px` |
| Label | Google Sans Flex 13px/17px, `#e6e6e6`, `"wdth" 92` |
| Divider | `0.8px solid rgba(255,255,255,0.12)`, `margin-block: 8px` |
| Hover | `rgba(230,230,230,0.08)`, **`transition: all 0s`** |
| Icon | 24px box at 8px inset, glyph at 20px |

**The hover layer snaps in.** Gemini computes `transition: all 0s` on the row, so a
fade is wrong. It is a separate absolutely-positioned node precisely so its opacity
can toggle without inheriting a transition.

**The label inset is 40px on the uploader rows and 44px on the tool rows.** That 4px
is real — Gemini uses two different row templates — and was measured on every row of
each, so it is not rounding.

**There are two icon fonts and they are not interchangeable.** Luminous Symbols
carries `attach_file`, `image_create`, `movie`, `music`, `canvas`, `deep_research`,
`guided_learning` and `chevron_right`; Google Symbols carries `drive` and
`more_horiz`. Names come from each `mat-icon`'s own `data-mat-icon-name`.

**The enter animation starts at half scale, not zero.** From Gemini's keyframes:

```css
@keyframes expand-in { 0% { opacity:.25; transform:scale(.5) } to { opacity:1; transform:scale(1) } }
.card-container { animation: expand-in .1s ease-in-out }
```

That `.25`/`.5` start is what makes it read as a pop rather than a fade. The same
animation plays on both submenus. Transform origin differs: the root menu pivots on
the corner it grows from (measured `0px <height>`, because Gemini's composer is
bottom-docked), both submenus on `0 0`. **There is no leave animation** — Gemini
removes the pane outright.

### Rows Willow cannot back yet

Gemini shows **Add from Drive** on the root and **Photos / Avatar / Notebooks**
alongside Import code under More uploads. Willow has no backend for any of them, but
they all render anyway: the menu is a clone, so a missing row is a visible difference.
Each takes an optional handler; a row without one closes the menu and does nothing
else. Only **Upload files** and **Import code** are actually wired today.

**Personal Intelligence** is the Memory switch, not a per-turn chip like the ones
beside it. The row reads `profileStore` and calls `setProfileEnabled`, so it is the
same switch as the settings tab and it **persists** — off stays off in the next
chat, and in every surface.

Off withdraws everything personal from a turn, which is four things and not one:
the inferred profile summary, `PERSONAL_DATA_LADDER`, the personalization tools
(`personalChatTools` returns `[]`, and `declaredToolNames` then makes a stray call
uncallable rather than merely undeclared), and **Saved Info**. That last one is
gated by *reading* the switch in `withTurnContext`, never by writing
`savedInfoStore` — silencing a turn is not the same act as editing what the user
saved, so the Saved Info page keeps listing entries the model can no longer see,
and flipping Memory back on restores them untouched. `saved-info.test.mjs` pins
both halves.

Its glyph is **the one unmeasured value in the file, and it is currently wrong**.
Gemini draws it as a masked `span.icon.lm-icon-m` rather than a `mat-icon`, so it
carries no `data-mat-icon-name`, and the rule holding its mask was in a component
stylesheet that had not loaded when the capture ran. `personal_intelligence` was
inferred from the convention every other glyph obeys — and it renders as nothing,
which proves no such ligature exists. It needs the real mask URL off a live capture.
`apps/studio/test/gemini-plus-menu.test.mjs` pins all of the above.

### On phones and tablets

At 960px and below Gemini renders the same menu as `gem-menu.is-mobile`. It is still
a popover anchored to the plus button, **not a bottom sheet**, at every narrow width.
`PlusDropdownMenu` branches on `useCompactViewport()` for it; the desktop card above
is untouched. Measured at 390×844 and 800×1280:

| | Measured (≤960px) |
| --- | --- |
| Panel | `#1c1c1c`, radius 20px, `padding: 0 8px` inside an 8px transparent `border-block`, min-width 260px, `width: max-content`, `max-height: min(440px, 42vh)` |
| Row | 48px tall, padding 12px, gap 8px, radius 12px |
| Label | 17px/24px, `#e0e0e0` |
| Glyph | 24px at weight 300, `#e3e3e3` |
| Placement | 4px left of the plus button; 8px below it, or 16px above it when opening upward |
| Submenu | A card with its own header (`padding: 16px 12px 8px`, close glyph). Its left edge sits at the trigger row's right edge, pushed left to stay 24px inside the viewport; its bottom is 8px above the main card's |

**Tools fold by height, not width.** As many tools stay inline as fit under the
`min(440px, 42vh)` cap — `floor((cap − 176.8) / 48)`, where 176.8px is the three upload
rows, the divider and the panel's 8px borders — and the rest go under **More tools**.
From 1000px tall nothing folds. Spark's composer folds its own tool list the same way.

As on the desktop there is no backdrop and no leave animation, and the panel opens
with the same `expand-in`. A tapped button keeps `:hover` on a touchscreen, so the plus
and mic buttons drop their hover circle under `(hover: none)`
(`.willow-composer-icon-button` in `Composer.css`).
`apps/studio/test/responsive-plus-menu.test.mjs` pins the narrow layout.

## Thinking steps and sources at 960px and below

"Show thinking steps" and "View sources" open one shared panel, `ContextSidebar` in
`ChatResponseChrome.tsx`, because Gemini uses one `context-sidebar` element for both.
On desktop it is the docked 400px card. At 960px and below, measured on Gemini at
800×1280, it becomes a sheet over the whole screen:

- **Surface:** `position: fixed` at (0, 0) and #131314, with no border, radius or
  scrim. The header and contents keep their desktop geometry. It is portalled to
  `body`, because the shell's top-bar controls stack above everything in the chat
  column, and Gemini's sheet covers the bar.
- **Motion:** it animates `margin-right` (-424px to 0, 300ms on `[0.2, 0, 0, 1]`) and
  opacity (200ms, linear), read from Gemini's own animation objects. The left edge
  stays put and only the close button slides.
  `onUpdate={noop}` keeps framer-motion off WAAPI for that opacity: the WAAPI hand-off
  painted one frame at the starting value, a full-screen flash on close.
- **Focus:** opening moves focus to the close button. Gemini marks that with its
  program-focus ring (0.8px #a8c7fa, inset) over a 12% state layer until focus leaves.
- **Colour:** thought titles and the dotted rail switch to the narrow on-surface
  #e0e0e0 (#e6e6e6 on desktop).

`apps/studio/test/thinking-steps-responsive.test.mjs` pins this and checks that the
desktop card is unchanged.

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

**A Code chat is never shown here.** Chat cannot render one, and its next save
would strip the Code fields. However one becomes the open chat, the load effect
hands it to Code (`handOverCodeChat`: `selectLocalFSInboxChat(null)` plus
`requestCodeChatOpen`) — by its marker before reading it, or by its messages
(`isCodeChatBody`) when it has no marker yet, before anything is committed. See
`platform/storage` AGENTS.md for the other guards.

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

**An open lands, it does not travel.** `isFirstScrollRef` is armed only by a real
chat load, and the scroll effect reads it as "this run is an opening, not a turn
arriving": it writes `scrollTop` straight to the anchor and returns, ahead of both
animated paths. There is nothing to animate into — the thread is already on
screen and the user named it — and the position is identical to where the glide
and `scrollIntoView` settle, so removing the movement changes only the movement.
`skipNextNativeScrollRef` is still checked *first*: re-entering a chat with a
running turn arms both flags and has always landed at `scrollTop` 0.

**The progress bar is for crossing surfaces.** `App` suppresses the chat surface's
own reasons (`chat-suspense`, `chat-load:`) for one frame after `chatResetKey`
changes, because New Chat and the temporary-chat toggle rebuild the surface around
an empty thread and there is nothing to wait for. Suppression is per reason, never
per window: `studio-mode`/`studio-view` are raised by the same click when you
arrive from Code or Media, and those still show. The frame (rather than the
commit) is what `chat-load:` needs — it reaches `App` through the module-level
store, so the mirroring effect converts it one commit later than the raise.

**Chunked reveal.** A loaded thread paints its newest `REVEAL_INITIAL_COUNT`
messages, then walks backwards a chunk per frame. Keep the first chunk ≥ 8: the
open-scroll reposition anchors on the last *user* message and needs the rest of
that turn mounted with it, or `scrollHeight` is short and the chat opens scrolled
to the *top*. Derive `messageIndex` from the full array
(`revealOffset + visibleIndex`) or slice-index 0 takes the `messageIndex === 0`
branch and every chunk shifts the thread by 52px.
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

**Detaching must tear the mirror down, and `onSettled` cannot do it.** That
callback runs only for `owner === 'view'`; a turn the user walked away from
settles through `owner === 'runner'` and never touches the listener. So
`commitLoadedChat`'s `!record` branch is the *only* place `isGenerating`,
`streaming`, the thinking pair, `generationAbortRef` and `sendInFlightRef` come
back down. Leaving them set is not cosmetic — it shipped as the bug where
backgrounding a reply and opening another chat left the composer rendering
**Stop while still holding the backgrounded turn's `AbortController`**, so the
next click killed a response in a chat the user could not see, and
`sendInFlightRef` blocked every send from that view for good. `handleStopGenerating`
now resolves its target through `attachedTurnIdRef` + `getChatTurn` so the same
class of staleness cannot come back through a different route. That branch
**clears; it must never abort** — the whole point is that the turn keeps running.
`background-chat-turns.test.mjs` pins both halves.

**Abort on:** delete, scope/workspace/account switch, sign-out, incognito
unmount, and the stop button (attached turn only). The account switch is why
`AuthContext` holds back a "no user" for `SIGN_OUT_CONFIRM_MS`: another tab
starting up made Firebase report one for about two seconds, which aborted every
running turn in the first tab whenever a second was opened. **Never on** unmount or chat
switch. Delete is the sharp one: `saveLocalFSChat` clears the tombstone and
re-adds the id, so a completion landing after a delete *resurrects* the chat in
IndexedDB, in Recents and on disk, and it survives the reconciler. Hence
`willow_chat_deleted`, dispatched before the body is removed.

**Reload.** Nothing survives a tab close mid-request, so the runner checkpoints
the partial response every `CHECKPOINT_INTERVAL_MS` as `wasStopped: true` — the
existing "ended early but keep it" shape, which `hasSavedMessageContent` retains
even when empty and the thread renders with the divider.

**Another tab carries it on.** A turn in a saved chat (not temporary, folder
connected) is also a `chat-turn` background job (`platform/core` AGENTS.md). Closing
or reloading the tab hands it to another open Willow tab, whose
`resumeChatTurn` reads the chat back, finds the question by id (or uses the copy
in the job, if the tab closed before any checkpoint), and runs the turn again
under the **same assistant id**, so its saves replace the checkpoint in place.
Regenerated, not continued: no provider reliably carries on from half a message.
The job records the model id, notebook, Gem and composer tool, because those live
in the sending tab's UI, not in the chat file; a rename reaches the job through
`rebindChatTurnChatId`. A tab showing that chat picks the turn up through
`chatTurnsVersion` and the ordinary reload, which attaches in `commitLoadedChat`.
Verified live with `tools/scratch/bg-takeover.cjs chat`.

**A checkpoint is a crash artefact, so on re-open the record outranks it — for
the assistant message only.** That `wasStopped: true` is written while the turn
is still running, so the saved thread carries the assistant id well before the
turn ends. `commitLoadedChat` therefore *substitutes* the record's assistant over
the saved one instead of skipping an id the disk already has. Skipping it shipped
as the bug where re-entering a chat mid-turn painted the last checkpoint
verbatim — a truncated reply under a "You stopped this response" divider, for a
turn that was still streaming, which then rewrote itself in front of the user
when the answer landed. It matters for a settled record too: if the runner
exhausted its save retries, deferring to disk would commit the stale checkpoint
permanently through the autosave path. Substitution is in place, not an append,
or the thread reorders on every open.

**The user message resolves the other way, and the asymmetry is load-bearing.**
Only an absent one is appended; a saved one is left alone. The record's copy went
through `stripAttachmentObjectUrls` — those blob URLs belong to the ChatView that
created them and are revoked on its unmount — so the load path's freshly hydrated
copy is the one whose images render. Substituting the record's there blanks every
attachment on the turn you just came back to. Do **not** try to save
from `beforeunload`/`pagehide`: an IndexedDB transaction started during unload
routinely never commits, so it only appears to work. The 2s floor is deliberate
too — every save bumps the chat timestamp, and Recents sorts newest-first, so a
tighter cadence re-shoves the chat to the top of the sidebar on every tick.

**Naming.** `fetchTitle` has no cancellation and outlives unmount, and
`messagesRef` is frozen at whatever the dead component last saw — for a
backgrounded turn, the empty placeholder, which `hasSavedMessageContent` drops.
Landing after the runner's save, that would write the user message alone and
*erase the reply*. It therefore prefers the live record when one is running.

## Canvas

Matched to Gemini's October 2026 canvas, measured over CDP at 1536x826 and under
390x844 / 800x1280 emulation (scripts in `tools/ui-research/scrapers/gemini/canvas-2026/`,
gitignored; the values are repeated in `src/canvas/canvas.css` beside each rule).
`apps/studio/test/canvas-2026.test.mjs` pins them, and the smoke test renders both
surfaces.

**The flow is Gemini's three steps.** A canvas arrives as the turn's expanded card. Its
`Close` folds it to the chip; the chip (or its `Open`) expands it back IN PLACE. Only
the card's `Fullscreen` reaches the panel — it is the card's `onOpen` prop, the one
press `canvas-refs-plumbing.test.mjs` allows to call `handleOpenCanvas`. The panel's
`Collapse` returns to the expanded card. The panel has no cross.

**Full screen is full width.** With a canvas open, `ChatView`'s grid has ONE track
(`canvasFullWidth`): the panel fills it edge to edge (full height, no border or radius)
and the chat column is laid over it in the same cell, inert,
at the width it already had — the thread is `invisible` (never unmounted or
`display:none`, which would lose the scroll position), the composer fades out over
500ms, and the "Ask Willow" fab (`CanvasPromptFab`) takes its place. The resource
panel keeps the split layout; `splitThread` is what narrows the thread, and it is
false behind a canvas. Below 960px the panel is portalled to `document.body` (z 900):
inside `ChatView` an ancestor's stacking context left the shell's mobile header icons
on top of the toolbar, taking its taps. There is no fab below 960px — Gemini's phone
and tablet full screen offer no prompt.

**The fab's floating chat is a conversation, not a toast.** Hovering or pressing the
fab opens the pill; sending turns it into Gemini's `floating-chat-window`, which lists
EVERY turn asked since the pill opened (the question at once, before its turn exists),
renders answers as Markdown at the window's 15/20, and shows the dots while the thread
generates. A plain answer stays on screen. The window closes itself only when the
newest answer is complete and wrote the canvas — the old close-after-every-turn timer
is what made answers vanish. It does NOT close on pointer-leave or Escape (Gemini's
does neither); a press outside it does. A question sent mid-turn waits with the input
disabled and goes the moment the turn ends, because `handleSend` silently drops a send
while a turn runs. These rules are pure functions in `canvas-floating.ts`
(`floatingTurns` reads the thread — the generating answer from the `streaming`
buffer, never `content`; `floatingWindowView` derives what the window shows), and the
tests run them.

**Ask Willow on any page is the same pill and window.** In the desktop app, the
right-click menu on selected text starts with Ask Willow
(`apps/studio/src/shell/rail/ContextMenu.tsx`), which opens `AskWillow.tsx` (its request
in `ask-willow.ts`): `CanvasCoCreateInput` 4px under the selection (above it where the pill
does not fit below), turning into the floating window once a question is sent — the same
`FloatingReply`, `ThinkingDots` and `cv-float-*` classes, not copies. It is not the canvas's
thread: the conversation is the window's own and is not saved, the first question carries
the passage (`askAboutPrompt`), and `streamChat` answers with the composer's model and
Willow's chat system prompt, without tools. The input is disabled while an answer streams;
a press outside or Escape closes the window and stops the answer. It keeps inside the
viewport as it grows, and its header drags it.

**Breakpoints are Gemini's, measured edge by edge.** The narrow card is
`max-width: 600px` inclusive (600 wraps, 601 does not); the narrow toolbar's title
hides at `max-width: 480px`; the toolbar's tokens and layout switch at 959.98px. The
card's title row wraps rather than overlapping: the actions (Code / Preview, Download
or Export, Share, Fullscreen, Close) are ONE group, and the title group cannot shrink
below its versioning trio, so when the actions no longer fit they drop under the title,
right-aligned. Gemini's own row overflows between 601px and ~690px (its title goes to
zero and the redo arrow slides under the toggle); Willow's did too while the toggle sat
inside the title group. The same rule covers the 476px split thread beside the resource
panel. The overflow panel under `more_vert` is shrink-to-fit from the container's left
edge — no right edge and no width — which is what makes it 148px on a phone and the
container's width on a tablet.

**The prose editor is rich text, not Markdown.** `CanvasRichEditor` is a
`contenteditable` whose DOM the browser owns; `canvas-markdown.ts` builds its HTML
from the Markdown and serialises edits back (lossless for headings, emphasis, lists,
quotes, code, tables, links and `$`/`$$` math, which are atoms carrying `data-tex`).
Two traps, both hit while building it:

- `dangerouslySetInnerHTML` must be ONE object for the editor's life. React compares
  that prop by identity, so a fresh `{ __html }` per render rewrites innerHTML on
  every re-render — the selection collapses the moment a mouse-up reports it, and
  typing is thrown away.
- Outside changes (a new version, a scrub) are written by a layout effect only when
  `content` differs from the last Markdown the editor sent — the same echo rule as
  `useCanvasDraft`.

The Styles menu and the `more_vert` formatting row drive `execCommand` through the
editor's handle; their buttons `preventDefault` on mouse-down so the selection
survives the press. A non-empty selection opens the "Ask Willow" co-creation pill 4px
under it, and the fab steps aside (`$canvasSelectionPromptOpen`) while it is open.

**The code panel** keeps the sibling trick (the iframe is hidden, never unmounted, on
the Code tab). The preview shim now also relays `console.*` to the panel's Console and
answers select-and-ask's region query with the elements inside the rectangle — an
opaque frame cannot be screenshotted, so that list is what the model is told. Code is
coloured with Gemini's Monaco palette (`.cv-code-tokens`, plus `colorBrackets` for
bracket-pair depth), inside a box inset 48px from the panel's sides.

**Two departures, both forced.** Share hands the document to the system share sheet
or copies it — Gemini mints a public link, and Willow has nowhere to host one. Export
to Docs is real: a `drive.file` token from `@willow/personal`'s Google token source
and a multipart upload Drive converts from `text/markdown`; without a configured
client or consent it says it could not export. One departure is a choice: below 960px
the code panel's overflow keeps Download, where Gemini's narrow code toolbar has none.

**Icons** name Gemini's own faces (Luminous Symbols / Google Symbols). Both are subset
fonts in `apps/studio/index.html`, and a missing ligature renders as its own name in
words. Add icons ONLY with `tools/icons/icon-kit-superset.cjs --family=… --add=… --write`:
it reads the current kit's ligatures out of the font file and refuses to write a kit that
lost any. Building the list from names harvested out of the source (what the retired
`w-symbols-subset.cjs` and `scrapers/flow/54-symbols-subset.cjs` do) drops every icon the
code names outside a quoted string — the sidebar's `side_nav` is JSX text — and did so on
Oct 4 2026, turning the sidebar toggle into the word "SIDE_NAV".

## Creation tools and Deep Research

Gemini's Create image / Create video / Create music and Deep research, measured off the
live app in October 2026 (scripts and dumps in
`tools/ui-research/scrapers/gemini/media-tools-2026/`, gitignored; values repeated beside
each rule in `src/media/media.css`, `src/composer/composer-companion.css` and
`src/research/research.css`).

**Media are client tools.** The composer tool decides the declaration
(`media/media-tools.ts`: `generate_image` / `generate_video` / `generate_music`); with no
tool attached all three are offered, never forced (`MediaToolMode` `auto`), once there is a
Gemini key, so "draw me a cat" draws one as Gemini does, and the message's images go along
as the source to edit or animate. Deep research stays chip-only, as in Gemini. The
runner routes the call after Canvas, and `media/media-host.ts` calls the generators with
the Media app's model picks and the Gemini key. Every item is published to
`record.media` the moment its call starts — the waiting state IS the card — and mirrored
onto the message through `onPhase`, then handed back by `finalizeAssistant` like
`canvasRefs`. Files go through `keepGeneratedMedia` in ChatView: the blob cache, the
chat's IndexedDB scope, and the chat folder (`chatAttachmentRefs` counts media). A saved
item that never finished comes back as an error card (`sanitizeSavedMedia`).

**"Make it cuter" carries the image.** The generators see only what the request hands
them, and a follow-up has no attachment. So `generate_image` and `generate_video` take
`use_previous_image`, which the model sets when the user asks to change or animate an
image already in the conversation. `media-host.ts` then reads the newest image in the
thread (`media/previous-image.ts`: a finished generated image or one the user sent,
newest message first) from the blob cache, else the chat folder. That image goes first
in the image model's inputs; for a video it is the still only when the message brings
none. A message that sends a thread image again (the image card's Edit) gets nothing
added, since that image is the one to change; a new upload still goes along with the
newest image. `chat-history.ts` notes each item in the reply that made it (`mediaContext`: "[You
made an image here, from the prompt: …]"), so the model knows there is an image to
change and what it showed. Music never takes one.

**An image sits where its call ran.** An image with text written after its call is a cut
at `item.index`, snapped by `canvasSplitOffset` the way a Canvas card is. Text written
before the call stays above it, and the rest goes 16px under it. An image at the end of
the reply, and every video and track, are drawn after the text, as Gemini lays them out
("Your video is ready!" above the player). The image's tool result tells the model that
its next words appear under the image. Moving from the end into the reply mounts the
card again, so `GeneratedImage` remembers which URLs have zoomed in (`shownImages`) and
shows those at once (`.is-shown`) instead of zooming in a second time. `tools/scratch/willow-media-followup.cjs` checks
both against a mocked API, before and after a reload.

**The waiting states are Gemini's.** Image: the status row says "Creating your image" and
a 708-square shimmer (`.gm-shimmer`, Gemini's -65deg sweep) sits 16px under it, whatever
the asked shape. Video and music show only the status row (the video's sentence runs to
two lines, so the row aligns its dots to the first). A finished image hangs 16px left of
the text (on a phone it runs 16px past both edges), a landscape video bleeds 16px past both
edges at every width, a track is a 420 square of cover art; the action row's glyphs sit
12px under an image or video (22 under a track), and Share replaces Copy there
(`ResponseActions`' `media` prop; a track has neither), until 960px and below, where the
row is the ratings, regenerate and more. The viewer's image is `min(1024px, 75vw)` wide,
95vw on a phone with the exit 12px in, and vertically centred.

**The composer gains Gemini's companion row** (`composer/ComposerCompanion.tsx`): Aspect
ratio for images, an add-image chip and Landscape/Portrait for video, Length / Vocals /
Genre for music, Sources / Files for Deep research. Menus open above the chip, bottom edge
on its top; at 600px and below they are a `GeminiBottomSheet` with Done. Video's and Deep
research's rows go once a conversation is on screen (the composer's `conversation` prop,
not `docked`: a gallery docks the box too, and Gemini keeps the video row under its gallery);
image and music keep theirs. Below 960px an unpicked Aspect ratio chip is its glyph and
chevron. A creation tool alone does not enable Send — text, a file or a
template does. **The tool chip stays 24px on purpose**: Gemini's is 36px now, that
reading was tried and reverted (see the note above `ToolChip`).

**A creation tool picked on the zero state opens its gallery** (`media/MediaGallery.tsx`)
and docks the composer (`galleryTool` joins `isThreadDocked`). Scrolled to its end, the last
row sits 56px over the prompt box for every tool and at every width, as Gemini's does
(`.gm-gallery`'s bottom padding; `tools/scratch/gemini-gallery-bottom.cjs` and
`willow-gallery-bottom.cjs` measure both). Cards, tabs, art, hover art,
preview tracks and each template's placeholder come from `media/media-templates.ts`,
generated from the captures by `tools/media/gen-media-templates.cjs`; the style prompts
in it are Willow's own (Gemini's are not in its client). A picked template is a tile in
the attachment strip and rides to the turn as `toolOptions.template`. Gemini serves and
reshuffles this set, so it is a snapshot. The video tool's first open shows the "Create
videos" card (`media/VideoDiscoveryCard.tsx`, dismissal in localStorage
`willow.videoDiscoverySeen`).

**The sidebar's Images and Videos are creation pages**, Gemini's `/images` and `/videos`: a
new chat with the tool picked, each lit in the sidebar instead of New chat. `chat-page-store.ts`
carries them — the sidebar (or an address opened at one, through `ShellRouteSync`) sets
`$chatCreationPageRequest`, ChatView picks the tool through `ComposerHandle.selectTool` and
publishes `$chatCreationPage`, and the address follows it until the first message makes it the
chat's own. Removing the chip, another tool or New chat ends the page (`/app`). `/videos` is the
video gallery; `/images` is a page of its own (`media/ImagesPage.tsx`, not the gallery): a hero
215px down, the composer placed at 379 (447 under a tablet's bar) and scrolling with the page,
and a carousel of five templates plus a 2x2 tile that opens the whole set as a grid ending in a
Close card. On a phone the carousel scrolls sideways and the composer docks. The carousel and
the grid each fade in as they are put in (Gemini's `fade-layout`: 0.4s ease-in-out), so the
tile and Close fade too. The page keeps its scrollbar's gutter at every width
(`.gm-images-scroller`, Gemini's `scrollbar-gutter: stable`), and the composer's layer is given
the same inset on its right, so the grid making the page scroll moves nothing sideways.
`tools/scratch/gemini-images-more.cjs` and `willow-images-more.cjs` record both sides. A card opens its
dialog; "Choose photo" sends the template's prompt with the photo (`ComposerHandle.sendWith`),
Images picked. The set is `media/images-page-templates.ts`, generated by
`tools/media/gen-images-page-templates.cjs`; Plushie's prompt is Gemini's, the rest Willow's.

**Deep Research is plan, confirm, run.** A turn sent with the chip gets
`create_research_plan` (`research/research-tools.ts`) and the instruction not to answer;
the plan lands on the message as `research` and draws the plan card. **Start research is
not a model turn**: ChatView posts "Start research" and the "I'm on it" reply itself,
opens the panel, and hands the plan to `research/research-runner.ts`, which runs six
grounded `runWebSearch` queries in pairs, writes a first-person note after each pair (the
panel's italic thinking), then streams the Markdown report. Jobs live in that module keyed
by the reply's message id, so a run outlives the view; a view subscribes while it shows
the chat, and a chat reloaded mid-run reads the live record. A run that was saved while
going and has no job (the page was reloaded) loads as interrupted. The composer's stop
button cancels a run. `chat-history.ts` shows the model a message's plan or report, which
is what makes "change the plan" and the panel's Create items work.

**The research panel shares the immersive slot** (resource panel, canvas): split layout,
the same scale-in, full screen below 960px, where it is portalled to `document.body` for the
same reason Canvas is (the shell's mobile header icons). Departures, all forced: Sources lists only
Search (Willow reads the web and nothing else); Share & Export has no Export to Notebook,
and Export to Docs downloads a `.doc` rather than creating a Doc; Create has no Audio
Overview. On a phone Contents steps aside and Share & Export is its glyph.

## "@", "/" and "Connecting to"

Gemini's prompt-box menus and its tool status line, measured off gemini.google.com/app in
October 2026 at 1536, 800 and 390 wide (scripts and captures in
`tools/ui-research/scrapers/gemini/media-tools-2026/`: `21-at-menu.cjs`,
`22-at-details.cjs`, `23-connecting.cjs`; Willow's side is checked by `w-mentions.cjs`).

**The menus are Spark's, copied, not imported** (`composer/mentions/`; chat cannot import
Spark, which imports chat). `ChatMentions` listens on the composer box in the capture phase,
so the arrows, Enter, Tab and Escape reach it before `InputBar` would send, and writes the
textarea through its native setter plus an `input` event, so `InputBar` keeps owning the
draft. A picked mention reads bold through a stroked copy of the text laid over the
textarea; Backspace at its end takes the whole mention. Gemini sets a mention at
`'wght' 540` against 400, in #e3e3e3 like the rest of the box's text; the stroke steps
with resolution (0.2px at 1x to 0.45px at 3x) to give the stems that thickness
(`w-mention-stem.cjs`). The pane opens 4px under the line
and flips above it with its bottom 1px into the line, as Gemini's does, placed by its layout
box (the enter animation starts at `scale(0.8)`, which a client rect would report).

**"@" lists the saved models, then the apps** (`use-chat-mention-options.ts`). Picking a
model switches to it. An app is listed only when this turn would be given its tools
(connected with a live token, Personal Intelligence on, not a temporary chat — the same test
as `personal-tools.ts`). **"/" lists the enabled skills** in `@willow/core/skill-library`;
with none there is no menu at all. A send reads its mentions back out of the text
(`mentionsIn`): each "/skill" puts that skill's instructions and supporting files in the
system prompt for the turn, and each "@App" tells the model to answer with that app's tools
(`mention-prompts.ts`). Departures: Gemini also lists the apps it cannot reach, dimmed to
0.38, and Willow leaves them out (the user's call); no "Create new" (Gemini's likeness
avatar); Willow's eight apps rather than Gemini's list; disabled skills are not listed.

**"Connecting to <logo> <app>"** is the thinking row's status heading while a connected
app's tool runs: the runner sets `record.connectingApp` around `runPersonalTool` and
ChatView mirrors it through `onPhase`. It outranks search and code but not a media status,
and `ThoughtSummaryLine` draws the 24px logo with 8px either side inside the line, wiping in
like any heading. Two measured details of that row: its text uses Gemini's `gds-body-l`
axes (`'wdth' 92`), and on a desktop the row drops 4px once it carries a heading (192 against
the bare dots' 188).

## Dictation: the mic beside Submit

Gemini's `speech-dictation-mic-button`, measured off gemini.google.com/app in October 2026 at
1536, 800 and 390 wide, signed out, in a headless Chrome whose microphone is a WAV file
(`gemini-dictation.cjs`, `gemini-composer-states.cjs`; Willow's side is
`w-composer-states.cjs`, whose `submit` phase covers the shortcut and Submit mid-take). What
listens and what transcribes is `@willow/ai/dictation` (see `platform/ai/AGENTS.md`); the
hook only drives it.

- **Idle**: "Dictate (^⇧D)". On a desktop, 32px with the Luminous mic at 24px and weight
  300, in a 48px slot 8px off the model pill and 10px before Submit. An empty box has no
  Submit, and the mic takes its place. At 960px and below the glyph is 28px at weight 260,
  and phones get a 40px button. On a tablet the mic sits 1px above Submit. Attachments and
  tool chips change only the row's height, which `trailingTouchOffset` already follows.
- **Listening**: the mic becomes Gemini's stop button (`send-button stop`): #171717
  (#141414 at 960px and below), the filled Google Symbols `stop`, "Stop dictation (^⇧D)",
  level with Submit. Submit stays, and pressing it ends the take and sends the transcript
  (`stopDictationThen`). Focus moves to the stop button as the take starts, as Gemini's
  does; at 960px and below that draws a 2.4px #e0e0e0 ring, 1.6px out. The waveform fills
  the space between the plus and the stop button: 642→1132 at 1536, 142→608 at 800,
  84→248.4 at 390.
- **The box folds to one line while listening**, as Gemini's does: with a two-line draft
  its box went from 132px to 72px at 800 wide, then came back with the transcript added
  (`gemini-expanded-dictation.cjs`). A 24px line stands in for the hidden text, so
  attachments and a tablet's tool row stay stacked above it rather than sliding under the
  plus. The waveform sits on that line, level with the buttons, and a desktop tool chip
  beside the plus pushes the waveform's start 8px past itself (`--willow-wave-left`).
  Gemini signed out has no uploads or tools, so those two cases follow the fold rather
  than a measurement.
- **Ctrl+Shift+D** toggles a take from anywhere inside the composer, though not during
  Live, where the mic button mutes.
- **After**: Gemini shows no interim text and fills the box once the take ends; so does
  Willow. While on-device voice typing downloads for the first time, a status line
  takes the waveform's place.

Light theme was not captured. There the stop button uses the response stop's #f2f0f0
and the box's #1f1f1f.

## A sent image, full screen

Pressing an image in a sent message opens it over the chat (`media/SentImageViewer.tsx`), as
Gemini's `image-expansion-dialog` does for an upload (`trusted-image-dialog-container`). It is
the generated-image lightbox's backdrop and colour wash with a lighter header — Close, the
image glyph and the file's name (17px, cut at 30vw), More options holding Copy — and no editing.
The image keeps its own size up to 768 wide, never past 95vw nor max(75vw, 480px) (600 on a
tablet, 371 on a phone), and 90vh tall. The thumbnail fades out over 83ms while its image is
open (`GeminiAttachmentCard`'s `previewing`). Gemini closes it only from Close, so a click around
the image does nothing; Escape closes it here too. Other file types still open in a tab.
Recorded at 1536, 800 and 390 wide by `tools/scratch/gemini-sent-image.cjs`; Willow's side is
`willow-sent-image.cjs`, which matches every box.

## Scheduled actions and skills

Gemini's chat saves both from a conversation — "Every Saturday at 10 AM, send me…" is a
scheduled action, "Create a skill…" a skill — and shows each as a card under its sentence.
Recorded on 2026-10-06 at 1536, 800 and 390 wide by using it
(`tools/ui-research/captures/spark/137-create-with-gemini/`); Willow's side is checked by
`tools/scratch/create-with-verify.cjs`.

**They are Spark's schedules and skills** (`library/library-tools.ts`). Chat cannot import
Spark, so it writes through the writer Spark registers in `@willow/core/spark-library`: a
schedule asked for here is on Spark's Schedules page and runs where Spark's run, and a
skill is in the library "/" lists. The tools are declared on any turn that can keep what
they make (`chat-turn-setup.ts`): not in a temporary chat, not with tools off, not on a
Deep Research turn, and not in a build without Spark.

- **Never a second copy.** A turn retried after a dropped stream calls again, and so does
  one another tab takes over; a call the turn already answered gets that answer, and a
  schedule identical to one that is on, or a skill identical to one saved, is shown rather
  than saved. That is also why `resetForRetry` keeps `record.created`.
- **The card shows when the save lands** (`record.created`, mirrored through `onPhase`
  like media), is on the saved message (`created`), and survives settling, an error
  included: `finalizeAssistant` does not list it, so the mirrored value stays.
- **The scheduled action's card is Gemini's `live-prompt-card`**: a 32px `#003d64` clock
  (`schedule_auto`, from Luminous Symbols — the Google Symbols subset lacks it), "Saturday
  by 10 AM" (`formatScheduleDue`), the title and request on one line each, the on/off
  switch and ⋮ with Edit and Delete. It reads the Spark schedule live, so a switched-off
  one shows off and a deleted one says "Deleted". Edit opens Spark's schedule editor
  through the shell (`requestSparkLocation`); Delete asks first.
- **The info note** is Gemini's `xap-inline-dialog` (a `#1f3760` note over the icon, 14px
  of it to the left). Gemini's says actions are "prepped in advance"; Willow's run at about
  their time while it is open, and the note says that.
- **The skill's card is `ConfirmationCard`** from `@willow/ui`, Spark's card too, titled
  with the skill's name. A scheduled action's card sits 16px under the text and 20px over
  the action row, a skill's 24px and 28px (set inline in ChatView, against `space-y-3`).
- **A seeded chat** is what Spark's Skills page "Create with Gemini" opens: ChatView takes
  the seed as it mounts (`takeChatSeed`) and plays it as Gemini's appears — the prompt, the
  thinking row, then the reply revealing — with no model behind it. The reply waits in a
  ref, because StrictMode's second effect run would otherwise drop it.

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
The bytes are in IndexedDB and, beside the chat's file, in
`Chats/<chat>/Attachments/<name [hash].ext>` (`platform/storage/ARCHITECTURE.md`
§6a). `hydrateSavedAttachments` passes the chat's id so a miss in IndexedDB is read
from that folder; an attachment found nowhere comes back `unavailable`, and
`GeminiAttachmentCard` draws it as a quiet "Unavailable" tile rather than a broken
image or a plain file chip.

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
