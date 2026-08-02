# services/agent-builder

The workflow-engine backend for the Agents app. A **self-contained npm package** —
its own `package.json`, its own `node_modules`, its own `tsconfig.json`. It ships
independently of the browser side.

Full documentation lives in **`README.md`** (quick start, API surface, the workflow
model, providers, security posture). This file covers only what an agent editing
the code needs to know.

## ⚠️ Relative imports must keep their `.ts` extension

```ts
import { config } from '../config.ts';        // ✅ correct
import { config } from '../config';           // ❌ breaks at runtime
```

This package runs on Node's **native TypeScript type-stripping loader** with
`module: NodeNext` and `rewriteRelativeImportExtensions`. Node resolves the
specifier literally at runtime — there is no bundler to guess the extension.

The browser side (`apps/`, `features/`, `platform/`) has the **opposite**
convention: extensions omitted. So:

> **Never run a repo-wide import codemod over `services/`.** Scope it to `apps/`,
> `features/`, and `platform/`. On 2026-08-01 a browser-side codemod stripped
> extensions from 117 files / 427 import lines here and produced 1376 type errors.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Standalone entry. `npm start` → :8787. Accepts `--static-dir` to serve a built app. |
| `src/vite-middleware.ts` | Mount point for the in-process dev server (see below). |
| `src/config.ts` | Env parsing and defaults. |
| `src/domain/` | Core types. `RunEvent`, workflow/graph shapes. |
| `src/engine/` | The run engine: execution, checkpoints, and the hand-rolled CEL evaluator in `engine/cel/`. |
| `src/api/` · `src/http/` | Route handlers and the HTTP layer. |
| `src/storage/` | SQLite persistence (`node:sqlite`). |
| `src/services/` | Chat sessions, workflows, runs, evaluation. |
| `src/providers/` | Gemini / OpenAI / Anthropic REST clients, plus `mock/*` for keyless tests. |
| `src/mcp/` | MCP client manager (official `@modelcontextprotocol/sdk`). |
| `src/rag/` | Vector stores and embeddings. |
| `src/codegen/` | TS / Python Agents-SDK export. |
| `client/index.ts` | The zero-dep typed client the browser imports as `@agentbuilder`. |

## How it reaches the browser

In dev it is **mounted in-process**: `apps/studio/vite.config.ts` runtime-imports
`src/vite-middleware.ts`, so `npm run dev` serves the app and `/api/v1/*` from the
same origin on :3000 — no CORS, no second port. In production the backend either
runs standalone or serves the built app itself via `--static-dir`.

The frontend client defaults to same-origin; `VITE_AGENT_BUILDER_URL` overrides it.

## SQLite teardown is idempotent — keep it that way

`storage/sqlite.ts` guards `close()` behind a `closed` flag. Node's
`DatabaseSync.close()` throws `ERR_INVALID_STATE` on an already-closed handle, and
a Vite dev restart fires **two** teardown paths at the same handle (the `httpServer`
`close` event and `closeBundle`). The Vite plugin memoizes its side too. Removing
either guard reintroduces a crash that only appears when you edit `vite.config.ts`
with the dev server running.

## Commands

Run from the repo root:

```bash
npm run agent-builder:test        # 542 tests
npm run agent-builder:typecheck   # separate tsconfig, Node target
npm run agent-builder:start       # standalone on :8787
```

`npm run typecheck` at the root does **not** cover this package — it targets the
DOM. Run both.
