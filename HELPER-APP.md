# The helper app Willow does not have yet

Willow runs in a browser tab. A tab cannot start a program, cannot keep running
when it is closed, and cannot reach a network service that has not agreed to be
reached from a web page. Those three limits are not bugs and no amount of code
in `features/` or `platform/` removes them — they are the boundary the browser
exists to enforce.

Several features are therefore **partly built**: the half that works in a tab
ships, and the half that needs a process on the user's machine is deferred. This
file is the list of those halves, written while the context was fresh, so that
whoever builds the helper app does not have to rediscover why each one is
blocked.

**There is already a small version of this.** `services/local-companion` is an
optional loopback daemon that gives Spark a real browser and a real shell. It is
the natural thing to grow rather than starting again — read
[its AGENTS.md](services/local-companion/AGENTS.md) first.

---

## 1. MCP servers that are not web-reachable

**What ships today:** two of MCP's transports, both browser-only. The client is
[`platform/ai/src/mcp/`](platform/ai/src/mcp/mcp-protocol.ts); the adapter that
turns MCP tools into Codex tools is
[`features/code/src/agent/mcp/mcp-harness-tools.ts`](features/code/src/agent/mcp/mcp-harness-tools.ts).

Servers are added from **Spark → Connected apps → MCP servers** and from
**Settings → Connectors → MCP servers**. Both edit one store
(`platform/ai/src/mcp/mcp-store.ts`), so they cannot disagree.

- **Streamable HTTP** — servers at a URL. Works *only* if the operator sends
  CORS headers, and MCP needs more than the usual ones: `Mcp-Session-Id` and
  `MCP-Protocol-Version` must be named in `Access-Control-Allow-Headers`, and
  `Mcp-Session-Id` must appear in `Access-Control-Expose-Headers` or the session
  is silently lost after the handshake. Servers written for desktop clients
  generally send none of this, because they never had to.
- **Web Worker** — servers that are plain JavaScript with no OS dependency,
  running inside the tab.

**What is blocked:** stdio, which is MCP's original transport and still most of
the published ecosystem. The filesystem, git, sqlite and puppeteer servers are
npm and Python packages that a client launches as a subprocess. A tab cannot.

**What the helper app would need to do**

1. Spawn a configured server (`command`, `args`, `env`, `cwd`) and speak
   JSON-RPC over its stdin/stdout, framed newline-delimited.
2. Expose those servers to the page over loopback — HTTP or WebSocket, with an
   origin allow-list and a per-session token so any other page on the machine
   cannot drive them.
3. Optionally relay Streamable HTTP too, which makes the CORS problem vanish for
   remote servers as a side effect.

**Where it plugs in.** `platform/ai/src/mcp/mcp-protocol.ts` defines
`McpTransport` as `{ send, onMessage, close }` and nothing more. A third
transport is a third file next to `http-transport.ts` and `worker-transport.ts`,
plus a `kind: 'stdio'` arm in `McpServerConfig` and a branch in
`connectMcpServer`. **Nothing above the transport changes** — not the client,
not the tool bridge, not the prompt, not either settings screen. That seam was
drawn for this.

**Do not forget the approval layer.** An MCP server is third-party code and its
output is text the model reads and acts on, which is the standard
prompt-injection path. Today's protection is coarse: a server is off until the
user switches it on, and the prompt tells the model to treat MCP output as
untrusted data. A helper app that spawns arbitrary local commands raises the
stakes a long way, and upstream Codex has a whole review layer for this
(`codex-rs/core/src/agent/control/user_authorization.rs` and its Guardian
policy). Per-tool approval should land with stdio support, not after it.

---

## 2. Scheduled actions that fire when Willow is closed

**What ships today:** Spark schedules tasks and runs them — while a tab is open.
`features/spark/src/spark-store.ts` computes the next run time and the workspace
fires it.

**What is blocked:** the whole point of a schedule. "Every weekday at 9am, check
my inbox and summarise" does not happen if nobody has Willow open at 9am. A tab
gets no wake-up: `setTimeout` dies with the page, and a Service Worker cannot be
relied on for timed work — browsers throttle and evict background workers
aggressively, and none of them guarantee a wake at a wall-clock time.

**What the helper app would need to do**

1. Own the schedule. Read Spark's task and schedule records from the workspace
   folder (`<workspace>/Spark/Tasks/*.json`, `<workspace>/Spark/Schedules/*.json`
   — the shapes are in `features/spark/src/spark-types.ts`) and hold the timers
   itself.
2. Run a turn with no UI. This is the hard part: a Spark run needs a model call,
   which needs the user's API key. Keys currently live in browser storage and
   Firestore via `apps/studio/src/settings/provider-settings.ts`, so the helper
   needs either its own copy — with the storage consequences that implies — or a
   handshake with the page when it is open.
3. Write results back into the same folder, so an open tab reconciles them
   through the existing synced-folder engine
   (`platform/storage/src/local-fs/folder-sync-engine.ts`) rather than needing a
   second path.
4. Report failures somewhere the user sees them next time they open Willow. A
   scheduled task that has been silently failing for a fortnight is worse than
   one that never ran.

**The design question to settle first**, before any code: does the helper *own*
the schedule, or does it merely *wake* the browser? Waking is far less work and
far less key-handling risk, but only fires if a browser is installed, logged in,
and permitted to be launched. Owning it works unattended and means the helper
holds credentials and a model client of its own. That choice determines
essentially everything else.

---

## What to read before starting

| For | Read |
| --- | --- |
| The daemon that already exists | [`services/local-companion/AGENTS.md`](services/local-companion/AGENTS.md) |
| Where a service belongs, and its import rules | [the root `AGENTS.md`](AGENTS.md) — `services/*` needs explicit file extensions on imports |
| The MCP transport seam | [`platform/ai/src/mcp/mcp-protocol.ts`](platform/ai/src/mcp/mcp-protocol.ts) |
| Spark's task and schedule shapes | [`features/spark/src/spark-types.ts`](features/spark/src/spark-types.ts) |
| How the workspace folder reconciles | [`platform/storage/ARCHITECTURE.md`](platform/storage/ARCHITECTURE.md) §13 |
| Why the Agent harness tracks upstream Codex | [`features/code/src/agent/harness/AGENTS.md`](features/code/src/agent/harness/AGENTS.md) |

## Keeping this file honest

Add to it when you defer something for the same reason, and delete a section
when the helper app makes it real. A stale entry here is worse than no entry: it
sends someone to build a thing that already works.
