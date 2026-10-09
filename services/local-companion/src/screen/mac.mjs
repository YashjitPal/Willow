/**
 * The user's screen on macOS, the way it is done well there: app by app, in the background, without taking the screen
 * or the focus from the user. Windows the bot works stay where they are; it reads them and acts on them through macOS's
 * own Accessibility, the way assistive software does, and reads a single window's picture with `screencapture -l`,
 * which needs neither the window in front nor the user away.
 *
 * Nothing is drawn over the user's screen — there is no takeover to show — so a grant has no overlay; it is simply the
 * permission the user gave, which the harness holds. The tools refuse Willow's own app, and need macOS's Screen
 * Recording and Accessibility permissions, which the user grants once in System Settings.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OSASCRIPT = '/usr/bin/osascript';
const SCREENCAPTURE = '/usr/sbin/screencapture';
const ELEMENT_ACTIONS = new Set(['invoke', 'toggle', 'select', 'expand', 'collapse', 'set_value']);
const KINDS = new Set(['click', 'move', 'scroll', 'drag', 'type', 'key']);

const defaultRun = (file, args, input) => new Promise((resolve) => {
  const child = execFile(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (error, stdout, stderr) => {
    resolve({ code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? (error ? error.message : '') });
  });
  if (input !== undefined) { child.stdin.end(input); }
});

export function createMacScreen({ log = () => {}, run = defaultRun, dir } = {}) {
  const shotDir = dir || path.join(os.tmpdir(), 'willow-screen');
  const snapshots = new Map();
  let snapshotCounter = 0;

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

  /* ------------------------------------------------------------------ */
  /* The scripts                                                         */
  /* ------------------------------------------------------------------ */

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
    const result = await jxa(`
      ObjC.import('AppKit');
      const system = Application('System Events');
      const procs = system.processes.whose({ unixId: ${pid} })();
      if (!procs.length) { JSON.stringify({ error: 'That app is not running.' }); } else {
        const proc = procs[0];
        if ((proc.name() || '').toLowerCase().indexOf('willow') >= 0) { JSON.stringify({ error: 'willow' }); } else {
          const out = [];
          const walk = (element, depth) => {
            if (out.length >= 120 || depth > 12) return;
            let kids = [];
            try { kids = element.uiElements(); } catch (e) { kids = []; }
            for (let index = 0; index < kids.length; index++) {
              if (out.length >= 120) break;
              const node = kids[index];
              let role = ''; let title = ''; let value = ''; let actions = []; let position = null; let size = null;
              try { role = node.role(); } catch (e) {}
              try { title = node.title() || node.description() || node.name() || ''; } catch (e) {}
              try { value = String(node.value() || ''); } catch (e) {}
              try { actions = node.actions().map((a) => a.name()); } catch (e) {}
              try { const p = node.position(); position = { x: Math.round(p[0]), y: Math.round(p[1]) }; } catch (e) {}
              try { const s = node.size(); size = { width: Math.round(s[0]), height: Math.round(s[1]) }; } catch (e) {}
              const canAct = actions.indexOf('AXPress') >= 0 || role === 'AXTextField' || role === 'AXTextArea' || role === 'AXCheckBox' || role === 'AXRadioButton' || role === 'AXMenuItem' || role === 'AXButton';
              if ((canAct || title) && position && size) {
                out.push({ index: out.length, role: role, name: title.slice(0, 160), value: value.slice(0, 200), actions: actions, center: { x: position.x + Math.round(size.width / 2), y: position.y + Math.round(size.height / 2), left: position.x, top: position.y, width: size.width, height: size.height } });
              }
              walk(node, depth + 1);
            }
          };
          let windows = [];
          try { windows = proc.windows(); } catch (e) { windows = []; }
          for (let index = 0; index < windows.length; index++) walk(windows[index], 0);
          JSON.stringify({ window: proc.name(), elements: out, truncated: out.length >= 120 });
        }
      }
    `);
    const id = ++snapshotCounter;
    snapshots.set(id, { pid, elements: result.elements });
    for (const key of [...snapshots.keys()].slice(0, -2)) snapshots.delete(key);
    return { snapshot: id, window: result.window, process: String(pid), elements: result.elements, truncated: Boolean(result.truncated) };
  };

  const element = async (payload = {}) => {
    const id = Math.round(Number(payload.snapshot)) || 0;
    const index = Math.round(Number(payload.index));
    const action = String(payload.action ?? 'invoke');
    if (!ELEMENT_ACTIONS.has(action)) throw new Error(`Unknown action on an element: ${action}.`);
    const snapshot = snapshots.get(id);
    if (!snapshot) throw new Error('That list of elements is out of date. Call user_elements again for a fresh one.');
    const descriptor = snapshot.elements[index];
    if (!descriptor) throw new Error(`There is no element ${index} in that list.`);
    const value = typeof payload.value === 'string' ? payload.value : '';
    // Re-walk to the same element by its reading-order index, then act on it the way the user's assistive tools do.
    const result = await jxa(`
      const system = Application('System Events');
      const procs = system.processes.whose({ unixId: ${snapshot.pid} })();
      if (!procs.length) { JSON.stringify({ error: 'That app is no longer running.' }); } else {
        const proc = procs[0];
        const flat = [];
        const walk = (element, depth) => {
          if (flat.length > 400 || depth > 12) return;
          let kids = [];
          try { kids = element.uiElements(); } catch (e) { kids = []; }
          for (let i = 0; i < kids.length; i++) {
            const node = kids[i];
            let role = ''; let title = ''; let actions = []; let position = null; let size = null;
            try { role = node.role(); } catch (e) {}
            try { title = node.title() || node.description() || node.name() || ''; } catch (e) {}
            try { actions = node.actions().map((a) => a.name()); } catch (e) {}
            try { node.position(); position = true; } catch (e) {}
            try { node.size(); size = true; } catch (e) {}
            const canAct = actions.indexOf('AXPress') >= 0 || role === 'AXTextField' || role === 'AXTextArea' || role === 'AXCheckBox' || role === 'AXRadioButton' || role === 'AXMenuItem' || role === 'AXButton';
            if ((canAct || title) && position && size) flat.push(node);
            walk(node, depth + 1);
          }
        };
        let windows = [];
        try { windows = proc.windows(); } catch (e) {}
        for (let i = 0; i < windows.length; i++) walk(windows[i], 0);
        const node = flat[${index}];
        if (!node) { JSON.stringify({ error: 'That element is gone — the app changed. Call user_elements again.' }); } else {
          const action = ${JSON.stringify(action)};
          try {
            if (action === 'set_value') { node.value = ${JSON.stringify(value)}; }
            else if (action === 'toggle' || action === 'invoke' || action === 'select') { node.actions['AXPress'] ? node.actions['AXPress'].perform() : node.perform({ action: 'AXPress' }); }
            else if (action === 'expand') { try { node.perform({ action: 'AXExpand' }); } catch (e) { node.perform({ action: 'AXPress' }); } }
            else if (action === 'collapse') { try { node.perform({ action: 'AXCollapse' }); } catch (e) { node.perform({ action: 'AXPress' }); } }
            let name = ''; try { name = node.title() || node.description() || ''; } catch (e) {}
            JSON.stringify({ ok: true, name: name });
          } catch (e) { JSON.stringify({ error: String(e) }); }
        }
      }
    `);
    return { ok: true, name: result.name ?? '' };
  };

  const focus = async (payload = {}) => {
    const pid = Math.round(Number(payload.pid)) || 0;
    if (!pid) throw new Error('Give the "pid" of the app to bring forward: from user_apps.');
    const result = await jxa(`
      const system = Application('System Events');
      const procs = system.processes.whose({ unixId: ${pid} })();
      if (!procs.length) { JSON.stringify({ error: 'That app is not running.' }); } else {
        const proc = procs[0];
        if ((proc.name() || '').toLowerCase().indexOf('willow') >= 0) { JSON.stringify({ error: 'That is Willow itself, which a bot never brings forward.' }); } else {
          proc.frontmost = true;
          JSON.stringify({ ok: true, title: proc.name() });
        }
      }
    `);
    return { ok: true, foreground: true, title: result.title ?? '' };
  };

  // Raw pointer and keys, delivered straight to one app so they need neither the window in front nor the cursor —
  // CGEventPostToPid, as macOS's own automation does. Coordinates are global screen points.
  const act = async (payload = {}) => {
    const kind = String(payload.kind ?? '');
    if (!KINDS.has(kind)) throw new Error(`Unknown action on the screen: ${kind || 'none'}.`);
    const pid = Math.round(Number(payload.pid)) || 0;
    if (!pid && kind !== 'type' && kind !== 'key') throw new Error('Give the "pid" of the app to act in: from user_apps.');
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
      key: typeof payload.key === 'string' ? payload.key : '',
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

/** The JXA that posts one raw event to a pid; split out so a test can read what a kind becomes. */
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
        }
        post($.CGEventCreateMouseEvent($(), up, at(${spec.toX}, ${spec.toY}), cgButton));
      } else if (kind === 'scroll') {
        post($.CGEventCreateScrollWheelEvent($(), $.kCGScrollEventUnitPixel, 2, -${spec.deltaY}, -${spec.deltaX}));
      } else if (kind === 'type') {
        const text = ${JSON.stringify(spec.text)};
        for (let i = 0; i < text.length; i++) {
          const event = $.CGEventCreateKeyboardEvent($(), 0, true);
          $.CGEventKeyboardSetUnicodeString(event, 1, [text.charCodeAt(i)]);
          post(event);
          const eventUp = $.CGEventCreateKeyboardEvent($(), 0, false);
          $.CGEventKeyboardSetUnicodeString(eventUp, 1, [text.charCodeAt(i)]);
          post(eventUp);
        }
      } else if (kind === 'key') {
        const map = { 'enter': 36, 'return': 36, 'tab': 48, 'space': 49, 'esc': 53, 'escape': 53, 'delete': 51, 'backspace': 51, 'left': 123, 'right': 124, 'down': 125, 'up': 126,
          'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7, 'c': 8, 'v': 9, 'b': 11, 'q': 12, 'w': 13, 'e': 14, 'r': 15, 'y': 16, 't': 17,
          '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '9': 25, '7': 26, '8': 28, '0': 29, 'o': 31, 'u': 32, 'i': 34, 'p': 35, 'l': 37, 'j': 38, 'k': 40, 'n': 45, 'm': 46 };
        const parts = ${JSON.stringify(spec.key)}.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
        const mods = { 'cmd': $.kCGEventFlagMaskCommand, 'command': $.kCGEventFlagMaskCommand, 'ctrl': $.kCGEventFlagMaskControl, 'control': $.kCGEventFlagMaskControl, 'alt': $.kCGEventFlagMaskAlternate, 'option': $.kCGEventFlagMaskAlternate, 'shift': $.kCGEventFlagMaskShift };
        let flags = 0; let code = -1;
        for (const part of parts) { if (mods[part] !== undefined) flags |= mods[part]; else if (map[part] !== undefined) code = map[part]; }
        if (code >= 0) {
          const d = $.CGEventCreateKeyboardEvent($(), code, true); if (flags) $.CGEventSetFlags(d, flags); post(d);
          const u = $.CGEventCreateKeyboardEvent($(), code, false); if (flags) $.CGEventSetFlags(u, flags); post(u);
        }
      }
      JSON.stringify({ ok: true });
    } catch (e) { JSON.stringify({ error: String(e) }); }
  `;
}
