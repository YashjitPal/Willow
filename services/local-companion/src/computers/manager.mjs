/**
 * Bots' own computers on this PC: one Linux machine under WSL 2 that the user's
 * bots share — Willow's computer — with an account for each bot, and Willow's
 * computer service (`machine/service.mjs`) running once for every bot that is
 * using it.
 *
 * Sharing is what keeps n bots from costing n machines: the system and its
 * programs are on disk once and their code in memory once, and what a bot adds
 * is its own folder and, while it works, its own screen and browser. Each
 * account is closed to the others — its folder, screen, browser, processes and
 * servers (`service.mjs` says how) — and what they share is the software
 * installed on the computer.
 *
 * The computer is made from a base: Alpine's minimal root filesystem,
 * provisioned once (`machine/provision.sh`) and exported as a tar, which is
 * deleted once the computer has been made from it. Bots that had machines of
 * their own, before the computer was shared, are moved onto it: their files,
 * sign-ins, step history and installed software.
 *
 * A bot's computer is on while its service runs: one `wsl.exe` process this
 * companion holds. The desktop app's job object takes the companion's children
 * with it, so when Willow quits the computer stops too; and it stops when no
 * bot is using it. Pages reach a bot's computer only through the `machine.*`
 * requests here: its port and token never leave this process.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMinirootfs } from './alpine.mjs';
import { DISTRO_PREFIX, execArgs, exportDistro, importDistro, isRegistered, listDistros, pipeBetween, runIn, stopDistro, terminateDistro, unregisterDistro, wslMessage, wslSupport } from './wsl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_FILE = path.join(HERE, 'machine', 'service.mjs');
const PROVISION_FILE = path.join(HERE, 'machine', 'provision.sh');
/** Raise with any change to provision.sh: a computer made after it starts from a fresh base. */
const BASE_VERSION = 3;
const BUILD_DISTRO = `${DISTRO_PREFIX}Base-Build`;
/**
 * What the computer is called if the name is free. Distro names are global to
 * the PC, and another companion's computer — a test's — may already have it, so
 * the name a computer was made with is recorded, and only that one is used.
 */
const COMPUTER_NAME = `${DISTRO_PREFIX}Computer`;
const IDLE_MS = 30 * 60_000;
/**
 * Bots' accounts: users from 61001, each with the screen of its number past
 * 61000 and a hundred ports of its own from 61000, which Linux never hands out
 * as ephemeral ports.
 */
const FIRST_UID = 61001;
const MAX_DOTS = 45;
const PORT_SPAN = 100;
const DOT_PORTS = [61000, 61000 + MAX_DOTS * PORT_SPAN - 1];
const MANAGER_ONLY = new Set(['/events', '/shutdown']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A port for a bot's service: never one of the bots' own, which share the namespace it listens in. */
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => {
      if (port >= DOT_PORTS[0] && port <= DOT_PORTS[1]) freePort().then(resolve, reject);
      else resolve(port);
    });
  });
});

const portsOf = (uid) => [DOT_PORTS[0] + (uid - FIRST_UID) * PORT_SPAN, DOT_PORTS[0] + (uid - FIRST_UID + 1) * PORT_SPAN - 1];
const displayOf = (uid) => uid - FIRST_UID + 1;

/* Shell for the bot's account on the computer, as root. Names are `d` and hex digits, so nothing needs quoting. */
const ACCOUNT_DIRS = (user) => `mkdir -p /home/${user}/workspace /home/${user}/.config /home/${user}/.local/bin /home/${user}/.cache
chown -R ${user}:${user} /home/${user}
chmod 700 /home/${user}
mkdir -p /var/lib/willow/dots/${user}
chmod 700 /var/lib/willow/dots /var/lib/willow/dots/${user}`;

const addAccountScript = ({ user, uid }) => `set -e
# The base's one user, from when each bot had a machine of its own, would only be an empty folder in the way.
if grep -q '^dot:' /etc/passwd && [ -z "$(ls -A /home/dot/workspace 2>/dev/null)" ]; then deluser bot 2>/dev/null || true; rm -rf /home/dot; fi
grep -q '^${user}:' /etc/group || addgroup -g ${uid} ${user}
grep -q '^${user}:' /etc/passwd || adduser -D -u ${uid} -G ${user} -s /bin/bash -h /home/${user} ${user}
${ACCOUNT_DIRS(user)}
`;

const endProcessesScript = ({ user }) => `pkill -KILL -u ${user} 2>/dev/null; sleep 0.2; true`;

const resetAccountScript = ({ user }) => `${endProcessesScript({ user })}
set -e
rm -rf /home/${user} /var/lib/willow/dots/${user} /tmp/willow-${user}-runtime
mkdir -p /home/${user}
cp -a /etc/skel/. /home/${user}/ 2>/dev/null || true
${ACCOUNT_DIRS(user)}
`;

