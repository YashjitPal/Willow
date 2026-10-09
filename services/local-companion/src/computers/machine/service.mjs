/**
 * Willow's computer service: everything a bot can do on its own computer.
 *
 * Runs inside Willow's computer — one Alpine Linux distro under WSL 2 that the
 * user's bots share, each with an account of its own — started by the local
 * companion (`../manager.mjs`) as root, once per bot that is using it, with its
 * settings (which account, which screen, which ports) on the first line of
 * stdin. For its bot it keeps a desktop on a screen of its own (Xvfb and XFCE),
 * drives one Chromium in a window there over the DevTools pipe, and runs
 * commands and file operations as the bot's unprivileged user, in its folder.
 *
 * The contract is OpenBot's agent computer (CopilotKit/openbot, `agent-computer/`):
 * navigate, read, snapshot with refs, click, type, key and scroll; files and a
 * shell in a workspace; and the wheel — a person can be asked to take over, and
 * while they hold it the bot's actions are refused. What differs is the plumbing:
 * the DevTools protocol directly instead of Playwright, and a WSL distro instead
 * of a container. The desktop goes beyond OpenBot, whose computer is a browser
 * with no screen: the whole screen streams to the pane, a person taking over
 * drives all of it, and the bot can see it and use it by pixel.
 *
 * Only the companion talks to it. It listens on 127.0.0.1, every request but
 * /health carries the token it was started with, and the bot's user cannot
 * open connections to loopback beyond its own ports (`applyEgressRules`).
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const SERVICE_VERSION = 3;
const CHROMIUM = '/usr/bin/chromium';
/** Spark's remote screen: 1280×1024 with an 87px Chrome frame, so the page is 1280×937. */
const VIEWPORT = { width: 1280, height: 937 };
/** The desktop's screen: the whole of Spark's remote screen. */
const SCREEN = { width: 1280, height: 1024 };
const STREAM_FPS = 8;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 8_000;
const TEXT_LIMIT = 8_000;
const SNAPSHOT_LIMIT = 200;
const EXEC_DEFAULT_MS = 120_000;
const EXEC_MIN_MS = 1_000;
const EXEC_MAX_MS = 600_000;
const OUTPUT_LIMIT = 64 * 1024;
const READ_LIMIT = 100_000;
const WRITE_LIMIT = 5 * 1024 * 1024;
/** A piece of a file read as bytes, for a copy between this computer and the user's. */
const BINARY_CHUNK = 3 * 1024 * 1024;
const LIST_LIMIT = 500;
const HELP_TTL_MS = 10 * 60_000;
const SHOTS_KEPT = 300;
const FRAME_INTERVAL_MS = 100;
const OBJECT_GROUP = 'willow';
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.cache', '.npm', 'dist', 'build']);

const log = (...parts) => process.stderr.write(`[computer] ${parts.join(' ')}\n`);
/** When this run of the computer began, on the clock its step pictures carry: older pictures are from an earlier run. */
const STARTED_AT = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------------ */
/* Errors, each with the status the companion maps to a reason               */
/* ------------------------------------------------------------------------ */

class RequestError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const HUMAN_HAS_CONTROL = 'A person has control of this computer, or has been asked to take it. Wait for them to hand it back before acting.';
const humanHasControl = () => new RequestError(HUMAN_HAS_CONTROL, 409, { humanHasControl: true });
const snapshotRequired = () => new RequestError('The person handed the computer back. Look again before acting — a fresh snapshot of the page, or a screenshot of the screen: things may have changed while they had it.', 409, { stale: true, snapshotRequired: true });
const stale = (message) => new RequestError(message, 409, { stale: true });

/* ------------------------------------------------------------------------ */
/* Settings                                                                  */
/* ------------------------------------------------------------------------ */

const readConfig = () => new Promise((resolve, reject) => {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const onData = (chunk) => {
    buffer += decoder.write(chunk);
    const end = buffer.indexOf('\n');
    if (end === -1) return;
    process.stdin.off('data', onData);
    try {
      resolve(JSON.parse(buffer.slice(0, end)));
    } catch (error) {
      reject(error);
    }
  };
  process.stdin.on('data', onData);
  process.stdin.once('end', () => reject(new Error('No settings arrived on stdin.')));
});

const config = await readConfig();
const TOKEN = String(config.token || '');
const PORT = Number(config.port);
const TIME_ZONE = typeof config.timeZone === 'string' && /^[A-Za-z_+\-/0-9]{1,64}$/.test(config.timeZone) ? config.timeZone : 'UTC';
const LOCALE = typeof config.locale === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(config.locale) ? config.locale : 'en-US';
if (TOKEN.length < 32 || !Number.isInteger(PORT) || PORT <= 0) {
  log('refusing to start without a token and a port');
  process.exit(2);
}

/*
 * Whose computer this is: the bot's account, the screen its desktop is on, and
 * the ports it may serve on for its own browser (Linux never hands those out as
 * ephemeral ports). Without them it is a machine of one bot's own, as before
 * the computer was shared.
 */
const USER = typeof config.user === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(config.user) ? config.user : 'dot';
const UID = Number.isInteger(config.uid) && config.uid >= 61000 && config.uid < 62000 ? config.uid : 61000;
const GID = UID;
const DISPLAY_NUMBER = Number.isInteger(config.display) && config.display > 0 && config.display < 1000 ? config.display : 1;
const OWN_PORTS = Array.isArray(config.ports) && config.ports.length === 2 && config.ports.every((port) => Number.isInteger(port) && port >= 61000 && port <= 65535) && config.ports[0] <= config.ports[1]
  ? config.ports
  : [61000, 61999];
const HOME = `/home/${USER}`;
const WORKSPACE = `${HOME}/workspace`;
/** How the bot may write its workspace: as it is, from its home, or as it was before the computer was shared. */
const WORKSPACE_NAMES = [WORKSPACE, '~/workspace', '/home/dot/workspace'];
const DOWNLOADS = `${WORKSPACE}/Downloads`;
const PROFILE = `${HOME}/.config/willow-browser`;
const LAST_PAGE = `${HOME}/.config/willow-last-page`;
const STATE_DIR = USER === 'dot' ? '/var/lib/willow' : `/var/lib/willow/dots/${USER}`;
const SHOTS_DIR = `${STATE_DIR}/shots`;
const SHOTS_INDEX = `${SHOTS_DIR}/index.json`;
const DISPLAY = `:${DISPLAY_NUMBER}`;
const RUNTIME_DIR = `/tmp/willow-${USER}-runtime`;
const XAUTHORITY = `${RUNTIME_DIR}/Xauthority`;

/* ------------------------------------------------------------------------ */
/* Running as the bot                                                        */
/* ------------------------------------------------------------------------ */

const ROOT_GROUPS = [0];
process.setgroups(ROOT_GROUPS);

/**
 * File work on the bot's behalf, with the bot's privileges. The service is root,
 * and a symlink in the workspace could otherwise reach anything the machine can
 * — including the disks of other WSL distros. Synchronous calls only: the
 * identity change applies to every thread of the process while it lasts.
 */
const asDot = (work) => {
  process.setgroups([GID]);
  process.setegid(GID);
  process.seteuid(UID);
  try {
    return work();
  } finally {
    process.seteuid(0);
    process.setegid(0);
    process.setgroups(ROOT_GROUPS);
  }
};

const dotEnv = (extra = {}) => ({
  HOME,
  USER,
  LOGNAME: USER,
  // The ports the bot's own servers may listen on, the only ones on loopback it can reach.
  WILLOW_PORTS: `${OWN_PORTS[0]}-${OWN_PORTS[1]}`,
  SHELL: '/bin/bash',
  PATH: `${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin`,
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  TZ: TIME_ZONE,
  TERM: 'dumb',
  NO_COLOR: '1',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  NPM_CONFIG_PREFIX: `${HOME}/.local`,
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  XDG_CONFIG_HOME: `${HOME}/.config`,
  XDG_CACHE_HOME: `${HOME}/.cache`,
  // Programs with windows that the bot starts from a command open on its desktop, starting it if it is off.
  ...(screenReachable() ? desktopEnv() : {}),
  ...extra,
});

const ensureDotDir = (dir) => asDot(() => fs.mkdirSync(dir, { recursive: true }));

/* ------------------------------------------------------------------------ */
/* Keeping the machine to itself                                             */
/* ------------------------------------------------------------------------ */

/**
 * WSL mounts a few things into every distro that a bot has no business with:
 * the tmpfs every distro shares, the GUI sockets that draw on the user's
 * desktop, and the host's GPU driver store. The mounts are this distro's own,
 * so taking them away here changes nothing for the user's other distros.
 */
const RESOLVER_COPY = '/etc/willow-resolv.conf';
const PRIVATE_WSL_MOUNT = 'willow-wsl';

const detachHostMounts = () => {
  /*
   * WSL keeps the resolver on the tmpfs every distro shares (/mnt/wsl) and
   * links /etc/resolv.conf to it — again whenever a session opens, so on a
   * computer several bots share, a link made after the shared tmpfs went would
   * lead nowhere and take DNS away from all of them. The shared tmpfs goes; a
   * private one takes its place holding only the resolver, so WSL's link
   * always resolves. The first start keeps a copy for the ones after.
   */
  let resolver = '';
  for (const file of ['/etc/resolv.conf', RESOLVER_COPY]) {
    try {
      resolver = fs.readFileSync(file, 'utf8');
      if (/^nameserver\s/m.test(resolver)) break;
    } catch {}
    resolver = '';
  }
  let mounts = '';
  try {
    mounts = fs.readFileSync('/proc/mounts', 'utf8');
  } catch {}
  const privateWsl = mounts.split('\n').some((line) => line.startsWith(`${PRIVATE_WSL_MOUNT} /mnt/wsl `));
  for (const target of ['/tmp/.X11-unix', '/mnt/wslg/distro', '/mnt/wslg/doc', '/mnt/wslg', ...(privateWsl ? [] : ['/mnt/wsl']), '/usr/lib/wsl/drivers', '/usr/lib/wsl/lib', '/usr/lib/wsl']) {
    spawnSync('umount', ['-l', target], { stdio: 'ignore' });
  }
  if (!privateWsl) {
    fs.mkdirSync('/mnt/wsl', { recursive: true });
    const mounted = spawnSync('mount', ['-t', 'tmpfs', '-o', 'mode=0755,size=64k', PRIVATE_WSL_MOUNT, '/mnt/wsl'], { encoding: 'utf8' });
    if (mounted.status !== 0) log('could not give the resolver a place of its own', (mounted.stderr || '').trim());
  }
  try {
    if (resolver) {
      fs.writeFileSync('/mnt/wsl/resolv.conf', resolver, { mode: 0o644 });
      fs.writeFileSync(RESOLVER_COPY, resolver, { mode: 0o644 });
    }
    const link = (() => {
      try {
        return fs.lstatSync('/etc/resolv.conf').isSymbolicLink() ? fs.readlinkSync('/etc/resolv.conf') : null;
      } catch {
        return undefined;
      }
    })();
    if (link === undefined || (link !== null && !fs.existsSync('/etc/resolv.conf'))) {
      fs.rmSync('/etc/resolv.conf', { force: true });
      fs.symlinkSync('/mnt/wsl/resolv.conf', '/etc/resolv.conf');
    } else if (link === null && resolver) {
      fs.writeFileSync('/etc/resolv.conf', resolver, { mode: 0o644 });
    }
  } catch (error) {
    log('could not keep the resolver settings', error?.message);
  }
  // Bots share this machine: each sees its own processes, not the others' (or what their command lines say).
  if (spawnSync('mount', ['-o', 'remount,hidepid=invisible', '/proc'], { stdio: 'ignore' }).status !== 0
    && spawnSync('mount', ['-o', 'remount,hidepid=2', '/proc'], { stdio: 'ignore' }).status !== 0) {
    log('could not hide other users\' processes');
  }
};

const nameservers = () => {
  try {
    return [...fs.readFileSync('/etc/resolv.conf', 'utf8').matchAll(/^nameserver\s+([0-9.]+)\s*$/gm)].map((match) => match[1]);
  } catch {
    return [];
  }
};

/**
 * Every WSL 2 distro shares one network namespace, so loopback here is also the
 * user's other distros, every bot's service and the servers the other bots run,
 * and the private ranges reach the user's network and Windows itself.
 * Connections the bot's user opens — its browser and its commands — may go to
 * the internet, to DNS, and to its own ports on loopback, and nowhere else. The
 * table is this bot's own and matches its user alone, so the other bots' tables
 * and everything else in the namespace are left as they are.
 */
let egress = 'off';
const EGRESS_TABLE = `willow_dot_${UID}`;
const applyEgressRules = () => {
  const dns = nameservers();
  const allowDns = dns.map((ip) => `    ip daddr ${ip} meta l4proto { tcp, udp } th dport 53 accept`).join('\n');
  const ruleset = `table inet ${EGRESS_TABLE}
delete table inet ${EGRESS_TABLE}
table inet ${EGRESS_TABLE} {
  chain output {
    type filter hook output priority 0; policy accept;
    meta skuid != ${UID} accept
    ct state established,related accept
${allowDns}
    ip daddr 127.0.0.0/8 tcp dport ${OWN_PORTS[0]}-${OWN_PORTS[1]} accept
    ip6 daddr ::1 tcp dport ${OWN_PORTS[0]}-${OWN_PORTS[1]} accept
    ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4 } reject
    ip6 daddr { ::/127, ::ffff:0:0/96, 64:ff9b::/96, fc00::/7, fe80::/10, ff00::/8 } reject
  }
}
`;
  const result = spawnSync('nft', ['-f', '-'], { input: ruleset, encoding: 'utf8' });
  egress = result.status === 0 ? 'on' : `unavailable: ${(result.stderr || result.error?.message || 'nft failed').trim().slice(0, 200)}`;
  if (egress !== 'on') log('egress rules not applied:', egress);
};

/**
 * Packages are the one thing a bot may install as root: from Alpine's signed
 * repositories, by name, with no option that could point apk anywhere else.
 * They are installed for every bot on the machine, so none may remove one —
 * another may be using it — and two installing at once take turns. Written at
 * every start, so a machine made from an older base has the current rules.
 */
const APK_WRAPPER = `#!/bin/sh
set -eu
action="\${1:-}"
[ "$#" -gt 0 ] && shift
case "$action" in
  add) ;;
  del) echo "Software cannot be removed from this computer: the user's other bots share it." >&2; exit 2 ;;
  update) exec /sbin/apk --wait 300 update ;;
  search|info) exec /sbin/apk "$action" -- "$@" ;;
  *) echo "usage: apk add|update|search|info <package>..." >&2; exit 2 ;;
esac
names=""
for word in "$@"; do
  case "$word" in
    -q|--quiet|--no-cache|--no-progress|-U|--update-cache|-u|--upgrade) continue ;;
  esac
  if ! printf '%s' "$word" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._+-]*(=[A-Za-z0-9._+-]+)?$'; then
    echo "Not a package name: $word (only package names, and -q or --no-cache, are accepted)" >&2
    exit 2
  fi
  names="$names $word"
done
[ -n "$names" ] || { echo "Name at least one package." >&2; exit 2; }
# shellcheck disable=SC2086
exec /sbin/apk --no-interactive --quiet --wait 300 add -- $names
`;

const APK_FRONT = `#!/bin/sh
if [ "$(id -u)" = "0" ]; then exec /sbin/apk "$@"; fi
exec sudo -n /usr/local/sbin/willow-apk "$@"
`;

const installHelpers = () => {
  const write = (file, text, mode) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
      fs.writeFileSync(file, text, { mode });
      fs.chmodSync(file, mode);
    } catch (error) {
      log('could not write', file, error?.message);
    }
  };
  write('/usr/local/sbin/willow-apk', APK_WRAPPER, 0o755);
  write('/usr/local/bin/apk', APK_FRONT, 0o755);
  // By name, one file a user: a bot's processes carry no supplementary groups for a group rule to match.
  write(`/etc/sudoers.d/willow-apk${USER === 'dot' ? '' : `-${USER}`}`, `${USER} ALL=(root) NOPASSWD: /usr/local/sbin/willow-apk\n`, 0o440);
};

/* ------------------------------------------------------------------------ */
/* Live events for the companion                                             */
/* ------------------------------------------------------------------------ */

const clients = new Set();
let lastActivityAt = Date.now();
const touch = () => {
  lastActivityAt = Date.now();
};

const emit = (type, payload, { droppable = false } = {}) => {
  const line = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of clients) {
    // A watcher that cannot keep up misses frames rather than holding the stream back.
    if (droppable && response.writableLength > 2_000_000) continue;
    response.write(line);
  }
};

