// @effect-diagnostics nodeBuiltinImport:off globalDate:off - plain Node file access behind the phone listener's plain Node requests (./mobile.ts).
/**
 * The Willow folder on this computer (`<home>\Willow`, or the one picked in Willow's Settings,
 * `WILLOW_FOLDER` from Willow's desktop app), for Willow on a phone. The phone's page works on
 * this folder through these routes, as the desktop's page works on it through the File System
 * Access API, so the two are copies of Willow on one folder: chats, projects, dots and
 * `settings.json` (API keys included) are this computer's, and Willow's own sync engine keeps both
 * copies on it (Willow's platform/storage ARCHITECTURE.md, "Disk = truth"). The phone's side is
 * Willow's platform/core/src/android-folder.ts.
 *
 * Paths are relative to the folder and `/`-separated; none leaves it, through `..` or a link.
 * Errors carry the DOMException name the File System Access API would throw, which Willow tests.
 */
import { createHash, randomBytes } from "node:crypto";
import * as Fs from "node:fs";
import * as FsP from "node:fs/promises";
import type * as Http from "node:http";
import * as NodePath from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const FOLDER_PREFIX = "/api/willow/folder";

/** Videos are the largest files Willow keeps. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_MOVE_BODY = 16 * 1024;
const BAD_NAME = /[\u0000-\u001f<>:"|?*\\]/;

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

class FolderError extends Error {
  readonly status: number;
  readonly domName: string;

  constructor(status: number, domName: string, message: string) {
    super(message);
    this.status = status;
    this.domName = domName;
  }
}

const notFound = (path: string) =>
  new FolderError(404, "NotFoundError", `${path || "Willow's folder"} is not there.`);
const typeMismatch = (path: string) =>
  new FolderError(409, "TypeMismatchError", `${path} is not what was asked for.`);

interface WillowFolder {
  readonly root: string;
  /** Stable for this folder, so the phone keeps one storage scope for it. */
  readonly id: string;
  readonly name: string;
}

let found: { readonly configured: string; readonly folder: WillowFolder } | null = null;

/**
 * Changes whenever anything in the folder does, so the phone lists folders again only then: its
 * Willow reconciles every few seconds. Without a watcher, every answer is new. The epoch keeps a
 * restarted server's versions from meeting the last one's.
 */
interface Watched {
  readonly root: string;
  watcher: Fs.FSWatcher | null;
  count: number;
  triedAt: number;
}

let watched: Watched | null = null;
const epoch = randomBytes(4).toString("hex");
/** A watcher that failed (a watched folder removed under it) is made again, at most this often. */
const REWATCH_MS = 5_000;

function watch(state: Watched) {
  state.triedAt = Date.now();
  try {
    const watcher = Fs.watch(state.root, { recursive: true }, () => {
      state.count += 1;
    });
    watcher.on("error", () => {
      watcher.close();
      if (state.watcher === watcher) state.watcher = null;
      state.count += 1;
    });
    state.watcher = watcher;
  } catch {
    state.watcher = null;
  }
}

function versionOf(folder: WillowFolder): string {
  if (watched?.root !== folder.root) {
    watched?.watcher?.close();
    watched = { root: folder.root, watcher: null, count: 1, triedAt: 0 };
    watch(watched);
  } else if (!watched.watcher && Date.now() - watched.triedAt >= REWATCH_MS) {
    watch(watched);
  }
  if (!watched.watcher) watched.count += 1;
  return `${epoch}-${watched.count}`;
}

/** The phone's own changes count at once, whenever the watcher reports them. */
const changed = () => {
  if (watched) watched.count += 1;
};

/** Looked up when asked: Willow's page makes the folder on its first start, perhaps after this server's. */
async function folderAt(configured: string | undefined): Promise<WillowFolder | null> {
  if (!configured) return null;
  if (found?.configured === configured) return found.folder;
  try {
    const root = await FsP.realpath(configured);
    if (!(await FsP.stat(root)).isDirectory()) return null;
    const folder = {
      root,
      id: createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 16),
      name: NodePath.basename(root),
    };
    found = { configured, folder };
    return folder;
  } catch {
    return null;
  }
}

function partsOf(relative: string): ReadonlyArray<string> {
  const parts = relative.split("/").filter((part) => part !== "");
  for (const part of parts) {
    if (part === "." || part === ".." || part.length > 255 || BAD_NAME.test(part)) {
      throw new FolderError(400, "TypeError", "That name is not allowed.");
    }
  }
  return parts;
}

