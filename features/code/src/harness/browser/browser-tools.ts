/**
 * The preview tools, all over one `PreviewSession` per turn:
 *
 * - `computer` — the Test tool. The agent uses the app like a person and gets a
 *   screenshot and a numbered list back after every call. It refuses until the
 *   turn has read the app-testing skill, so every test starts from the same
 *   playbook.
 * - `inspect` — Visual Edits. A look at the app, or one element in detail,
 *   with the file and line that renders it.
 * - `annotate` — Annotate. A marked-up screenshot shown to the user.
 *
 * Argument parsing is forgiving about shape, because models arrive with habits
 * from other computer-use tools: `left_click`, `coordinate: [x, y]`, `key`.
 */

import { APP_TESTING_SKILL_ID } from '../builtin-skills';
import { nextId, type ComputerAction } from '../protocol';
import type { HarnessTool, ToolContext, ToolRunResult } from '../tools';
import { drawAnnotations, type AnnotationMark } from './annotate';
import {
  clickAt,
  describeElementDetails,
  dragBetween,
  hoverAt,
  pressKey,
  scrollPage,
  selectOption,
  settle,
  typeText,
  waitForText,
  type ActionOutcome,
} from './page-driver';
import { labelOf, type PreviewSession, type Target } from './preview-session';
import { captureFrame } from './screenshot';

export type BrowserAction =
  | { action: 'screenshot' }
  | { action: 'click'; target: Target; double?: boolean; right?: boolean }
  | { action: 'type'; target?: Target; text: string; clear?: boolean; enter?: boolean }
  | { action: 'press'; key: string }
  | { action: 'hover'; target: Target }
  | { action: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount: number; target?: Target }
  | { action: 'select'; target: Target; option: string }
  | { action: 'drag'; from: Target; to: Target }
  | { action: 'wait'; ms?: number; text?: string }
  | { action: 'navigate'; to: string }
  | { action: 'viewport'; size: 'mobile' | 'tablet' | 'desktop' };

export const MAX_ACTIONS_PER_CALL = 12;

const ACTION_NAMES: Record<string, BrowserAction['action'] | 'double_click' | 'right_click'> = {
  screenshot: 'screenshot', observe: 'screenshot', look: 'screenshot', snapshot: 'screenshot',
  click: 'click', left_click: 'click', tap: 'click',
  double_click: 'double_click', dblclick: 'double_click',
  right_click: 'right_click', context_click: 'right_click',
  type: 'type', type_text: 'type', fill: 'type', input: 'type',
  press: 'press', key: 'press', keypress: 'press', key_combination: 'press', hotkey: 'press',
  hover: 'hover', mouse_move: 'hover', move: 'hover',
  scroll: 'scroll', scroll_document: 'scroll', scroll_at: 'scroll',
  select: 'select', select_option: 'select', choose: 'select',
  drag: 'drag', drag_and_drop: 'drag', left_click_drag: 'drag',
  wait: 'wait', sleep: 'wait', wait_for: 'wait',
  navigate: 'navigate', goto: 'navigate', go: 'navigate', open: 'navigate', back: 'navigate', reload: 'navigate',
  viewport: 'viewport', resize: 'viewport', device: 'viewport',
};

const KNOWN_ACTIONS = 'screenshot, click, type, press, hover, scroll, select, drag, wait, navigate, viewport';

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

const asText = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

const asBool = (value: unknown): boolean => value === true || value === 'true';

const refOf = (value: unknown): number | undefined => {
  const ref = typeof value === 'string' ? (/^\s*\[?\d+\]?\s*$/.test(value) ? asNumber(value.replace(/[[\]\s]/g, '')) : undefined) : asNumber(value);
  return ref === undefined ? undefined : Math.round(ref);
};

/**
 * `ref` (also `[7]` or `element`), `x`/`y` or `coordinate: [x, y]`, or text.
 * Which keys may name a target by its text depends on the action: for `type`,
 * "text" is what to type, so only "target" names the field.
 */
export function parseTarget(
  value: Record<string, unknown> | undefined | null,
  textKeys: readonly string[] = ['text', 'target'],
): Target | null {
  if (!value || typeof value !== 'object') return null;
  const ref = refOf(value.ref) ?? refOf(value.element) ?? refOf(value.target);
  if (ref !== undefined) return { ref };
  const coordinate = Array.isArray(value.coordinate) ? value.coordinate : Array.isArray(value.point) ? value.point : null;
  const x = asNumber(coordinate?.[0] ?? value.x);
  const y = asNumber(coordinate?.[1] ?? value.y);
  if (x !== undefined && y !== undefined) return { x, y };
  for (const key of textKeys) {
    const text = asText(value[key]);
    if (text) return { text };
  }
  return null;
}

