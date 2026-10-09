# features/media

The Media app. AI-generated images, music, and video, plus character-based
generation (consistent-character storyboards). The "create" tab of Willow Studio.

## Files

| Path | Role |
| --- | --- |
| `src/MediaHome.tsx` | The landing section: a hero with a prompt box, shown on the Home tab inside App.tsx. Its root is also the chat home's glow host. See *The chat home's glow* below. |
| `src/home-glow.ts` | The glow's accent colour per workspace colour, dark and light, desktop and narrow, each derived from a measured Gemini pair. |
| `src/MediaShowcase.tsx` | A bottom panel bar with generated cards; also used on Home. The Code tab's "Your apps" renders it with `mode="develop"`: its `showcase-*` classes are hooks that only `features/code`'s `code-responsive.css` styles, under `.code-apps-section`, and below 961px that copy's card menu is a bottom sheet. The Media tab's copy is unchanged. |
| `src/MediaView.tsx` | The full Media tab (6966 lines — see below). |
| `src/AnnotationOverlay.tsx` | The image editor's SVG annotation layer (222 lines), split out of MediaView. |
| `src/CropOverlay.tsx` | The crop tool's box + dimming strips + drag handles (70 lines), split out of MediaView. |
| `src/PenMenu.tsx` | The pen tool's flyout: sub-tools, colour swatches, brush size, undo/redo/reset (229 lines). |
| `src/ToolFlyouts.tsx` | The select (box/lasso) and crop (ratio) flyouts (135 lines). |
| `src/annotations.ts` | The `Annotation` shape and the system prompt built from a user's marks. |
| `src/crop-math.ts` | Pure crop geometry: image aspect ratio, maximized crop box. |
| `src/dropdown-placement.ts` | Whether a dropdown opens up or down given the viewport. |
| `src/PromptTextarea.tsx` | `PromptValue`, the boundary other controls read the prompt through, and the `PromptStore` type. See below. |
| `src/PromptEditor.tsx` | The composer's field: Flow's rich-text editor, a contenteditable that holds text and @ mention chips (`prompt-editor.css`). See *@ mentions* below. |
| `src/media-models.ts` | Which image, video and music models Media offers, the ids Google serves them under, Veo's lengths, and the remembered picks. See *Models come from Settings* below. |
| `src/PromptNotice.tsx` | The line above a prompt box when a generation can't start, with an "Add a model" / "Open Settings" button. |
| `src/GalleryTile.tsx` | One gallery tile: the memoized `GalleryTile` shell plus the private `TileContent` interior. Also exports `MediaTilePreview`, the tile's surfaces without its chrome, which the agent sidebar's chat cards render. |
| `src/gallery-layout.ts` | The grid's justified rows (`layoutGallery`), the one layout All media and the Characters tab share. |
| `src/preloadable-lazy.tsx` | `React.lazy` with a `preload()`: once fetched, the page renders on its first frame instead of suspending. The character pages use it. |
| `src/video-still.ts` | The still of a video's first frame that a video tile shows until it is first hovered. See *What a big gallery costs* below. |
| `src/EditorBoundary.tsx` | The error boundary around the full-page editors: a failure closes the editor instead of blanking the app. |
| `src/gallery-tile.css` | The reveal that plays when a generated image lands. Every duration measured, not chosen — see below. |
| `src/types.ts` | `MediaItem`, `MediaKind`, `MediaStatus`, `ImageAttachment`. Shared by MediaView and AgentSidebar. |
| `src/media-icons.tsx` | The 11 hand-drawn SVG rail icons (vinyl record, scenes, aspect-ratio rectangles). |
| `src/sunflower-art.ts` | A ~9KB pixel-art `box-shadow` string, alone in a file so it stops wrecking greps. |
| `src/AgentSidebar.tsx` | The agent's panel: transcript, live status, approvals, settings, instructions and chat history. Renders a session; never calls a model. |
| `src/agent/agent-tools.ts` | The agent's eight tool declarations and its system prompt. Every tool declared here has an executor in `agent-session.ts`. |
| `src/agent/agent-session.ts` | One conversation and its turn loop, outside React: streaming, tools, Stop, approvals, Retry, titles, saving. Saved in `WillowMediaAgentDB` and, with a folder connected, as `Media/<project>/Agent sessions/<id>.json` with each upload beside it in `<id>/Attachments/` (named by `file` when sent, since the bytes are only in memory while the chat is open). Gallery picks and characters are the project's own files and are not copied. |
| `src/agent/agent-context.ts` | Pure: what the prompt says about the gallery, characters, scenes and the screen, a cast's references and note, and a scene's new clip plan. |
| `src/agent/AgentLinkCards.tsx` | The chat's character and scene cards, opened into the character page or the Scenebuilder. |
| `src/agent/AgentThinkingRow.tsx` | Chat's thinking row in the agent's chat: the dots and the newest thought heading or tool status. |
| `src/agent/AgentUserBubble.tsx` | A sent prompt, folded past four lines behind Chat's chevron. |
| `src/agent/AgentStatusText.tsx` | The prompt box's one-line "Thinking... / Generating 2 images..." label while the agent works, subscribed on its own. |
| `src/scenes/` | Scenes and the Scenebuilder editor, cloned from Google Flow. See *Scenes* below. |
| `src/tv/` | Willow TV, Flow TV with Willow's own videos and scenes, at `/tv`. See *Willow TV* below. |
| `src/tools/` | Flow's Tools tab: the Tools page, a tool's page, Create tool, the Tool Builder (a fork of the Code harness) and the runtime Flow's tools run on. See *Tools* below. |
| `src/MediaSidebar.tsx` | The rail: the gallery tabs, Tools with its dock of pinned and recent tools, Trash, Collapse. MediaView and the Tools pages draw the same one; below 961px it is an icon rail (tablet) or a drawer (phone). See *Phones and tablets* below. |
| `src/use-media-viewport.ts` | `useMediaViewport()` (phone, tablet, desktop), `useTouchScreen()`, and `useKeyboardInset`, which publishes how much of the window an on-screen keyboard covers. |
| `src/MediaCompactHeader.tsx` / `src/media-responsive.css` | The header below 961px, and the narrow rules for the shell, gallery, composer, menus, panels and touch. |
| `src/use-long-press.ts` / `src/TouchMoreButton.tsx` | A touch screen's right-click, and a tile's lasting three dots there. |
| `src/register.ts` | Media's synced folder, `Media/Tools/` (one file per tool of your own); imported once by `apps/studio/src/app/register-features.ts`. |
| `src/AssetMenuModal.tsx` | Right-click / ... menu for a generated asset. |
| `src/music/MusicView.tsx` | Music generation (1524 lines). |
| `src/music/cover-art.ts` | The song cover drawn on the device when no Gemini image model is added. |
| `src/music/MusicPlayerSidebar.tsx` | Player UI while generating/listening. |
| `src/editor/` | Flow's image view (`ImageEditor.tsx`: crop, history column, edit prompt) and the pieces it shares with the video view — the navigation rail, overlays, downloads. See *The image and video views* below. |
| `src/characters/` | Flow's Characters: the grid, the New character page, a character's page and its voice dialog, plus the composer's character ingredient card and reference expansion. See *Characters* and *@ mentions* below. `CharactersView.tsx` there is the old placeholder, no longer routed. |
| `src/collections/` | Flow's collections: the store, the tile. See *Collections* below. |
| `src/drag/` | The gallery drag's preview, label and the composer's drop zone. See *Dragging* below. |
| `src/batch/` | Flow's batch view: the grouping and row rules (`batch-layout.ts`), the list (`BatchView.tsx`), each batch's info column (`BatchInfo.tsx`) and a video's length and size (`video-meta.ts`). See *Batch view* below. |
| `src/HeaderMenus.tsx` / `src/header-panels.css` | The header's panels: View settings (kept in `localStorage`), Filters, the project and top-right menus, the account surface. |
| `src/media-background.ts` | `$mediaWorkRunning` (an agent turn, or anything still generating) and `MediaBackgroundContext` (the editor is kept alive off screen). |

## Leaving the editor while it works

