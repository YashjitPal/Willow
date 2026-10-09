/**
 * Using the app in the preview frame the way a person would.
 *
 * Runs in the workbench's window against the preview iframe's document, which
 * is same-origin. Every event is constructed from the frame's own constructors
 * and dispatched on the element a person would hit, so React's root listeners,
 * native default actions (a checkbox toggling, a link following, a form
 * submitting) and focus all behave as they do for a real click or keystroke.
 *
 * Three things here are easy to get wrong and each broke the old test agent:
 *
 * - **Typing goes through the native value setter.** React tracks an input's
 *   value on the element itself; assigning `input.value` updates that tracker
 *   too, so the `input` event that follows looks like no change and `onChange`
 *   never fires. The prototype's setter bypasses the tracker.
 * - **One click is one `click` event.** Dispatching `click` and then calling
 *   `element.click()` runs every handler twice: a counter goes up by two.
 * - **Waiting uses timers, not only animation frames.** A preview in a
 *   background tab gets no frames at all; a wait that needs one never ends.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageEntry {
  ref: number;
  element: Element;
  role: string;
  name: string;
  /** In the frame's CSS pixels, relative to its viewport. */
  box: Box;
  /** `/components/Card.tsx:12`, when the preview was built with source locations. */
  source?: string;
  state: string[];
}

export interface PageScan {
  entries: PageEntry[];
  viewport: { width: number; height: number };
  scroll: { y: number; maxY: number };
  route: string;
  title: string;
  /** Interactive elements out of view, above and below. */
  hiddenAbove: number;
  hiddenBelow: number;
  /** The text a person can read on screen, in reading order. */
  text: string;
  /** The name of an open modal dialog, if one is open. */
  dialog?: string;
}

export interface ActionOutcome {
  ok: boolean;
  /** One line for the model: what happened, or why nothing did. */
  message: string;
}

const MAX_ENTRIES = 90;
const MAX_TEXT_CHARS = 1_800;
const MAX_POINTER_SCAN = 4_000;

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="textbox"]',
  '[role="spinbutton"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const CONTEXT_SELECTOR = 'h1, h2, h3, img, canvas, video, [role="img"], [role="alert"], [role="status"]';

const FOCUSABLE_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]';

const clean = (value: string | null | undefined, max = 80): string => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One animation frame, or a short timeout when the tab is hidden and frames stop. */
const nextFrame = (win: Window) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 60);
    try {
      win.requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    } catch {
      /* the timer resolves */
    }
  });

/** Lets React commit and transitions start after an action. */
export async function settle(win: Window, ms = 280): Promise<void> {
  await nextFrame(win);
  await sleep(ms);
  await nextFrame(win);
}

/* ------------------------------------------------------------------------ */
/* Reading the page                                                          */
/* ------------------------------------------------------------------------ */

const isTextField = (element: Element): element is HTMLInputElement | HTMLTextAreaElement => {
  if (element.tagName === 'TEXTAREA') return true;
  if (element.tagName !== 'INPUT') return false;
  const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color', 'hidden'].includes(type);
};

const isEditable = (element: Element): boolean =>
  (element as HTMLElement).isContentEditable === true;

function roleOf(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return 'link';
    case 'button':
    case 'summary':
      return 'button';
    case 'select':
      return 'select';
    case 'textarea':
      return 'textbox';
    case 'img':
      return 'image';
    case 'h1':
    case 'h2':
    case 'h3':
      return 'heading';
    case 'canvas':
    case 'video':
      return tag;
    case 'input': {
      const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      return 'textbox';
    }
    default:
      return isEditable(element) ? 'textbox' : 'clickable';
  }
}

function accessibleName(element: Element): string {
  const doc = element.ownerDocument;
  const label = element.getAttribute('aria-label');
  if (label) return clean(label);
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? '').join(' ');
    if (text.trim()) return clean(text);
  }
  if (element.tagName === 'IMG') return clean(element.getAttribute('alt') || element.getAttribute('title') || '');
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
    const field = element as HTMLInputElement;
    const fromLabel = field.labels?.[0]?.textContent;
    if (fromLabel?.trim()) return clean(fromLabel);
    const type = (field.type || '').toLowerCase();
    if (['button', 'submit', 'reset'].includes(type) && field.value) return clean(field.value);
    return clean(field.getAttribute('placeholder') || field.getAttribute('title') || field.getAttribute('name') || '');
  }
  const text = (element as HTMLElement).innerText ?? element.textContent ?? '';
  if (text.trim()) return clean(text);
  const title = element.getAttribute('title') || element.querySelector('title')?.textContent;
  if (title) return clean(title);
  return element.querySelector('svg') ? 'icon' : '';
}