function parseOne(raw: Record<string, unknown>): BrowserAction | string {
  const name = String(raw.action ?? raw.type_of_action ?? raw.name ?? '').trim().toLowerCase();
  const kind = ACTION_NAMES[name];
  if (!kind) return name ? `"${name}" is not an action. Actions: ${KNOWN_ACTIONS}.` : `Each action needs "action": one of ${KNOWN_ACTIONS}.`;

  switch (kind) {
    case 'screenshot':
      return { action: 'screenshot' };
    case 'click':
    case 'double_click':
    case 'right_click': {
      const target = parseTarget(raw);
      if (!target) return `${name} needs "ref" (a number from the latest result), "text", or "x" and "y".`;
      return {
        action: 'click',
        target,
        double: kind === 'double_click' || asNumber(raw.clicks) === 2 || asBool(raw.double),
        right: kind === 'right_click' || raw.button === 'right',
      };
    }
    case 'type': {
      const text = typeof raw.text === 'string' ? raw.text : typeof raw.value === 'string' ? raw.value : undefined;
      if (text === undefined) return 'type needs "text".';
      const target = parseTarget(raw, ['target', 'into', 'field']);
      return {
        action: 'type',
        target: target ?? undefined,
        text,
        clear: asBool(raw.clear) || asBool(raw.clear_before_typing) || asBool(raw.replace),
        enter: asBool(raw.enter) || asBool(raw.submit) || asBool(raw.press_enter),
      };
    }
    case 'press': {
      const key = asText(raw.key) ?? asText(raw.keys) ?? asText(raw.text) ?? asText(raw.combo);
      if (!key) return 'press needs "key", for example "Enter", "Escape" or "Control+A".';
      return { action: 'press', key };
    }
    case 'hover': {
      const target = parseTarget(raw);
      if (!target) return 'hover needs "ref", "text", or "x" and "y".';
      return { action: 'hover', target };
    }
    case 'scroll': {
      const direction = String(raw.direction ?? raw.scroll_direction ?? 'down').toLowerCase();
      if (!['up', 'down', 'left', 'right'].includes(direction)) return 'scroll "direction" is up, down, left or right.';
      const amount = Math.min(Math.max(asNumber(raw.amount ?? raw.pixels ?? raw.magnitude) ?? 600, 40), 4_000);
      return { action: 'scroll', direction: direction as 'up' | 'down' | 'left' | 'right', amount, target: parseTarget(raw) ?? undefined };
    }
    case 'select': {
      const target = parseTarget(raw, ['target', 'dropdown']);
      const option = asText(raw.option) ?? asText(raw.value) ?? asText(raw.label) ?? asText(raw.text);
      if (!target) return 'select needs "ref" for the dropdown.';
      if (!option) return 'select needs "option": the label to pick.';
      return { action: 'select', target, option };
    }
    case 'drag': {
      const side = (value: unknown, fallback: Record<string, unknown>) =>
        typeof value === 'string' || typeof value === 'number'
          ? parseTarget({ target: value })
          : parseTarget(value && typeof value === 'object' ? (value as Record<string, unknown>) : fallback);
      const from = side(raw.from, { ref: raw.from_ref, x: raw.x ?? raw.start_x, y: raw.y ?? raw.start_y, coordinate: raw.start_coordinate ?? raw.coordinate });
      const to = side(raw.to, { ref: raw.to_ref, x: raw.to_x ?? raw.destination_x ?? raw.end_x, y: raw.to_y ?? raw.destination_y ?? raw.end_y, coordinate: raw.end_coordinate });
      if (!from || !to) return 'drag needs "from" and "to", each a {"ref"}, {"text"} or {"x", "y"}.';
      return { action: 'drag', from, to };
    }
    case 'wait': {
      const text = asText(raw.text) ?? asText(raw.for);
      const seconds = asNumber(raw.seconds);
      const ms = asNumber(raw.ms ?? raw.milliseconds) ?? (seconds !== undefined ? seconds * 1_000 : undefined);
      return { action: 'wait', text, ms: Math.min(Math.max(ms ?? 1_000, 100), 5_000) };
    }
    case 'navigate': {
      const to = asText(raw.to) ?? asText(raw.url) ?? asText(raw.route) ?? asText(raw.path) ?? (name === 'back' || name === 'reload' ? name : undefined);
      if (!to) return 'navigate needs "to": a route like "#/settings", or "back", "forward" or "reload".';
      if (/^https?:\/\//i.test(to)) return 'navigate only moves around this app: pass a route like "#/settings". The preview cannot open other websites.';
      return { action: 'navigate', to };
    }
    case 'viewport': {
      const size = String(raw.size ?? raw.device ?? raw.width ?? '').toLowerCase();
      const normalized = /phone|mobile/.test(size) ? 'mobile' : /tablet|ipad/.test(size) ? 'tablet' : /desktop|full|reset|laptop/.test(size) ? 'desktop' : null;
      if (!normalized) return 'viewport "size" is "mobile", "tablet" or "desktop".';
      return { action: 'viewport', size: normalized };
    }
  }
}

/** One action, or `"actions": [...]`. */
export function parseActions(args: Record<string, unknown>): { actions: BrowserAction[] } | { error: string } {
  const list = Array.isArray(args.actions) ? args.actions : [args];
  if (list.length === 0) return { error: '"actions" is empty.' };
  if (list.length > MAX_ACTIONS_PER_CALL) {
    return { error: `At most ${MAX_ACTIONS_PER_CALL} actions per call; look at the result before going further.` };
  }
  const actions: BrowserAction[] = [];
  for (const [index, raw] of list.entries()) {
    if (!raw || typeof raw !== 'object') return { error: `Action ${index + 1} is not an object.` };
    const parsed = parseOne(raw as Record<string, unknown>);
    if (typeof parsed === 'string') return { error: list.length > 1 ? `Action ${index + 1}: ${parsed}` : parsed };
    actions.push(parsed);
  }
  return { actions };
}

const stepAction = (action: BrowserAction): ComputerAction => action.action;

/** How the transcript names what an action is about to touch. */
function stepLabel(action: BrowserAction, session: PreviewSession): string | undefined {
  const named = (target: Target | undefined): string | undefined => {
    if (!target) return undefined;
    if (typeof target.ref === 'number') {
      const entry = session.lastScan?.entries.find((candidate) => candidate.ref === target.ref);
      return entry ? labelOf(entry) : `[${target.ref}]`;
    }
    if (target.text) return `"${target.text}"`;
    return undefined;
  };
  switch (action.action) {
    case 'click':
    case 'hover':
    case 'select':
      return named(action.target);
    case 'type':
      return `"${action.text.length > 40 ? `${action.text.slice(0, 39)}…` : action.text}"`;
    case 'press':
      return action.key;
    case 'scroll':
      return action.direction;
    case 'drag':
      return named(action.from);
    case 'wait':
      return action.text ? `"${action.text}"` : undefined;
    case 'navigate':
      return action.to;
    case 'viewport':
      return action.size;
    default:
      return undefined;
  }
}

async function perform(session: PreviewSession, action: BrowserAction): Promise<ActionOutcome> {
  switch (action.action) {
    case 'screenshot':
      return { ok: true, message: 'Took a screenshot.' };

    case 'click': {
      const target = session.resolve(action.target);
      if ('error' in target) return { ok: false, message: target.error };
      await session.pointAt(target.point, `Clicking ${target.label}`, true);
      const outcome = await clickAt(session.window(), target.point.x, target.point.y, { double: action.double, right: action.right });
      await settle(session.window());
      return outcome;
    }

    case 'type': {
      let element: Element | null = null;
      if (action.target) {
        const target = session.resolve(action.target);
        if ('error' in target) return { ok: false, message: target.error };
        await session.pointAt(target.point, `Typing into ${target.label}`, true);
        await clickAt(session.window(), target.point.x, target.point.y);
        const doc = session.window().document;
        element = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : target.element;
      }
      const outcome = await typeText(session.window(), element, action.text, { clear: action.clear, enter: action.enter });
      await settle(session.window());
      return outcome;
    }

    case 'press': {
      const outcome = pressKey(session.window(), action.key);
      await settle(session.window());
      return outcome;
    }

    case 'hover': {
      const target = session.resolve(action.target);
      if ('error' in target) return { ok: false, message: target.error };
      await session.pointAt(target.point, `Hovering ${target.label}`, false);
      const outcome = hoverAt(session.window(), target.point.x, target.point.y);
      await settle(session.window());
      return outcome;
    }

    case 'scroll': {
      let point: { x: number; y: number } | null = null;
      if (action.target) {
        const target = session.resolve(action.target, { scrollIntoView: false });
        if ('error' in target) return { ok: false, message: target.error };
        point = target.point;
      }
      const outcome = scrollPage(session.window(), action.direction, action.amount, point);
      await settle(session.window(), 200);
      return outcome;
    }

    case 'select': {
      const target = session.resolve(action.target);
      if ('error' in target) return { ok: false, message: target.error };
      if (!target.element) return { ok: false, message: 'There is no dropdown there.' };
      await session.pointAt(target.point, `Choosing "${action.option}"`, true);
      const dropdown = target.element.closest('select') ?? target.element;
      const outcome = selectOption(dropdown, action.option);
      await settle(session.window());
      return outcome;
    }

    case 'drag': {
      const from = session.resolve(action.from);
      if ('error' in from) return { ok: false, message: from.error };
      const to = session.resolve(action.to, { scrollIntoView: false });
      if ('error' in to) return { ok: false, message: to.error };
      await session.pointAt(from.point, `Dragging ${from.label}`, false);
      const outcome = await dragBetween(session.window(), from.point, to.point);
      await session.pointAt(to.point, `Dropping on ${to.label}`, false);
      await settle(session.window());
      return outcome;
    }

    case 'wait': {
      if (action.text) return waitForText(session.window(), action.text, 5_000);
      await new Promise((resolve) => setTimeout(resolve, action.ms ?? 1_000));
      return { ok: true, message: `Waited ${((action.ms ?? 1_000) / 1_000).toFixed(1)} seconds.` };
    }

    case 'navigate':
      return session.navigate(action.to);

    case 'viewport':
      return session.setViewport(action.size);
  }
}

function previewError(message: string): ToolRunResult {
  return { output: message, isError: true, step: { status: 'error', error: message.split('\n')[0]!.slice(0, 160) } };
}

function computerTool(session: PreviewSession): HarnessTool {
  return {
    name: 'computer',
    description:
      'Uses the app in the live preview like a person: click, type, press keys, scroll, hover, select, drag, wait, change the route or the screen size. Returns a screenshot and a numbered list of what is on screen. Several actions can go in one call. Read skill://app-testing before the first call.',
    signature: '{"action": "click", "ref": 7}, or {"actions": [ … ]} — actions: screenshot, click, type, press, hover, scroll, select, drag, wait, navigate, viewport',
    readOnly: true,
    source: 'builtin',
    startStep: () => null,
    async run(args, context: ToolContext): Promise<ToolRunResult> {
      if (!context.readSkills.has(APP_TESTING_SKILL_ID)) {
        return {
          output: `Read the app-testing skill before using the computer: call read_skill with {"name": "skill://${APP_TESTING_SKILL_ID}"}, then call computer again. Every test starts there.`,
          isError: true,
        };
      }
      const parsed = parseActions(args);
      if ('error' in parsed) return { output: parsed.error, isError: true };

      const problem = await session.prepare(context.workspace, context.check);
      if (problem) return { output: problem, isError: true };

      session.beginVisuals();
      const lines: string[] = [];
      try {
        for (const [index, action] of parsed.actions.entries()) {
          if (context.signal?.aborted) break;
          const stepId = context.record.add({ id: nextId('step'), kind: 'computer', action: stepAction(action), label: stepLabel(action, session), status: 'running' });
          let outcome: ActionOutcome;
          try {
            outcome = await perform(session, action);
          } catch (error) {
            outcome = { ok: false, message: `The action failed: ${(error as Error).message}` };
          }
          context.record.patch(stepId, outcome.ok ? { status: 'done' } : { status: 'error', error: outcome.message.slice(0, 160) });
          lines.push(parsed.actions.length > 1 ? `${index + 1}. ${outcome.message}` : outcome.message);
          if (!outcome.ok) {
            const left = parsed.actions.length - index - 1;
            if (left > 0) lines.push(`Stopped there; the remaining ${left === 1 ? 'action' : `${left} actions`} did not run.`);
            break;
          }
        }
        const observation = await session.observe();
        return {
          output: `${lines.join('\n')}\n\n${observation.text}`,
          images: observation.shot ? [{ mimeType: observation.shot.mimeType, data: observation.shot.data }] : undefined,
        };
      } finally {
        session.idleVisuals();
      }
    },
  };
}

function inspectTool(session: PreviewSession): HarnessTool {
  return {
    name: 'inspect',
    description:
      'Looks at the live preview: a screenshot and a numbered list of what is on screen, with the file and line that renders each element. Pass "ref" (or "text") for one element in detail: its classes, key styles, size and source.',
    signature: '{} or {"ref": 7} or {"text": "Sign in"}',
    readOnly: true,
    source: 'builtin',
    startStep: (args) => {
      const target = parseTarget(args);
      const label = target?.ref !== undefined ? `[${target.ref}]` : target?.text ? `"${target.text}"` : undefined;
      return { id: nextId('step'), kind: 'computer', action: 'inspect', label, status: 'running' };
    },
    async run(args, context) {
      const problem = await session.prepare(context.workspace, context.check);
      if (problem) return previewError(problem);

      const target = parseTarget(args);
      if (target) {
        if (target.ref !== undefined && !session.lastScan) {
          return previewError('Numbers come from a look at the app: call inspect with no arguments first, or pass "text".');
        }
        const resolved = session.resolve(target, { scrollIntoView: false });
        if ('error' in resolved) return previewError(resolved.error);
        if (!resolved.element) return previewError('There is no element there.');
        return { output: describeElementDetails(resolved.element, session.scale), step: { status: 'done', label: resolved.label } };
      }

      const observation = await session.observe();
      return {
        output: observation.text,
        images: observation.shot ? [{ mimeType: observation.shot.mimeType, data: observation.shot.data }] : undefined,
        step: { status: 'done' },
      };
    },
  };
}

function annotateTool(session: PreviewSession): HarnessTool {
  return {
    name: 'annotate',
    description:
      'Shows the user a screenshot of the app with numbered marks, each with a note: where something is, what changed, or what you found. Mark things by "ref" (from inspect or computer), by visible "text", or by a "box" in screenshot pixels.',
    signature: '{"notes": [{"ref": 7, "note": "The new filter"}, {"text": "Total", "note": "Updates live"}], "caption"?: "What changed"}',
    readOnly: true,
    source: 'builtin',
    startStep: () => null,
    async run(args, context) {
      const rawNotes = Array.isArray(args.notes) ? args.notes : Array.isArray(args.marks) ? args.marks : [];
      if (rawNotes.length === 0) return { output: 'annotate needs "notes": [{"ref": 7, "note": "…"}].', isError: true };
      if (rawNotes.length > 10) return { output: 'At most 10 notes in one picture; split them across pictures.', isError: true };
      const caption = String(args.caption ?? args.title ?? '').trim().slice(0, 200);

      const problem = await session.prepare(context.workspace, context.check);
      if (problem) return { output: problem, isError: true };

      const win = session.window();
      const marks: AnnotationMark[] = [];
      const notes: string[] = [];
      const missed: string[] = [];
      for (const raw of rawNotes) {
        const note = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const text = String(note.note ?? note.comment ?? note.label ?? '').trim().slice(0, 160);
        const box = note.box as Record<string, unknown> | undefined;
        if (box && [box.x, box.y, box.width, box.height].every((value) => asNumber(value) !== undefined)) {
          const scale = session.scale || 1;
          marks.push({ box: { x: asNumber(box.x)! / scale, y: asNumber(box.y)! / scale, width: asNumber(box.width)! / scale, height: asNumber(box.height)! / scale } });
          notes.push(text || 'Marked area');
          continue;
        }
        const target = parseTarget(note);
        if (!target) {
          missed.push(`"${text || 'a note'}" has no ref, text or box`);
          continue;
        }
        if (target.ref !== undefined && !session.lastScan) {
          missed.push(`[${target.ref}]: numbers come from inspect or computer, and there has been no look yet`);
          continue;
        }
        const resolved = session.resolve(target, { scrollIntoView: false });
        if ('error' in resolved || !resolved.element) {
          missed.push('error' in resolved ? resolved.error : `nothing at ${resolved.label}`);
          continue;
        }
        const rect = resolved.element.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > win.innerHeight || rect.right < 0 || rect.left > win.innerWidth) {
          missed.push(`${resolved.label} is off screen; scroll to it first`);
          continue;
        }
        marks.push({ box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
        notes.push(text || resolved.label);
      }
      if (marks.length === 0) return { output: `Nothing could be marked: ${missed.join('; ')}.`, isError: true };

      const frame = session.iframe;
      const shot = frame ? await captureFrame(frame) : null;
      if (!shot) return { output: 'The preview could not be drawn, so there is no screenshot to mark up.', isError: true };
      const image = await drawAnnotations(shot, marks);
      context.record.add({ id: nextId('step'), kind: 'image', origin: 'annotation', src: image.dataUrl, caption, notes, status: 'done' });

      const list = notes.map((note, index) => `${index + 1}. ${note}`).join('\n');
      return {
        output: `Showed the user this screenshot with ${marks.length === 1 ? 'one numbered note' : `${marks.length} numbered notes`}:\n${list}${missed.length > 0 ? `\nNot marked: ${missed.join('; ')}.` : ''}`,
        images: [{ mimeType: 'image/jpeg', data: image.data }],
      };
    },
  };
}

export function makeBrowserTools(session: PreviewSession): HarnessTool[] {
  return [computerTool(session), inspectTool(session), annotateTool(session)];
}
