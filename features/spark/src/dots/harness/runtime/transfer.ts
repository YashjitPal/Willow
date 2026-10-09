/**
 * Files between a bot's own computer and the user's, copied as they are, in pieces, through the window: the bot's
 * computer answers through its service (`/files/read`, `/files/write` as base64), the user's through the companion
 * (`fs.read`, `fs.write` as base64). A copy never replaces a file that is already there.
 */
import { computerProblem, type DotComputerBridge } from './computer-bridge';
import { machineProblem, type DotMachineBridge } from './machine-bridge';

/** The most a copy carries. */
export const MAX_COPY_BYTES = 50 * 1024 * 1024;

/** A place on the user's computer: a connected root, and a path in it. */
export interface CopyPlace {
  root: string;
  path: string;
}

export type CopyOutcome = { bytes: number } | { problem: string };

const missing = (error: unknown): boolean => /ENOENT|no such file|does not exist/i.test(error instanceof Error ? error.message : String(error));

export const sizeOf = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};

const tooLarge = (name: string, bytes: number) => ({ problem: `${name} is ${sizeOf(bytes)}, more than the ${sizeOf(MAX_COPY_BYTES)} a copy takes.` });

/** From the bot's folder on its own computer to a new file on the user's. */
export const copyToTheirs = async (
  machine: DotMachineBridge,
  dotId: string,
  computer: DotComputerBridge,
  from: string,
  to: CopyPlace,
  signal?: AbortSignal,
): Promise<CopyOutcome> => {
  if (!computer.readBytes || !computer.writeBytes) return { problem: "Willow's companion here cannot copy files; Willow needs an update." };
  try {
    await computer.readFile(to.root, to.path);
    return { problem: `${to.path} is already there on their computer: copy to a name that is free.` };
  } catch (error) {
    if (!missing(error)) return { problem: computerProblem(error) };
  }
  let offset = 0;
  for (;;) {
    let reply;
    try {
      reply = await machine.call<Record<string, any>>(dotId, { method: 'POST', path: '/files/read', body: { path: from, offset, encoding: 'base64' }, timeoutMs: 60_000 }, signal);
    } catch (error) {
      return { problem: machineProblem(error) };
    }
    if (reply.status < 200 || reply.status >= 300) return { problem: String(reply.body?.error || `Your computer could not read ${from}.`) };
    const body = reply.body;
    if (typeof body.data !== 'string') return { problem: `${from} could not be read as a file.` };
    const total = Number(body.bytes) || 0;
    if (total > MAX_COPY_BYTES) return tooLarge(from, total);
    try {
      await computer.writeBytes(to.root, to.path, body.data, offset > 0);
    } catch (error) {
      return { problem: `${computerProblem(error)}${offset > 0 ? ` Part of the file was copied to ${to.path} already.` : ''}` };
    }
    if (typeof body.next !== 'number') return { bytes: total };
    offset = body.next;
  }
};

/** From a file on the user's computer into the bot's folder on its own. */
export const copyToYours = async (
  machine: DotMachineBridge,
  dotId: string,
  computer: DotComputerBridge,
  from: CopyPlace,
  to: string,
  signal?: AbortSignal,
): Promise<CopyOutcome> => {
  if (!computer.readBytes) return { problem: "Willow's companion here cannot copy files; Willow needs an update." };
  try {
    const there = await machine.call<Record<string, any>>(dotId, { method: 'POST', path: '/files/list', body: { path: to }, timeoutMs: 30_000 }, signal);
    if (there.status >= 200 && there.status < 300) return { problem: `${to} is already in your folder: copy to a name that is free.` };
  } catch (error) {
    return { problem: machineProblem(error) };
  }
  let offset = 0;
  for (;;) {
    let piece;
    try {
      piece = await computer.readBytes(from.root, from.path, offset);
    } catch (error) {
      return { problem: computerProblem(error) };
    }
    if (piece.size > MAX_COPY_BYTES) return tooLarge(from.path, piece.size);
    let reply;
    try {
      reply = await machine.call<Record<string, any>>(dotId, { method: 'POST', path: '/files/write', body: { path: to, contents: piece.data, encoding: 'base64', append: offset > 0 }, timeoutMs: 60_000 }, signal);
    } catch (error) {
      return { problem: machineProblem(error) };
    }
    if (reply.status < 200 || reply.status >= 300) return { problem: String(reply.body?.error || `Your computer could not save ${to}.`) };
    if (piece.next === null) return { bytes: piece.size };
    offset = piece.next;
  }
};