function stateOf(element: Element, doc: Document): string[] {
  const state: string[] = [];
  const field = element as HTMLInputElement;
  if (field.disabled || element.getAttribute('aria-disabled') === 'true') state.push('disabled');
  const role = roleOf(element);
  if (role === 'checkbox' || role === 'radio' || role === 'switch') {
    const checked = element.tagName === 'INPUT' ? field.checked : element.getAttribute('aria-checked') === 'true';
    state.push(checked ? 'checked' : 'unchecked');
  }
  if (element.getAttribute('aria-selected') === 'true') state.push('selected');
  const expanded = element.getAttribute('aria-expanded');
  if (expanded) state.push(expanded === 'true' ? 'expanded' : 'collapsed');
  if (element.getAttribute('aria-pressed') === 'true') state.push('pressed');
  if (isTextField(element)) {
    const type = (field.type || 'text').toLowerCase();
    if (type !== 'text' && type !== 'textarea') state.push(type);
    if (field.value) state.push(`value "${clean(type === 'password' ? '•'.repeat(Math.min(field.value.length, 8)) : field.value, 40)}"`);
    else state.push('empty');
  } else if (element.tagName === 'SELECT') {
    const select = element as HTMLSelectElement;
    const chosen = select.selectedOptions?.[0]?.textContent;
    if (chosen) state.push(`value "${clean(chosen, 40)}"`);
  }
  if (doc.activeElement === element) state.push('focused');
  if (element.tagName === 'A') {
    const href = element.getAttribute('href') ?? '';
    if (href.startsWith('#') || /^https?:/i.test(href)) state.push(`→ ${clean(href, 60)}`);
  }
  return state;
}

/** `/components/Card.tsx:12` from the nearest `data-willow-source`. */
function sourceOf(element: Element): string | undefined {
  const raw = element.closest('[data-willow-source]')?.getAttribute('data-willow-source');
  if (!raw) return undefined;
  const match = /^(.*):(\d+):\d+$/.exec(raw);
  if (!match) return undefined;
  const file = match[1]!.startsWith('/') ? match[1]! : `/${match[1]}`;
  return `${file}:${match[2]}`;
}

function isShown(element: Element): boolean {
  const checker = (element as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  if (typeof checker === 'function') {
    return checker.call(element, { checkOpacity: true, checkVisibilityCSS: true });
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !!style && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.02;
}

function onScreen(rect: DOMRect, viewport: { width: number; height: number }): boolean {
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width;
}

function isCovered(element: Element, rect: DOMRect, doc: Document, viewport: { width: number; height: number }): boolean {
  const x = Math.min(Math.max(rect.left + rect.width / 2, 1), viewport.width - 1);
  const y = Math.min(Math.max(rect.top + rect.height / 2, 1), viewport.height - 1);
  const hit = doc.elementFromPoint(x, y);
  return !!hit && hit !== element && !element.contains(hit) && !hit.contains(element);
}

/** The text on screen, in document order, as a person would read it. */
function visibleText(doc: Document, viewport: { width: number; height: number }): string {
  const body = doc.body;
  if (!body) return '';
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  const pieces: string[] = [];
  let lastParent: Element | null = null;
  let length = 0;
  for (let node = walker.nextNode(); node && length < MAX_TEXT_CHARS; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/g, ' ');
    if (!text?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName)) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || !onScreen(rect, viewport)) continue;
    if (!isShown(parent)) continue;
    // React splits `Count: {count}` into two text nodes; one element's text reads as one piece.
    if (parent === lastParent && pieces.length > 0) pieces[pieces.length - 1] += text;
    else pieces.push(text);
    lastParent = parent;
    length += text.length + 3;
  }
  const joined = pieces.map((piece) => piece.trim()).filter(Boolean).join(' · ');
  return joined.length > MAX_TEXT_CHARS ? `${joined.slice(0, MAX_TEXT_CHARS)}…` : joined;
}

