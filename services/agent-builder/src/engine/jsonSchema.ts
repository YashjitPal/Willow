/**
 * JSON Schema subset: validation + coercion for structured agent outputs and
 * declared workflow variables. Supports: type (string|number|integer|boolean|
 * object|array|null), properties/required/additionalProperties, items, enum,
 * anyOf, minimum/maximum, minLength/maxLength, minItems/maxItems.
 */

import type { JsonObject, JsonSchema, JsonValue, VarType } from '../domain/types.ts';

export interface SchemaIssue {
  path: string;
  message: string;
}

const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

/** Validate the schema document itself before it is sent to a provider. */
export function validateSchemaDefinition(schema: JsonSchema, path = '$', depth = 0): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (depth > 12) return [{ path, message: 'schema nesting exceeds 12 levels' }];
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [{ path, message: 'schema must be an object' }];
  }
  const type = schema.type;
  const types = typeof type === 'string' ? [type] : Array.isArray(type) ? type : [];
  const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : [];
  if (types.length === 0 && alternatives.length === 0) issues.push({ path: `${path}.type`, message: 'type or anyOf is required' });
  for (const candidate of types) {
    if (typeof candidate !== 'string' || !SCHEMA_TYPES.has(candidate)) {
      issues.push({ path: `${path}.type`, message: `unsupported type '${String(candidate)}'` });
    }
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    issues.push({ path: `${path}.enum`, message: 'enum must be a non-empty array' });
  }
  alternatives.forEach((alternative, index) => {
    if (!alternative || typeof alternative !== 'object' || Array.isArray(alternative)) {
      issues.push({ path: `${path}.anyOf[${index}]`, message: 'anyOf entries must be schema objects' });
    } else {
      issues.push(...validateSchemaDefinition(alternative as JsonSchema, `${path}.anyOf[${index}]`, depth + 1));
    }
  });
  if (types.includes('object')) {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      issues.push({ path: `${path}.properties`, message: 'object schemas need a properties object' });
    } else {
      for (const [name, child] of Object.entries(schema.properties)) {
        if (!name.trim()) issues.push({ path: `${path}.properties`, message: 'property names cannot be empty' });
        if (!child || typeof child !== 'object' || Array.isArray(child)) {
          issues.push({ path: `${path}.properties.${name}`, message: 'property schema must be an object' });
        } else {
          issues.push(...validateSchemaDefinition(child as JsonSchema, `${path}.properties.${name}`, depth + 1));
        }
      }
      if (schema.required !== undefined) {
        if (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== 'string')) {
          issues.push({ path: `${path}.required`, message: 'required must be an array of property names' });
        } else {
          for (const name of schema.required) {
            if (!((name as string) in schema.properties)) {
              issues.push({ path: `${path}.required`, message: `unknown required property '${String(name)}'` });
            }
          }
        }
      }
      const propertyNames = Object.keys(schema.properties);
      const requiredNames = Array.isArray(schema.required) ? new Set(schema.required.filter((name): name is string => typeof name === 'string')) : new Set<string>();
      for (const name of propertyNames) {
        if (!requiredNames.has(name)) issues.push({ path: `${path}.required`, message: `strict schemas must require property '${name}'` });
      }
      if (schema.additionalProperties !== false) {
        issues.push({ path: `${path}.additionalProperties`, message: 'strict object schemas must set additionalProperties to false' });
      }
    }
  }
  if (types.includes('array')) {
    if (!schema.items || typeof schema.items !== 'object' || Array.isArray(schema.items)) {
      issues.push({ path: `${path}.items`, message: 'array schemas need an items schema' });
    } else {
      issues.push(...validateSchemaDefinition(schema.items as JsonSchema, `${path}.items`, depth + 1));
    }
  }
  for (const [minimum, maximum] of [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems']] as const) {
    const min = schema[minimum];
    const max = schema[maximum];
    if (min !== undefined && (typeof min !== 'number' || min < 0)) issues.push({ path: `${path}.${minimum}`, message: `${minimum} must be a non-negative number` });
    if (max !== undefined && (typeof max !== 'number' || max < 0)) issues.push({ path: `${path}.${maximum}`, message: `${maximum} must be a non-negative number` });
    if (typeof min === 'number' && typeof max === 'number' && min > max) issues.push({ path, message: `${minimum} cannot exceed ${maximum}` });
  }
  return issues;
}

function typeOf(v: JsonValue): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'number': return Number.isInteger(v) ? 'integer' : 'number';
    default: return 'object';
  }
}

function matchesType(v: JsonValue, t: string): boolean {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  if (t === 'integer') return actual === 'integer';
  return actual === t;
}

