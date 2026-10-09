# The bot harness

A bot is an always-on assistant that lives in one never-ending conversation. It
decides when to speak, works between conversations, delegates, sleeps and wakes
on its own, and keeps one relationship going for months. This folder is the
harness that makes it one: the turn loop, the protocol, the memory, the runtime
that wakes it, and its tools.

**The feature is called Bots.** Everything a user or a model reads — labels,
messages, notifications, prompts, docs, comments — says "bot" and "bots". Code
keeps its names (`DotThread`, `dots/`, `dot-runtime.ts`) and so do stored keys
(`willow-dots`, `willow:dots:*`, `willow-dot-*` locks): renaming those would lose
saved bots and conversations. Write new text the same way.

It is a fork of Spark's harness (`../../harness/`, itself a port of
openai/codex). **Spark's harness is not modified by anything here**; the fork
imports what it can reuse unchanged and owns everything that behaves
differently. Read `../../harness/AGENTS.md` for the parts this builds on.

`REFERENCES.md` says what the bots' instructions and turn handling took from six
other harnesses — Codex, Hermes Agent, OpenClaw, OpenDots, rakazo and OpenMuse —
read from their source, and what was deliberately left out.

## Layout

```
harness/
  REFERENCES.md         What came from which harness, and why.
  dot-runtime.ts        The always-on part: what wakes a dot, one turn per dot, timers, recovery.
  runtime/
    protocol.ts         The wire format: Spark's call/patch envelopes plus message/react/status actions.
    stream-parser.ts    Fork of Spark's ResponseStreamParser with the action envelopes.
    dot-loop.ts         One turn: stream → actions applied live → calls (look-ups at once) → steering → repeat.
    helpers.ts          Background helpers: headless runs of Spark's harness, reporting to the dot.
    computer-bridge.ts  How a dot reaches the user's computer: the local companion's requests.
    computer-access.ts  The user's side of it: connecting a folder, approvals, background jobs.
    edits.ts            Edits proposed while the user has the bot ask first: apply, decline, withdraw.
    screen-view.ts      How the model points on a screenshot: pictures sized for its API, positions back to pixels.
    screen-bridge.ts    The user's own screen, each system its own way, through the companion.
    screen-control.ts   The user's go-ahead for their screen: the card, Allow, Stop, lapsing.
    screen-overlay.ts   Windows' overlay following a bot's grant: shown on first use, down at its end.
    transfer.ts         Files copied as they are between the bot's own computer and the user's.
    machine-bridge.ts   How a dot reaches its own computer: the companion's `machine.*` requests and events.
    machine-access.ts   The user's side of that: setting it up, the wheel, secrets, and what the dot hears.
    proactive.ts        Quiet hours, pacing, and read-only research moments.
    web-lock.ts         Run-once-across-tabs helper (Web Locks).
  triggers/
    trigger-spec.ts     Conditions: reading them from a call, the next time one fires, saying them in words.
    trigger-store.ts    A dot's triggers in its runtime state, and every change to them (routines migrate here).
    trigger-watch.ts    Looking at what event triggers watch, and saying only what is new.
    trigger-engine.ts   When triggers fire: time triggers with the runtime's timers, polled ones every 30 s.
  memory/
    budgets.ts          How much of the context window goes where; per-model window table.
    tokens.ts           Character-based estimates, calibrated per dot against provider usage.
    render.ts           How items read to the model (ids, local timestamps, protocol form).
    context-builder.ts  Assembles system prompt, memory packet, verbatim window and <now>.
    notebook.ts         The dot's curated memory files.
    recall.ts           Lexical search and id/around lookups over the full record.
    compaction.ts       Background episodes and chapters; emergency compaction.
    compaction-prompts.ts
  overlay/
    dot-profile.ts      The dot's system prompt.
  tools/                memory, recall, sleep, trigger, Spark tasks, helpers, skills, personal data,
                        the user's computer, the dot's own computer (machine-tools.ts); assembly.
  thread/
    thread-types.ts     The thread: items, episodes, notebook, runtime state.
    reactions.ts        Reactions both ways, folded from the record; which of the user's may answer.
    thread-store.ts     The live copy (nanostore) and every mutation; cross-tab sync.
    thread-persistence.ts  IndexedDB (and in-memory, for tests).
```

### What comes from where

| Piece | Source |
| --- | --- |
| Call and patch envelopes, `parseCallBody` | Imported from Spark's `runtime/protocol.ts` / `stream-parser.ts`, unchanged |
| Patch engine (`parsePatch`, `applyPatch`) | Imported from Spark's `runtime/apply-patch.ts`, unchanged |
| Patch grammar in the prompt | Sliced from the vendored `UPSTREAM.applyPatchInstructions`, exactly as Spark slices it |
| Workspace files (`read_file`, `list_files`, `search_files`) | Spark's `FILE_TOOLS`, unchanged |
| Skills, connected apps, MCP (`use_skill`, `app:*`, `mcp:*`) | Spark's `createSparkCapabilityTools`, unchanged |
| Background helpers | Spark's `runSparkHarnessTurn`, unchanged, run headless |
| Stream parser | **Forked**: adds message/react/status, drops Work Title / Final Response |
| Turn loop | **Forked** from Spark's `runIteration` structure; actions, recording, steering, concurrent look-ups and the repeated-call guard are new |
| System prompt | **Written for bots** (see below; what it took from other harnesses is in `REFERENCES.md`) |
| Memory, runtime, thread | **New** |

Spark's browser (`computer`) and shell (`run_command`) capability tools are
deliberately not offered. In the desktop app a bot has a computer of its own
for that ("The bot's own computer" below); elsewhere browser work is delegated
to a Spark task, where the permission card and the remote browser pane live.
A bot's way onto the user's own computer — every command approved in the
conversation — is described under "The user's computer".

## The protocol

Prose outside an envelope is **private**. The user sees only messages and
reactions:

```
*** Message
…Markdown, delivered to the user as it is written…
*** End Message

*** React: i482 👍 Sounds good to me
*** Status: Comparing the three venues
*** Call: recall
{"query": "venue deposit"}
*** End Call
```

Messages, reactions, statuses and patches are **actions**: they apply the moment
they close, with no round trip. Calls stop the stream and their results feed the
next iteration. Two consequences are load-bearing:

- **The most common turn costs one request.** Reading a message and answering it
  is a single model call, and the message streams while it is written.
- **Silence is as easy as speaking.** A response with no message envelope says
  nothing to the user, and a reaction on its own is just a reaction. If ordinary
  prose were the reply, a model that only wanted to acknowledge would still emit
  text, and the filler "Got it!" is the failure this design exists to prevent.

A reaction is any single emoji (`normalizeReactionEmoji`: Unicode's RGI emoji —
skin tones, ZWJ sequences, flags — with a text-style symbol like `❤` given its emoji
form), targets only the user's messages, and carries a two-to-five-word label: the
user sees only the emoji, as a messenger's pill on the bubble, and the label is its
accessible name. The prompt names no emoji and lists none; it says any single emoji
works and to use the one that fits. Nothing in the harness gives an emoji a meaning
of its own. Something that is not one emoji is reported back to the bot (as a notice
event) so it can correct it. Telegram lets bots react with a fixed set, so a reaction
mirrored there goes as it is when allowed, as the nearest Telegram has otherwise, and
not at all when nothing is near (`telegramReaction`).

**An answer that reached nobody.** A model can answer in plain prose, outside a
message, or return nothing at all — Gemini with high thinking does both — and the user
would be left with "Seen" and silence. So a response with no message, no reaction and
no call, while the user's latest message has had nothing from the bot, gets one notice
for the turn (`UNHEARD_NOTICE` in `dot-loop.ts`: text outside a message is private; if
it meant to say something, send it as a message; if saying nothing is right, end
again) and one more request. A second silence ends the turn: nothing is forced.

**Work in silence.** Work the user is waiting on, run for 10 s with no word to them
(`QUIET_WORK_MS`), carries one notice with the next request the work makes anyway, once
a turn: unless the next step is the answer, let them know first — a reaction or a short
message, whichever fits (`quietWorkNotice`). The prompt asks for the same before the
first step; this is for a model that dives straight into its tools.

**A new bot says nothing first.** Connecting the computer to a bot nobody has written
to yet is a quiet notice (`spokenTo` in `computer-access.ts`): woken into an empty
conversation, the model greets — once for every wake.

### Reactions, both ways

The user reacts to the bot's messages too, from the picker's quick row and its
wider set, as in a messenger: one reaction per message, a new emoji replacing the old, the same one
again taking it back. Each change is a `user-reaction` item — an input, appended
by `reactToDotMessage`, never an edit — whose `text` is the start of the message
it is on (`messageExcerpt`), because the bot's own output carries no ids in its
view: the bot reads "The user reacted 👍 to your message “…”". A reaction wakes the
bot only when it may answer something (`reactionMayAnswer`: the message asked a
question the user has not written back about since, or the emoji is 🤔);
anything else is an acknowledgement the bot reads the next time it acts, and the
`<now>` block counts it as news. The prompt tells the bot never to answer a
reaction just to acknowledge it, to take a clear reaction to its question as the
answer, and to look again at what it said when a reaction signals doubt.
`thread/reactions.ts` folds both directions from the record for the UI.

