export interface JsonSchemaDefinitionIssue {
  path: string;
  message: string;
}

type SchemaRecord = Record<string, unknown>;

const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function isSchemaRecord(value: unknown): value is SchemaRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Keep frontend schema authoring aligned with the backend's supported strict subset. */
export function validateJsonSchemaDefinition(
  schema: unknown,
  path = '$',
  depth = 0,
): JsonSchemaDefinitionIssue[] {
  const issues: JsonSchemaDefinitionIssue[] = [];
  if (depth > 12) return [{ path, message: 'schema nesting exceeds 12 levels' }];
  if (!isSchemaRecord(schema)) return [{ path, message: 'schema must be an object' }];

  const type = schema.type;
  const types = typeof type === 'string' ? [type] : Array.isArray(type) ? type : [];
  const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : [];
  if (types.length === 0 && alternatives.length === 0) {
    issues.push({ path: `${path}.type`, message: 'type or anyOf is required' });
  }
  for (const candidate of types) {
    if (typeof candidate !== 'string' || !SCHEMA_TYPES.has(candidate)) {
      issues.push({ path: `${path}.type`, message: `unsupported type '${String(candidate)}'` });
    }
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    issues.push({ path: `${path}.enum`, message: 'enum must be a non-empty array' });
  }

  alternatives.forEach((alternative, index) => {
    if (!isSchemaRecord(alternative)) {
      issues.push({ path: `${path}.anyOf[${index}]`, message: 'anyOf entries must be schema objects' });
    } else {
      issues.push(...validateJsonSchemaDefinition(alternative, `${path}.anyOf[${index}]`, depth + 1));
    }
  });

  if (types.includes('object')) {
    if (!isSchemaRecord(schema.properties)) {
      issues.push({ path: `${path}.properties`, message: 'object schemas need a properties object' });
    } else {
      for (const [name, child] of Object.entries(schema.properties)) {
        if (!name.trim()) issues.push({ path: `${path}.properties`, message: 'property names cannot be empty' });
        if (!isSchemaRecord(child)) {
          issues.push({ path: `${path}.properties.${name}`, message: 'property schema must be an object' });
        } else {
          issues.push(...validateJsonSchemaDefinition(child, `${path}.properties.${name}`, depth + 1));
        }
      }
      if (schema.required !== undefined) {
        if (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== 'string')) {
          issues.push({ path: `${path}.required`, message: 'required must be an array of property names' });
        } else {
          for (const name of schema.required) {
            if (!(name in schema.properties)) {
              issues.push({ path: `${path}.required`, message: `unknown required property '${String(name)}'` });
            }
          }
        }
      }
      const requiredNames = Array.isArray(schema.required)
        ? new Set(schema.required.filter((name): name is string => typeof name === 'string'))
        : new Set<string>();
      for (const name of Object.keys(schema.properties)) {
        if (!requiredNames.has(name)) {
          issues.push({ path: `${path}.required`, message: `strict schemas must require property '${name}'` });
        }
      }
      if (schema.additionalProperties !== false) {
        issues.push({ path: `${path}.additionalProperties`, message: 'strict object schemas must set additionalProperties to false' });
      }
    }
  }

  if (types.includes('array')) {
    if (!isSchemaRecord(schema.items)) {
      issues.push({ path: `${path}.items`, message: 'array schemas need an items schema' });
    } else {
      issues.push(...validateJsonSchemaDefinition(schema.items, `${path}.items`, depth + 1));
    }
  }

  for (const [minimum, maximum] of [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems']] as const) {
    const min = schema[minimum];
    const max = schema[maximum];
    if (min !== undefined && (typeof min !== 'number' || min < 0)) {
      issues.push({ path: `${path}.${minimum}`, message: `${minimum} must be a non-negative number` });
    }
    if (max !== undefined && (typeof max !== 'number' || max < 0)) {
      issues.push({ path: `${path}.${maximum}`, message: `${maximum} must be a non-negative number` });
    }
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      issues.push({ path, message: `${minimum} cannot exceed ${maximum}` });
    }
  }

  return issues;
}

export function formatJsonSchemaIssues(issues: JsonSchemaDefinitionIssue[], limit = 8): string {
  const visible = issues.slice(0, limit).map((issue) => `${issue.path}: ${issue.message}`);
  if (issues.length > limit) visible.push(`...and ${issues.length - limit} more issue${issues.length - limit === 1 ? '' : 's'}`);
  return visible.join('\n');
}