/** A program to its end, as root or as the bot, with what it printed. */
const run = (command, args, { asUser = false, env, timeoutMs = 30_000 } = {}) => new Promise((resolve) => {
  const child = spawn(command, args.map(String), {
    ...(asUser ? { uid: UID, gid: GID, cwd: HOME } : {}),
    env: env ?? (asUser ? dotEnv() : process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let done = false;
  const finish = (code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') });
  };
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {}
    finish(-1);
  }, timeoutMs);
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.once('error', () => finish(-1));
  child.once('close', (code) => finish(code ?? -1));
});

/* ------------------------------------------------------------------------ */
/* The desktop                                                               */
/* ------------------------------------------------------------------------ */

const DESKTOP_PACKAGES = ['xvfb', 'xfce4', 'xfce4-terminal', 'mousepad', 'xdotool', 'ffmpeg', 'dbus', 'dbus-x11', 'adwaita-icon-theme', 'xfce4-docklike-plugin', 'picom'];
const DESKTOP_PROGRAMS = ['/usr/bin/Xvfb', '/usr/bin/xfce4-session', '/usr/bin/xdotool', '/usr/bin/ffmpeg', '/usr/bin/dbus-daemon', '/usr/lib/xfce4/panel/plugins/libdocklike.so', '/usr/bin/picom'];
/**
 * The desktop's layout: raised when it changes, so a machine set out by an
 * older service gets the new one once, and keeps what is changed on it after.
 */
const DESKTOP_LAYOUT = 5;
const DESKTOP_LAYOUT_FILE = `${STATE_DIR}/desktop-layout`;
const DESKTOP_SHARE = '/usr/local/share';
/** The dock's corners, as Codex shows its bot's dock (14px on its 87px-high dock, which is 64px here); its buttons fill its height, so their highlight takes the same. */
const DOCK_RADIUS = 10;

/**
 * picom draws the screen in xfwm4's place, as xfwm4 cannot round a window:
 * an app's window has the corners a Windows 11 window has (8px) — not the
 * dock or the desktop, which draw their own, and not menus or tooltips —
 * and none once maximised or full screen. Its shadow is the faint one xfwm4
 * drew (about 7% darker at the edge, gone 10px out).
 */
const PICOM_CONFIG_FILE = `${DESKTOP_SHARE}/willow/picom.conf`;
const PICOM_CONFIG = `backend = "xrender";
vsync = false;
use-damage = true;
fading = false;
shadow = false;
shadow-radius = 10;
shadow-opacity = 0.14;
shadow-offset-x = -10;
shadow-offset-y = -10;
corner-radius = 0;
rules = (
  { match = "window_type = 'normal' || window_type = 'dialog' || window_type = 'utility'"; corner-radius = 8; shadow = true; },
  { match = "fullscreen || _NET_WM_STATE@[*]:32a = '_NET_WM_STATE_MAXIMIZED_VERT' || _NET_WM_STATE@[*]:32a = '_NET_WM_STATE_FULLSCREEN'"; corner-radius = 0; shadow = false; }
);
`;
/** Where the bot's wallpaper lives, and the one machine-wide wallpaper an earlier service drew, which counts as ours. */
const WALLPAPER_DIR = `${HOME}/.local/share/willow`;
const WALLPAPER = `${WALLPAPER_DIR}/wallpaper.svg`;
const SHARED_WALLPAPER = `${DESKTOP_SHARE}/willow/wallpaper.svg`;
const WALLPAPER_PROPERTY = '/backdrop/screen0/monitorscreen/workspace0/last-image';
/** Where the browser's window sits: as on OpenAI's bot's computer, clear of the dock, not maximised. */
const BROWSER_WINDOW = { x: 84, y: 84, width: 1112, height: 854 };
const X_SOCKET = `/tmp/.X11-unix/X${DISPLAY.slice(1)}`;
const DESKTOP_BUS = `${RUNTIME_DIR}/bus`;
const INSTALLING = 'Your computer is installing its desktop, once, after an update. Try again in a minute or two.';
/** What a session starts on demand that a machine with nobody at it must not: they prompt for passwords, or only cost memory. */
const SILENCED_SERVICES = /tumbler|thumbnail|keyring|secrets/i;
const SILENCED_AUTOSTART = ['gnome-keyring-pkcs11', 'gnome-keyring-secrets', 'gnome-keyring-ssh', 'xfce4-power-manager', 'at-spi-dbus-bus'];
const BROWSER_COMMAND = `chromium --user-data-dir=${PROFILE} --no-sandbox --test-type --password-store=basic`;

const desktopEnv = () => ({
  DISPLAY,
  XAUTHORITY,
  XDG_RUNTIME_DIR: RUNTIME_DIR,
  XDG_DATA_HOME: `${HOME}/.local/share`,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${DESKTOP_BUS}`,
  XDG_SESSION_TYPE: 'x11',
  XDG_CURRENT_DESKTOP: 'XFCE',
});

/** The session's own environment: a terminal a person opens there is an ordinary one. */
const sessionEnv = () => {
  const env = { ...dotEnv(), ...desktopEnv() };
  for (const name of ['TERM', 'NO_COLOR', 'PAGER', 'GIT_PAGER']) delete env[name];
  return env;
};

/*
 * What the desktop looks like is OpenAI's bot's computer, as Codex shows it
 * (`computer-preview-64538a5b8034.png`): no desktop icons and no panel along
 * the top, a frosted dock floating at the bottom with the browser, a terminal
 * and files, and the browser in a window clear of the dock; the dock's
 * terminal and folder are drawn after its icons. App windows have Windows 11's
 * rounded corners (`PICOM_CONFIG`). The wallpaper is the bot's
 * own: "Blue Hour", the picture Codex shows for a bot's computer until it has
 * one, in the bot's colour — the page works the colours out and sends them.
 */
/** Blue Hour's colours, in the order the picture uses them: a blue bot's, and anyone's the page sent none for. */
const BLUE_HOUR = ['#181d51', '#124ba4', '#1681e9', '#8cacf5', '#087bfa', '#0869e8', '#25a7fa', '#3696fb', '#f1d8ff', '#d9c7ff', '#b9b9ff', '#91afff', '#24173e'];
const wallpaperColorsOf = (colors) => (Array.isArray(colors) && colors.length === BLUE_HOUR.length && colors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
  ? colors.map((color) => color.toLowerCase())
  : null);
let wallpaperColors = wallpaperColorsOf(config.look?.wallpaper) ?? BLUE_HOUR;

/**
 * The bot's browser in its colour: Codex's browser colours (`dot-wallpaper.ts`,
 * `BROWSER_COLORS`), as the page tints them, worn as a theme extension of the
 * bot's own. A theme set by policy would be every bot's at once.
 */
const BROWSER_COLORS = { frame: '#a2b6ce', toolbar: '#d7e0e9' };
const browserColorsOf = (colors) => (colors && typeof colors === 'object' && [colors.frame, colors.toolbar].every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
  ? { frame: colors.frame.toLowerCase(), toolbar: colors.toolbar.toLowerCase() }
  : null);
let browserColors = browserColorsOf(config.look?.browser) ?? BROWSER_COLORS;
const THEME_DIR = `${WALLPAPER_DIR}/browser-theme`;

const writeBrowserTheme = () => asDot(() => {
  const rgb = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const manifest = `${JSON.stringify({
    manifest_version: 3,
    name: 'Willow bot',
    version: '1.0',
    theme: { colors: { frame: rgb(browserColors.frame), frame_inactive: rgb(browserColors.frame), toolbar: rgb(browserColors.toolbar) } },
  }, null, 2)}\n`;
  const file = path.join(THEME_DIR, 'manifest.json');
  fs.mkdirSync(THEME_DIR, { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== manifest) fs.writeFileSync(file, manifest);
});

/** The same picture the page draws (`features/spark/src/dots/computer/dot-wallpaper.ts`, `dotWallpaperSvg`). */
const wallpaperSvg = (c) => `<svg xmlns='http://www.w3.org/2000/svg' width='3840' height='2160' viewBox='0 0 3840 2160' preserveAspectRatio='xMidYMid slice'><defs>`
  + `<linearGradient id='atmosphere' x1='0.1' y1='0' x2='0.8' y2='1'><stop stop-color='${c[0]}'/><stop offset='0.36' stop-color='${c[1]}'/><stop offset='0.7' stop-color='${c[2]}'/><stop offset='1' stop-color='${c[3]}'/></linearGradient>`
  + `<radialGradient id='cobalt' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(2650 890) rotate(-18) scale(2670 1390)'><stop stop-color='${c[4]}' stop-opacity='0.86'/><stop offset='0.48' stop-color='${c[5]}' stop-opacity='0.56'/><stop offset='1' stop-color='${c[5]}' stop-opacity='0'/></radialGradient>`
  + `<radialGradient id='azure' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(500 1570) rotate(-22) scale(2400 1080)'><stop stop-color='${c[6]}' stop-opacity='0.72'/><stop offset='0.55' stop-color='${c[7]}' stop-opacity='0.36'/><stop offset='1' stop-color='${c[7]}' stop-opacity='0'/></radialGradient>`
  + `<radialGradient id='lavender' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(1520 2570) rotate(8) scale(2660 1630)'><stop stop-color='${c[8]}'/><stop offset='0.28' stop-color='${c[9]}' stop-opacity='0.98'/><stop offset='0.58' stop-color='${c[10]}' stop-opacity='0.72'/><stop offset='0.81' stop-color='${c[11]}' stop-opacity='0.24'/><stop offset='1' stop-color='${c[11]}' stop-opacity='0'/></radialGradient>`
  + `<radialGradient id='indigo' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='1' gradientTransform='translate(-240 -210) rotate(22) scale(2100 1680)'><stop stop-color='${c[12]}' stop-opacity='0.60'/><stop offset='1' stop-color='${c[12]}' stop-opacity='0'/></radialGradient>`
  + `</defs><path fill='url(#atmosphere)' d='M0 0h3840v2160H0z'/><path fill='url(#cobalt)' d='M0 0h3840v2160H0z'/><path fill='url(#azure)' d='M0 0h3840v2160H0z'/><path fill='url(#lavender)' d='M0 0h3840v2160H0z'/><path fill='url(#indigo)' d='M0 0h3840v2160H0z'/></svg>`;

/** The wallpaper in the bot's colours, named after the picture, so the desktop takes a new colour — or a redrawn picture — as a new file. */
const wallpaperFile = () => path.join(WALLPAPER_DIR, `wallpaper-${crypto.createHash('sha1').update(wallpaperSvg(wallpaperColors)).digest('hex').slice(0, 10)}.svg`);
const writeWallpaper = () => asDot(() => {
  const file = wallpaperFile();
  fs.mkdirSync(WALLPAPER_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, wallpaperSvg(wallpaperColors));
  return file;
});

/** A wallpaper the desktop shows that is ours, not a picture someone chose there. */
const isOurWallpaper = (value) => !value || value === SHARED_WALLPAPER || value.startsWith(`${WALLPAPER_DIR}/`);

const dropOtherWallpapers = (keep) => asDot(() => {
  try {
    for (const name of fs.readdirSync(WALLPAPER_DIR)) {
      const file = path.join(WALLPAPER_DIR, name);
      if (/^wallpaper(-[0-9a-f]+)?\.svg$/.test(name) && file !== keep) fs.rmSync(file, { force: true });
    }
  } catch {}
});

/** Before the session starts: the desktop's settings name the bot's wallpaper as it is now, unless a picture of someone's choosing is there. */
const pointDesktopAtWallpaper = () => {
  const wallpaper = writeWallpaper();
  asDot(() => {
    const file = path.join(HOME, '.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml');
    try {
      const xml = fs.readFileSync(file, 'utf8');
      const next = xml.replace(/(<property name="last-image" type="string" value=")([^"]*)(")/g, (whole, before, value, after) => (isOurWallpaper(value) ? `${before}${wallpaper}${after}` : whole));
      if (next !== xml) fs.writeFileSync(file, next);
    } catch {}
  });
  dropOtherWallpapers(wallpaper);
};

/**
 * The bot changed colour: the desktop switches to the new picture, and the
 * browser to the new theme, at once. Changes are taken one at a time, so the
 * last colour is the one that stays.
 */
let looking = Promise.resolve();
const applyLook = async (body) => {
  const colors = wallpaperColorsOf(body?.wallpaper);
  const theme = browserColorsOf(body?.browser);
  if (!colors && !theme) throw new RequestError(`Give the wallpaper's ${BLUE_HOUR.length} colours, or the browser's frame and toolbar.`);
  const next = looking.then(() => takeLook(colors, theme));
  looking = next.catch(() => undefined);
  return next;
};

const takeLook = async (colors, theme) => {
  if (theme && JSON.stringify(theme) !== JSON.stringify(browserColors)) {
    browserColors = theme;
    writeBrowserTheme();
    // Loading the theme again over the old one repaints the open browser in place.
    if (browser.headed && browser.devtools && !browser.devtools.closed) await browser.devtools.send('Extensions.loadUnpacked', { path: THEME_DIR }, undefined, 15_000).catch((error) => log('could not change the browser\'s theme', error?.message));
  }
  if (colors) await setWallpaper(colors);
  return { wallpaper: colors ? wallpaperColors : undefined, browser: browserColors };
};

const setWallpaper = async (colors) => {
  wallpaperColors = colors;
  const file = writeWallpaper();
  if (desktop.status === 'on') {
    const query = (args) => run('/usr/bin/xfconf-query', ['-c', 'xfce4-desktop', '-p', WALLPAPER_PROPERTY, ...args], { asUser: true, env: sessionEnv(), timeoutMs: 5_000 });
    const shown = await query([]);
    const current = shown.code === 0 ? shown.stdout.toString('utf8').trim() : '';
    if (isOurWallpaper(current)) {
      await query(current ? ['-s', file] : ['-n', '-t', 'string', '-s', file]);
      setTimeout(() => dropOtherWallpapers(wallpaperFile()), 5_000).unref();
    }
  } else {
    pointDesktopAtWallpaper();
  }
};

const TERMINAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect x="3" y="3" width="58" height="58" rx="14" fill="#9e9f9d" stroke="#bcbfc5" stroke-width="2.4"/>
  <path d="M16 21 L27.5 31 L16 41" fill="none" stroke="#fefefc" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M33.5 39.5 H46.5" fill="none" stroke="#fefefc" stroke-width="4.5" stroke-linecap="round"/>
</svg>
`;

const FILES_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <path d="M4 13 a7 7 0 0 1 7-7 h13.5 c2.6 0 4 0.9 5.6 2.6 l1.4 1.5 c1.1 1.2 2.1 1.5 3.6 1.5 H53 a7 7 0 0 1 7 7 V51 a7 7 0 0 1-7 7 H11 a7 7 0 0 1-7-7 Z" fill="#53b7f5"/>
  <rect x="6.5" y="17.5" width="51" height="12" rx="2.5" fill="#e3eef1"/>
  <rect x="4" y="25.5" width="56" height="32.5" rx="7" fill="#8fd1f0"/>
</svg>
`;

const dockEntry = ({ name, exec, icon, categories, wmClass }) => `[Desktop Entry]
Version=1.0
Type=Application
Name=${name}
Exec=${exec}
Icon=${icon}
Categories=${categories}
StartupWMClass=${wmClass}
NoDisplay=true
`;

/** Where `chromium` on the desktop asks this service for the bot's browser: a file a request, its pages one a line. */
const BROWSER_REQUESTS = `${WALLPAPER_DIR}/browser-requests`;

/**
 * `chromium` on the machine, ahead of the real one on PATH. A browser started
 * by a command, the dock, the menu or a program opening a link is the bot's
 * own browser, the one this service runs: the wrapper leaves a request with
 * the pages to open and the service opens them there (`browserRequests`), so
 * the browser on the screen always wears the bot's theme and takes a change
 * of colour, and the bot's tools act in it. Asked for another profile, for no
 * window, or with nothing taking the request, it starts Chromium itself, as
 * the bot's own where it can: its profile, its theme, its window where the
 * bot's browser sits, and no warning bar for the flag the machine needs.
 */
const BROWSER_FRONT = `#!/bin/sh
own="$HOME/.config/willow-browser"
requests="$HOME/.local/share/willow/browser-requests"
direct=""
for arg in "$@"; do
  case "$arg" in
    --user-data-dir="$own") ;;
    --user-data-dir=*|--headless*|--dump-dom|--print-to-pdf*|--screenshot*|--version|--help) direct=1 ;;
  esac
done
if [ -z "$direct" ] && [ -n "$DISPLAY" ] && [ -d "$requests" ] && request=$(mktemp "$requests/.XXXXXX" 2>/dev/null); then
  for arg in "$@"; do
    case "$arg" in
      -*) ;;
      *://*|about:*) printf '%s\\n' "$arg" ;;
      *) [ -e "$arg" ] && printf 'file://%s\\n' "$(realpath "$arg")" ;;
    esac
  done > "$request"
  mv "$request" "$request.req"
  tries=0
  while [ -e "$request.req" ] && [ "$tries" -lt 50 ]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  [ -e "$request.req" ] || exit 0
  rm -f "$request.req"
fi
profile="--user-data-dir=$own"
theme=""
[ -f "$HOME/.local/share/willow/browser-theme/manifest.json" ] && theme="--load-extension=$HOME/.local/share/willow/browser-theme"
position="--window-position=${BROWSER_WINDOW.x},${BROWSER_WINDOW.y}"
size="--window-size=${BROWSER_WINDOW.width},${BROWSER_WINDOW.height}"
for arg in "$@"; do
  case "$arg" in
    --user-data-dir="$own") profile="" ;;
    --user-data-dir=*) profile=""; theme="" ;;
    --window-position=*) position="" ;;
    --window-size=*) size="" ;;
    --start-maximized|--start-fullscreen|--kiosk) position=""; size="" ;;
  esac
done
# shellcheck disable=SC2086
exec ${CHROMIUM} --no-sandbox --test-type --password-store=basic --no-first-run --no-default-browser-check $profile $theme $position $size "$@"
`;

/** The machine's own part of the desktop, as root, for every user of it, kept current. */
const writeDesktopAssets = () => {
  const write = (file, text, mode = 0o644) => {
    try {
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, { mode });
      fs.chmodSync(file, mode);
    } catch (error) {
      log('could not write', file, error?.message);
    }
  };
  write('/usr/local/bin/chromium', BROWSER_FRONT, 0o755);
  write('/usr/local/bin/chromium-browser', BROWSER_FRONT, 0o755);
  write(`${DESKTOP_SHARE}/icons/hicolor/scalable/apps/willow-terminal.svg`, TERMINAL_ICON);
  write(`${DESKTOP_SHARE}/icons/hicolor/scalable/apps/willow-files.svg`, FILES_ICON);
  write(`${DESKTOP_SHARE}/applications/willow-terminal.desktop`, dockEntry({ name: 'Terminal', exec: 'xfce4-terminal', icon: 'willow-terminal', categories: 'System;TerminalEmulator;', wmClass: 'Xfce4-terminal' }));
  write(`${DESKTOP_SHARE}/applications/willow-files.desktop`, dockEntry({ name: 'Files', exec: 'thunar %F', icon: 'willow-files', categories: 'System;FileManager;', wmClass: 'Thunar' }));
  write(PICOM_CONFIG_FILE, PICOM_CONFIG);
  // A theme colour set by policy is the whole machine's, and Chromium then refuses each bot's own theme.
  fs.rmSync('/etc/chromium/policies/managed/willow.json', { force: true });
};

const DESKTOP_XFCONF = {
  'xfwm4.xml': `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfwm4" version="1.0">
  <property name="general" type="empty">
    <property name="use_compositing" type="bool" value="false"/>
    <property name="workspace_count" type="int" value="1"/>
    <property name="scroll_workspaces" type="bool" value="false"/>
    <property name="show_dock_shadow" type="bool" value="false"/>
    <property name="placement_mode" type="string" value="center"/>
    <property name="placement_ratio" type="int" value="100"/>
  </property>
</channel>
`,
  // Xvfb's one output is called "screen".
  'xfce4-desktop.xml': `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-desktop" version="1.0">
  <property name="backdrop" type="empty">
    <property name="single-workspace-mode" type="bool" value="true"/>
    <property name="single-workspace-number" type="int" value="0"/>
    <property name="screen0" type="empty">
      <property name="monitorscreen" type="empty">
        <property name="workspace0" type="empty">
          <property name="color-style" type="int" value="0"/>
          <property name="image-style" type="int" value="5"/>
          <property name="last-image" type="string" value="${WALLPAPER}"/>
        </property>
      </property>
    </property>
  </property>
  <property name="desktop-icons" type="empty">
    <property name="style" type="int" value="0"/>
  </property>
</channel>
`,
  // The dock: one panel, its middle `x`/`y` off the bottom edge, as wide as what is on it.
  'xfce4-panel.xml': `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-panel" version="1.0">
  <property name="configver" type="int" value="2"/>
  <property name="panels" type="array">
    <value type="int" value="1"/>
    <property name="dark-mode" type="bool" value="false"/>
    <property name="panel-1" type="empty">
      <property name="position" type="string" value="p=0;x=${SCREEN.width / 2};y=${SCREEN.height - 38}"/>
      <property name="length" type="uint" value="1"/>
      <property name="length-adjust" type="bool" value="true"/>
      <property name="position-locked" type="bool" value="true"/>
      <property name="size" type="uint" value="64"/>
      <property name="icon-size" type="uint" value="44"/>
      <property name="background-style" type="uint" value="1"/>
      <property name="background-rgba" type="array">
        <value type="double" value="1"/>
        <value type="double" value="1"/>
        <value type="double" value="1"/>
        <value type="double" value="0.16"/>
      </property>
      <property name="plugin-ids" type="array">
        <value type="int" value="1"/>
      </property>
    </property>
  </property>
  <property name="plugins" type="empty">
    <property name="plugin-1" type="string" value="docklike"/>
  </property>
</channel>
`,
  'xfce4-session.xml': `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-session" version="1.0">
  <property name="general" type="empty">
    <property name="SaveOnExit" type="bool" value="false"/>
  </property>
  <property name="startup" type="empty">
    <property name="ssh-agent" type="empty">
      <property name="enabled" type="bool" value="false"/>
    </property>
    <property name="gpg-agent" type="empty">
      <property name="enabled" type="bool" value="false"/>
    </property>
  </property>
</channel>
`,
};

/**
 * Settings the desktop starts with. Its layout — xfconf, the dock's apps and
 * look — is written when this service's layout is newer than the machine's,
 * and otherwise only when missing, so changes made on the desktop stay. The
 * rest is the machine's wiring and is kept current: the dock's and the menu's
 * browser open the bot's own profile, so there is one browser on the machine.
 */
const writeDesktopSettings = () => {
  let layout = 1;
  try {
    layout = Number(fs.readFileSync(DESKTOP_LAYOUT_FILE, 'utf8')) || 1;
  } catch {}
  const fresh = layout < DESKTOP_LAYOUT;
  writeDesktopAssets();
  writeDotDesktopSettings(fresh);
  pointDesktopAtWallpaper();
  // A browser that starts on the desktop without this service wears the bot's theme too, not the desktop's white.
  writeBrowserTheme();
  if (!browser.process) useOwnTheme();
  if (!fresh) return;
  try {
    fs.writeFileSync(DESKTOP_LAYOUT_FILE, String(DESKTOP_LAYOUT));
  } catch (error) {
    log('could not record the desktop layout', error?.message);
  }
};

const writeDotDesktopSettings = (fresh) => asDot(() => {
  const put = (relative, text, { keep = false } = {}) => {
    const file = path.join(HOME, relative);
    try {
      if (fs.existsSync(file) && (keep || fs.readFileSync(file, 'utf8') === text)) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    } catch (error) {
      log('could not write', file, error?.message);
    }
  };
  // An older layout's panel plugins would only linger beside the dock.
  if (fresh) fs.rmSync(path.join(HOME, '.config/xfce4/panel'), { recursive: true, force: true });
  for (const [file, text] of Object.entries(DESKTOP_XFCONF)) put(`.config/xfce4/xfconf/xfce-perchannel-xml/${file}`, text, { keep: !fresh });
  put('.config/xfce4/panel/docklike-1.rc', `[user]\npinned=${HOME}/.local/share/applications/chromium.desktop;${DESKTOP_SHARE}/applications/willow-terminal.desktop;${DESKTOP_SHARE}/applications/willow-files.desktop;\n`, { keep: !fresh });
  put('.config/gtk-3.0/gtk.css', `.xfce4-panel.background {
  border-radius: ${DOCK_RADIUS}px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background-color: rgba(255, 255, 255, 0.16);
}
.xfce4-panel button,
.xfce4-panel button:hover,
.xfce4-panel button:active,
.xfce4-panel button:checked {
  border-radius: ${DOCK_RADIUS}px;
}
`, { keep: !fresh });
  for (const name of SILENCED_AUTOSTART) put(`.config/autostart/${name}.desktop`, '[Desktop Entry]\nType=Application\nHidden=true\n');
  let services = [];
  try {
    services = fs.readdirSync('/usr/share/dbus-1/services').filter((name) => SILENCED_SERVICES.test(name));
  } catch {}
  for (const file of services) {
    const name = /^Name=(.+)$/m.exec(fs.readFileSync(path.join('/usr/share/dbus-1/services', file), 'utf8'))?.[1]?.trim();
    if (name) put(`.local/share/dbus-1/services/${file}`, `[D-BUS Service]\nName=${name}\nExec=/bin/false\n`);
  }
  put('.config/xfce4/helpers.rc', 'WebBrowser=willow-browser\nTerminalEmulator=xfce4-terminal\n');
  put('.local/share/xfce4/helpers/willow-browser.desktop', `[Desktop Entry]
NoDisplay=true
Version=1.0
Type=X-XFCE-Helper
X-XFCE-Category=WebBrowser
X-XFCE-Commands=${BROWSER_COMMAND}
X-XFCE-CommandsWithParameter=${BROWSER_COMMAND} "%s"
Icon=chromium
Name=Chromium
`);
  put('.local/share/applications/chromium.desktop', `[Desktop Entry]
Version=1.0
Type=Application
Name=Chromium
GenericName=Web Browser
Exec=${BROWSER_COMMAND} %U
Icon=chromium
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=chromium-browser
`);
  // A session saved on the way out would come back with windows this service did not start.
  fs.rmSync(path.join(HOME, '.cache/sessions'), { recursive: true, force: true });
});

const hasDesktopPrograms = () => DESKTOP_PROGRAMS.every((file) => fs.existsSync(file));

/**
 * The screen's key, in the X authority format: one MIT-MAGIC-COOKIE-1 for this
 * display from any host. Xvfb is started with it, and every client the bot
 * runs finds it through XAUTHORITY. It is one key for the service's life, as a
 * program can read it before the screen starts and connect after.
 */
const SCREEN_COOKIE = crypto.randomBytes(16);
const writeScreenKey = () => {
  const field = (bytes) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const family = Buffer.alloc(2);
  family.writeUInt16BE(0xffff);
  const entry = Buffer.concat([family, field(Buffer.alloc(0)), field(Buffer.from(String(DISPLAY_NUMBER))), field(Buffer.from('MIT-MAGIC-COOKIE-1')), field(SCREEN_COOKIE)]);
  asDot(() => {
    try {
      if (fs.readFileSync(XAUTHORITY).equals(entry)) return;
    } catch {}
    const next = `${XAUTHORITY}.next`;
    fs.rmSync(next, { force: true });
    fs.writeFileSync(next, entry, { mode: 0o600, flag: 'wx' });
    fs.renameSync(next, XAUTHORITY);
  });
};

/**
 * The folders every screen here needs, `/tmp/.X11-unix` and `/tmp/.ICE-unix`:
 * root's, open to all, sticky. Anything a bot put in their place goes first —
 * root would otherwise follow a link to wherever it points.
 */
const prepareSocketDirs = () => {
  for (const dir of ['/tmp/.X11-unix', '/tmp/.ICE-unix']) {
    let stat = null;
    try {
      stat = fs.lstatSync(dir);
    } catch {}
    if (stat && !(stat.isDirectory() && stat.uid === 0)) {
      fs.rmSync(dir, { recursive: true, force: true });
      stat = null;
    }
    if (!stat) fs.mkdirSync(dir, { mode: 0o1777 });
    fs.chmodSync(dir, 0o1777);
  }
};

/**
 * The bot's private folder for its session — the screen's key, its bus — made
 * afresh once a run and kept after, so the key a program read before the
 * screen started is still there. Root only makes it; what goes in it is
 * written as the bot.
 */
let runtimeMade = false;
const prepareRuntime = () => {
  let stat = null;
  try {
    stat = fs.lstatSync(RUNTIME_DIR);
  } catch {}
  if (!runtimeMade || !(stat?.isDirectory() && stat.uid === UID && (stat.mode & 0o777) === 0o700)) {
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
    fs.mkdirSync(RUNTIME_DIR, { mode: 0o700 });
    fs.chmodSync(RUNTIME_DIR, 0o700);
    fs.chownSync(RUNTIME_DIR, UID, GID);
    runtimeMade = true;
  }
  asDot(() => fs.rmSync(DESKTOP_BUS, { force: true }));
  writeScreenKey();
};

/** A machine made from an older base gets its desktop the first time it starts here. */
const installDesktop = async () => {
  for (let attempt = 1; ; attempt += 1) {
    const result = await run('/sbin/apk', ['add', '--no-cache', '--quiet', '--wait', '600', ...DESKTOP_PACKAGES], { timeoutMs: 15 * 60_000 });
    if (result.code === 0 && hasDesktopPrograms()) return;
    if (attempt >= 3) throw new Error(`its packages could not be installed (${result.stderr.trim().split('\n').pop() || `apk exited ${result.code}`})`);
    await sleep(attempt * 15_000);
  }
};

/**
 * A screen of its own: Xvfb, D-Bus and an XFCE session on it, all as the bot.
 * Every WSL distro shares one network namespace, and with it the abstract
 * sockets X and D-Bus listen on by default — other distros could reach this
 * screen — so both listen only on files inside this machine. The other bots
 * here are other users of the same files: the bus lives in the bot's own
 * private folder, and the screen takes only clients that hold its key, which
 * only the bot's user can read.
 */
const desktop = {
  status: 'off',
  problem: '',
  children: new Set(),
  starting: null,
  crashes: [],

  /** Whether the desktop is up, starting it if it is not; false if this machine cannot have one. */
  async ensure() {
    if (this.status === 'on') return true;
    if (this.status === 'unavailable' || shuttingDown) return false;
    if (!this.starting) {
      this.starting = this.start().catch((error) => {
        this.stop();
        screenDoor.close();
        this.status = 'unavailable';
        this.problem = `The desktop could not start: ${error.message}.`;
        log(this.problem);
        publishState();
        return false;
      }).finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  },

  async start() {
    if (!hasDesktopPrograms()) {
      this.status = 'installing';
      publishState();
      log('installing the desktop');
      await installDesktop();
    }
    this.status = 'starting';
    publishState();
    prepareSocketDirs();
    prepareRuntime();
    writeDesktopSettings();
    screenDoor.close();
    for (const stale of [X_SOCKET, `/tmp/.X${DISPLAY.slice(1)}-lock`]) fs.rmSync(stale, { force: true });
    this.spawn('/usr/bin/Xvfb', [DISPLAY, '-screen', '0', `${SCREEN.width}x${SCREEN.height}x24`, '-auth', XAUTHORITY, '-nolisten', 'tcp', '-nolisten', 'local', '-dpi', '96', '-s', '0', '-noreset']);
    await waitFor(() => fs.existsSync(X_SOCKET), 10_000, 'the screen did not come up');
    asDot(() => {
      try {
        fs.chmodSync(X_SOCKET, 0o600);
      } catch {}
    });
    this.spawn('/usr/bin/dbus-daemon', ['--session', '--nofork', '--nopidfile', `--address=unix:path=${DESKTOP_BUS}`]);
    await waitFor(() => fs.existsSync(DESKTOP_BUS), 5_000, 'its message bus did not start');
    // Before the session, so every window is drawn with its corners from the first; without it the screen works, square.
    this.spawn('/usr/bin/picom', ['--config', PICOM_CONFIG_FILE], { essential: false });
    this.spawn('/usr/bin/xfce4-session', []);
    const shown = async (name) => (await run('/usr/bin/xdotool', ['search', '--classname', name], { asUser: true, env: sessionEnv(), timeoutMs: 3_000 })).code === 0;
    const deadline = Date.now() + 20_000;
    while (!(await shown('xfce4-panel'))) {
      if (Date.now() > deadline) throw new Error('the desktop session did not come up');
      await sleep(250);
    }
    // The panel's window exists before anything is drawn: the desktop behind it, and a moment to paint, make the first picture a real one.
    const drawnBy = Date.now() + 5_000;
    while (!(await shown('xfdesktop')) && Date.now() < drawnBy) await sleep(250);
    await sleep(1_000);
    this.status = 'on';
    this.problem = '';
    log('desktop on');
    publishState();
    if (browser.screencastWanted) screenStream.start();
    return true;
  },

  spawn(program, args, { essential = true } = {}) {
    const child = spawn(program, args, { uid: UID, gid: GID, cwd: HOME, env: sessionEnv(), detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const name = path.basename(program);
    const lines = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      lines.push(...text.split('\n').filter(Boolean).map((line) => line.slice(0, 200)));
      if (lines.length > 20) lines.splice(0, lines.length - 20);
    });
    this.children.add(child);
    child.once('exit', (code, signal) => {
      if (!this.children.delete(child)) return;
      log(`${name} exited`, code ?? '', signal ?? '', lines.slice(-3).join(' | '));
      if (essential && (this.status === 'on' || this.status === 'starting')) this.lost();
    });
    return child;
  },

  /** Part of the desktop ended — a crash, or a person logging out: it all starts again, unless it keeps failing. */
  lost() {
    this.stop();
    this.status = 'off';
    publishState();
    if (shuttingDown) return;
    this.crashes = this.crashes.filter((at) => Date.now() - at < 120_000).concat(Date.now());
    if (this.crashes.length > 3) {
      this.status = 'unavailable';
      this.problem = 'The desktop keeps stopping. Turn the computer off and on again.';
      publishState();
      return;
    }
    setTimeout(() => void this.ensure(), 1_000);
  },

  stop() {
    screenStream.stop();
    const children = [...this.children];
    this.children.clear();
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
    setTimeout(() => {
      for (const child of children) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }
    }, 2_000).unref();
    if (this.status === 'on' || this.status === 'starting') this.status = 'off';
  },
};

const waitFor = async (check, timeoutMs, failure) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(failure);
    await sleep(100);
  }
};

/** The desktop, ready for an action, or a refusal that says why not. */
const desktopReady = async () => {
  if (desktop.status === 'installing') throw new RequestError(INSTALLING, 503);
  if (!(await desktop.ensure())) throw new RequestError(desktop.problem || 'This computer has no desktop.', 503);
};

/**
 * The screen starts when something first needs it: the bot's browser, a look
 * at the screen or an action on it, someone watching — or a program the bot
 * runs that opens a window. For that last one, while the screen is off this
 * service holds the screen's address itself (the bot's alone, as Xvfb's
 * socket is), and a program that connects there starts the screen and is
 * handed through to it once it is up. Commands are told where the screen is
 * only while something of the bot's holds that address.
 */
const screenDoor = {
  server: null,
  ready: false,

  open() {
    if (this.server || desktop.status !== 'off' || shuttingDown) return;
    try {
      prepareSocketDirs();
      prepareRuntime();
      fs.rmSync(X_SOCKET, { force: true });
    } catch (error) {
      log('the screen\'s address could not be held', error?.message);
      return;
    }
    const server = net.createServer({ pauseOnConnect: true }, (program) => void this.handOver(program));
    this.server = server;
    server.on('error', (error) => {
      log('the screen\'s address could not be held', error?.message);
      if (this.server === server) this.close();
    });
    server.listen(X_SOCKET, () => {
      if (this.server !== server) return;
      try {
        fs.chmodSync(X_SOCKET, 0o600);
        fs.chownSync(X_SOCKET, UID, GID);
        this.ready = true;
      } catch (error) {
        log('the screen\'s address could not be made the dot\'s', error?.message);
        this.close();
      }
    });
  },

  close() {
    const server = this.server;
    this.server = null;
    this.ready = false;
    server?.close();
  },

  async handOver(program) {
    program.on('error', () => program.destroy());
    if (!(await desktop.ensure()) || program.destroyed) {
      program.destroy();
      return;
    }
    const screen = net.connect(X_SOCKET);
    screen.on('error', () => program.destroy());
    screen.on('close', () => program.destroy());
    program.on('close', () => screen.destroy());
    screen.once('connect', () => {
      program.pipe(screen);
      screen.pipe(program);
    });
  },
};

/** Whether a program the bot starts can reach its screen — the screen itself, or the address held for it. */
const screenReachable = () => desktop.status === 'on' || (screenDoor.ready && desktop.status !== 'unavailable');

const JPEG_END = Buffer.from([0xff, 0xd9]);
const grabArgs = (extra) => ['-loglevel', 'error', '-nostdin', '-f', 'x11grab', '-draw_mouse', '1', ...extra, '-video_size', `${SCREEN.width}x${SCREEN.height}`, '-i', `${DISPLAY}.0`, '-an', '-f', 'image2pipe', '-c:v', 'mjpeg'];

/** One picture of the whole screen, as base64 JPEG. */
const grabScreen = async (quality = 4) => {
  const result = await run('/usr/bin/ffmpeg', [...grabArgs([]), '-frames:v', '1', '-q:v', quality, '-'], { asUser: true, env: sessionEnv(), timeoutMs: 10_000 });
  return result.code === 0 && result.stdout.length > 0 ? result.stdout.toString('base64') : null;
};

/**
 * The screen as it changes, for whoever watches: ffmpeg reads the display a
 * few times a second and the frames go out as JPEGs. A frame like the one
 * before is not sent again unless a while has passed, so a still screen costs
 * the watcher nothing.
 */
const screenStream = {
  child: null,
  last: null,
  lastHash: '',
  lastSentAt: 0,

  start() {
    if (this.child || desktop.status !== 'on') return;
    const child = spawn('/usr/bin/ffmpeg', [...grabArgs(['-framerate', STREAM_FPS]), '-q:v', '7', '-'].map(String), { uid: UID, gid: GID, cwd: HOME, env: sessionEnv(), detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    this.child = child;
    let pending = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      for (;;) {
        const end = pending.indexOf(JPEG_END, 2);
        if (end === -1) break;
        const frame = pending.subarray(0, end + 2);
        pending = pending.subarray(end + 2);
        if (frame[0] === 0xff && frame[1] === 0xd8) this.frame(frame);
      }
      if (pending.length > 8_000_000) pending = Buffer.alloc(0);
    });
    child.once('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      if (browser.screencastWanted && desktop.status === 'on' && !shuttingDown) setTimeout(() => this.start(), 1_000);
    });
  },

  frame(buffer) {
    const at = Date.now();
    const hash = crypto.createHash('sha1').update(buffer).digest('hex');
    this.last = { data: buffer.toString('base64'), at };
    if (hash === this.lastHash && at - this.lastSentAt < 5_000) return;
    this.lastHash = hash;
    this.lastSentAt = at;
    this.send();
  },

  send() {
    if (this.last) emit('frame', { data: this.last.data, width: SCREEN.width, height: SCREEN.height, at: this.last.at }, { droppable: true });
  },

  stop() {
    const child = this.child;
    this.child = null;
    this.lastHash = '';
    if (child) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
  },
};