## The runtime

`dot-runtime.ts` has no request/response cycle. A bot has an inbox — every
`user` and `event` item after `runtime.lastActedSeq` — and a turn runs whenever
the inbox has something and the bot is not already working. What fills it:

| Source | How |
| --- | --- |
| The user writing | `sendDotMessage` appends a `user` item and kicks the bot |
| The user reacting in a way that may answer | `reactToDotMessage`, when `reactionMayAnswer` (any other reaction waits for the next turn) |
| A sleep ending | A timer armed from `runtime.wakeAt`; late wakes say how late |
| A time trigger coming due | The same timer, armed from the soonest trigger (`nextTimeTriggerAt`); late runs say how late, once |
| An event trigger finding something new | The trigger engine's look every 30 s at due triggers (mail, calendar, GitHub, a page, a folder) |
| A Spark task reaching what a trigger watches for | The `sparkState` subscription (`hearSparkTasks`), for tasks the bot did not assign |
| The user coming back after time away | `watchPresence`: on opening Willow, and when a hidden window is shown again |
| A quiet moment for research | Every 5 minutes, `researchDue`; every 2.5 hours of the user's day, look-and-plan only (below) |
| A Spark task the bot assigned changing state | Subscription to `sparkState`; only terminal or needs-input changes post an event |
| A helper finishing | `onDotHelperFinished` |
| The user answering a command request | `approveDotCommand` / `declineDotCommand` (the "approved, running" step alone does not wake it) |
| The user answering a proposed edit | `applyDotEdit` / `declineDotEdit` (the `applying` step alone does not wake it) |
| The user answering a request for their screen, or taking it back | `allowDotScreen` / `declineDotScreen` / `stopDotScreen` (a lapse is quiet) |
| A background job starting or ending | The approval flow, then the job watcher |
| The user connecting their computer | `connectDotComputer` |
| The user answering a request to set up the bot's computer | `setUpDotMachine` / `declineDotMachine` (`ready`, `failed`, `declined`) |
| A request for help at its computer ending | The machine watcher: handed back, dismissed, lapsed, interrupted; a secret entered |

**Being created wakes nothing.** A new bot sends no message of its own and has no
instruction to: its conversation starts empty — no greeting, no suggestion chips —
and its first turn answers what the user writes first.

**Bots run on every page.** `SparkWorkspace` is always mounted — the routed page,
or the background-only instance the app keeps above its routes — and either one
starts the runtime and registers the Spark task host. In the desktop app,
closing the window to the tray keeps the page, and so the bots, alive.

**One turn per bot, across tabs.** `kick` takes the Web Lock
`willow-dot-turn:<id>`; a tab that cannot get it backs off and looks again later.
Other tabs see the turn's output through the thread store's broadcast.

**Steering needs no special path.** A message that arrives mid-turn is appended
to the thread like any other; the loop rebuilds its context from the thread on
every iteration, so the model sees it on its next request. A response with no
calls ends the turn only if nothing new arrived meanwhile.

**Calls that only look run at once** (`CONCURRENT_TOOLS` in `runtime/dot-loop.ts`).
The calls in one response run once it ends, in the order written. The exception
is a stretch of consecutive calls to tools that only look — `recall`, web
reads, skills, attachments, workspace files, `user_files`, status checks. Those
go out together, and their call and result items are still recorded in the
order written. The bot's own computer is left out: a call there may start it,
and starting is one at a time. Anything that acts runs alone, in order. Pictures
from look-ups add up; of screenshots only the latest is kept. The prompt tells
the bot to put independent look-ups in one response for this reason.

**The same call over and over is stopped.** A call identical to the one before
it, same tool and same arguments in any key order, is counted. At the third in a
row (`REPEAT_NOTICE_AT`) the bot gets a notice to change course. The sixth
(`REPEAT_STOP_AT`) is refused without running. One more after the refusal ends
the turn with a notice (reason `limit`). Repeating some tools is normal, so
`REPEATABLE_TOOLS` are neither counted nor allowed to keep a streak alive:
screenshots, zooms, scrolling, key presses, window and control lists, page
reads and status checks. Clicking "next" between screenshots is never mistaken
for a loop.

**A change gets checked.** A turn that changed files on a computer and has run
nothing since gets `CHECK_CHANGE_NOTICE` once, before it would end, provided it
has a tool to run something. The change counts only from `user_apply_patch`
returning "Changed …" (a patch still on the user's card does not) or a
successful `computer_apply_patch`. A later `user_run_command`, `user_start_job`
or `computer_run_command` counts as the check. The bot may still end its turn
again; the notice asks, it does not insist.

**Sleep ends the turn.** `sleep` records a wake time and the turn stops; waking is
a new turn that reads exactly what happened, because every step was recorded.
Nothing is held open in memory across a sleep, which is what lets a sleep survive
a reload — and why there is no blocking "wait for task" tool: the bot ends its
turn and is told.

**Stop means stop.** An interrupted turn marks its inputs handled; otherwise the
bot would start straight back up on the message that triggered it.

**Start-up recovery.** On start every thread is loaded, routines from before
triggers become schedule triggers, a turn left `working` by a closed tab resumes
from the record, overdue wakes and time triggers fire (late, once), orphaned
helpers are reported as interrupted, and anything unseen gets a turn.

**Plans carry work through** (`runtime/plan.ts`, `tools/plan-tools.ts`). `update_plan`
is Codex's tool, plus a `waiting` state (a step that waits on someone or something
else) and a `goal` (how the bot will know it is done). The plan is in `<now>` every
turn and shows as a live card. After each turn `settlePlan` asks `planNext`: with
steps the bot can move and nobody holding it up — no card waiting on the user, no
Spark task or helper running, no sleep — it posts a `continue` event and the bot
works on, turn after turn, with nobody asking. A finished plan posts `reflect` once:
Hermes's learning loop, keeping a reusable way of working as a skill and lessons in
the notebook. The only brake is for loops: `STALL_TURNS` (3) continuations in a row
that leave the plan as it was stop the waking until the plan changes or the user
writes, and the card says so. There is no limit on how much a bot works.

**Failed turns try again by themselves** when the failure passes by itself — rate
limits, overload, outages, dropped connections (`TRANSIENT_ERROR`): after one
minute, then four, fifteen and sixty, the error line saying when. Such a turn leaves
its input unhandled, so the next try resumes from it (seeing whatever the failed
one already did). Anything else stops with the error shown; Retry hands the last
input back, so there is always something to answer.

**The notebook keeps out what should not be in view on every turn**: writes drop
zero-width and direction-changing characters (a page or an email cannot smuggle
hidden text in through the bot), and refuse anything shaped like a credential.

## Triggers

"When this happens, do that": a standing instruction with a condition, which the
bot makes with its `trigger` tool (create, update, pause, resume, delete, list)
and the user sees as a card in the conversation and under "Scheduled" in the
profile, where they can pause, resume, run or delete it. They replace the
routines bots had before (`migrateRoutines`). Shaped after what OpenAI's bots
and Gemini Spark offer — schedules with an end, events from connected apps, a
monitoring task's stop condition in its instruction, several matching events in
one run — in Willow's own types (`thread-types.ts`, `DotTrigger`):

| `when.type` | Fires | Looks at |
| --- | --- | --- |
| `once`, `schedule` | At a time: once, or every N minutes (5 or more) / hours / day / weekday / week / month day / year day (a 29 February on the 28th in other years), on the user's wall clock in the zone it was made in | The runtime's timer |
| `email` | New mail matching a Gmail search | `watchMail` (`@willow/personal`): ids every 3 minutes, headers only for new ones |
| `calendar` | N minutes before each event (titles matching) | `watchCalendar` every 10 minutes, the next look planned for the soonest reminder |
| `github` | A pull request involving the user, or an issue assigned to them, opened or updated | `watchGithub` every 5 minutes |
| `spark_task` | A Spark task the bot did not assign reaching a status | Spark's store |
| `web_page` | A page gaining lines, or coming to contain a text | `/api/fetch-source`, every hour by default, never under 15 minutes |
| `folder` | Files added, changed or removed in the connected folder | The companion's listing, every 2 minutes |
| `user_returns` | The user back after N hours away | `watchPresence` |
| `discord` | A Discord message in a channel (or `dm`), server, from someone, containing words, or mentioning the bot — at least one of them | The bot's Discord gateway; a burst is gathered (20 s quiet, 2 min at most) and fires once (`hearDiscord`) |

- **Only what is new fires.** An event trigger's first look records the present
  (`primed`), so mail already in the inbox never fires a trigger made today; each
  look stores what it saw (`seen`, a page's line hashes, a folder's listing) and
  reports only the difference, everything since the last look in one run.
  Resuming a paused trigger primes it again, so a pause is not followed by a
  flood. A look whose trigger changed while it ran is dropped.
