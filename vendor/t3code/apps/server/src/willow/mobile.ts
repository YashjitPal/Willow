// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - a plain Node listener: Willow's own handlers (api/) take Node's request and response, and the companion relay pipes raw sockets.
/**
 * Willow on a phone. Willow's Android app (`apps/android` in Willow) shows Willow's own page
 * from this computer: this listener serves it on a second port beside the agents'
 * (`WILLOW_MOBILE_PORT`, which Willow's desktop app sets), with what Willow's server gives that
 * page on the desktop (`bin/willow.js`): `/llm-proxy` and `/api/fetch-source`. It also relays the
 * local companion's socket, so code, bots and Spark reach this computer's files and shell from
 * the phone as they do on the desktop, carries the phone's side of the `phone_*` tools
 * (`./phone.ts`), and opens Willow's folder on this computer to the phone's page (`./folder.ts`),
 * so its chats, dots, projects and settings are this computer's. The app reaches both ports through its own loopback tunnels, so the page's
 * origin is `http://localhost`, a secure context that stays put when the computer's address
 * changes.
 *
 * Only a paired phone gets anything. A phone pairs with this server as any T3 client does (the
 * agents tab's Settings > Connections), and every request here must carry that session's
 * cookie, which this listener checks with the server's own session endpoint. Spark's browse
 * proxy is not offered: it serves each site from its own host, where that cookie does not go.
 */
import * as Fs from "node:fs";
import * as Http from "node:http";
import * as Net from "node:net";
import * as NodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Zlib from "node:zlib";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { AuthAdministrativeScopes, type AuthEnvironmentScope } from "@t3tools/contracts";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { handleFolderRequest } from "./folder.ts";
import * as Phone from "./phone.ts";

/** Where the Android app asks, on the agents' port, which port Willow's page is on. */
export const WELL_KNOWN_PATH = "/.well-known/willow/mobile";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
};

/** As `bin/willow.js`: the dot character frame alone is isolated, for SharedArrayBuffer. */
const DOT_CHARACTER_FRAME_PATH =
  /^\/codex\/assets\/orbit-character-[a-f0-9]{16}\/[a-f0-9]{16}\/frame\.html$/;

const SESSION_CACHE_MS = 15_000;
const PHONE_RESULT_LIMIT = 24 * 1024 * 1024;
const JSON_LIMIT = 64 * 1024;

