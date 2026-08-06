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
| [`features/agent-builder`](features/agent-builder/AGENTS.md) | `@willow/agent-builder` | React-Flow workflow canvas (frontend of the Agents app) |
| [`features/spark`](features/spark/AGENTS.md) | `@willow/spark` | Scheduling / background-task agent |
| [`features/design`](features/design/AGENTS.md) | `@willow/design` | Design surface; writes into the project's `Designs/` folder |
| [`features/projects`](features/projects/AGENTS.md) | `@willow/project-browser` | Project browser **UI** |
| [`features/auth`](features/auth/AGENTS.md) | `@willow/account` | Login / account **UI** |
| [`features/onboarding`](features/onboarding/AGENTS.md) | `@willow/onboarding` | First-run flow |
| [`features/gems`](features/gems/AGENTS.md) | `@willow/gems` | Gem manager. Reference implementation of the synced-folder seam |
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

## Where new work goes

Start here before creating a file. The rule of thumb: **one sub-app per
`features/` folder, anything shared moves down to `platform/`, anything that runs
on Node lives in `services/`, and anything not shipped lives in `tools/`.**

| You are adding | It goes in | Notes |
| --- | --- | --- |
| A whole new sub-app | `features/<name>/src/` | Needs wiring — see below |
| UI or logic for an existing sub-app | that feature's own `src/` | Group a cluster of modules in a subfolder |
| Something two features both need | `platform/*` | Pick the package from the table below |
| A shared React component | `platform/ui/src/` | `@willow/ui/<module>` |
| A util, type or constant | `platform/core/src/` | The default home for cross-cutting plumbing |
| Model clients / prompt orchestration | `platform/ai/src/` | |
| Persistence, save/load, sync | `platform/storage/src/` | Read its `AGENTS.md` first |
| A Node backend or daemon | `services/<name>/` | Its own `package.json` + `node_modules` |
| A one-off maintenance script | `tools/scripts/` | Typechecked; see caveat below |
| A build or dev script for the shell | `apps/studio/scripts/` | Alongside `build-production.mjs` |
| An image, video, cursor, animation | `assets/<category>/` | Import via `@willow/assets/*` |
| Throwaway or exploratory code | `tools/scratch/`, `tools/prototypes/` | Never imported by shipped code |
| Docs for a package | that package's own `AGENTS.md` | This file is for cross-cutting rules only |

Inside a feature or platform package, everything lives under `src/`, with the
package's `AGENTS.md` as its only sibling. There is no `src/components/`
convention — modules sit flat under `src/` and cluster into a subfolder only when
a group grows large enough to warrant one (`features/chat/src/composer/`,
`platform/storage/src/adapters/`).

### Wiring a new feature

Creating the folder is not enough; a feature is reachable only after four steps.

1. **Declare the alias twice.** Add the path to `compilerOptions.paths` in
   `tsconfig.base.json` *and* to `resolve.alias` in
   `apps/studio/vite.config.ts` — see the caveat under *Import conventions*
   about these two lists.
2. **Route it.** Add a `React.lazy` import and a `case` in
   `apps/studio/src/app/App.tsx`.
3. **Give it a sidebar entry** if it is a top-level destination: extend the
   `ViewType` union in `apps/studio/src/shell/sidebar/Sidebar.tsx`.
4. **Register any platform contributions.** If the feature writes its own
   sub-folder into a saved project (or otherwise needs platform code to call
   into it), export a `register.ts` and import it from
   `apps/studio/src/app/register-features.ts`. Do **not** make `platform/*`
   import the feature — that inverts the arrow described below.

State goes in `<feature>-store.ts` beside the UI, per *Conventions*.

### Scripts

`tools/scripts/` is for one-off repo maintenance — migrations, bulk fixes,
archival. It is inside the root `tsconfig.json` `include`, so **these scripts are
typechecked and a broken one fails `npm run typecheck`** even though they are
never bundled. `tools/prototypes/`, `tools/ui-research/` and `tools/scratch/` are
excluded from typecheck precisely because they are not maintained. See
[`tools/README.md`](tools/README.md).

