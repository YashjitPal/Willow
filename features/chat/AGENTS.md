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
| `src/chat-timing.ts` | `waitForBrowserPaint()` — yields one frame so an intermediate render is actually seen. |
| `src/chat-store.ts` | Nanostore. The `newChatSignal` "New Chat" broadcast. |
| `src/composer/Composer.tsx` | `InputBar`, the prompt box (885 lines). Attachments, tool chips, send, and the two JSX branches. Re-exports `ModelsMenu` so its public surface is unchanged. |
| `src/composer/composer-options.tsx` | The composer's static option tables: `TOOLS`, `TOOL_SYMBOLS`, `THEMES`, `MODES` and their types. |
| `src/composer/composer-icons.tsx` | `SpotifyIcon` and `ModelIcon` — inline SVG/provider glyphs. |
| `src/composer/ModesMenu.tsx` | The mode dropdown. |
| `src/composer/ThemesMenu.tsx` | The theme dropdown. |
| `src/composer/ModelsMenu.tsx` | The model + thinking-effort picker (400 lines). Also imported directly by Code's `CodeHome` and `WorkbenchSidebar`. |
| `src/composer/use-composer-dictation.ts` | The whole dictation subsystem: recording, transcription, caret restoration (343 lines). |
| `src/composer/use-composer-models.ts` | Resolves the selected model/effort id and derives the pill labels. |
| `src/composer/use-composer-textarea-autosize.ts` | The RAF-throttled textarea measurement, and the two flags the layout derives from it. |
| `src/composer/use-composer-chat-layout.ts` | `useCollapsedChatPaddingRight` and `useFullscreenShellCentering` — the two chat-variant layout measurements. |
| `src/composer/DictationWaveform.tsx` | Canvas mic waveform shown while dictating (234 lines). |
| `src/composer/PlusDropdownMenu.tsx` | The + button dropdown (attachments, code, images, etc.). |

## Architecture

Chat owns the UI, not the LLM call — `@willow/ai/chat` owns that. `ChatView`
holds the thread state in its own `useState`; `chat-store.ts` is only a signal
atom that lets the Code workbench's sidebar and top bar trigger a new chat from
outside.

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

`Composer.tsx` was 2036 lines and is now 885, across the nine modules listed
above. It ran out of extractable leaves after `ModelsMenu`, so the remaining four
splits are **hooks**, and they follow one rule:

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
extra wrapped line, and it restores `transition` only after a forced reflow so
the collapsed→multiline padding animation still plays.

What is left in `Composer.tsx` is `InputBar`'s two JSX return branches, each
closing over ~40 values. Splitting those means writing a props contract, not
moving text — do not attempt it as a mechanical extraction.

The composer's dropdowns animate through CSS keyframes declared in
`apps/studio/index.html` plus a 150ms `setTimeout` before `onClose`. There is no
`AnimatePresence` or `motion.*` anywhere in `Composer.tsx` — do not "restore"
any.

**Do not move a `motion.div` that is a direct child of `AnimatePresence`.** In
`ChatView` that means the `ThinkingStepsSidebar` and `RichResourcePanel`
wrappers, the thread-entrance div, and the `layoutId={CHAT_COMPOSER_LAYOUT_ID}`
composer — the shared-layout transition into the Home hero runs through that ID.
Extracting a wrapper puts a component boundary where Framer Motion tracks
presence, and a broken exit animation is not something a typecheck would catch.

`ChatView.tsx` and the composer files are **LF**, unlike `ChatResponseChrome.tsx`
(CRLF) and `composer/PlusDropdownMenu.tsx` (mixed). Match the file you are in.

## Dependencies

Imports from 8 Willow packages: `@willow/ui` (10), `@willow/ai` (6),
`@willow/core` (4, attachments), then `@willow/storage`, `@willow/auth`,
`@willow/media`, `@willow/code`, and `@willow/studio`.

The last four are cross-feature and worth knowing about. `ChatView` renders
Media's `HeroSection` and `BottomPanel` directly — the Home tab's hero *is* the
chat composer, which is why the shared `layoutId` matters. The composer reaches
into Code for `GithubImportDialog` and up into the Studio shell for
`BackgroundContext`.

Chats and their attachments persist through
`@willow/storage/local-fs/LocalFSContext`; blobs are cached in a
`Map<string, Blob>` ref in `ChatView` and re-read from storage on a miss.
