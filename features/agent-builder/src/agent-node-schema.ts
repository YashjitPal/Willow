/**
 * Model metadata and output-schema authoring types for the Agent node's config
 * panel: the shape the model picker renders, the node's error-handling policy,
 * and the builder that turns the panel's Simple/Advanced schema editor into a
 * validated JSON Schema.
 *
 * Everything here is closure-free and safe to call outside React.
 */

import { type ModelInfo } from './agent-builder';
import { formatJsonSchemaIssues, validateJsonSchemaDefinition } from '@willow/core/json-schema';

/** A model as the Agent panel's picker needs it, flattened from `ModelInfo`. */
export interface APIModel {
  name: string;
  displayName: string;
  description: string;
  provider: string;
  inputModalities: ModelInfo['inputModalities'];
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  limitsSource: ModelInfo['limitsSource'];
  limitsCatalogVersion?: string;
}

/** Trims vendor prefixes and release qualifiers for display. */
export const formatModelName = (displayName: string) => {
  return displayName.replace(/^Gemini\s+/, '').replace(/\s+Preview$|\s+Experimental$/, '');
};

export type AgentErrorPolicy = 'fail' | 'continue' | 'branch';

/**
 * Reads a node's error policy, falling back to the legacy `continueOnError`
 * boolean so workflows saved before `onError` existed still load correctly.
 */
export const getAgentErrorPolicy = (cfg?: Record<string, any>): AgentErrorPolicy => (
  cfg?.onError === 'branch' || cfg?.onError === 'continue'
    ? cfg.onError
    : cfg?.continueOnError === true
      ? 'continue'
      : 'fail'
);

/** One row of the Simple-mode output-schema editor. */
export interface JsonSchemaPropertyDraft {
  id: number;
  name: string;
  type: string;
  description: string;
  nullable: boolean;
  enumValues: string;
  arrayItemType: string;
}

/**
 * Builds the Agent node's output schema from either the raw JSON of Advanced
 * mode or the property rows of Simple mode, returning the first validation
 * error instead of throwing so the panel can render it inline.
 */
export function buildAgentJsonSchemaDraft(
  mode: 'Simple' | 'Advanced',
  raw: string,
  propertyDrafts: JsonSchemaPropertyDraft[],
): { schema?: Record<string, unknown>; error?: string } {
  let schema: Record<string, unknown>;
  if (mode === 'Advanced') {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: '$: schema must be an object' };
      }
      schema = parsed as Record<string, unknown>;
    } catch (error) {
      return { error: `Invalid JSON: ${(error as Error).message}` };
    }
  } else {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const typeMap: Record<string, string> = {
      String: 'string',
      Number: 'number',
      Boolean: 'boolean',
      Object: 'object',
      Array: 'array',
    };
    for (const property of propertyDrafts) {
      const name = property.name.trim();
      if (!name) continue;
      if (properties[name]) return { error: `$.properties: property name '${name}' is duplicated` };
      const propertyType = typeMap[property.type] ?? 'string';
      const propertySchema: Record<string, unknown> = {
        type: property.nullable ? [propertyType, 'null'] : propertyType,
        ...(property.description.trim() ? { description: property.description.trim() } : {}),
      };
      if (property.type === 'Array') {
        const itemType = typeMap[property.arrayItemType] ?? 'string';
        propertySchema.items = itemType === 'object'
          ? { type: 'object', properties: {}, required: [], additionalProperties: false }
          : { type: itemType };
      }
      if (property.type === 'Object') {
        Object.assign(propertySchema, { properties: {}, required: [], additionalProperties: false });
      }
      if (property.enumValues.trim() && ['String', 'Number'].includes(property.type)) {
        const values = property.enumValues.split(',').map((value) => value.trim()).filter(Boolean);
        const parsedValues = property.type === 'Number' ? values.map(Number) : values;
        if (parsedValues.length === 0 || parsedValues.some((value) => typeof value === 'number' && !Number.isFinite(value))) {
          return { error: `$.properties.${name}.enum: enum contains an invalid value` };
        }
        propertySchema.enum = property.nullable ? [...parsedValues, null] : parsedValues;
      }
      properties[name] = propertySchema;
      required.push(name);
    }
    if (required.length === 0) return { error: '$.properties: add at least one named property' };
    schema = { type: 'object', properties, required, additionalProperties: false };
  }

  if (schema.type !== 'object') return { error: '$.type: Agent output schema root type must be object' };
  const issues = validateJsonSchemaDefinition(schema);
  return issues.length > 0 ? { error: formatJsonSchemaIssues(issues) } : { schema };
}