/** xdotool on the desktop, as the bot; what it printed, or a refusal. */
const xdotool = async (args, timeoutMs = 10_000) => {
  const result = await run('/usr/bin/xdotool', args, { asUser: true, env: sessionEnv(), timeoutMs });
  if (result.code !== 0) throw new RequestError(`The desktop did not take that${result.stderr.trim() ? `: ${result.stderr.trim().split('\n').pop().slice(0, 200)}` : '.'}`, 502);
  return result.stdout.toString('utf8').trim();
};

const activeWindow = () => xdotool(['getactivewindow', 'getwindowname'], 3_000).catch(() => '');

/** Text as keystrokes. xdotool types a newline as Linefeed, which most programs ignore, so lines are joined with Return. */
const typeText = async (text, delay) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) await xdotool(['key', '--clearmodifiers', 'Return']);
    if (lines[index]) await xdotool(['type', '--clearmodifiers', '--delay', delay, '--', lines[index]], 15_000 + lines[index].length * (delay + 30));
  }
};

/** The browser's window to the front when the bot works in it, so whoever watches sees the work; never over a person's. */
const browserToFront = async () => {
  if (!browser.headed || desktop.status !== 'on') return;
  const wheel = control.get();
  if (wheel.holder !== 'bot' || wheel.requested) return;
  if (/(^| - )Chromium$/.test(await activeWindow())) return;
  await xdotool(['search', '--onlyvisible', '--class', 'chromium', 'windowactivate'], 3_000).catch(() => undefined);
};