const NOT_PAIRED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Willow</title>
<style>html{color-scheme:dark light}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#0f0f0f;color:#e3e3e3;font:16px/1.5 system-ui,sans-serif;text-align:center}@media (prefers-color-scheme:light){body{background:#faf9f9;color:#1f1f1f}}p{max-width:340px}</style></head>
<body><p>This phone is not paired with Willow on this computer. On the computer, open an agents tab, go to Settings, then Connections, and scan the pairing code with the Willow app.</p>
<script>try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({kind:"pairing-required"}))}catch(e){}</script></body></html>`;

/**
 * The listener's port while it runs, and the agents' own, for the well-known route: the app's
 * tunnels carry plain HTTP, so it needs this port, not the 443 of a link through Tailscale Serve.
 */
let mobilePort: number | null = null;
let agentsPort: number | null = null;

interface Companion {
  readonly port: number;
  readonly token: string;
}

type LlmProxy = (request: Http.IncomingMessage, response: Http.ServerResponse) => boolean;
type FetchSource = (request: Http.IncomingMessage, response: Http.ServerResponse) => Promise<void>;

const isWillowRoot = (dir: string) =>
  Fs.existsSync(NodePath.join(dir, "apps", "studio", "dist", "index.html")) &&
  Fs.existsSync(NodePath.join(dir, "api"));

/** Willow's checkout or installed payload, which holds this server under `vendor/t3code`. */
function willowRoot(): string | null {
  const configured = process.env.WILLOW_ROOT?.trim();
  if (configured) return isWillowRoot(configured) ? configured : null;
  let dir = NodePath.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (isWillowRoot(dir)) return dir;
    const parent = NodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function companionFromEnv(): Companion | null {
  const port = Number(process.env.WILLOW_COMPANION_PORT);
  const token = process.env.WILLOW_COMPANION_TOKEN ?? "";
  return Number.isInteger(port) && port > 0 && port < 65536 && token ? { port, token } : null;
}

/** Where this process answers on the loopback, for its own session endpoint. */
function loopbackOrigin(port: number, host: string | undefined): string {
  const wildcard = !host || host === "0.0.0.0" || host === "::" || host === "localhost";
  const address = wildcard ? "127.0.0.1" : host;
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
}

async function importWillow<T>(
  root: string,
  file: string,
  pick: (module: Record<string, unknown>) => unknown,
) {
  try {
    const module = (await import(pathToFileURL(NodePath.join(root, "api", file)).href)) as Record<
      string,
      unknown
    >;
    const value = pick(module);
    return typeof value === "function" ? (value as T) : null;
  } catch {
    return null;
  }
}

const json = (response: Http.ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const readJson = (request: Http.IncomingMessage, limit: number) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const chunks: Array<Buffer> = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.destroy();
        resolve({});
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(value && typeof value === "object" ? (value as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    request.on("error", () => resolve({}));
  });

/** A request another page sent: cookies go with some of those, but this page never sends one. */
const crossOrigin = (request: Http.IncomingMessage) => {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.host;
  } catch {
    return true;
  }
};

function serveFile(
  distDir: string,
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
  pathname: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end("Method Not Allowed");
    return;
  }
  let reqPath: string;
  try {
    reqPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end("Bad Request");
    return;
  }
  let filePath = NodePath.join(distDir, NodePath.normalize(reqPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(distDir)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  let stat = Fs.existsSync(filePath) ? Fs.statSync(filePath) : null;
  if (stat?.isDirectory()) {
    const index = NodePath.join(filePath, "index.html");
    filePath = index;
    stat = Fs.existsSync(index) ? Fs.statSync(index) : null;
  }
  const isAsset = reqPath.startsWith("/assets/") || NodePath.extname(reqPath) !== "";
  if ((!stat || !stat.isFile()) && !isAsset) {
    filePath = NodePath.join(distDir, "index.html");
    stat = Fs.existsSync(filePath) ? Fs.statSync(filePath) : null;
  }
  if (!stat || !stat.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }
  if (DOT_CHARACTER_FRAME_PATH.test(reqPath)) {
    response.setHeader("Document-Isolation-Policy", "isolate-and-require-corp");
    response.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  }
  const extension = NodePath.extname(filePath).toLowerCase();
  response.setHeader(
    "Cache-Control",
    filePath.includes(`${NodePath.sep}assets${NodePath.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  response.setHeader("Content-Type", MIME_TYPES[extension] ?? "application/octet-stream");
  response.setHeader("Vary", "Accept-Encoding");
  const encoding = COMPRESSIBLE.has(extension) ? acceptedEncoding(request.headers["accept-encoding"]) : null;
  if (encoding) {
    compressed(filePath, stat, encoding).then(
      (body) => {
        response.writeHead(200, { "Content-Encoding": encoding, "Content-Length": body.length });
        response.end(request.method === "HEAD" ? undefined : body);
      },
      () => response.destroy(),
    );
    return;
  }
  // Media plays from ranges: the phone's WebView asks for a video a part at a time.
  response.setHeader("Accept-Ranges", "bytes");
  const range = rangeOf(request.headers.range, stat.size);
  if (range === "unsatisfiable") {
    response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
    return;
  }
  if (range) {
    response.writeHead(206, {
      "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      "Content-Length": range.end - range.start + 1,
    });
  } else {
    response.writeHead(200, { "Content-Length": stat.size });
  }
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = Fs.createReadStream(filePath, range ?? {});
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

/**
 * Willow's scripts and styles, compressed once per build: a cold start fetches about 9 MB of them,
 * which a phone on Wi-Fi feels, and the build ships none compressed.
 */
const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".txt", ".wasm", ".map", ".data", ".xml", ".webmanifest"]);
const COMPRESSED_CACHE_BYTES = 160 * 1024 * 1024;
const compressedCache = new Map<string, { readonly mtimeMs: number; readonly size: number; readonly body: Buffer }>();
let compressedBytes = 0;

const acceptedEncoding = (header: string | undefined): "br" | "gzip" | null => {
  if (!header) return null;
  if (/\bbr\b/.test(header)) return "br";
  if (/\bgzip\b/.test(header)) return "gzip";
  return null;
};

async function compressed(filePath: string, stat: Fs.Stats, encoding: "br" | "gzip"): Promise<Buffer> {
  const key = `${encoding}:${filePath}`;
  const kept = compressedCache.get(key);
  if (kept && kept.mtimeMs === stat.mtimeMs && kept.size === stat.size) return kept.body;
  const raw = await Fs.promises.readFile(filePath);
  const body = await new Promise<Buffer>((resolve, reject) => {
    const done = (error: Error | null, result: Buffer) => (error ? reject(error) : resolve(result));
    if (encoding === "br") {
      Zlib.brotliCompress(
        raw,
        { params: { [Zlib.constants.BROTLI_PARAM_QUALITY]: 6, [Zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } },
        done,
      );
    } else {
      Zlib.gzip(raw, { level: 6 }, done);
    }
  });
  if (kept) compressedBytes -= kept.body.length;
  compressedCache.delete(key);
  compressedCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, body });
  compressedBytes += body.length;
  for (const [oldKey, oldValue] of compressedCache) {
    if (compressedBytes <= COMPRESSED_CACHE_BYTES) break;
    compressedCache.delete(oldKey);
    compressedBytes -= oldValue.body.length;
  }
  return body;
}

