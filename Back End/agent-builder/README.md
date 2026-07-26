# Willow Agent Builder — Backend

A standalone backend for the Willow **Agent Builder** canvas (the visual agent-workflow
editor inside Staging → Agents → Builder). It replicates the OpenAI Agent Builder
(AgentKit) backend surface: workflow drafts/versions, durable runs with live traces,
CEL-powered logic nodes, guardrails, MCP servers, vector-store file search, ChatKit-style
chat sessions, and Agents-SDK code export.

It is a **self-contained mini-codebase**: its own package.json, zero runtime
dependencies except the official MCP SDK, and no build step (runs on Node's native
TypeScript type-stripping).

```
Front End (Vite, :3000)  ──HTTP/SSE──▶  Agent Builder backend (:8787)  ──▶  Gemini / OpenAI / Anthropic
                                             │        │       │
                                          SQLite    MCP     vector
                                          (or JSON) servers  stores
```

## Quick start

Two ways to run it:

### A) Inside the Dashboard (one command — recommended for dev)

The backend is mounted as **Vite dev middleware**, so the Dashboard's own dev
server hosts the API in-process:

```bash
cd "Front End/Dashboard"
npm run dev          # serves the app AND the API on http://localhost:3000
```

One command, one origin, no second port, no CORS. The API lives at
`http://localhost:3000/api/v1/*`; the frontend client defaults to same-origin.
(Wired via `agentBuilderBackend()` in the Dashboard's `vite.config.ts`, which
imports [`src/vite-middleware.ts`](src/vite-middleware.ts). Only active in
`vite dev` — production deploys the backend separately.)

### B) Standalone (production / running it on its own)

```bash
cd "Back End/agent-builder"
npm install
npm start            # http://127.0.0.1:8787
npm test             # 106 tests
npm run demo         # seeds 3 example workflows and runs one live (no API keys needed)
```

To rebuild the Dashboard and serve it with the API from one process, without
Vite or dotenv, run:

```bash
npm run start:dashboard
```

The command first runs the Dashboard's esbuild-only `build:no-env` script, then
serves `../../Front End/Dashboard/dist` with SPA routing at
`http://127.0.0.1:8787` while preserving `/api/v1/*` and realtime WebSocket routes.
For another build directory, use `npm start -- --static-dir /absolute/path/to/dist`
or set `AGENT_BUILDER_STATIC_DIR` in the process environment.

To point the Dashboard at a standalone backend instead of the middleware, set
`VITE_AGENT_BUILDER_URL=http://127.0.0.1:8787` in the Dashboard's env.

Requires **Node >= 23.6** (uses built-in TypeScript type-stripping and `node:sqlite`).

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_BUILDER_PORT` | `8787` | HTTP port |
| `AGENT_BUILDER_HOST` | `127.0.0.1` | Bind host |
| `AGENT_BUILDER_DATA_DIR` | `./data` | SQLite db / JSON store / uploads |
| `AGENT_BUILDER_STORAGE` | `auto` | `auto` \| `sqlite` \| `json` |
| `AGENT_BUILDER_CORS_ORIGINS` | localhost:3000/3001 | Comma-separated origins |
| `AGENT_BUILDER_API_TOKEN` | *(none)* | Optional bearer token for all `/api` routes |
| `AGENT_BUILDER_MAX_ITERATIONS` | `100` | Default While-loop cap |
| `AGENT_BUILDER_MAX_TURNS` | `8` | Default agent tool-loop cap |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | *(none)* | Fallback LLM keys |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` | *(none)* | Optional web-search providers |

