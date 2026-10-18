/**
 * MCP tools as native function declarations, for a turn that calls tools the provider's way (Chat) rather than by
 * writing JSON in a tag (Code's harness, Spark).
 *
 * Callers write one tool list in Gemini's `functionDeclarations` shape and `chat.ts` translates it for every other
 * provider. Two things a server's tools cannot be handed over as they are:
 *
 * - **Names.** Gemini, OpenAI and Anthropic all take at most 64 characters of letters, digits, `_` and `-`, and
 *   `mcp__<server>__<tool>` may run to 128 and carry a dot. A name that does not fit is cut, with a hash of the full
 *   one so two long names never meet.
 * - **Schemas.** Gemini takes a subset of OpenAPI's schema, and answers a request holding anything else with a 400
 *   that fails the whole turn. Servers write full JSON Schema: `$ref`, `anyOf`, `const`, `additionalProperties`,
 *   types listed with `null`. So each schema is rewritten into the subset — references followed, unions reduced to
 *   their first usable member, enums kept only as strings — and an object with no listed properties, which Gemini
 *   refuses, is asked for as JSON written out as text. `reviveArguments` turns that text back into the object before
 *   the call reaches the server. What is left is also plain JSON Schema once `chat.ts` lowercases the types, so
 *   nothing Gemini alone reads (`nullable`) is written.
 */
import type { McpBoundTool } from './mcp-store';

type Schema = Record<string, unknown>;

/** The longest declaration name every provider accepts. */
export const MAX_DECLARATION_NAME = 64;
const MAX_DEPTH = 8;
const MAX_DESCRIPTION = 1_000;

const isSchema = (value: unknown): value is Schema => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const omit = (schema: Schema, ...keys: string[]): Schema => Object.fromEntries(Object.entries(schema).filter(([key]) => !keys.includes(key)));

/** FNV-1a, base 36: short, stable, and different for names that differ anywhere. */
const hash = (text: string): string => {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-7);
};

/** A qualified MCP tool name as every provider accepts one. `taken` holds names already handed out this turn. */
export const declarationName = (qualifiedName: string, taken: { has: (name: string) => boolean } = new Set<string>()): string => {
  const safe = qualifiedName.replace(/[^A-Za-z0-9_-]/g, '_');
  if (safe.length <= MAX_DECLARATION_NAME && !taken.has(safe)) return safe;
  return `${safe.slice(0, MAX_DECLARATION_NAME - 8)}_${hash(qualifiedName)}`;
};

const resolveRef = (ref: unknown, root: Schema): Schema | undefined => {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isSchema(node)) return undefined;
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isSchema(node) ? node : undefined;
};

/** A schema with its `$ref` and `allOf` folded in, so what is left describes the value directly. */
const flatten = (schema: Schema, root: Schema, seen: ReadonlySet<string>): { schema: Schema; seen: ReadonlySet<string> } => {
  let current = schema;
  let visited = seen;
  for (let guard = 0; guard < MAX_DEPTH && typeof current.$ref === 'string'; guard += 1) {
    const ref = current.$ref as string;
    const target = visited.has(ref) ? undefined : resolveRef(ref, root);
    const rest = omit(current, '$ref');
    if (!target) return { schema: rest, seen: visited };
    visited = new Set([...visited, ref]);
    current = { ...target, ...rest };
  }
  if (Array.isArray(current.allOf)) {
    const allOf = current.allOf as unknown[];
    const rest = omit(current, 'allOf');
    const merged: Schema = { ...rest };
    const properties: Schema = isSchema(rest.properties) ? { ...rest.properties } : {};
    const required = new Set(Array.isArray(rest.required) ? rest.required.filter((name): name is string => typeof name === 'string') : []);
    for (const part of allOf) {
      if (!isSchema(part)) continue;
      const flat = flatten(part, root, visited).schema;
      if (isSchema(flat.properties)) Object.assign(properties, flat.properties);
      if (Array.isArray(flat.required)) for (const name of flat.required) if (typeof name === 'string') required.add(name);
      if (merged.type === undefined && flat.type !== undefined) merged.type = flat.type;
      if (merged.description === undefined && typeof flat.description === 'string') merged.description = flat.description;
    }
    if (Object.keys(properties).length) merged.properties = properties;
    if (required.size) merged.required = [...required];
    current = merged;
  }
  return { schema: current, seen: visited };
};