Scripts that belong to the shell's own build (rather than the repo) go in
`apps/studio/scripts/`. A script meant to be run from Windows Explorer gets a
`.cmd` shim at the repo root, next to `backup.cmd`.

### Tests

| Kind | Location | Run by |
| --- | --- | --- |
| Backend | `services/agent-builder/test/*.test.ts` | `npm run agent-builder:test` |
| Companion smoke | `services/local-companion/test/smoke.mjs` | `npm run companion:test` |
| Studio smoke | `apps/studio/test/` | `npm test` |

All of it is the **built-in `node --test` runner** — there is no vitest or jest in
this repo, so don't reach for `describe`/`expect` from a framework that isn't
installed.

One caveat worth knowing before you add a test: `npm test` runs a single named
file, not a glob. Six co-located `*.test.ts` files exist next to the code they
cover under `features/agent-builder/src/`, `platform/projects/src/` and
`platform/storage/src/adapters/` — **no script currently executes them.** If you
add a browser-side test, either extend the `test` script in
`apps/studio/package.json` to match it or expect it never to run.

## The layering rule

Imports may only point **down** this list, never up:

```
apps/  →  features/  →  platform/
```

- `apps/studio` may import any feature or platform package.
- A feature may import `platform/*` and, sparingly, a sibling feature.
- **`platform/*` must never import from `features/` or `apps/`.** This is the one
  rule worth enforcing strictly — it is what keeps platform code testable alone.
  Verified: no `platform/*` package imports upward today.

When a platform package needs behaviour that only a feature can supply, the
feature **registers** it instead. See `apps/studio/src/app/register-features.ts`
and `platform/storage/src/project-contributors.ts` for the established pattern.

### Where the diagram doesn't hold yet

The strict rule above is clean. The `features/ → apps/` arrow is not: four
features import *upward* from `apps/studio` — verified, not hypothetical:

| Importer | What it pulls from `apps/studio` |
| --- | --- |
| `features/code`, `features/media`, `features/projects`, `features/chat` | `useBackground` / `BackgroundType` from `shell/BackgroundContext` |
| `features/projects` | `ViewType` from `shell/sidebar/Sidebar` |
| `features/media` | `RECENT_PROJECTS` from `shell/sample-projects` |

Seven of the nine import sites are the background context. The clean fix is to move
`BackgroundContext`, `ViewType` and `sample-projects` down into `platform/*`,
which would leave the rule true as written. Until someone does that, don't cite
the diagram as if it already holds — and don't add new upward imports.

`platform/projects` and `platform/storage` also import each other
(`storage → projects/registry`, `projects/rename → storage/indexeddb`). The cycle
resolves at runtime because the imports are used inside functions rather than at
module top level, but it does mean neither package loads without the other.

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

**Aliases are declared in two places, and both need editing.**
`compilerOptions.paths` in `tsconfig.base.json` is the canonical list — the
type-checker and the esbuild production scripts both read it, the latter via
`apps/studio/scripts/lib/willow-aliases.mjs`. But **`resolve.alias` in
`apps/studio/vite.config.ts` is a hand-maintained copy**, so the dev server and
`vite build` do *not* inherit from `tsconfig.base.json`. Add a path to only one of
the two and it will typecheck but fail to resolve at runtime (or the reverse).
The Vite list is ordered longest-prefix-first because Vite takes the first match —
keep `@willow/project-browser` above `@willow/projects`.

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
  *Workbench*. *Dashboard* and *staging* are the legacy names for those two and
  have been retired from identifiers, types and CSS classes — don't reintroduce
  them. They survive in exactly three places, all deliberate: the storage keys
  `localStorage['dashboard-background']` and `sessionStorage['staging-nav']`
  (renaming a key orphans data users already saved), `tools/scripts/migrate-layout.mjs`
  (a record of the paths files actually had), and user-facing copy such as the
  "Back to Dashboard" tooltip. See [`features/code/AGENTS.md`](features/code/AGENTS.md#naming).
- `features/figma` is an unfinished prototype, excluded from `typecheck` and
  routed nowhere. See its README before touching it.