/** What is on screen: everything a person could act on, plus headings and images to orient by. */
export function scanPage(win: Window): PageScan {
  const doc = win.document;
  const viewport = { width: win.innerWidth || doc.documentElement.clientWidth, height: win.innerHeight || doc.documentElement.clientHeight };
  const scroller = doc.scrollingElement ?? doc.documentElement;
  const candidates = new Set<Element>();
  doc.querySelectorAll(INTERACTIVE_SELECTOR).forEach((element) => candidates.add(element));

  // React attaches click handlers at the root, so a clickable div carries no
  // attribute to find it by. The pointer cursor is what a person would go by.
  const all = doc.body ? doc.body.getElementsByTagName('*') : ([] as unknown as HTMLCollectionOf<Element>);
  const limit = Math.min(all.length, MAX_POINTER_SCAN);
  for (let index = 0; index < limit; index += 1) {
    const element = all[index]!;
    if (candidates.has(element) || element.closest(INTERACTIVE_SELECTOR)) continue;
    if (win.getComputedStyle(element).cursor !== 'pointer') continue;
    const parent = element.parentElement;
    if (parent && win.getComputedStyle(parent).cursor === 'pointer') continue;
    candidates.add(element);
  }
  const context = new Set<Element>();
  doc.querySelectorAll(CONTEXT_SELECTOR).forEach((element) => {
    if (!candidates.has(element)) context.add(element);
  });

  let hiddenAbove = 0;
  let hiddenBelow = 0;
  const found: Omit<PageEntry, 'ref'>[] = [];
  const consider = (element: Element, interactive: boolean) => {
    if (!isShown(element)) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    if (!onScreen(rect, viewport)) {
      if (interactive) {
        if (rect.bottom <= 0) hiddenAbove += 1;
        else if (rect.top >= viewport.height) hiddenBelow += 1;
      }
      return;
    }
    const role = roleOf(element);
    // Small decorative images say nothing a person would act on.
    if (!interactive && role === 'image' && rect.width * rect.height < 2_500 && !element.getAttribute('alt')) return;
    const state = interactive ? stateOf(element, doc) : [];
    if (interactive && isCovered(element, rect, doc, viewport)) state.push('covered');
    found.push({
      element,
      role,
      name: accessibleName(element),
      box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      source: sourceOf(element),
      state,
    });
  };
  candidates.forEach((element) => consider(element, true));
  context.forEach((element) => consider(element, false));

  found.sort((a, b) => (Math.abs(a.box.y - b.box.y) > 6 ? a.box.y - b.box.y : a.box.x - b.box.x));
  const entries = found.slice(0, MAX_ENTRIES).map((entry, index) => ({ ...entry, ref: index + 1 }));

  const dialogElement = doc.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]');
  return {
    entries,
    viewport,
    scroll: { y: Math.round(scroller.scrollTop), maxY: Math.max(0, Math.round(scroller.scrollHeight - scroller.clientHeight)) },
    route: win.location.hash || '',
    title: clean(doc.title, 60),
    hiddenAbove,
    hiddenBelow,
    text: visibleText(doc, viewport),
    dialog: dialogElement ? accessibleName(dialogElement) || 'dialog' : undefined,
  };
}

/** One line per entry, coordinates scaled to the screenshot. */
export function describeEntry(entry: PageEntry, scale: number): string {
  const x = Math.round((entry.box.x + entry.box.width / 2) * scale);
  const y = Math.round((entry.box.y + entry.box.height / 2) * scale);
  const name = entry.name ? ` "${entry.name}"` : '';
  const state = entry.state.length > 0 ? ` (${entry.state.join(', ')})` : '';
  const source = entry.source ? ` — ${entry.source}` : '';
  return `[${entry.ref}] ${entry.role}${name} at ${x},${y}${state}${source}`;
}

