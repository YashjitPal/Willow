<div align="center">

<img src="assets/brand/willow-logo.png" width="104" alt="Willow" />

# Willow

### One workspace for everything you make with AI.

Talk to a model, build a working app from a sentence, generate images, music and
video, and hand your recurring work to an agent that runs on a schedule — all in
one place, on your machine, with your own API keys.

<br />

<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React 19" />
<img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.8" />
<img src="https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 6" />
<img src="https://img.shields.io/badge/local--first-4C9A2A?style=flat-square" alt="Local first" />
<img src="https://img.shields.io/badge/bring_your_own_key-2E7D32?style=flat-square" alt="Bring your own key" />

</div>

<br />

## Why Willow

Most AI tools are single-purpose. You write in one, code in another, generate
images in a third, and glue the results together by hand. Willow is the opposite
bet: one shell, one thread of context, one set of files — and four surfaces
sharing them.

It is **local-first**. Your chats, projects, notebooks and generated media live
in a folder *you* pick on your own disk, through the browser's File System
Access API. There is no Willow account, no Willow server, and no telemetry. The
only network calls are the ones you make to the model provider whose key you
entered.

<br />

## Quick start

Willow needs Node 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:3000**, then open **Settings → Models** and paste in a
key for whichever provider you want to use. Pick a folder when prompted and
you're running.

<br />

## What's inside

|  | Surface | What it's for |
| :-- | :-- | :-- |
| 💬 | **Chat** | A fast, streaming conversation with any model you've configured |
| ⌨️ | **Code** | Describe an app, watch it get written, run it live, edit it by clicking |
| 🎨 | **Media** | Images, music, video, and consistent characters across a set |
| ⚡ | **Spark** | Agents that run on a schedule and can drive a real browser |

<br />

---

## 💬 Chat

The centre of gravity. You type, the response streams in token by token, and
everything around that is built to stay out of the way.

- **Any model, mid-conversation.** The model picker sits in the composer, and
  switching providers doesn't reset your thread or your history.
- **Reasoning you can actually read.** Thinking steps stream into a sidebar
  beside the answer instead of burying it.
- **Attach anything.** Drag files in, paste images straight from the clipboard,
  or pull a file in from a GitHub repository.
- **Talk instead of typing.** Dictation transcribes as you speak, with a live
  waveform, and hands the caret back exactly where you left it.
- **Canvas.** Long documents and code open into an editable side panel that the
  model keeps working on with you, rather than re-printing the whole thing.
- **Notebooks and Gems.** Group related threads with their own sources, or save
  a reusable persona and jump straight into it.
- **Turns outlive the view.** A response is driven by a runner that lives
  outside React, so navigating away mid-answer doesn't kill it.

<br />

---

## ⌨️ Code

The largest surface in the project, and the one that does the most work for you.
Describe what you want, and Willow writes the files, wires up their dependencies,
and boots the result in a sandbox — without ever leaving the tab.

**Describe it, then watch it build.** Files stream in as the model writes them,
so you can read the plan taking shape instead of waiting on a spinner.

**It actually runs.** The preview is bundled in the browser by `esbuild-wasm`
against an in-tab sandbox. Saving a file hot-updates the running app instead of
reloading the frame, so state survives your edits.

**Click the thing you want to change.** Visual editing puts an overlay on the
preview: hover an element to see what it is, click it to select it, and describe
your change in plain language. It resolves the element back to the exact source
range, and can find every sibling that looks like the one you picked so a single
instruction fixes all of them.

**Two ways to generate.** Off by default, the composer's Tools menu can hand the
turn to a harness that works from a file manifest and applies surgical patches
instead of rewriting whole files — the right mode once a project is big enough
that whole-file rewrites get expensive.

**A real workbench.** File tree, editor, terminal, and preview side by side,
with the chat that produced it all still in the same window.

<br />

---

## 🎨 Media

Everything visual and audible, in one place, with the editing tools you'd
otherwise go looking for somewhere else.