The agent, the generation callbacks and the gallery they fill all live in
`MediaView`'s state, so the shell keeps the editor mounted, hidden, while
`$mediaWorkRunning` is set (`apps/studio` AGENTS.md, "Screens that keep working
after you leave them"). Hidden, it is rendered against its last `/media` location,
and `MediaBackgroundContext` is true. Three rules follow for anything new here:

- **Body-level portals must honour it.** The Scenebuilder, the character pages and
  the editors stay mounted but take `inert` and `BACKGROUND_OVERLAY_STYLE`; the
  snackbar host and hover previews are not rendered. A new `createPortal(…,
  document.body)` that is open while the user can leave would otherwise sit on top
  of Chat.
- **Global key handlers check the real URL** (`window.location.pathname` starts
  with `/media`), as the gallery's G / + / − / 0 shortcuts do: the hidden editor
  still has its listeners.
- **Opening another project stops the first one's work**, since the character,
  scene and collection stores hold one project.

**Closing the tab hands the work to another one** (`src/media-jobs.ts`). While the
editor works it holds one `media-work` job: the project, the agent conversation
whose turn is running (with its question, in case the conversation never saved),
the items still generating that the turn did not make, and each video's requested
length, which the item does not carry. The tab that inherits it mounts the editor
hidden for that project, and:

- **the gallery load keeps those items** (it drops every other `generating` entry,
  as before), and `restartGeneration` starts each again from what it recorded,
  re-reading references from this gallery because the closed tab's `blob:` URLs
  died with it;
- **the agent reopens the conversation** and `resumeInterrupted` runs its last
  request again. The agent now also saves as a turn *starts*, so the question is
  on disk; its placeholder stores as "stopped", the shape `retry` re-runs. A turn
  whose question never reached disk is sent again from the job's copy.

Started again, never re-attached: an image request dies with its tab and Veo's
operation handle was never saved. A generation the interrupted agent turn made is
left to that turn, which makes it again. Unmounting finishes the job (another
project opened here), so only a closed tab hands work on.

## The media agent owns the generation tools

The agent lives in `src/agent/`, and its turns are the **one place in the repo
that pass `enableMediaTools: true`** to `streamChat`. Chat and Code both leave it
off, and only this folder builds the media tool declarations, so `generate_image`
/ `generate_video` are never declared to their turns. That is the invariant
behind the three-agent split: Chat, Code and Media are separate agents, and a
chat turn told it can generate video announces a render that never lands.

The Code harness has a `generate_image` of its own, and it is a different tool:
it saves one picture into the project being built, through
`@willow/ai/image-generation`, and never touches the gallery. It keeps this
feature's rule that nothing generates with a model the user did not add — with
no Gemini image model in Settings, the Code agent is told to use a placeholder.

**Declare only what executes.** `executeTool` in `agent-session.ts` runs every
tool `agent-tools.ts` declares. The suite this replaced was copied from Google
Flow: twenty tools answered by a mock that returned an Unsplash photo, a stock
"stars" clip for four of the video tools, and invented collections, avatars,
Street View images and credit balances. `agent-mode-chat-fusion.test.mjs` parses
both files and fails if a declared tool has no executor, so a new tool is two
edits: the declaration and its `case`.

| Tool | What it does |
| --- | --- |
| `generate_image` / `generate_video` | Make media. Both take `character_ids`. |
| `create_character` | A new character: name, look, info, voice, its portrait and optionally a full-body shot. |
| `update_character` | Any of: rename, new info or voice, a new look (`change_look`), a new full-body shot. |
| `create_scene` | A scene from gallery videos, in story order. |
| `update_scene` | Rename, append (`add_clip_ids`), or set the whole clip order (`clip_ids`). |
| `list_media` | The gallery, the characters or the scenes, filtered. |
| `analyze_media` | Look closely at one image or video and answer a question about it. |

**Eight tools, one job each.** Every request maps to one tool, and edits fold
into one `update_*` per kind of thing rather than a tool per field, so the model
never chooses between near-synonyms. `media-agent-harness.test.mjs` holds the
line: it pins the eight names, caps each description at 420 characters and the
whole declaration at 14,000. A new option on an existing action is a parameter;
add a tool only for a new kind of action.

**Generations go through MediaView, not around it.** `agent-session.ts` never
imports MediaView. MediaView hands it a `MediaAgentHost` on every render, whose
`startImages` / `startVideos` create the placeholder tiles and call
`generateSingleImage` / `generateSingleVideo` — the prompt box's own functions,
which now return a `GenerationResult`. Agent media is therefore named, saved to
disk and failed exactly like everything else, and works with every image model
the picker offers. Characters and scenes go the same way: `startCharacterImage`
is the character pages' own `launchCharacterImage`, and `createScene` /
`updateScene` are `createSceneFromVideos` / `setSceneClips` in
`scenes/scene-store.ts`, so an agent's scene plays the same "Creating..." reveal.

How a turn behaves, and why:

- **Streaming never re-renders MediaView.** The transcript lives in nanostores
  only `AgentSidebar` reads; MediaView subscribes to `$running`, which changes
  twice per turn. Tokens are flushed to the store at most every 32ms.
- **Media cards appear when a generation starts**, as `media-id:` references that
  `StreamingMarkdown` resolves live from `mediaItems`, so the chat shows the same
  placeholders the gallery does. Results come back with `already_rendered`, which
  stops `chat.ts` appending the cards a second time.
- **The conversation looks like Chat's.** It borrows Chat's pieces read-only from
  `@willow/chat`; change them there only for Chat's sake.
  - The thinking row (`AgentThinkingRow.tsx`) is Chat's: Gemini's three dots, then the
    newest heading of the thought summary (`includeThoughts`), wiping in. `$thinking`
    holds only the current round's summary, emptied when a tool round ends, so the row
    after the tools starts from the dots again.
  - Nothing is written under a generation: its card is its progress, so image, video,
    character and scene work shows no status line. A tool with no card (`analyze_media`)
    and a web search put their status in the row instead.
  - A prompt past four lines folds behind Chat's chevron (`AgentUserBubble.tsx`).
  - Prompts, replies and everything else in the transcript use Chat's typeface; prompts
    and replies also share its 17/24 size.
  - The sidebar is dark in either theme, so its `<style>` pins the dots and the thought
    line to their dark colours.
- **Each gallery image is sent to the model once per conversation**, as a 512px
  thumbnail labelled with its ID (`seenMediaIds`), and so is each character's
  portrait, labelled `<id>, the portrait of character <id> "Mira"`, mentioned
  characters first. Every turn used to attach ten more on top of all the previous
  turns' copies. The system prompt carries a text inventory of the gallery instead.
- **Stop and New chat detach the turn before anything else.** A detached turn's
  late callbacks write nothing, so an old reply cannot stream into a new chat.
  Generations already started keep running into the gallery.
- **"Confirm before generating"** pauses each generation on a Generate / Skip
  card, and each character image on a Create / Skip one (`Create the character
  "Kai"?`, `Change Mira?`); a skip is reported to the model as `declined`. Text-only
  character edits and scene work never ask, since nothing is generated. It
  defaults to Never.
- **Character and scene cards** come from `links` on the assistant message: one
  per character or scene the turn made or changed, drawn by `AgentLinkCards.tsx`
  from the live record, so a later rename shows. They are saved with the
  conversation (`StoredAgentLink`), so a reopened chat still has them.
- **Conversations are saved per project** through
  `@willow/storage/media-agent-sessions` and listed under the sidebar's menu
  button. Gemini's returned `history` is memory-only, so a reopened chat
  rebuilds its context from the transcript text.
- **Settings and standing instructions persist per user**, not per project or
  folder. An instruction's reference is a gallery media ID the model can pass as
  a reference image.

### What the agent is told

`buildMediaAgentSystemPrompt` is rebuilt every turn from the host. The pure half —
the inventory, the cast, the focus and the scene plan — is `src/agent/agent-context.ts`,
so tests reach it without MediaView or a model.

- **On screen now** (`toPromptFocus`): the tab, the open collection, the item in the
  viewer, the scene in the Scenebuilder, the character page, and the gallery selection
  oldest first. "These", "the selected ones" and "the one I have open" resolve to IDs
  through it. MediaView's `focus` getter reads its own state; selected scenes and
  collections keep their `scene:` / `collection:` prefixes until then.
- **Characters** and **Scenes** list look, info, voice and image state, and clips with
  their lengths, or say "None yet." so the model doesn't invent any.
- **The gallery inventory follows the grid** (`galleryItems`): each edit history as its
  newest finished version, and no character images.
- **Some attachments go by reference.** An @-mentioned character or a gallery video
  reaches the model as a line ending the user's message, `[The user attached: character
  <id> "Mira", video <id> "Late coffee"]`, not as bytes; the tools take those IDs.
  Gallery images still go as labelled thumbnails. The main composer hands a mention over
  as it is: `toGenerationInput`, which expands a character into its images, serves the
  prompt box's own generations only.

### Characters in the agent

- **A cast is passed by ID.** `resolveCast` turns `character_ids` into each character's
  ready images and words. An image model, and Omni Flash for video, get the images
  appended to the references and a cast note that numbers them ("- Mira: reference
  images 2–3."). Veo takes no references, so it gets the look, info and voice in words,
  and the result advises making the opening frame with `generate_image` first and
  passing it as the first frame. The system prompt teaches that keyframe workflow too.
- **The cast note goes to the API, not the tile.** `startImages` / `startVideos` take an
  `apiPrompt`; the tile keeps the agent's own prompt, so Refresh and the info panel read
  as the agent wrote them.
- **`create_character` makes the portrait, then the body from it**, with `fullBodyPrompt()`
  (shared with the character page) and the *finished* portrait as its reference. Read it
  from the generation's outcome (`GenerationOutcome.url`, `finishedItem`): the host's
  `mediaItems` lag the promise by one render. If the portrait cannot start, the empty
  character is deleted, as the New character page does.
- **`change_look` is a new version** of the portrait (or the full body, by `image`) in
  the same history group, so the old look stays one step back in the history column.
  Text changes never need an image model; image work refuses without one, before
  anything is created.
- Results report each image's state from the outcomes (`characterSummary(..., finished)`),
  not from the host, for the same one-render lag.

### Scenes in the agent

- `create_scene` takes gallery video IDs in story order; each clip's length and
  thumbnails are read before the scene appears.
- `update_scene` plans with `planSceneClips`: a clip kept in the new order keeps its
  trims, a repeat becomes a new clip, a video left out is dropped, and `add_clip_ids`
  appends. An empty plan is refused rather than leaving an empty scene.
- **Several new videos into one scene is two steps**, and the prompt says so: every
  `generate_video` in one step (they run in parallel, and each returns once rendered),
  then `create_scene` with the finished IDs in story order.
- Failures surface as tool errors: `settle()` wraps the scene calls, because
  `abortable()` reads a rejection as a stop.

### Testing the agent

- `apps/studio/test/media-agent-harness.test.mjs`: the tool set and its size, the
  prompt's sections, the inventory, the focus, the cast note and `planSceneClips`.
- `tools/scratch/media-agent-sim.mjs`: end to end in a headless Chrome against a
  scripted fake Gemini (needs the dev server on :3000; a temporary profile and a fake
  key, so nothing real is called). Fourteen scenarios cover the chat's look (thinking
  row, nothing under generations, the folded prompt, one typeface), making, using and
  changing a character, a scene from a selection, reordering a scene, several new videos
  into a scene, Veo's keyframe advice, cards after reopening a chat, approval, an
  @-mention and no image model. `ONLY=a,b` runs some; later scenarios build on earlier
  ones, and all of them on `basics`.
  Screenshots and `results.json` land in `%TEMP%/willow-media-agent-sim`.

The deferred **media capability self-description** block — the prompt text
describing image / video / music generation, recovered from the source prompt
Chat's was adapted from — is parked as a comment directly above
`buildMediaAgentSystemPrompt` in `src/agent/agent-tools.ts`, not in
`features/chat`. It needs a reconciling pass before any of it ships: it
hardcodes the source's model names (the live ones are `ctx.imageModels` /
`ctx.videoModels`), and it claims music and Live tools the agent does not have.
See `features/chat/AGENTS.md` for the other three blocks and the rule they are
all held under.

## Models come from Settings, and there is no default

Every picker in Media — the prompt box, the viewer, Characters, Music and the
agent — offers exactly the models added in **Settings → Models**, built by
`mediaModelLists()` from the config App passes down as a prop, so a model added
while Media is open appears at once. Nothing is offered that the user did not add:
the pickers used to start on Nano Banana Pro, Omni Flash and Lyria 3 Pro for
everyone, and quietly generate with them.

- **A selection is `''` when nothing of that kind is added**, and Generate then
  shows a `PromptNotice` asking for a model, with a button to Settings → Models;
  the notice clears itself once one is added. Never fall back to a model id.
- **Picks are remembered per account** (`willow:media:modelPicks:v1:<account>`)
  and resolve to the first added model once the remembered one is removed.
- **Google ids are not Willow's ids.** Video models map through
  `VIDEO_MODEL_CATALOG`; retired image ids (the two Nano Banana `-preview` ids,
  shut down June 25, 2026, and Nano Banana 2's `gemini-3.1-flash-image`, shut down
  October 29, 2026 for Nano Banana 2.1's `gemini-nano-banana-2.1`) are rewritten by
  `liveModelId()` in `@willow/core/model-catalog` on load and again before each request,
  because old tiles' Refresh still names them.
- **Veo takes 4, 6 or 8 seconds** and rejects anything else; Omni Flash also takes
  10. `fitVideoDuration()` runs inside `generateSingleVideo`, so no caller can send
  Veo a length it refuses.
- The Media route mounts its own `SettingsModal` in `App.tsx`, like the Workbench
  route. Without one, "More settings" set the open flag and the window only
  appeared after leaving Media.

The Scenebuilder is the one deliberate exception: it edits with Omni Flash 1.1
whatever is added, as Flow's does.

## The big one

`MediaView.tsx` (6966 lines) is still the largest file in the repo. It covers
image generation (DALL·E, Imagen, Flux/local), the gallery, the detail panel,
export, and the prompt queue. Read it a few times before touching it.

It was 8818 lines until the leaf pieces above were split out. What is left is
genuinely interconnected: nearly every remaining function closes over MediaView's
own `useState`, so the next split has to move state, not just code. Extract
bottom-up (a self-contained subcomponent and the props it needs), never by
cutting the file at a line number.

Two things make that safe to attempt:

- `useEventCallback` (defined in `MediaView.tsx`) hands memoized children stable
  callback identities. Any component you extract should take its handlers as
  props built with it, or `React.memo` on the child silently stops holding.
- `TileContent` and `useDisplayVideoSrc` in `GalleryTile.tsx` are intentionally
  unexported. Nothing outside that file needed them, and that is what keeps the
  tile reasonable to reason about. Export them only for a real second caller.
  `GeneratingLayers` and `MediaTilePreview` are exported because they have one:
  the agent sidebar draws its chat cards with them.

### The composer's prompt is a store, not state

`MediaView` holds the prompt in a per-mount nanostores atom, `promptStore`, and
never subscribes to it itself. Only `PromptEditor`, `PromptValue` and
`AgentSidebar`'s `SidebarPromptField` do, so a keystroke re-renders those and not
the page. As a `useState` at the top of `MediaView` it re-rendered everything on
every key: ~80ms per keystroke in dev and ~5ms in production, measured with a
40-image gallery. Read it in handlers with `promptStore.get()`, and wrap any new
control that changes with the text in `PromptValue`.

One trap: a leftover bare `prompt` in `MediaView` or `AgentSidebar` resolves to
the browser's `window.prompt` and still typechecks, so `prompt && …` silently
becomes always-true.

### What a big gallery costs

Measured with 80 images and 24 videos, scrolling the grid top to bottom and back
(`tools/ui-research/scrapers/flow/media/w-perf.cjs`, which runs a Chrome of its own: the
debug Chrome stops painting a covered window):

- **Scroll events must not re-render MediaView.** `handleScroll` sets the header's state
  only when it changes. Setting the same value on every event still ran the whole
  component on most of them, and each run dirtied layout for the next — together
  most of the main thread's scroll time, and the stutter.
- **A video tile loads nothing until it is first hovered**, as in Flow: it is a still of the
  first frame (`video-still.ts`, the `<video>`'s poster with `preload="none"`), then the
  video loads and stays loaded, paused where it was left. A loaded `<video>` per tile held
  a player, a decoder and its frames — about half the GPU memory the gallery used.
  `MediaTilePreview`, the agent chat's card, follows the same rules and plays only while
  hovered. It used to autoplay, so every video in a conversation played at once.
- **Images are drawn from their originals.** Smaller copies would halve the decode work
  while scrolling, but even a copy at the tile's size renders measurably differently from
  Chrome scaling the original, so they are not used.

The gallery's React work is several times heavier on the dev server than in a production
build; the GPU and decode costs are the same in both.

### What the recent splits looked like

The seven most recent splits used two shapes. `crop-math.ts`,
`dropdown-placement.ts`, and `annotations.ts` took helpers that were *nearly*
pure — they read one value from closure — and made the value a parameter, so
`getImageAr()` became `getImageAr(selectedItem?.ratio)`. `AnnotationOverlay.tsx`,
`CropOverlay.tsx`, `PenMenu.tsx`, and `ToolFlyouts.tsx` took stateless JSX blocks
and passed the few things they drew from as props.

Both shapes are mechanical, and that is the point: the moved code should come out
identical to the original modulo indentation and renamed props, which you can
check with a whitespace-normalized diff against the pre-split file.
`ToolFlyouts.tsx` is the one that does *not* satisfy that check — its six menu
rows all shared one className template and its four crop rows all shared one
click preamble, so they were factored into a `rowClass()` helper and a
`CROP_RATIOS` table. When you restructure like that, verify the generated strings
instead of the source lines.

`PenMenu` and `ToolFlyouts` show the other wrinkle worth knowing. Their
`motion.div` wrappers stayed in `MediaView` and only the contents moved, because
those divs are direct children of an `AnimatePresence` — extracting the wrapper
too would put a component boundary where Framer Motion tracks presence, and a
broken exit animation is not something a typecheck would catch.

## The tile's generating state and reveal

Two separate things, and it matters which is which.

**The generating animation** — the drifting liquid a tile shows while it works — is
`GeneratingLayers` in `GalleryTile.tsx`: two copies of a Perlin texture scrolling past
each other in opposite directions at different scales, multiply-blended, the stack
blurred, the whole thing luminosity-blended over `#5F6368`. It is a faithful clone of
Flow's and is **deliberately left alone**. Don't restructure it, and don't swap the
texture — a different noise image changes its character immediately even with
identical timings. It does hotlink `labs.google/fx/images/perlin.png`; replacing that
with a local copy is worth doing one day, but only with the *same* pixels.

