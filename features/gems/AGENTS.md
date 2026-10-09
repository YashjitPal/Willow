# @willow/gems

Gems are custom versions of the chat assistant: a name, a description, instructions, an
optional default tool, and knowledge files. This feature is Gemini's Gems, cloned from
the live app by measurement at 1536x826, 800x1280 and 390x844. It covers the manager,
the editor with its live preview, and a Gem's chat.

Gemini's Labs Gems and the "Gems will become skills" banner are deliberately not built.

## Routes

| Path | What renders |
| --- | --- |
| `/gems`, `/gems/view` | `GemManager` in `GemsView.tsx`: premade cards, then My Gems |
| `/gems/create` | `GemEditor` (empty, or a copy when router state carries `copyFrom`) |
| `/gems/edit/<id>` | `GemEditor` for a saved Gem |
| `/gem/<id>` | The chat surface, with the Gem as context (see *Gem chats*) |

`matchGemsRoute`, `gemPath` and `gemEditPath` in `GemsView.tsx` are the only places
that spell these out.

## Structure

- `src/GemsView.tsx`: routing, the manager, the row and card menus, share (exports
  the Gem as `<name>.json`) and the delete dialog.
- `src/GemEditor.tsx`: the editor (form plus preview) and its menus, plus the "Close
  without saving?" guard. Below 961px it becomes the Editor/Preview tabbed layout.
- `src/GemAddNotebookDialog.tsx`: Gemini's "Add notebook" picker, which lists Willow's
  notebooks.
- `src/GemMenu.tsx`, `GemTips.tsx`, `GemLogo.tsx`, `GemZeroState.tsx`: the shared
  pieces. These are the `mat-menu` (and its `upload` card variant), the info popover,
  the letter/symbol logo, and the logo-name-description card with its starter prompts.
- `src/gem-types.ts`: the `Gem` model, default tools and logo palettes.
- `src/premade-gems.ts`: the eight premade Gems, all text-only, in Gemini's order. Six
  are Gemini's. Its two image Gems (Chess champ, Storybook) are replaced in place by
  Willow's Language tutor and Trip planner. All carry Willow-written instructions. A
  `/gem/<id>` that no longer resolves sends the user to `/gems`.
- `src/gems-store.ts`: `gemsStore` and CRUD, `parseGem`/`sortGems`, and the
  chat-to-Gem index.
- `src/gem-chat-store.ts`: `$chatGemId` (the Gem the open chat belongs to) and
  `buildGemSystemPrompt`.
- `src/gem-knowledge.ts`: knowledge helpers. A notebook becomes a snapshot of its
  readable sources.
- `src/register.ts`: registers `Gems/` as a synced workspace folder.
- `src/gems.css`: every style, desktop first, then the `max-width: 960px` blocks, then
  light theme.

## State and persistence

`gemsStore` (nanostores) holds the user's Gems. `hydrateGems()` reads
`localStorage['willow_gems:v1']` once, and a subscription writes every change back.
`gemsWriteErrorStore` reports a full quota. Premade Gems are constants and are never
stored. Copying one makes an ordinary custom Gem.

Gems also sync to `<workspace>/Gems/<gemId>.json` through the shared synced-folder
registry, so this feature owns **no** sync logic of its own. `src/register.ts` declares
the folder and how a Gem serializes, and
`platform/storage/src/local-fs/folder-sync-engine.ts` does the rest. This is the
reference implementation for that seam — see
[ARCHITECTURE.md §13](../../platform/storage/ARCHITECTURE.md#13-how-to-extend-safely-recipes).

Two rules keep the folder from losing Gems, both pinned by
`apps/studio/test/gems-disk.test.mjs` and walked in a browser by `tools/scratch/w-gems-folder.cjs`:

- **The descriptor reads the Gems itself.** A pass runs on every page once a folder is
  connected, Media and Code included, where nothing has called `hydrateGems()`; an empty store
  read then would delete every Gem's file and tombstone its id. `readLocal` and `applyRemote`
  call `hydrateGems()` first.
- **`reviveLocal: true`.** A Gem made with a deleted one's name gets the same id, which the
  engine holds a tombstone for. The store holds only what the user has (one list every tab
  shares, which a deletion leaves at once), so the driver lifts the tombstone and writes the
  Gem; without it the Gem was never written and the next pass from disk dropped it.

**A Gem's `id` is its file name stem.** `makeGemId` strips the characters a filesystem
cannot round-trip, and `createGem` appends ` (2)`, ` (3)`… on a collision with another
Gem or a premade id. Never let an id change on its way to disk.

`parseGem` is lenient on purpose. It accepts files written before default tools,
knowledge and `hideCitations` existed (an unknown tool becomes `'none'`), and it omits
absent optional keys so a round trip is byte-stable.

Knowledge text is stored inline and capped at `MAX_KNOWLEDGE_CHARS` (120k) per file,
with `problem` recording a truncation or an unreadable file. These are the knowledge
uploader's five sources:

| Source | Behaviour |
| --- | --- |
| Upload files | Read through `extractSourceText` from `@willow/notebooks` |
| Import code | `GithubImportDialog`: a repository's text snapshot, or a local folder's files |
| Notebooks | The "Add notebook" picker. Each notebook is added as one Markdown snapshot of its sources; later edits to the notebook do not follow |
| Add from Drive | Shows a toast; not connected yet |
| Google Photos | Shows a toast; not connected yet |

## Gem chats

Opening `/gem/<id>` sets `$chatGemId` (App.tsx), and ChatView then does four things:

- It shows `GemZeroState` instead of the hero. A premade Gem's starters send directly.
- It prepends `getActiveGemSystemPrompt()` (instructions first, then the knowledge
  passages `selectChunks` picks for the question) to the system prompt.
- It preselects the Gem's default tool through the composer's `defaultTool` prop.
- It records `chatId → gemId` (`recordGemChat`), so reopening the chat from history
  restores the Gem.

New chat clears the atom. Below 961px the shell's top bar shows New chat rather than
the temporary-chat button and avatar, as Gemini does in a Gem's chat.

## Narrow screens (960px and below)

All of it lives in `gems.css`.

- **Manager:** the page hangs under the shell's 68px bar (Willow wordmark plus New
  chat, drawn by `StudioLayout`). Show more goes away, and the premade cards become
  one row that scrolls sideways. The row runs edge to edge of the screen, with the
  page's 24px inset moved onto its contents, so cards slide out at the screen edges
  rather than vanishing 24px short of them.
- **Editor:** the bar shows the model picker (`renderModelPicker`, the same one as the
  notebook page). The title row, the full-width Save row and the Editor/Preview tabs
  stay put, and only the form scrolls, above the pinned legal line. The instructions
  box rests at 120px and grows to 200 while focused (300 on desktop).
- **Gem chat:** the zero state is centred under the bar (padding 84/6), with its
  description left-aligned.

## Light theme

Gemini's light Gems pages could not be measured: switching the live account's theme is
a setting change. The light rules at the end of `gems.css` use the light tokens the
notebooks and dialogs already use.

## Dependencies

- `@willow/ui`: `MaterialSymbol`, `Tooltip`, `GeminiDialog`, `GeminiAttachmentCard`,
  `StreamingMarkdown`, `GithubImportDialog` and the copy toast.
- `@willow/ai/chat` and `@willow/chat/chat-model`: the preview and Power up.
- `@willow/notebooks`: source extraction and retrieval, plus the notebooks store for
  the picker.
- `@willow/storage/synced-folders`: registration.

Tests are in `apps/studio/test/gems.test.mjs` (store, prompt, knowledge and layout
rules) and `synced-folders.test.mjs` (the disk round trip).
