<div align="center">

<img src="assets/brand/willow-logo.png" width="104" alt="Willow" />

# Willow

### An Open-Source, All-in-One AI Studio & Canvas Workspace

A multi-surface client combining conversational LLM chat, an interactive
component-generation canvas (inspired by full-stack prompt builders), and visual
workflow pipelines into a single interface — on your machine, with your own API
keys.

<br />

<img src="https://img.shields.io/badge/status-alpha-FF8C00?style=flat-square" alt="Alpha" />
<img src="https://img.shields.io/badge/license-MIT-4C9A2A?style=flat-square" alt="MIT licence" />
<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React 19" />
<img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.8" />
<img src="https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 6" />
<img src="https://img.shields.io/badge/local--first-4C9A2A?style=flat-square" alt="Local first" />
<img src="https://img.shields.io/badge/bring_your_own_key-2E7D32?style=flat-square" alt="Bring your own key" />

</div>

<br />

> [!IMPORTANT]
> **Willow is an alpha release.** It is usable and it is real, but it is not
> finished. Read [Known issues](#known-issues) before you rely on it — in
> particular, **Gemini is the provider that works best today**, and several
> surfaces are deliberately switched off until you enable them in
> **Settings → Labs**.

<br />

## Why Willow

Why switch across four different tabs for chatting, code generation, and visual
workflows? Willow is a unified, open-source AI super-app that brings all of it
into one persistent workspace.

Most AI tools are single-purpose. You write in one, code in another, generate
images in a third, and glue the results together by hand — losing your context at
every hop. Willow is the opposite bet: one shell, one thread of context, one set
of files, and every surface sharing them.

It is **local-first**. Your chats, projects, notebooks and generated media live
in a folder *you* pick on your own disk, through the browser's File System
Access API. Willow never uploads your work, and there is no analytics or
telemetry of any kind.

Signing in is **optional** and is backed by Firebase. If you stay signed out,
everything — including your API keys — stays on your machine. If you do sign in,
please read [the note on API keys](#api-keys-and-what-leaves-your-machine)
first: today they sync to that Firebase project in plaintext, and that is being
changed.

<br />

## Demo

<!--
  TODO: 10-15s screen capture showing the switch between the main chat surface
  and the sidebar tools — the interactive builder and the flow canvas — without
  a page reload or a lost thread.
-->

*A short walkthrough video is coming — it'll land here.*

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

For the alpha, **start with a Google Gemini key** — it is the provider the app is
most thoroughly wired against. See [Known issues](#known-issues).

<br />

## What's inside

|  | Surface | What it's for |
| :-- | :-- | :-- |
| 💬 | **Chat** | A fast, streaming conversation with any model you've configured |
| ⌨️ | **Code** | Describe an app, watch it get written, run it live, edit it by clicking |
| 🎨 | **Media** | Images, music, video, and consistent characters across a set |
| ⚡ | **Spark** | Agents that run on a schedule and can drive a real browser |

Two more surfaces exist but are **unfinished, and hidden by default**. Turn them
on in **Settings → Labs** if you want to look around:

|  | Surface | State |
| :-- | :-- | :-- |
| 🎛️ | **Agents** | A node-based canvas for visual workflow pipelines. Explorable, not finished |
| 🖌️ | **Design** | A canvas for generating UI from text or sketches. Explorable, not finished |

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

| Provider | Models | Alpha status |
| :-- | :-- | :-- |
| **Google** | Gemini | ✅ Best supported — the one to start with |
| **Anthropic** | Claude | 🧪 Under testing |
| **OpenAI** | GPT | 🧪 Under testing |
| **xAI** | Grok | 🧪 Under testing |
| **Moonshot** | Kimi | 🧪 Under testing |
| **Zhipu** | GLM | 🧪 Under testing |

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

## Known issues

**Willow is an alpha release.** It is under active development and moving
quickly, and plenty of it is not baked yet. What follows is the honest state of
things rather than a roadmap — none of it is a surprise, and all of it is
fixable.

**Gemini is the provider that works best.** Willow is wired against six
providers and every one of them has a full tool-calling loop, but Google's is the
path that gets the most use and the most testing. **Anthropic, OpenAI, xAI,
Moonshot and Zhipu are all under testing and may not behave as intended** —
expect rough edges around tool calls, streamed reasoning, grounded search and
attachments in particular. If something misbehaves on another provider, try the
same prompt on Gemini before assuming the feature itself is broken.

### API keys, and what leaves your machine

**If you sign in, your API keys are currently synced to Willow's Firebase
project in plaintext.** This is the most serious known issue in the alpha and it
is being fixed — key storage is moving to local-only for everyone. Until that
ships, be aware of exactly what happens:

| You are | Where your keys are stored | Do they leave your machine? |
| :-- | :-- | :-- |
| **Signed out** | Your browser's `localStorage` | **No — never** |
| **Signed in** | Your browser, **and** the `users/{uid}` document in Firestore, as readable strings | **Yes** |

Signed in, the project owner can read those keys in the Firebase console. Willow
does not use them for anything other than your own requests, but you should not
have to take that on trust — so, until the fix lands, pick whichever of these
suits you:

- **Use Willow signed out.** Bring-your-own-key works fully without an account;
  nothing about the model surfaces requires signing in.
- **Or use a disposable, spend-capped key** that you can revoke at any time.

Your chats, projects and generated media are *not* affected either way — those
are plain files in the folder you chose, and they are never uploaded.

**Not every feature is finished.**

- **Agents and Design are incomplete and hidden by default.** Both ship switched
  off behind **Settings → Labs**. Turn them on if you want to look at the UI, but
  treat them as previews rather than tools — they are there to be seen, not
  relied on.
- Surfaces are at uneven depth. Chat, Code, Media and Spark are the four worth
  your time today; the rest are earlier.
- Some settings panels are static mock-ups rather than wired controls. Labs marks
  which of its toggles actually do something.
- Errors are not uniformly surfaced yet. A failed provider call can be quieter
  than it should be — the browser console is still sometimes the fastest way to
  see what went wrong.

**Nothing here is a data risk.** Willow writes plain files into a folder you
picked, so the worst case of any of the above is a surface that misbehaves, not
work you cannot recover.

Contributions, issues and ideas are very welcome — especially non-Gemini provider
reports, which are exactly what the alpha needs.

<br />

---

## Credits

Design language and interaction patterns inspired by Gemini, Lovable, and
next-gen canvas tools.

<br />

## Licence

[MIT](LICENSE) © 2026 Yashjit Pal.

<br />

<div align="center">

**Built by [Yashjit Pal](https://github.com/YashjitPal)**

<sub>Bring your own keys. Keep your own files.</sub>

</div>
