/**
 * The user's screen on macOS, the way it is done well there: app by app, in the background, without taking the screen
 * or the focus from the user. Windows the bot works stay where they are; it reads them and acts on them through macOS's
 * own Accessibility, the way assistive software does, and reads a single window's picture with `screencapture -l`,
 * which needs neither the window in front nor the user away.
 *
 * Nothing is drawn over the user's screen — there is no takeover to show — so a grant has no overlay; it is simply the
 * permission the user gave, which the harness holds. The tools refuse Willow's own app, and need macOS's Screen
 * Recording and Accessibility permissions, which the user grants once in System Settings.
 *
 * A window's controls are read a level at a time — each property of every child in one Apple Event — within a time
 * budget, and each listed control is kept by its path through the window: acting goes straight back along that path and
 * checks it still finds the same kind of control with the same name, so a number never presses something else once
 * the app has changed. Apps built on Chromium (Electron's among them) build their tree only when asked, so it is asked.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OSASCRIPT = '/usr/bin/osascript';
const SCREENCAPTURE = '/usr/sbin/screencapture';
const ELEMENT_ACTIONS = new Set(['invoke', 'toggle', 'select', 'expand', 'collapse', 'set_value']);
const KINDS = new Set(['click', 'move', 'scroll', 'drag', 'type', 'key']);
const MAX_ELEMENTS = 120;
// How long a reading of an app may take before it returns what it has.
const WALK_BUDGET_MS = 15_000;

const defaultRun = (file, args, input) => new Promise((resolve) => {
  const child = execFile(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (error, stdout, stderr) => {
    resolve({ code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? (error ? error.message : '') });
  });
  if (input !== undefined) { child.stdin.end(input); }
});

/* ------------------------------------------------------------------------ */
/* Keys                                                                      */
/* ------------------------------------------------------------------------ */