export function validateAgainstSchema(
  value: JsonValue,
  schema: JsonSchema,
  path = '$',
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!schema || typeof schema !== 'object') return issues;

  const type = schema.type;
  if (typeof type === 'string') {
    if (!matchesType(value, type)) {
      issues.push({ path, message: `expected ${type}, got ${typeOf(value)}` });
      return issues;
    }
  } else if (Array.isArray(type)) {
    if (!type.some((t) => typeof t === 'string' && matchesType(value, t))) {
      issues.push({ path, message: `expected one of [${type.join(', ')}], got ${typeOf(value)}` });
      return issues;
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some(
      (sub) => sub && typeof sub === 'object' && !Array.isArray(sub)
        && validateAgainstSchema(value, sub as JsonSchema, path).length === 0,
    );
    if (!ok) issues.push({ path, message: 'did not match any of the anyOf schemas' });
  }

  if (Array.isArray(schema.enum)) {
    const ok = schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
    if (!ok) issues.push({ path, message: `value not in enum` });
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ path, message: `length must be >= ${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ path, message: `length must be <= ${schema.maxLength}` });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ path, message: `must have >= ${schema.minItems} items` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ path, message: `must have <= ${schema.maxItems} items` });
    }
    const items = schema.items;
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      value.forEach((item, i) => {
        issues.push(...validateAgainstSchema(item, items as JsonSchema, `${path}[${i}]`));
      });
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const req of required) {
      if (typeof req === 'string' && !(req in value)) {
        issues.push({ path, message: `missing required property '${req}'` });
      }
    }
    if (props && typeof props === 'object' && !Array.isArray(props)) {
      for (const [key, sub] of Object.entries(props)) {
        if (key in value && sub && typeof sub === 'object' && !Array.isArray(sub)) {
          issues.push(
            ...validateAgainstSchema(
              (value as JsonObject)[key],
              sub as JsonSchema,
              `${path}.${key}`,
            ),
          );
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in props)) {
            issues.push({ path: `${path}.${key}`, message: 'additional property not allowed' });
          }
        }
      }
    }
  }

  return issues;
}

/** Build a JSON schema from the UI's "Simple" property rows. */
export function schemaFromSimpleProperties(
  properties: Array<{ name: string; type: string; description?: string }>,
): JsonSchema {
  const props: JsonObject = {};
  const required: string[] = [];
  for (const p of properties) {
    if (!p.name) continue;
    const t = p.type.toLowerCase();
    const jsonType =
      t === 'string' ? 'string'
      : t === 'number' ? 'number'
      : t === 'boolean' ? 'boolean'
      : t === 'object' ? 'object'
      : t === 'array' || t === 'list' ? 'array'
      : 'string';
    const entry: JsonObject = { type: jsonType };
    if (p.description) entry.description = p.description;
    // Strict structured outputs require an item schema for arrays. The simple
    // UI only captures the collection type, so use the documented neutral
    // string-item default rather than emitting an invalid empty schema.
    if (jsonType === 'array') entry.items = { type: 'string' };
    props[p.name] = entry;
    required.push(p.name);
  }
  return {
    type: 'object',
    properties: props,
    required,
    additionalProperties: false,
  };
}

/** Map a VarType to a JSON schema type. */
export function varTypeToSchema(t: VarType): JsonSchema {
  switch (t) {
    case 'string': return { type: 'string' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'object': return { type: 'object' };
    case 'list': return { type: 'array' };
  }
}

/** Default value for a VarType. */
export function defaultForVarType(t: VarType): JsonValue {
  switch (t) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'object': return {};
    case 'list': return [];
  }
}

/** Coerce a raw (possibly string) value into the declared VarType. */
export function coerceToVarType(value: JsonValue, t: VarType): JsonValue {
  if (value === null || value === undefined) return defaultForVarType(t);
  switch (t) {
    case 'string':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'number': {
      if (typeof value === 'number') return value;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
      throw new Error(`cannot coerce '${String(value)}' to number`);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error(`cannot coerce '${String(value)}' to boolean`);
    }
    case 'object': {
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as JsonValue;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch { /* fallthrough */ }
      }
      throw new Error(`cannot coerce value to object`);
    }
    case 'list': {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as JsonValue;
          if (Array.isArray(parsed)) return parsed;
        } catch { /* fallthrough */ }
      }
      throw new Error(`cannot coerce value to list`);
    }
  }
}

/**
 * Extract the first JSON value from LLM text (handles markdown fences and
 * surrounding prose).
 */
export function extractJson(text: string): JsonValue {
  const trimmed = text.trim();
  // fenced block first
  const fence = /```(?:json)?\s*([^]*?)```/.exec(trimmed);
  const candidates = [fence ? fence[1].trim() : null, trimmed].filter(
    (s): s is string => !!s,
  );
  for (const cand of candidates) {
    try {
      return JSON.parse(cand) as JsonValue;
    } catch { /* try next strategy */ }
    // scan for the first balanced {...} or [...], trying each opening bracket
    for (let start = cand.search(/[{[]/); start >= 0; ) {
      const open = cand[start];
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      let inStr = false;
      let esc = false;
      let parsedHere = false;
      for (let i = start; i < cand.length; i++) {
        const ch = cand[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close) {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(cand.slice(start, i + 1)) as JsonValue;
            } catch {
              parsedHere = true; // balanced but invalid — move to next bracket
            }
            break;
          }
        }
      }
      void parsedHere;
      const next = cand.slice(start + 1).search(/[{[]/);
      start = next === -1 ? -1 : start + 1 + next;
    }
  }
  throw new Error('no valid JSON found in model output');
}