const removeAccountScript = ({ user, uid }) => `${endProcessesScript({ user })}
deluser ${user} 2>/dev/null || true
delgroup ${user} 2>/dev/null || true
rm -rf /home/${user} /var/lib/willow/dots/${user} /tmp/willow-${user}-runtime /etc/sudoers.d/willow-apk-${user}
nft delete table inet willow_dot_${uid} 2>/dev/null || true
true
`;

const START_MENU = process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null;

/**
 * Windows' WSL GUI integration gives every distro with a Linux app installed a
 * Start menu folder of its own, so a bot's browser would sit there as if it
 * were one of the user's apps. Those folders are Willow's distros', so they go
 * as soon as WSL makes them — and again a little later, since WSL makes them
 * after the distro is up.
 */
const clearStartMenu = () => {
  if (!START_MENU) return;
  const sweep = async () => {
    const entries = await fs.readdir(START_MENU, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(DISTRO_PREFIX)) await fs.rm(path.join(START_MENU, entry.name), { recursive: true, force: true }).catch(() => undefined);
    }
  };
  void sweep();
  setTimeout(() => void sweep(), 15_000).unref();
};

const exited = (child, timeoutMs) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
  const timer = setTimeout(() => resolve(false), timeoutMs);
  child.once('exit', () => {
    clearTimeout(timer);
    resolve(true);
  });
});

/**
 * `dir` is where the computer and its base live (the desktop app passes its
 * data folder). `broadcast(event, payload)` reaches every page; `send(session,
 * event, payload)` one of them.
 */