const typesOf = (schema: Schema): string[] => {
  if (Array.isArray(schema.type)) return schema.type.filter((type): type is string => typeof type === 'string').map((type) => type.toLowerCase());
  if (typeof schema.type === 'string') return [schema.type.toLowerCase()];
  if (isSchema(schema.properties)) return ['object'];
  if (schema.items !== undefined) return ['array'];
  if (Array.isArray(schema.enum) || schema.const !== undefined) return ['string'];
  return [];
};

const clip = (text: string, limit = MAX_DESCRIPTION): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const describe = (schema: Schema, extra?: string): Record<string, string> => {
  const own = typeof schema.description === 'string' ? schema.description.trim() : typeof schema.title === 'string' ? schema.title.trim() : '';
  const text = [own, extra].filter(Boolean).join(own && extra ? ' ' : '');
  return text ? { description: clip(text) } : {};
};

const JSON_TEXT = 'Write it as JSON text.';

/** One schema node in Gemini's subset, or null when nothing of it can be described. */
const toGemini = (input: unknown, root: Schema, depth: number, seen: ReadonlySet<string>): Schema | null => {
  if (!isSchema(input)) return input === true ? { type: 'STRING', description: JSON_TEXT } : null;
  if (depth > MAX_DEPTH) return { type: 'STRING', ...describe(input, JSON_TEXT) };
  const flat = flatten(input, root, seen);
  const schema = flat.schema;

  const union = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (union) {
    const variants = union.filter(isSchema).map((variant) => flatten(variant, root, flat.seen).schema);
    // A null member only says the value may be left out, which an optional parameter already says.
    const present = variants.filter((variant) => !(typesOf(variant).length === 1 && typesOf(variant)[0] === 'null'));
    const constants = present.flatMap((variant) => (typeof variant.const === 'string' ? [variant.const] : Array.isArray(variant.enum) && variant.enum.every((value) => typeof value === 'string') ? variant.enum as string[] : [null]));
    if (present.length && constants.every((value): value is string => value !== null)) {
      return { type: 'STRING', ...describe(schema), enum: [...new Set(constants)] };
    }
    const pick = present.find((variant) => isSchema(variant.properties)) ?? present[0];
    if (!pick) return null;
    return toGemini({ ...pick, ...(typeof schema.description === 'string' ? { description: schema.description } : {}) }, root, depth + 1, flat.seen);
  }

  const type = typesOf(schema).find((candidate) => candidate !== 'null');

  if (schema.const !== undefined) {
    return typeof schema.const === 'string'
      ? { type: 'STRING', ...describe(schema), enum: [schema.const] }
      : { type: typeof schema.const === 'number' ? 'NUMBER' : typeof schema.const === 'boolean' ? 'BOOLEAN' : 'STRING', ...describe(schema, `Always ${JSON.stringify(schema.const)}.`) };
  }

  switch (type) {
    case 'string': {
      const values = Array.isArray(schema.enum) ? schema.enum : null;
      const strings = values?.every((value) => typeof value === 'string') ? (values as string[]) : null;
      return {
        type: 'STRING',
        ...describe(schema, values && !strings ? `One of ${values.map((value) => JSON.stringify(value)).join(', ')}.` : undefined),
        ...(strings?.length ? { enum: strings } : {}),
        ...(schema.format === 'date-time' ? { format: 'date-time' } : {}),
      };
    }
    case 'number':
    case 'integer': {
      const values = Array.isArray(schema.enum) ? schema.enum : null;
      return { type: type === 'integer' ? 'INTEGER' : 'NUMBER', ...describe(schema, values ? `One of ${values.join(', ')}.` : undefined) };
    }
    case 'boolean':
      return { type: 'BOOLEAN', ...describe(schema) };
    case 'array': {
      const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      return { type: 'ARRAY', ...describe(schema), items: toGemini(items, root, depth + 1, flat.seen) ?? { type: 'STRING' } };
    }
    case 'object': {
      const properties: Schema = {};
      for (const [name, child] of Object.entries(isSchema(schema.properties) ? schema.properties : {})) {
        const converted = toGemini(child, root, depth + 1, flat.seen);
        if (converted) properties[name] = converted;
      }
      if (!Object.keys(properties).length) return { type: 'STRING', ...describe(schema, `An object. ${JSON_TEXT}`) };
      const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string' && name in properties) : [];
      return { type: 'OBJECT', ...describe(schema), properties, ...(required.length ? { required } : {}) };
    }
    default:
      // No type at all is any value.
      return { type: 'STRING', ...describe(schema, `Any value. ${JSON_TEXT}`) };
  }
};

