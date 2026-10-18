/**
 * `send_file`: a file or a picture to the user, in the conversation — one on their computer, on the bot's own, in its
 * workspace, or the screen it last took a picture of — as a message of the bot's with the file on it, which they open
 * or save from there. Where the conversation is on Discord or Telegram it goes there too, as the bot's messages do
 * (`dot-runtime.ts`), but never into a server channel others read.
 *
 * Sending the user what is theirs, to them, needs no one's go-ahead; what holds secrets stays out of reach. A picture
 * comes back to the bot with the result, so it sees what it sent.
 */
import type { Attachment } from '@willow/ai/chat';
import { keepSentFile, MAX_SENT_FILE_BYTES } from '../runtime/dot-attachments';
import { latestScreen } from '../runtime/last-screen';
import { computerProblem } from '../runtime/computer-bridge';
import { machineProblem } from '../runtime/machine-bridge';
import { viewOf } from '../runtime/screen-view';
import { sizeOf } from '../runtime/transfer';
import { appendDotItem } from '../thread/thread-store';
import { isSecretPath, locatePath, shownPath } from './computer-tools';
import { MACHINE_WORKSPACE } from './machine-tools';
import { fail, ok, stringArg, type DotToolEntry, type DotToolEnv } from './tool-env';
import { ownPath } from './transfer-tools';

const SOURCES: Record<string, 'theirs' | 'yours' | 'workspace' | 'screenshot'> = {
  theirs: 'theirs', user: 'theirs', "user's": 'theirs', 'their computer': 'theirs',
  yours: 'yours', mine: 'yours', own: 'yours', 'your computer': 'yours',
  workspace: 'workspace',
  screenshot: 'screenshot', screen: 'screenshot',
};

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  heic: 'image/heic', avif: 'image/avif', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html',
  xml: 'application/xml', zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** What a file is: by what its first bytes say for the common pictures, else by its name. */
export const typeOf = (name: string, bytes?: Uint8Array): string => {
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  }
  return TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
};

const fileName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const fromBase64 = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const tooBig = (name: string, bytes: number) => fail(`${name} is ${sizeOf(bytes)}, more than the ${sizeOf(MAX_SENT_FILE_BYTES)} a file sent in the conversation can be. Tell the user where it is instead.`);