- **Never a sign-in.** Background looks use tokens Willow already holds
  (`tokens.get`, never `tokens.request`), as the profile builder and the live
  reads do; an expired token or an app that is not connected becomes the
  trigger's `problem`, shown in the profile, and the look backs off.
- **Firing** records the run (ending a `once`, or one at its `max_runs` or
  `until`) and posts a `trigger` event: what happened, the instruction, and how
  the user wants to hear about it (`notify`: always, when it matters, or never).
  It wakes the bot from a sleep; a paused bot hears nothing until it resumes.
- **One window looks.** Looks run under the Web Lock `willow-dot-triggers:<id>`.
- **What a window can watch** is worked out every turn (`triggerLimits` in
  `dot-runtime.ts`) and written into the tool's documentation, so the bot knows
  what is unavailable here and why — an app not connected, Personal Intelligence
  off, page watching without Willow's fetch endpoint (a hosted deployment that
  has not switched it on), folders with none connected. Creating one refuses with
  that reason, which the bot passes on.

## Pacing, quiet hours and research

- **Quiet hours** (`runtime.quietHours`, 22:00–08:00 unless the user changes or
  turns them off in the profile): the `<now>` block tells the bot to hold what can
  wait, and native notifications stay quiet unless the bot is answering
  something the user just wrote.
- **Pacing.** `<now>` says how many messages the bot has sent since the user last
  wrote or reacted; the prompt raises the bar for another as that grows.
- **Proactive moments**: every two and a half hours of the user's day, when the bot
  is idle, the user has been quiet for half an hour, it is not their quiet hours, a
  model is set up, and there is something to look at (connected apps, or notes of
  its own), the runtime posts a `research` event (`RESEARCH_EVENT`). That turn's
  tools are cut **in code** to ones that look, take notes and plan
  (`allowedInResearch`): `update_plan` and `read_web_page`, its memory and recall,
  personal data, skills, its workspace, Spark task and helper status, the
  connected folder's files, and the connected apps' read tools (`READ_TOOLS`) —
  nothing that sends, changes or controls. It may message the user only past its
  bar for reaching out; otherwise what it found waits in its notebook. A message
  the user writes during it gets a turn of its own, with every tool. The profile
  turns research off (`runtime.research.off`).

## Standing instructions

The profile's "Instructions" (`runtime.instructions`, up to 4,000 characters) is
the prompt's "Standing instructions from the user": how the bot should work with
them, what to always do, never do, or check first. Read every turn; it outranks
the bot's defaults, never the safety rules.

## Web and desktop

As with Spark's harness, one harness and one set of instructions serve both:
only what the environment can offer changes. In the desktop app a bot has its
own computer (WSL), the user's computer through the companion the app starts,
page-watching triggers, and native notifications. In a browser it has no
computer of its own — the prompt says so and that it comes with the desktop app
(`environment: 'web'`), browser work goes to a Spark task, the user's computer is
reachable only if they run the companion, page watching needs the deployment's
fetch endpoint, and notifications are the browser's. Every such limit is decided
from the environment at runtime, and the UI hides or explains what is not there.

## Skills and apps

Skills (`use_skill`), connected apps (`app:*`) and MCP tools (`mcp:*`) are
Spark's, unchanged; `create_skill` saves a skill exactly as Spark's own does
(`skillInputFrom`, `createSparkSkill`), so the user applies it with "/" and every
bot and task can use it. `improve_skill` (`tools/skill-tools.ts`) patches one that
is in Willow's store — one exact passage, or the whole instructions — as Hermes's
agents patch theirs; with the `reflect` event after a plan, that closes the loop
from doing work to doing it better next time. The profile's "Skills and apps" lists what is on and
connected, opening Spark's Skills and Connected apps pages, and the people the bot
may email without asking, each removable.

### More apps