The agent sidebar's chat cards render the same `GeneratingLayers`, and the same
`useTileReveal` and `useGenerationProgress` hooks, through `MediaTilePreview`, so a
generation looks identical in the chat and on the canvas. Changing any of them changes
both. They were moved out of `TileContent` unedited, and the tile's DOM was checked
identical before and after in the generating, settled and failed states.

**The reveal** — the ~2.7s after the image lands — is `gallery-tile.css`. Every
duration, delay and easing in that file was measured off Google Flow with the recorder
in `tools/ui-research/scrapers/flow/`, and was identical across six captured reveals.
Treat them as exact and re-measure rather than re-taste. `20-verify-willow.cjs` replays
the file in isolation and checks it against the captured values.

Three things are load-bearing and none are obvious from reading the CSS:

- **Opacity rides the whole overlay, not the noise layer inside it.** The overlay
  carries the `#5F6368` base and sits at `z-index: 50`, so it is *above* the image
  rather than behind it as in Flow. Fading only the noise would leave an opaque grey
  card covering the image until the very end.
- **The reveal only plays for tiles that were generating.** `revealPhase` initialises
  to `settled` when the item already has a URL at mount, or every tile in the gallery
  blooms on page load. It advances to `revealing` only when a tile the component
  watched in `loading` becomes ready.
- **`.gallery-tile-glass::after` is `display: none` at rest.** That pseudo carries the
  `backdrop-filter` that resolves the image from an 80px blur; left at `blur(0)` it
  still costs a compositing pass on every settled tile in the gallery.

`REVEAL_DURATION_MS` in `GalleryTile.tsx` decides when the tile drops the generating
layers, so it has to stay equal to the longest chain in the CSS (the overlay exit, at
1192.5ms delay plus 1500ms).

## Scenes