/** A screenshot's name as a screenshot tool would give it, in the user's own time. */
const screenshotName = (at: number, timeZone: string, mimeType: string): string => {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at).replace(/:/g, '.');
  return `Screenshot ${date} at ${time}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
};

// The most of a picture sent back to the bot as it is, which every provider takes; a larger one is drawn smaller.
const MAX_SEEN_BYTES = 3_500_000;

/** The picture as the bot is sent it with the result, when it can be: as it is, or drawn to its model's size. */
const seenAs = async (env: DotToolEnv, bytes: Uint8Array, data: string, mimeType: string): Promise<Attachment | null> => {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(mimeType)) return null;
  if (bytes.length <= MAX_SEEN_BYTES) return { type: 'image', mimeType, data };
  if (!env.vision || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    const { width, height } = bitmap;
    bitmap.close();
    const { picture } = await viewOf(env.vision, { data, width, height, mimeType });
    return picture.data === data ? null : { type: 'image', mimeType: picture.mimeType ?? 'image/jpeg', data: picture.data };
  } catch {
    return null;
  }
};

export const sendFileTool = (env: DotToolEnv): DotToolEntry => {
  const places = [
    env.computer ? `"theirs" for one on the user's computer (${env.computer.whole ? 'a full path, or one from their home folder' : `relative to ${env.computer.root}`})` : null,
    env.machine ? `"yours" for one in your folder on your own computer (${MACHINE_WORKSPACE})` : null,
    '"workspace" for one in your workspace',
    env.screen || env.machine ? '"screenshot" for the screen you last took a picture of, as it was' : null,
  ].filter((place): place is string => place !== null);
  return {
    doc: {
      name: 'send_file',
      args: '{"from": "theirs", "path": "…", "message": "…"}',
      description: `Send the user a file or a picture: it arrives in the conversation as a message of yours they can open and save, up to ${sizeOf(MAX_SENT_FILE_BYTES)}. "from" is where it is — ${places.join('; ')}. "path" is where it is there (none for a screenshot); "message", what you say with it, if anything. A picture comes back to you with the result, so you see what you sent. Files that hold keys or credentials are never sent.`,
    },
    handler: {
      id: 'send_file',
      async run(args, context) {
        const from = SOURCES[(stringArg(args, 'from') ?? '').toLowerCase()];
        if (!from) return fail(`Say "from": ${places.map((place) => place.split(' ')[0]).join(', ')}.`);
        const path = stringArg(args, 'path') ?? '';
        const caption = typeof args.message === 'string' ? args.message.trim().slice(0, 4_000) : '';
        let name: string;
        let bytes: Uint8Array;
        let data: string;
        let what: string;

        if (from === 'screenshot') {
          if (!env.screen && !env.machine) return fail('There is no screen here to send a picture of.');
          const screen = latestScreen(env.dotId);
          if (!screen) return fail('Take a screenshot first: this sends the screen you last took a picture of.');
          data = screen.data;
          bytes = fromBase64(data);
          name = screenshotName(screen.at, env.timeZone, screen.mimeType);
          what = `the screenshot of ${screen.of}`;
        } else if (from === 'theirs') {
          if (!env.computer) return fail('The user has not connected their computer, so nothing on it can be sent.');
          const place = locatePath(env.computer, path);
          if (!place || place.path === '.') return fail(`"${path}" is not a file you can reach on their computer.`);
          if (isSecretPath(place.path)) return fail(`${path} looks like it holds secrets, so it is never sent.`);
          const { bridge } = env.computer;
          if (!bridge.readBytes) return fail("Willow's companion here cannot read files whole; Willow needs an update.");
          const shown = shownPath(env.computer, place.root, place.path);
          const pieces: string[] = [];
          try {
            for (let offset = 0; ;) {
              const piece = await bridge.readBytes(place.root, place.path, offset);
              if (piece.size > MAX_SENT_FILE_BYTES) return tooBig(shown, piece.size);
              pieces.push(piece.data);
              if (piece.next === null) break;
              offset = piece.next;
            }
          } catch (error) {
            return fail(computerProblem(error));
          }
          bytes = concat(pieces.map(fromBase64));
          data = pieces.length === 1 ? pieces[0]! : toBase64(bytes);
          name = fileName(shown);
          what = shown;
        } else if (from === 'yours') {
          if (!env.machine?.ready) return fail('Your own computer is not set up yet, so nothing on it can be sent.');
          const own = ownPath(path);
          if (!own) return fail(`"path" is a file in your folder on your own computer (${MACHINE_WORKSPACE}), such as a path within it.`);
          if (isSecretPath(own)) return fail(`${own} looks like it holds secrets, so it is never sent.`);
          const pieces: string[] = [];
          for (let offset = 0; ;) {
            let reply;
            try {
              reply = await env.machine.bridge.call<Record<string, any>>(env.dotId, { method: 'POST', path: '/files/read', body: { path: own, offset, encoding: 'base64' }, timeoutMs: 60_000 }, context.signal);
            } catch (error) {
              return fail(machineProblem(error));
            }
            if (reply.status < 200 || reply.status >= 300) return fail(String(reply.body?.error || `Your computer could not read ${own}.`));
            if (typeof reply.body.data !== 'string') return fail(`${own} could not be read as a file.`);
            if (Number(reply.body.bytes) > MAX_SENT_FILE_BYTES) return tooBig(own, Number(reply.body.bytes));
            pieces.push(reply.body.data);
            if (typeof reply.body.next !== 'number') break;
            offset = reply.body.next;
          }
          bytes = concat(pieces.map(fromBase64));
          data = pieces.length === 1 ? pieces[0]! : toBase64(bytes);
          name = fileName(own);
          what = `${own} from your computer`;
        } else {
          const key = path.startsWith('/') ? path : `/${path}`;
          const text = context.readFiles()[key];
          if (text === undefined) return fail(`${key} is not in your workspace.`);
          bytes = new TextEncoder().encode(text);
          data = toBase64(bytes);
          name = fileName(key);
          what = `${key} from your workspace`;
        }

        if (bytes.length > MAX_SENT_FILE_BYTES) return tooBig(name, bytes.length);
        const mimeType = typeOf(name, bytes);
        let ref;
        try {
          ref = await keepSentFile(new Blob([bytes], { type: mimeType }), name, mimeType);
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
        const item = appendDotItem(env.dotId, { kind: 'dot', text: caption, attachments: [ref], turnId: context.turnId });
        context.delivered?.(item.id);
        const seen = from === 'screenshot' ? null : await seenAs(env, bytes, data, mimeType);
        return {
          observation: `Sent ${what} to the user (${item.id}, ${sizeOf(bytes.length)}).${seen ? ' It comes with this step\'s results.' : ''}`,
          ...(seen ? { images: [seen] } : {}),
        };
      },
    },
  };
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};