/** Details of one element, for `inspect` with a target. */
export function describeElementDetails(element: Element, scale: number): string {
  const win = element.ownerDocument.defaultView!;
  const style = win.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const lines = [
    `<${element.tagName.toLowerCase()}> ${roleOf(element)} "${accessibleName(element)}"`,
    `Box: ${Math.round(rect.width * scale)}×${Math.round(rect.height * scale)} at ${Math.round(rect.left * scale)},${Math.round(rect.top * scale)} (screenshot pixels)`,
  ];
  const source = sourceOf(element);
  if (source) lines.push(`Rendered by: ${source}`);
  const owners: string[] = [];
  for (let parent = element.parentElement?.closest('[data-willow-source]'); parent && owners.length < 3; parent = parent.parentElement?.closest('[data-willow-source]')) {
    const where = sourceOf(parent);
    if (where && where !== source && !owners.includes(where)) owners.push(where);
  }
  if (owners.length > 0) lines.push(`Inside: ${owners.join(' → ')}`);
  const classes = clean(element.getAttribute('class'), 300);
  if (classes) lines.push(`Classes: ${classes}`);
  const picked = [
    ['color', style.color],
    ['background', style.backgroundColor],
    ['font', `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily.split(',')[0]}`],
    ['padding', style.padding],
    ['margin', style.margin],
    ['border', style.border],
    ['radius', style.borderRadius],
    ['display', `${style.display}${style.display.includes('flex') || style.display.includes('grid') ? ` gap ${style.gap}` : ''}`],
  ].filter(([, value]) => value && value !== 'none' && value !== '0px' && value !== 'rgba(0, 0, 0, 0)');
  lines.push(`Styles: ${picked.map(([key, value]) => `${key} ${value}`).join('; ')}`);
  const state = stateOf(element, element.ownerDocument);
  if (state.length > 0) lines.push(`State: ${state.join(', ')}`);
  return lines.join('\n');
}

/** The first visible element whose name or text contains `text`, most specific first. */
export function findByText(win: Window, text: string): Element | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  const scan = scanPage(win);
  const byName = scan.entries.find((entry) => entry.name.toLowerCase() === needle) ??
    scan.entries.find((entry) => entry.name.toLowerCase().includes(needle));
  if (byName) return byName.element;
  // Document order visits a parent before its children, so replacing the match
  // with any descendant that also matches ends on the deepest one.
  let best: Element | null = null;
  for (const element of Array.from(win.document.body?.querySelectorAll('*') ?? [])) {
    if (best && !best.contains(element)) continue;
    const own = (element as HTMLElement).innerText?.toLowerCase() ?? '';
    if (own.includes(needle) && isShown(element)) best = element;
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/* Acting                                                                    */
/* ------------------------------------------------------------------------ */

type EventKind = 'MouseEvent' | 'PointerEvent' | 'KeyboardEvent' | 'FocusEvent' | 'InputEvent' | 'WheelEvent' | 'DragEvent' | 'Event';

function fire(target: EventTarget, type: string, init: Record<string, unknown> = {}, kind: EventKind = 'MouseEvent'): boolean {
  const node = target as Node;
  const win = ((node.ownerDocument ?? (node as Document)).defaultView ?? window) as unknown as Record<string, unknown>;
  const Ctor = (win[kind] ?? win.Event) as new (type: string, init: object) => Event;
  const event = new Ctor(type, { bubbles: true, cancelable: true, composed: true, view: win, ...init });
  if (kind === 'KeyboardEvent' && typeof init.keyCode === 'number') {
    // Older handlers read keyCode/which, which the constructor ignores.
    Object.defineProperty(event, 'keyCode', { get: () => init.keyCode });
    Object.defineProperty(event, 'which', { get: () => init.keyCode });
  }
  return target.dispatchEvent(event);
}

function pointerInit(x: number, y: number, buttons: number, button = 0): Record<string, unknown> {
  return { clientX: x, clientY: y, screenX: x, screenY: y, button, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true };
}

function focusFor(target: Element): void {
  const doc = target.ownerDocument;
  const focusable = target.closest(FOCUSABLE_SELECTOR) as HTMLElement | null;
  if (focusable) {
    if (doc.activeElement !== focusable) focusable.focus({ preventScroll: true });
    if (isTextField(focusable)) {
      try {
        const length = focusable.value.length;
        focusable.setSelectionRange(length, length);
      } catch {
        /* email and number inputs have no selection range */
      }
    }
  } else if (doc.activeElement && doc.activeElement !== doc.body) {
    (doc.activeElement as HTMLElement).blur?.();
  }
}

let hovered: Element | null = null;

function moveTo(win: Window, target: Element, x: number, y: number): void {
  const init = pointerInit(x, y, 0);
  if (hovered && hovered !== target && hovered.isConnected) {
    fire(hovered, 'pointerout', init, 'PointerEvent');
    fire(hovered, 'mouseout', init);
    fire(hovered, 'pointerleave', { ...init, bubbles: false }, 'PointerEvent');
    fire(hovered, 'mouseleave', { ...init, bubbles: false });
  }
  if (hovered !== target) {
    fire(target, 'pointerover', init, 'PointerEvent');
    fire(target, 'mouseover', init);
    fire(target, 'pointerenter', { ...init, bubbles: false }, 'PointerEvent');
    fire(target, 'mouseenter', { ...init, bubbles: false });
    hovered = target;
  }
  fire(target, 'pointermove', init, 'PointerEvent');
  fire(target, 'mousemove', init);
  void win;
}

const describeTarget = (element: Element): string => {
  const name = accessibleName(element);
  return `${roleOf(element)}${name ? ` "${name}"` : ''}`;
};

export async function clickAt(
  win: Window,
  x: number,
  y: number,
  options: { double?: boolean; right?: boolean } = {},
): Promise<ActionOutcome> {
  const doc = win.document;
  const target = doc.elementFromPoint(x, y);
  if (!target) return { ok: false, message: `There is nothing at ${Math.round(x)},${Math.round(y)}; it may be outside the visible area.` };
  const button = options.right ? 2 : 0;
  const buttons = options.right ? 2 : 1;
  moveTo(win, target, x, y);
  const clicks = options.double ? 2 : 1;
  for (let count = 1; count <= clicks; count += 1) {
    fire(target, 'pointerdown', pointerInit(x, y, buttons, button), 'PointerEvent');
    const proceed = fire(target, 'mousedown', { ...pointerInit(x, y, buttons, button), detail: count });
    if (proceed && !options.right) focusFor(target);
    fire(target, 'pointerup', pointerInit(x, y, 0, button), 'PointerEvent');
    fire(target, 'mouseup', { ...pointerInit(x, y, 0, button), detail: count });
    if (options.right) {
      fire(target, 'contextmenu', pointerInit(x, y, 0, 2));
      return { ok: true, message: `Right-clicked ${describeTarget(target)}.` };
    }
    // One click event: its default action toggles checkboxes, follows links and submits forms.
    fire(target, 'click', { ...pointerInit(x, y, 0, button), detail: count });
  }
  if (options.double) fire(target, 'dblclick', { ...pointerInit(x, y, 0), detail: 2 });
  return { ok: true, message: `${options.double ? 'Double-clicked' : 'Clicked'} ${describeTarget(target)}.` };
}

export function hoverAt(win: Window, x: number, y: number): ActionOutcome {
  const target = win.document.elementFromPoint(x, y);
  if (!target) return { ok: false, message: `There is nothing at ${Math.round(x)},${Math.round(y)}.` };
  moveTo(win, target, x, y);
  return { ok: true, message: `Hovered over ${describeTarget(target)}. (CSS :hover styles do not apply to a simulated pointer; JavaScript hover menus do.)` };
}

function setNativeValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const win = field.ownerDocument.defaultView as unknown as Record<string, { prototype: object }>;
  const ctor = field.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement : field.tagName === 'SELECT' ? win.HTMLSelectElement : win.HTMLInputElement;
  const setter = ctor ? Object.getOwnPropertyDescriptor(ctor.prototype, 'value')?.set : undefined;
  if (setter) setter.call(field, value);
  else field.value = value;
}