A scene is an ordered list of clips cut from gallery videos — `Scene` / `SceneClip` in
`scenes/scene-store.ts`, saved per project by `@willow/storage/media-scenes`. Everything
in `src/scenes/` clones Flow's Scenebuilder: the DOM, computed styles and animations
were dumped and recorded off flow.google.com, and where the DOM could not say (how many
clips a tile shows, what blur does to a title) Flow's own bundle was read. The scripts
are in `tools/ui-research/scrapers/flow/scenebuilder/`, their captures in
`tools/ui-research/captures/flow/scenebuilder/`. Re-measure there rather than re-taste.

| Path | Role |
| --- | --- |
| `scene-store.ts` | Scenes, the snackbar, the clip clipboard, pending edits; `createSceneWithVideo`, `addVideoToScene`, `trashScene`, and the agent's `createSceneFromVideos` / `setSceneClips`. |
| `flow-ui.tsx` / `flow-ui.css` | Flow's Material primitives: icon, spinner, `mat-menu`, editable text, the tile Rename overlay, the snackbar host. |
| `SceneTile.tsx` | A scene in the gallery: poster, hover playback, filmstrip, its menu, and the "Creating..." state. |
| `SceneBuilder.tsx` | The editor, opened at `?scene=<id>`. MediaView portals it to `<body>`. |
| `SceneTimeline.tsx` | Ruler, clips, trim, CDK-style reorder, playhead, zoom, Add clip. |
| `SceneMediaPicker.tsx` | The Add clip / Add to prompt dialog, with Flow's trimmer. |
| `scene-player.ts` | Plays a scene onto a canvas, one hidden `<video>` per clip. |
| `scene-export.ts` | Download scene: the single-clip shortcut, `scene-render.ts`, and the old play-and-record path as its fallback. |
| `scene-render.ts` / `mp4-read.ts` / `mp4-write.ts` | Renders a scene to MP4 frame by frame with WebCodecs, reading and writing the MP4 itself. |
| `scene-edit.ts` | An edit is a Gemini Omni Flash call (Interactions API) — it spends the user's key. |
| `scene-format.ts` | Timecodes and timeline geometry; tested by `apps/studio/test/media-scenes.test.mjs`. |
| `scene-files.ts` / `scene-folder-sync.ts` | A scene's file in the project folder, and keeping it there (below). |

### Scenes in the project folder

With a folder connected, each scene is also `Media/<project>/Scenes/<name>.json`: a pointer,
not a copy. Each clip names its video by place (`Videos/Cat running.mp4`, or its collection's
folder), with the gallery id it had and its trims; no thumbnails or poster, so a file is a few
hundred bytes. The place is what survives: a gallery rebuilt from the folder (a fresh browser,
another machine) gives the videos new ids at the same places.

- **Written** (`useSceneFolderSync`) whenever a scene's file would read differently: an edit,
  a rename (the file is renamed too), trash and Undo (`trashedAt` is in the file), or one of
  its videos renamed or moved by Willow, a collection's rename included. Never before the
  folder has been read once for the project, so an old browser can't overwrite a newer file.
- **Read** (`readScenesFromFolder`) after every media reconcile, in `loadMedia`. A file whose
  scene this browser lacks, or whose `updatedAt` is newer, is adopted with its clips pointed at
  the video now at each place. Bookkeeping (the file's name, a relinked clip, pictures drawn)
  goes through `patchSceneQuietly`, which leaves `updatedAt` alone, as that is what decides
  between copies.
- **A missing clip** (its video deleted, or renamed or moved outside Willow) keeps its place. It
  is marked in the timeline, the canvas says "Video not found" with the file, and the player
  plays it as black for its length (a clip with no URL runs on the wall clock, as one under
  an edit does). When a video turns up at its place the clip plays it again.
- `apps/studio/test/scene-files.test.mjs` covers the format; `tools/scratch/w-scene-folder.cjs`
  walks it end to end with OPFS standing in for the folder.

What is not obvious from the code:

- **A scene tile works from its first two clips.** Flow's `flow-scene-tile` takes
  `clips.slice(0, 2)` for both the filmstrip and hover playback, and counts the rest in a
  "+N" badge. The clip count beside the name is still the whole scene.
- **Menus opened from a button sit on a transparent backdrop**, CDK's: the button loses
  hover (so its tooltip drops), nothing behind reacts, and an outside click only closes
  the menu. Context menus (a `point` anchor) have none and let the press through.
- **Editable text cancels on blur.** The editor title and the tile's Rename overlay
  commit on Enter or Done only; clicking away reverts, as Flow does.
- **"Creating..." lasts at least `MIN_CREATING_MS` (1.2s).** Flow's is however long its
  server takes (~17s); reading a local clip would skip the state. The reveal after it is
  `SCENE_REVEAL_MS`, 2700 — Flow's is 2650, but the gallery reveal it reuses runs 2692.5ms.
- **Snackbars never time out**, in Flow or here; a new one replaces the old.
- **The picker browses every Media project**, as Flow's project select does. A clip
  taken from another project is first copied into this one (`adoptMedia` in
  `SceneBuilder.tsx`), because a clip resolves its video by id in its own gallery.
- **Overlays stack by DOM order.** Menus, the picker, the snackbar and the Rename
  overlay all sit at z-index 1000, like CDK's overlay container, so whatever opened last
  is on top — the sort menu over the picker, a snackbar over an open menu.
- **Reordering clips is Angular CDK's sort, which Flow's timeline runs with its defaults.**
  Past a 5px threshold the clip lifts into a copy of its body (cloned, as CDK clones, so its
  frames are on screen at once) and a grey placeholder holds its slot. The clip under the
  pointer trades places with it (`sortDragOrder` in `scene-format.ts`), except the one just
  traded with while the pointer is still on it going the same way. The rule this replaced, by
  midpoints, moved a wide clip a slot as soon as it was picked up. The others slide 250ms
  ease-in-out, the placeholder on `cubic-bezier(0, 0, 0.2, 1)`; on release the copy settles
  into the slot, then the order commits. The preview's rule is `.sb-clip.sb-clip-preview`: with
  one class, a selected clip's `.sb-clip.is-selected` (z-index 5) won, and the preview sat under
  the editor, unseen. Held near the timeline's left or right edge, a dragged clip scrolls it;
  Flow's doesn't (checked: no scroll in 3s at the edge), so in a long scene it can't be taken
  past the window without zooming out. The video view uses the same timeline.
  `tools/scratch/w-scene-reorder.cjs` drags clips of different lengths in both editors.
- **`ScenePlayer.dispose()` is not terminal.** StrictMode unmounts and remounts effects
  in development, and a disposed-for-good player plays video with a clock that never moves.
- **The playhead is a store of its own, `player.$time`, and the editor never subscribes to it.**
  It changes every frame while playing. When it was part of `$state`, the whole editor (the
  timeline, every clip's filmstrip, the history) re-rendered 60 times a second. A 10-clip scene
  played at ~44fps with 50ms p95 frames and half the main thread in React; it now holds 60fps
  (`tools/scratch/w-scene-perf.cjs` profiles it). Only the timecode and the timeline's playhead
  read `$time`, writing the DOM directly. `usePlayheadClip` gives the clip under the playhead,
  which changes only at a cut, and only `CanvasOverlays` uses it: a render of the whole editor
  takes ~60ms in development, and the canvas stood still for it at every cut. Handlers read
  `player.$time.get()`.
- **A cut is prepared before it comes.** The clips' `<video>`s sit in the page (2px each, side by
  side, near-transparent): Chrome steps one in no document on a background timer, and frames
  came unevenly. Chrome also suspends paused `<video>`s (all at once past eight idle, which a
  10-clip scene is, with the frame grabbers counting too), and one played from suspension
  showed its next frame up to ~190ms late, a hold at the cut. So half a second before a cut the
  next clip is seeked a millisecond on (Chrome skips a seek to the time a paused `<video>` is
  already at), which resumes it, and 40ms before, it starts playing. `scene-frames.ts` lets an
  idle grabber's `<video>` go after 4s for the same reason. What's left: a new decoder's GPU work
  can still drop a screen frame or two (a 67ms gap, rarely 100ms) in the half-second after a
  cut. Flow has none because it decodes every clip with WebCodecs onto one canvas; matching
  that means a WebCodecs player, audio included. `tools/scratch/w-scene-cuts.cjs` measures cuts:
  canvas draws, each video's presented frames, long frames, and Chrome's media log (`--media`).
- **Per-frame text changes go into a Text node's `data`.** The Tailwind CDN's MutationObserver
  rescans the page on every childList mutation; setting `textContent` each frame cost ~20% of
  the main thread.
- **A full-window page keeps to the desktop app's page.** Media sits in the app's frame beside
  its rail, so anything `position: fixed` over the whole window (the editor's own pages, the
  agent's and the music player's panels, the Tools fallback) takes `--willow-frame-inset`,
  `--willow-frame-page-radius` or the `--willow-frame-*` edges, each falling back to `0` on the
  web (`apps/studio/src/shell/rail/AppRail.css`). A `min-height: 100dvh` on such a page runs it
  past the page's bottom: the TV root resets it.
- **The gallery isn't painted under a full-window editor** (`visibility: hidden` on `<main>`
  while a scene, a video or an image is open). Flow's editors are pages of their own, with no
  grid, and its Scenebuilder plays with no `<video>` at all: it re-encodes clips with WebCodecs
  and decodes them onto one canvas.
- **The player's `ready` means "the canvas has painted", and seeks never clear it.** The
  editor shows the scene's poster until the first frame; when `ready` used to follow each seek,
  scrubbing left the still poster over a scene that kept playing (sound, no picture). Mid-seek
  the canvas keeps its last frame.