/* ------------------------------------------------------------------------ */
/* The wheel: who may drive                                                  */
/* ------------------------------------------------------------------------ */

/**
 * OpenBot's control state machine (`agent-computer/src/control.ts`), kept in
 * memory: a request that outlives this process names a page that is gone, so a
 * restart interrupting it is the honest outcome.
 *
 * A bot asks for help (or a challenge page asks on its behalf); the request
 * waits until a person takes it, cancels it, or it expires. While it waits and
 * while a person holds the wheel, the bot's actions are refused. A person may
 * also take over unasked. Handing back obliges the bot to look again before it
 * changes anything, because the page is whatever the person left.
 */
const control = (() => {
  const data = { holder: 'bot', since: new Date().toISOString(), currentId: null, requests: [], resumeSnapshotRequired: false };
  let secret = null;
  let botActions = 0;
  let expiryTimer = null;
  const now = () => new Date().toISOString();
  const current = () => data.requests.find((request) => request.id === data.currentId);
  const active = (request) => request?.status === 'waiting' || request?.status === 'taken';
  const changed = () => emit('control', get());
  const finish = (request, status, interruption) => {
    request.status = status;
    request.updatedAt = now();
    request.finishedAt = request.updatedAt;
    delete request.expiresAt;
    if (interruption) request.interruption = interruption;
  };
  const expire = () => {
    const request = current();
    if (request?.status === 'waiting' && request.expiresAt && Date.now() > Date.parse(request.expiresAt)) {
      finish(request, 'expired');
      changed();
    }
  };
  const armExpiry = () => {
    clearTimeout(expiryTimer);
    const request = current();
    if (request?.status !== 'waiting' || !request.expiresAt) return;
    expiryTimer = setTimeout(expire, Math.max(0, Date.parse(request.expiresAt) - Date.now()) + 50);
  };
  const keep = () => {
    data.requests = data.requests.filter((request) => request.id === data.currentId || active(request)).concat(data.requests.filter((request) => request.id !== data.currentId && !active(request)).slice(-31));
  };
  function get(requestId) {
    expire();
    const request = requestId ? data.requests.find((entry) => entry.id === requestId) : current();
    if (requestId && !request) throw new RequestError('That request for help was not found.', 404);
    const live = current();
    return {
      holder: data.holder,
      since: data.since,
      requested: live?.status === 'waiting',
      reason: active(live) ? live.reason : undefined,
      request: request ? { ...request } : undefined,
      resumeSnapshotRequired: data.resumeSnapshotRequired,
      ...(secret ? { secretWanted: secret.label, secretRef: secret.ref, secretRequestedAt: secret.requestedAt } : {}),
    };
  }
  const intended = (id) => {
    expire();
    const request = current();
    if (!request || request.id !== id) throw new RequestError('That request is no longer the current one.', 409);
    return request;
  };
  const drain = async () => {
    const deadline = Date.now() + 5_000;
    while (botActions > 0 && Date.now() < deadline) await sleep(50);
  };
  return {
    get,
    requestHelp(reason, source = 'model') {
      expire();
      const existing = current();
      if (active(existing) || data.holder === 'human') return get();
      const at = now();
      const request = {
        id: crypto.randomUUID(),
        reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : 'The bot needs a person to continue.',
        source,
        status: 'waiting',
        createdAt: at,
        updatedAt: at,
        expiresAt: new Date(Date.now() + HELP_TTL_MS).toISOString(),
      };
      data.currentId = request.id;
      data.requests.push(request);
      keep();
      armExpiry();
      changed();
      return get();
    },
    /** A person taking the wheel: the waiting request, or — unasked — a new one of their own. */
    async take(requestId) {
      expire();
      let request = current();
      if (requestId) {
        request = intended(requestId);
        if (request.status === 'taken' && data.holder === 'human') return get();
        if (request.status !== 'waiting') throw new RequestError('That request is no longer waiting for a person.', 409);
      } else if (!active(request)) {
        const at = now();
        request = { id: crypto.randomUUID(), reason: 'The user took over.', source: 'person', status: 'waiting', createdAt: at, updatedAt: at };
        data.currentId = request.id;
        data.requests.push(request);
        keep();
      } else if (request.status === 'taken') {
        return get();
      }
      await drain();
      request.status = 'taken';
      request.updatedAt = now();
      delete request.expiresAt;
      data.holder = 'human';
      data.since = now();
      secret = null;
      clearTimeout(expiryTimer);
      releaseHeldKeys();
      changed();
      return get();
    },
    release(requestId) {
      const request = intended(requestId);
      if (request.status === 'completed' && data.holder === 'bot') return get();
      if (data.holder !== 'human') throw new RequestError('Nobody is holding the computer.', 409);
      finish(request, 'completed');
      data.holder = 'bot';
      data.since = now();
      data.resumeSnapshotRequired = true;
      browser.retireRefs();
      releaseHeldKeys();
      changed();
      return get();
    },
    cancel(requestId) {
      const request = intended(requestId);
      if (request.status === 'cancelled') return get();
      if (request.status !== 'waiting') throw new RequestError('That request is not waiting any more.', 409);
      finish(request, 'cancelled');
      clearTimeout(expiryTimer);
      changed();
      return get();
    },
    interrupt(reason) {
      const request = current();
      if (request && active(request)) finish(request, 'interrupted', reason);
      if (data.holder === 'human') data.resumeSnapshotRequired = true;
      data.holder = 'bot';
      data.since = now();
      secret = null;
      clearTimeout(expiryTimer);
      releaseHeldKeys();
      changed();
    },
    snapshotTaken() {
      if (data.holder === 'bot' && data.resumeSnapshotRequired && !active(current())) {
        data.resumeSnapshotRequired = false;
        changed();
      }
    },
    assertBotMayAct(mutation) {
      expire();
      if (data.holder === 'human' || active(current())) throw humanHasControl();
      if (mutation && data.resumeSnapshotRequired) throw snapshotRequired();
    },
    /** Counts the bot's action in, so a takeover waits for it to finish before the person drives. */
    async admit(mutation, work) {
      this.assertBotMayAct(mutation);
      botActions += 1;
      try {
        return await work();
      } finally {
        botActions -= 1;
      }
    },
    humanMayDrive: () => data.holder === 'human' && botActions === 0,
    /** The field is pinned by its DOM node, not its ref: a later snapshot renumbers refs, and the value must reach this field or none. */
    requestSecret({ label, ref, backendNodeId, targetId }) {
      secret = {
        label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 200) : 'the value this page is asking for',
        ref,
        backendNodeId,
        targetId,
        requestedAt: now(),
      };
      changed();
      return get();
    },
    pendingSecret: () => (secret && Date.now() - Date.parse(secret.requestedAt) < HELP_TTL_MS ? secret : null),
    cancelSecret() {
      if (!secret) return get();
      secret = null;
      changed();
      return get();
    },
    secretSupplied() {
      secret = null;
      changed();
    },
  };
})();

/* ------------------------------------------------------------------------ */
/* DevTools over the pipe                                                    */
/* ------------------------------------------------------------------------ */

class DevTools {
  #nextId = 0;
  #pending = new Map();
  #listeners = new Map();
  #parts = [];
  #decoder = new StringDecoder('utf8');
  closed = false;

  constructor(toBrowser, fromBrowser) {
    this.toBrowser = toBrowser;
    fromBrowser.on('data', (chunk) => this.#receive(this.#decoder.write(chunk)));
    fromBrowser.on('close', () => this.#close());
    fromBrowser.on('error', () => this.#close());
    toBrowser.on('error', () => this.#close());
  }

  #receive(text) {
    let start = 0;
    let end;
    while ((end = text.indexOf('\0', start)) !== -1) {
      this.#parts.push(text.slice(start, end));
      const raw = this.#parts.join('');
      this.#parts = [];
      start = end + 1;
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      this.#dispatch(message);
    }
    if (start < text.length) this.#parts.push(text.slice(start));
  }

  #dispatch(message) {
    if (message.id !== undefined) {
      const waiter = this.#pending.get(message.id);
      if (!waiter) return;
      this.#pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message || `${waiter.method} failed`));
      else waiter.resolve(message.result ?? {});
      return;
    }
    const handlers = this.#listeners.get(message.method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(message.params ?? {}, message.sessionId);
      } catch (error) {
        log('event handler failed', message.method, error?.message);
      }
    }
  }

  #close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.#pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new RequestError('The browser stopped. Try again: it starts again by itself.', 502));
    }
    this.#pending.clear();
    for (const handler of this.#listeners.get('closed') ?? []) handler({});
  }

  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    if (this.closed) return Promise.reject(new RequestError('The browser stopped. Try again: it starts again by itself.', 502));
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RequestError(`The browser did not answer in time (${method}).`, 504));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.toBrowser.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  on(method, handler) {
    let handlers = this.#listeners.get(method);
    if (!handlers) {
      handlers = new Set();
      this.#listeners.set(method, handlers);
    }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }
}

/* ------------------------------------------------------------------------ */
/* The browser                                                               */
/* ------------------------------------------------------------------------ */

const isMainFrame = (page, frameId) => frameId === page.targetId;

/**
 * On Linux Chromium takes its frame from the desktop's GTK theme, which would
 * hide the bot's theme until it loads, and wherever it cannot: the profile is
 * told to use Chromium's own theme instead.
 */
const useOwnTheme = () => asDot(() => {
  const file = path.join(PROFILE, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (!prefs || typeof prefs !== 'object') prefs = {};
  if (prefs.extensions?.theme?.system_theme === 0) return;
  prefs.extensions = { ...prefs.extensions, theme: { ...prefs.extensions?.theme, system_theme: 0 } };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(prefs));
  } catch (error) {
    log('could not set the browser theme', error?.message);
  }
});

const chromiumVersion = () => {
  const result = spawnSync(CHROMIUM, ['--version'], { encoding: 'utf8', env: dotEnv(), uid: UID, gid: GID });
  return /(\d+)\.\d+\.\d+\.\d+/.exec(result.stdout || '')?.[1] || '152';
};

