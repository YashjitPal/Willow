#!/usr/bin/env node

/**
 * Willow CLI launcher
 *
 * Starts a lightweight local HTTP server serving Willow Studio and automatically
 * opens the browser so users can run Willow via `npx willow-studio` or `willow`.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package version
let version = '0.1.0';
try {
  const pkgPath = path.resolve(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.version) version = pkg.version;
} catch {
  // Ignore fallback
}

// Parse command line arguments
const args = process.argv.slice(2);
function getArg(flag, alias) {
  const idx = args.findIndex((a) => a === flag || (alias && a === alias));
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return args[idx + 1];
  }
  const prefix = `${flag}=`;
  const found = args.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return undefined;
}

const hasArg = (flag, alias) => args.includes(flag) || (alias && args.includes(alias));

if (hasArg('--help', '-h')) {
  console.log(`
  🌿 Willow Studio v${version}

  Usage:
    willow [options]
    npx willow-studio [options]

  Options:
    -p, --port <number>    Port to run the server on (default: 3000)
    -h, --host <address>   Host address to bind to (default: localhost)
    --no-open              Do not automatically open the browser
    -v, --version          Display version number
    --help                 Show this help message
`);
  process.exit(0);
}

if (hasArg('--version', '-v')) {
  console.log(`v${version}`);
  process.exit(0);
}

// Locate pre-built static directory
const candidateRoots = [
  path.resolve(__dirname, '../apps/studio/dist'),
  path.resolve(__dirname, '../dist'),
];
const distDir = candidateRoots.find((dir) => fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html')));

if (!distDir) {
  console.error(`
\x1b[31m[willow]\x1b[0m Willow Studio production build not found!
Please run:
  \x1b[36mnpm run build\x1b[0m
before launching the server.
`);
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port, host);
  });
}

async function findAvailablePort(startPort, host) {
  let port = startPort;
  while (!(await isPortAvailable(port, host))) {
    port += 1;
    if (port > startPort + 50) {
      throw new Error(`No available ports found between ${startPort} and ${port}`);
    }
  }
  return port;
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd = '';
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, () => {
    // Ignore error if browser cannot be launched in headless environments
  });
}

async function start() {
  const defaultPort = parseInt(getArg('--port', '-p') || process.env.PORT || '3000', 10);
  const host = getArg('--host', '-h') || 'localhost';
  const shouldOpen = !hasArg('--no-open');

  let port;
  try {
    port = await findAvailablePort(defaultPort, host);
  } catch (err) {
    console.error(`\x1b[31m[willow]\x1b[0m ${err.message}`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    let reqPath = '/';
    try {
      reqPath = decodeURIComponent(new URL(req.url || '/', `http://${req.headers.host}`).pathname);
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(distDir, safePath);

    // Directory traversal prevention
    if (!filePath.startsWith(distDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    // Check if file exists
    let stat;
    try {
      stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    } catch {
      stat = null;
    }

    if (stat && stat.isDirectory()) {
      const indexCandidate = path.join(filePath, 'index.html');
      if (fs.existsSync(indexCandidate)) {
        filePath = indexCandidate;
        stat = fs.statSync(filePath);
      } else {
        stat = null;
      }
    }

    // SPA fallback: If asset not found, serve index.html
    const isAsset = reqPath.startsWith('/assets/') || path.extname(reqPath) !== '';
    if ((!stat || !stat.isFile()) && !isAsset) {
      filePath = path.join(distDir, 'index.html');
      stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    }

    if (!stat || !stat.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Caching headers
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });
    stream.pipe(res);
  });

  server.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`
  \x1b[32m🌿 Willow Studio\x1b[0m \x1b[2mv${version}\x1b[0m

  \x1b[32m➜\x1b[0m  \x1b[1mLocal:\x1b[0m   \x1b[36m${url}/\x1b[0m
  ${port !== defaultPort ? `\x1b[33m➜  Notice: Port ${defaultPort} was occupied, using ${port}\x1b[0m\n` : ''}  \x1b[2mPress Ctrl+C to stop\x1b[0m
`);

    if (shouldOpen) {
      openBrowser(url);
    }
  });

  const shutdown = () => {
    console.log('\n\x1b[2mStopping Willow Studio...\x1b[0m');
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