- **Download scene renders; it doesn't record.** Playing the scene onto a canvas and recording
  it at 30fps repeated every fourth frame of a 24fps clip, dropped frames whenever the page
  was busy, and froze for most of a second at the start — measured by decoding the file and
  matching each frame to its source (`tools/ui-research/scrapers/flow/media/w-export.cjs`).
  `scene-render.ts` decodes each clip, places every frame at its exact time at the clip's own
  frame rate, and encodes it once: the same file however busy the page, faster than real time,
  sound within a millisecond of picture (`tools/scratch/av-sync.cjs`). H.264 in an MP4 is read
  straight from the file; anything else, or a rotated video, is stepped through on a `<video>`
  (slower). The old recorder stays as the fallback, for browsers without WebCodecs. A single
  untrimmed clip is handed back as its own file.
- **The editor stops `mousedown`/`click`/`contextmenu` at its portal**: React events
  bubble through portals, and MediaView's gallery starts a marquee on mousedown.
- **A video's scene is built after its view first renders**, whenever the editor's code is
  already loaded. So `SceneBuilder` renders once with no scene: every hook sits above its
  `if (!scene)` return (one below it threw "Rendered more hooks" on every open after the
  first; `apps/studio/test/hooks-order.test.mjs` now checks every component), and the missing
  clip list is one shared array (a fresh `[]` per render re-ran the player effect without end).
- **The editors render inside `EditorBoundary`.** Any of them failing to load or render closes
  it with a snackbar. Without it React unmounts the whole app and the window goes black —
  which the dev server can cause on its own by answering mid-edit.
- **Every icon is a Google Symbols ligature from a subset.** `apps/studio/index.html`
  loads a font cut to the glyphs Willow uses; a name outside it renders as its text.
  Regenerate with `tools/ui-research/scrapers/flow/media/symbols-subset-3101.cjs --add=<names>`
  against the :3101 test origin (the older `54-symbols-subset.cjs` drives :3000).

## The image and video views

Opening a gallery image shows `editor/ImageEditor.tsx`; opening a video shows the Scenebuilder
in video mode on a scene of its own (`$videoScenes` in `scene-store.ts`, never saved or listed).
Both were cloned off Flow with `tools/ui-research/scrapers/flow/media/02-image-editor.cjs` and
`03-video-editor.cjs`.

- **A tile stands for its whole edit history.** Versions share a `historyGroupId` and point at
  their parent with `historyParentId`; the grid hides versions and shows the newest finished
  one in the root's place (`latestVersions` in MediaView). The history column lists them.
- **The open image is rounded 16px** (`.ie-read-only-image`), like the pending tile that stands
  in for it during an edit. The Oct 2 captures of Flow show it square; it was rounded because the
  user reports Flow's is rounded now. Re-measure against Flow before changing it. Crop mode
  stays square, so the corner handles aren't clipped.
- **An edit or crop of an item in a collection stays in it** — every new version copies the
  source's `collectionId`, so its file lands in the same folder.

## Characters

`characters/` clones Flow's Characters: the grid's New character tile, the New character page
(presets, Format, model menu, upload), and a character's page (form, the 30-voice dialog with
Google's voice samples, portrait and body, history). Characters are saved per project by
`@willow/storage/media-characters`; their images are gallery `MediaItem`s with a `characterId`,
kept out of the grid. Pages open on `?character=new|<id>`. Flow's "Create my avatar" tile is left
out on purpose: Willow has no avatar feature.

- **Characters are tiles of All media too**, as in Flow: square `character:` stand-ins by when they
  were made, at the top of the project (not inside collections), drawn by the same `CharacterTile`.
  A click opens the character. Add to prompt adds the character as an ingredient; in Frames mode,
  where a character can't be one, it adds the portrait as a frame.
- **The grid is All media's.** `CharactersGrid` lays its squares out with `layoutGallery`, in the
  same frame (`galleryWidth`, `galleryTargetH`, `galleryPaddingRight` in MediaView), New character
  as one more 1:1 tile. The one difference is `uniformLastRow`: the last row never grows past the
  rows above, as in Flow's grid, because a larger last row of squares reads as a different tile size.
- **Every character tile wears the `accessibility_new` badge**, as Flow's does, not only those with
  a body. A favorite shows a filled heart at the top right at rest, which fades out as the hotbar
  fades in on hover.
- **A character page never opens onto the grid.** Three things keep it that way, and each was a
  reported flash:
  - An empty tab is the New character page from its first render (`characterPage` in MediaView).
    The `?character=new` redirect only writes the URL; the grid is drawn only when there are
    characters.
  - Both pages are `preloadableLazy`, fetched at idle (at once on the tab), so Start generation
    swaps New character for the character's page with no frame of suspense. A page still loading
    falls back to a black `.cp-page`, never to `null`.
  - `characterRequest` shows the page a click asked for on that click's frame. react-router v7
    renders every navigation as a transition, which would otherwise leave the old page up for a
    few frames. The request holds only while `location.key` is the one it was made from, so it
    lapses as soon as any navigation lands and can never outlive its URL.
  `tools/ui-research/scrapers/flow/media/w-characters-grid.cjs` samples every frame to check this,
  answering the image request itself so no API call is made.
- **A character's page is Flow's `flow-character-edit-page`**, laid out by Flow's own rules. Don't
  fix sizes in pixels: the form and preview fill the height that is left over.
  - **The layout.** A grid of a 400px form and the preview, capped at 1280px and centred. The slots
    sit under the preview, and the prompt is centred under it by a 424px footer offset.
  - **The history column.** It is 268.8px wide and closes to 0 over 0.35s. When it is open, the
    grid shrinks to fit beside it.
  - **Small windows.** Under 640px tall or 960px wide, the page stacks into one scrolling column:
    preview, slots, form, prompt.
- **History follows Flow's rules too** (`character-page-prefs.ts`).
  - **Open state.** It starts hidden, and Show / Hide history is remembered. Flow saves the choice
    to the account and opens the column for an account that has never chosen. The user's Flow
    account opens hidden ("Show history"), which is what they compare against, so Willow starts
    there too.
  - **Tablets.** On a tablet or smaller (under 1280px landscape, 840px portrait), it starts closed,
    the toggle isn't saved, and opening it covers the page. The header's history and Done shrink to
    icon buttons there.
  - **Empty slots.** The column never opens onto a slot with no versions.
- **Delete image asks first** ("Delete this image?"). It then empties the slot: Flow's empty state
  offers Upload and Add from project. It doesn't fall back to an older version.
- **The history column is the image editor's `ImageHistory`.** Its rule is Flow's: a version made
  from a prompt shows its ingredients and prompt, and Flag output and Reuse prompt on its hotbar.
  An upload, an adopted file or a crop shows none of them.
- **Checking it.** `tools/ui-research/scrapers/flow/media/w-character-page.cjs` checks about 100
  boxes against Flow's live ones at five window sizes. `37-character-page.cjs` captures Flow's side.
