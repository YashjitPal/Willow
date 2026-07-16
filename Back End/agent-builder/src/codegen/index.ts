/**
 * Code export for standalone Agents-SDK-style workflow runners.
 *
 * The generated programs keep the graph interpreter local and expose hooks
 * for the parts that must stay application-specific (approvals, retrieval,
 * guardrails, and MCP). This makes exports executable instead of emitting
 * placeholder branches or silently returning empty tool results.
 */

import type {
  AgentNodeConfig,
  EndNodeConfig,
  IfElseNodeConfig,
  SetStateNodeConfig,
  StartNodeConfig,
  TransformNodeConfig,
  UserApprovalNodeConfig,
  WhileNodeConfig,
  WorkflowGraph,
} from '../domain/types.ts';
import { normalizeGraph, toVarName } from '../domain/normalize.ts';

function jsStr(s: string): string {
  return JSON.stringify(s ?? '');
}

function pyStr(s: string): string {
  const escaped = (s ?? '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  return `"""${escaped}"""`;
}

function edgeTarget(graph: WorkflowGraph, nodeId: string, handle: string | null): string | null {
  const edge = graph.edges.find(
    (candidate) => candidate.source === nodeId && (candidate.sourceHandle ?? null) === handle,
  );
  return edge?.target ?? null;
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function configLiteral(config: unknown): string {
  return JSON.stringify(config);
}

function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${JSON.stringify(key)}: ${pyLiteral(item)}`)
      .join(', ')}}`;
  }
  return 'None';
}