const browser = {
  status: 'stopped',
  process: null,
  devtools: null,
  starting: null,
  headed: false,
  opening: 0,
  pages: new Map(),
  currentId: null,
  snapshotId: 0,
  refs: new Map(),
  notes: [],
  screencastWanted: false,
  screencastSession: null,
  lastFrameAt: 0,
  agentActiveUntil: 0,
  cursor: null,
  userAgent: '',
  major: '',
  stderr: [],
  downloads: new Map(),

  retireRefs() {
    this.snapshotId += 1;
    this.refs = new Map();
  },

  note(text) {
    this.notes.push(text);
    if (this.notes.length > 8) this.notes.shift();
  },

  takeNotes() {
    const notes = this.notes;
    this.notes = [];
    return notes.length ? { notes } : {};
  },

  current() {
    return this.currentId ? this.pages.get(this.currentId) : undefined;
  },

  async ensure() {
    if (this.status === 'running' && this.devtools && !this.devtools.closed && this.current()) return;
    if (desktop.status === 'installing') throw new RequestError(INSTALLING, 503);
    if (!this.starting) {
      this.starting = this.launch().catch((error) => {
        const child = this.process;
        if (child) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }
        this.stopped();
        const detail = this.stderr.slice(-3).join(' | ');
        log('browser failed to start', error?.message, detail);
        throw new RequestError(`The browser could not start${detail ? ` (${detail.slice(0, 300)})` : ''}. Try again in a moment.`, 502);
      }).finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
  },

  async launch() {
    this.status = 'starting';
    publishState();
    // On the desktop the browser is a window there; without one it draws for the pane alone.
    const headed = await desktop.ensure();
    this.headed = headed;
    ensureDotDir(PROFILE);
    ensureDotDir(DOWNLOADS);
    // A browser a person opened from the desktop holds the profile: it gives way to the one the bot drives.
    if (spawnSync('pkill', ['-TERM', '-u', String(UID), '-f', '--', `--user-data-dir=${PROFILE}`]).status === 0) await sleep(1_500);
    if (headed) useOwnTheme();
    for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      try {
        fs.rmSync(path.join(PROFILE, lock), { force: true });
      } catch {}
    }
    this.major = chromiumVersion();
    this.userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${this.major}.0.0.0 Safari/537.36`;
    const args = [
      ...(headed ? [] : ['--headless=new']),
      '--remote-debugging-pipe',
      // The machine is the sandbox: Chromium's own does not start under WSL's kernel here.
      '--no-sandbox',
      // Without it, a window on the desktop carries a warning about the flag above over every page.
      ...(headed ? ['--test-type'] : []),
      // The bot's theme is loaded, and changed, over this pipe (`Extensions.loadUnpacked`), which needs it.
      ...(headed ? ['--enable-unsafe-extension-debugging'] : []),
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--password-store=basic',
      '--mute-audio',
      '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
      `--user-agent=${this.userAgent}`,
      `--lang=${LOCALE}`,
      ...(headed
        ? [`--window-position=${BROWSER_WINDOW.x},${BROWSER_WINDOW.y}`, `--window-size=${BROWSER_WINDOW.width},${BROWSER_WINDOW.height}`, '--hide-crash-restore-bubble', '--noerrdialogs']
        : [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`]),
      'about:blank',
    ];
    const child = spawn(CHROMIUM, args, {
      uid: UID,
      gid: GID,
      cwd: HOME,
      env: dotEnv(),
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.stderr = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      for (const line of text.split('\n')) {
        if (line.trim() && !/dbus|EGL|GPU process|gl_display|ozone|vk_renderer|ANGLE/.test(line)) this.stderr.push(line.slice(0, 300));
      }
      if (this.stderr.length > 40) this.stderr.splice(0, this.stderr.length - 40);
    });
    const devtools = new DevTools(child.stdio[3], child.stdio[4]);
    this.devtools = devtools;
    child.once('exit', (code, signal) => {
      log('browser exited', code ?? '', signal ?? '');
      if (this.process === child) this.stopped();
    });
    devtools.on('closed', () => {
      if (this.devtools === devtools) this.stopped();
    });
    this.wire(devtools);
    await devtools.send('Browser.getVersion', {}, undefined, 20_000);
    if (headed) {
      writeBrowserTheme();
      await devtools.send('Extensions.loadUnpacked', { path: THEME_DIR }, undefined, 15_000).catch((error) => log('could not theme the browser', error?.message));
    }
    await devtools.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true }).catch(() => undefined);
    await devtools.send('Target.setDiscoverTargets', { discover: true });
    const deadline = Date.now() + 10_000;
    while (!this.current() && Date.now() < deadline) await sleep(50);
    if (!this.current()) await this.openPage('about:blank');
    this.status = 'running';
    this.retireRefs();
    if (this.screencastWanted) await this.startScreencast();
    const last = readLastPage();
    if (this.current()?.url === 'about:blank' && (last || headed)) {
      // Installing the theme puts a bar over the first page; the first navigation takes it away.
      if (headed) await sleep(500);
      void devtools.send('Page.navigate', { url: last || 'about:blank' }, this.current().sessionId).catch(() => undefined);
    }
    publishState();
  },

  stopped() {
    this.status = 'stopped';
    this.process = null;
    this.devtools = null;
    this.pages.clear();
    this.currentId = null;
    this.screencastSession = null;
    this.retireRefs();
    publishState();
  },

  async close() {
    const child = this.process;
    if (!child) return;
    try {
      await this.devtools?.send('Browser.close', {}, undefined, 3_000);
    } catch {}
    const exited = new Promise((resolve) => child.once('exit', resolve));
    await Promise.race([exited, sleep(3_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
  },

  async openPage(url) {
    this.opening += 1;
    let targetId;
    try {
      ({ targetId } = await this.devtools.send('Target.createTarget', { url: 'about:blank' }));
    } finally {
      this.opening -= 1;
    }
    const deadline = Date.now() + 5_000;
    while (!this.pages.get(targetId)?.ready && Date.now() < deadline) await sleep(30);
    await this.makeCurrent(targetId);
    if (url !== 'about:blank') await this.devtools.send('Page.navigate', { url }, this.pages.get(targetId)?.sessionId);
    return this.pages.get(targetId);
  },

  async makeCurrent(targetId) {
    if (this.currentId === targetId || !this.pages.has(targetId)) return;
    const previous = this.current();
    this.currentId = targetId;
    this.retireRefs();
    if (this.screencastSession && previous?.sessionId === this.screencastSession) {
      await this.devtools?.send('Page.stopScreencast', {}, previous.sessionId).catch(() => undefined);
      this.screencastSession = null;
    }
    if (this.screencastWanted) await this.startScreencast();
    void this.devtools?.send('Target.activateTarget', { targetId }).catch(() => undefined);
    publishState();
  },

  async attach(info) {
    if (this.pages.has(info.targetId)) return;
    const page = {
      targetId: info.targetId,
      sessionId: null,
      url: info.url || 'about:blank',
      title: info.title || '',
      favicon: '',
      loading: false,
      starts: 0,
      canGoBack: false,
      canGoForward: false,
      openerId: info.openerId,
      loaderId: '',
      lifecycle: new Map(),
      cfMitigated: undefined,
      ready: false,
      createdAt: Date.now(),
    };
    this.pages.set(info.targetId, page);
    try {
      const { sessionId } = await this.devtools.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
      page.sessionId = sessionId;
      await Promise.all([
        this.devtools.send('Page.enable', {}, sessionId),
        this.devtools.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId),
        this.devtools.send('Network.enable', {}, sessionId),
        // A window on the desktop is as large as the window; only a browser without one needs telling.
        ...(this.headed ? [] : [this.devtools.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false }, sessionId)]),
        this.devtools.send('Emulation.setUserAgentOverride', {
          userAgent: this.userAgent,
          acceptLanguage: `${LOCALE},${LOCALE.split('-')[0]};q=0.9`,
          platform: 'Linux x86_64',
          userAgentMetadata: {
            brands: [{ brand: 'Chromium', version: this.major }, { brand: 'Not_A Brand', version: '24' }],
            fullVersionList: [{ brand: 'Chromium', version: `${this.major}.0.0.0` }, { brand: 'Not_A Brand', version: '24.0.0.0' }],
            platform: 'Linux',
            platformVersion: '',
            architecture: 'x86',
            model: '',
            mobile: false,
            bitness: '64',
          },
        }, sessionId),
      ]);
      await this.devtools.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
      page.ready = true;
      const fromCurrent = info.openerId && info.openerId === this.currentId;
      // A tab opened from outside — a command's page handed to the open browser, a person's new tab — is the one in front.
      const fromOutside = !info.openerId && this.status === 'running' && !this.opening;
      if (!this.currentId || fromCurrent || fromOutside) {
        if (fromCurrent) this.note('The page opened a new tab, and you are now on it.');
        await this.makeCurrent(info.targetId);
      }
      await refreshHistory(page);
    } catch (error) {
      log('could not attach to a page', error?.message);
      this.pages.delete(info.targetId);
    }
  },

  wire(devtools) {
    const pageOf = (sessionId) => [...this.pages.values()].find((page) => page.sessionId === sessionId);
    devtools.on('Target.targetCreated', ({ targetInfo }) => {
      if (targetInfo.type === 'page') void this.attach(targetInfo);
    });
    devtools.on('Target.targetInfoChanged', ({ targetInfo }) => {
      const page = this.pages.get(targetInfo.targetId);
      if (!page) return;
      page.url = targetInfo.url;
      page.title = targetInfo.title;
      if (page.targetId === this.currentId) publishState();
    });
    devtools.on('Target.targetDestroyed', ({ targetId }) => {
      if (!this.pages.delete(targetId)) return;
      if (this.currentId !== targetId) return;
      this.currentId = null;
      const next = [...this.pages.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
      if (next) {
        this.note('The tab you were on closed; you are back on the previous one.');
        void this.makeCurrent(next.targetId);
      } else if (this.status === 'running') {
        void this.openPage('about:blank').catch(() => undefined);
      }
    });
    devtools.on('Page.frameStartedLoading', ({ frameId }, sessionId) => {
      const page = pageOf(sessionId);
      if (!page || !isMainFrame(page, frameId)) return;
      page.loading = true;
      page.starts += 1;
      if (page.targetId === this.currentId) publishState();
    });
    devtools.on('Page.frameStoppedLoading', ({ frameId }, sessionId) => {
      const page = pageOf(sessionId);
      if (!page || !isMainFrame(page, frameId)) return;
      page.loading = false;
      void refreshHistory(page).then(() => refreshFavicon(page)).then(() => {
        if (page.targetId === this.currentId) publishState();
      });
    });
    devtools.on('Page.frameNavigated', ({ frame, type }, sessionId) => {
      const page = pageOf(sessionId);
      if (!page || frame.parentId) return;
      page.url = frame.url;
      page.loaderId = frame.loaderId;
      page.favicon = '';
      if (type !== 'BackForwardCacheRestore' && page.targetId === this.currentId) this.retireRefs();
      if (page.targetId === this.currentId) {
        rememberLastPage(frame.url);
        publishState();
      }
    });
    devtools.on('Page.navigatedWithinDocument', ({ frameId, url }, sessionId) => {
      const page = pageOf(sessionId);
      if (!page || !isMainFrame(page, frameId)) return;
      page.url = url;
      void refreshHistory(page).then(() => {
        if (page.targetId === this.currentId) publishState();
      });
    });
    devtools.on('Page.lifecycleEvent', ({ frameId, loaderId, name }, sessionId) => {
      const page = pageOf(sessionId);
      if (!page || !isMainFrame(page, frameId)) return;
      let names = page.lifecycle.get(loaderId);
      if (!names) {
        names = new Set();
        page.lifecycle.set(loaderId, names);
        if (page.lifecycle.size > 20) page.lifecycle.delete(page.lifecycle.keys().next().value);
      }
      names.add(name);
    });
    devtools.on('Network.responseReceived', ({ type, frameId, response }, sessionId) => {
      const page = pageOf(sessionId);
      if (!page || type !== 'Document' || !isMainFrame(page, frameId)) return;
      const headers = Object.fromEntries(Object.entries(response.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
      page.cfMitigated = headers['cf-mitigated'];
    });
    devtools.on('Page.javascriptDialogOpening', ({ type, message }, sessionId) => {
      const accept = type === 'beforeunload';
      void devtools.send('Page.handleJavaScriptDialog', { accept }, sessionId).catch(() => undefined);
      const what = type === 'alert' ? 'an alert' : type === 'beforeunload' ? 'a "leave this page?" prompt' : `a ${type} dialog`;
      this.note(`The page showed ${what}: "${String(message).slice(0, 300)}". It was ${accept ? 'accepted' : 'dismissed'}${type === 'confirm' || type === 'prompt' ? '; if it needs accepting, ask the user to take over' : ''}.`);
    });
    devtools.on('Page.screencastFrame', ({ data, metadata, sessionId: frameSession }, sessionId) => {
      const elapsed = Date.now() - this.lastFrameAt;
      this.lastFrameAt = Date.now();
      emit('frame', { data, width: Math.round(metadata?.deviceWidth || VIEWPORT.width), height: Math.round(metadata?.deviceHeight || VIEWPORT.height), at: Date.now() }, { droppable: true });
      setTimeout(() => {
        void devtools.send('Page.screencastFrameAck', { sessionId: frameSession }, sessionId).catch(() => undefined);
      }, Math.max(0, FRAME_INTERVAL_MS - elapsed));
    });
    devtools.on('Browser.downloadWillBegin', ({ guid, suggestedFilename }) => {
      this.downloads.set(guid, suggestedFilename);
    });
    devtools.on('Browser.downloadProgress', ({ guid, state }) => {
      if (state !== 'completed' && state !== 'canceled') return;
      const name = this.downloads.get(guid) || 'a file';
      this.downloads.delete(guid);
      this.note(state === 'completed' ? `The browser downloaded ${name} into Downloads/ in your workspace.` : `A download of ${name} was cancelled.`);
    });
  },

  /** The page alone, for a pane with no desktop to show: on the desktop, the screen stream shows the window. */
  async startScreencast() {
    const page = this.current();
    if (this.headed || !page?.sessionId || !this.devtools || this.screencastSession === page.sessionId) return;
    this.screencastSession = page.sessionId;
    await this.devtools.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 }, page.sessionId).catch(() => {
      this.screencastSession = null;
    });
    // A still page sends no frames: the first look comes from a screenshot.
    void captureJpeg(page, 60).then((data) => {
      if (data) emit('frame', { data, width: VIEWPORT.width, height: VIEWPORT.height, at: Date.now() }, { droppable: true });
    });
  },

  async stopScreencast() {
    const session = this.screencastSession;
    this.screencastSession = null;
    if (session) await this.devtools?.send('Page.stopScreencast', {}, session).catch(() => undefined);
  },
};

const readLastPage = () => {
  try {
    const url = fs.readFileSync(LAST_PAGE, 'utf8').trim();
    return /^https?:\/\//.test(url) ? url : '';
  } catch {
    return '';
  }
};

let lastPageTimer = null;
const rememberLastPage = (url) => {
  if (!/^https?:\/\//.test(url)) return;
  clearTimeout(lastPageTimer);
  lastPageTimer = setTimeout(() => {
    try {
      asDot(() => fs.writeFileSync(LAST_PAGE, url));
    } catch {}
  }, 1_000);
};

const refreshHistory = async (page) => {
  try {
    const { currentIndex, entries } = await browser.devtools.send('Page.getNavigationHistory', {}, page.sessionId, 5_000);
    page.canGoBack = currentIndex > 0;
    page.canGoForward = currentIndex < entries.length - 1;
    return { currentIndex, entries };
  } catch {
    return null;
  }
};

const evaluate = async (page, expression, timeoutMs = 10_000) => {
  const { result, exceptionDetails } = await browser.devtools.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page.sessionId, timeoutMs);
  if (exceptionDetails) throw new RequestError(exceptionDetails.exception?.description?.split('\n')[0] || 'The page could not be read.', 502);
  return result?.value;
};

const refreshFavicon = async (page) => {
  try {
    page.favicon = (await evaluate(page, `(() => { const link = document.querySelector('link[rel~="icon"]'); return link ? link.href : (location.protocol.startsWith('http') ? location.origin + '/favicon.ico' : ''); })()`, 3_000)) || '';
  } catch {
    page.favicon = '';
  }
};

const captureJpeg = async (page, quality) => {
  try {
    const { data } = await browser.devtools.send('Page.captureScreenshot', { format: 'jpeg', quality }, page.sessionId, 10_000);
    return data;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------------ */
/* What the pane shows                                                       */
/* ------------------------------------------------------------------------ */

let stateTimer = null;
const publishState = () => {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    emit('state', screenState());
  }, 60);
};

const screenState = () => {
  const page = browser.current();
  return {
    // What the pane draws: the whole desktop, or — on a machine that cannot have one — the page in a Chrome frame.
    display: desktop.status === 'unavailable' ? 'browser' : 'desktop',
    desktop: desktop.status,
    ...(desktop.problem ? { desktopProblem: desktop.problem } : {}),
    browser: browser.status,
    url: page?.url ?? '',
    title: page?.title ?? '',
    favicon: page?.favicon ?? '',
    loading: Boolean(page?.loading),
    canGoBack: Boolean(page?.canGoBack),
    canGoForward: Boolean(page?.canGoForward),
    tabs: browser.pages.size,
    agentActive: Date.now() < browser.agentActiveUntil,
    cursor: browser.cursor,
    startedAt: STARTED_AT,
  };
};

const showCursor = (point) => {
  browser.cursor = { x: Math.round(point.x), y: Math.round(point.y), at: Date.now() };
  emit('cursor', browser.cursor);
  if (browser.headed && desktop.status === 'on') void pointAt(point);
};

/** On the desktop the pane shows the real pointer, so it goes where the bot acts on the page. */
const pointAt = async (point) => {
  const page = browser.current();
  if (!page) return;
  try {
    const origin = await evaluate(page, '({ x: screenX + (outerWidth - innerWidth) / 2, y: screenY + outerHeight - innerHeight - (outerWidth - innerWidth) / 2 })', 2_000);
    await xdotool(['mousemove', Math.round(origin.x + point.x), Math.round(origin.y + point.y)], 3_000);
  } catch {}
};

/** The bot's actions mark the screen busy, so the pane can show its pointer. */
const markAgentActive = () => {
  const wasActive = Date.now() < browser.agentActiveUntil;
  browser.agentActiveUntil = Date.now() + 4_000;
  if (!wasActive) publishState();
  setTimeout(publishState, 4_100);
};

/* ------------------------------------------------------------------------ */
/* Step history (the pane's previous/next)                                   */
/* ------------------------------------------------------------------------ */

let shots = [];
let shotSeq = 0;

const loadShots = () => {
  try {
    shots = JSON.parse(fs.readFileSync(SHOTS_INDEX, 'utf8'));
    if (!Array.isArray(shots)) shots = [];
  } catch {
    shots = [];
  }
  shotSeq = shots.reduce((highest, shot) => Math.max(highest, shot.seq || 0), 0);
};

let shotTimer = null;
/**
 * After an action has had a moment to draw: what the bot's step left on
 * screen — the whole desktop when there is one, else the page. A desktop
 * action brings the picture it already took.
 */
const recordShot = (action, picture) => {
  clearTimeout(shotTimer);
  shotTimer = setTimeout(async () => {
    const page = browser.current();
    const onDesktop = desktop.status === 'on';
    if (!onDesktop && !page) return;
    const data = picture ?? (onDesktop ? await grabScreen(6) : await captureJpeg(page, 55));
    if (!data) return;
    const title = onDesktop ? await activeWindow() : page.title;
    shotSeq += 1;
    const shot = { id: `s${shotSeq}`, seq: shotSeq, url: page?.url ?? '', title, at: Date.now(), action, ...(onDesktop ? { display: 'desktop' } : {}) };
    try {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SHOTS_DIR, `${shot.id}.jpg`), Buffer.from(data, 'base64'));
      shots.push(shot);
      for (const old of shots.splice(0, Math.max(0, shots.length - SHOTS_KEPT))) fs.rmSync(path.join(SHOTS_DIR, `${old.id}.jpg`), { force: true });
      fs.writeFileSync(SHOTS_INDEX, JSON.stringify(shots));
      emit('shot', shot);
    } catch (error) {
      log('could not keep a step image', error?.message);
    }
  }, picture ? 0 : 400);
};

/* ------------------------------------------------------------------------ */
/* Reading the page                                                          */
/* ------------------------------------------------------------------------ */

/** The first `limit` UTF-16 units of `text`, one fewer when the cut would split a character. */
const cutAt = (text, limit) => {
  const sliced = text.slice(0, limit);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
};

const pageText = async (page, offset = 0) => {
  const raw = (await evaluate(page, '(() => document.body ? document.body.innerText || "" : "")()')) || '';
  const collapsed = String(raw).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const start = Math.max(0, Math.min(offset, collapsed.length));
  const text = cutAt(collapsed.slice(start), TEXT_LIMIT);
  const end = start + text.length;
  return { text, truncated: end < collapsed.length, next: end < collapsed.length ? end : null, length: collapsed.length };
};

