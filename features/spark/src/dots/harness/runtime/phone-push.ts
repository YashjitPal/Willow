/**
 * The user's phone, through ntfy (ntfy.sh, or a server of their own): what a bot would notify on this computer also
 * goes there, so it reaches the user when they are away from it. One topic for every bot, kept on this device.
 *
 * Anyone who knows a topic's name on ntfy.sh can read it, so Willow makes up one nobody would guess; the user
 * subscribes to it in the ntfy app. Published as JSON, because a request header cannot carry a bot's name in every
 * script.
 */
import { atom } from 'nanostores';

export interface PhonePush {
  server: string;
  topic: string;
}

const STORAGE_KEY = 'willow:dots:phone-push';
const TOPIC = /^[A-Za-z0-9_-]{8,64}$/;
export const DEFAULT_PUSH_SERVER = 'https://ntfy.sh';

const read = (): PhonePush | null => {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null') as Partial<PhonePush> | null;
    if (!saved || typeof saved.topic !== 'string' || !TOPIC.test(saved.topic)) return null;
    const server = typeof saved.server === 'string' && /^https:\/\/[^\s/]+/.test(saved.server) ? saved.server.replace(/\/+$/, '') : DEFAULT_PUSH_SERVER;
    return { server, topic: saved.topic };
  } catch {
    return null;
  }
};

export const phonePush = atom<PhonePush | null>(read());

export const newPhoneTopic = (): string =>
  `willow-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(15)), (byte) => (byte % 36).toString(36)).join('')}`;

export const setPhonePush = (next: PhonePush | null): void => {
  phonePush.set(next);
  try {
    if (next) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or embedded contexts; the choice lasts for the session.
  }
};

/** Where the user subscribes: the topic's page, which the ntfy app also opens. */
export const phoneTopicUrl = (push: PhonePush): string => `${push.server}/${push.topic}`;

export const pushToPhone = async (push: PhonePush, title: string, message: string, fetcher: typeof fetch = fetch): Promise<boolean> => {
  try {
    const response = await fetcher(`${push.server}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: push.topic, title, message, tags: ['speech_balloon'] }),
    });
    return response.ok;
  } catch {
    return false;
  }
};
