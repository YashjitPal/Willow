/**
 * Agent paths — a port of `codex-rs/protocol/src/agent_path.rs`.
 *
 * Every agent in a collaboration tree has an address that looks like a POSIX
 * path: the turn the user started is `/root`, an agent it spawns as `explore`
 * is `/root/explore`, and one that agent spawns is `/root/explore/deeper`.
 *
 * ## Why addresses rather than opaque ids
 *
 * Because agents talk to each other, and the address is what makes that
 * possible without a directory service. Upstream's own `spawn_agent`
 * description spells out the rule:
 *
 *   "If your current task is `/root/task1` and you spawn_agent with task_name
 *    "task_3" the agent will have canonical task name `/root/task1/task_3`. You
 *    are then able to refer to this agent as `task_3` or `/root/task1/task_3`
 *    interchangeably. However an agent `/root/task2/task_3` would only be able
 *    to communicate with this agent via its canonical name."
 *
 * So a name is relative to whoever said it. `task_3` means "my child called
 * task_3"; a sibling's child has to be named in full. That asymmetry is the
 * whole design, and it falls out of `resolve` below.
 *
 * ## The naming rules are strict on purpose
 *
 * Lowercase letters, digits and underscores only; `root`, `.` and `..` are
 * reserved. A path is parsed from model-supplied text and then used as a map
 * key and a message address, so a name containing `/` or `..` would let one
 * agent address another by a path that does not mean what it appears to.
 */

export const ROOT_PATH = '/root';
const ROOT_SEGMENT = 'root';

/**
 * `validate_agent_name`. Returns the upstream error message, or null.
 *
 * The messages are reproduced exactly because they are handed back to the
 * model, which is expected to correct itself and retry.
 */
export function validateAgentName(agentName: string): string | null {
  if (agentName.length === 0) return 'agent_name must not be empty';
  if (agentName === ROOT_SEGMENT) return 'agent_name `root` is reserved';
  if (agentName === '.' || agentName === '..') {
    return `agent_name \`${agentName}\` is reserved`;
  }
  if (agentName.includes('/')) return 'agent_name must not contain `/`';
  if (!/^[a-z0-9_]+$/.test(agentName)) {
    return 'agent_name must use only lowercase letters, digits, and underscores';
  }
  return null;
}

/** `validate_absolute_path`. */
function validateAbsolutePath(path: string): string | null {
  if (!path.startsWith('/')) {
    return 'absolute agent paths must start with `/root` or be `/morpheus`';
  }
  const stripped = path.slice(1);
  const segments = stripped.split('/');
  if (segments[0] !== ROOT_SEGMENT) {
    return 'absolute agent paths must start with `/root` or be `/morpheus`';
  }
  if (stripped.endsWith('/')) return 'absolute agent path must not end with `/`';

  for (const segment of segments.slice(1)) {
    const invalid = validateAgentName(segment);
    if (invalid) return invalid;
  }
  return null;
}

/** `validate_relative_reference`. Multi-segment relative references are legal. */
function validateRelativeReference(reference: string): string | null {
  if (reference.endsWith('/')) return 'relative agent path must not end with `/`';
  for (const segment of reference.split('/')) {
    const invalid = validateAgentName(segment);
    if (invalid) return invalid;
  }
  return null;
}

export interface PathError {
  error: string;
}

export const isPathError = (value: string | PathError): value is PathError =>
  typeof value !== 'string';

/**
 * `AgentPath::resolve` — the one function that matters.
 *
 * Absolute references are taken as given; relative ones are appended to the
 * caller's own path, which is what makes `task_3` mean different agents
 * depending on who said it.
 */
export function resolveAgentPath(
  currentPath: string,
  reference: string,
): string | PathError {
  if (reference.length === 0) return { error: 'agent path must not be empty' };
  if (reference === ROOT_PATH) return ROOT_PATH;

  if (reference.startsWith('/')) {
    const invalid = validateAbsolutePath(reference);
    return invalid ? { error: invalid } : reference;
  }

  const invalid = validateRelativeReference(reference);
  if (invalid) return { error: invalid };

  const joined = `${currentPath}/${reference}`;
  const invalidJoined = validateAbsolutePath(joined);
  return invalidJoined ? { error: invalidJoined } : joined;
}

/** `AgentPath::join`, for building a child's path from one validated segment. */
export function joinAgentPath(currentPath: string, agentName: string): string | PathError {
  const invalid = validateAgentName(agentName);
  if (invalid) return { error: invalid };
  return `${currentPath}/${agentName}`;
}

/** `AgentPath::name` — the last segment, or `root`. */
export function agentPathName(path: string): string {
  if (path === ROOT_PATH) return ROOT_SEGMENT;
  const last = path.split('/').pop();
  return last && last.length > 0 ? last : ROOT_SEGMENT;
}

/** The path of whoever spawned this one. `/root`'s parent is itself. */
export function parentAgentPath(path: string): string {
  if (path === ROOT_PATH) return ROOT_PATH;
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? ROOT_PATH : path.slice(0, cut);
}

export const isRootPath = (path: string): boolean => path === ROOT_PATH;

/**
 * Coerces free text into a legal segment.
 *
 * Upstream rejects a bad `task_name` outright and lets the model retry, and so
 * does `spawn_agent` here. This exists for the *display* side and for
 * de-duplication, where a rejection would be unhelpful — two agents legitimately
 * asked for the same name need distinct addresses, not an error.
 */
export function slugifyAgentName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug.length > 0 && slug !== ROOT_SEGMENT ? slug : 'agent';
}

/** Appends `_2`, `_3`, … until the child path is free. */
export function uniqueChildPath(
  parentPath: string,
  agentName: string,
  taken: (path: string) => boolean,
): string {
  const base = slugifyAgentName(agentName);
  let candidate = base;
  let suffix = 2;
  while (taken(`${parentPath}/${candidate}`)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return `${parentPath}/${candidate}`;
}