const CHALLENGE_SCRIPT = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
  };
  const frames = Array.from(document.querySelectorAll('iframe[src]')).filter((frame) => /(?:google\\.com\\/recaptcha|recaptcha\\.net\\/recaptcha|hcaptcha\\.com\\/|challenges\\.cloudflare\\.com\\/)/i.test(frame.getAttribute('src') || '') && visible(frame));
  const controls = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"], button'));
  const visibleChallengeControl = frames.length > 0 || controls.some((control) => visible(control) && /human|not a robot|verify|captcha/i.test(control.getAttribute('aria-label') || (control.closest('label') && control.closest('label').textContent) || control.textContent || ''));
  return { text: (document.body ? document.body.innerText || '' : '').slice(0, 20000), visibleChallengeControl };
})()`;

/** OpenBot's `classifyChallenge`: a page a person has to clear, or nothing. */
const classifyChallenge = ({ cfMitigated, text, visibleChallengeControl }) => {
  if (String(cfMitigated || '').trim().toLowerCase() === 'challenge') {
    return { kind: 'cloudflare', reason: 'This site is showing a Cloudflare security check. Please complete it in the browser, then hand the computer back.' };
  }
  if (visibleChallengeControl && /verify (?:that )?you (?:are|'re) (?:a )?human|confirm (?:that )?you (?:are|'re) (?:a )?human|i(?:'|’)m not a robot|complete (?:the|this) (?:captcha|security check)|select all (?:images|squares)|prove (?:that )?you (?:are|'re) (?:a )?human/i.test(text)) {
    return { kind: 'visible-challenge', reason: 'This page has a check to prove a human is there. Please complete it in the browser, then hand the computer back.' };
  }
  return undefined;
};

/** Raises a request for help when the page is a challenge, and says so in the result. */
const detectChallenge = async (page) => {
  let signal = { cfMitigated: page.cfMitigated, text: '', visibleChallengeControl: false };
  if (String(page.cfMitigated || '').toLowerCase() !== 'challenge') {
    try {
      signal = { ...signal, ...(await evaluate(page, CHALLENGE_SCRIPT, 5_000)) };
    } catch {
      return undefined;
    }
  }
  const found = classifyChallenge(signal);
  if (!found) return undefined;
  const state = control.requestHelp(found.reason, found.kind);
  return { ...found, requestId: state.request?.id };
};

/* ------------------------------------------------------------------------ */
/* Snapshots and refs                                                        */
/* ------------------------------------------------------------------------ */

const INTERACTIVE_ROLES = new Set(['button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox']);
const CHECKABLE_ROLES = new Set(['checkbox', 'menuitemcheckbox', 'menuitemradio', 'radio', 'switch']);
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton']);
const ROLE_ALIASES = { disclosuretriangle: 'button', menulistoption: 'option', popupbutton: 'button', comboboxgrouping: 'combobox', comboboxmenubutton: 'combobox', comboboxselect: 'combobox', textfield: 'textbox' };

const property = (node, name) => node.properties?.find((entry) => entry.name === name)?.value?.value;

const roleOf = (node) => {
  const raw = String(node.role?.value || '').toLowerCase();
  const role = ROLE_ALIASES[raw] || raw;
  if ((role === 'generic' || role === 'group' || role === 'paragraph' || role === 'section') && property(node, 'editable') === 'richtext' && property(node, 'focusable')) return 'textbox';
  return role;
};

const textOf = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

const describeRef = (entry) => `The ${entry.role}${entry.name ? ` "${entry.name}"` : ''}`;

const snapshot = async () => {
  await browser.ensure();
  const page = browser.current();
  browser.retireRefs();
  const snapshotId = browser.snapshotId;
  const before = control.get();
  const { nodes = [] } = await browser.devtools.send('Accessibility.getFullAXTree', {}, page.sessionId, 20_000);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => !node.parentId || !byId.has(node.parentId)) ?? nodes[0];
  const ordered = [];
  const stack = root ? [{ node: root, inPopup: false }] : [];
  while (stack.length) {
    const { node, inPopup } = stack.pop();
    const popup = inPopup || String(node.role?.value || '') === 'MenuListPopup';
    ordered.push({ node, inPopup: popup });
    const children = (node.childIds || []).map((id) => byId.get(id)).filter(Boolean);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ node: children[index], inPopup: popup });
  }
  const elements = [];
  let truncated = false;
  for (const { node, inPopup } of ordered) {
    if (node.ignored || !node.backendDOMNodeId) continue;
    const role = roleOf(node);
    if (!INTERACTIVE_ROLES.has(role)) continue;
    // A closed <select>'s options: the combobox carries its value, and typing into it chooses one.
    if (role === 'option' && inPopup) continue;
    if (elements.length >= SNAPSHOT_LIMIT) {
      truncated = true;
      break;
    }
    const element = { ref: `e${elements.length + 1}`, role, name: cutAt(textOf(node.name?.value), 200) };
    const value = VALUE_ROLES.has(role) ? textOf(node.value?.value) : '';
    if (value) element.value = cutAt(value, 200);
    if (property(node, 'disabled') === true) element.disabled = true;
    const checked = property(node, 'checked');
    if (checked !== undefined) element.checked = checked === 'true' || checked === true;
    else if (CHECKABLE_ROLES.has(role)) element.checked = false;
    if ((role === 'tab' || role === 'option') && property(node, 'selected') === true) element.selected = true;
    if (property(node, 'expanded') !== undefined && (role === 'button' || role === 'combobox' || role === 'menuitem')) element.expanded = property(node, 'expanded') === true;
    browser.refs.set(element.ref, { backendNodeId: node.backendDOMNodeId, role, name: element.name });
    elements.push(element);
  }
  await maskSensitiveValues(page, elements);
  if (browser.snapshotId === snapshotId && before.holder === 'bot' && !before.requested) control.snapshotTaken();
  return { snapshotId, url: page.url, title: page.title, elements, truncated };
};

/** Values of password, card and one-time-code fields, and of anything a person typed a secret into, never leave the page. */
const maskSensitiveValues = async (page, elements) => {
  await Promise.all(elements.filter((element) => element.value && (element.role === 'textbox' || element.role === 'searchbox' || element.role === 'combobox')).map(async (element) => {
    const entry = browser.refs.get(element.ref);
    try {
      const { node } = await browser.devtools.send('DOM.describeNode', { backendNodeId: entry.backendNodeId }, page.sessionId, 5_000);
      const attributes = {};
      for (let index = 0; index + 1 < (node.attributes || []).length; index += 2) attributes[node.attributes[index].toLowerCase()] = node.attributes[index + 1];
      const sensitive = attributes.type === 'password' || 'data-willow-secret' in attributes || /cc-|one-time-code|password/i.test(attributes.autocomplete || '');
      if (sensitive) element.value = '••••••';
    } catch {}
  }));
};

const resolveRef = async (ref, snapshotId) => {
  if (typeof ref !== 'string' || !ref.trim()) throw new RequestError('Give the "ref" of an element from your most recent snapshot.');
  if (snapshotId !== undefined && snapshotId !== null && Number(snapshotId) !== browser.snapshotId) {
    throw stale(`That list of elements is out of date: it was taken for snapshot ${snapshotId} and the page is now at ${browser.snapshotId}. Take a new snapshot and use the refs from it.`);
  }
  const entry = browser.refs.get(ref.trim());
  if (!entry) throw stale(`Nothing on this page has the ref ${ref}. Take a new snapshot and use the refs it returns.`);
  const page = browser.current();
  if (!page) throw stale('The page that snapshot came from is gone. Take a new snapshot.');
  try {
    const { object } = await browser.devtools.send('DOM.resolveNode', { backendNodeId: entry.backendNodeId, objectGroup: OBJECT_GROUP }, page.sessionId, 5_000);
    if (!object?.objectId) throw new Error('gone');
    return { page, entry, objectId: object.objectId };
  } catch {
    throw stale(`${describeRef(entry)} is no longer on the page. Take a new snapshot.`);
  }
};

const callOn = async (page, objectId, fn, args = []) => {
  const { result, exceptionDetails } = await browser.devtools.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: fn.toString(),
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
    awaitPromise: true,
  }, page.sessionId, 10_000);
  if (exceptionDetails) throw new RequestError(exceptionDetails.exception?.description?.split('\n')[0] || 'That did not work on the page.', 502);
  return result?.value;
};

const releaseObjects = (page) => {
  void browser.devtools?.send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }, page.sessionId).catch(() => undefined);
};

/* Runs in the page, bound to the element. */
function centreOf() {
  this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const bounds = this.getBoundingClientRect();
  if (bounds.width <= 0 && bounds.height <= 0) return null;
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  const hit = document.elementFromPoint(x, y);
  const reaches = !hit || hit === this || this.contains(hit) || hit.contains(this) || (hit.tagName === 'LABEL' && hit.control === this);
  let cover = '';
  if (!reaches) cover = (hit.getAttribute('aria-label') || hit.textContent || hit.tagName).trim().replace(/\s+/g, ' ').slice(0, 80);
  return { x, y, cover };
}

function kindOf() {
  if (this.tagName === 'SELECT') return 'select';
  if (this.tagName === 'INPUT' && this.type === 'file') return 'file';
  return 'text';
}

function focusAndSelect() {
  this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  this.focus();
  try {
    if ((this.tagName === 'INPUT' || this.tagName === 'TEXTAREA') && typeof this.select === 'function') {
      this.select();
      return 'field';
    }
  } catch {}
  if (this.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(this);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return 'editable';
  }
  return 'other';
}

function chooseOption(wanted) {
  const target = String(wanted).trim().toLowerCase();
  const options = Array.from(this.options);
  const match = options.find((option) => option.label.trim().toLowerCase() === target || option.value.trim().toLowerCase() === target)
    || options.find((option) => option.label.trim().toLowerCase().includes(target));
  if (!match) return { chosen: null, options: options.slice(0, 30).map((option) => option.label.trim()) };
  this.value = match.value;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { chosen: match.label.trim() };
}

function markSecret() {
  this.setAttribute('data-willow-secret', '');
}

/* ------------------------------------------------------------------------ */
/* Input                                                                     */
/* ------------------------------------------------------------------------ */

const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Insert: { code: 'Insert', keyCode: 45 },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, { code: `F${index + 1}`, keyCode: 112 + index }])),
};
const KEY_ALIASES = { esc: 'Escape', escape: 'Escape', return: 'Enter', enter: 'Enter', tab: 'Tab', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', del: 'Delete', delete: 'Delete', backspace: 'Backspace', space: ' ', spacebar: ' ', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert' };
const MODIFIERS = { alt: { bit: 1, key: 'Alt', code: 'AltLeft', keyCode: 18 }, control: { bit: 2, key: 'Control', code: 'ControlLeft', keyCode: 17 }, ctrl: { bit: 2, key: 'Control', code: 'ControlLeft', keyCode: 17 }, meta: { bit: 4, key: 'Meta', code: 'MetaLeft', keyCode: 91 }, cmd: { bit: 4, key: 'Meta', code: 'MetaLeft', keyCode: 91 }, command: { bit: 4, key: 'Meta', code: 'MetaLeft', keyCode: 91 }, shift: { bit: 8, key: 'Shift', code: 'ShiftLeft', keyCode: 16 } };

/** `Enter`, `Tab`, `a`, `Control+A`, `Shift+Tab`: what Playwright's `press` accepts. */
const parseKey = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) throw new RequestError('Give the "key" to press, such as Enter, Tab or Escape.');
  const parts = text === '+' ? ['+'] : text.split('+').map((part) => part.trim()).filter(Boolean);
  const name = parts.pop();
  let modifiers = 0;
  const held = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) throw new RequestError(`"${part}" is not a modifier key; use Control, Shift, Alt or Meta.`);
    modifiers |= modifier.bit;
    held.push(modifier);
  }
  const canonical = KEYS[name] ? name : KEY_ALIASES[name.toLowerCase()];
  let key;
  if (canonical) {
    key = { key: canonical, ...KEYS[canonical] };
  } else if ([...name].length === 1) {
    const upper = name.toUpperCase();
    const shifted = (modifiers & 8) !== 0;
    const char = shifted ? upper : name;
    key = {
      key: char,
      code: /[a-z]/i.test(name) ? `Key${upper}` : /\d/.test(name) ? `Digit${name}` : '',
      keyCode: /[a-z\d]/i.test(name) ? upper.charCodeAt(0) : 0,
      text: char,
    };
  } else {
    throw new RequestError(`"${name}" is not a key this computer knows. Use a key name such as Enter, Tab, Escape, ArrowDown or a single character.`);
  }
  // A shortcut types nothing.
  if (modifiers & 7) delete key.text;
  return { key, modifiers, held };
};

const pressKey = async (page, raw) => {
  const { key, modifiers, held } = parseKey(raw);
  const send = (params) => browser.devtools.send('Input.dispatchKeyEvent', params, page.sessionId, 10_000);
  let down = 0;
  for (const modifier of held) {
    down |= modifier.bit;
    await send({ type: 'rawKeyDown', key: modifier.key, code: modifier.code, windowsVirtualKeyCode: modifier.keyCode, modifiers: down });
  }
  await send({ type: key.text ? 'keyDown' : 'rawKeyDown', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode, modifiers, ...(key.text ? { text: key.text, unmodifiedText: key.text } : {}) });
  await send({ type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode, modifiers });
  for (const modifier of held.reverse()) {
    down &= ~modifier.bit;
    await send({ type: 'keyUp', key: modifier.key, code: modifier.code, windowsVirtualKeyCode: modifier.keyCode, modifiers: down });
  }
  return key.key;
};

const mouse = (page, params) => browser.devtools.send('Input.dispatchMouseEvent', params, page.sessionId, 10_000);

const clickAt = async (page, x, y) => {
  await mouse(page, { type: 'mouseMoved', x, y, buttons: 0 });
  await mouse(page, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await mouse(page, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

const parseScroll = (raw, fallback) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 20_000) throw new RequestError('"deltaY" must be a number of pixels between -20000 and 20000.');
  return value;
};

/**
 * Gives a click or a key a moment to have consequences, and waits out a
 * navigation it started — until the new document has loaded enough to read,
 * not until a page that never stops loading (ads, streams) says it is done.
 */
const settle = async (page, startsBefore, loaderBefore = page.loaderId) => {
  await sleep(150);
  if (browser.current() === page && page.starts === startsBefore && !page.loading) return;
  const started = Date.now();
  while (Date.now() - started < SETTLE_TIMEOUT_MS) {
    const latest = browser.current();
    if (!latest || !latest.loading) return;
    const committed = latest !== page || latest.loaderId !== loaderBefore;
    if (committed && latest.lifecycle.get(latest.loaderId)?.has('DOMContentLoaded')) return;
    await sleep(100);
  }
};

/* ------------------------------------------------------------------------ */
/* The bot's browser actions                                                 */
/* ------------------------------------------------------------------------ */

const parseUrl = (raw) => {
  const input = String(raw ?? '').trim();
  if (!input) throw new RequestError('Give the "url" to open.');
  if (input === 'about:blank') return input;
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input) || /^(about|data|file|javascript|chrome|view-source|blob):/i.test(input);
  const candidate = hasScheme ? input : `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(input) ? 'http' : 'https'}://${input}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new RequestError(`"${input}" is not a web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RequestError('Only http and https addresses can be opened.');
  return url.href;
};

const waitForLoad = async (page, loaderId) => {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const names = page.lifecycle.get(loaderId);
    if (names?.has('DOMContentLoaded')) break;
    if (!browser.pages.has(page.targetId)) throw new RequestError('The tab closed while it was loading.', 502);
    await sleep(80);
  }
  if (!page.lifecycle.get(loaderId)?.has('DOMContentLoaded')) throw new RequestError(`The page did not finish loading within ${NAVIGATION_TIMEOUT_MS / 1000} seconds.`, 504);
  // A little longer for what the page draws after it has loaded, never long.
  const settleBy = Date.now() + 3_000;
  while (Date.now() < settleBy) {
    const names = page.lifecycle.get(loaderId);
    if (names?.has('networkAlmostIdle') || names?.has('networkIdle')) break;
    await sleep(100);
  }
};

const botNavigate = (body) => control.admit(true, async () => {
  const url = parseUrl(body?.url);
  const startedAt = Date.now();
  await browser.ensure();
  await browserToFront();
  const page = browser.current();
  page.cfMitigated = undefined;
  markAgentActive();
  const result = await browser.devtools.send('Page.navigate', { url }, page.sessionId, NAVIGATION_TIMEOUT_MS);
  if (result.errorText) throw new RequestError(`That address could not be opened: ${result.errorText}.`, 502);
  if (result.loaderId) await waitForLoad(page, result.loaderId);
  browser.retireRefs();
  const current = browser.current();
  const extract = await pageText(current);
  const challenge = await detectChallenge(current);
  recordShot('navigate');
  return { url: current.url, title: current.title, ...extract, elapsedMs: Date.now() - startedAt, ...(challenge ? { challenge } : {}), ...browser.takeNotes() };
});

const botRead = async (query) => {
  await browser.ensure();
  const page = browser.current();
  const offset = Math.max(0, Number(query.get('offset')) || 0);
  const extract = await pageText(page, offset);
  const challenge = offset ? undefined : await detectChallenge(page);
  return { url: page.url, title: page.title, ...extract, ...(challenge ? { challenge } : {}), ...browser.takeNotes() };
};

const botSnapshot = async () => {
  const result = await snapshot();
  const challenge = await detectChallenge(browser.current());
  return { ...result, ...(challenge ? { challenge } : {}), ...browser.takeNotes() };
};

const botClick = (body) => control.admit(true, async () => {
  await browser.ensure();
  await browserToFront();
  const { page, entry, objectId } = await resolveRef(body?.ref, body?.snapshotId);
  markAgentActive();
  try {
    const point = await callOn(page, objectId, centreOf);
    if (!point) throw new RequestError(`${describeRef(entry)} has no size on the page, so it cannot be clicked. It may be hidden: take a new snapshot.`, 409, { stale: true });
    const starts = page.starts;
    showCursor(point);
    await clickAt(page, point.x, point.y);
    await settle(page, starts);
    recordShot('click');
    return { action: 'click', ref: body.ref, element: { role: entry.role, name: entry.name }, url: browser.current()?.url ?? page.url, ...(point.cover ? { covered: `Something else was on top of it ("${point.cover}"), so the click may have landed there instead.` } : {}), ...browser.takeNotes() };
  } finally {
    releaseObjects(page);
  }
});

/** Files to upload: one workspace path per line. */
const workspaceFiles = (raw) => String(raw).split('\n').map((part) => part.trim()).filter(Boolean).map((part) => resolveWorkspacePath(part).absolute);

const botType = (body) => control.admit(true, async () => {
  await browser.ensure();
  await browserToFront();
  if (typeof body?.text !== 'string') throw new RequestError('Give the "text" to enter.');
  const { page, entry, objectId } = await resolveRef(body.ref, body.snapshotId);
  markAgentActive();
  try {
    const kind = await callOn(page, objectId, kindOf);
    const point = await callOn(page, objectId, centreOf).catch(() => null);
    if (point) showCursor(point);
    let chosen;
    if (kind === 'select') {
      const outcome = await callOn(page, objectId, chooseOption, [body.text]);
      if (!outcome?.chosen) throw new RequestError(`${describeRef(entry)} has no option "${body.text}". Its options: ${(outcome?.options || []).join(', ') || 'none'}.`, 409);
      chosen = outcome.chosen;
    } else if (kind === 'file') {
      const files = workspaceFiles(body.text);
      if (!files.length) throw new RequestError('Give the path of a file in your workspace to upload.');
      for (const file of files) {
        if (!asDot(() => fs.existsSync(file))) throw new RequestError(`${path.relative(WORKSPACE, file)} is not in your workspace.`, 404);
      }
      await browser.devtools.send('DOM.setFileInputFiles', { files, backendNodeId: entry.backendNodeId }, page.sessionId, 10_000);
    } else {
      await callOn(page, objectId, focusAndSelect);
      if (body.text) await browser.devtools.send('Input.insertText', { text: body.text }, page.sessionId, 10_000);
      else await pressKey(page, 'Delete');
    }
    const starts = page.starts;
    if (body.submit === true) await pressKey(page, 'Enter');
    await settle(page, starts);
    recordShot('type');
    // The text itself is never echoed: what goes into a form is where passwords live.
    return { action: 'type', ref: body.ref, element: { role: entry.role, name: entry.name }, characters: body.text.length, ...(chosen ? { chosen } : {}), submitted: body.submit === true, url: browser.current()?.url ?? page.url, ...browser.takeNotes() };
  } finally {
    releaseObjects(page);
  }
});

const botKey = (body) => control.admit(true, async () => {
  await browser.ensure();
  await browserToFront();
  let page = browser.current();
  parseKey(body?.key);
  markAgentActive();
  if (body?.ref) {
    const resolved = await resolveRef(body.ref, body.snapshotId);
    page = resolved.page;
    await callOn(page, resolved.objectId, function () {
      this.scrollIntoView({ block: 'center', behavior: 'instant' });
      this.focus();
    });
    releaseObjects(page);
  }
  const starts = page.starts;
  const pressed = await pressKey(page, body.key);
  await settle(page, starts);
  recordShot('key');
  return { action: 'key', key: pressed === ' ' ? 'Space' : body.key, ...(body.ref ? { ref: body.ref } : {}), url: browser.current()?.url ?? page.url, ...browser.takeNotes() };
});

const botScroll = (body) => control.admit(true, async () => {
  await browser.ensure();
  await browserToFront();
  const page = browser.current();
  const deltaY = parseScroll(body?.deltaY, 600);
  markAgentActive();
  await mouse(page, { type: 'mouseWheel', x: VIEWPORT.width / 2, y: VIEWPORT.height / 2, deltaX: 0, deltaY });
  await sleep(300);
  const position = await evaluate(page, '(() => { const max = Math.max(0, document.documentElement.scrollHeight - innerHeight); return { y: Math.round(scrollY), max: Math.round(max) }; })()').catch(() => null);
  recordShot('scroll');
  const where = position ? (position.max === 0 ? 'The page does not scroll.' : `Now ${Math.round((position.y / position.max) * 100)}% of the way down the page.`) : undefined;
  return { action: 'scroll', deltaY, url: page.url, ...(where ? { position: where } : {}), ...browser.takeNotes() };
});

const botHistory = (op) => control.admit(true, async () => {
  await browser.ensure();
  await browserToFront();
  const page = browser.current();
  const starts = page.starts;
  if (op === 'reload') {
    await browser.devtools.send('Page.reload', {}, page.sessionId);
  } else {
    const entries = await refreshHistory(page);
    const index = entries ? entries.currentIndex + (op === 'back' ? -1 : 1) : -1;
    const entry = entries?.entries[index];
    if (!entry) throw new RequestError(op === 'back' ? 'There is no page to go back to.' : 'There is no page to go forward to.', 409);
    await browser.devtools.send('Page.navigateToHistoryEntry', { entryId: entry.id }, page.sessionId);
  }
  await settle(page, starts);
  recordShot(op);
  return { action: op, url: browser.current()?.url ?? page.url, ...browser.takeNotes() };
});