const within = (root: string, path: string) => {
  const relative = NodePath.relative(root.toLowerCase(), path.toLowerCase());
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

/** The full path for `relative`, after checking that what exists of it is inside the folder. */
async function inside(folder: WillowFolder, relative: string): Promise<string> {
  const full = NodePath.join(folder.root, ...partsOf(relative));
  let existing = full;
  for (;;) {
    try {
      const real = await FsP.realpath(existing);
      if (!within(folder.root, real)) {
        throw new FolderError(403, "NotAllowedError", "That is outside Willow's folder.");
      }
      return full;
    } catch (error) {
      if (error instanceof FolderError) throw error;
      const parent = NodePath.dirname(existing);
      if (parent === existing || !within(folder.root, parent)) return full;
      existing = parent;
    }
  }
}

const parentOf = (relative: string) => relative.split("/").filter(Boolean).slice(0, -1).join("/");

const statOrNull = (path: string) => FsP.stat(path).catch(() => null);

const describe = (stat: Fs.Stats) => ({
  kind: stat.isDirectory() ? "directory" : "file",
  size: stat.isDirectory() ? 0 : stat.size,
  modified: Math.floor(stat.mtimeMs),
});

const etagOf = (stat: Fs.Stats) => `"${Math.floor(stat.mtimeMs)}-${stat.size}"`;

const send = (response: Http.ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const fsError = (error: unknown, relative: string): FolderError => {
  if (error instanceof FolderError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return notFound(relative);
  if (code === "ENOTDIR" || code === "EISDIR") return typeMismatch(relative);
  if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM" || code === "EBUSY") {
    return new FolderError(409, "InvalidModificationError", `${relative} could not be changed.`);
  }
  if (code === "EACCES") return new FolderError(403, "NotAllowedError", `${relative} is not allowed.`);
  return new FolderError(500, "UnknownError", `${relative} could not be reached.`);
};

async function list(folder: WillowFolder, relative: string, response: Http.ServerResponse) {
  const dir = await inside(folder, relative);
  const entries = await FsP.readdir(dir, { withFileTypes: true });
  const described = await Promise.all(
    entries
      // Links and devices are not offered: a link could lead out of the folder.
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map(async (entry) => {
        const stat = await statOrNull(NodePath.join(dir, entry.name));
        return stat ? { name: entry.name, ...describe(stat) } : null;
      }),
  );
  send(response, 200, { entries: described.filter((entry) => entry !== null) });
}

async function readFile(
  folder: WillowFolder,
  relative: string,
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
) {
  const full = await inside(folder, relative);
  const stat = await FsP.stat(full);
  if (stat.isDirectory()) throw typeMismatch(relative);
  const etag = etagOf(stat);
  const headers = {
    "Cache-Control": "no-store",
    ETag: etag,
    "X-Willow-Modified": String(Math.floor(stat.mtimeMs)),
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  response.writeHead(200, {
    ...headers,
    "Content-Type":
      CONTENT_TYPES[NodePath.extname(full).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": stat.size,
  });
  await pipeline(Fs.createReadStream(full), response);
}

/** Written beside the file and moved over it, as Chromium's `createWritable` does with its `.crswap`. */
async function writeFile(
  folder: WillowFolder,
  relative: string,
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
) {
  const full = await inside(folder, relative);
  const parent = await statOrNull(NodePath.dirname(full));
  if (!parent?.isDirectory()) throw notFound(parentOf(relative));
  if ((await statOrNull(full))?.isDirectory()) throw typeMismatch(relative);
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    throw new FolderError(413, "QuotaExceededError", "That file is too large.");
  }
  const swap = NodePath.join(
    NodePath.dirname(full),
    `.${NodePath.basename(full)}.${randomBytes(6).toString("hex")}.crswap`,
  );
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      done(
        received > MAX_UPLOAD_BYTES
          ? new FolderError(413, "QuotaExceededError", "That file is too large.")
          : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(request, limit, Fs.createWriteStream(swap));
    await FsP.rename(swap, full);
  } catch (error) {
    await FsP.rm(swap, { force: true }).catch(() => undefined);
    throw error;
  }
  send(response, 200, describe(await FsP.stat(full)));
}

async function create(folder: WillowFolder, relative: string, kind: string | null, response: Http.ServerResponse) {
  if (kind !== "file" && kind !== "directory") {
    throw new FolderError(400, "TypeError", "Ask for a file or a directory.");
  }
  const full = await inside(folder, relative);
  const existing = await statOrNull(full);
  if (existing) {
    if (existing.isDirectory() !== (kind === "directory")) throw typeMismatch(relative);
    send(response, 200, describe(existing));
    return;
  }
  const parent = await statOrNull(NodePath.dirname(full));
  if (!parent?.isDirectory()) throw notFound(parentOf(relative));
  if (kind === "directory") await FsP.mkdir(full);
  else await FsP.writeFile(full, "", { flag: "wx" });
  send(response, 200, describe(await FsP.stat(full)));
}

async function remove(folder: WillowFolder, relative: string, recursive: boolean, response: Http.ServerResponse) {
  if (partsOf(relative).length === 0) {
    throw new FolderError(403, "NotAllowedError", "Willow's folder itself cannot be removed.");
  }
  const full = await inside(folder, relative);
  const stat = await FsP.stat(full);
  if (stat.isDirectory()) {
    if (recursive) await FsP.rm(full, { recursive: true });
    else await FsP.rmdir(full);
  } else {
    await FsP.unlink(full);
  }
  send(response, 200, { removed: true });
}

const readBody = (request: Http.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Array<Buffer> = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MOVE_BODY) {
        request.destroy();
        reject(new FolderError(413, "TypeError", "That request is too large."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

async function move(folder: WillowFolder, request: Http.IncomingMessage, response: Http.ServerResponse) {
  let body: { from?: unknown; to?: unknown };
  try {
    body = JSON.parse(await readBody(request)) as { from?: unknown; to?: unknown };
  } catch (error) {
    throw error instanceof FolderError ? error : new FolderError(400, "TypeError", "Say what to move where.");
  }
  if (typeof body.from !== "string" || typeof body.to !== "string") {
    throw new FolderError(400, "TypeError", "Say what to move where.");
  }
  if (partsOf(body.from).length === 0 || partsOf(body.to).length === 0) {
    throw new FolderError(403, "NotAllowedError", "Willow's folder itself cannot be moved.");
  }
  const from = await inside(folder, body.from);
  const to = await inside(folder, body.to);
  const source = await FsP.stat(from);
  const parent = await statOrNull(NodePath.dirname(to));
  if (!parent?.isDirectory()) throw notFound(parentOf(body.to));
  if (source.isDirectory() && within(from, to) && from.toLowerCase() !== to.toLowerCase()) {
    throw new FolderError(409, "InvalidModificationError", "A folder cannot go inside itself.");
  }
  // A file takes another's place, as the API's move does; a folder never replaces one.
  await FsP.rename(from, to);
  send(response, 200, describe(await FsP.stat(to)));
}

/** Answers the folder's routes for a paired phone. Resolves to whether the request was one. */
export async function handleFolderRequest(
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
  url: URL,
  configured: string | undefined,
): Promise<boolean> {
  if (url.pathname !== FOLDER_PREFIX && !url.pathname.startsWith(`${FOLDER_PREFIX}/`)) return false;
  const relative = url.searchParams.get("path") ?? "";
  try {
    const folder = await folderAt(configured);
    if (!folder) {
      throw new FolderError(404, "NotFoundError", "Willow has no folder on this computer yet.");
    }
    const route = `${request.method ?? "GET"} ${url.pathname.slice(FOLDER_PREFIX.length) || "/"}`;
    switch (route) {
      case "GET /":
        send(response, 200, {
          id: folder.id,
          name: folder.name,
          // Windows' and macOS's names ignore case, as the API's lookups there do.
          ignoresCase: process.platform === "win32" || process.platform === "darwin",
          version: versionOf(folder),
        });
        return true;
      case "GET /version":
        send(response, 200, { version: versionOf(folder) });
        return true;
      case "GET /list":
        await list(folder, relative, response);
        return true;
      case "GET /stat":
        send(response, 200, describe(await FsP.stat(await inside(folder, relative))));
        return true;
      case "GET /file":
        await readFile(folder, relative, request, response);
        return true;
      case "PUT /file":
        await writeFile(folder, relative, request, response).finally(changed);
        return true;
      case "POST /create":
        await create(folder, relative, url.searchParams.get("kind"), response).finally(changed);
        return true;
      case "DELETE /entry":
        await remove(folder, relative, url.searchParams.get("recursive") === "1", response).finally(changed);
        return true;
      case "POST /move":
        await move(folder, request, response).finally(changed);
        return true;
      default:
        throw new FolderError(404, "NotFoundError", "Willow's folder has no such route.");
    }
  } catch (error) {
    const failure = fsError(error, relative);
    if (response.headersSent) response.destroy();
    else send(response, failure.status, { error: { name: failure.domName, message: failure.message } });
    return true;
  }
}