Spark's Connected apps page opens with a catalog of remote MCP servers ready to add
(`features/spark/src/mcp-catalog.ts`, `McpCatalog.tsx`), grouped: Zapier and Composio
(thousands of apps each, through the user's own server address); for code GitHub,
Context7, DeepWiki, Microsoft Learn, Hugging Face, Sentry, Neon, Supabase, Postman,
Cloudflare, Cloudflare Docs and AWS Knowledge; for search and research Exa, Tavily,
Firecrawl, Jina AI and Apify; for work Linear, Atlassian (Jira, Confluence — when the
admin allows API tokens) and monday.com; and Stripe. Only those that take no sign-in, a
pasted key or a pasted address, checked against each vendor's docs (October 2026);
a key goes under the vendor's own scheme (`Bearer`, Sentry's `Sentry-Bearer`, or
`Basic` for Atlassian's `email:token`, encoded). Servers that take only OAuth are
signed in to from the desktop app — Notion, which lets Willow register itself, and
Asana and HubSpot, which ask the user to make an app of their own (its client ID and
secret, with `http://localhost:3334/oauth/callback` registered as its redirect).
Servers that admit only clients they approved (Figma, Vercel) are left out. The
protocol is `platform/ai/src/mcp/mcp-oauth.ts` (discovery from the server's 401 or
its well-known metadata, dynamic registration, PKCE S256, the `resource` binding,
refresh keeping a rotated refresh token); the transport sends the token and on a 401
refreshes once before saying to sign in again; the grant is kept with the server's
config. The browser half is `features/spark/src/mcp-signin.ts` with the companion's
`oauth.*` (its AGENTS.md). Ten of the key apps also take a sign-in that registers
Willow (Sentry, Neon, Supabase, Postman, Cloudflare, Apify, Linear, Atlassian,
monday.com, Stripe — each checked live), offered as "Sign in instead" beside the key;
an app whose sign-in ended offers "Sign in again". A server added by address that
answers 401 (`needs-sign-in`) offers Sign in too, falling back to the user's own app
where the server does not let apps register (`McpOAuthError` code `no-registration`).
Whatever a server offers reaches every bot as `mcp:` tools. In the desktop app, MCP
requests go through the companion (`mcp-relay.ts`, `relay.http`, loaded at startup by
`register.ts` so the Code tab has it too), so servers that send no CORS headers — most
of them — still connect.

In the desktop app a server can also be **a program on this computer** — MCP's stdio,
most of the published ecosystem (`npx …`, `uvx …`, `docker run …`): the user types its
command and any `NAME=value` variables (`mcp-program-input.ts` splits them, quotes kept
together and backslashes left alone, never through a shell), and the companion starts
it when the server is turned on (`mcp.*`, its AGENTS.md). The window's transport is
`platform/ai/src/mcp/program-transport.ts`: a program of its own per connection, the
handshake allowed five minutes because a first `npx -y` downloads the server, and a
program that ends failing what was waiting at once with what it printed. One that
ends after connecting is shown failed and started again once a minute at most. The
catalog's "On this computer" group, shown only where programs can run, adds five in a
click, each started and listed here (October 2026): Playwright and Chrome DevTools
(`npx`), Files (`npx`, in a folder picked with the system's dialog), Git and Fetch
(`uvx`). A server added by hand never takes a catalog app's id.
`settings.json` keeps a server's sign-in and its program fields.

### Email

Gmail's basic access is headers (`gmail.metadata`), which cannot search: Google
answers `q` with a 403, even on a token that also holds `gmail.readonly`. So with it,
`listMailIds` lists the newest mail and `parseMailSearch`/`mailMatches` apply
`from:`, `to:`, `subject:`, `is:unread`, `in:inbox`, `newer_than:` and plain words to
headers by hand; terms it cannot apply widen the result rather than narrow it.
Turning on **email contents** under Google in Settings → Connected Apps
(`connector-options.ts`) swaps the read scope for `gmail.readonly` — never both —
from that click; then Gmail searches, `read_email` reads a whole message, and email
triggers carry the start of what each new message says (`mailExcerpt`), which their
conditions are screened against.

Sending is `send_email` (`tools/email-tools.ts`, `runtime/outgoing.ts`), with the
`gmail.send` write scope the user grants from **Make changes for you** on the same
card (`authorizeWritesFor`, one consent screen for every Google write scope). The
tool posts an `outgoing` card with the message exactly as it will go; the user sends
it, sends it and lets the bot email those people again without asking
(`runtime.sendTo`), or declines. `sending` is written under a lock before the send,
so a reload or a second window never sends twice; `sent`, `declined` and `failed`
wake the bot. Mail to people already allowed goes at once, its card the record and
its outcome on the card itself, so no event wakes the bot to hear it again.
`reply_to` threads a reply (`In-Reply-To`, `References`, the thread id) from headers,
which any access can read.

## Memory and context

The user asked for a sliding window: keep the most recent 200–300k tokens
verbatim and summarise the rest in the background. That is the core of this
design, with three layers added so that nothing is ever actually lost:

```
system prompt        stable
<memory>             about the user (Willow), the notebook, episodes/chapters
verbatim window      every item the episodes do not cover yet
<now>                local time, what is new, status, delegations, budget
```

1. **The record.** Items are append-only and never deleted. Every summary is an
   index into the record by item id, and `recall` reads it back verbatim — so a
   summary can drop a detail, but the detail is never gone.
2. **The sliding window, with hysteresis.** The verbatim window is everything
   after `runtime.lastCompactedSeq`. When it passes `verbatimHigh` (three quarters
   of the context: 750k tokens on a 1M-token model, at most 800k — `budgets.ts`),
   background compaction summarises its oldest stretch into an episode and trims it
   to `verbatimLow` (a fifth of the context: 200k on a 1M-token model), so the
   latest stretch never changes under the bot. Nothing of it shows: no activity
   label, no message. The gap means compaction runs once per stretch of
   conversation, not every message, and the prompt prefix stays stable — and
   cache-friendly — in between. Cuts land on exchange boundaries, so a call is
   never separated from its result.
3. **Episodes roll up into chapters.** When episodes outgrow their budget, the
   oldest are merged into a higher-level chapter. Recent history stays detailed,
   old history stays present but compressed, and the whole past fits in bounded
   space however long the thread runs. Open loops are always carried forward;
   closed ones are recorded as closed so finished work is never reopened.
4. **What the bot has learned about the user** (`memory/learning.ts`), its own
   Personal Intelligence: a profile in six sections — their work as it bears on
   what this bot does, how they like things done, people, goals and projects,
   routines, other durable facts — learned in the background from its own
   conversations. This bot's alone: never shared with other bots or written into
   Willow's profile, which every bot also reads (`<about_user source="Willow">`)
   while Memory is on. A pass reads what is new since the last (after six user
   messages, or six hours with one), in quiet moments once the prompt cache has
   lapsed, and always before a compaction — up to eight passes — so what a summary
   leaves out has been learned first. The model proposes changes; `applyLearning`
   keeps only checked ones (known sections, one sentence, no secrets, no copies,
   real sources, caps). The user reads, prunes, forgets or turns it off in the
   bot's Settings; Memory off turns it off.
5. **The notebook.** Files the bot curates itself, always in view: `user.md`,
   `people.md`, `commitments.md`, `projects.md`, `routines.md`. This is the layer
   that keeps promises across months, because the bot wrote it deliberately
   rather than hoping a summary kept it.

Why the window is a slice and not the whole context window: a bot wakes many
times a day and every wake re-sends its context. Filling a 1M window each time is
slow, expensive and measurably worse — recall and instruction-following degrade
as prompts grow. OpenAI's Codex build runs GPT-6 Astra (the bots model) at a 272k
working window although it accepts 872k.

Other context mechanics:

- **Tool output masking.** Results further back than `maskAfter` tokens collapse
  to a stub naming their id; `recall` reads them in full. Compaction measures the
  window *as masked*, so one big search does not trigger early compaction.
- **When to compact** (`compactionTiming`). Past `verbatimHigh` it is due after the
  turn that crossed it. In the last stretch before the line (half way from low to
  high), an idle bot compacts early — but only once it has been idle past the
  provider's prompt cache (`PROMPT_CACHE_MS`, five minutes): shifting the window
  costs a cached prefix mid-conversation and nothing once the cache has lapsed, and
  the next conversation then starts with room. A one-minute check does this; it never
  runs during a turn, and a failure backs off (2 minutes doubling to an hour). Every
  compaction, the blocking ones included, takes the `willow-dot-compact:<id>` lock,
  so two never summarise the same stretch. Episodes record where unfinished work
  stands and its next step, so it resumes without repeating anything.
- **Mid-turn**, as Codex compacts in the middle of a task: before every request
  (`beforeRequest`), a window past its line starts compaction in the background
  while the bot keeps working; the request waits for it only when it would not
  otherwise fit (90% of `hardCap`). The latest stretch — the turn's own work with
  it — stays word for word, so the bot carries on as if nothing happened. A turn
  has no ceiling on requests: it ends when its work does, however long that runs.
- **Overflow.** If the uncovered tail is far past budget, compaction runs before
  the turn. If the provider still rejects a request as too long, the loop raises
  `DotContextOverflowError`; the runtime compacts hard and retries once. If
  compaction is behind, the oldest uncovered items are left out of *that request*
  (never out of the record) and the memory packet says how to recall them.
- **Writing it down in time** (`notebookLine`). `<now>` gains a line in two cases:
  - When the uncovered window passes 90% of `verbatimHigh`. The oldest stretch
    will soon be condensed, so anything the notebook lacks should be written
    now.
  - When `NOTEBOOK_STALE_AFTER` (15) of the user's messages have arrived since
    any notebook file last changed.

  This is OpenClaw's pre-compaction memory flush and Hermes's background review,
  done in a turn the bot is already taking instead of a model run of its own.
- **Only messages reach them.** While the user's messages are new, `<now>`
  reminds the bot that the user sees only its messages and reactions. It is
  said where the model looks last, before it writes, alongside the unheard
  notice that catches an answer written as private prose afterwards.
- **Calibration.** There is no tokenizer. Estimates start at 3.8 characters per
  token and are corrected per bot from provider-reported input tokens.
- **Model windows.** Willow's catalog has no window sizes, so `budgets.ts` keeps a
  table by model id; unknown models get a conservative 128k.

## Behaviour: how the prompt is written

`overlay/dot-profile.ts` is the bot's own prompt, not an overlay on Codex's CLI
prompt: most of that prompt is about producing final answers to coding requests,
and its rules about final answers and formatting would argue with a messenger's.
The bot keeps Codex's runtime and writes its own prompt, informed by OpenAI's
documented bot behaviour and the long-running "persistent" style of the Codex
runtime bots run on. The text is Willow's own.

**No examples.** Every behaviour — when to reply, react, stay silent or reach out
unprompted — is stated as a principle about what the moment asks of the bot. A
model given sample messages reproduces them and stops applying the principle
wherever the sample does not obviously match. Keep it that way; a test pins it.

**A turn is a stretch of a working day, not one reply.** Models trained on
request-and-answer harnesses do everything in one go and speak once, at the end.
The prompt's "Your conversation", "Deciding how to respond" and "While you work"
sections, with the protocol's note that a message reaches the user the moment its
envelope closes, teach the rhythm of a person working over chat (drawn from Codex's
preambles, Manus's notify/ask split, Slack's 👀-then-✅ habit and Horvitz's
principles of mixed-initiative interfaces):

- Something quick is simply answered: the answer is the acknowledgement.
- Work that takes time is acknowledged before it starts, in the same response as
  the first call — a reaction when the request says it all, a sentence when there
  is something worth saying (the plan, the timing, an assumption) — never both.
- Step-by-step progress belongs on the status line; a message mid-work only when
  something changes for the user (a usable result, a choice, a question, a problem,
  an unexpectedly long wait).
- A question is asked as soon as it arises, and work that does not depend on it
  goes on; an optional answer is assumed and said, a required one waited for —
  time passing is never consent.
- The user's messages mid-work come first, then the work carries on as changed.
- Long work goes to helpers, jobs and Spark tasks, so the bot stays free to talk.
- Work ends with its outcome; a reaction can close a request that needed no report.
  Reacting again to a message replaces the bot's earlier reaction (in Willow and on
  Discord), so 👀 can become ✅ as a person's would.

The rhythm matches what OpenAI's own bots do in practice: a short first-person
message before substantial work (what it is doing, the plan when there is one),
a message at each real turn in the work (the plan settled, a problem found, a change
of approach), each saying what changed and what comes next, and a closing message
with the outcome and what was not checked. Reactions and messages are two equal
ways of answering at each of those moments — starting, a message arriving mid-work,
finishing: a reaction when the gesture says everything, a message when there is
anything to say, both only when each does a different job (a reaction that said the
bot was on something can move on to done while a message carries the results).
Nothing in its view tracks those reactions as promises to keep: which emoji, and
whether to react at all, is the bot's call each time. The bot's reactions show on
Discord and, in the nearest emoji Telegram allows, on Telegram too.

**Doing the work well.** The prompt's "Doing the work well" section, and lines
added across "How you work", "Plans", "Triggers", "Memory", "Delegating",
"Writing messages" and "Safety", carry what the strongest agent harnesses teach
about the work itself:
- act rather than describe;
- find out before asking;
- check anything that changes instead of recalling it;
- settle what an action depends on before taking it;
- batch independent look-ups;
- retry a thin result another way;
- never invent;
- keep exact things exact;
- verify, reading back anything sent or saved;
- never redo what may already have happened;
- fit the work to the request;
- know what you can do before saying you can't;
- promise later only when something will bring you back.

`REFERENCES.md` records what came from which harness and why. The words are
Willow's own, and a test checks that no other harness is named in the prompt.
The helper brief (`helperPrompt` in `runtime/helpers.ts`) carries the same
discipline for a helper working alone.

**Turn awareness.** A model in a run of tool calls has no sense of time. Once a
turn has taken a step, `<now>` says how long it has run and how many steps it has
taken, when the user last heard from the bot in it (once three steps have passed
since), and names the user's messages since it began that have had no word from the
bot — no message after them, no reaction on them — with how long ago the first was
written (`turnLines` in `context-builder.ts`). The prompt tells the bot to let that
say when a word is due; it never says a word must come.

**Typing shows only while the bot writes**, as a person's does. In the
conversation, the message being written is three dots in its place until it is
whole (`TypingBubble` in `DotChat.tsx`); working without writing shows under the
bot's name in the header — its status line, or what it is doing (`activity.status`,
`activity.label`) — and in the profile's Now card. Discord and Telegram show
"typing…" only while a message is being written for them (`startTyping` in
`runTurn`). "Seen" appears under the user's latest message once the model has it in
hand — at the first sign of life of a request that carried it (a thinking phase,
a token, a thought or usage), not when the request was sent: the loop reports a
`read` event and the runtime keeps `runtime.readSeq` (threads from before it read
`lastActedSeq`). It stays there while the bot thinks, works and types (a message
still being written does not count as the latest), and goes once the bot's answer
is written, the reply saying it was seen (`seenRow` in `chat/chat-rows.ts`). A
message handled without being read — a stop, a pause — is not "Seen".