/* ------------------------------------------------------------------------ */
/* The bot's desktop actions                                                 */
/* ------------------------------------------------------------------------ */

const XBUTTONS = { left: 1, middle: 2, right: 3 };
const XKEY_NAMES = {
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'space', spacebar: 'space', backspace: 'BackSpace',
  delete: 'Delete', del: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  menu: 'Menu', capslock: 'Caps_Lock', printscreen: 'Print',
  ',': 'comma', '.': 'period', '/': 'slash', ';': 'semicolon', "'": 'apostrophe', '[': 'bracketleft', ']': 'bracketright',
  '-': 'minus', '=': 'equal', '`': 'grave', '\\': 'backslash', '+': 'plus',
};
const XMODIFIERS = { ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', super: 'super', meta: 'super', win: 'super', windows: 'super', cmd: 'super', command: 'super' };
const MODIFIER_KEYS = { ctrl: 'Control_L', shift: 'Shift_L', alt: 'Alt_L', super: 'Super_L' };

const parsePoint = (body, xName = 'x', yName = 'y') => {
  const x = Number(body?.[xName]);
  const y = Number(body?.[yName]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RequestError(`Give "${xName}" and "${yName}": a point on the screen, in pixels from its top left corner.`);
  if (x < 0 || y < 0 || x >= SCREEN.width || y >= SCREEN.height) throw new RequestError(`(${Math.round(x)}, ${Math.round(y)}) is off the screen, which is ${SCREEN.width}×${SCREEN.height} pixels.`);
  return { x: Math.round(x), y: Math.round(y) };
};

/** A key after any modifiers, joined with +, as xdotool names them. */
const parseDesktopKey = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) throw new RequestError('Give the "key" to press: a key name, after any modifiers joined with +.');
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text === '+' ? ['+'] : text.split('+');
  const names = parts.map((part) => part.trim()).filter(Boolean);
  const name = names.pop();
  const modifiers = names.map((part) => {
    const modifier = XMODIFIERS[part.toLowerCase()];
    if (!modifier) throw new RequestError(`"${part}" is not a modifier key; use ctrl, shift, alt or super.`);
    return modifier;
  });
  const lower = name.toLowerCase();
  let key = XKEY_NAMES[lower] ?? XKEY_NAMES[name];
  if (!key && /^f([1-9]|1\d|2[0-4])$/.test(lower)) key = name.toUpperCase();
  if (!key && /^[a-z0-9]$/i.test(name)) key = modifiers.length ? lower : name;
  if (!key && XMODIFIERS[lower]) key = MODIFIER_KEYS[XMODIFIERS[lower]];
  if (!key) throw new RequestError(`"${name}" is not a key this computer knows. Use a key name such as Enter, Escape, Tab, Up or F5, or a single letter or digit.`);
  return [...modifiers, key].join('+');
};

/** The screen a desktop action left, once it has had a moment to draw: for the bot, and for the history. */
const afterDesktopAction = async (action, details) => {
  await sleep(500);
  const [data, active] = await Promise.all([grabScreen(5), activeWindow()]);
  if (data) recordShot(action, data);
  return { action, ...details, ...(active ? { active } : {}), ...(data ? { screenshot: { data, width: SCREEN.width, height: SCREEN.height } } : {}) };
};

const desktopAction = (action, work) => control.admit(true, async () => {
  await desktopReady();
  markAgentActive();
  return afterDesktopAction(action, await work());
});

/** Looking, which a person holding the wheel does not stop; it counts as looking again once they hand it back. */
const desktopScreenshot = async () => {
  await desktopReady();
  const [data, active] = await Promise.all([grabScreen(5), activeWindow()]);
  if (!data) throw new RequestError('The screen could not be captured.', 502);
  control.snapshotTaken();
  return { data, width: SCREEN.width, height: SCREEN.height, ...(active ? { active } : {}) };
};

/** Modifier keys to hold through a click, as a list or joined with +: ctrl, shift, alt, super. */
const parseHeld = (raw) => {
  if (raw === undefined || raw === null || raw === '') return [];
  const names = (Array.isArray(raw) ? raw : String(raw).split('+')).map((part) => String(part).trim().toLowerCase()).filter(Boolean);
  const held = [];
  for (const name of names) {
    const modifier = XMODIFIERS[name];
    if (!modifier) throw new RequestError(`"${name}" is not a key to hold; use ctrl, shift, alt or super.`);
    if (!held.includes(MODIFIER_KEYS[modifier])) held.push(MODIFIER_KEYS[modifier]);
  }
  return held;
};

const desktopClick = (body) => desktopAction('click', async () => {
  const { x, y } = parsePoint(body);
  const button = body?.button === undefined || body.button === null ? 'left' : String(body.button).toLowerCase();
  if (!XBUTTONS[button]) throw new RequestError('"button" is left, right or middle.');
  const clicks = Math.max(1, Math.min(3, Math.round(Number(body?.clicks) || 1)));
  const held = parseHeld(body?.hold);
  const down = held.flatMap((key) => ['keydown', key]);
  const up = [...held].reverse().flatMap((key) => ['keyup', key]);
  await xdotool(['mousemove', x, y, 'sleep', '0.05', ...down, 'click', '--repeat', clicks, '--delay', 80, XBUTTONS[button], ...up]);
  return { x, y, button, clicks, ...(held.length ? { held: held.map((key) => key.replace(/_L$/, '').toLowerCase()) } : {}) };
});

/** The pointer to a point and left there: what shows on hover — a menu, a tooltip — and where it now is. */
const desktopMove = (body) => desktopAction('move', async () => {
  const { x, y } = parsePoint(body);
  await xdotool(['mousemove', x, y]);
  return { x, y };
});

const desktopType = (body) => desktopAction('type', async () => {
  if (typeof body?.text !== 'string' || !body.text) throw new RequestError('Give the "text" to type.');
  if (body.text.length > 5_000) throw new RequestError('Type at most 5,000 characters at a time.');
  await typeText(body.text, 8);
  return { characters: body.text.length };
});

const desktopKey = (body) => desktopAction('key', async () => {
  const combo = parseDesktopKey(body?.key);
  await xdotool(['key', '--clearmodifiers', combo]);
  return { key: combo };
});

const desktopScroll = (body) => desktopAction('scroll', async () => {
  const { x, y } = parsePoint(body);
  const deltaY = parseScroll(body?.deltaY, 0);
  const deltaX = parseScroll(body?.deltaX, 0);
  if (!deltaY && !deltaX) throw new RequestError('Give "deltaY": pixels to scroll down, or up when negative.');
  // A notch of a wheel is about 100 pixels; X scrolls by notches.
  const notches = (delta) => (delta ? Math.max(1, Math.min(50, Math.round(Math.abs(delta) / 100))) : 0);
  const args = ['mousemove', x, y];
  if (deltaY) args.push('click', '--repeat', notches(deltaY), '--delay', 20, deltaY > 0 ? 5 : 4);
  if (deltaX) args.push('click', '--repeat', notches(deltaX), '--delay', 20, deltaX > 0 ? 7 : 6);
  await xdotool(args, 20_000);
  return { x, y, deltaY, deltaX };
});

const desktopDrag = (body) => desktopAction('drag', async () => {
  const from = parsePoint(body);
  const to = parsePoint(body, 'toX', 'toY');
  const middle = { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) };
  await xdotool(['mousemove', from.x, from.y, 'sleep', '0.1', 'mousedown', 1, 'sleep', '0.15', 'mousemove', middle.x, middle.y, 'sleep', '0.1', 'mousemove', to.x, to.y, 'sleep', '0.15', 'mouseup', 1]);
  return { from, to };
});

/* ------------------------------------------------------------------------ */
/* A person at the wheel                                                     */
/* ------------------------------------------------------------------------ */

const requireHuman = () => {
  if (!control.humanMayDrive()) throw new RequestError('Take over the computer before driving it yourself.', 409, { takeControlFirst: true });
};

const MOUSE_TYPES = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased', wheel: 'mouseWheel' };

/** The pane's keys by where they are on the keyboard (`KeyboardEvent.code`), as X names them. */
const CODE_KEYSYMS = {
  Enter: 'Return', NumpadEnter: 'KP_Enter', Backspace: 'BackSpace', Tab: 'Tab', Escape: 'Escape', Space: 'space',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  ShiftLeft: 'Shift_L', ShiftRight: 'Shift_R', ControlLeft: 'Control_L', ControlRight: 'Control_R',
  AltLeft: 'Alt_L', AltRight: 'Alt_R', MetaLeft: 'Super_L', MetaRight: 'Super_R', OSLeft: 'Super_L', OSRight: 'Super_R',
  CapsLock: 'Caps_Lock', ContextMenu: 'Menu', PrintScreen: 'Print', Pause: 'Pause', ScrollLock: 'Scroll_Lock', NumLock: 'Num_Lock',
  Minus: 'minus', Equal: 'equal', BracketLeft: 'bracketleft', BracketRight: 'bracketright', Backslash: 'backslash',
  Semicolon: 'semicolon', Quote: 'apostrophe', Backquote: 'grave', Comma: 'comma', Period: 'period', Slash: 'slash', IntlBackslash: 'less',
  NumpadAdd: 'KP_Add', NumpadSubtract: 'KP_Subtract', NumpadMultiply: 'KP_Multiply', NumpadDivide: 'KP_Divide', NumpadDecimal: 'KP_Decimal',
};