function insertIntoField(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const max = field.maxLength > 0 ? field.maxLength : Infinity;
  let start = field.value.length;
  let end = start;
  try {
    start = field.selectionStart ?? start;
    end = field.selectionEnd ?? end;
  } catch {
    /* no selection on this input type */
  }
  const next = (field.value.slice(0, start) + text + field.value.slice(end)).slice(0, max);
  setNativeValue(field, next);
  try {
    const caret = Math.min(start + text.length, next.length);
    field.setSelectionRange(caret, caret);
  } catch {
    /* no selection on this input type */
  }
  fire(field, 'input', { inputType: 'insertText', data: text }, 'InputEvent');
}

const KEY_CODES: Record<string, number> = {
  Enter: 13, Escape: 27, Tab: 9, ' ': 32, Backspace: 8, Delete: 46,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34,
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab', space: ' ', spacebar: ' ',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft',
  right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

export interface KeyCombo {
  key: string;
  code: string;
  keyCode?: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** `Control+Shift+A`, `Enter`, `space` → a key event description. */
export function parseKeyCombo(combo: string): KeyCombo | null {
  const parts = combo.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return combo === '+' ? { key: '+', code: 'Equal', ctrl: false, shift: true, alt: false, meta: false } : null;
  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());
  const raw = parts[parts.length - 1]!;
  const key = KEY_ALIASES[raw.toLowerCase()] ?? (raw.length === 1 ? raw : raw[0]!.toUpperCase() + raw.slice(1));
  if (key.length > 1 && !(key in KEY_CODES) && !/^F\d{1,2}$/.test(key)) return null;
  const code = key === ' ' ? 'Space'
    : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}`
    : /^\d$/.test(key) ? `Digit${key}`
    : key;
  return {
    key,
    code,
    keyCode: KEY_CODES[key] ?? (/^[a-z0-9]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : undefined),
    ctrl: modifiers.some((modifier) => modifier === 'control' || modifier === 'ctrl'),
    shift: modifiers.includes('shift'),
    alt: modifiers.some((modifier) => modifier === 'alt' || modifier === 'option'),
    meta: modifiers.some((modifier) => modifier === 'meta' || modifier === 'cmd' || modifier === 'command'),
  };
}

function tabbables(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => isShown(element) && element.tabIndex >= 0);
}

export function pressKey(win: Window, combo: string): ActionOutcome {
  const parsed = parseKeyCombo(combo);
  if (!parsed) return { ok: false, message: `"${combo}" is not a key Willow knows. Use names like Enter, Escape, Tab, ArrowDown, Backspace, or Control+A.` };
  const doc = win.document;
  const target = (doc.activeElement && doc.activeElement !== doc.documentElement ? doc.activeElement : doc.body) ?? doc.documentElement;
  const init = {
    key: parsed.key,
    code: parsed.code,
    keyCode: parsed.keyCode,
    ctrlKey: parsed.ctrl,
    shiftKey: parsed.shift,
    altKey: parsed.alt,
    metaKey: parsed.meta,
  };
  const proceed = fire(target, 'keydown', init, 'KeyboardEvent');
  const printable = parsed.key.length === 1 && !parsed.ctrl && !parsed.meta;
  if (printable) fire(target, 'keypress', init, 'KeyboardEvent');

  let effect = '';
  if (proceed) {
    const field = isTextField(target) ? target : null;
    if (printable && field) {
      insertIntoField(field, parsed.key);
    } else if (printable && isEditable(target)) {
      doc.execCommand('insertText', false, parsed.key);
    } else if (parsed.key === 'Enter') {
      if (field && field.tagName === 'TEXTAREA') {
        insertIntoField(field, '\n');
      } else if (field && (field as HTMLInputElement).form) {
        (field as HTMLInputElement).form!.requestSubmit();
        effect = ' The form was submitted.';
      } else if (target.matches('button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]')) {
        fire(target, 'click', { detail: 0 });
        effect = ` It activated ${describeTarget(target)}.`;
      }
    } else if (parsed.key === ' ' && target.matches('button, summary, input[type="checkbox"], input[type="radio"], [role="button"], [role="checkbox"], [role="switch"], [role="tab"]')) {
      fire(target, 'click', { detail: 0 });
      effect = ` It activated ${describeTarget(target)}.`;
    } else if (parsed.key === 'Tab') {
      const order = tabbables(doc);
      if (order.length > 0) {
        const at = order.indexOf(target as HTMLElement);
        const next = order[(at + (parsed.shift ? -1 : 1) + order.length) % order.length]!;
        next.focus();
        effect = ` Focus moved to ${describeTarget(next)}.`;
      }
    } else if ((parsed.key === 'Backspace' || parsed.key === 'Delete') && field) {
      let start = field.value.length;
      let end = start;
      try {
        start = field.selectionStart ?? start;
        end = field.selectionEnd ?? end;
      } catch {
        /* no selection on this input type */
      }
      if (start === end) {
        if (parsed.key === 'Backspace') start = Math.max(0, start - 1);
        else end = Math.min(field.value.length, end + 1);
      }
      setNativeValue(field, field.value.slice(0, start) + field.value.slice(end));
      fire(field, 'input', { inputType: parsed.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward' }, 'InputEvent');
    } else if (parsed.key.toLowerCase() === 'a' && (parsed.ctrl || parsed.meta) && field) {
      field.select();
    } else if ((parsed.key === 'ArrowDown' || parsed.key === 'ArrowUp') && target.tagName === 'SELECT') {
      const select = target as HTMLSelectElement;
      const index = Math.min(Math.max(select.selectedIndex + (parsed.key === 'ArrowDown' ? 1 : -1), 0), select.options.length - 1);
      setNativeValue(select, select.options[index]?.value ?? '');
      fire(select, 'input', {}, 'Event');
      fire(select, 'change', {}, 'Event');
    }
  }
  fire(target, 'keyup', init, 'KeyboardEvent');
  return { ok: true, message: `Pressed ${combo} on ${target === doc.body ? 'the page' : describeTarget(target)}.${proceed ? effect : ' The app handled it (default prevented).'}` };
}

/**
 * React 18 applies state from an event in a microtask after it, so each key
 * waits for the app to take the last one in: a form submitted in the same tick
 * as the final keystroke reads the draft as it was before typing began.
 */
const yieldToApp = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function typeText(
  win: Window,
  target: Element | null,
  text: string,
  options: { clear?: boolean; enter?: boolean } = {},
): Promise<ActionOutcome> {
  const doc = win.document;
  const element = target ?? doc.activeElement;
  if (!element || element === doc.body) {
    return { ok: false, message: 'Nothing is focused to type into. Point at a field with "ref" (or x/y), or click it first.' };
  }
  const field = isTextField(element)
    ? element
    : (element.querySelector('input:not([type="hidden"]), textarea') as HTMLInputElement | HTMLTextAreaElement | null);

  if (field && isTextField(field)) {
    if (field.disabled || field.readOnly) return { ok: false, message: `${describeTarget(field)} is ${field.disabled ? 'disabled' : 'read-only'}.` };
    if (doc.activeElement !== field) field.focus({ preventScroll: true });
    if (options.clear && field.value) {
      setNativeValue(field, '');
      fire(field, 'input', { inputType: 'deleteContentBackward' }, 'InputEvent');
      await yieldToApp();
    } else {
      try {
        field.setSelectionRange(field.value.length, field.value.length);
      } catch {
        /* no selection on this input type */
      }
    }
    // Key by key for short text, so handlers that watch keys see them; long text goes in at once.
    if (text.length <= 80) {
      for (const character of text) {
        const keyInit = { key: character, code: /^[a-z]$/i.test(character) ? `Key${character.toUpperCase()}` : '' };
        const proceed = fire(field, 'keydown', keyInit, 'KeyboardEvent');
        fire(field, 'keypress', keyInit, 'KeyboardEvent');
        if (proceed) insertIntoField(field, character);
        fire(field, 'keyup', keyInit, 'KeyboardEvent');
        await yieldToApp();
      }
    } else {
      insertIntoField(field, text);
      await yieldToApp();
    }
    fire(field, 'change', {}, 'Event');
    const typed = `Typed "${clean(text, 60)}" into ${describeTarget(field)}.`;
    if (!options.enter) return { ok: true, message: typed };
    await settle(win, 60);
    return { ok: true, message: `${typed} ${pressKey(win, 'Enter').message}` };
  }

  if (isEditable(element)) {
    (element as HTMLElement).focus({ preventScroll: true });
    if (options.clear) {
      doc.execCommand('selectAll', false);
      doc.execCommand('delete', false);
    }
    doc.execCommand('insertText', false, text);
    const typed = `Typed "${clean(text, 60)}" into ${describeTarget(element)}.`;
    if (!options.enter) return { ok: true, message: typed };
    await settle(win, 60);
    return { ok: true, message: `${typed} ${pressKey(win, 'Enter').message}` };
  }

  if (element.tagName === 'SELECT') return selectOption(element as HTMLSelectElement, text);
  return { ok: false, message: `${describeTarget(element)} does not take text. Point at an input, a textarea or an editable area.` };
}

export function selectOption(element: Element, wanted: string): ActionOutcome {
  if (element.tagName !== 'SELECT') {
    return { ok: false, message: `${describeTarget(element)} is not a native dropdown. Click it to open it, then click the option.` };
  }
  const select = element as HTMLSelectElement;
  const needle = wanted.trim().toLowerCase();
  const options = Array.from(select.options);
  const option = options.find((entry) => entry.text.trim().toLowerCase() === needle || entry.value.toLowerCase() === needle) ??
    options.find((entry) => entry.text.trim().toLowerCase().includes(needle));
  if (!option) {
    return { ok: false, message: `No option "${wanted}". Options: ${options.map((entry) => `"${clean(entry.text, 30)}"`).join(', ')}.` };
  }
  select.focus({ preventScroll: true });
  setNativeValue(select, option.value);
  fire(select, 'input', {}, 'Event');
  fire(select, 'change', {}, 'Event');
  return { ok: true, message: `Selected "${clean(option.text, 40)}" in ${describeTarget(select)}.` };
}

function scrollableAncestor(element: Element | null, win: Window): Element | null {
  for (let node = element; node && node !== win.document.body; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    const scrollsY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    const scrollsX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (scrollsY || scrollsX) return node;
  }
  return null;
}

export function scrollPage(
  win: Window,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
  at: { x: number; y: number } | null,
): ActionOutcome {
  const doc = win.document;
  const pointElement = at ? doc.elementFromPoint(at.x, at.y) : null;
  const target = scrollableAncestor(pointElement, win) ?? doc.scrollingElement ?? doc.documentElement;
  const dy = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
  const dx = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
  const before = { top: target.scrollTop, left: target.scrollLeft };
  if (pointElement) fire(pointElement, 'wheel', { deltaX: dx, deltaY: dy, deltaMode: 0, clientX: at!.x, clientY: at!.y }, 'WheelEvent');
  target.scrollBy({ top: dy, left: dx, behavior: 'instant' as ScrollBehavior });
  const moved = Math.round(target.scrollTop - before.top) || Math.round(target.scrollLeft - before.left);
  const where = target === doc.scrollingElement || target === doc.documentElement ? 'the page' : describeTarget(target);
  if (!moved) return { ok: true, message: `${where[0]!.toUpperCase()}${where.slice(1)} did not move: it is already at the ${dy > 0 ? 'bottom' : dy < 0 ? 'top' : 'edge'}.` };
  return { ok: true, message: `Scrolled ${where} ${direction} ${Math.abs(moved)}px.` };
}

export async function dragBetween(win: Window, from: { x: number; y: number }, to: { x: number; y: number }): Promise<ActionOutcome> {
  const doc = win.document;
  const source = doc.elementFromPoint(from.x, from.y);
  if (!source) return { ok: false, message: 'There is nothing at the drag start.' };
  moveTo(win, source, from.x, from.y);
  fire(source, 'pointerdown', pointerInit(from.x, from.y, 1), 'PointerEvent');
  fire(source, 'mousedown', pointerInit(from.x, from.y, 1));

  const draggable = source.closest('[draggable="true"]');
  const W = win as unknown as { DataTransfer?: new () => DataTransfer };
  const transfer = draggable && W.DataTransfer ? new W.DataTransfer() : null;
  if (draggable && transfer) fire(draggable, 'dragstart', { dataTransfer: transfer, clientX: from.x, clientY: from.y }, 'DragEvent');

  // In steps, so libraries that wait for a minimum distance or a frame see a real drag.
  const steps = 10;
  let over: Element | null = null;
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    const under = doc.elementFromPoint(x, y) ?? source;
    fire(under, 'pointermove', pointerInit(x, y, 1), 'PointerEvent');
    fire(under, 'mousemove', pointerInit(x, y, 1));
    if (transfer) {
      if (under !== over) fire(under, 'dragenter', { dataTransfer: transfer, clientX: x, clientY: y }, 'DragEvent');
      fire(under, 'dragover', { dataTransfer: transfer, clientX: x, clientY: y }, 'DragEvent');
    }
    over = under;
    await sleep(18);
  }
  const target = doc.elementFromPoint(to.x, to.y) ?? source;
  if (draggable && transfer) {
    fire(target, 'drop', { dataTransfer: transfer, clientX: to.x, clientY: to.y }, 'DragEvent');
    fire(draggable, 'dragend', { dataTransfer: transfer, clientX: to.x, clientY: to.y }, 'DragEvent');
  }
  fire(target, 'pointerup', pointerInit(to.x, to.y, 0), 'PointerEvent');
  fire(target, 'mouseup', pointerInit(to.x, to.y, 0));
  return { ok: true, message: `Dragged ${describeTarget(source)} onto ${describeTarget(target)}.` };
}

export async function waitForText(win: Window, text: string, timeoutMs: number): Promise<ActionOutcome> {
  const needle = text.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  do {
    if ((win.document.body?.innerText ?? '').toLowerCase().includes(needle)) {
      return { ok: true, message: `"${clean(text, 60)}" is on the page.` };
    }
    await sleep(120);
  } while (Date.now() < deadline);
  return { ok: false, message: `"${clean(text, 60)}" did not appear within ${Math.round(timeoutMs / 1000)} seconds.` };
}