function tsHelpers(lines: string[]): void {
  lines.push(`type AnyRecord = Record<string, any>;`);
  lines.push(`type WorkflowHooks = {`);
  lines.push(`  approve?: (message: string) => boolean | Promise<boolean>;`);
  lines.push(`  guardrail?: (input: string, config: AnyRecord) => boolean | Promise<boolean>;`);
  lines.push(`  fileSearch?: (query: string, vectorStoreIds: string[], config: AnyRecord) => unknown | Promise<unknown>;`);
  lines.push(`  mcp?: (serverId: string, tool: string, args: AnyRecord) => unknown | Promise<unknown>;`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`function size(value: any): number {`);
  lines.push(`  return typeof value === 'string' || Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;`);
  lines.push(`}`);
  lines.push(`function has(value: any, key: string): boolean {`);
  lines.push(`  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);`);
  lines.push(`}`);
  lines.push(`function matches(value: any, pattern: string): boolean {`);
  lines.push(`  return new RegExp(pattern).test(String(value ?? ''));`);
  lines.push(`}`);
  lines.push(`function evaluateExpression(expression: string, scope: AnyRecord): any {`);
  lines.push(`  const names = Object.keys(scope).filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));`);
  lines.push(`  const values = names.map((name) => scope[name]);`);
  lines.push(`  const translated = expression`);
  lines.push(`    .replace(/\\btrue\\b/gi, 'true').replace(/\\bfalse\\b/gi, 'false').replace(/\\bnull\\b/gi, 'null')`);
  lines.push(`    .replace(/\\.contains\\(/g, '.includes(');`);
  lines.push(`  try {`);
  lines.push(`    return Function(...names, 'size', 'has', 'matches', '"use strict"; return (' + translated + ');')(...values, size, has, matches);`);
  lines.push(`  } catch (error) {`);
  lines.push(`    throw new Error("CEL expression failed: " + expression + " (" + (error as Error).message + ")");`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(`function resolveValue(value: any, scope: AnyRecord): any {`);
  lines.push(`  if (typeof value === 'string') {`);
  lines.push(`    if (value.startsWith('$cel:')) return evaluateExpression(value.slice(5).trim(), scope);`);
  lines.push(`    const exact = value.match(/^\\{\\{([\\s\\S]*)\\}\\}$/);`);
  lines.push(`    if (exact) return evaluateExpression(exact[1].trim(), scope);`);
  lines.push(`    return value.replace(/\\{\\{([\\s\\S]*?)\\}\\}/g, (_match, expression) => String(resolveValue('$cel:' + expression, scope) ?? ''));`);
  lines.push(`  }`);
  lines.push(`  if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope));`);
  lines.push(`  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, scope)]));`);
  lines.push(`  return value;`);
  lines.push(`}`);
  lines.push(``);
}

export function exportTypeScript(name: string, rawGraph: WorkflowGraph): string {
  const { graph, varNames } = normalizeGraph(rawGraph);
  const agents = graph.nodes.filter((node) => node.type === 'agent');
  const start = graph.nodes.find((node) => node.type === 'start');
  const startCfg = (start?.config ?? {}) as unknown as StartNodeConfig;
  const lines: string[] = [];

  lines.push(`// ${name} — exported from Willow Agent Builder`);
  lines.push(`// Requires: npm install @openai/agents zod`);
  lines.push(`import { Agent, run } from '@openai/agents';`);
  lines.push(``);
  tsHelpers(lines);

  for (const agent of agents) {
    const cfg = agent.config as unknown as AgentNodeConfig;
    const variable = varNames.get(agent.id) ?? toVarName(agent.name);
    lines.push(`const ${variable} = new Agent({`);
    lines.push(`  name: ${jsStr(agent.name)},`);
    lines.push(`  model: ${jsStr(cfg.model)},`);
    lines.push(`  instructions: ${jsStr(cfg.instructions ?? '')},`);
    if (cfg.reasoningEffort) lines.push(`  // reasoning effort: ${jsStr(cfg.reasoningEffort)}`);
    if (cfg.verbosity) lines.push(`  // verbosity: ${jsStr(cfg.verbosity)}`);
    if (cfg.tools?.length) {
      lines.push(`  // Agent Builder tools: ${cfg.tools.map((tool) => tool.kind).join(', ')}`);
    }
    lines.push(`});`);
    lines.push(``);
  }

  lines.push(`export async function runWorkflow(inputAsText: string, variables: AnyRecord = {}, hooks: WorkflowHooks = {}): Promise<unknown> {`);
  lines.push(`  const workflow = { input_as_text: inputAsText, ...variables };`);
  lines.push(`  const state: AnyRecord = ${jsonLiteral(Object.fromEntries((startCfg.stateVariables ?? []).map((decl) => [decl.name, decl.initialValue ?? null])))};`);
  lines.push(`  const outputs: AnyRecord = {};`);
  lines.push(`  const whileCounts: AnyRecord = {};`);
  lines.push(`  const scope = () => ({ workflow, state, ...outputs });`);
  lines.push(`  let current: string | null = ${jsonLiteral(start?.id ?? null)};`);
  lines.push(`  let finalOutput: unknown = null;`);
  lines.push(`  let guard = 0;`);
  lines.push(`  while (current) {`);
  lines.push(`    if (++guard > 10000) throw new Error('step limit exceeded');`);
  lines.push(`    switch (current) {`);

  for (const node of graph.nodes) {
    if (node.type === 'note') continue;
    const variable = varNames.get(node.id) ?? node.id;
    lines.push(`      case ${jsonLiteral(node.id)}: { // ${node.type}: ${node.name}`);
    switch (node.type) {
      case 'start':
        lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, null))};`);
        break;
      case 'agent': {
        const cfg = node.config as unknown as AgentNodeConfig;
        lines.push(`        const ${variable}_prompt = ${cfg.userMessage ? `String(resolveValue(${jsStr(cfg.userMessage)}, scope()) ?? '')` : 'inputAsText'};`);
        lines.push(`        const ${variable}_result = await run(${variable}, ${variable}_prompt);`);
        lines.push(`        outputs[${jsonLiteral(variable)}] = { output_text: ${variable}_result.finalOutput };`);
        lines.push(`        finalOutput = ${variable}_result.finalOutput;`);
        lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, null))};`);
        break;
      }
      case 'ifElse': {
        const cfg = node.config as unknown as IfElseNodeConfig;
        const branches = cfg.branches ?? [];
        if (!branches.length) {
          lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, 'else'))};`);
        } else {
          branches.forEach((branch, index) => {
            lines.push(`        ${index === 0 ? 'if' : 'else if'} (Boolean(evaluateExpression(${jsStr(branch.condition)}, scope()))) {`);
            lines.push(`          current = ${jsonLiteral(edgeTarget(graph, node.id, branch.id))};`);
            lines.push(`        }`);
          });
          lines.push(`        else { current = ${jsonLiteral(edgeTarget(graph, node.id, 'else'))}; }`);
        }
        break;
      }
      case 'while': {
        const cfg = node.config as unknown as WhileNodeConfig;
        lines.push(`        whileCounts[${jsonLiteral(node.id)}] = (whileCounts[${jsonLiteral(node.id)}] ?? 0) + 1;`);
        lines.push(`        if (whileCounts[${jsonLiteral(node.id)}] > ${cfg.maxIterations ?? 100}) {`);
        if (cfg.onMaxIterations === 'break') {
          lines.push(`          current = ${jsonLiteral(edgeTarget(graph, node.id, 'done'))};`);
        } else {
          lines.push(`          throw new Error(${jsStr(`While '${node.name}' exceeded maxIterations`)});`);
        }
        lines.push(`        } else if (Boolean(evaluateExpression(${jsStr(cfg.condition)}, scope()))) {`);
        lines.push(`          current = ${jsonLiteral(edgeTarget(graph, node.id, 'loop'))};`);
        lines.push(`        } else {`);
        lines.push(`          current = ${jsonLiteral(edgeTarget(graph, node.id, 'done'))};`);
        lines.push(`        }`);
        break;
      }
      case 'transform': {
        const cfg = node.config as unknown as TransformNodeConfig;
        lines.push(`        outputs[${jsonLiteral(variable)}] = {};`);
        for (const output of cfg.outputs ?? []) {
          lines.push(`        outputs[${jsonLiteral(variable)}][${jsonLiteral(output.name)}] = evaluateExpression(${jsStr(output.expression)}, scope());`);
        }
        lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, null))};`);
        break;
      }
      case 'setState': {
        const cfg = node.config as unknown as SetStateNodeConfig;
        for (const assignment of cfg.assignments ?? []) {
          lines.push(`        state[${jsonLiteral(assignment.name)}] = evaluateExpression(${jsStr(assignment.expression)}, scope());`);
        }
        lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, null))};`);
        break;
      }
      case 'userApproval': {
        const cfg = node.config as unknown as UserApprovalNodeConfig;
        lines.push(`        const approved = hooks.approve ? await hooks.approve(String(resolveValue(${jsStr(cfg.message)}, scope()) ?? '')) : false;`);
        lines.push(`        current = approved ? ${jsonLiteral(edgeTarget(graph, node.id, 'approved'))} : ${jsonLiteral(edgeTarget(graph, node.id, 'rejected'))};`);
        break;
      }
      case 'guardrail': {
        const config = node.config as Record<string, unknown>;
        lines.push(`        const guardrailInput = String(resolveValue(${jsStr(String(config.input ?? '{{workflow.input_as_text}}'))}, scope()) ?? '');`);
        lines.push(`        const passed = hooks.guardrail ? await hooks.guardrail(guardrailInput, ${configLiteral(config)}) : true;`);
        lines.push(`        current = passed ? ${jsonLiteral(edgeTarget(graph, node.id, 'pass'))} : ${jsonLiteral(edgeTarget(graph, node.id, 'fail'))};`);
        break;
      }
      case 'fileSearch': {
        const config = node.config as Record<string, unknown>;
        lines.push(`        const searchQuery = String(resolveValue(${jsStr(String(config.query ?? ''))}, scope()) ?? '');`);
        lines.push(`        const searchResult = hooks.fileSearch ? await hooks.fileSearch(searchQuery, ${jsonLiteral(config.vectorStoreIds ?? [])}, ${configLiteral(config)}) : [];`);
        lines.push(`        outputs[${jsonLiteral(variable)}] = { results: searchResult, output_text: JSON.stringify(searchResult), query: searchQuery };`);
        lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, null))};`);
        break;
      }
      case 'mcp': {
        const config = node.config as Record<string, unknown>;
        lines.push(`        const mcpResult = hooks.mcp ? await hooks.mcp(${jsStr(String(config.serverId ?? ''))}, ${jsStr(String(config.tool ?? ''))}, resolveValue(${configLiteral(config.arguments ?? {})}, scope())) : null;`);
        lines.push(`        outputs[${jsonLiteral(variable)}] = { result: mcpResult, output_text: JSON.stringify(mcpResult) };`);
        lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, null))};`);
        break;
      }
      case 'end': {
        const cfg = node.config as unknown as EndNodeConfig;
        if (cfg.output) {
          lines.push(`        finalOutput = resolveValue(${jsStr(cfg.output)}, scope());`);
        }
        lines.push(`        current = null;`);
        break;
      }
      default:
        lines.push(`        current = ${jsonLiteral(edgeTarget(graph, node.id, null))};`);
    }
    lines.push(`        break;`);
    lines.push(`      }`);
  }

  lines.push(`      default: current = null;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  return finalOutput;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`// Example: await runWorkflow('Hello!');`);
  return lines.join('\n');
}