export const createComputers = ({ dir, broadcast, send, log = () => {} }) => {
  const registryFile = path.join(dir, 'computers.json');
  const baseFile = path.join(dir, 'base', 'base.tar');
  const computerDir = path.join(dir, 'computer');
  const logsDir = path.join(dir, 'logs');
  /** `bots`: each bot's account on the computer. `machines`: bots' machines from before it was shared, until they are moved. */
  let registry = { version: 2, base: null, computer: null, dots: {}, machines: {} };
  const record = (value) => (value && typeof value === 'object' ? value : {});
  const loaded = fs.readFile(registryFile, 'utf8').then((text) => {
    const saved = JSON.parse(text);
    registry = { version: 2, base: saved.base ?? null, computer: saved.computer ?? null, dots: record(saved.dots), machines: record(saved.machines) };
  }).catch(() => undefined);
  let reconciled = null;
  const machines = new Map();
  const inflight = new Map();
  let supportCache = null;
  let baseBuild = null;
  let baseProgress = null;
  /** Whether this run has started the computer afresh, ending whatever an earlier run left in it. */
  let computerFresh = false;

  /**
   * Changes to the computer — making accounts, starting and stopping bots,
   * resetting, moving — one at a time, so one bot's stop never pulls the
   * computer out from under another's start.
   */
  let queue = Promise.resolve();
  const exclusive = (work) => {
    const turn = queue.then(work, work);
    queue = turn.catch(() => undefined);
    return turn;
  };

  const saveRegistry = async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${registryFile}.tmp`, JSON.stringify(registry, null, 2));
    await fs.rename(`${registryFile}.tmp`, registryFile);
  };

  const keyFor = (dotId) => crypto.createHash('sha256').update(String(dotId)).digest('hex').slice(0, 12);

  const machineFor = (dotId) => {
    let machine = machines.get(dotId);
    if (!machine) {
      machine = {
        dotId,
        state: registry.dots[dotId] || registry.machines[dotId] ? 'stopped' : 'none',
        error: null,
        child: null,
        port: null,
        token: null,
        egress: null,
        startedAt: null,
        lastCallAt: 0,
        calls: 0,
        watchers: new Set(),
        screen: null,
        control: null,
        events: null,
        starting: null,
        stopping: null,
        creating: null,
        progress: null,
        look: null,
      };
      machines.set(dotId, machine);
    }
    return machine;
  };

  const summary = (machine) => ({
    dotId: machine.dotId,
    state: machine.state,
    error: machine.error,
    egress: machine.egress,
    startedAt: machine.startedAt,
    createdAt: registry.dots[machine.dotId]?.createdAt ?? registry.machines[machine.dotId]?.createdAt ?? null,
    screen: machine.screen,
    control: machine.control,
    progress: machine.state === 'creating' || machine.state === 'resetting' ? machine.progress ?? baseProgress : null,
  });

  const setState = (machine, state, patch = {}) => {
    Object.assign(machine, patch, { state });
    if (state !== 'running') {
      machine.screen = machine.screen ? { ...machine.screen, browser: 'stopped', agentActive: false } : null;
    }
    broadcast('machine.state', summary(machine));
  };

  const reportProgress = (machine, stage, fraction, detail) => {
    const progress = { stage, fraction: Math.max(0, Math.min(1, fraction)), detail };
    if (machine) machine.progress = progress;
    else baseProgress = progress;
    broadcast('machine.progress', { dotId: machine?.dotId ?? null, ...progress });
  };

  const support = async () => {
    if (supportCache && Date.now() - supportCache.at < 60_000) return supportCache.value;
    const value = await wslSupport();
    supportCache = { at: Date.now(), value };
    return value;
  };

  const requireSupport = async () => {
    const state = await support();
    if (state.supported) return;
    if (state.reason === 'unsupported-os') throw new Error("Bots' own computers need Windows for now.");
    throw new Error('Dots\' computers run on the Windows Subsystem for Linux, which is not set up on this PC yet. Set it up from the dot\'s profile, then try again.');
  };

  const computerName = () => registry.computer?.name ?? COMPUTER_NAME;

  /**
   * How the bot's computer looks in the bot's colour — its wallpaper's colours
   * and its browser's — as pages send it with every start and call, and when
   * the bot changes colour. A running computer takes a change at once; it is
   * not started for one.
   */
  const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const takeLook = (machine, settings) => {
    const colors = settings?.wallpaper;
    const wallpaper = Array.isArray(colors) && colors.length === 13 && colors.every(isHex) ? colors.map((color) => color.toLowerCase()) : machine.look?.wallpaper;
    const theme = settings?.browser;
    const browser = isHex(theme?.frame) && isHex(theme?.toolbar) ? { frame: theme.frame.toLowerCase(), toolbar: theme.toolbar.toLowerCase() } : machine.look?.browser;
    if (!wallpaper && !browser) return;
    const look = { ...(wallpaper ? { wallpaper } : {}), ...(browser ? { browser } : {}) };
    if (JSON.stringify(look) === JSON.stringify(machine.look)) return;
    machine.look = look;
    if (machine.state === 'running' && machine.child) void serviceFetch(machine, '/look', { method: 'POST', body: look, timeoutMs: 30_000 }).catch(() => undefined);
  };

  /** Some bot's service runs, or is starting: the computer is in use. */
  const othersActive = (machine) => [...machines.values()].some((other) => other !== machine && (other.child || other.state === 'running' || other.state === 'starting'));

  /** With no bot using it, the computer stops and its memory goes back to Windows. */
  const idleComputer = async (machine) => {
    if (registry.computer && !othersActive(machine)) await terminateDistro(computerName());
  };

  /** Forgets what is gone — the computer, or old machines — removed by hand or never finished. Once per run, when WSL can say. */
  const reconcile = () => {
    if (!reconciled) {
      reconciled = (async () => {
        await loaded;
        if (!(await support()).supported) return;
        const known = new Set(await listDistros({ strict: true }));
        let changed = false;
        if (registry.computer && known.has(computerName()) && existsSync(baseFile)) {
          // The base is only for making the computer, which is made.
          await fs.rm(baseFile, { force: true }).catch(() => undefined);
          registry.base = null;
          changed = true;
        }
        if (registry.computer && !known.has(computerName())) {
          registry.computer = null;
          for (const dotId of Object.keys(registry.dots)) {
            const machine = machines.get(dotId);
            if (machine && !registry.machines[dotId]) setState(machine, 'none');
          }
          registry.dots = {};
          changed = true;
        }
        for (const [dotId, old] of Object.entries(registry.machines)) {
          if (known.has(old.name)) continue;
          delete registry.machines[dotId];
          changed = true;
          const machine = machines.get(dotId);
          if (machine && !registry.dots[dotId]) setState(machine, 'none');
        }
        if (changed) await saveRegistry();
      })().catch((error) => {
        log('could not check the computer', error.message);
        reconciled = null;
      });
    }
    return reconciled;
  };

  /* ---------------------------------------------------------------------- */
  /* The base                                                               */
  /* ---------------------------------------------------------------------- */

  const baseReady = () => registry.base?.version === BASE_VERSION && existsSync(baseFile);

  const buildBase = async () => {
    const report = (stage, fraction, detail) => {
      reportProgress(null, stage, fraction, detail);
      for (const machine of machines.values()) {
        if (machine.state === 'creating' || machine.state === 'resetting') reportProgress(machine, stage, fraction, detail);
      }
    };
    report('download', 0, 'Downloading Linux');
    const rootfs = await fetchMinirootfs(path.join(dir, 'cache'), { onProgress: (fraction) => report('download', fraction * 0.08, 'Downloading Linux') });
    const buildDir = path.join(dir, 'base', 'build');
    await unregisterDistro(BUILD_DISTRO).catch(() => undefined);
    await fs.rm(buildDir, { recursive: true, force: true });
    await fs.mkdir(buildDir, { recursive: true });
    report('prepare', 0.1, 'Preparing the computer');
    await importDistro(BUILD_DISTRO, buildDir, rootfs.file, { timeoutMs: 10 * 60_000 });
    try {
      const script = (await fs.readFile(PROVISION_FILE, 'utf8')).replace(/\r\n/g, '\n');
      const copied = await runIn(BUILD_DISTRO, 'cat > /tmp/provision.sh', { input: script, timeoutMs: 2 * 60_000 });
      if (copied.code !== 0) throw new Error(`Preparing the computer failed: ${wslMessage(copied)}`);
      report('install', 0.12, 'Installing a desktop, a browser and tools');
      let finished = false;
      const provisioned = await runIn(BUILD_DISTRO, '/bin/sh /tmp/provision.sh', {
        timeoutMs: 25 * 60_000,
        onLine: (line) => {
          const step = /^willow-progress packages (\d+)/.exec(line.trim());
          if (step) report('install', 0.12 + (Number(step[1]) / 100) * 0.68, 'Installing a desktop, a browser and tools');
          if (line.includes('willow-base-ready')) finished = true;
        },
      });
      if (provisioned.code !== 0 || !finished) throw new Error(`Installing the desktop, browser and tools failed: ${wslMessage(provisioned) || 'no details'}`);
      report('save', 0.82, 'Saving the computer');
      await stopDistro(BUILD_DISTRO);
      const fresh = path.join(dir, 'base', 'base-new.tar');
      await fs.rm(fresh, { force: true });
      await exportDistro(BUILD_DISTRO, fresh, { timeoutMs: 20 * 60_000 });
      await fs.rm(baseFile, { force: true });
      await fs.rename(fresh, baseFile);
      await fs.rm(path.join(dir, 'base', 'base.vhdx'), { force: true });
      registry.base = { version: BASE_VERSION, alpine: rootfs.version, builtAt: Date.now() };
      await saveRegistry();
    } finally {
      await unregisterDistro(BUILD_DISTRO).catch((error) => log('could not remove the build machine', error.message));
      await fs.rm(buildDir, { recursive: true, force: true }).catch(() => undefined);
      clearStartMenu();
    }
  };

  const ensureBase = () => {
    if (baseReady()) return Promise.resolve();
    if (!baseBuild) {
      baseBuild = buildBase().finally(() => {
        baseBuild = null;
        baseProgress = null;
      });
    }
    return baseBuild;
  };

  /* ---------------------------------------------------------------------- */
  /* The computer and the bots' accounts                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * The computer, made from the base the first time. Any base will do: the
   * service installs what an older one lacks. The base is only for making the
   * computer again, so it goes once the computer exists — a gigabyte the user
   * need not keep.
   */
  const ensureComputer = async (machine) => {
    if (registry.computer && (await isRegistered(registry.computer.name))) return;
    if (!existsSync(baseFile)) await ensureBase();
    reportProgress(machine, 'create', 0.92, 'Making the computer');
    // A distro under another name is someone else's, never adopted: only a name no distro has will do.
    const taken = new Set(await listDistros({ strict: true }).catch(() => listDistros()));
    let name = COMPUTER_NAME;
    for (let suffix = 2; taken.has(name); suffix += 1) name = `${COMPUTER_NAME}-${suffix}`;
    await fs.mkdir(computerDir, { recursive: true });
    await fs.rm(path.join(computerDir, 'ext4.vhdx'), { force: true });
    await importDistro(name, computerDir, baseFile, { timeoutMs: 10 * 60_000 });
    for (const dotId of Object.keys(registry.dots)) {
      const other = machines.get(dotId);
      if (other && other !== machine && !registry.machines[dotId]) setState(other, 'none');
    }
    registry.computer = { name, createdAt: Date.now(), baseVersion: registry.base?.version ?? null };
    registry.dots = {};
    registry.base = null;
    await saveRegistry();
    await fs.rm(baseFile, { force: true });
    clearStartMenu();
  };

  const addAccount = async (machine) => {
    const taken = new Set(Object.values(registry.dots).map((account) => account.uid));
    let uid = FIRST_UID;
    while (taken.has(uid)) uid += 1;
    if (uid >= FIRST_UID + MAX_DOTS) throw new Error(`Willow's computer has room for ${MAX_DOTS} bots, and all of it is taken.`);
    const account = { user: `d${keyFor(machine.dotId).slice(0, 10)}`, uid, createdAt: Date.now() };
    reportProgress(machine, 'account', 0.96, 'Making its account');
    const made = await runIn(computerName(), addAccountScript(account), { timeoutMs: 2 * 60_000 });
    if (made.code !== 0) throw new Error(`Making its account failed: ${wslMessage(made) || `exit ${made.code}`}`);
    registry.dots[machine.dotId] = account;
    await saveRegistry();
    return account;
  };

  /**
   * A bot's machine from before the computer was shared, moved into its
   * account: its folder (files and browser sign-ins), its step history and the
   * software it installed. The old machine goes only once all of that is
   * across; a failure leaves it as it was, to try again.
   */
  const migrate = async (machine) => {
    const old = registry.machines[machine.dotId];
    if (!old) return;
    setState(machine, 'creating', { error: null, progress: null });
    try {
      reportProgress(machine, 'move', 0.05, 'Moving to the shared computer');
      await ensureComputer(machine);
      const account = registry.dots[machine.dotId] ?? (await addAccount(machine));
      const { user } = account;
      if (await isRegistered(old.name)) {
        await terminateDistro(old.name);
        reportProgress(machine, 'move', 0.3, 'Moving its files and sign-ins');
        await pipeBetween({
          from: old.name,
          fromCommand: 'tar -C /home/dot -cf - .',
          to: computerName(),
          toCommand: `tar -C /home/${user} -xf - && chown -R ${user}:${user} /home/${user} && chmod 700 /home/${user}`,
        });
        reportProgress(machine, 'move', 0.6, 'Moving its history');
        await pipeBetween({
          from: old.name,
          fromCommand: 'if [ -d /var/lib/willow/shots ]; then tar -C /var/lib/willow/shots -cf - .; else tar -cf - -T /dev/null; fi',
          to: computerName(),
          toCommand: `mkdir -p /var/lib/willow/dots/${user}/shots && tar -C /var/lib/willow/dots/${user}/shots -xf -`,
        });
        reportProgress(machine, 'move', 0.7, 'Installing its software');
        const listed = async (name) => {
          const result = await runIn(name, 'cat /etc/apk/world', { timeoutMs: 30_000 });
          return result.code === 0 ? result.stdout.split('\n').map((line) => line.trim()).filter((line) => /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(line)) : [];
        };
        const present = new Set(await listed(computerName()));
        const missing = (await listed(old.name)).filter((name) => !present.has(name));
        if (missing.length) {
          const installed = await runIn(computerName(), `apk add --no-cache --quiet --wait 600 ${missing.join(' ')}`, { timeoutMs: 15 * 60_000 });
          if (installed.code !== 0) log(`moving ${user}: some of its software was not installed`, wslMessage(installed));
        }
        reportProgress(machine, 'move', 0.9, 'Removing the old computer');
        await unregisterDistro(old.name);
        await fs.rm(path.join(dir, 'machines', keyFor(machine.dotId)), { recursive: true, force: true }).catch(() => undefined);
      }
      delete registry.machines[machine.dotId];
      await saveRegistry();
      await idleComputer(machine);
      clearStartMenu();
      log(`moved ${old.name} to ${user} on ${computerName()}`);
      setState(machine, 'stopped', { error: null, progress: null });
    } catch (error) {
      setState(machine, 'stopped', { error: `Moving to the shared computer did not finish: ${error.message}`, progress: null });
      throw error;
    }
  };

  const create = async (machine) => {
    await reconcile();
    if (registry.dots[machine.dotId] && !registry.machines[machine.dotId]) {
      if (machine.state === 'none') setState(machine, 'stopped');
      return;
    }
    if (!machine.creating) {
      machine.creating = exclusive(async () => {
        if (registry.machines[machine.dotId]) return migrate(machine);
        if (registry.dots[machine.dotId]) return undefined;
        setState(machine, 'creating', { error: null, progress: null });
        try {
          await ensureComputer(machine);
          await addAccount(machine);
          await idleComputer(machine);
          setState(machine, 'stopped', { error: null, progress: null });
        } catch (error) {
          setState(machine, registry.dots[machine.dotId] ? 'stopped' : 'none', { error: error.message, progress: null });
          throw error;
        }
        return undefined;
      }).finally(() => {
        machine.creating = null;
      });
    }
    await machine.creating;
  };

  /* ---------------------------------------------------------------------- */
  /* A bot's service                                                        */
  /* ---------------------------------------------------------------------- */

  const forgetChild = (machine) => {
    machine.events?.abort();
    machine.events = null;
    machine.child = null;
    machine.port = null;
    machine.token = null;
  };

  const waitForHealth = async (port, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
        if (response.ok) return await response.json();
      } catch {}
      await sleep(250);
    }
    throw new Error("Willow could not reach the computer once it had started.");
  };

  const onServiceEvent = (machine, type, payload) => {
    if (type === 'frame') {
      for (const session of machine.watchers) send(session, 'machine.frame', { dotId: machine.dotId, ...payload });
    } else if (type === 'cursor') {
      for (const session of machine.watchers) send(session, 'machine.cursor', { dotId: machine.dotId, cursor: payload });
    } else if (type === 'state') {
      machine.screen = payload;
      broadcast('machine.screen', { dotId: machine.dotId, screen: payload });
    } else if (type === 'control') {
      machine.control = payload;
      broadcast('machine.control', { dotId: machine.dotId, control: payload });
    } else if (type === 'shot') {
      broadcast('machine.shot', { dotId: machine.dotId, shot: payload });
    }
  };

  /** The service's live events (screen, wheel, frames), for as long as it runs. */
  const followEvents = (machine) => {
    const controller = new AbortController();
    machine.events = controller;
    const { port, token } = machine;
    void (async () => {
      while (!controller.signal.aborted && machine.port === port) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`events answered ${response.status}`);
          const decoder = new TextDecoder();
          let text = '';
          for await (const chunk of response.body) {
            text += decoder.decode(chunk, { stream: true });
            let end;
            while ((end = text.indexOf('\n\n')) !== -1) {
              const block = text.slice(0, end);
              text = text.slice(end + 2);
              let type = 'message';
              const data = [];
              for (const line of block.split('\n')) {
                if (line.startsWith('event: ')) type = line.slice(7).trim();
                else if (line.startsWith('data: ')) data.push(line.slice(6));
              }
              if (!data.length) continue;
              try {
                onServiceEvent(machine, type, JSON.parse(data.join('\n')));
              } catch {}
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        await sleep(1_000);
      }
    })();
  };

  const serviceFetch = (machine, route, { method = 'GET', body, signal, timeoutMs = 10_000 } = {}) => fetch(`http://127.0.0.1:${machine.port}${route}`, {
    method,
    headers: { authorization: `Bearer ${machine.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  const launchService = (machine, account, port, token, settings) => new Promise((resolve, reject) => {
    const child = spawn('wsl.exe', execArgs(computerName(), '/usr/bin/node', ['/opt/willow/service.mjs']), {
      env: { ...process.env, WSL_UTF8: '1' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const logFile = path.join(logsDir, `${account.user}.log`);
    const serviceLog = createWriteStream(logFile, { flags: 'w' });
    child.stderr.pipe(serviceLog);
    child.stdin.on('error', () => undefined);
    let ready = false;
    let buffer = '';
    const fail = (error) => {
      clearTimeout(timer);
      if (!ready) child.kill();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('The computer did not start within a minute.')), 60_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === 'ready' && !ready) {
          ready = true;
          clearTimeout(timer);
          waitForHealth(port, 20_000).then(() => {
            machine.child = child;
            machine.port = port;
            machine.token = token;
            machine.egress = message.egress ?? null;
            machine.startedAt = Date.now();
            machine.lastCallAt = Date.now();
            followEvents(machine);
            resolve();
          }, (error) => {
            child.kill();
            reject(error);
          });
        } else if (message.type === 'error') {
          fail(Object.assign(new Error(message.message || 'The computer service failed.'), { code: message.code }));
        }
      }
    });
    child.once('exit', (code) => {
      if (machine.child !== child) {
        clearTimeout(timer);
        if (!ready) reject(Object.assign(new Error(`The computer stopped while it was starting (${code}). Details: ${logFile}`), { code: code === 98 ? 'EADDRINUSE' : undefined }));
        return;
      }
      forgetChild(machine);
      if (machine.state === 'running') setState(machine, 'stopped', { error: code ? `The computer stopped unexpectedly (${code}).` : null });
    });
    child.stdin.write(`${JSON.stringify({
      token,
      port,
      timeZone: settings.timeZone,
      locale: settings.locale,
      user: account.user,
      uid: account.uid,
      display: displayOf(account.uid),
      ports: portsOf(account.uid),
      ...(machine.look ? { look: machine.look } : {}),
    })}\n`);
  });

  const startNow = async (machine, settings) => {
    if (machine.state === 'running' && machine.child) return;
    if (registry.machines[machine.dotId]) await migrate(machine);
    const account = registry.dots[machine.dotId];
    if (!account) throw new Error('This bot does not have a computer yet.');
    setState(machine, 'starting', { error: null });
    try {
      await ensureComputer(machine);
      if (!registry.dots[machine.dotId]) throw new Error('This dot\'s computer was removed. Set it up again from its profile.');
      if (!computerFresh && !othersActive(machine)) {
        // The computer's first start in this run: whatever an earlier run left in it ends here.
        await terminateDistro(computerName());
      } else {
        // Whatever this bot left running before ends here; the other bots' work goes on.
        await runIn(computerName(), endProcessesScript(account), { timeoutMs: 30_000 });
      }
      computerFresh = true;
      // Written aside and moved into place: another bot's service may be reading the file it replaces.
      const service = await fs.readFile(SERVICE_FILE);
      const installed = await runIn(computerName(), 'mkdir -p /opt/willow && cat > /opt/willow/.service.mjs.$$ && mv -f /opt/willow/.service.mjs.$$ /opt/willow/service.mjs', { input: service, timeoutMs: 2 * 60_000 });
      if (installed.code !== 0) throw new Error(`The computer did not start: ${wslMessage(installed) || `exit ${installed.code}`}`);
      await fs.mkdir(logsDir, { recursive: true });
      let lastError = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const port = await freePort();
        const token = crypto.randomBytes(32).toString('hex');
        try {
          await launchService(machine, account, port, token, settings);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (error.code !== 'EADDRINUSE') break;
        }
      }
      if (lastError) throw lastError;
      setState(machine, 'running', { error: null });
      clearStartMenu();
      if (machine.watchers.size) await serviceFetch(machine, '/screencast', { method: 'POST', body: { on: true }, timeoutMs: 30_000 }).catch(() => undefined);
    } catch (error) {
      if (machine.child) machine.child.kill();
      forgetChild(machine);
      setState(machine, 'stopped', { error: error.message });
      throw error;
    }
  };

  const start = async (machine, settings = {}) => {
    takeLook(machine, settings);
    if (machine.state === 'running' && machine.child) return;
    if (machine.stopping) await machine.stopping.catch(() => undefined);
    if (machine.creating) await machine.creating;
    await reconcile();
    if (!registry.dots[machine.dotId] && !registry.machines[machine.dotId]) throw new Error('This bot does not have a computer yet.');
    if (!machine.starting) {
      machine.starting = exclusive(() => startNow(machine, settings)).finally(() => {
        machine.starting = null;
      });
    }
    await machine.starting;
  };

  const stopNow = async (machine) => {
    const child = machine.child;
    if (child) {
      setState(machine, 'stopping');
      await serviceFetch(machine, '/shutdown', { method: 'POST', body: {}, timeoutMs: 3_000 }).catch(() => undefined);
      if (!(await exited(child, 8_000))) child.kill();
      forgetChild(machine);
    }
    const account = registry.dots[machine.dotId];
    if (account && registry.computer) {
      if (othersActive(machine)) await runIn(computerName(), endProcessesScript(account), { timeoutMs: 30_000 }).catch(() => undefined);
      else await terminateDistro(computerName());
    }
    if (machine.state === 'stopping' || machine.state === 'running' || machine.state === 'starting') setState(machine, 'stopped', { error: null });
  };

  const stop = async (machine) => {
    if (machine.starting) await machine.starting.catch(() => undefined);
    if (!machine.stopping) {
      machine.stopping = exclusive(() => stopNow(machine)).finally(() => {
        machine.stopping = null;
      });
    }
    await machine.stopping;
  };

  /** Wipes the bot's account to a fresh one — its folder, browser, settings and history. The computer's software stays. */
  const reset = (machine) => exclusive(async () => {
    await stopNow(machine);
    if (registry.machines[machine.dotId]) await migrate(machine);
    const account = registry.dots[machine.dotId];
    if (!account) throw new Error('This bot does not have a computer yet.');
    setState(machine, 'resetting', { error: null, progress: null });
    try {
      await ensureComputer(machine);
      const wiped = await runIn(computerName(), resetAccountScript(account), { timeoutMs: 5 * 60_000 });
      if (wiped.code !== 0) throw new Error(`Resetting did not finish: ${wslMessage(wiped) || `exit ${wiped.code}`}`);
      await idleComputer(machine);
      setState(machine, 'stopped', { error: null, progress: null, screen: null, control: null });
    } catch (error) {
      setState(machine, 'stopped', { error: error.message, progress: null });
      throw error;
    }
  });

  const remove = (machine) => exclusive(async () => {
    await stopNow(machine);
    const account = registry.dots[machine.dotId];
    if (account && registry.computer && (await isRegistered(computerName()))) {
      const removed = await runIn(computerName(), removeAccountScript(account), { timeoutMs: 2 * 60_000 }).catch((error) => ({ code: -1, stdout: '', stderr: error.message }));
      if (removed.code !== 0) log(`could not remove ${account.user}`, wslMessage(removed));
      await idleComputer(machine);
    }
    const old = registry.machines[machine.dotId];
    if (old) {
      await unregisterDistro(old.name).catch((error) => log(`could not remove ${old.name}`, error.message));
      await fs.rm(path.join(dir, 'machines', keyFor(machine.dotId)), { recursive: true, force: true }).catch(() => undefined);
    }
    delete registry.dots[machine.dotId];
    delete registry.machines[machine.dotId];
    await saveRegistry();
    clearStartMenu();
    setState(machine, 'none', { error: null, screen: null, control: null });
  });

  /** A request from a page to the bot's service, starting its computer first if it is off. */
  const call = async (machine, payload) => {
    const route = typeof payload.path === 'string' ? payload.path : '';
    const method = payload.method === 'POST' ? 'POST' : 'GET';
    if (!route.startsWith('/') || MANAGER_ONLY.has(route.split('?')[0])) throw new Error('That is not something a page can ask the computer.');
    takeLook(machine, payload.settings);
    if (machine.state !== 'running' || !machine.child) await start(machine, payload.settings ?? {});
    const timeoutMs = Math.max(1_000, Math.min(15 * 60_000, Number(payload.timeoutMs) || 60_000));
    const controller = new AbortController();
    const callId = typeof payload.callId === 'string' ? payload.callId : null;
    if (callId) inflight.set(callId, controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    machine.calls += 1;
    machine.lastCallAt = Date.now();
    try {
      const response = await serviceFetch(machine, route, { method, body: method === 'POST' ? payload.body ?? {} : undefined, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, body };
    } catch (error) {
      if (controller.signal.aborted) {
        return { status: 499, body: { error: timedOut ? 'The computer did not answer in time.' : 'Stopped.', stopped: !timedOut, timedOut } };
      }
      throw new Error('The computer stopped while it was working. Try again: it starts by itself.');
    } finally {
      clearTimeout(timer);
      if (callId) inflight.delete(callId);
      machine.calls -= 1;
      machine.lastCallAt = Date.now();
    }
  };

  const setScreencast = async (machine, on) => {
    if (machine.state !== 'running' || !machine.child) return;
    await serviceFetch(machine, '/screencast', { method: 'POST', body: { on }, timeoutMs: 30_000 }).catch(() => undefined);
  };

  const watch = async (session, machine, on) => {
    session.machineWatches ??= new Set();
    if (on) {
      machine.watchers.add(session);
      session.machineWatches.add(machine.dotId);
      // Every watcher, not just the first: a still screen sends a joining one its current picture.
      await setScreencast(machine, true);
    } else if (machine.watchers.delete(session)) {
      session.machineWatches.delete(machine.dotId);
      if (machine.watchers.size === 0) await setScreencast(machine, false);
    }
    return { watching: machine.watchers.has(session) };
  };

  /** Windows asks for permission, then installs WSL; a restart may follow. */
  const installWsl = () => {
    if (process.platform !== 'win32') throw new Error("Bots' own computers need Windows for now.");
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Start-Process -FilePath wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs"], { windowsHide: true, stdio: 'ignore', detached: true });
    child.unref();
    supportCache = null;
    return { started: true };
  };

  const status = async (dotId) => {
    await loaded;
    const wsl = await support();
    if (wsl.supported) await reconcile();
    return {
      supported: wsl.supported,
      reason: wsl.reason ?? null,
      detail: wsl.detail ?? null,
      wslVersion: wsl.version ?? null,
      // With the computer made, a bot's computer is an account away, not a base build.
      base: { ready: Boolean(registry.computer) || baseReady(), building: Boolean(baseBuild), progress: baseBuild ? baseProgress : null },
      ...(dotId ? { machine: summary(machineFor(dotId)) } : {}),
    };
  };

  const idleTimer = setInterval(() => {
    for (const machine of machines.values()) {
      if (machine.state !== 'running' || !machine.child || machine.watchers.size || machine.calls) continue;
      void serviceFetch(machine, '/health', { timeoutMs: 5_000 }).then((response) => response.json()).then((health) => {
        if (health.holder === 'human') return;
        const last = Math.max(machine.lastCallAt, Number(health.lastActivityAt) || 0);
        if (Date.now() - last < IDLE_MS) return;
        log(`turning off ${registry.dots[machine.dotId]?.user ?? machine.dotId}: unused for ${Math.round(IDLE_MS / 60_000)} minutes`);
        void stop(machine).catch(() => undefined);
      }).catch(() => undefined);
    }
  }, 60_000);
  idleTimer.unref();

  // Bots with machines from before the computer was shared move onto it, without waiting to be used.
  void (async () => {
    await loaded;
    if (!Object.keys(registry.machines).length || !(await support()).supported) return;
    await reconcile();
    for (const dotId of Object.keys(registry.machines)) {
      const machine = machineFor(dotId);
      if (machine.creating) continue;
      machine.creating = exclusive(() => migrate(machine)).finally(() => {
        machine.creating = null;
      });
      await machine.creating.catch((error) => log(`could not move ${registry.machines[dotId]?.name ?? dotId}`, error.message));
    }
  })().catch(() => undefined);

  const dotOf = (payload) => {
    const dotId = typeof payload.dotId === 'string' ? payload.dotId.trim() : '';
    if (!dotId || dotId.length > 200) throw new Error('Say which bot.');
    return machineFor(dotId);
  };

  return {
    async handle(session, type, payload) {
      await loaded;
      switch (type) {
        case 'machine.status':
          return status(typeof payload.dotId === 'string' ? payload.dotId : undefined);
        case 'machine.create': {
          await requireSupport();
          const machine = dotOf(payload);
          await create(machine);
          return summary(machine);
        }
        case 'machine.start': {
          await requireSupport();
          const machine = dotOf(payload);
          await start(machine, payload.settings ?? {});
          return summary(machine);
        }
        case 'machine.stop': {
          const machine = dotOf(payload);
          await stop(machine);
          return summary(machine);
        }
        case 'machine.reset': {
          await requireSupport();
          const machine = dotOf(payload);
          await reset(machine);
          return summary(machine);
        }
        case 'machine.remove': {
          const machine = dotOf(payload);
          if (registry.dots[machine.dotId] || registry.machines[machine.dotId] || machine.state !== 'none') await remove(machine);
          return summary(machine);
        }
        case 'machine.call':
          return call(dotOf(payload), payload);
        case 'machine.look': {
          const machine = dotOf(payload);
          takeLook(machine, payload.settings);
          return { look: machine.look };
        }
        case 'machine.cancel': {
          const controller = typeof payload.callId === 'string' ? inflight.get(payload.callId) : undefined;
          controller?.abort();
          return { cancelled: Boolean(controller) };
        }
        case 'machine.watch':
          return watch(session, dotOf(payload), payload.on === true);
        case 'machine.installWsl':
          return installWsl();
        default:
          throw new Error(`Unknown companion request: ${type}`);
      }
    },

    release(session) {
      for (const dotId of session.machineWatches ?? []) {
        const machine = machines.get(dotId);
        if (machine) void watch(session, machine, false);
      }
    },

    async shutdown() {
      clearInterval(idleTimer);
      await Promise.race([
        Promise.all([...machines.values()].filter((machine) => machine.child).map((machine) => stop(machine).catch(() => undefined))),
        sleep(15_000),
      ]);
    },
  };
};