/** Mac key codes by where the key is on the keyboard (ANSI), as the bot names them. */
const KEY_CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32,
  '[': 33, i: 34, p: 35, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, '`': 50,
  return: 36, enter: 36, tab: 48, space: 49, spacebar: 49, delete: 51, backspace: 51, escape: 53, esc: 53,
  capslock: 57, forwarddelete: 117, del: 117, help: 114, insert: 114, home: 115, end: 119, pageup: 116, pagedown: 121,
  pgup: 116, pgdn: 121, left: 123, right: 124, down: 125, up: 126, arrowleft: 123, arrowright: 124, arrowdown: 125, arrowup: 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
  numpad0: 82, numpad1: 83, numpad2: 84, numpad3: 85, numpad4: 86, numpad5: 87, numpad6: 88, numpad7: 89, numpad8: 91, numpad9: 92,
  numpaddecimal: 65, numpadmultiply: 67, numpadadd: 69, numpadclear: 71, numpaddivide: 75, numpadenter: 76, numpadsubtract: 78, numpadequals: 81,
};
/** Keys named by what they are called, and characters typed with Shift on the key beneath them. */
const KEY_NAMES = {
  plus: '+', minus: '-', hyphen: '-', equal: '=', equals: '=', comma: ',', period: '.', dot: '.', slash: '/', backslash: '\\',
  semicolon: ';', quote: "'", apostrophe: "'", backquote: '`', backtick: '`', grave: '`', bracketleft: '[', bracketright: ']',
};
const SHIFTED = {
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`',
};
// The event flags of each modifier: kCGEventFlagMaskShift, Control, Alternate, Command and SecondaryFn.
const MODIFIER_FLAGS = {
  shift: 0x20000, ctrl: 0x40000, control: 0x40000, alt: 0x80000, option: 0x80000, opt: 0x80000,
  cmd: 0x100000, command: 0x100000, meta: 0x100000, super: 0x100000, win: 0x100000, fn: 0x800000,
};

/** A key with any modifiers before it, joined with + — "cmd+shift+t", "option+left", "?" — as a Mac key code and flags. */
export function macKey(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('Give the "key" to press.');
  const parts = trimmed === '+' ? ['+'] : trimmed.endsWith('++') ? [...trimmed.slice(0, -2).split('+'), '+'] : trimmed.split('+');
  const names = parts.map((part) => part.trim()).filter(Boolean);
  const last = names.pop();
  let flags = 0;
  for (const name of names) {
    const flag = MODIFIER_FLAGS[name.toLowerCase()];
    if (!flag) throw new Error(`"${name}" is not a modifier key; use cmd, ctrl, option or shift.`);
    flags |= flag;
  }
  const lower = last.toLowerCase();
  if (MODIFIER_FLAGS[lower] && !names.length) throw new Error(`"${last}" is a modifier: give the key to press with it, such as cmd+s.`);
  const named = KEY_NAMES[lower] ?? (last.length === 1 ? last : lower);
  if (SHIFTED[named] !== undefined) return { code: KEY_CODES[SHIFTED[named]], flags: flags | MODIFIER_FLAGS.shift };
  const key = named.length === 1 ? named.toLowerCase() : named;
  const code = KEY_CODES[key];
  if (code === undefined) throw new Error(`"${last}" is not a key the Mac knows. Use a key name such as Return, Escape, Tab, an arrow, Home, PageDown or F5, or a single character.`);
  return { code, flags };
}

/* ------------------------------------------------------------------------ */
/* What the reading of an app comes to                                        */
/* ------------------------------------------------------------------------ */

const ROLE_NAMES = {
  AXButton: 'button', AXCheckBox: 'checkbox', AXRadioButton: 'radio', AXTextField: 'textbox', AXTextArea: 'textbox',
  AXComboBox: 'combobox', AXPopUpButton: 'popup button', AXMenuButton: 'menu button', AXMenuItem: 'menu item',
  AXMenuBarItem: 'menu', AXLink: 'link', AXSlider: 'slider', AXIncrementor: 'stepper', AXRow: 'row', AXCell: 'cell',
  AXDisclosureTriangle: 'disclosure', AXStaticText: 'text', AXImage: 'image', AXHeading: 'heading', AXGroup: 'group',
  AXColorWell: 'color well', AXSegmentedControl: 'segmented control', AXTabGroup: 'tabs', AXSheet: 'sheet',
};
const SUBROLE_NAMES = { AXTabButton: 'tab', AXSearchField: 'search box', AXSwitch: 'switch', AXSecureTextField: 'password box', AXToggle: 'toggle' };
const TEXT_ROLES = new Set(['AXTextField', 'AXTextArea', 'AXComboBox']);
const TOGGLES = new Set(['AXCheckBox', 'AXRadioButton']);
const SELECTABLE = new Set(['AXRow', 'AXCell']);

/** A control as the reading found it, in the words the tools use: what it is, what it is called and what it takes. */
export function macElement(raw, index) {
  const role = String(raw.role ?? '');
  const subrole = String(raw.subrole ?? '');
  const ax = new Set(Array.isArray(raw.actions) ? raw.actions : []);
  const actions = [];
  if (ax.has('AXPress')) actions.push(TOGGLES.has(role) || subrole === 'AXSwitch' ? 'toggle' : 'invoke');
  if (SELECTABLE.has(role) || subrole === 'AXTabButton') actions.push('select');
  if (ax.has('AXShowMenu') || role === 'AXDisclosureTriangle' || raw.disclosing !== undefined) actions.push('expand', 'collapse');
  // A password box is the user's to fill.
  if ((TEXT_ROLES.has(role) || subrole === 'AXSearchField') && subrole !== 'AXSecureTextField' && raw.enabled !== false) actions.push('set_value');
  const element = {
    index,
    role: SUBROLE_NAMES[subrole] ?? ROLE_NAMES[role] ?? (role.replace(/^AX/, '').toLowerCase() || 'element'),
    name: String(raw.name ?? '').slice(0, 160),
  };
  const value = raw.value === null || raw.value === undefined ? '' : String(raw.value);
  if ((TOGGLES.has(role) || subrole === 'AXSwitch') && /^[012]$/.test(value)) element.state = ['off', 'on', 'mixed'][Number(value)];
  else if (value && role !== 'AXStaticText' && subrole !== 'AXSecureTextField') element.value = value.slice(0, 200);
  if (actions.length) element.actions = [...new Set(actions)];
  if (raw.enabled === false) element.disabled = true;
  const [x, y] = Array.isArray(raw.position) ? raw.position : [];
  const [width, height] = Array.isArray(raw.size) ? raw.size : [];
  if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
    element.center = { x: Math.round(x + width / 2), y: Math.round(y + height / 2), left: Math.round(x), top: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }
  return element;
}

/* ------------------------------------------------------------------------ */
/* The scripts                                                                */
/* ------------------------------------------------------------------------ */

/** The JXA that finds an app by pid and refuses Willow; `body` runs with `proc` set. */
const withProcess = (pid, body) => `
  const system = Application('System Events');
  const procs = system.processes.whose({ unixId: ${Number(pid) || 0} })();
  if (!procs.length) { JSON.stringify({ error: 'That app is not running.' }); } else {
    const proc = procs[0];
    if ((proc.name() || '').toLowerCase().indexOf('willow') >= 0) { JSON.stringify({ error: 'willow' }); } else {
      ${body}
    }
  }
`;

/**
 * The JXA that reads an app's controls: every window, a level at a time, each property of all of a level's children in
 * one Apple Event (read child by child only where that fails), within `budgetMs`. Each control comes with its path —
 * window, then child after child — so acting can go straight back to it.
 */
export function macWalkScript({ pid, budgetMs = WALK_BUDGET_MS, enhance = false, wait = false }) {
  return `
    ObjC.import('ApplicationServices');
    ObjC.import('CoreFoundation');
    // Chromium's apps, Electron's among them, build their tree only for assistive software that asks.
    try {
      const app = $.AXUIElementCreateApplication(${Number(pid) || 0});
      $.AXUIElementSetAttributeValue(app, $('AXManualAccessibility'), $.kCFBooleanTrue);
      if (${enhance ? 'true' : 'false'}) $.AXUIElementSetAttributeValue(app, $('AXEnhancedUserInterface'), $.kCFBooleanTrue);
    } catch (e) {}
    ${withProcess(pid, `
      if (${wait ? 'true' : 'false'}) delay(0.6);
      const until = Date.now() + ${Math.max(1_000, Number(budgetMs) || WALK_BUDGET_MS)};
      const LIMIT = ${MAX_ELEMENTS};
      const LEAVES = { AXStaticText: 1, AXTextField: 1, AXTextArea: 1, AXButton: 1, AXImage: 1, AXCheckBox: 1, AXRadioButton: 1, AXPopUpButton: 1, AXSlider: 1, AXMenuButton: 1, AXIncrementor: 1, AXColorWell: 1, AXScrollBar: 1, AXValueIndicator: 1 };
      const SKIP = { AXScrollBar: 1, AXValueIndicator: 1, AXGrowArea: 1, AXUnknown: 1 };
      const ACTING = { AXButton: 1, AXCheckBox: 1, AXRadioButton: 1, AXTextField: 1, AXTextArea: 1, AXComboBox: 1, AXPopUpButton: 1, AXMenuButton: 1, AXMenuItem: 1, AXLink: 1, AXSlider: 1, AXIncrementor: 1, AXRow: 1, AXCell: 1, AXDisclosureTriangle: 1, AXColorWell: 1, AXSegmentedControl: 1 };
      const READING = { AXStaticText: 1, AXHeading: 1, AXImage: 1 };
      const out = [];
      let truncated = false;
      const read = (kids, property, count) => {
        try { const values = kids[property](); if (Array.isArray(values) && values.length === count) return values; } catch (e) {}
        const values = [];
        for (let i = 0; i < count; i++) { try { values.push(kids[i][property]()); } catch (e) { values.push(null); } }
        return values;
      };
      const walk = (parent, path, depth) => {
        if (depth > 14 || out.length >= LIMIT) return;
        if (Date.now() > until) { truncated = true; return; }
        const kids = parent.uiElements;
        let count = 0;
        try { count = kids.length; } catch (e) { return; }
        if (!count) return;
        const roles = read(kids, 'role', count);
        const subroles = read(kids, 'subrole', count);
        const titles = read(kids, 'title', count);
        const descriptions = read(kids, 'description', count);
        const values = read(kids, 'value', count);
        const enabled = read(kids, 'enabled', count);
        const positions = read(kids, 'position', count);
        const sizes = read(kids, 'size', count);
        for (let i = 0; i < count; i++) {
          if (out.length >= LIMIT || Date.now() > until) { truncated = true; return; }
          const role = roles[i] || '';
          if (SKIP[role]) continue;
          const value = values[i];
          const name = String(titles[i] || descriptions[i] || (role === 'AXStaticText' && value !== null && value !== undefined ? value : '') || '').trim();
          const size = sizes[i];
          const shown = Array.isArray(size) && size[0] > 0 && size[1] > 0;
          const here = path.concat([i]);
          let actions = [];
          const named = name.length > 0;
          if (shown && (ACTING[role] || (named && role === 'AXGroup'))) { try { actions = kids[i].actions.name(); } catch (e) {} }
          if (shown && (ACTING[role] || actions.indexOf('AXPress') >= 0 || (named && READING[role]))) {
            const entry = { path: here, role: role, subrole: subroles[i] || '', name: name, value: typeof value === 'string' || typeof value === 'number' ? value : null, enabled: enabled[i], position: positions[i], size: size, actions: actions };
            if (role === 'AXRow') { try { entry.disclosing = kids[i].attributes.byName('AXDisclosing').value(); } catch (e) {} }
            out.push(entry);
          }
          if (!LEAVES[role]) walk(kids[i], here, depth + 1);
        }
      };
      const windows = proc.windows;
      let count = 0;
      try { count = windows.length; } catch (e) {}
      for (let w = 0; w < count && out.length < LIMIT; w++) walk(windows[w], [w], 0);
      JSON.stringify({ window: proc.name(), elements: out, truncated: truncated || out.length >= LIMIT });
    `)}
  `;
}

/**
 * The JXA that acts on one control: straight back along its path, and only if what is there is still the same kind of
 * control with the same name — else the app has changed and the bot is told to look again.
 */
export function macElementScript({ pid, path: route, role, name, action, value }) {
  return withProcess(pid, `
    const route = ${JSON.stringify(route)};
    let node = proc.windows[route[0]];
    for (let i = 1; i < route.length; i++) node = node.uiElements[route[i]];
    const get = (property) => { try { return node[property](); } catch (e) { return null; } };
    const role = get('role') || '';
    const text = role === 'AXStaticText' ? get('value') : null;
    const name = String(get('title') || get('description') || (text !== null && text !== undefined ? text : '') || '').trim();
    const expected = ${JSON.stringify({ role, name })};
    if (!role || role !== expected.role || (expected.name && name !== expected.name)) {
      JSON.stringify({ error: 'That control has changed since you listed it — the app moved on. List its controls again.' });
    } else {
      const action = ${JSON.stringify(action)};
      const press = (which) => { node.actions.byName(which).perform(); };
      const has = (which) => { try { return node.actions.name().indexOf(which) >= 0; } catch (e) { return false; } };
      try {
        let enabled = true;
        try { enabled = node.enabled(); } catch (e) {}
        if (enabled === false) throw new Error('That control is disabled right now, so nothing was done.');
        if (action === 'set_value') {
          try { node.focused = true; } catch (e) {}
          node.value = ${JSON.stringify(value ?? '')};
        } else if (action === 'select') {
          try { node.selected = true; } catch (e) { if (has('AXPress')) press('AXPress'); else throw e; }
        } else if (action === 'expand' || action === 'collapse') {
          let done = false;
          try { node.attributes.byName('AXDisclosing').value = action === 'expand'; done = true; } catch (e) {}
          if (!done && action === 'expand' && has('AXShowMenu')) { press('AXShowMenu'); done = true; }
          if (!done && action === 'collapse' && has('AXCancel')) { press('AXCancel'); done = true; }
          if (!done && has('AXPress')) { press('AXPress'); done = true; }
          if (!done) throw new Error('That control does not open or close.');
        } else if (has('AXPress')) {
          press('AXPress');
        } else if (has('AXShowMenu')) {
          press('AXShowMenu');
        } else {
          try { node.selected = true; } catch (e) { throw new Error('That control cannot be pressed this way.'); }
        }
        JSON.stringify({ ok: true, name: name });
      } catch (e) { JSON.stringify({ error: e && e.message ? e.message : String(e) }); }
    }
  `);
}

export function createMacScreen({ log = () => {}, run = defaultRun, dir } = {}) {
  const shotDir = dir || path.join(os.tmpdir(), 'willow-screen');
  const snapshots = new Map();
  let snapshotCounter = 0;
  // Apps already asked to build their whole tree for assistive software, which takes a moment the first time.
  const enhanced = new Set();

  /** Runs JXA (JavaScript for Automation) and parses the JSON it prints; throws what it reported. */
  const jxa = async (script) => {
    const outcome = await run(OSASCRIPT, ['-l', 'JavaScript', '-e', script]);
    const text = String(outcome.stdout ?? '').trim();
    if (!text) {
      const why = String(outcome.stderr ?? '').trim();
      if (/not allowed assistive|accessibility/i.test(why)) throw new Error('macOS has not given Willow permission to control the computer. Turn Willow on in System Settings › Privacy & Security › Accessibility, then try again.');
      throw new Error(why || 'The screen helper returned nothing.');
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error(text.slice(0, 300)); }
    if (parsed && parsed.error === 'willow') return { refused: 'willow', message: 'That is Willow itself, which a bot never acts on.' };
    if (parsed && parsed.error) throw new Error(String(parsed.error));
    return parsed;
  };

  const available = async () => {
    try {
      await fs.access(OSASCRIPT);
      await fs.access(SCREENCAPTURE);
      return true;
    } catch { return false; }
  };

  const APPS = `
    ObjC.import('CoreGraphics');
    ObjC.import('AppKit');
    const windows = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
    const count = $.CFArrayGetCount(windows);
    const apps = [];
    for (let index = 0; index < count; index++) {
      const entry = ObjC.deepUnwrap($.CFArrayGetValueAtIndex(windows, index));
      if (!entry || entry.kCGWindowLayer !== 0) continue;
      const bounds = entry.kCGWindowBounds || {};
      if ((bounds.Width || 0) < 80 || (bounds.Height || 0) < 80) continue;
      apps.push({
        title: entry.kCGWindowName || '',
        app: entry.kCGWindowOwnerName || '',
        pid: entry.kCGWindowOwnerPID || 0,
        window: entry.kCGWindowNumber || 0,
        bounds: { left: Math.round(bounds.X || 0), top: Math.round(bounds.Y || 0), width: Math.round(bounds.Width || 0), height: Math.round(bounds.Height || 0) },
      });
      if (apps.length >= 40) break;
    }
    JSON.stringify({ apps });
  `;

  const info = async () => {
    const screens = await jxa(`
      ObjC.import('AppKit');
      const list = $.NSScreen.screens;
      const monitors = [];
      for (let index = 0; index < list.count; index++) {
        const frame = list.objectAtIndex(index).frame;
        const scale = list.objectAtIndex(index).backingScaleFactor;
        monitors.push({ index: index + 1, left: Math.round(frame.origin.x), top: Math.round(frame.origin.y), width: Math.round(frame.size.width), height: Math.round(frame.size.height), scale: scale });
      }
      JSON.stringify({ monitors });
    `).catch(() => ({ monitors: [] }));
    return { platform: 'mac', mode: 'background', monitors: screens.monitors, locked: false, userIdleMs: null };
  };

  const willowApp = (app) => /willow/i.test(app || '');

  const capture = async (payload = {}) => {
    const window = Math.round(Number(payload.window)) || 0;
    if (!window) throw new Error('Give the "window" to capture: its id from user_apps.');
    await fs.mkdir(shotDir, { recursive: true });
    const file = path.join(shotDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`);
    // -x no sound, -o no window shadow, -l a single window by id: off-screen, no focus taken.
    const outcome = await run(SCREENCAPTURE, ['-x', '-o', '-l', String(window), file]);
    if (outcome.code !== 0) {
      if (/could not create image|screen recording/i.test(outcome.stderr || '')) throw new Error('macOS has not given Willow permission to record the screen. Turn Willow on in System Settings › Privacy & Security › Screen Recording, then try again.');
      throw new Error(outcome.stderr?.trim() || 'That window could not be captured.');
    }
    const data = await fs.readFile(file).catch(() => null);
    await fs.rm(file, { force: true }).catch(() => {});
    if (!data || data.length === 0) return { refused: 'willow', message: 'That window is gone, or belongs to a protected app.' };
    // A PNG's size is in its header (IHDR): width and height at bytes 16 and 20, in the window's real pixels.
    const sized = data.length >= 24 && data.toString('ascii', 12, 16) === 'IHDR';
    return { data: data.toString('base64'), format: 'png', window, ...(sized ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : {}) };
  };

  const elements = async (payload = {}) => {
    const pid = Math.round(Number(payload.pid)) || 0;
    if (!pid) throw new Error('Give the "pid" of the app whose controls you want: from user_apps.');
    let result = await jxa(macWalkScript({ pid, enhance: enhanced.has(pid) }));
    if (result.refused) return result;
    // Next to nothing to work: perhaps an app that builds its tree only once assistive software is plainly there.
    if ((result.elements ?? []).length < 3 && !enhanced.has(pid)) {
      enhanced.add(pid);
      const again = await jxa(macWalkScript({ pid, enhance: true, wait: true })).catch(() => null);
      if (again && !again.refused && (again.elements ?? []).length > (result.elements ?? []).length) result = again;
    }
    const raw = result.elements ?? [];
    const id = ++snapshotCounter;
    snapshots.set(id, { pid, elements: raw });
    for (const key of [...snapshots.keys()].slice(0, -2)) snapshots.delete(key);
    return { snapshot: id, window: result.window, process: String(pid), elements: raw.map((entry, index) => macElement(entry, index)), truncated: Boolean(result.truncated) };
  };

  const element = async (payload = {}) => {
    const id = Math.round(Number(payload.snapshot)) || 0;
    const index = Math.round(Number(payload.index));
    const action = String(payload.action ?? 'invoke');
    if (!ELEMENT_ACTIONS.has(action)) throw new Error(`Unknown action on an element: ${action}.`);
    const snapshot = snapshots.get(id);
    if (!snapshot) throw new Error('That list of elements is out of date. Call user_elements again for a fresh one.');
    const raw = snapshot.elements[index];
    if (!raw || !Array.isArray(raw.path)) throw new Error(`There is no element ${index} in that list.`);
    if (action === 'set_value' && raw.subrole === 'AXSecureTextField') throw new Error('That is a password box: ask the user to fill it in themselves.');
    const value = typeof payload.value === 'string' ? payload.value : '';
    const result = await jxa(macElementScript({ pid: snapshot.pid, path: raw.path, role: raw.role, name: raw.name, action, value }));
    if (result.refused) return result;
    return { ok: true, name: result.name ?? '' };
  };

  const focus = async (payload = {}) => {
    const pid = Math.round(Number(payload.pid)) || 0;
    if (!pid) throw new Error('Give the "pid" of the app to bring forward: from user_apps.');
    const result = await jxa(withProcess(pid, `
      proc.frontmost = true;
      JSON.stringify({ ok: true, title: proc.name() });
    `));
    if (result.refused) return { refused: 'willow', message: 'That is Willow itself, which a bot never brings forward.' };
    return { ok: true, foreground: true, title: result.title ?? '' };
  };

  // Raw pointer and keys, delivered straight to one app so they need neither the window in front nor the cursor —
  // CGEventPostToPid, as macOS's own automation does. Coordinates are global screen points.
  const act = async (payload = {}) => {
    const kind = String(payload.kind ?? '');
    if (!KINDS.has(kind)) throw new Error(`Unknown action on the screen: ${kind || 'none'}.`);
    const pid = Math.round(Number(payload.pid)) || 0;
    if (!pid) throw new Error('Give the "pid" of the app to act in: from user_apps.');
    const key = kind === 'key' ? macKey(payload.key) : { code: -1, flags: 0 };
    const spec = {
      kind,
      pid,
      x: Math.round(Number(payload.x)) || 0,
      y: Math.round(Number(payload.y)) || 0,
      toX: Math.round(Number(payload.toX)) || 0,
      toY: Math.round(Number(payload.toY)) || 0,
      clicks: Math.max(1, Math.min(3, Math.round(Number(payload.clicks)) || 1)),
      deltaX: Math.round(Number(payload.deltaX)) || 0,
      deltaY: Math.round(Number(payload.deltaY)) || 0,
      button: typeof payload.button === 'string' ? payload.button : 'left',
      text: typeof payload.text === 'string' ? payload.text : '',
      code: key.code,
      flags: key.flags,
    };
    const result = await jxa(macActScript(spec));
    return { ok: true, ...(result && typeof result === 'object' ? result : {}) };
  };

  return {
    platform: 'mac',
    requests: ['screen.info', 'screen.capture', 'screen.act', 'screen.apps', 'screen.elements', 'screen.element', 'screen.focus', 'screen.begin', 'screen.end'],
    handles: (type) => type.startsWith('screen.'),
    async handle(type, payload = {}) {
      if (type === 'screen.info') return { ...(await info()), available: await available() };
      if (type === 'screen.apps') {
        const apps = await jxa(APPS);
        return { apps: (apps.apps ?? []).filter((app) => !willowApp(app.app)) };
      }
      if (type === 'screen.capture') return capture(payload);
      if (type === 'screen.elements') return elements(payload);
      if (type === 'screen.element') return element(payload);
      if (type === 'screen.focus') return focus(payload);
      if (type === 'screen.act') return act(payload);
      // macOS works in the background, so a grant shows nothing: there is no takeover to display.
      if (type === 'screen.begin' || type === 'screen.end') return { shown: false };
      throw new Error(`Unknown companion request: ${type}`);
    },
    dispose() {},
  };
}

