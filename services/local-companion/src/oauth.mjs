/**
 * Signing in to an MCP server from the desktop app, as native apps do it (RFC 8252): the sign-in page opens in the
 * user's own browser and sends them back to a one-off address on this computer's loopback, which catches the answer
 * and hands it to the window. Nothing here sees a token — only the short-lived code, which is useless without the
 * PKCE verifier the window keeps.
 *
 * - `oauth.listen { port?, path?, host? }` → `{ id, redirectUri }`: a listener for one answer, on 127.0.0.1 (and ::1
 *   for `localhost`, which a browser may resolve either way); an ephemeral port unless the user's own app was
 *   registered with a fixed one. It answers once, then closes; unanswered, it closes after ten minutes.
 * - `oauth.open { url }`: the sign-in page in the default browser — https only, handed over as one argument.
 * - `oauth.cancel { id }`.
 * The answer is broadcast as `oauth.callback { id, code?, state?, error?, errorDescription? }`.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';

const WAIT_MS = 10 * 60_000;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#131314;color:#e3e3e3}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem;font-weight:600;margin:0 0 .5rem}p{margin:0;color:#c4c7c5}@media(prefers-color-scheme:light){body{background:#fff;color:#1f1f1f}p{color:#444746}}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

/** Opens an address in the user's default browser, the address one argument and no shell between. */
const defaultOpen = (url, platform = process.platform) => new Promise((resolve, reject) => {
  const [file, args] = platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', reject);
  child.once('spawn', () => {
    child.unref();
    resolve();
  });
});

/**
 * @param {{ broadcast: (name: string, payload: unknown) => void, log?: Function, open?: (url: string) => Promise<void>, waitMs?: number }} options
 */
export function createOAuth({ broadcast, log = () => {}, open = defaultOpen, waitMs = WAIT_MS }) {
  const waiting = new Map();

  const close = (id) => {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    clearTimeout(entry.timer);
    for (const server of entry.servers) server.close();
  };

  const listen = async (payload = {}) => {
    const port = payload.port === undefined ? 0 : Math.round(Number(payload.port));
    if (!(port === 0 || (port >= 1024 && port <= 65535))) throw new Error('The sign-in address needs a port from 1024 to 65535.');
    const path = typeof payload.path === 'string' && payload.path ? payload.path : '/callback';
    if (!/^\/[A-Za-z0-9/_.-]*$/.test(path)) throw new Error('That is not a path the sign-in can come back to.');
    const host = payload.host === 'localhost' ? 'localhost' : '127.0.0.1';
    const id = crypto.randomUUID();
    let answered = false;

    const handler = (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== path || answered) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      answered = true;
      const pick = (name) => url.searchParams.get(name) || undefined;
      const answer = { id, code: pick('code'), state: pick('state'), error: pick('error'), errorDescription: pick('error_description') };
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(answer.error
        ? page('Signing in did not finish', 'You can close this tab. Willow will say what happened.')
        : page('You are signed in', 'You can close this tab and go back to Willow.'));
      broadcast('oauth.callback', answer);
      close(id);
    };

    const servers = [];
    const bind = (address, chosenPort) => new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.once('error', reject);
      server.listen(chosenPort, address, () => {
        servers.push(server);
        resolve(server.address().port);
      });
    });
    let actual;
    try {
      actual = await bind('127.0.0.1', port);
    } catch (error) {
      throw new Error(error?.code === 'EADDRINUSE' ? `Port ${port} on this computer is in use, so the sign-in cannot come back to it. Close what is using it and try again.` : `The sign-in address could not be opened: ${error?.message ?? error}`);
    }
    // A browser may take `localhost` to ::1; the same port there catches it. Without IPv6, 127.0.0.1 alone serves.
    if (host === 'localhost') await bind('::1', actual).catch(() => {});

    const timer = setTimeout(() => {
      if (!waiting.has(id)) return;
      broadcast('oauth.callback', { id, error: 'timeout', errorDescription: 'Nobody finished signing in within ten minutes.' });
      close(id);
    }, waitMs);
    timer.unref?.();
    waiting.set(id, { servers, timer });
    return { id, redirectUri: `http://${host}:${actual}${path}` };
  };

  const openPage = async (payload = {}) => {
    let url;
    try {
      url = new URL(String(payload.url ?? ''));
    } catch {
      throw new Error('That is not a web address.');
    }
    if (url.protocol !== 'https:') throw new Error('Only an https sign-in page can be opened.');
    await open(url.toString());
    return { opened: true };
  };

  return {
    requests: ['oauth.listen', 'oauth.open', 'oauth.cancel'],
    handles: (type) => type.startsWith('oauth.'),
    async handle(type, payload = {}) {
      if (type === 'oauth.listen') return listen(payload);
      if (type === 'oauth.open') return openPage(payload);
      if (type === 'oauth.cancel') {
        close(String(payload.id ?? ''));
        return { cancelled: true };
      }
      throw new Error(`Unknown companion request: ${type}`);
    },
    dispose() {
      for (const id of [...waiting.keys()]) close(id);
    },
  };
}