const keysymOf = (code, key) => {
  if (CODE_KEYSYMS[code]) return CODE_KEYSYMS[code];
  let match;
  if ((match = /^Key([A-Z])$/.exec(code))) return match[1].toLowerCase();
  if ((match = /^Digit(\d)$/.exec(code))) return match[1];
  if ((match = /^Numpad(\d)$/.exec(code))) return `KP_${match[1]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return /^[A-Za-z0-9]$/.test(key) ? key.toLowerCase() : null;
};

/** Keys a person is holding down on the desktop, let go of when they stop driving so none stays down. */
const heldKeys = new Set();
const wheelRest = { x: 0, y: 0 };

const releaseHeldKeys = () => {
  if (!heldKeys.size || desktop.status !== 'on') {
    heldKeys.clear();
    return;
  }
  const keys = [...heldKeys];
  heldKeys.clear();
  void xdotool(['keyup', ...keys]).catch(() => undefined);
};

/**
 * A person's mouse and keyboard on the desktop. A character is typed as
 * itself, so it comes out as their own keyboard layout made it; other keys
 * and shortcuts go down and up by name.
 */
const humanDesktopInput = async (kind, body) => {
  const clamp = (value, max) => Math.round(Math.min(Math.max(Number(value) || 0, 0), max - 1));
  if (kind === 'mouse') {
    const x = clamp(body?.x, SCREEN.width);
    const y = clamp(body?.y, SCREEN.height);
    const button = XBUTTONS[body?.button] ?? 1;
    if (body?.type === 'move') await xdotool(['mousemove', x, y]);
    else if (body?.type === 'down') await xdotool(['mousemove', x, y, 'mousedown', button]);
    else if (body?.type === 'up') await xdotool(['mousemove', x, y, 'mouseup', button]);
    else if (body?.type === 'wheel') {
      wheelRest.y += parseScroll(body.deltaY, 0);
      wheelRest.x += parseScroll(body.deltaX, 0);
      const notchesY = Math.trunc(wheelRest.y / 100);
      const notchesX = Math.trunc(wheelRest.x / 100);
      wheelRest.y -= notchesY * 100;
      wheelRest.x -= notchesX * 100;
      const args = ['mousemove', x, y];
      if (notchesY) args.push('click', '--repeat', Math.min(Math.abs(notchesY), 20), '--delay', 10, notchesY > 0 ? 5 : 4);
      if (notchesX) args.push('click', '--repeat', Math.min(Math.abs(notchesX), 20), '--delay', 10, notchesX > 0 ? 7 : 6);
      await xdotool(args);
    } else throw new RequestError('Unknown mouse event.');
    return { ok: true };
  }
  if (kind === 'key') {
    const key = typeof body?.key === 'string' ? body.key.slice(0, 32) : '';
    const keysym = keysymOf(typeof body?.code === 'string' ? body.code : '', key);
    const modifiers = Number(body?.modifiers) || 0;
    if (body?.type === 'keyDown' || body?.type === 'rawKeyDown') {
      // AltGr arrives as Control+Alt: what it makes is a character, not a shortcut.
      const altGr = (modifiers & 3) === 3 && !(modifiers & 4);
      if ([...key].length === 1 && (!(modifiers & 7) || altGr)) {
        await xdotool(['type', ...(altGr ? ['--clearmodifiers'] : []), '--delay', 0, '--', key]);
      } else if (keysym) {
        heldKeys.add(keysym);
        await xdotool(['keydown', keysym]);
      }
      return { ok: true };
    }
    if (body?.type === 'keyUp') {
      if (keysym && heldKeys.delete(keysym)) await xdotool(['keyup', keysym]);
      return { ok: true };
    }
    throw new RequestError('Unknown key event.');
  }
  if (typeof body?.text !== 'string' || body.text.length > 20_000) throw new RequestError('Paste up to 20,000 characters at a time.');
  // Paste arrives while Control is still down: it is let go of for the typing.
  await typeText(body.text, 1);
  return { ok: true };
};

/**
 * A person's mouse and keyboard, by pixel and by key, the way the pane saw
 * them. Nothing typed here is recorded or returned: it goes from their
 * keyboard to the page and stops.
 */
const humanInput = async (kind, body) => {
  requireHuman();
  touch();
  if (desktop.status === 'on' && (kind === 'mouse' || kind === 'key' || kind === 'text')) return humanDesktopInput(kind, body);
  await browser.ensure();
  const page = browser.current();
  const clamp = (value, max) => Math.min(Math.max(Number(value) || 0, 0), max - 1);
  if (kind === 'mouse') {
    const type = MOUSE_TYPES[body?.type];
    if (!type) throw new RequestError('Unknown mouse event.');
    const params = { type, x: clamp(body.x, VIEWPORT.width), y: clamp(body.y, VIEWPORT.height), modifiers: Number(body.modifiers) || 0, buttons: Number(body.buttons) || 0 };
    if (type === 'mousePressed' || type === 'mouseReleased') {
      params.button = ['left', 'middle', 'right'].includes(body.button) ? body.button : 'left';
      params.clickCount = Math.max(1, Math.min(3, Number(body.clickCount) || 1));
    }
    if (type === 'mouseWheel') {
      params.deltaX = parseScroll(body.deltaX, 0);
      params.deltaY = parseScroll(body.deltaY, 0);
    }
    await mouse(page, params);
    return { ok: true };
  }
  if (kind === 'key') {
    const type = ['keyDown', 'keyUp', 'rawKeyDown', 'char'].includes(body?.type) ? body.type : null;
    if (!type || typeof body.key !== 'string') throw new RequestError('Unknown key event.');
    const text = typeof body.text === 'string' && body.text.length <= 4 ? body.text : undefined;
    await browser.devtools.send('Input.dispatchKeyEvent', {
      type: type === 'keyDown' && !text ? 'rawKeyDown' : type,
      key: body.key.slice(0, 32),
      code: typeof body.code === 'string' ? body.code.slice(0, 32) : '',
      windowsVirtualKeyCode: Number(body.keyCode) || 0,
      nativeVirtualKeyCode: Number(body.keyCode) || 0,
      modifiers: Number(body.modifiers) || 0,
      ...(text ? { text, unmodifiedText: text } : {}),
    }, page.sessionId);
    return { ok: true };
  }
  if (kind === 'text') {
    if (typeof body?.text !== 'string' || body.text.length > 20_000) throw new RequestError('Paste up to 20,000 characters at a time.');
    await browser.devtools.send('Input.insertText', { text: body.text }, page.sessionId);
    return { ok: true };
  }
  if (kind === 'navigate') {
    const url = parseUrl(body?.url);
    const result = await browser.devtools.send('Page.navigate', { url }, page.sessionId, NAVIGATION_TIMEOUT_MS);
    if (result.errorText) throw new RequestError(`That address could not be opened: ${result.errorText}.`, 502);
    return { ok: true };
  }
  if (kind === 'back' || kind === 'forward' || kind === 'reload') {
    const entries = kind === 'reload' ? null : await refreshHistory(page);
    if (kind === 'reload') await browser.devtools.send('Page.reload', {}, page.sessionId);
    else {
      const entry = entries?.entries[entries.currentIndex + (kind === 'back' ? -1 : 1)];
      if (entry) await browser.devtools.send('Page.navigateToHistoryEntry', { entryId: entry.id }, page.sessionId);
    }
    return { ok: true };
  }
  throw new RequestError('Unknown input.', 404);
};

/** The value the bot asked for and must never see, typed straight into the field it named. */
const supplySecret = async (body) => {
  const pending = control.pendingSecret();
  if (!pending) throw new RequestError('Nothing is waiting for a secret.', 409);
  if (typeof body?.text !== 'string' || !body.text) throw new RequestError('A value is required.');
  const page = browser.current();
  let objectId;
  try {
    if (!page || page.targetId !== pending.targetId) throw new Error('gone');
    const { object } = await browser.devtools.send('DOM.resolveNode', { backendNodeId: pending.backendNodeId, objectGroup: OBJECT_GROUP }, page.sessionId, 5_000);
    objectId = object?.objectId;
    if (!objectId) throw new Error('gone');
  } catch {
    // The field is gone for good, so the request closes rather than taking the value again and again.
    control.secretSupplied();
    throw new RequestError('That field is no longer on the page, so nothing was entered. Ask the bot to request it again.', 409);
  }
  try {
    await callOn(page, objectId, focusAndSelect);
    await browser.devtools.send('Input.insertText', { text: body.text }, page.sessionId);
    await callOn(page, objectId, markSecret).catch(() => undefined);
    control.secretSupplied();
    return { supplied: true, characters: body.text.length, url: page.url };
  } finally {
    releaseObjects(page);
  }
};

/* ------------------------------------------------------------------------ */
/* Workspace files                                                           */
/* ------------------------------------------------------------------------ */

/** A path in the workspace, written relative to it (or as an absolute path inside it). */
const resolveWorkspacePath = (raw, { allowRoot = false } = {}) => {
  const input = String(raw ?? '').trim().replace(/\\/g, '/');
  if (!input || input === '.' || input === './') {
    if (allowRoot) return { absolute: WORKSPACE, relative: '.' };
    throw new RequestError('Give a "path" in your workspace, such as notes.md.');
  }
  let relative = input;
  for (const name of WORKSPACE_NAMES) {
    if (input === name) relative = '.';
    else if (input.startsWith(`${name}/`)) relative = input.slice(name.length + 1);
    else continue;
    break;
  }
  if (relative.startsWith('/') || relative.startsWith('~')) throw new RequestError('Paths are relative to your workspace (~/workspace), such as reports/august.csv.', 403);
  const normal = path.posix.normalize(relative);
  if (normal === '..' || normal.startsWith('../')) throw new RequestError('That path leaves your workspace.', 403);
  if (normal === '.' && !allowRoot) throw new RequestError('Give a "path" in your workspace, such as notes.md.');
  const absolute = path.posix.join(WORKSPACE, normal);
  // A link must not lead out: the nearest part of the path that exists has to resolve inside.
  let probe = absolute;
  for (;;) {
    let real;
    try {
      real = asDot(() => fs.realpathSync(probe));
    } catch {
      const parent = path.posix.dirname(probe);
      if (parent === probe) break;
      probe = parent;
      continue;
    }
    if (real !== WORKSPACE && !real.startsWith(`${WORKSPACE}/`)) throw new RequestError('That path leads outside your workspace.', 403);
    break;
  }
  return { absolute, relative: normal };
};

const listFiles = (body) => {
  const { absolute, relative } = resolveWorkspacePath(body?.path, { allowRoot: true });
  return asDot(() => {
    const stat = fs.statSync(absolute, { throwIfNoEntry: false });
    if (!stat) throw new RequestError(`${relative} does not exist in your workspace.`, 404);
    if (!stat.isDirectory()) return { path: relative, entries: [{ path: relative, kind: 'file', bytes: stat.size }], truncated: false };
    const entries = [];
    let truncated = false;
    const walk = (dir, depth) => {
      let names;
      try {
        names = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        return;
      }
      for (const entry of names) {
        if (entries.length >= LIST_LIMIT) {
          truncated = true;
          return;
        }
        const full = path.posix.join(dir, entry.name);
        const shown = path.posix.relative(WORKSPACE, full);
        if (entry.isDirectory()) {
          const skipped = SKIPPED_DIRS.has(entry.name) || depth >= 6;
          entries.push({ path: shown, kind: 'folder', ...(skipped ? { skipped: true } : {}) });
          if (!skipped) walk(full, depth + 1);
        } else if (entry.isFile()) {
          let bytes = 0;
          try {
            bytes = fs.statSync(full).size;
          } catch {}
          entries.push({ path: shown, kind: 'file', bytes });
        } else if (entry.isSymbolicLink()) {
          entries.push({ path: shown, kind: 'link' });
        }
      }
    };
    walk(absolute, 0);
    return { path: relative, entries, truncated };
  });
};

const readFile = (body) => {
  const { absolute, relative } = resolveWorkspacePath(body?.path);
  const offset = Math.max(0, Math.floor(Number(body?.offset) || 0));
  return asDot(() => {
    const stat = fs.statSync(absolute, { throwIfNoEntry: false });
    if (!stat) throw new RequestError(`${relative} does not exist in your workspace. List your files to see what is there.`, 404);
    if (stat.isDirectory()) throw new RequestError(`${relative} is a folder; list it instead.`);
    const handle = fs.openSync(absolute, 'r');
    try {
      // Bytes as they are, in pieces, for a copy to the user's computer.
      if (body?.encoding === 'base64') {
        const length = Math.max(0, Math.min(BINARY_CHUNK, stat.size - offset));
        const buffer = Buffer.alloc(length);
        fs.readSync(handle, buffer, 0, length, offset);
        const next = offset + length < stat.size ? offset + length : null;
        return { path: relative, bytes: stat.size, data: buffer.toString('base64'), offset, next };
      }
      const head = Buffer.alloc(Math.min(8_192, stat.size));
      fs.readSync(handle, head, 0, head.length, 0);
      if (head.includes(0)) return { path: relative, bytes: stat.size, binary: true, text: '' };
      const length = Math.max(0, Math.min(READ_LIMIT, stat.size - offset));
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, offset);
      let text = buffer.toString('utf8');
      let consumed = length;
      // Never end on half a character: hand back the bytes of a split one for next time.
      if (offset + length < stat.size && text.endsWith('\uFFFD')) {
        const trimmed = text.slice(0, -1);
        consumed = Buffer.byteLength(trimmed, 'utf8');
        text = trimmed;
      }
      const next = offset + consumed < stat.size ? offset + consumed : null;
      return { path: relative, bytes: stat.size, text, offset, next };
    } finally {
      fs.closeSync(handle);
    }
  });
};

const writeFile = (body) => {
  control.assertBotMayAct(false);
  if (typeof body?.contents !== 'string') throw new RequestError('Give the "contents" to save.');
  // Base64 is bytes from the user's computer, in pieces: the file as it was there, not text.
  const contents = body.encoding === 'base64' ? Buffer.from(body.contents, 'base64') : body.contents;
  if ((typeof contents === 'string' ? Buffer.byteLength(contents, 'utf8') : contents.length) > WRITE_LIMIT) throw new RequestError('That is more than 5 MB; write it in parts with "append".', 413);
  const { absolute, relative } = resolveWorkspacePath(body.path);
  return asDot(() => {
    fs.mkdirSync(path.posix.dirname(absolute), { recursive: true });
    if (body.append === true) fs.appendFileSync(absolute, contents);
    else fs.writeFileSync(absolute, contents);
    return { path: relative, bytes: fs.statSync(absolute).size, appended: body.append === true };
  });
};

/* ------------------------------------------------------------------------ */
/* The shell                                                                 */
/* ------------------------------------------------------------------------ */

const tail = () => {
  const chunks = [];
  let size = 0;
  let dropped = false;
  return {
    push(chunk) {
      chunks.push(chunk);
      size += chunk.length;
      while (size > OUTPUT_LIMIT && chunks.length > 1) {
        size -= chunks.shift().length;
        dropped = true;
      }
    },
    text() {
      let buffer = Buffer.concat(chunks);
      if (buffer.length > OUTPUT_LIMIT) {
        buffer = buffer.subarray(buffer.length - OUTPUT_LIMIT);
        dropped = true;
      }
      return buffer.toString('utf8');
    },
    get dropped() {
      return dropped;
    },
  };
};

/**
 * A command, in bash, in the workspace, as the bot. Its output is kept from the
 * end, and it stops — with everything it started in the foreground — when its
 * time is up or when the caller goes away.
 */
const execute = (body, response) => control.admit(false, () => new Promise((resolve, reject) => {
  if (typeof body?.command !== 'string' || !body.command.trim()) {
    reject(new RequestError('Give the "command" to run.'));
    return;
  }
  if (body.command.length > 100_000) {
    reject(new RequestError('That command is too long to run.'));
    return;
  }
  const requested = Number(body.timeoutMs);
  const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.max(EXEC_MIN_MS, Math.min(EXEC_MAX_MS, requested)) : EXEC_DEFAULT_MS;
  ensureDotDir(WORKSPACE);
  const startedAt = Date.now();
  // What it creates is the bot's alone, wherever it lands: other bots' users share this machine.
  const child = spawn('/bin/bash', ['-c', `umask 077\n${body.command}`], { cwd: WORKSPACE, uid: UID, gid: GID, env: dotEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = tail();
  const stderr = tail();
  let timedOut = false;
  let stopped = false;
  let settled = false;
  const kill = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {}
  };
  const stop = () => {
    kill('SIGTERM');
    setTimeout(() => kill('SIGKILL'), 2_000).unref();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  const onGone = () => {
    if (settled) return;
    stopped = true;
    stop();
  };
  // The caller going away is the stop signal: the bot's turn was stopped.
  response.once('close', () => {
    if (!response.writableFinished) onGone();
  });
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.once('error', (error) => {
    clearTimeout(timer);
    settled = true;
    reject(new RequestError(`The command could not start: ${error.message}`, 500));
  });
  // `exit`, not `close`: something left running in the background may hold the pipes open for ever.
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    setTimeout(() => {
      settled = true;
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        exitCode: code ?? (signal ? 128 + (signal === 'SIGKILL' ? 9 : 15) : -1),
        ...(signal ? { signal } : {}),
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.dropped || stderr.dropped,
        timedOut,
        ...(stopped ? { stopped: true } : {}),
        elapsedMs: Date.now() - startedAt,
      });
    }, 50);
  });
}));

/* ------------------------------------------------------------------------ */
/* The desktop's browser                                                     */
/* ------------------------------------------------------------------------ */

const BLANK_PAGE = /^(about:blank|chrome:\/\/(newtab|new-tab-page)\/?)$/;

/** The pages a request named, in the bot's browser: the blank tab takes the first, the rest open as tabs, and the browser comes to the front. */
const openForDesktop = async (urls) => {
  await browser.ensure();
  for (const url of urls) {
    const page = browser.current();
    if (page && BLANK_PAGE.test(page.url)) await browser.devtools.send('Page.navigate', { url }, page.sessionId);
    else await browser.openPage(url);
  }
  if (browser.headed && desktop.status === 'on') await xdotool(['search', '--onlyvisible', '--class', 'chromium', 'windowactivate'], 3_000).catch(() => undefined);
};

/**
 * Requests for the bot's browser from the desktop (`BROWSER_FRONT`), taken as
 * they land in the bot's folder. They are read as the bot, and only web and
 * file addresses are opened; the browser starts, and the screen with it, if
 * it is not on. One at a time, in the order they came.
 */
const browserRequests = {
  timer: null,
  queue: Promise.resolve(),

  start() {
    try {
      ensureDotDir(BROWSER_REQUESTS);
      this.take();
      fs.watch(BROWSER_REQUESTS, { persistent: false }, () => this.soon()).on('error', (error) => log('stopped taking browser requests', error?.message));
    } catch (error) {
      log('the desktop cannot ask for the browser', error?.message);
    }
  },

  soon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.take();
    }, 50);
  },

  take() {
    let found = false;
    const lines = [];
    asDot(() => {
      let names = [];
      try {
        names = fs.readdirSync(BROWSER_REQUESTS);
      } catch {
        return;
      }
      for (const name of names) {
        if (!name.endsWith('.req')) continue;
        const file = path.join(BROWSER_REQUESTS, name);
        try {
          const stat = fs.lstatSync(file);
          if (stat.isFile() && stat.size <= 16_384) lines.push(...fs.readFileSync(file, 'utf8').split('\n'));
          found = true;
          fs.rmSync(file, { force: true });
        } catch {}
      }
    });
    if (!found) return;
    const urls = lines.map((line) => line.trim()).filter((line) => line.length <= 4_096 && (/^(https?|file):\/\/\S+$/i.test(line) || line === 'about:blank')).slice(0, 20);
    this.queue = this.queue.then(() => openForDesktop(urls)).catch((error) => log('could not open the browser for the desktop', error?.message));
  },
};

/* ------------------------------------------------------------------------ */
/* HTTP                                                                      */
/* ------------------------------------------------------------------------ */

const json = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  response.end(body);
};

const authorised = (request) => {
  const offered = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(offered);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const readBody = (request, limit = WRITE_LIMIT * 2) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) {
      reject(new RequestError('That request is too large.', 413));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (!chunks.length) return resolve({});
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      reject(new RequestError('The request body is not JSON.'));
    }
  });
  request.on('error', reject);
});

const listShots = () => ({ shots });
const readShot = (id) => {
  if (!/^s\d+$/.test(id)) throw new RequestError('Unknown step.', 404);
  try {
    return { id, data: fs.readFileSync(path.join(SHOTS_DIR, `${id}.jpg`)).toString('base64') };
  } catch {
    throw new RequestError('That step\'s image is gone.', 404);
  }
};

const health = () => ({
  ok: true,
  service: 'willow-computer',
  version: SERVICE_VERSION,
  browser: browser.status,
  desktop: desktop.status,
  egress,
  startedAt,
  lastActivityAt,
  watching: browser.screencastWanted,
  holder: control.get().holder,
});

const startedAt = Date.now();
let shuttingDown = false;

const routes = {
  'GET /state': () => ({ ...screenState(), control: control.get(), snapshotId: browser.snapshotId }),
  'POST /browser/start': async () => {
    await browser.ensure();
    return screenState();
  },
  'POST /browser/navigate': (body) => botNavigate(body),
  'GET /browser/read': (_body, query) => botRead(query),
  'POST /browser/snapshot': () => botSnapshot(),
  'POST /browser/click': (body) => botClick(body),
  'POST /browser/type': (body) => botType(body),
  'POST /browser/key': (body) => botKey(body),
  'POST /browser/scroll': (body) => botScroll(body),
  'POST /browser/back': () => botHistory('back'),
  'POST /browser/forward': () => botHistory('forward'),
  'POST /browser/reload': () => botHistory('reload'),
  'GET /browser/screenshot': async () => {
    await browser.ensure();
    const page = browser.current();
    const data = await captureJpeg(page, 70);
    if (!data) throw new RequestError('The screen could not be captured.', 502);
    return { data, width: VIEWPORT.width, height: VIEWPORT.height, url: page.url, title: page.title };
  },
  'POST /screencast': async (body) => {
    browser.screencastWanted = body?.on === true;
    if (!browser.screencastWanted) {
      screenStream.stop();
      await browser.stopScreencast();
    } else if (desktop.status === 'on') {
      // Another watcher joining a still screen would otherwise wait for it to change.
      if (screenStream.child) screenStream.send();
      else screenStream.start();
    } else if (desktop.status !== 'unavailable') {
      // The stream starts once the desktop is up.
      void desktop.ensure();
    } else {
      await browser.ensure();
      await browser.startScreencast();
    }
    return { watching: browser.screencastWanted };
  },
  'GET /desktop/screenshot': () => desktopScreenshot(),
  'POST /desktop/click': (body) => desktopClick(body),
  'POST /desktop/move': (body) => desktopMove(body),
  'POST /desktop/type': (body) => desktopType(body),
  'POST /desktop/key': (body) => desktopKey(body),
  'POST /desktop/scroll': (body) => desktopScroll(body),
  'POST /desktop/drag': (body) => desktopDrag(body),
  'POST /look': (body) => applyLook(body),
  'GET /control': (_body, query) => control.get(query.get('requestId') || undefined),
  'POST /control/request': (body) => ({ ...control.requestHelp(body?.reason, 'model'), screen: screenState() }),
  'POST /control/take': (body) => control.take(typeof body?.requestId === 'string' ? body.requestId : undefined),
  'POST /control/release': (body) => control.release(String(body?.requestId || '')),
  'POST /control/cancel': (body) => control.cancel(String(body?.requestId || '')),
  'POST /control/secret': async (body) => {
    control.assertBotMayAct(false);
    await browser.ensure();
    const { page, entry } = await resolveRef(body?.ref, body?.snapshotId);
    releaseObjects(page);
    return { ...control.requestSecret({ label: body?.label, ref: String(body.ref).trim(), backendNodeId: entry.backendNodeId, targetId: page.targetId }), screen: screenState() };
  },
  'POST /control/secret/cancel': () => control.cancelSecret(),
  'POST /human/mouse': (body) => humanInput('mouse', body),
  'POST /human/key': (body) => humanInput('key', body),
  'POST /human/text': (body) => humanInput('text', body),
  'POST /human/navigate': (body) => humanInput('navigate', body),
  'POST /human/back': () => humanInput('back', {}),
  'POST /human/forward': () => humanInput('forward', {}),
  'POST /human/reload': () => humanInput('reload', {}),
  'POST /human/secret': (body) => supplySecret(body),
  'POST /files/list': (body) => listFiles(body),
  'POST /files/read': (body) => readFile(body),
  'POST /files/write': (body) => writeFile(body),
  'POST /exec': (body, _query, response) => execute(body, response),
  'GET /shots': () => listShots(),
  'POST /shutdown': () => {
    setTimeout(() => void shutDown('asked to stop', 0), 20);
    return { stopping: true };
  },
};

const PASSIVE = new Set(['GET /state', 'GET /control', 'GET /shots', 'GET /browser/screenshot', 'POST /screencast', 'POST /look']);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/health') return json(response, 200, health());
  if (!authorised(request)) return json(response, 401, { error: 'Not authorised.' });
  if (url.pathname === '/events' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    response.write(`event: state\ndata: ${JSON.stringify(screenState())}\n\n`);
    response.write(`event: control\ndata: ${JSON.stringify(control.get())}\n\n`);
    clients.add(response);
    const keepAlive = setInterval(() => response.write(': still here\n\n'), 15_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(response);
    });
    return undefined;
  }
  const shot = /^\/shots\/(s\d+)$/.exec(url.pathname);
  const route = shot && request.method === 'GET' ? () => readShot(shot[1]) : routes[`${request.method} ${url.pathname}`];
  if (!route) return json(response, 404, { error: 'Not found.' });
  if (!PASSIVE.has(`${request.method} ${url.pathname}`) && !shot) touch();
  try {
    const body = request.method === 'POST' ? await readBody(request) : {};
    const value = await route(body, url.searchParams, response);
    if (!response.writableEnded) json(response, 200, value ?? {});
  } catch (error) {
    if (response.writableEnded) return undefined;
    if (error instanceof RequestError) return json(response, error.status, { error: error.message, ...error.extra, ...(error.extra.humanHasControl ? { control: control.get() } : {}) });
    log('request failed', request.method, url.pathname, error?.stack || error);
    return json(response, 500, { error: error instanceof Error ? error.message : 'Something went wrong on the computer.' });
  }
  return undefined;
});

async function shutDown(reason, code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${reason}: closing the browser so its profile is kept`);
  control.interrupt('The computer turned off; whoever had it was interrupted.');
  for (const response of clients) response.end();
  await browser.close().catch(() => undefined);
  screenDoor.close();
  desktop.stop();
  server.close();
  process.exit(code);
}

process.on('SIGTERM', () => void shutDown('SIGTERM', 0));
process.on('SIGINT', () => void shutDown('SIGINT', 0));
process.stdin.on('end', () => void shutDown('the companion went away', 0));
process.stdin.resume();
process.on('uncaughtException', (error) => log('uncaught', error?.stack || error));
process.on('unhandledRejection', (error) => log('unhandled', error?.stack || error));

detachHostMounts();
applyEgressRules();
installHelpers();
ensureDotDir(WORKSPACE);
browserRequests.start();
fs.mkdirSync(SHOTS_DIR, { recursive: true, mode: 0o700 });
loadShots();

server.on('error', (error) => {
  process.stdout.write(`${JSON.stringify({ type: 'error', code: error.code, message: error.message })}\n`);
  process.exit(error.code === 'EADDRINUSE' ? 98 : 1);
});
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ type: 'ready', port: PORT, version: SERVICE_VERSION, egress })}\n`);
  // The screen starts when something needs it; until then its address is held for it.
  screenDoor.open();
});
