# services/local-companion

An optional loopback daemon that gives Spark two capabilities the browser cannot
have: a **real Chromium session** it can screenshot and drive, and **shell command
execution** inside a folder the user explicitly authorised.

Plain `.mjs` on Node — no TypeScript, no build step. One file: `src/index.mjs` (425
lines). Its own npm package (`ws`, `playwright-core`).

## Run it

```powershell
npm install --prefix services/local-companion   # first time only
npm run companion:start                         # from the repo root
```

Listens on `ws://127.0.0.1:43117/ws`, plus `GET /health` for liveness. The browser
client is `features/code/src/local-companion.ts`; Spark falls back to its embedded
session when the companion is absent.

## Protocol

WebSocket JSON request/response with server-pushed events.

- **Request** → `{ id, type, payload }`; **reply** → `{ id, type: 'result', ok, result | error }`.
- **Events** (unsolicited) → `{ type: 'event', event, payload }`. The two that
  matter: `browser.frame` (a PNG data URL, pushed every 500 ms while a browser is
  open) and `browser.tabs`.
- `tool.list` returns the 17 supported operations.
- On connect the server sends `{ type: 'ready', sessionId, capabilities }`.

One session per socket. Closing the socket disposes the browser.

## Security model — read this before changing anything here

This process runs shell commands and drives a browser on the user's machine. Four
controls hold it in place; **do not weaken any of them without saying so explicitly:**

1. **Loopback only.** `HOST` is hardcoded `127.0.0.1`. Never bind `0.0.0.0` — that
   would expose command execution to the LAN.
2. **Origin allowlist.** `isAllowedOrigin()` accepts only `localhost` /
   `127.0.0.1` (any port), plus whatever `WILLOW_COMPANION_ORIGINS` adds.
3. **Optional pairing token.** If `WILLOW_COMPANION_TOKEN` is set, the socket must
   present `?token=`. Unset means dev mode: any localhost origin connects. The
   browser side reads the token from the `willow_companion_token` localStorage key.
4. **Workspace confinement.** `shell.exec` refuses to run until the client calls
   `workspace.authorize` with a directory, and `isInside()` rejects any `cwd` that
   escapes that root. Path traversal is checked via `path.relative`, not string
   prefixes.

Also bounded on purpose: output truncated to 1 MB, command length to 20 000 chars,
timeout clamped to 250 ms–120 s, and URLs restricted to `http`/`https`/`about`.

## Notes

- The Chromium it launches is a **separate headless profile**, not the user's open
  Chrome. Taking over real tabs is the browser-extension bridge's job, not this.
- On Windows it probes the three usual Chrome install paths, then falls back to
  Playwright's `channel: 'chrome'`. `WILLOW_CHROME_PATH` overrides.
- This is a prototype foundation: no planner, no retries, no PTY multiplexing, no
  installer, no production permission UI.