- **The Body slot is Flow's.**
  - **Create body only switches slot.** It empties the prompt box and, while the body is empty,
    puts the portrait in as an ingredient. Nothing is generated until the user writes and submits.
    The hint reads "Describe body and outfit…".
  - **Format on the body is local.** It puts Flow's triptych instructions (`BODY_TRIPTYCH` in
    `CharacterPromptBox.tsx`) in front of the text, then stays disabled while they are there. On
    the portrait, Format is a model rewrite. Either way the chip glows once, the first time it is
    enabled.
  - **While a slot is made,** its chip reads Portrait or Body with the loading texture, the other
    chip is disabled and grey, and Generate shows Flow's white spinner with the model select
    disabled. Create body stays disabled until there is a portrait. All character images are 16:9.
  - **Checking it.** `w-character-body.cjs` checks the boxes and states against Flow's
    (`39-character-body.cjs` captures Flow's side), answering the image request itself.
- **A colour trap.** Flow's empty-slot text and the voice card's description ask for
  `--foreground-state-60`, a token Flow's theme doesn't define, so both inherit white. Willow draws
  them white too.

## @ mentions

The All media prompt box takes Flow's @ mentions (`PromptEditor.tsx`, wired in MediaView).

- **"@" opens the add menu.** It has to be typed at the start, after a space, a line break or
  another chip. The menu is `SceneMediaPicker` in `composer` mode, given the prompt box's rect: a
  780x580 popover centred on the box, 8px above it, over Flow's dark backdrop. The search has
  focus, without the focus ring Flow draws there. All lists the characters with the media by when
  they were made; Characters lists them alone; the menu keeps the category it was left on. The
  arrows move the highlight and stop at the ends. A click or Enter adds.
- **The add button opens the same menu**, as Flow's does. Its picks join the ingredients and leave
  the text alone. While the menu is open, the add glyph is close.
- **The detail pane is Flow's.** A character shows a 16:9 hero, the image filling it whatever its
  shape (characters are made at 16:9). Its slot thumbnails show only when it has two images, and
  its voice card when it has a voice. A video shows Flow's trimmer.
- **A pick lands twice.** The "@" becomes a chip naming the asset (the character's name, or the
  item's short title), then a space. The asset joins the ingredients, and a character's ingredient
  wears Flow's white `accessibility_new` badge. Escape or a press outside takes the "@" away.
- **A chip is valid only while its asset is an ingredient.** Removing the ingredient leaves the chip
  outlined and dimmed. In Frames mode a character can't be an ingredient, so its chip starts
  invalid, as Flow's does. Backspace takes the space, then the chip whole; its ingredient stays.
- **The field is uncontrolled.** It writes `promptStore` with each chip as its name. When the store
  is set from outside (a clear, a reuse), the field shows that text and its chips are gone.
- **Generation.** `expandCharacterReferences` (`characters/character-references.ts`) sends a
  character ingredient as its portrait and body. The text gets a line saying which reference images
  are that character. The tile keeps the user's own prompt. The agent instead gets a mentioned
  character by ID (see *What the agent is told*).
- **The ingredient row is Flow's.** It leaves 12px before the text, and its clear button stays in the
  box's top-right corner and clears the ingredients with the text. Hovering a character ingredient
  shows Flow's 208px card, 6px above the chip, with its image count. The hover previews are drawn
  in the body, because the composer clips its overflow.
- **Checking it.** `w-mention.cjs` checks the popover, keys, chips, card and the generation request
  against Flow's captures (`40-mention.cjs`).

## The prompt box

The All media prompt box is Flow's `flow-base-prompt-box` as it is now (`41-composer-grid.cjs`).

- **97.6px at rest.** A 1px edge (0.8px at 1.25x) at 5% foreground, 15% while focused, with no
  shadow and a 40px blur. Inside: 12px, the 36px text row, an 8px gap, the 32px control row, 8px.
  An empty row (ingredients, frames) must be `hidden`, or it still earns its 8px gap.
- **The control row.** The add button carries Flow's thin 20px `add`. Then come Agent, 8px apart.
  On the right, the settings trigger (32px, "🍌 Nano Banana 2" as one run of text, an 18px ratio
  glyph, the count at the label's 75%) and the send button, 4px apart. The send button is the 5%
  fill with an 18px unfilled arrow at 50% until there is text, then white with an rgb(32,33,36)
  arrow.
- **Frames mode.** The row above the text is Flow's: 56px Start and End chips 8px in, with the swap
  button between them. There is no add button; the chips open the menu.
- **The hint** is the 50% foreground and hugs its text.
- **Checking it.** `w-composer-grid.cjs` checks these boxes and colours against Flow's, along with
  the add menu's previews and the characters among All media's tiles.

## Collections

A collection is a folder, as in Flow: an item is in at most one (`MediaItem.collectionId`), and
while it is, it shows only inside the collection (`?collection=<id>`), not at the top of the
project or in the type tabs. Collections nest, as Flow's do: one inside another has it as its
`parentId`, shows only inside it, and counts toward its tile (counts and covers take in
everything below). Records are saved per project by `@willow/storage/media-collections`;
`collections/collection-store.ts` is the client copy.

- **On disk each collection is a folder of its own**, `Media/<project>/<collection>/`, holding
  its items' files and the folders of the collections inside it (`A/B/`). Creating, renaming,
  moving an item or a collection in or out, and trashing all go to disk (MediaView's *Collection
  actions*, always through `collectionFolder()`, which gives the full path); the reconcile reads
  membership and nesting back from where each file and folder is, and adopts a folder made
  outside the app as a collection. See `platform/storage/AGENTS.md`.
- **A move leaves blob: URLs behind.** A disk item's URL reads its file where it was when made,
  so after a file moves — into a collection, or with its collection's folder — it stops
  loading. `rereadMovedFiles` gives moved tiles new URLs, and hydration reuses a URL only while
  the file is in the folder it was read from (`blobFolderRef`).
- **The tile is Flow's, to the pixel**: its title band (gradient, `blur(5px) contrast(1.2)
  saturate(1.3)`, 48px mask) diffs at zero against Flow's over the same picture. Its three cover
  slots repeat the last item when there are fewer than three, and hovering steps through the
  distinct ones every 1800ms (a single item never moves), holding where it got to on leave.
- **New collection inside a collection makes it there** (the + menu and the empty-space menu),
  and the view stays put.
- **Move all contents to trash asks first** (Flow's confirmation dialog): everything inside,
  nested collections' contents included, goes to the trash, and the collections and the folder
  go too — Willow's trash, like a tile's, is permanent. The files go with the folder's one
  recursive delete; deleting them alongside it races the removal, which then fails and leaves
  the folder to be adopted back.
- **Inside a collection a tile's menu grows two rows**, as Flow's does: *Move out of collection*
  (into the collection this one sits in, or the kind folder at the top) and a *Set cover image*
  submenu whose *Set collection cover* puts the item first on the collection's tile (`coverId`).
  A nested collection's own menu is the same as a top-level one's.
- **A selection can hold collections.** The marquee selects collection tiles too, and
  right-clicking any selected tile (with two or more selected) opens Flow's selection menu
  instead of the tile's: New collection, New scene, Download, Copy, Move to trash. Its New
  collection asks first ("Do you want to create a collection with:" and a line per kind — `1
  collection`, `2 images`) and makes one where the selection was, holding the items and the
  collections, which nest. New scene takes the selection's videos (Willow's scenes hold video),
  Download zips every file including the collections' contents, and Copy puts the first image on
  the clipboard.

## Dragging

A gallery drag (`drag/`) is Flow's: a 128px-tall preview at the pointer (square and stacked
24px apart for several), a label naming the drop — *Add to collection*, *Add to scene* (videos
only, since scenes hold video clips), *Add ingredient*, *Move to trash* — and every other tile
dimmed with `brightness(0.5) contrast(0.9)` while targets get a ring. The composer turns into
its drop zone (two slots in Frames mode). Targets are found by `data-drop-*` attributes under the
pointer; the preview moves by writing styles, so following the pointer never re-renders.

A collection drags as a whole, as in Flow: its preview is its first item's picture, it drops
into another collection (and nests there — never into itself or a collection inside it) or onto
Trash (which asks first, as its menu's trash does), and nothing else takes it. Flow still lights
the composer slot under it but shows no label and drops nothing there, and so does Willow
(`collectionSlot` in MediaView).

## Header panels

`HeaderMenus.tsx` follows Flow's current panels: View settings with slide toggles, the
three-column Filters panel, and the menus on the shared Flow `mat-menu`. Filters narrow the grid
by type, aspect ratio and how an item was made; Willow records no clip duration or resolution,
so those rows narrow nothing. Willow's own settings sit at the end of the top-right menu.

## Batch view

View settings > View mode > Batch (or `G`) is Flow's batch view, cloned from its bundle and
measured against it (`tools/ui-research/scrapers/flow/media/35-batch-view.cjs`, the Willow twin
`w-batch-view.cjs`; `batch-view.test.mjs` pins Flow's own boxes). The gallery's tiles are
regrouped, each batch a grid of its rows and an info column 32px to the right of them, 64px
between batches.

- **A batch is one submission.** Items a generation makes share `MediaItem.batchId` (set in
  MediaView's composer path, the agent's and Refresh). Items without one are grouped by
  `legacyBatchKeys`: same kind, model, ratio and prompt, until the next is more than a minute
  older. That covers items from before `batchId` existed (stamped 1ms apart) and, the common
  case, files the reconcile adopted back from the folder after their records were lost:
  "cute army.mp4", "cute army (1).mp4"… return as `external` items whose prompt is the shared
  name, written to disk within moments of each other. Uploads, collections and scenes are each
  a batch of their own. Batches keep the order of their first tile in the grid's sort.
- **Rows are not justified.** Every row of a batch has one height, set by its first tile's shape
  so that two fit across (four for a portrait one; four and six at size S), and tiles wrap at
  their own width. At size L a tile alone in its row grows: 1.5x for a square or portrait one,
  the full width for a landscape one. Below 500px wide every size is L.
- **The info column is 25rem from a 1280px window, 16rem below that and at size L**, a batch at
  most 96.25rem wide, one column on a phone. It reads the batch's first tile: a toolbar
  (Download batch, Reuse prompt when it was generated, Trash batch when nothing is still
  generating), then a collection's name and counts, a scene's name, date and clip count, or a
  generation's prompt (three lines, then Expand prompt; the reuse button fades in on hover),
  its references as chips (hover: a scrim and a 200px preview above), and "Created <date>"
  with the model or "Uploaded image", a video's resolution and length, and the ratio.
- **A video's resolution and length are read from its file** (`video-meta.ts`, metadata only),
  as Willow stores neither; Flow names a resolution by the shorter side and writes lengths in
  whole seconds.
- **The actions are the tiles' own.** Download batch zips everything into `download.zip`, a
  collection's whole contents included (nothing for a scene, as in Flow); Trash batch asks
  first for a collection, uses the scene's own Undo for a scene, and otherwise trashes the
  tiles with "N items moved to trash". The tiles are the grid's, at the size the batch gives
  them, so hover, menus, selection, drag and opening all behave the same.
- **Where it applies**: every tab that shows the gallery grid, inside collections too. Music
  is Willow's own surface and Characters has its own page, so both keep the grid, and Flow's
  Trash is always a grid. `+`, `-` and `0` step the grid size, which only batch view uses yet.
- **The frame is Willow's.** Batch view fills the same area as Willow's grid, which is wider
  than Flow's: the sidebar is Flow's 232px, but Willow's page has none of Flow's 16px of padding
  or its 8px scrollbar gutter, so its tiles come out a little larger than Flow's from the same
  rules.

## The chat home's glow

The glow behind the new-chat prompt box is Gemini's `lm-glow`: two copies of Gemini's glow
mask (`apps/studio/public/glow-mask.svg`, byte-identical to the one on gstatic), the mask's
top half filled with the accent and its bottom half with a black bloom at half opacity
(white in light theme). The rules are in `apps/studio/index.html`; the host is
`MediaHome`'s root, which carries `willow-gemini-home-glow` once the greeting is ready, so
the glow and the heading arrive together.

- **Above 960px** the glow paints on `.willow-home-glow-layer`, an empty element inside the
  host that covers the chat area and clips to it, as Gemini's `.lm-glow` covers its chat
  window. It is a separate layer because clipping the host would clip the composer's menus.
  Both copies are 202.18% of the area's width up to 1601.27px, at 1.4338:1, centred 15px
  below its middle, and grow from scale(0) over 1s. The mask here is `glow-mask.webp`, the
  SVG rasterised once at 742px wide (`tools/scratch/glow-mask-raster.cjs 742 webp
  glow-mask.webp` rebuilds it). The SVG's 125px blur took ~300ms to rasterise at this size
  on every mount, and a mask that has not rasterised paints nothing, so the glow used to
  appear already grown. Don't switch it back to the SVG.
- **At 960px and below** the host's own `::before` and `::after` paint Gemini's mobile
  geometry (fixed to the bottom, the bloom rotated 15.37deg). The layer is `display: none`
  there, so neither width's rules reach the other.

The accent is Gemini's `--bard-color-lm-glow-chat` at both widths: `#1f3b9b` in dark,
`#9dd2ff` in light. `home-glow.ts` carries it to the other workspace colours with
transforms measured off those Gemini pairs, and `MediaHome` sets the results on the host as
`--willow-home-glow-desktop-accent`, `--willow-home-glow-mobile-accent` and
`--willow-home-glow-accent` (the light accent in light theme). The desktop and mobile
accents are the same for every colour except green. Green's old desktop accent was
hand-picked rather than derived, so on desktop it is carried across the step Gemini's own
blue took from its old glow to this one (`#14204f` to `#1f3b9b`, lightness x1.5). That
step is the one every derived colour took, so green brightens with them instead of dimming.
Temporary chat swaps the accent for Gemini's outline-variant gray (`#444746`, light
`#c4c7c5`) at every colour, as a background-only modifier so toggling it never restarts the
grow.

`apps/studio/test/home-glow-desktop.test.mjs` pins the desktop geometry and that the widths
stay apart; `home-glow-accent.test.mjs` pins the colours against their measurements.

## Willow TV

`src/tv/` is Flow TV (labs.google/flow/tv) with Willow's own videos, at `/tv` (App.tsx), opened
in a tab of its own by the Willow TV item in both More menus, as Flow's opens Flow TV. Willow is
offline, so there is no catalogue: every Media project with a finished video is a channel (its
videos the clips, oldest first; channels newest first, by their latest clip), and every scene is
a short film. Nothing is fetched; a clip plays from its own URL or, when that is a stored
`blob:` (dead in a new tab), from its file in the project folder.

- **Styles.** `willow-tv.css` is Flow TV's stylesheet, generated by
  `tools/ui-research/scrapers/flow/tv/06-port-css.cjs` (edit the port, not the file): Flow's
  CSS-module classes keep their module and name (`.wtv-tv-remote__outerContainer`), and its
  page-wide rules apply under `:where(.wtv-root)` only. Two pairs of Flow modules share a file
  name (`grid`, `controls`); the port tells them apart by hash, as `channels-grid` and
  `channel-grid`, `controls` and `video-controls`. Merged, each wore the other's layout.
  `tv-willow.css` holds the few additions: the wordmark (Flow's is an image), the root as the
  page (Willow's body never scrolls), round tile corners for video frames, a grid that scrolls
  past nine clips.
- **Components** set the data attributes and custom properties the stylesheet reads, prop for
  prop from Flow TV's bundle (`TvPrimitives.tsx`: ButtonIcon, ButtonOutline, assets). Flow TV
  animates with framer-motion, which Willow does not depend on; the three ways it uses
  AnimatePresence are small Web Animations components there. Where Flow's CSS starts a box at
  `width: 0` and leaves motion to set `width: auto` (the prompt panel), `WidthPresence` holds
  motion's resting values inline, or the panel stays shut.
- **State** (`TvState.tsx`) is Flow TV's providers: the remote (mute, loop, the prompt toggle),
  fullscreen (of `.wtv-root`, which the stylesheet's `:fullscreen` rules expect), the idle timer,
  and the two videos a channel change blends. The library waits for `isChatListHydrated` and the
  folder restore before it reads, or a signed-in user's projects would look like none at all.
- **Next and Previous** follow Flow TV's rules exactly (`goToNextChannelGeneration`): Mixing
  (`?random=true`, where home and the logo land) plays a clip from another channel when one
  ends; otherwise a channel plays through and moves to the next. Loop Channel wraps within the
  channel; Repeat Video sets `video.loop`. Channels sit in a ring.
- **Transitions.** Each route's page stays mounted until its exit settles
  (`ChannelRouterTransition`): within a channel, a 0.3s fade; a channel change (not Mixing) runs
  Flow TV's shader (`tv-shader.ts`, its shaders verbatim, its multi-pass renderer in plain
  WebGL2), which locks the remote for its ~4.5s; a grid tile grows into the lightbox.
- **Short films** play through Scenebuilder's `ScenePlayer` onto a canvas, with Flow's scrub bar.

`tv-library.ts` (from storage) and `tv-props.ts` (what each page tells the remote) are pure;
`apps/studio/test/willow-tv.test.mjs` covers them, the routes, the stylesheet split and the `tv`
glyph. `tools/scratch/w-tv.cjs` seeds three projects and two scenes on :3101 in its own headless
Chrome and drives every part of the TV (`--keep` reuses its profile, `--shots` writes
`tools/ui-research/captures/willow/tv/`); `w-tv-debug.cjs` samples one channel change.

## Tools

`src/tools/` is Flow's Tools tab (its "applets"): the Tools page at `/media/tools` (My Tools,
Community, Templates), a tool's page at `/media/tool/<id>?mode=APP|EDIT&fromViewSource=tools` and
Create tool at `/media/create-tool`, every address keeping the Media query (`tools-routes.ts`).
An address that names no project gains one and keeps its page: `/media/*` is a splat route,
where the router's own `setSearchParams` resolves against `/media`, so MediaView's
`setSearchParams` and App's `MediaRouteRedirect` keep the path themselves.
MediaView mounts `ToolsSurface` (lazily) in a portal over the gallery when `parseToolsRoute`
matches, stopped at its root like the Scenebuilder, and hands it a `ToolsHost`. Both draw
`MediaSidebar`, whose Tools row carries Flow's dock: pinned tools, then recent ones, five at most
and "and N more" (`$dock`). Every rail row is a button or a link: a press on anything else in the
gallery starts the marquee, which turns the rail's pointer events off before the click lands
(the Loading page lets presses through as it fades for the same reason). `tools/scratch/w-tools.cjs`
clicks the rail from the gallery; `w-tools-dock-click.cjs` reports what a press lands on.

- **Catalog.** `catalog/catalog.json` and `catalog/sources/<id>.json` are Flow's 34 templates and
  34 community tools with their files, generated from captures by
  `tools/ui-research/scrapers/flow/tools/14-build-catalog.cjs`; pictures stay hotlinked from
  gstatic. Sources load on demand (`catalog-sources.ts`).
- **On disk.** With a folder connected, every tool of your own is also a file in its
  `Media/Tools/` (`tools-disk.ts`, registered by `src/register.ts` with the synced-folder
  engine): "<tool name>.tool.json", holding the tool whole — details, every version's files,
  the Tool Builder chat and what the tool stored — so clearing the browser, or another browser
  on the folder, loses nothing. A pending tool gets its file with its first version. The file
  follows a rename here, keeps a name given by hand, and a copied file becomes a tool of its
  own; a deleted file deletes its tool. `Media/Tools` is never taken for a project (see
  platform/storage/ARCHITECTURE.md §6). Pinned by `apps/studio/test/media-tools-disk.test.mjs`
  and walked in a browser by `tools/scratch/w-tools-folder.cjs`.
- **Store.** `tools-store.ts`, saved by `@willow/storage/media-tools`: your tools and their
  versions, each Tool Builder chat, the prefs (favorites, pins, recent, the tab, the dock), and
  each tool's `Flow.storage` and localStorage. Opening a template opens your copy, "Remix of …",
  made once (opens at the same moment share it), as Flow's server does. A tool from Create tool is
  `pending`, listed nowhere, until its first build saves a version; one left so by an earlier
  visit is dropped.
- **Runtime** (`runtime/`) is Flow's: esbuild-wasm with Flow's options (`compiler.ts`), its runner
  document with the CSP, Tailwind's browser build, fonts and import map (React 19.1.1 pinned,
  everything else from esm.sh with React external, p5 and pixi.js from jsDelivr;
  `runner-html.ts`), and `flow-sdk` verbatim (`flow-sdk-source.ts`, from `15-port-runtime.cjs`).
  Willow's difference is the frame: an opaque origin (`RUNNER_SANDBOX` has no
  `allow-same-origin`), so a tool cannot read Willow's storage or keys; a shim gives it
  localStorage and sessionStorage, saved per tool. `ToolRunner` (`bridge.ts`) answers every
  `FLOW_*` request. `tool-sdk-host.ts` generates through the agent's own start (the gallery's
  placeholder tiles, the user's models matched by name, their keys), saves into the project, and
  picks media with `SceneMediaPicker`'s `tool` mode (Shift/Ctrl-click gathers a selection,
  confirmed with Confirm). All 68 catalog tools compile and mount (`tools/scratch/probe-catalog.cjs`).
