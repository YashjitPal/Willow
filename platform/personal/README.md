# @willow/personal

Long-term personal intelligence: the thing that lets Willow answer "what should I
watch tonight" with something better than a generic list.

It is **three separate mechanisms**, and keeping them separate is the whole
design. Gemini ships all three behind one settings page, which is why they look
like one feature and are not.

| # | Mechanism | Where it lives | Written by |
|---|-----------|----------------|-----------|
| 1 | **Saved Info** — instructions the user typed on purpose | `@willow/core/saved-info-store` (not here) | the user |
| 2 | **The profile summary** — a bounded set of bullets inferred from the user's own data | `./profile` + `./builder` | a batch job, offline |
| 3 | **Retrieval** — a live search over that data when the summary is too thin | `./retrieval` | nobody; it reads |

Number 1 is already shipped and is deliberately not in this package: those are
directives, not guesses, and gating them behind a relevance filter designed for
guesses would be wrong.

## The two rules that shape everything here

**Nothing is written during a chat turn.** Gemini's production prompt declares 30
tools; exactly one of them touches personal data (`personal_context.retrieve_personal_data`)
and it only *reads*. There is no save tool, no per-turn extraction, no background
classifier deciding whether your message was memorable. The profile is built by a
batch job that runs when the app is idle, over chats that are already on disk.

That is not a shortcut. It is the only design that can produce a bullet
synthesised from *several* conversations, and it is why the user never gets
"I've saved that to memory" in the middle of an answer — the model answering the
turn has no such tool and cannot know a build ever happened.

**The profile is rebuilt, not appended to.** Each build hands the model the
existing profile plus the chats it has not seen yet, and takes back a replacement.
That is what bounds growth: the size of the profile is set by its *format* — four
fixed headings, a hard cap per heading — not by how long the user has been using
Willow. An append-only store grows forever and, worse, accumulates the user's own
contradictions: "I'm learning Java" and "actually I've written Java for years"
both end up in it, permanently, with no way to tell which is current.

## Layout

```
profile/      what a profile IS: types, the four sections, the sensitive-data
              screen, the store, and how it renders into a prompt
builder/      how a profile is MADE: transcripts, the extraction call, the merge
              (dedupe / cap / expire / suppress), the trigger
retrieval/    how the raw data is SEARCHED when the summary is not enough
connectors/   where non-chat data comes from: Google APIs, their scopes, and a
              token source that is swappable for a server-side flow later
tools/        the model-facing surface: function declarations + the executor
```

Nothing above `profile/` may import from `builder/`; the store must stay loadable
without dragging a model client into the boot path.

## What is NOT here, and why

- **A vector database.** At one person's scale the corpus is a few hundred chats.
  Substring and token-overlap ranking over that is fast and needs no index to
  build, no embedding key, and no second install step.
- **mem0.** Its current algorithm is single-pass ADD-only — one LLM call, no
  UPDATE or DELETE, memories accumulate and nothing is overwritten. That is the
  exact failure mode described above. It is also a Python package that wants a
  long-running process and its own database, which a local browser app does not
  have and which would put the user's most personal data somewhere other than the
  folder they chose for it.
- **Google Search history and YouTube watch history.** No API exposes either.
  Cards that promise them are corrected in `connectedAppsData.ts` rather than
  left to fail at runtime.
