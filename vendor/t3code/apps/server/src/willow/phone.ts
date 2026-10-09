// @effect-diagnostics globalDate:off globalTimers:off - held polls and call timeouts live on the phone listener's plain Node requests (./mobile.ts).
/**
 * The user's phone, for the `phone_*` MCP tools. Willow's Android app (`apps/android` in
 * Willow) shows Willow's page from this computer (`./mobile.ts`); that page long-polls here
 * for calls, hands each to the app, which runs it natively, and posts the result back. The
 * phone seen most recently answers. Its owner decides which tools it offers: none while
 * "Let agents use this phone" is off in the app.
 *
 * Android pauses a page in the background, so a phone counts as connected only while Willow
 * is open on it.
 */

export const PHONE_TOOLS = [
  "phone_status",
  "phone_location",
  "phone_notify",
  "phone_vibrate",
  "phone_open_url",
  "phone_clipboard_set",
  "phone_photo",
] as const;

export type PhoneToolName = (typeof PHONE_TOOLS)[number];

export interface PhoneCall {
  readonly id: string;
  readonly tool: PhoneToolName;
  readonly args: Record<string, unknown>;
}

interface Phone {
  readonly id: string;
  label: string;
  tools: ReadonlyArray<PhoneToolName>;
  seenAt: number;
  queue: Array<PhoneCall>;
  waiter: ((calls: ReadonlyArray<PhoneCall>) => void) | null;
}

interface PendingCall {
  readonly phoneId: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** A poll is held this long; the page polls again at once. */
const POLL_MS = 25_000;
/** Longer than a poll, so a phone between polls still counts. */
const SEEN_MS = POLL_MS + 15_000;
const MAX_PHONES = 8;
/** The photo waits on the user's answer and the camera. */
const TIMEOUT_MS: Partial<Record<PhoneToolName, number>> = {
  phone_photo: 180_000,
  phone_location: 60_000,
};
const DEFAULT_TIMEOUT_MS = 30_000;

const phones = new Map<string, Phone>();
const pending = new Map<string, PendingCall>();
let sequence = 0;

const isTool = (value: unknown): value is PhoneToolName =>
  typeof value === "string" && (PHONE_TOOLS as ReadonlyArray<string>).includes(value);

const live = (phone: Phone, now = Date.now()) =>
  phone.waiter !== null || now - phone.seenAt < SEEN_MS;

function current(): Phone | undefined {
  let best: Phone | undefined;
  for (const phone of phones.values()) {
    if (live(phone) && (best === undefined || phone.seenAt > best.seenAt)) best = phone;
  }
  return best;
}

function phoneFor(id: string): Phone {
  let phone = phones.get(id);
  if (!phone) {
    if (phones.size >= MAX_PHONES) {
      const oldest = [...phones.values()].sort((a, b) => a.seenAt - b.seenAt)[0];
      if (oldest) forget(oldest);
    }
    phone = { id, label: "Phone", tools: [], seenAt: Date.now(), queue: [], waiter: null };
    phones.set(id, phone);
  }
  return phone;
}

function forget(phone: Phone) {
  phones.delete(phone.id);
  phone.waiter?.([]);
  for (const [callId, call] of pending) {
    if (call.phoneId !== phone.id) continue;
    pending.delete(callId);
    clearTimeout(call.timer);
    call.reject(new Error("The phone disconnected before answering."));
  }
}

export const isPhoneId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);

/** The page says which tools its owner allows, when it starts and whenever that changes. */
export function hello(id: string, input: { readonly tools?: unknown; readonly label?: unknown }) {
  const phone = phoneFor(id);
  phone.tools = Array.isArray(input.tools) ? input.tools.filter(isTool) : [];
  if (typeof input.label === "string" && input.label.trim()) {
    phone.label = input.label.trim().slice(0, 80);
  }
  phone.seenAt = Date.now();
}

/** Resolves with the calls waiting for the phone, or none after a while. */
export function poll(id: string, closed: Promise<void>): Promise<ReadonlyArray<PhoneCall>> {
  const phone = phoneFor(id);
  phone.seenAt = Date.now();
  phone.waiter?.([]);
  if (phone.queue.length > 0) {
    const calls = phone.queue;
    phone.queue = [];
    return Promise.resolve(calls);
  }
  return new Promise((resolve) => {
    const finish = (calls: ReadonlyArray<PhoneCall>) => {
      clearTimeout(timer);
      if (phone.waiter === finish) phone.waiter = null;
      phone.seenAt = Date.now();
      resolve(calls);
    };
    const timer = setTimeout(() => finish([]), POLL_MS);
    phone.waiter = finish;
    void closed.then(() => {
      if (phone.waiter !== finish) return;
      // Calls handed to a poll whose connection is gone go out with the next one.
      clearTimeout(timer);
      phone.waiter = null;
    });
  });
}

/** Calls a poll took but could not deliver, because its connection had closed. */
export function requeue(id: string, calls: ReadonlyArray<PhoneCall>) {
  const phone = phones.get(id);
  if (!phone) return;
  const waiting = calls.filter((call) => pending.has(call.id));
  if (waiting.length === 0) return;
  if (phone.waiter) phone.waiter(waiting);
  else phone.queue.unshift(...waiting);
}

export function settle(
  phoneId: string,
  input: {
    readonly id?: unknown;
    readonly ok?: unknown;
    readonly result?: unknown;
    readonly error?: unknown;
  },
): boolean {
  if (typeof input.id !== "string") return false;
  const call = pending.get(input.id);
  if (!call || call.phoneId !== phoneId) return false;
  pending.delete(input.id);
  clearTimeout(call.timer);
  if (input.ok === true) call.resolve(input.result ?? null);
  else {
    const message =
      typeof input.error === "string" && input.error.trim()
        ? input.error.trim().slice(0, 500)
        : "The phone could not do that.";
    call.reject(new Error(message));
  }
  return true;
}

export function describePhone():
  | { readonly connected: false }
  | {
      readonly connected: true;
      readonly label: string;
      readonly tools: ReadonlyArray<PhoneToolName>;
    } {
  const phone = current();
  return phone ? { connected: true, label: phone.label, tools: phone.tools } : { connected: false };
}

/** Runs a tool on the connected phone. Rejects with a message the agent can show the user. */
export function callPhone(tool: PhoneToolName, args: Record<string, unknown>): Promise<unknown> {
  const phone = current();
  if (!phone) {
    return Promise.reject(
      new Error(
        "No phone is connected. The user needs Willow open on their Android phone, paired with this computer.",
      ),
    );
  }
  if (phone.tools.length === 0) {
    return Promise.reject(
      new Error("The phone's owner has turned off agent access in Willow's settings."),
    );
  }
  if (!phone.tools.includes(tool)) {
    return Promise.reject(new Error(`This phone does not offer ${tool}.`));
  }
  sequence += 1;
  const call: PhoneCall = { id: `phone-call-${Date.now().toString(36)}-${sequence}`, tool, args };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(call.id);
      phone.queue = phone.queue.filter((queued) => queued.id !== call.id);
      reject(new Error("The phone did not answer in time. Willow may be in the background there."));
    }, TIMEOUT_MS[tool] ?? DEFAULT_TIMEOUT_MS);
    pending.set(call.id, { phoneId: phone.id, resolve, reject, timer });
    if (phone.waiter) phone.waiter([call]);
    else phone.queue.push(call);
  });
}
