# features/chat

The Chat app. The simplest feature: a thread of messages, a composer, and an
LLM-backed response stream. Loaded as the "Chat" tab in Willow Studio.

## Files

| Path | Role |
| --- | --- |
| `src/ChatView.tsx` | The chat tab surface (2069 lines). Threads, history, model selection. |
| `src/chat-store.ts` | Nanostore. Active chat threads. |
| `src/ChatResponseChrome.tsx` | The decorated container around an LLM response (copy, retry, etc.). |
| `src/composer/Composer.tsx` | The prompt box (2036 lines). Attachments, model toggling, send. |
| `src/composer/DictationWaveform.tsx` | Canvas mic waveform shown while dictating (234 lines). |
| `src/composer/PlusDropdownMenu.tsx` | The + button dropdown (attachments, code, images, etc.). |

## Architecture

Chat is driven by `@willow/ai/chat.ts` — it owns the UI, not the LLM call. The
store (`chat-store.ts`) is the only state; everything else reads from it.
