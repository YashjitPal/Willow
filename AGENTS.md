# Willow

Willow is a local-first **super-app**. It bundles several distinct apps behind one
shell: **Code**, **Chat**, **Media**, **Agents**, **Spark**, **Design**, and an
unfinished **Figma**-like canvas. Each app lives in its own folder under
`features/` and could plausibly have been built as a standalone product.

New here? Read this file, then the `AGENTS.md` of the folder you are about to
touch. Every package has one.

## Layout

```
apps/studio/        The host shell. Routing, sidebar, settings. The only app.
features/<name>/    One sub-app each. Self-contained; owns its own UI + state.
platform/<name>/    Shared libraries. Used by many features, depends on none.
services/<name>/    Node backends. Separate npm packages, ship independently.
assets/             Images, video, cursors, animations, prompt suggestions.
tools/              Scripts, prototypes, research captures. Not shipped.
backup.cmd          Git checkpoint script: commit + pull --rebase + push.
```

**Where the user's projects get saved** is a swappable choice, and all of it lives
in one folder: `platform/storage/src/adapters/`. `local-disk.ts` (File System
Access API) and `google-drive.ts` implement the same operations, so adding the
local ↔ Drive toggle is a matter of picking an adapter, not rewriting callers. See
`platform/storage/AGENTS.md` before changing anything in there.

## Every package, and where its docs are

| Package | Alias | What it is |
| --- | --- | --- |
| [`apps/studio`](apps/studio/AGENTS.md) | — | The host shell: routing, sidebar, settings, Vite config |
| [`features/code`](features/code/AGENTS.md) | `@willow/code` | The Workbench — Sandpack sandbox, visual editing |
| [`features/chat`](features/chat/AGENTS.md) | `@willow/chat` | Standalone chat surface |
| [`features/media`](features/media/AGENTS.md) | `@willow/media` | AI image and video generation |
| [`features/agent-builder`](features/agent-builder/AGENTS.md) | `@willow/agents` | React-Flow workflow canvas (frontend of the Agents app) |
| [`features/spark`](features/spark/AGENTS.md) | `@willow/spark` | Scheduling / background-task agent |
| [`features/design`](features/design/AGENTS.md) | `@willow/design` | Design surface; writes into the project's `Designs/` folder |
| [`features/projects`](features/projects/AGENTS.md) | `@willow/project-browser` | Project browser **UI** |
| [`features/auth`](features/auth/AGENTS.md) | `@willow/account` | Login / account **UI** |
| [`features/onboarding`](features/onboarding/AGENTS.md) | `@willow/onboarding` | First-run flow |
| [`features/figma`](features/figma/README.md) | `@willow/figma` | Unfinished canvas prototype. Not routed, not typechecked |
| [`platform/storage`](platform/storage/AGENTS.md) | `@willow/storage` | Persistence, adapters, sync. **Read before touching** |
| [`platform/projects`](platform/projects/AGENTS.md) | `@willow/projects` | Project **data model** and registry |
| [`platform/ai`](platform/ai/AGENTS.md) | `@willow/ai` | Model clients, chat orchestration, computer use |
| [`platform/auth`](platform/auth/AGENTS.md) | `@willow/auth` | Firebase, `useAuth()`, `useUserData()` |
| [`platform/ui`](platform/ui/AGENTS.md) | `@willow/ui` | Shared components |
| [`platform/core`](platform/core/AGENTS.md) | `@willow/core` | Utilities, types, constants |
| [`services/agent-builder`](services/agent-builder/AGENTS.md) | `@agentbuilder` | Workflow-engine backend. Own package, own `node_modules` |
| [`services/local-companion`](services/local-companion/AGENTS.md) | — | Optional loopback daemon: real browser + shell for Spark |
| [`assets`](assets/README.md) | `@willow/assets/*` | Static files, bundled into the app |
| [`tools`](tools/README.md) | — | Scripts, prototypes, research. Not shipped |

Two alias pairs are easy to confuse — both are documented in the feature docs:
`@willow/account` (UI) vs `@willow/auth` (Firebase), and `@willow/project-browser`
(UI) vs `@willow/projects` (data).

## The layering rule

Imports may only point **down** this list, never up:

```
apps/  →  features/  →  platform/
```

- `apps/studio` may import any feature or platform package.
- A feature may import `platform/*` and, sparingly, a sibling feature.
- **`platform/*` must never import from `features/` or `apps/`.** This is the one
  rule worth enforcing strictly — it is what keeps platform code testable alone.

When a platform package needs behaviour that only a feature can supply, the
feature **registers** it instead. See `apps/studio/src/app/register-features.ts`
and `platform/storage/src/project-contributors.ts` for the established pattern.

## Import conventions

Browser-side code uses `@willow/*` aliases and **omits file extensions**:

```ts
import { cn } from '@willow/core/utils';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
```

Imports are **deep paths to a module**, not barrel imports — `@willow/ui/button`,
not `@willow/ui`. That keeps Vite's code-splitting granular (the Media chunk does
not drag in the Agents chunk) and makes every import line say exactly where the
symbol lives. Do not add barrel files that re-export a whole package.

**Aliases have one source of truth:** `compilerOptions.paths` in
`tsconfig.base.json`. `apps/studio/scripts/lib/willow-aliases.mjs` reads that file
at build time and feeds both bundlers, so the type-checker and the build cannot
drift apart. Add a path there and it works everywhere; hardcode it in a config and
it will rot.

> **`services/` is the exception.** Backends run on Node's native TS loader and
> *require* explicit extensions — `from '../config.ts'`. Never run a repo-wide
> import codemod over `services/`; it will strip them and break the build.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Studio on :3000, with the Agent Builder API mounted same-origin |
| `npm run build` | Production build |
| `npm run typecheck` | Type-checks all browser-side code in one pass |
| `npm test` | Studio tests |
| `npm run agent-builder:test` | Backend suite (542 tests) |
| `npm run agent-builder:typecheck` | Backend types (separate tsconfig, Node target) |

One `package.json` and one `node_modules` at the repo root cover `apps/`,
`features/`, and `platform/`. Each `services/*` package installs its own.

## Conventions

- **State** is nanostores. A feature's store sits beside its UI as
  `<feature>-store.ts` and is the feature's public state surface.
- **Naming** is `kebab-case.ts` for logic and `PascalCase.tsx` for components.
- **Vocabulary**: the shell is *Willow Studio*; the coding surface is the
  *Workbench*. The words *dashboard* and *staging* are legacy names for those two
  and are being retired — don't introduce new ones. Existing `localStorage` keys
  that contain them stay as they are: they hold real user data.
- `features/figma` is an unfinished prototype, excluded from `typecheck` and
  routed nowhere. See its README before touching it.
