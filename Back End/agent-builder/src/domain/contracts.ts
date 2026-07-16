/**
 * Data contracts exposed by each workflow node.
 *
 * Agent Builder treats connections as typed edges: a downstream node should
 * be able to see the fields emitted by the node before it. The runtime still
 * accepts dynamic CEL values, so contracts are intentionally descriptive
 * rather than an additional execution-time type system.
 */

import type { WorkflowGraph, WorkflowNode } from './types.ts';

export type ContractType = 'string' | 'number' | 'boolean' | 'object' | 'list' | 'unknown';

export interface ContractField {
  name: string;
  type: ContractType;
  required?: boolean;
  description?: string;
}

export interface NodeDataContract {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  inputs: ContractField[];
  outputs: ContractField[];
}

function schemaType(value: unknown): ContractType {
  if (!value || typeof value !== 'object') return 'unknown';
  const type = (value as { type?: unknown }).type;
  if (type === 'string' || type === 'number' || type === 'integer') return type === 'integer' ? 'number' : type;
  if (type === 'boolean') return 'boolean';
  if (type === 'array') return 'list';
  if (type === 'object') return 'object';
  return 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function schemaFields(schema: unknown): ContractField[] {
  if (!schema || typeof schema !== 'object') return [];
  const obj = schema as { properties?: Record<string, unknown>; required?: unknown };
  const required = new Set(Array.isArray(obj.required) ? obj.required.filter((v): v is string => typeof v === 'string') : []);
  return Object.entries(obj.properties ?? {}).map(([name, value]) => ({
    name,
    type: schemaType(value),
    required: required.has(name),
  }));
}

function fieldsFromState(node: WorkflowNode): ContractField[] {
  const state: unknown[] = Array.isArray(node.config.stateVariables) ? node.config.stateVariables : [];
  return state.flatMap((value) => {
    if (!isRecord(value) || typeof value.name !== 'string') return [];
    return [{ name: value.name, type: typeof value.type === 'string' ? value.type as ContractType : 'unknown' }];
  });
}

function contractFor(node: WorkflowNode): NodeDataContract {
  const inputs: ContractField[] = [];
  const outputs: ContractField[] = [];

  switch (node.type) {
    case 'start': {
      inputs.push({ name: 'input_as_text', type: 'string', required: true });
      const declared: unknown[] = Array.isArray(node.config.inputVariables) ? node.config.inputVariables : [];
      for (const value of declared) {
        if (!isRecord(value)) continue;
        if (typeof value.name === 'string') {
          inputs.push({
            name: value.name,
            type: typeof value.type === 'string' ? value.type as ContractType : 'unknown',
            description: typeof value.description === 'string' ? value.description : undefined,
          });
        }
      }
      outputs.push({ name: 'input_as_text', type: 'string', required: true });
      outputs.push({ name: 'state', type: 'object', required: true });
      for (const field of fieldsFromState(node)) outputs.push(field);
      break;
    }
    case 'agent':
      inputs.push(
        { name: 'instructions', type: 'string', required: true },
        { name: 'userMessage', type: 'string' },
      );
      outputs.push({ name: 'output_text', type: 'string', required: true });
      if (node.config.outputFormat === 'json') {
        const schema = schemaFields(node.config.outputSchema);
        outputs.push({ name: 'output_parsed', type: schema.length ? 'object' : 'unknown', required: true });
        outputs.push(...schema.map((field) => ({ ...field, name: `output_parsed.${field.name}` })));
      }
      break;
    case 'fileSearch':
      inputs.push({ name: 'query', type: 'string', required: true });
      outputs.push(
        { name: 'results', type: 'list', required: true },
        { name: 'output_text', type: 'string', required: true },
        { name: 'query', type: 'string', required: true },
      );
      break;
    case 'guardrail':
      inputs.push({ name: 'input', type: 'string', required: true });
      outputs.push(
        { name: 'passed', type: 'boolean', required: true },
        { name: 'output_text', type: 'string', required: true },
        { name: 'results', type: 'object', required: true },
        { name: 'triggered', type: 'list', required: true },
      );
      break;
    case 'mcp':
      inputs.push({ name: 'arguments', type: 'object', required: true });
      outputs.push(
        { name: 'result', type: 'unknown', required: true },
        { name: 'output_text', type: 'string', required: true },
        { name: 'approved', type: 'boolean' },
      );
      break;
    case 'ifElse':
      outputs.push({ name: 'matched', type: 'string', required: true });
      break;
    case 'while':
      outputs.push({ name: 'iterations', type: 'number', required: true });
      break;
    case 'transform':
      if (Array.isArray(node.config.outputs)) {
        const declared: unknown[] = node.config.outputs;
        for (const value of declared) {
          if (!isRecord(value)) continue;
          if (typeof value.name === 'string') {
            outputs.push({
              name: value.name,
              type: typeof value.type === 'string' ? value.type as ContractType : 'unknown',
              required: true,
            });
          }
        }
      }
      break;
    case 'setState':
      outputs.push({ name: 'updated', type: 'list', required: true });
      break;
    case 'userApproval':
      outputs.push({ name: 'approved', type: 'boolean', required: true });
      break;
    case 'end':
      inputs.push({ name: 'output', type: 'unknown' });
      break;
    case 'note':
      break;
    default:
      break;
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    inputs,
    outputs,
  };
}

export function inferContracts(graph: WorkflowGraph): NodeDataContract[] {
  return graph.nodes.map(contractFor);
}

export function contractsByNode(graph: WorkflowGraph): Record<string, NodeDataContract> {
  return Object.fromEntries(inferContracts(graph).map((contract) => [contract.nodeId, contract]));
}
