import type { JsonValue } from '../domain/types.ts';

const HIDDEN_REASONING_KEY = /^(reasoning|thinking|chain[_-]?of[_-]?thought|internal[_-]?(reasoning|thoughts?))$/i;
const MAX_STRING = 4000;
const MAX_ARRAY = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 8;

function normalizedKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function isSecretKey(key: string): boolean {
  const normalized = normalizedKey(key);
  // Attachment payloads are user-controlled content (and can contain secrets).
  // Keep attachment metadata observable, but never persist the encoded bytes.
  if (/^(content|data|file|attachment)_base64$/.test(normalized)
    || /^(content|data|file|attachment)base64$/i.test(key)) return true;
  if (/^(authorization|api_key|secret|password|passphrase|cookie|private_key|credential)$/.test(normalized)) return true;
  // Token usage/configuration counters are observability data, not credentials.
  if (/^(input|output|max|reasoning|cached|embedding_input)_tokens?$/.test(normalized)) return false;
  return /^(access|refresh|session|client|api|auth|bearer|id)_(token|secret|cookie|credential)$/.test(normalized)
    || /_(token|secret|api_key|private_key|password|passphrase|cookie|credential)$/.test(normalized);
}

function structuralKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Describe trace data without retaining its values. This is used for resolved
 * node inputs and configuration, which commonly contain prompts, tool
 * arguments, retrieved documents, and interpolated secrets.
 */
export function summarizeTraceStructure(value: unknown, depth = 0): JsonValue {
  const kind = structuralKind(value);
  if (depth >= MAX_DEPTH) return { type: kind, truncated: true };
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return { type: kind };
  }
  if (typeof value === 'string') {
    return { type: 'string', length: value.length };
  }
  if (Array.isArray(value)) {
    const itemTypes = [...new Set(value.map(structuralKind))].sort();
    return {
      type: 'array',
      length: value.length,
      itemTypes,
      ...(value.length > 0 ? { sampleStructure: summarizeTraceStructure(value[0], depth + 1) } : {}),
    };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const fields: Record<string, JsonValue> = {};
    for (const [key, child] of entries.slice(0, MAX_OBJECT_KEYS)) {
      fields[key] = isSecretKey(key)
        ? { type: structuralKind(child), redacted: true }
        : summarizeTraceStructure(child, depth + 1);
    }
    return {
      type: 'object',
      fieldCount: entries.length,
      fields,
      ...(entries.length > MAX_OBJECT_KEYS ? { truncatedFieldCount: entries.length - MAX_OBJECT_KEYS } : {}),
    };
  }
  return { type: kind };
}

/** Produce a bounded, JSON-safe trace snapshot without credential-bearing values. */
export function sanitizeTraceValue(value: unknown, key = '', depth = 0): JsonValue {
  if (isSecretKey(key)) return '[REDACTED]';
  if (HIDDEN_REASONING_KEY.test(key)) return '[REDACTED: hidden reasoning]';
  if (depth >= MAX_DEPTH) return '[TRUNCATED: max depth]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length <= MAX_STRING ? value : `${value.slice(0, MAX_STRING)}\n[TRUNCATED: ${value.length - MAX_STRING} characters]`;
  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_ARRAY).map((item) => sanitizeTraceValue(item, '', depth + 1));
    if (value.length > MAX_ARRAY) result.push(`[TRUNCATED: ${value.length - MAX_ARRAY} items]`);
    return result;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, JsonValue> = {};
    const redactChildren = key.toLowerCase() === 'headers';
    const redactPromptCacheKey = /^prompt[_-]?cache$/i.test(key);
    for (const [childKey, childValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
      result[childKey] = redactChildren || (redactPromptCacheKey && childKey === 'key') ? '[REDACTED]' : sanitizeTraceValue(childValue, childKey, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) result.__truncated__ = `${entries.length - MAX_OBJECT_KEYS} keys omitted`;
    return result;
  }
  return String(value);
}