LLM keys resolve in this order: **per-request** (`x-provider-keys` header — this is how
the frontend forwards the user's keys from UserDataContext) → **stored**
(`PUT /api/v1/settings/keys`) → **environment**.

## The workflow model

A workflow is a graph of typed nodes. The backend accepts **raw React Flow JSON**
from the canvas (`{nodes: [{id, type, position, data}], edges}`) and normalizes it —
`data.label`, `data.instructions`, and guardrail `data.config` map automatically, and a
full canonical config can ride along under `data`/`config` as the panels get wired up.

| Node | Semantics |
|---|---|
| `start` | Declares input variables (`input_as_text` always) + global **state variables** `{name, type, initialValue}` |
| `agent` | One agent loop: instructions (`{{...}}` templated), model (Gemini/OpenAI/Anthropic/mock), tools, `text`/`json` output (+ JSON schema → `output_parsed`), chat-history flags, model params, reasoning effort, `continueOnError`, `maxTurns` |
| `ifElse` | Ordered branches, each a **CEL** condition; edges use `sourceHandle: <branchId>` / `'else'` |
| `while` | CEL condition, body entered via handle `'loop'`, exit via `'done'`, body loops back to the node; `maxIterations` + `onMaxIterations: fail\|break` |
| `transform` | Output fields `{name, type, expression}` computed with CEL |
| `setState` | Assignments `{name, expression}` — the only writer of global state (must be declared on Start) |
| `guardrail` | PII / Moderation / Jailbreak / Hallucination checks → `'pass'`/`'fail'` handles; `continueOnError`; PII supports mask mode |
| `userApproval` | **Pauses the run**; resumes via the approvals API → `'approved'`/`'rejected'` handles |
| `fileSearch` | Vector-store retrieval: `vectorStoreIds`, templated `query`, `maxResults`, `scoreThreshold` |
| `mcp` | Deterministic MCP tool call: `serverId`, `tool`, templated `arguments`, `requireApproval` |
| `end` | Terminal; `output` template or `$cel:` expression (defaults to last agent text) |
| `note` | Annotation only |

**Variables** — any text field interpolates `{{ ... }}` (full CEL inside the braces):
`{{workflow.input_as_text}}`, `{{state.counter}}`, `{{my_agent.output_text}}`,
`{{classifier.output_parsed.category}}`. Node names become variable namespaces
(`"My Agent"` → `my_agent`). A config string that is exactly one expression passes the
raw value (lists/objects), and `$cel:` prefixes force CEL evaluation.

**CEL** — hand-rolled evaluator covering literals, arithmetic/comparison/logical ops,
ternary, `in`, indexing, `size()`, `has()`, `string()/int()/double()/bool()/type()`,
string methods (`contains`, `startsWith`, `matches`, `split`, …), and list macros
(`filter`, `map`, `exists`, `all`, `exists_one`). One documented deviation: numbers are
JS doubles, so `10 / 4 == 2.5` (use `int(10 / 4)` to truncate).

**Agent tools** — `web_search` (Tavily/Brave key or keyless DuckDuckGo),
`file_search` (vector stores), `code_interpreter` (sandboxed JS), `function`
(js sandbox / http webhook / client-executed), `custom`, and `mcp` (all tools of a
registered server, filterable via `allowedTools`, with per-server `requireApproval`).

**Pause/resume** — User approval nodes, MCP calls with `requireApproval: 'always'`
(both standalone nodes and mid-agent-loop), and client-executed tools all checkpoint
the full interpreter state into the run and set `status: awaiting_approval` /
`awaiting_client_tool`. `POST /runs/:id/approvals/:approvalId` with
`{approved: true|false}` (or `{result}` for client tools) resumes exactly where it
paused — including in the middle of an agent's tool batch.

## API

Base: `http://127.0.0.1:8787/api/v1`

```
GET    /health
GET|PUT /settings/keys                       stored provider keys (masked on read)
GET    /models?provider=gemini|openai|anthropic|mock

GET|POST /workflows                          list / create (accepts {name, description, graph?})
GET    /workflow-templates                    built-in starter graphs
POST   /workflows/from-template               create a workflow from a starter graph
GET|PATCH|DELETE /workflows/:id
PUT    /workflows/:id/draft                  autosave canvas JSON → {workflow, validation}
POST   /workflows/:id/validate               validate draft or body.graph (includes node contracts)
POST   /workflows/:id/publish                → immutable version N
GET    /workflows/:id/versions[/:version]
POST   /workflows/:id/versions/:version/restore
POST   /workflows/:id/export                 {format: 'typescript'|'python'} → Agents-SDK code

POST   /workflows/:id/runs                   {input: {input_as_text, variables, state_variables, history}, version}
GET    /workflows/:id/runs
GET|POST /workflows/:id/evaluations           list/create deterministic trace graders
GET    /evaluations/:id
PATCH  /evaluations/:id                       rename or replace graders
DELETE /evaluations/:id                       delete a definition and its run history
GET    /evaluations/:id/runs
POST   /evaluations/:id/run                   score selected or recent runs
GET    /runs/:id                             status, output, usage, pendingApproval
GET    /runs/:id/events                      SSE live stream (replays persisted trace first)
GET    /runs/:id/trace                       persisted events as JSON
POST   /runs/:id/cancel
POST   /runs/:id/approvals/:approvalId       {approved: bool} or {result: any}

GET    /mcp/connectors                       hosted/third-party catalog (matches the UI)
GET|POST /mcp/servers                        register (+auto-connect) — url or stdio command
PATCH|DELETE /mcp/servers/:id
POST   /mcp/servers/:id/connect              (re)connect + refresh tool list
GET    /mcp/servers/:id/tools[?refresh=true]
POST   /mcp/servers/:id/tools/:tool/call     test invocation

GET|POST /vector-stores
GET|DELETE /vector-stores/:id
GET|POST /vector-stores/:id/files            {filename, content|contentBase64}
DELETE /vector-stores/:id/files/:fileId
POST   /vector-stores/:id/search             {query, maxResults, scoreThreshold}

POST   /chatkit/sessions                     {workflow: {id, version, state_variables}, user} → client_secret
GET    /chatkit/sessions/:id                 POST /chatkit/sessions/:id/cancel
GET|POST /chatkit/sessions/:id/threads
GET    /chatkit/threads/:threadId
POST   /chatkit/threads/:threadId/messages   {text} → {thread, run} (stream the run's events)
```

Errors are `{"error": {"code", "message"}}` with meaningful status codes
(404/405/400/409/410/422/502).

### Run events (SSE)

`run.created/started/completed/failed/cancelled`, `node.started/completed/failed`,
`llm.started/delta/completed`, `tool.started/completed`, `guardrail.result`,
`state.updated`, `approval.requested/resolved`. Everything except `llm.delta` is
persisted as the run's trace.

## Frontend wiring

A typed zero-dependency SDK lives at [client/index.ts](client/index.ts):

```ts
import { AgentBuilderClient } from '../../Back End/agent-builder/client/index.ts';

const ab = new AgentBuilderClient({
  providerKeys: () => apiKeys,          // from UserDataContext — forwarded per request
});

// autosave the canvas exactly as React Flow holds it
await ab.saveDraft(workflowId, { nodes, edges });

// preview run with live events
const { run } = await ab.startRun(workflowId, { input_as_text: text });
const stop = ab.streamRunEvents(run.id, (e) => {
  if (e.type === 'llm.delta') appendToChat(e.delta);
  if (e.type === 'approval.requested') showApprovalCard(e.approval);
});

// approval card buttons
await ab.resolveApproval(run.id, approvalId, true);
```

## Providers & models

Model ids route automatically: `gemini-*` → Gemini, `gpt-*`/`o3*`/… → OpenAI,
`claude-*` → Anthropic, `mock/*` → the built-in deterministic mock provider
(`mock/echo`, `mock/upper`, `mock/json`, `mock/tool:<name>`, `mock/script`,
`mock/fail`) used by the tests, the demo, and keyless development.

Embeddings for vector stores use Gemini (`text-embedding-004`) or OpenAI
(`text-embedding-3-small`) when a key exists, falling back to a deterministic local
hashing embedder so File search works offline (keyword-level quality).

## Security posture

Designed as a **local, single-user companion service** (bound to 127.0.0.1 by
default). MCP auth secrets and provider keys are stored in the local data dir and are
never echoed back by the API. The JS sandbox (`node:vm`) is an isolation convenience,
not a hard boundary — don't expose the server to untrusted multi-tenant traffic;
set `AGENT_BUILDER_API_TOKEN` and explicit CORS origins if you bind beyond loopback.

## Layout

```
src/
  index.ts            entry — wires storage, engine, services, HTTP
  config.ts           env config
  domain/             canonical types, React Flow normalization, graph validation
  engine/             run engine: executor, checkpoints, node executors, CEL, templates,
                      JSON-schema utils, guardrails
  providers/          Gemini / OpenAI / Anthropic REST + mock provider
  mcp/                MCP client manager + connector catalog
  rag/                chunker, embeddings, vector stores
  tools/              web search, JS sandbox
  services/           workflow CRUD/versions, ChatKit-style sessions
  http/               zero-dep router, SSE, server
  api/                route registration
  codegen/            TypeScript / Python Agents-SDK export
client/index.ts       typed SDK for the Dashboard
test/                 99 tests (unit + engine + HTTP + MCP end-to-end)
scripts/demo.ts       seeds example workflows, runs one live
```