function pyHelpers(lines: string[]): void {
  lines.push(`class DotDict(dict):`);
  lines.push(`    __getattr__ = dict.get`);
  lines.push(``);
  lines.push(`def _wrap(value):`);
  lines.push(`    if isinstance(value, dict): return DotDict({key: _wrap(item) for key, item in value.items()})`);
  lines.push(`    if isinstance(value, list): return [_wrap(item) for item in value]`);
  lines.push(`    return value`);
  lines.push(``);
  lines.push(`def _size(value):`);
  lines.push(`    return len(value) if isinstance(value, (str, list, dict)) else 0`);
  lines.push(``);
  lines.push(`def _has(value, key):`);
  lines.push(`    return isinstance(value, dict) and key in value`);
  lines.push(``);
  lines.push(`def _matches(value, pattern):`);
  lines.push(`    return re.search(pattern, str(value or "")) is not None`);
  lines.push(``);
  lines.push(`async def _call(hook, *args):`);
  lines.push(`    result = hook(*args)`);
  lines.push(`    return await result if inspect.isawaitable(result) else result`);
  lines.push(``);
  lines.push(`def _eval(expression, scope):`);
  lines.push(`    translated = expression.replace("&&", " and ").replace("||", " or ")`);
  lines.push(`    translated = re.sub(r"\\btrue\\b", "True", translated, flags=re.IGNORECASE)`);
  lines.push(`    translated = re.sub(r"\\bfalse\\b", "False", translated, flags=re.IGNORECASE)`);
  lines.push(`    translated = re.sub(r"\\bnull\\b", "None", translated, flags=re.IGNORECASE)`);
  lines.push(`    translated = re.sub(r"(?<![=!])!(?!=)", " not ", translated)`);
  lines.push(`    translated = translated.replace(".contains(", ".__contains__(")`);
  lines.push(`    try: return eval(translated, {"__builtins__": {}, "size": _size, "has": _has, "matches": _matches}, {key: _wrap(value) for key, value in scope.items()})`);
  lines.push(`    except Exception as error: raise RuntimeError(f"CEL expression failed: {expression} ({error})") from error`);
  lines.push(``);
  lines.push(`def _resolve(value, scope):`);
  lines.push(`    if isinstance(value, str):`);
  lines.push(`        if value.startswith("$cel:"): return _eval(value[5:].strip(), scope)`);
  lines.push(`        if value.startswith("{{") and value.endswith("}}"): return _eval(value[2:-2].strip(), scope)`);
  lines.push(`        import re`);
  lines.push(`        return re.sub(r"\\{\\{([\\s\\S]*?)\\}\\}", lambda match: str(_resolve("$cel:" + match.group(1), scope) or ""), value)`);
  lines.push(`    if isinstance(value, list): return [_resolve(item, scope) for item in value]`);
  lines.push(`    if isinstance(value, dict): return {key: _resolve(item, scope) for key, item in value.items()}`);
  lines.push(`    return value`);
  lines.push(``);
}

