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
| `src/composer/Composer.tsx` | The prompt box (2036 lines). Attachments, model toggling, send. |
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