/** One `Range: bytes=` span; anything else is answered whole. */
function rangeOf(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

const rejectUpgrade = (socket: Net.Socket, status: number) => {
  socket.end(
    `HTTP/1.1 ${status} ${Http.STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
};

interface ListenerOptions {
  readonly root: string;
  readonly port: number;
  readonly host: string | undefined;
  readonly agentsPort: number;
  readonly agentsOrigin: string;
  readonly companion: Companion | null;
  /** Willow's folder on this computer, which the phone's page works on (`./folder.ts`). */
  readonly folder: string | undefined;
  readonly issueHarnessToken: (scopes: Scopes) => Promise<string>;
}

type Scopes = ReadonlyArray<AuthEnvironmentScope>;

/** A phone's session, which every request here must carry, and what it may do. */
interface PhoneSession {
  readonly paired: boolean;
  readonly scopes: Scopes;
}

const NOT_PAIRED: PhoneSession = { paired: false, scopes: [] };

const isScope = (value: unknown): value is AuthEnvironmentScope =>
  typeof value === "string" && (AuthAdministrativeScopes as ReadonlyArray<string>).includes(value);

async function startListener(options: ListenerOptions): Promise<Http.Server> {
  const distDir = NodePath.join(options.root, "apps", "studio", "dist");
  const llmProxy = await importWillow<LlmProxy>(
    options.root,
    "_llm-proxy.js",
    (module) => module.handleLlmProxy,
  );
  const fetchSource = await importWillow<FetchSource>(
    options.root,
    "fetch-source.js",
    (module) => module.default,
  );
  // `bin/willow.js` turns notebook sources on the same way.
  if (fetchSource) process.env.SOURCE_FETCH_ENABLED ??= "1";

  const sessions = new Map<string, { readonly session: PhoneSession; readonly at: number }>();
  const sessionOf = async (cookie: string | undefined): Promise<PhoneSession> => {
    if (!cookie) return NOT_PAIRED;
    const now = Date.now();
    const cached = sessions.get(cookie);
    if (cached && now - cached.at < SESSION_CACHE_MS) return cached.session;
    let session = NOT_PAIRED;
    try {
      const response = await fetch(`${options.agentsOrigin}/api/auth/session`, {
        headers: { cookie },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const state = (await response.json()) as { authenticated?: unknown; scopes?: unknown };
        if (state.authenticated === true) {
          session = {
            paired: true,
            scopes: Array.isArray(state.scopes) ? state.scopes.filter(isScope) : [],
          };
        }
      }
    } catch {
      session = NOT_PAIRED;
    }
    if (sessions.size > 200) sessions.clear();
    sessions.set(cookie, { session, at: now });
    return session;
  };

  const handle = async (request: Http.IncomingMessage, response: Http.ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const session = await sessionOf(request.headers.cookie);
    const isPaired = session.paired;

    if (pathname === "/api/willow/session") {
      json(response, 200, {
        version: 1,
        paired: isPaired,
        agentsPort: options.agentsPort,
        companion: isPaired && options.companion !== null,
      });
      return;
    }
    if (!isPaired) {
      const isPage =
        (request.method === "GET" || request.method === "HEAD") &&
        NodePath.extname(pathname) === "" &&
        !pathname.startsWith("/api/") &&
        pathname !== "/llm-proxy";
      if (isPage) {
        response.writeHead(401, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(NOT_PAIRED_PAGE);
      } else json(response, 401, { error: "This phone is not paired with this computer." });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD" && crossOrigin(request)) {
      json(response, 403, { error: "Cross-origin request refused." });
      return;
    }

    if (await handleFolderRequest(request, response, url, options.folder)) return;
    if (pathname === "/api/willow/harness" && request.method === "POST") {
      // The agents tab may do what the phone's own pairing lets it, and no more.
      if (session.scopes.length === 0) {
        json(response, 403, { error: "This phone's pairing gives it no access to the agents." });
        return;
      }
      try {
        json(response, 200, { token: await options.issueHarnessToken(session.scopes) });
      } catch {
        json(response, 500, {
          error: "The agents' server could not issue a sign-in for the agents tab.",
        });
      }
      return;
    }
    if (pathname.startsWith("/api/willow/phone/")) {
      const body =
        request.method === "POST"
          ? await readJson(request, pathname.endsWith("/result") ? PHONE_RESULT_LIMIT : JSON_LIMIT)
          : {};
      const phoneId = request.method === "POST" ? body.phone : url.searchParams.get("phone");
      if (!Phone.isPhoneId(phoneId)) {
        json(response, 400, { error: "Missing phone id." });
        return;
      }
      if (pathname === "/api/willow/phone/hello" && request.method === "POST") {
        Phone.hello(phoneId, body);
        json(response, 200, { ok: true });
        return;
      }
      if (pathname === "/api/willow/phone/next" && request.method === "GET") {
        const closed = new Promise<void>((resolve) => response.once("close", () => resolve()));
        const calls = await Phone.poll(phoneId, closed);
        if (response.destroyed || response.writableEnded) Phone.requeue(phoneId, calls);
        else json(response, 200, { calls });
        return;
      }
      if (pathname === "/api/willow/phone/result" && request.method === "POST") {
        json(response, 200, { ok: Phone.settle(phoneId, body) });
        return;
      }
      json(response, 404, { error: "Not found." });
      return;
    }
    if (llmProxy?.(request, response)) return;
    if (fetchSource && pathname === "/api/fetch-source") {
      const shim = Object.assign(response, {
        status(code: number) {
          response.statusCode = code;
          return shim;
        },
      });
      try {
        await fetchSource(request, shim);
      } catch {
        if (!response.headersSent) json(response, 500, { error: "fetch-source failed" });
      }
      return;
    }
    if (pathname.startsWith("/api/")) {
      json(response, 404, { error: "Not found." });
      return;
    }
    serveFile(distDir, request, response, pathname);
  };

  const server = Http.createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) json(response, 500, { error: "Internal error." });
      else response.destroy();
    });
  });

  // The companion's socket: the phone presents its session; the companion gets its own token.
  server.on("upgrade", (request: Http.IncomingMessage, socket: Net.Socket, head: Buffer) => {
    // Unheard, a socket's error (a phone dropping the connection) would end the whole server.
    socket.on("error", () => socket.destroy());
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const companion = options.companion;
      if (url.pathname !== "/api/willow/companion" || !companion) return rejectUpgrade(socket, 404);
      if (!(await sessionOf(request.headers.cookie)).paired) return rejectUpgrade(socket, 401);
      const upstream = Net.connect(companion.port, "127.0.0.1");
      const close = () => {
        upstream.destroy();
        socket.destroy();
      };
      upstream.once("connect", () => {
        const lines = [`GET /ws?token=${encodeURIComponent(companion.token)} HTTP/1.1`];
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
          const name = request.rawHeaders[index] ?? "";
          if (/^(host|cookie)$/i.test(name)) continue;
          lines.push(`${name}: ${request.rawHeaders[index + 1] ?? ""}`);
        }
        lines.push(`Host: 127.0.0.1:${companion.port}`);
        upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on("error", close);
      upstream.on("close", close);
      socket.on("error", close);
      socket.on("close", close);
    })().catch(() => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

const start = Effect.gen(function* () {
  const port = Number(process.env.WILLOW_MOBILE_PORT);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return;
  const config = yield* ServerConfig.ServerConfig;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const root = willowRoot();
  if (!root) {
    yield* Effect.logWarning("Willow's phone page is off: Willow's built pages were not found.");
    return;
  }
  yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      startListener({
        root,
        port,
        host: config.host,
        agentsPort: config.port,
        agentsOrigin: loopbackOrigin(config.port, config.host),
        companion: companionFromEnv(),
        folder: process.env.WILLOW_FOLDER?.trim() || undefined,
        issueHarnessToken: (scopes) =>
          Effect.runPromise(
            auth
              .issuePairingCredential({ label: "Willow on a phone", scopes })
              .pipe(Effect.map((issued) => issued.credential)),
          ),
      }),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          mobilePort = port;
          agentsPort = config.port;
        }),
      ),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            mobilePort = null;
            agentsPort = null;
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
  ).pipe(
    Effect.tap(() => Effect.logInfo("Willow's phone page is listening", { port })),
    Effect.catch((error) =>
      Effect.logWarning("Willow's phone page could not start", { port, error: String(error) }),
    ),
  );
});

const wellKnown = HttpRouter.add(
  "GET",
  WELL_KNOWN_PATH,
  Effect.sync(() =>
    mobilePort === null
      ? HttpServerResponse.text("Not Found", { status: 404 })
      : HttpServerResponse.jsonUnsafe({ version: 1, willowPort: mobilePort, agentsPort }),
  ),
);

export const layer = Layer.mergeAll(wellKnown, Layer.effectDiscard(start));
