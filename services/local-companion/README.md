# Willow Local Companion (prototype)

This is intentionally a small local foundation for the Spark UI. It exposes a
loopback WebSocket endpoint with two narrow capabilities:

- a managed Chromium session that can return screenshots, tabs, navigation and
  basic pointer/keyboard actions (and can be closed cleanly when a Spark task
  panel is dismissed);
- an explicitly authorised workspace that can run one-shot shell commands.

It is not the final agent harness. There is no cloud browser, planner, retry
system, PTY multiplexer, installer, or production permission UI yet.

The browser session is a separate local headless Chrome profile for now. It
does not take over the user's already-open Chrome tabs; that remains the job
of the optional browser-extension bridge.

## Run it

```powershell
npm install --prefix services/local-companion   # first time only
npm run companion:start                         # from the repo root
```

The companion listens on `127.0.0.1:43117` and accepts Willow development
origins (`localhost` and `127.0.0.1`). A token can be required when needed:

```powershell
$env:WILLOW_COMPANION_TOKEN = "choose-a-long-random-token"
npm start
```

The studio client can receive that token through the
`willow_companion_token` local-storage value. Keep the companion bound to
loopback; do not expose this port on a LAN or the public internet.