- **Images**, generated from a prompt into a gallery that reveals each result as
  it lands.
- **A real image editor** on top of them: crop with ratio presets, box and lasso
  select, and a pen with brush sizes and colour swatches. Mark up an image by
  hand and those marks become part of the instruction for the next pass.
- **Music**, with a player that stays docked while a track renders, and tags
  written into the file so it survives leaving the app.
- **Video**, from the same prompt box.
- **Characters.** Define someone once and keep them consistent across an entire
  set of images — the difference between a pile of pictures and a storyboard.
- **An agent sidebar** that can plan and run a batch of generations for you
  rather than making you prompt each one.

Media runs as its own agent with its own tools, which is why a chat turn never
promises you a video it can't deliver.

<br />

---

## ⚡ Spark

The part that works while you don't. Spark turns a sentence into a standing job:

> *every weekday at 9am, check my inbox and summarise anything that needs a reply*

- **Schedule it.** A cron-style picker for anything from "every hour" to "the
  first Monday of the month", plus a **Run now** button for when you don't want
  to wait.
- **Give it a browser.** In computer-use mode the agent works in a real browser
  context, so a task isn't limited to what an API exposes.
- **Teach it skills.** Save your own prompt templates as reusable skills and
  compose tasks out of them.
- **Attach context.** Files stay with the task, persisted before the task even
  exists, so a scheduled run has everything it needs at 9am.
- **Watch the runs.** Every execution keeps its own timeline, so you can see
  what the agent did and why.

<br />

---

## Bring your own model

Willow has no opinion about who serves your tokens. Six providers are wired in,
each with its own key, and each with a full tool-calling loop — not just plain
text completion.

| Provider | Models |
| :-- | :-- |
| **Google** | Gemini |
| **Anthropic** | Claude |
| **OpenAI** | GPT |
| **xAI** | Grok |
| **Moonshot** | Kimi |
| **Zhipu** | GLM |

Keys are entered in Settings and stored locally. Reasoning effort, grounded
search, code execution and transcription are negotiated per provider, so the
same conversation behaves sensibly wherever you point it.

<br />

---

## Your files stay yours

Willow writes to a folder you choose, in formats you can open without it:

- **Local disk** through the File System Access API — your chats, projects,
  notebooks and generated media as plain files you can back up, diff, or delete.
- **Google Drive**, behind the exact same interface, if you'd rather sync.

Both are adapters over one storage contract, so nothing in the app knows or
cares which one you picked — and adding a third is a single file.

<br />

---

## Under the hood

A single workspace, four layers, and a rule that keeps them honest.

```
apps/       →  the shell that composes everything (Willow Studio)
features/   →  one folder per surface: chat, code, media, spark, projects, …
platform/   →  shared libraries: ai, storage, auth, ui, core
services/   →  standalone Node backends that ship on their own
```

Imports only ever point downward — `apps/` may reach into `features/`, and
`features/` into `platform/`, never the reverse. Chat, Code and Media are three
independent agents with no edges between their packages, which is what keeps one
surface's tools from leaking into another's prompt.

React 19 and TypeScript throughout, Vite for the dev server and build, and
nanostores for cross-surface state.

<br />

## Scripts

| Command | What it does |
| :-- | :-- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm run typecheck` | Type-check the whole workspace |
| `npm run test` | The browser-side test suite |
| `npm run agent-builder:test` | The workflow-engine backend's suite |
| `npm run lint` | ESLint |

<br />

---

## Status

Willow is under active development and moving quickly. Chat, Code, Media and
Spark are the four surfaces worth your time today. A few others are in the tree
and deliberately undocumented for now — they'll get their own write-up when
they're ready to be used rather than watched.

Contributions, issues and ideas are welcome.

<br />

<div align="center">

**Built by [Yashjit Pal](https://github.com/YashjitPal)**

<sub>Bring your own keys. Keep your own files.</sub>

</div>