- **Tool Builder** (`ToolBuilderPanel.tsx`, `builder-session.ts`, `builder-errors.ts`) runs on
  `harness/`, a fork of the Code tab's harness; see `harness/AGENTS.md`. The chat is Flow's: the
  thought chip labelled by the last heading, the action bar, Restore (that reply's version becomes
  current, and "Restored from" is added), the error card worded per Flow error code, the quota
  card in place of the prompt box, and the debug menu's Mock Error on Next Send. A first request
  names the tool. `tools/scratch/w-tools-builder.cjs` walks it end to end against a local
  stand-in for an OpenAI-compatible endpoint and an in-page Gemini fake (nothing is spent):
  create, run, edit, a fix round after the real check catches a runtime error, Restore, Stop,
  a reload, and a tool generating images, text and video through `flow-sdk`.
- **Styles.** `flow-tools.css` is Flow's component CSS, generated by
  `tools/ui-research/scrapers/flow/tools/16-port-css.cjs` from the bundle (edit the port, not the
  file): scoped under `.ng-flow-tools`, a host `flow-x` as `.ng-flow-x`, in the order Flow's page
  inserts them: the pages' components, then Material's, then the dialogs' (a dialog opens after
  the page's buttons, so its own rules win their ties). `tools-defaults.css` restores the browser
  defaults Flow leans on and Tailwind's preflight removes (margins, input padding, scrollbars);
  `tools-willow.css` holds the rest of Willow's additions (the surface with Flow's 8px gutter and
  its white page text, the Create tool input, the debug menu's header). The overlay root on
  `<body>` wears `.ng-flow-tools` but must not be a stacking context, or the overlay container
  (z-index 1000) sits under the surface (900) and every dialog, picker and tooltip opens behind
  the page. `FlowButton` takes Flow's variant only and derives Material's appearance from it, as
  Flow's `flow-button` does (primary filled, secondary tonal, transparent text, outlined).
