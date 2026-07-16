import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomId(len = 20): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newId(prefix: string, len = 20): string {
  return `${prefix}_${randomId(len)}`;
}

export const ids = {
  workflow: () => newId('wf'),
  run: () => newId('run'),
  span: () => newId('span', 12),
  approval: () => newId('appr'),
  mcpServer: () => newId('mcp'),
  vectorStore: () => newId('vs'),
  vectorStoreFile: () => newId('vsf'),
  session: () => newId('cks'),
  thread: () => newId('th'),
  message: () => newId('msg', 12),
  evaluation: () => newId('eval'),
  evaluationRun: () => newId('evalrun'),
  secret: () => newId('chatkit_token', 32),
  node: () => newId('node', 10),
  edge: () => newId('edge', 10),
};

export function nowIso(): string {
  return new Date().toISOString();
}