**Writing while the bot works steers it, never interrupts it.** The message joins
the thread at once. The response the model is writing, and the calls in it, finish
as they were. The next request carries the message, placed after that step's
results, and the bot carries on with its work, changed as the message asks. The
loop rebuilds its context on every request, and a response with no calls ends the
turn only if nothing arrived meanwhile. So the message is "Seen" when that request
begins, not when it is sent. Only Stop (`interruptDot`) and pausing cut a turn
short. A turn that ended just as the message landed is followed by another
(`kick`'s `again`).

**Pictures and files.** The composer's files go with the message, or on their own
(`allowFilesOnly`): `storeDotAttachments` keeps them as Spark's attachment payloads
(IndexedDB, by storage scope; Spark's limits of 8 files, 5 MB each, 20 MB in all) and
the `user` item holds their references. The files a turn's messages brought go with
every request of that turn, on its `<now>` message, with a line naming which message
each came from (`withSentFiles` in `runtime/sent-files.ts`); after it, `open_attachment`
opens a message's files again. The bubble draws a picture as itself, above any words,
and any other file as a chip (`SentPicture` in `DotChat.tsx`).

**Marks.** A line of the conversation's own, centred and the size of a day label
(`chat/chat-rows.ts`): "Connecting to <logo> Gmail" while a turn's first call to an app
runs, as Willow's chat names an app, and "Connected to" after — once an app a turn,
for connected apps (`app:*`), the bot's email and MCP servers (`chat/app-marks.ts`) —
and the user's screen in the bot's hands. Each turn that used the screen gets a line
at its first look under a go-ahead. While that turn is under way and the go-ahead
holds, the line is a capsule: "Pip is using your screen", with Stop (`ScreenMark` in
`DotChat.tsx`). Once the turn is over it reads "Pip used your screen", however long
the go-ahead still holds; it is never live after the work. A go-ahead not used yet
is a line of its own ("You let Pip use your screen"). A declined request, and the
user taking the screen back, are lines where they happened. A request for the screen
still waiting on the user stays a card.

**Asks look one way** (`ask/DotAskCard.tsx`). Every card where the bot asks the user's
leave shares one shape: their screen, a command, an email or a Discord post, a change
to their files, its own computer, a hand at it. Each has:
- a glyph tile, and a kicker naming the kind of ask;
- the ask as a sentence ("Pip wants to …");
- the bot's reason, set in as its own words;
- what it would do;
- the choice at the end. The go-ahead is a filled button named for what happens
  (Allow, Run, Start, Send, Post, Apply, Set up), the alternative is "Don't …", and
  "Always allow …" is a checkbox beside them.

A card waiting on the user wears a wash of the bot's colour, arrives softly and draws
the eye once; settled cards go quiet. The screen card says what the go-ahead lets the
bot do on this system (Windows, macOS or Linux, from the app's own), how the user
takes the screen back, and how long the go-ahead lasts.

The profile's Now card has one button for pausing and resuming: it turns into play
where it is.

The decision rules the prompt encodes:

- Read what the latest message asks: something (meet it, announcing only work too
  long to wait on in silence), acknowledgement (however fits), or nothing; a
  question always gets an answer.
- Answer several waiting messages together, once.
- A reaction and a message never say the same thing; reactions are gestures, not
  decoration, and lose meaning when automatic.
- Reach out unprompted only for something the user would want to be interrupted
  for now: an awaited result, a decision only they can make, a blocking question,
  a risk while there is time to act, a real change, a clear step towards their
  goals. Batch minor news; respect stated preferences; hold non-urgent messages
  for a sensible hour.
- Waking up is not being asked: a wake, a trigger or a finished delegation obliges
  no message unless what the bot finds meets the bar above (and the trigger's
  `notify` setting says how the user wants to hear).
- A reaction from the user is usually the whole of their reply: never answered
  just to acknowledge it, read as an answer when it plainly is one.
- Pace by what has gone unanswered, and hold what can wait in quiet hours.
- A change sent mid-work is visibly taken in.
- A request to draft is not permission to send; knowing something is not
  permission to share it.
- Silence is legitimate and often the most considerate response.

These rules line up with OpenAI's published bot behaviour (interrupt only for
results, decisions and risks; route by the user's stated preferences; drafting
is not sending; authorisation never widens with time or delegation) and with
the Codex runtime's persistent mode (follow-ups need a purpose, evidence and a
stopping point; being woken is not a new request; elapsed time is not consent).
Which emoji, and whether to react or write at all, is the bot's to choose: the prompt
gives both as equals, with no list and no lean towards either, and says a question
always gets an answer. The reactions coming back from the user are this harness's own.

## Permissions

Each bot has a **Permissions** setting in its profile's Settings tab
(`runtime.permissions`, `profile/DotPermissions.tsx`): how freely it acts. Each
mode is a prompt section of its own (`permissions()` in `dot-profile.ts`, with the
user's-computer section and the tools' descriptions following it) and real gating
in the tools, read live at every call (`permissionsNow` in `tool-env.ts`), so a
change reaches a turn already running.

| Mode | Prompt | Tools |
| --- | --- | --- |
| `ask` — Ask before doing anything | Looking, researching and its own notes are free; anything that changes something waits for the go-ahead, asked once per piece of work, concrete enough to say yes to; a card is the asking | `user_apply_patch` proposes the change on a card (below); commands, email and posts on cards, as always |
| `auto` (default) — Ask when it needs to | Its own judgement; explicit go-ahead before acting on the world (sending, money, deleting, accounts, installing, sharing) | Edits at once; commands, email and posts on cards |
| `act` — Do it right away | Act at once, never stop for permission, still ask what it needs to know; not beyond the request; money, the unrecoverable and private information only when asked for exactly | Commands run, jobs start, email sends and Discord posts and reactions go at once |

In every mode the bot can ask questions about the work itself, standing permissions
(prefixes, recipients, channels allowed for good) stay honoured, and research
moments only look.

**Acting at once** keeps the user's record: a command still gets its `approval`
card, with `approved`/`started`/`finished` steps marked `quiet` — they never wake
the bot (`wakesDot`), never count as news in `<now>`, and render as nothing in its
view, since its own tool result already told it everything. A foreground command
holds its `willow-dot-command:<id>` lock while it runs, so a window opening
meanwhile does not settle it as lost; a background job's card is written once it
has started, so it never stands as a request with a Run button. Email and posts go
through `sendStanding`/`postStanding` with `standing: 'mode'`, and their cards say
they went as the bot's permissions allow.

**Proposed edits** (`runtime/edits.ts`): in `ask` mode `user_apply_patch` checks the
patch against the files and posts an `edit` card with `proposed: { patch, scope }`
instead of writing. The card lists the files and shows the change; Apply runs the
patch again against the files as they are then, under `willow-dot-edit:<id>`, after
an `applying` step (quiet), and records `applied` or `failed` — a file the user
changed meanwhile is left alone, and a patch that no longer fits writes nothing.
Don't apply records `declined`. Connecting another folder or disconnecting
withdraws proposals still waiting (their paths mean nothing elsewhere), and one a
closed window left `applying` is settled on the next start. They count among what
the bot waits on the user for (the profile's Review, notifications, the preview).

## Personal intelligence

The bot starts from what Willow already knows, assembled as Chat assembles it
(`aboutUser` in `dot-runtime.ts`): Saved Info, the profile summary, the personal
data rules (`PERSONAL_DATA_LADDER`) and the retrieval guidance. All of it answers
to the Memory switch. With Memory on, the bot has `retrieve_personal_data` — named
exactly so, because the guidance tells the model when it must call that tool.

## Assigning Spark tasks

`../../spark-task-host.ts` is the seam. The mounted `SparkWorkspace` registers a
host built from its own callbacks (`createTask`, `submitFollowUp`, `stopTask`,
`getExecutionSettings`), so a task a bot assigns runs through Spark's runner,
survives a closed tab and is taken over like any other. It appears in Spark's
lists as "Assigned by <bot>". The only change to `SparkWorkspace` beyond the
registration is an optional `options` argument on `createTask` (open the task or
not, its description, and in the desktop app the folder it works in), which
Spark's own composers never pass. With `folder`, `fileSparkTaskInFolder` files the
task under that folder before it runs, so it works there with Spark's native
runtime — Codex's commands, sessions and patches, under the folder's approval
policy. That is the bot's route to heavy coding on the user's projects.

## The user's computer

Off until the user connects it from the bot's profile. In the desktop app that is
one step, Connect, and it is the whole computer: there is no folder to pick and
nothing to confirm. A browser cannot connect the whole computer, so there the
user types the path of one folder (`connectDotComputer`), confined to it.
Everything goes through Willow's local companion (`services/local-companion`):
loopback only, paired by token in the desktop app. The desktop app starts the
companion with its window; in a browser it is there only if the user runs it.

**The whole computer** (desktop app, `connectDotWholeComputer`): the
companion's `spark.env` says where the user's home is, and `runtime.computer`
becomes `{ root: <the home drive>, whole: true, home }`. The tools then take any
full path, `~`, or a path relative to the home folder (`locatePath`), on any drive
— each drive is authorised as a workspace root when first reached — and answer in
full paths (`shownPath`); a command's approval records the drive it runs on, and
runs there. Everything else holds: commands are approved one by one, edits show as
cards, and secrets stay out of reach — with browsers' profiles, the system's
credential stores and Willow's own data added to them. The prompt says the whole
computer is reachable, not licence to roam it, and no AGENTS.md is read. Folder
triggers then name their folder in full, on the home drive. Connecting one folder
afterwards takes the whole computer back (pending commands withdrawn, jobs stopped).

Every tool here is named `user_…`, so none reads as the bot's own computer,
where nothing waits for approval.

- **Looking is free.** `user_files` lists, reads and searches the folder
  without asking, and cannot change anything. Files that look like they hold
  secrets (`isSecretPath`: environment files except shared templates, keys,
  certificates, credential stores) are listed as off limits, never read, and
  dropped from search results.
- **Editing is free inside the folder**, as in Codex's workspace-write mode and
  Spark's folder tasks. `user_apply_patch` takes Codex's patch format (parsed and
  applied by Spark's `runtime/apply-patch.ts`, imported): it reads each file, applies
  the whole patch in memory — a patch that fails anywhere writes nothing — and
  writes through the companion's `fs.write` with the modification time it read, so
  a file the user changed meanwhile is left alone. CRLF endings and a BOM are kept.
  Deleting and moving files, and anything secret, are refused: those take approved
  commands. Each edit posts an `edit` card listing files with lines added and removed.
  With the bot asking before doing anything, the card proposes the edit instead
  ("Permissions" above).
- **Prefix rules.** `user_run_command` may offer `prefix_rule` (Codex's); Spark's
  `offeredPrefix` keeps it only when safe — never an interpreter, a destructive
  command or a bare package manager — else derives one. The card's **Always allow**
  checkbox, ticked when the user runs the command, also stores the prefix in
  `runtime.computer.rules`; from then
  on `allowedByRules` (every segment must match; redirection and substitution never
  do) lets such commands run at once from the tool, their output its result, recorded
  like a command run in act mode (quiet steps) so it shows in Activity. The profile
  lists the prefixes, each removable. Background jobs always ask.
- **Typing into a job** (`user_send_to_job`, the companion's `job.write`), as Codex's
  `write_stdin`: an answer to a prompt, a choice in an installer. Never into a
  shell or a bare interpreter (`typingIsSafe`), which would run commands nobody
  approved.
- **Project instructions.** The folder's `AGENTS.override.md` or `AGENTS.md` is read
  each turn (8,000 characters at most) into the prompt's section on the user's
  computer, as Codex reads it: followed for work there, never widening what the bot
  may do.
- **Running is approved.** `user_run_command` (finishes, at most 120 s) and
  `user_start_job` (keeps running in the background) never run anything: they record
  an `approval` item — the exact command, folder and reason — which the
  conversation shows as a card with Run and Don't run (Start for a job). What runs on approval is
  that recorded command, never something the model re-issues. When the user lets
  the bot act without asking, the tools run it themselves and write the same record
  and steps, quietly ("Permissions" above).
- **Commands live in Activity** (`features/spark/src/dots/commands/`). Once decided, a
  command leaves the conversation (`decidedCommands`): only a request still waiting
  for the user stays there, where they answer it. The profile's Activity tab lists
  the commands as one entry per stretch between messages (`commandGroups`: a message
  from either side closes a stretch) — "Ran 3 commands", or the command itself when
  alone, with how they went — and an entry opens a page with every command of that
  stretch: what, where and why, its outcome and output, Stop for a running job, and
  Approve or Deny while one waits. The prompt tells the bot the user reads commands
  there, so what a run found reaches them only when it says so.
- **Every step is an event** referencing the approval (`approvalStep`):
  `approved` (written *before* a command starts, so a reload never offers to run
  it twice), `started` (a background job is running), `declined`, `withdrawn`
  (disconnected, or another folder connected) and `finished` (with the output;
  old outputs collapse in the window like tool results). A command interrupted
  by a closed window is settled on the next start as lost, never re-offered.
- **Background jobs** are the companion's (`job.*`), so they survive a reload.
  `runtime.jobs` tracks them; `user_check_job` reads output since the bot last looked;
  `user_stop_job` stops a job and everything it started. One window per machine (the
  holder of the `willow-dot-jobs` lock) polls running jobs and posts the end,
  with only the output the bot has not seen. Disconnecting, switching folders or
  deleting the bot stops its jobs.
- **Notifications.** With the profile's toggle on, a bot message, a new
  approval request or proposed edit, or a request at its own computer (set up, help, a secret)
  while Willow is out of sight raises a native notification
  (`@willow/core/desktop-bridge`: Tauri's notification plugin in the desktop
  app, the Notification API in a browser). With **On your phone** turned on under
  it, the same notification goes to the user's ntfy topic as well
  (`runtime/phone-push.ts`: one topic for every bot, made up so nobody would guess
  it, published as JSON so any script survives), which reaches them away from the
  computer. Quiet hours hold for both.
- **Telegram** (`runtime/telegram.ts`), Hermes's messaging gateway: the user links
  a bot of their own (from @BotFather) to one bot, and pairs their chat by sending
  the code Willow shows; the bot answers that chat only. One window polls
  (`willow-dots-telegram` lock) through the companion's `relay.telegram`, since
  Telegram's API refuses browsers. What the chat writes arrives as the user's
  message (`via: 'telegram'`, which the transcript and `<now>` mention), and the
  bot's messages go back when it is answering one, or when Willow is out of sight
  outside quiet hours.
- **Discord** (`runtime/discord.ts`, `profile/DotDiscord.tsx`): not a connected app
  but the bot itself in another app, set up from the Discord button under its name.
  The user makes it a Discord bot of their own (an application in Discord's Developer
  Portal; Public Bot off), pastes its token, and adds it to a server they are in —
  Discord lets a person message a bot only once they share a server. Each bot has its
  own Discord bot; the link (token, owner, DM channel) and the gateway's state stay in
  this computer's storage (`willow:dots:discord`, `willow:dots:discord-state`), never in
  the thread a folder keeps a copy of. Only the application's **owner** directs it: in
  its DM, or by mentioning or replying to it in a server, their message arrives as the
  user's (`via: 'discord'`, with `discord: { channelId, messageId, guildId?, where? }`;
  the transcript, `<now>` and the chat's meta line say where — and `<now>` that a
  server channel is public). What anyone else writes is heard only by `discord`
  triggers and the `discord` tool, as information. Its DM mirrors the conversation:
  what the user writes in Willow (or on Telegram) is quoted there, marked as theirs
  (`quoteForDiscord`), and every message of the bot's goes there too — unless the
  user's latest message was written in a server channel, when it goes to that
  channel, the first answering it (`discordReplyTarget`). Posts go one after another
  per bot (`enqueueDiscord`), so they keep their order, and tables become code blocks
  (`discordMarkdown`). "Typing…" shows where the answer will land; its reactions land
  on the user's Discord messages or their quotes (`quoted`), and the user's reactions
  on its mirrored messages arrive as theirs (`sent` maps Discord messages to items).
  The `discord` tool lists servers and channels, reads a channel, and posts or
  reacts: at once in the DM or where the user is writing from this turn, in a channel
  they allowed for good (`runtime.discordChannels`, a standing card as the record),
  and otherwise on an `outgoing` card (`discordPost`) the user posts, allows for good,
  or declines — the email flow, under the same lock. It is left out of research
  moments. Posts ping no one but people named (`allowed_mentions: users`); long ones
  split at paragraphs, code blocks closed and reopened. The companion holds each
  token's gateway (`discord.next`, see its AGENTS.md); one window reads it, holding
  `willow-dot-discord:<id>`, its cursor (`epoch`, `after`) kept so another window
  carries on. Message Content (reading whole channels) is asked for only when the
  application has it on — Discord refuses the connection otherwise — and the page
  points to the switch. A refused token shows on the page with a field for a new one.

## The user's screen

With the user's computer connected in the desktop app — a folder or the whole of it —
a bot can also work through their screen (`tools/user-screen-tools.ts`, through the
companion's `screen.*` — its AGENTS.md), each system the way it is done best there.
`runtime/screen-bridge.ts` says which (`platform()`, from the companion's
`screen:<system>` capability), and the tools, their descriptions and the prompt's
paragraph follow it:

| System | Tools | How |
| --- | --- | --- |
| Windows | `user_screenshot` (a monitor), `user_zoom`, `user_desktop_click / move / type / key / scroll / drag`, `user_apps`, `user_elements`, `user_element`, `user_focus_window` | The one desktop the user sees, shared with them; a window's controls through UI Automation, worked by number without the mouse |
| macOS | `user_apps`, `user_screenshot` (a window by id), `user_zoom`, `user_elements`, `user_element`, `user_desktop_type / key`, `user_focus_window` | In the background, app by app: no pointing by position — controls are worked through Accessibility, typing goes to the app last looked at |
| Linux | `user_open_app`, `user_screenshot`, `user_zoom`, `user_desktop_*`, `user_apps`, `user_focus_window` | A desktop of the bot's own, off the user's display, where the apps it opens run; no accessibility reading |

Pointing is the same computer-use loop as on the bot's own computer, in the same
positions its model points in (`runtime/screen-view.ts`): each action comes back with
the screen it left, marked where it landed, and a position becomes the desktop's
pixel with the monitor's own place added. `user_elements` gives each control's place
in those positions too, when the latest screenshot shows it; `user_element` acts on
one by its number in the latest list and comes back with what the screen looks like
now.

- **The overlay** (Windows; `runtime/screen-overlay.ts`). The first use of the screen
  under a grant shows three things, drawn by the companion's
  `screen/screen-overlay.cs`:
  - a pill with the bot's initial in its colour, a ring turning while it acts, what
    it is doing, and Stop with Esc;
  - a glow around the screen's edge;
  - the bot's own cursor, travelling to each action.

  It comes down when the grant ends (`onScreenGrantEnded`) or the turn does; the
  next use brings it back. It comes in motion: the glow blooms in and breathes, the
  pill drops into place, and the cursor grows out of the user's pointer. Going, the
  pill lifts away and the rest sinks out. Every action carries its grant, and the user's Stop or Esc on their screen
  arrives as `screen.stopped`, a Stop like the card's: the grant ends, the bot hears
  how ("they pressed Esc"), and an action already on its way is refused (`stopped`).
  On Linux, `end` takes the bot's desktop and its apps down with the grant.

- **Asked once for a stretch of work** (`runtime/screen-control.ts`). Seeing and
  using go together, as with remote access: the first use records a `screen` card —
  "{bot} wants to use your screen", with the bot's reason, what it would see and do,
  and how long the go-ahead lasts — and does nothing until Allow. Once answered, the
  card becomes a line of the conversation ("Marks" above), live with Stop only while
  a turn is using the screen. A grant lapses after 15 minutes
  unused (an `ended` event, quiet), and ends when the user disconnects or connects
  something else in its place. With the bot acting without asking (Permissions), the card is posted
  already allowed (`standing: 'mode'`) and Stop still ends it. After Don't allow, the
  bot asks again only once the user has written since. Allow, Don't allow and Stop
  each wake the bot; the request counts among what it waits on the user for.
- **A shared space.** The helper refuses an action while the user is using the
  computer (their input within 1.5 s; the companion waits out one, so the click that
  allowed it does not count), on a locked screen, on any of Willow's own windows, and
  typing while Willow is in front. An action turned away because the user is at the
  mouse or keyboard waits where it is and goes ahead once they stop (`patiently`,
  polling every 0.6 s for up to 30 s, "Waiting for you to finish" under the bot's
  name): a refusal the bot could only answer by stopping used to end the task. Past
  the 30 s, and for every other refusal, the bot hears it in words — told to ask
  whether to go on — and screenshots say when the user touched the computer a moment
  ago. The prompt's
  paragraph for the system tells the bot to look before every action, work a control
  by what it is when it can, keep to the work's window, close what it opened, never
  act on Willow or type a password, run commands through `user_run_command` rather
  than a terminal on the screen, and to treat moving the mouse as the user taking it
  back; on macOS to work the app, not the screen; on Linux that its desktop starts
  empty and signed in to nothing.
- **Spark tasks** in the desktop app reach the same companion as MCP tools
  (`features/spark/src/spark-computer-tools.ts`, `mcp__computer__apps | elements |
  act | focus | type | key`, and `open_app` on Linux), added to `sparkMcpTools` so
  Spark's harness is untouched. A Spark run reads text, so it works apps by their
  controls rather than by pictures.
- Left out of research moments, like everything else that acts.

## Your computer and theirs

When the bot has a computer of its own and the user has connected theirs, the
prompt's "Your computer and theirs" (`choosing` in `dot-profile.ts`) says how to
choose: go where the work's things are; the bot's own computer for the open-ended
and the risky; on theirs, the least intrusive way in (files, then edits, then
commands, their screen last); results carried across with `transfer_file`; each
piece of work in one place; a computer the user names settles it. Without the user's
computer connected there is no user's-computer section at all — not even the
choice — and with no computer of its own (a browser) only theirs is described.

`transfer_file` (`tools/transfer-tools.ts`, `runtime/transfer.ts`) copies a file
either way, as it is, up to 50 MB, in pieces (the companion's and the machine's
base64 reads and writes), never over a file that is there. Copying from theirs is
looking; secrets stay out of reach. A copy onto theirs is an `edit` card with the
file's size; while the bot asks before doing anything it is proposed
(`proposed.copy`) and lands on Apply, read from the bot's computer then.

## The bot's own computer

Desktop app only (Windows, WSL 2). Each bot can have a computer of its own: its
own account on a Linux machine on the user's PC that their bots share,
separate from the user's, with a desktop, a browser, a shell and a folder
(`~/workspace`). It is OpenBot's "Bot's computer" (CopilotKit/openbot) brought
to bots — the functionality, not the UI — with a whole desktop where OpenBot
has a browser without a screen, as OpenAI's bots have. Bots use it at the same
time, each on its own screen, closed to the others; what they share is the
installed software, which none can remove. The prompt says so, and that a
bot's own servers go on the ports in `$WILLOW_PORTS`.
The machine itself is `services/local-companion/src/computers/` (its AGENTS
section explains the isolation); this folder is how a bot uses it. Its look
follows the bot's colour: `dot-runtime.ts` registers the look
(`setDotMachineLook` — the wallpaper's and the browser's colours from
`computer/dot-wallpaper.ts`), the bridge sends it with every start and call,
and a change of colour sends it at once (`machine.look`).

- **The tools are OpenBot's** (`tools/machine-tools.ts`), with its names and
  contract: `computer_navigate` (returns the page's title and readable text),
  `computer_read` (with an `offset` to read on), `computer_snapshot` (what can
  be acted on, each with a ref, and a `snapshotId`), `computer_click`,
  `computer_type` (a dropdown takes the option, an upload field a workspace
  path), `computer_key`, `computer_scroll`, `computer_request_help`,
  `computer_request_secret`, `computer_list_files`, `computer_read_file`,
  `computer_write_file` and `computer_run_command` (bash, as a user without
  root; `apk add` installs packages). Refs retire with their page; an action
  with an old snapshotId is refused and says to look again. Nothing on its
  own computer waits for approval — that is what makes it the bot's.
- **The desktop is used by sight.** Beyond OpenBot: `computer_screenshot`
  returns the whole 1280×1024 screen as a picture, and
  `computer_desktop_click | move | type | key | scroll | drag` act at positions on
  it, each returning the screen it left, marked with a ring where it acted;
  `computer_zoom` magnifies a region with rulers. A tool result's `images` go to the model
  with the next request only, on its last message (`withImages` in
  `dot-loop.ts`), and only the latest one: the thread keeps the text, never
  the picture. The prompt steers web pages to the browser tools, which read a
  page exactly.
- **Positions in the model's own space** (`runtime/screen-view.ts`). Models point
  differently, and APIs shrink large pictures before a model sees them: a
  1280×1024 screenshot reached Claude as about 1198×959 and GPT as 960×768, so
  pixel positions read off what they saw landed short, worst towards the bottom
  right; Gemini points on a 1000 × 1000 grid. Each turn's `vision` profile, from the
  model's provider and name, decides the picture's size — the largest its API keeps
  as it is — and the space positions are in (Gemini and GLM: the grid; Claude, GPT
  and the rest: the picture's pixels). Each screenshot's result says which, and the
  window turns every position back into the screen's pixels; one off the picture is
  refused before anything moves. Pictures are scaled, marked and magnified with the
  window's canvas; without one they go as they came, in their own pixels. The screen itself starts the first time something needs it —
  the browser, a screenshot or desktop action, a program with a window, a
  pane watching — in about four seconds, and stays on until the computer
  turns off; commands and files never wait for it.
- **Set up on first use.** The tools are offered wherever the desktop app can
  run a machine (`machineFor` in `dot-runtime.ts`). Until the user has set it
  up, the first tool the bot reaches for records a `machine` item — a card with
  Set up and Not now — and runs nothing. The user can also set it up from the
  profile. `setUpMachine` creates it and the bot hears `ready` (or `failed`);
  `declined` stops it asking again.
- **The wheel, without waiting.** OpenBot's tool call holds open until the
  person hands back; a bot's turn never waits on a person. So
  `computer_request_help` records a `help` card (and the computer refuses the
  bot's actions from then on), the turn carries on or ends, and the bot hears
  — as an event that wakes it — when the user hands the computer back, or
  dismisses the request, or it lapses (10 minutes untaken), or the computer
  stops. A page that is a challenge (Cloudflare's header, a visible "verify
  you're human") raises the same request by itself, on navigate, read or
  snapshot. The user may also take over unasked from the pane; handing back
  wakes the bot only if something it tried meanwhile was refused
  (`runtime.machine.blockedAt`). After any handover the bot must look again —
  a snapshot or a screenshot — before it changes anything.
- **Secrets never reach the thread.** `computer_request_secret` pins the field
  on the computer; the card's masked box sends what the user types straight
  to that field (`/human/secret`), and the bot hears only that it was entered.
- **One window follows the wheel.** How a request ends is decided on the
  computer, so the holder of the `willow-dot-machines` lock records each ending
  once (`watchDotMachines`), from the companion's `machine.control` events and a
  sweep every 30 s; a request the computer no longer knows ended in an
  interruption.
- **The pane is Spark's remote browser** (`../computer/DotComputerPane.tsx`):
  the same 5:4 viewer, "Preparing …'s computer" loader, scrim with Take over
  and the step history, and full-screen takeover with "Go back to <bot>" —
  filled with the machine's whole desktop (frames while a pane watches, step
  images it keeps), which the user drives in full when they take over. Only a
  machine that cannot have a desktop shows its page in the Chrome frame. It
  opens beside the conversation as a task's browser
  does, or full-screen when narrow, and on its own when the bot starts acting
  there (not within five minutes of the user closing it); with the profile
  docked, the two trade one card the way a task's browser and Progress do
  (`sidePanelHandoff`), and the bots list stays collapsed after it closes. The
  profile's "<name>'s computer" row shows its state and, where Connect sits on
  the row below, one action: Set up, Turn on, or — on — its screen, which opens
  the pane. Turn off and Reset (which asks first) are in the pane's header,
  beside its close button, while the computer is on.
- **Removed with the bot.** Deleting a bot removes its machine; Reset wipes it
  to a fresh copy of the base; it turns itself off after 30 minutes unused.

## Persistence

IndexedDB database `willow-dots`: items one record each (written once, as they
are appended; a streaming message is written when it closes), and one record per
bot for everything else (debounced). Item seqs come from a localStorage counter
shared by every tab, and every change is broadcast on `willow-dots-threads`.

With a folder connected, each bot is also `Spark/Dots/<bot id>.json` in it — the
bot and its whole thread (`../dots-folder.ts`, through `registerSyncedFolder`), so
bots outlive browser storage and every copy of Willow on the folder has them (the
desktop app and Willow in a browser keep separate storage). A copy never loses what
it has: a bot it lacks is added; a thread disk carries further is brought up to
date, written into IndexedDB and broadcast as another tab's change; a thread that
went another way in this copy is kept (seqs are per copy, so two histories are
never merged item by item) and written back once it changes here; a bot whose file
is deleted goes. A thread this copy's storage lost is taken back from disk, never
written over it. "Further" means messages this copy lacks (or no thread here at all):
the same messages with only the rest differing — how freely the bot acts, what was
allowed for good, its triggers, its notebook — are a change on one side, which the
pass's own records tell apart, so a choice made in the profile here is written and
one made in another copy is taken. Taking disk's whenever anything differed put a
Permissions choice back to the file's within seconds (`dots-disk.test.mjs`).

The files the user sent a bot are beside its file as `Spark/Dots/<bot id>/Attachments/`,
and what its turns made as `Spark/Dots/<bot id>/Files/`, both read back into a copy
that lacks them (`../dot-attachment-files.ts`, `../../spark-workspace-files.ts`; see
Spark's [AGENTS.md](../../../AGENTS.md#created-files)). The dots folder reads only the
`.json` files beside those folders.

## Invariants worth not breaking

- Items are never rewritten except to finish a streaming message, and never
  deleted except with the whole bot.
- Every summary cites item ids; `recall` can always reach the original.
- Only inputs (`user`, `event`, `result`) carry ids in the transcript. Stamping
  the bot's own output with ids teaches it to write ids into messages.
- Provider reasoning (`onThought`) is private and never recorded.
- The prompt contains no example messages.
- Spark's harness is imported, never edited.
- Nothing runs on the user's computer without an approval event for exactly
  that command, a prefix the user allowed for good there, or the user letting the
  bot act without asking — and then it still has its card; reading and editing
  never reach files that look like they hold secrets, and an edit never deletes.
  While the bot asks before doing anything, no file changes until the user applies
  the proposal.
- No email leaves without the user's Send on its card, a standing permission
  for every recipient, or the user letting the bot act without asking; what is
  sent is exactly what the card shows.
- On Discord, only the application's owner directs the bot; nobody else's message
  becomes the user's. Nothing is posted where others read without the user's Post
  on its card, a channel they allowed, their writing to the bot there this turn, or
  their letting it act without asking.
- On its own computer the bot never acts while a person holds the wheel, and a
  secret the user types for it never enters the thread.
- The user's screen is seen and used only after the user allows it (or lets the bot
  act without asking), never on Willow's own windows, never while they are using the
  computer or it is locked.
- A picture of the screen reaches the model once, with the request after the
  call that took it, and is never stored in the thread.
- A trigger fires only for what happened after it was made (or resumed), and a
  background look never asks the user to sign in.
- A research moment has no tool that sends, changes or controls anything.

## Verifying

`apps/studio/test/dots-harness.test.mjs` drives the parser, the loop (with a
scripted transport), context assembly, compaction, recall, the tools, computer
access against a fake companion, and the prompt's rules. The loop tests also
cover look-ups running at once, the repeated-call guard, the check-your-change
notice, the `<now>` reminders and the helper brief. The prompt tests pin
"Doing the work well" and the other principles taken from other harnesses,
with no samples, no emoji and no other harness named.
`apps/studio/test/dots-machine.test.mjs` drives the bot's own computer against
a fake machine: the tools (the desktop's included), setup, challenges, the
wheel and what the bot hears, secrets, and the prompt section.
`apps/studio/test/dots-triggers.test.mjs` drives triggers (conditions, schedules
across zones and summer time, the store, every watcher against fake sources,
firing, the tool and its card) and the pacing, quiet-hours and research rules.
`apps/studio/test/dots-email.test.mjs` drives Gmail under both accesses (no search
under metadata, the scope swap), header filtering, message text and composed mail,
and the send flow: approval, once-only sending, declining, standing permissions.
`apps/studio/test/dots-compaction.test.mjs` drives when compaction runs.
`apps/studio/test/dots-computer-whole.test.mjs` drives the whole computer: paths
anywhere and on other drives, what stays off limits, edits, commands, folder
triggers and the prompt.
`apps/studio/test/dots-screen.test.mjs` drives the user's screen against a fake one —
asking for it in each mode, positions across monitors, refusals, lapse and Stop —
copies between the two computers, and the prompt's sections for their screen and for
choosing a computer. `dots-machine.test.mjs` also pins each model's way of pointing
on the bot's own screen, the ring, and the closer look.
`apps/studio/test/dots-conversation.test.mjs` drives the conversation craft and
Permissions: turn awareness in `<now>`, the prompt's rules in every mode (no
samples), acting at once (commands, jobs, email, Discord) with quiet records, a
change of mode mid-turn, and proposed edits (apply, decline, a stale patch,
withdrawal, a window closed mid-apply).
`apps/studio/test/dots-discord.test.mjs` drives Discord: the token check, who is
heard as the user, splitting, posting, the tool's consent, triggers, the transcript
and the prompt; `services/local-companion/test/discord.test.mjs` the companion's
routes and its gateway against a stand-in.
`services/local-companion/test/workspace-write.test.mjs` runs the real companion's
`fs.write` against a temporary folder. Run them with `npm test`, and
`npm run typecheck`. `npm run companion:test` exercises the real companion,
jobs and file reads included; `npm run companion:computers` a real machine
(Windows with WSL 2; the first run builds the base, a few minutes).

## Not built yet

- Running a dot in one copy of Willow at a time. Two copies open on one folder
  each run every bot they have, so a bot used in both keeps two threads.
- Slack, Teams, email and calls as channels (the profile shows them as coming soon;
  Discord is built).
- On Discord: slash commands, files the user sends (named, not fetched), and
  automating the user's own account, which Discord's terms forbid.
- Triggers fire only while Willow is open; OpenAI's run in their cloud. Webhook
  events (Slack mentions, GitHub webhooks) would need a server Willow does not run.
- Helpers do not survive the tab that runs them (reported as interrupted).
- The bot's own computer on macOS and Linux (it is WSL 2 only), and in a browser
  (WebContainers would cover JavaScript work there).
- Sending anything but email (Slack, texts) in the user's name; Telegram reaches
  the user, not other people, and Discord posts as the bot's own account.