export function exportPython(name: string, rawGraph: WorkflowGraph): string {
  const { graph, varNames } = normalizeGraph(rawGraph);
  const agents = graph.nodes.filter((node) => node.type === 'agent');
  const start = graph.nodes.find((node) => node.type === 'start');
  const startCfg = (start?.config ?? {}) as unknown as StartNodeConfig;
  const lines: string[] = [];

  lines.push(`# ${name} — exported from Willow Agent Builder`);
  lines.push(`# Requires: pip install openai-agents`);
  lines.push(`import asyncio`);
  lines.push(`import inspect`);
  lines.push(`import re`);
  lines.push(`from agents import Agent, Runner`);
  lines.push(``);
  pyHelpers(lines);

  for (const agent of agents) {
    const cfg = agent.config as unknown as AgentNodeConfig;
    const variable = varNames.get(agent.id) ?? toVarName(agent.name);
    lines.push(`${variable} = Agent(`);
    lines.push(`    name=${JSON.stringify(agent.name)},`);
    lines.push(`    model=${JSON.stringify(cfg.model)},`);
    lines.push(`    instructions=${pyStr(cfg.instructions ?? '')},`);
    if (cfg.tools?.length) lines.push(`    # Agent Builder tools: ${cfg.tools.map((tool) => tool.kind).join(', ')}`);
    lines.push(`)`);
    lines.push(``);
  }

  lines.push(`async def run_workflow(input_as_text: str, variables=None, hooks=None):`);
  lines.push(`    variables = variables or {}`);
  lines.push(`    hooks = hooks or {}`);
  lines.push(`    workflow = {"input_as_text": input_as_text, **variables}`);
  lines.push(`    state = ${pyLiteral(Object.fromEntries((startCfg.stateVariables ?? []).map((decl) => [decl.name, decl.initialValue ?? null])))} `);
  lines.push(`    outputs = {}`);
  lines.push(`    while_counts = {}`);
  lines.push(`    def scope(): return {"workflow": workflow, "state": state, **outputs}`);
  lines.push(`    current = ${jsonLiteral(start?.id ?? null)}`);
  lines.push(`    final_output = None`);
  lines.push(`    guard = 0`);
  lines.push(`    while current is not None:`);
  lines.push(`        guard += 1`);
  lines.push(`        if guard > 10000: raise RuntimeError("step limit exceeded")`);

  let first = true;
  for (const node of graph.nodes) {
    if (node.type === 'note') continue;
    const variable = varNames.get(node.id) ?? node.id;
    const kw = first ? 'if' : 'elif';
    first = false;
    const nxt = (handle: string | null) => pyLiteral(edgeTarget(graph, node.id, handle));
    lines.push(`        ${kw} current == ${jsonLiteral(node.id)}:  # ${node.type}: ${node.name}`);
    switch (node.type) {
      case 'start':
        lines.push(`            current = ${nxt(null)}`);
        break;
      case 'agent': {
        const cfg = node.config as unknown as AgentNodeConfig;
        lines.push(`            prompt = str(_resolve(${jsStr(cfg.userMessage ?? '')}, scope())) if ${cfg.userMessage ? 'True' : 'False'} else input_as_text`);
        lines.push(`            result = await Runner.run(${variable}, prompt)`);
        lines.push(`            outputs[${jsonLiteral(variable)}] = {"output_text": result.final_output}`);
        lines.push(`            final_output = result.final_output`);
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'ifElse': {
        const cfg = node.config as unknown as IfElseNodeConfig;
        const branches = cfg.branches ?? [];
        branches.forEach((branch, index) => {
          lines.push(`            ${index === 0 ? 'if' : 'elif'} bool(_eval(${jsonLiteral(branch.condition)}, scope())):`);
          lines.push(`                current = ${nxt(branch.id)}`);
        });
        lines.push(`            else: current = ${nxt('else')}`);
        break;
      }
      case 'while': {
        const cfg = node.config as unknown as WhileNodeConfig;
        lines.push(`            while_counts[${jsonLiteral(node.id)}] = while_counts.get(${jsonLiteral(node.id)}, 0) + 1`);
        lines.push(`            if while_counts[${jsonLiteral(node.id)}] > ${cfg.maxIterations ?? 100}:`);
        if (cfg.onMaxIterations === 'break') lines.push(`                current = ${nxt('done')}`);
        else lines.push(`                raise RuntimeError(${jsonLiteral(`While '${node.name}' exceeded maxIterations`)})`);
        lines.push(`            elif bool(_eval(${jsonLiteral(cfg.condition)}, scope())): current = ${nxt('loop')}`);
        lines.push(`            else: current = ${nxt('done')}`);
        break;
      }
      case 'transform': {
        const cfg = node.config as unknown as TransformNodeConfig;
        lines.push(`            outputs[${jsonLiteral(variable)}] = {}`);
        for (const output of cfg.outputs ?? []) {
          lines.push(`            outputs[${jsonLiteral(variable)}][${jsonLiteral(output.name)}] = _eval(${jsonLiteral(output.expression)}, scope())`);
        }
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'setState': {
        const cfg = node.config as unknown as SetStateNodeConfig;
        for (const assignment of cfg.assignments ?? []) {
          lines.push(`            state[${jsonLiteral(assignment.name)}] = _eval(${jsonLiteral(assignment.expression)}, scope())`);
        }
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'userApproval': {
        const cfg = node.config as unknown as UserApprovalNodeConfig;
        lines.push(`            approved = bool(await _call(hooks["approve"], _resolve(${jsonLiteral(cfg.message)}, scope()))) if hooks.get("approve") else False`);
        lines.push(`            current = ${nxt('approved')} if approved else ${nxt('rejected')}`);
        break;
      }
      case 'guardrail': {
        const config = node.config as Record<string, unknown>;
        lines.push(`            guard_input = str(_resolve(${jsonLiteral(String(config.input ?? '{{workflow.input_as_text}}'))}, scope()))`);
        lines.push(`            passed = bool(await _call(hooks["guardrail"], guard_input, ${pyLiteral(config)})) if hooks.get("guardrail") else True`);
        lines.push(`            current = ${nxt('pass')} if passed else ${nxt('fail')}`);
        break;
      }
      case 'fileSearch': {
        const config = node.config as Record<string, unknown>;
        lines.push(`            query = str(_resolve(${jsonLiteral(String(config.query ?? ''))}, scope()))`);
        lines.push(`            result = await _call(hooks["file_search"], query, ${pyLiteral(config.vectorStoreIds ?? [])}, ${pyLiteral(config)}) if hooks.get("file_search") else []`);
        lines.push(`            outputs[${jsonLiteral(variable)}] = {"results": result, "output_text": str(result), "query": query}`);
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'mcp': {
        const config = node.config as Record<string, unknown>;
        lines.push(`            result = await _call(hooks["mcp"], ${jsonLiteral(String(config.serverId ?? ''))}, ${jsonLiteral(String(config.tool ?? ''))}, _resolve(${pyLiteral(config.arguments ?? {})}, scope())) if hooks.get("mcp") else None`);
        lines.push(`            outputs[${jsonLiteral(variable)}] = {"result": result, "output_text": str(result)}`);
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'end': {
        const cfg = node.config as unknown as EndNodeConfig;
        if (cfg.output) lines.push(`            final_output = _resolve(${jsonLiteral(cfg.output)}, scope())`);
        lines.push(`            current = None`);
        break;
      }
      default:
        lines.push(`            current = ${nxt(null)}`);
    }
  }
  lines.push(`        else: current = None`);
  lines.push(`    return final_output`);
  lines.push(``);
  lines.push(`if __name__ == "__main__":`);
  lines.push(`    print(asyncio.run(run_workflow("Hello!")))`);
  return lines.join('\n');
}