/** A server's input schema as Gemini-shaped parameters, or undefined for a tool that takes none. */
export const declarationParameters = (inputSchema: Record<string, unknown> | undefined): Schema | undefined => {
  if (!isSchema(inputSchema)) return undefined;
  const converted = toGemini({ ...inputSchema, type: 'object' }, inputSchema, 0, new Set());
  return converted?.type === 'OBJECT' ? converted : undefined;
};

const wantsStructure = (schema: Schema, root: Schema, seen: ReadonlySet<string>): 'object' | 'array' | 'any' | null => {
  const flat = flatten(schema, root, seen).schema;
  const union = Array.isArray(flat.anyOf) ? flat.anyOf : Array.isArray(flat.oneOf) ? flat.oneOf : null;
  if (union) {
    const wants = union.filter(isSchema).map((variant) => wantsStructure(variant, root, seen));
    const takesText = union.filter(isSchema).some((variant) => typesOf(flatten(variant, root, seen).schema).includes('string'));
    return takesText ? null : wants.find((want) => want === 'object' || want === 'array') ?? null;
  }
  const types = typesOf(flat);
  if (types.includes('string')) return null;
  if (types.includes('object')) return 'object';
  if (types.includes('array')) return 'array';
  return types.length ? null : 'any';
};

/**
 * Arguments as the server's schema asks for them: an object or array the declaration asked for as JSON text is
 * parsed back, at any depth. Text that does not parse is passed on as it is, for the server to refuse in its own words.
 */
export const reviveArguments = (args: unknown, inputSchema: Record<string, unknown> | undefined): Record<string, unknown> => {
  const root = isSchema(inputSchema) ? inputSchema : {};
  const revive = (value: unknown, schema: unknown, depth: number): unknown => {
    if (!isSchema(schema) || depth > MAX_DEPTH) return value;
    const flat = flatten(schema, root, new Set()).schema;
    if (typeof value === 'string') {
      const want = wantsStructure(flat, root, new Set());
      const text = value.trim();
      if (!want || (want === 'any' && !/^[[{]/.test(text))) return value;
      try {
        const parsed = JSON.parse(text);
        if (want === 'object' && !isSchema(parsed)) return value;
        if (want === 'array' && !Array.isArray(parsed)) return value;
        return revive(parsed, flat, depth + 1);
      } catch {
        return value;
      }
    }
    if (Array.isArray(value)) {
      const items = Array.isArray(flat.items) ? flat.items[0] : flat.items;
      return value.map((item) => revive(item, items, depth + 1));
    }
    if (isSchema(value)) {
      const union = Array.isArray(flat.anyOf) ? flat.anyOf : Array.isArray(flat.oneOf) ? flat.oneOf : null;
      const shape = union ? union.filter(isSchema).map((variant) => flatten(variant, root, new Set()).schema).find((variant) => isSchema(variant.properties)) ?? flat : flat;
      const properties = isSchema(shape.properties) ? shape.properties : {};
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, revive(entry, properties[key], depth + 1)]));
    }
    return value;
  };
  const revived = revive(isSchema(args) ? args : {}, { ...root, type: 'object' }, 0);
  return isSchema(revived) ? revived : {};
};

/**
 * The declarations for a set of bound tools, at most `limit` of them, and the tool each declared name calls. Each
 * description starts with the app's name, so a model reading forty tools knows whose each one is.
 */
export const mcpFunctionDeclarations = (
  tools: readonly McpBoundTool[],
  { limit = 64 }: { limit?: number } = {},
): { declarations: { functionDeclarations: Schema[] }[]; byName: Map<string, McpBoundTool> } => {
  const byName = new Map<string, McpBoundTool>();
  const functionDeclarations: Schema[] = [];
  for (const tool of tools.slice(0, limit)) {
    const name = declarationName(tool.qualifiedName, byName);
    const description = (tool.description ?? '').trim().replace(/\s+/g, ' ');
    const parameters = declarationParameters(tool.inputSchema);
    byName.set(name, tool);
    functionDeclarations.push({
      name,
      description: clip(`${tool.serverLabel}: ${description || tool.toolName}`),
      ...(parameters ? { parameters } : {}),
    });
  }
  return { declarations: functionDeclarations.length ? [{ functionDeclarations }] : [], byName };
};