/** The JXA that posts raw events to a pid; split out so a test can read what a kind becomes. */
export function macActScript(spec) {
  return `
    ObjC.import('CoreGraphics');
    const pid = ${spec.pid};
    const post = (event) => { if (pid) $.CGEventPostToPid(pid, event); else $.CGEventPost($.kCGHIDEventTap, event); };
    const button = ${JSON.stringify(spec.button)};
    const down = button === 'right' ? $.kCGEventRightMouseDown : $.kCGEventLeftMouseDown;
    const up = button === 'right' ? $.kCGEventRightMouseUp : $.kCGEventLeftMouseUp;
    const cgButton = button === 'right' ? $.kCGMouseButtonRight : $.kCGMouseButtonLeft;
    const kind = ${JSON.stringify(spec.kind)};
    const at = (x, y) => $.CGPointMake(x, y);
    const press = (code, flags) => {
      const d = $.CGEventCreateKeyboardEvent($(), code, true); $.CGEventSetFlags(d, flags); post(d);
      const u = $.CGEventCreateKeyboardEvent($(), code, false); $.CGEventSetFlags(u, flags); post(u);
    };
    try {
      if (kind === 'move') {
        post($.CGEventCreateMouseEvent($(), $.kCGEventMouseMoved, at(${spec.x}, ${spec.y}), cgButton));
      } else if (kind === 'click') {
        for (let i = 0; i < ${spec.clicks}; i++) {
          const d = $.CGEventCreateMouseEvent($(), down, at(${spec.x}, ${spec.y}), cgButton);
          $.CGEventSetIntegerValueField(d, $.kCGMouseEventClickState, i + 1);
          post(d);
          const u = $.CGEventCreateMouseEvent($(), up, at(${spec.x}, ${spec.y}), cgButton);
          $.CGEventSetIntegerValueField(u, $.kCGMouseEventClickState, i + 1);
          post(u);
        }
      } else if (kind === 'drag') {
        post($.CGEventCreateMouseEvent($(), down, at(${spec.x}, ${spec.y}), cgButton));
        const steps = 12;
        for (let i = 1; i <= steps; i++) {
          const x = ${spec.x} + (${spec.toX} - ${spec.x}) * i / steps;
          const y = ${spec.y} + (${spec.toY} - ${spec.y}) * i / steps;
          post($.CGEventCreateMouseEvent($(), $.kCGEventLeftMouseDragged, at(x, y), cgButton));
          delay(0.016);
        }
        post($.CGEventCreateMouseEvent($(), up, at(${spec.toX}, ${spec.toY}), cgButton));
      } else if (kind === 'scroll') {
        post($.CGEventCreateScrollWheelEvent2($(), $.kCGScrollEventUnitPixel, 2, -${spec.deltaY}, -${spec.deltaX}, 0));
      } else if (kind === 'type') {
        const text = ${JSON.stringify(spec.text)};
        // A whole character at a time — both halves of an emoji together — and new lines and tabs as their keys.
        for (const character of text) {
          if (character === '\\n') { press(36, 0); continue; }
          if (character === '\\t') { press(48, 0); continue; }
          const units = [];
          for (let i = 0; i < character.length; i++) units.push(character.charCodeAt(i));
          const event = $.CGEventCreateKeyboardEvent($(), 0, true);
          $.CGEventKeyboardSetUnicodeString(event, units.length, units);
          post(event);
          const eventUp = $.CGEventCreateKeyboardEvent($(), 0, false);
          $.CGEventKeyboardSetUnicodeString(eventUp, units.length, units);
          post(eventUp);
          delay(0.003);
        }
      } else if (kind === 'key') {
        press(${spec.code}, ${spec.flags});
      }
      JSON.stringify({ ok: true });
    } catch (e) { JSON.stringify({ error: String(e) }); }
  `;
}