- **Willow's on purpose:** the disclaimers say Willow; Reload runs the tool again instead of
  reloading the app; Share's Copy link is a Willow address; Apply to be featured features the tool
  in your own Community Spotlight; there is no docked side panel or keep-alive (Flow's are behind
  flags the user's Flow does not have); saving audio from a tool is not supported (the importer
  takes images and videos).

`apps/studio/test/media-tools.test.mjs` covers the routes, catalog, import map, sandbox, error
wording, highlighting, lists and wiring. `tools/scratch/w-tools.cjs` drives every page on :3101 in
its own headless Chrome (no keys, so the builder only fails, through the mocks), and counts a
dialog open only when it is opaque and what the browser finds at its centre is the dialog.
`tools/scratch/w-tools-geometry.cjs` compares element by element: it dumps the same selectors'
boxes and styles (animations and transitions included, run to their end first) from Flow, in a
tab of its own in the debug Chrome and view-only, and from Willow, then lists what differs,
positions relative to each page's root.

## Phones and tablets

Media's narrow layout is Willow's own, not Flow's: Flow's narrow screens are its desktop squeezed.
There are three layouts, from `useMediaViewport()` (`src/use-media-viewport.ts`): **desktop** above
960px, Flow's and measured, which must not move; **tablet**, 601-960px; **phone**, 600px and below.
960px is where the rest of Willow goes narrow (`COMPACT_VIEWPORT_QUERY`). A **phone on its side**
has a tablet's width under 500px of height (`useShortViewport()`, `(max-width: 960px) and
(max-height: 500px)` in the sheets), and keeps a phone's ways where a tablet's would not fit.

- **The rules live apart.** Each area has a `*-responsive.css` whose every rule sits in a max-width
  (or `(hover: none)`) block: `media-responsive.css` (shell, gallery, composer, menus, panels, the
  media picker, touch), `home-responsive.css` (Media's home), `editor/editor-responsive.css`
  (image view, Scenebuilder), `characters/characters-responsive.css`, `music/music-responsive.css`,
  `tools/tools-responsive.css` and `tv/tv-responsive.css`. `apps/studio/test/media-responsive.test.mjs`
  fails if a rule escapes into the desktop cascade or a sheet uses another query. Vite injects
  stylesheets in first-import order, not source order, so a narrow rule must outrank the rule it
  overrides by specificity (`.sb-editor …`, `.cp-page …`, `body …` for what portals out, three
  classes against Flow Tools' two), never by coming later.
- **The shell.** On a phone the rail is a drawer (`MediaSidebar presentation="drawer"`, Willow's
  drawer metrics) opened from the header's menu button, and the header is `MediaCompactHeader`:
  menu, the name with its project chevron, Search, Add, More, the avatar. View settings and Filters
  move into More. A tablet keeps an 80px icon rail whose last row opens the same drawer, and its
  header has room for Home, Filters and View settings. A phone on its side has that header's room
  but not the rail's height (Uploads, Tools and Trash would fall off the bottom), so
  `useRailDrawer()` makes its rail the drawer and its header leads with the menu button. The Tools
  pages draw the same rail (`ToolsHost.openNav()`), and Explore tools shows the menu button
  wherever the rail is the drawer.
- **Media's home** (`MediaHome.tsx`'s `HeroSection` in Media mode, My Apps under it) is its own
  scroll container (App.tsx's `.media-home`, without a scrollbar): the chat experience's `<main>`
  clips, so it never scrolled at all. Below 961px it starts under the shell's menu button, its
  promo is 16:9 on a tablet, a square story card on a phone (text over a bottom gradient, the bars
  along the top) and a low banner on a phone's side, and a sideways swipe moves a slide. Projects
  are three columns, two on a phone; a touch screen opens a card's Rename and Delete from its
  three dots or a long press, as a sheet. New project is a pill over the bottom edge, and My Apps
  takes the Code tab's narrow rows and sheet.
- **The gallery** keeps its justified rows, shorter and closer: 128px rows 6px apart on a phone,
  176px and 8px on a tablet. The composer floats centred, at most 600px wide, and rises above an
  open keyboard (`useKeyboardInset` publishes `--media-keyboard-inset` from the VisualViewport).
- **Menus are sheets.** Below 961px every `FlowMatMenu` (context menus too), the Filters panel,
  the composer's settings and the image edit settings dock to the bottom over a dimmed page. A
  tablet's sheets stop at 640px, centred. Their toggles grow to 44px, and so must the rows that
  hold them, which the desktop sizes for 34px and 42px toggles: a row left at its own height lets
  its toggles run into the next row. The composer settings' model lists open in place, pushing
  the rows below down, so the sheet scrolls instead of cutting a floating list off at its edge.
- **Panels take the screen.** The agent and the music player float over the gallery on a tablet
  and fill a phone, and end above an open keyboard. The agent's welcome scrolls in the room above
  its prompt box. The prompt's Add panel and the media picker become one column, where a press
  adds an asset instead of previewing it first; on a phone's side the Add panel spans the room
  above the composer instead, its own height being more than the screen has.
- **The editors.** The image view and the Scenebuilder keep one header row of 44px round buttons.
  A phone moves Share, Move to trash and Info into More and leaves Done to the back arrow. The
  navigation rail gets a row of its own, and history becomes a `VersionStrip`
  (`editor/VersionStrip.tsx`) between the picture and the prompt: pressing a version selects it,
  and pressing the open one, or holding any, lists its actions. Crop's shapes become a row over
  Cancel and Crop, a scene's shape a pill in the corner, and a phone's playback row regroups.
- **Touch, at any width.** `(hover: none)` drops every hover hotbar. On iOS a tap that reveals
  hidden content is spent on the reveal, so a tile would not open. In its place each tile has a
  `TouchMoreButton` in a corner, and `useLongPress` (500ms, touch only) stands in for the
  right-click. The click a lifted finger sends after a long press is swallowed, so it cannot
  land on the new sheet's backdrop. On the timeline a finger scrolls and a tap seeks; the
  playhead and the trim handles take the drag, and clips move with Move earlier and Move later
  in their menu.
- **Characters, Music, Tools, TV.** New character's and New music's samples are two columns on a
  tablet and one list on a phone. A character's page keeps characters.css's stacked layout, with
  its history as the version strip. A tool's Edit shows one pane at a time: Agent, Preview or
  Code. Create tool's prompt box stands under the hero and suggestions instead of floating over
  them, so a short window scrolls them above it. Willow TV keeps Flow TV's phone layout below
  768px; from 768 to 960px the remote's prompt narrows so the row fits.
- **A phone on its side** opens the rail as the drawer (above), scrolls the editors as a page
  instead of squeezing the picture, and keeps a phone's gallery rows.
- **Checking it.** `tools/scratch/w-responsive.cjs` captures every surface (`--sizes=` phone,
  small, tablet, sideways, desktop, among others) into
  `tools/ui-research/captures/willow/responsive/` (the desktop baseline is `baseline-desktop/`),
  recording overflow, off-screen controls, small targets and overlaps: two controls in one layer
  whose visible parts run into each other, which a screenshot is easy to pass over.
  `--only=selftest-overlap` puts the settings sheet's old fixed rows back in its own browser to
  show the check catches them; `--dump=<selector>|…` prints where elements sit.
  `tools/scratch/png-diff.cjs` compares a desktop run with the baseline.

## Dependencies

Imports from 9 Willow packages: `@willow/storage` (9, save/load), `@willow/auth`
(8, user/projects), `@willow/assets` (7, sample media), `@willow/ui` (6), and
`@willow/projects` (6, registry + file-content). All horizontal — no forbidden
imports.

Media saves through `@willow/storage/media-storage`, which the storage layer calls
directly. It does **not** use the `project-contributors` registry (only Design
does) — so if you add a Media-owned sub-folder to a saved project, decide
deliberately between extending `media-storage.ts` and registering a writer.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/chat`](../chat/AGENTS.md) — the standalone chat surface
- [`platform/ai`](../../platform/ai/AGENTS.md) — model clients, chat orchestration, computer use
- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../../platform/core/AGENTS.md) — utilities, types, constants
- [`platform/projects`](../../platform/projects/AGENTS.md) — project data model and registry
- [`platform/storage`](../../platform/storage/AGENTS.md) — persistence, adapters, sync
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/chat`](../chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../code/AGENTS.md) — the Workbench: sandbox and visual editing

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
