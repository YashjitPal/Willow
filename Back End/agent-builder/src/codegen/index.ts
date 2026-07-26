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
  AgentTool,
  EndNodeConfig,
  IfElseNodeConfig,
  SetStateNodeConfig,
  SubflowNodeConfig,
  StartNodeConfig,
  TransformNodeConfig,
  UserApprovalNodeConfig,
  WhileNodeConfig,
  WorkflowGraph,
} from '../domain/types.ts';
import { normalizeGraph, toVarName } from '../domain/normalize.ts';
import { parse as parseCel } from '../engine/cel/index.ts';
import { providerForModel } from '../providers/types.ts';
import { stripEmbeddedHttpCredentials } from '../domain/validate.ts';

const SECRET_REFERENCE = /\{\{\s*secrets\.([A-Z][A-Z0-9_]{0,127})\s*\}\}/g;

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

function whileBodyMap(graph: WorkflowGraph): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const node of graph.nodes) {
    if (node.type !== 'while') continue;
    const body = new Set<string>();
    const queue = graph.edges
      .filter((edge) => edge.source === node.id && edge.sourceHandle === 'loop')
      .map((edge) => edge.target);
    while (queue.length) {
      const current = queue.shift()!;
      if (current === node.id || body.has(current)) continue;
      body.add(current);
      for (const edge of graph.edges) if (edge.source === current) queue.push(edge.target);
    }
    result[node.id] = [...body];
  }
  return result;
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function configLiteral(config: unknown): string {
  return JSON.stringify(config);
}

function compiledCel(graph: WorkflowGraph): Record<string, unknown> {
  const values = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('$cel:')) values.add(value.slice(5).trim());
      for (const match of value.matchAll(/\{\{([\s\S]*?)\}\}/g)) values.add(match[1].trim());
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(graph);
  for (const node of graph.nodes) {
    const cfg = node.config as Record<string, unknown>;
    for (const item of (cfg.branches as Array<{ condition?: string }> | undefined) ?? []) if (item.condition) values.add(item.condition);
    if (typeof cfg.condition === 'string') values.add(cfg.condition);
    for (const item of (cfg.outputs as Array<{ expression?: string }> | undefined) ?? []) if (item.expression) values.add(item.expression);
    for (const item of (cfg.assignments as Array<{ expression?: string }> | undefined) ?? []) if (item.expression) values.add(item.expression);
  }
  return Object.fromEntries([...values].filter(Boolean).map((value) => [value, parseCel(value)]));
}

function zodExpression(schema: unknown): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'z.unknown()';
  const value = schema as Record<string, unknown>;
  if (Array.isArray(value.enum) && value.enum.length) {
    return `z.union([${value.enum.map((item) => `z.literal(${jsonLiteral(item)})`).join(', ')}])`;
  }
  switch (value.type) {
    case 'string': return 'z.string()';
    case 'number': return 'z.number()';
    case 'integer': return 'z.number().int()';
    case 'boolean': return 'z.boolean()';
    case 'array': return `z.array(${zodExpression(value.items)})`;
    case 'object': {
      const properties = value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)
        ? value.properties as Record<string, unknown>
        : {};
      const required = new Set(Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === 'string') : []);
      const shape = Object.entries(properties).map(([name, child]) => {
        const expression = zodExpression(child);
        return `${jsonLiteral(name)}: ${required.has(name) ? expression : `${expression}.optional()`}`;
      }).join(', ');
      return `z.object({ ${shape} })${value.additionalProperties === false ? '.strict()' : ''}`;
    }
    default: return 'z.unknown()';
  }
}

interface ExportTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: AgentTool['kind'];
  config: Record<string, unknown>;
  needsApproval: boolean;
}

function safeToolName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool';
}

function sdkToolChoice(config: AgentNodeConfig): string {
  return typeof config.toolChoice === 'object' ? config.toolChoice.name : config.toolChoice ?? 'auto';
}

function exportConfig(tool: AgentTool): Record<string, unknown> {
  const copy = structuredClone(tool) as unknown as Record<string, unknown>;
  if (tool.kind === 'function' && tool.execution.mode === 'http' && copy.execution && typeof copy.execution === 'object') {
    const execution = copy.execution as Record<string, unknown>;
    if (execution.headers && typeof execution.headers === 'object') {
      execution.headers = Object.fromEntries(Object.entries(execution.headers as Record<string, unknown>).filter(([, value]) => typeof value === 'string' && value !== '[REDACTED]'));
    }
  }
  return copy;
}

function requiredSecretNames(graph: WorkflowGraph): string[] {
  const names = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type !== 'agent') continue;
    for (const tool of (node.config.tools ?? []) as unknown as AgentTool[]) {
      if (tool.kind !== 'function' || tool.execution.mode !== 'http') continue;
      for (const value of [tool.execution.url, ...Object.values(tool.execution.headers ?? {})]) {
        for (const match of value.matchAll(SECRET_REFERENCE)) names.add(match[1]);
      }
    }
  }
  return [...names].sort();
}

function exportTools(tools: AgentTool[]): ExportTool[] {
  const used = new Set<string>();
  const unique = (raw: string) => {
    const base = safeToolName(raw);
    let name = base;
    let index = 2;
    while (used.has(name)) name = `${base}_${index++}`;
    used.add(name);
    return name;
  };
  return (tools ?? []).map((tool) => {
    if (tool.kind === 'web_search') return { name: unique('web_search'), description: 'Search the web.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, kind: tool.kind, config: exportConfig(tool), needsApproval: false };
    if (tool.kind === 'file_search') return { name: unique('file_search'), description: 'Search the configured vector stores.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, kind: tool.kind, config: exportConfig(tool), needsApproval: false };
    if (tool.kind === 'code_interpreter') return { name: unique('run_code'), description: 'Execute JavaScript code in a sandbox.', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false }, kind: tool.kind, config: exportConfig(tool), needsApproval: false };
    if (tool.kind === 'function') return { name: unique(tool.name), description: tool.description ?? `Call ${tool.name}.`, parameters: tool.parameters ?? { type: 'object', properties: {} }, kind: tool.kind, config: exportConfig(tool), needsApproval: tool.execution.mode === 'client' };
    if (tool.kind === 'custom') return { name: unique(tool.name), description: tool.description ?? `Call ${tool.name}.`, parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false }, kind: tool.kind, config: exportConfig(tool), needsApproval: !tool.code };
    return { name: unique(`mcp_${tool.serverId}`), description: 'Call a tool on the configured MCP server.', parameters: { type: 'object', properties: { tool: { type: 'string' }, arguments: { type: 'object' } }, required: ['tool', 'arguments'], additionalProperties: false }, kind: tool.kind, config: exportConfig(tool), needsApproval: tool.requireApproval === 'always' };
  });
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

function pyModelSettings(config: AgentNodeConfig): string {
  const args = [
    `tool_choice=${pyLiteral(sdkToolChoice(config))}`,
    `parallel_tool_calls=${config.parallelToolCalls !== false ? 'True' : 'False'}`,
  ];
  if (config.modelParams?.temperature !== undefined) args.push(`temperature=${config.modelParams.temperature}`);
  if (config.modelParams?.topP !== undefined) args.push(`top_p=${config.modelParams.topP}`);
  if (config.modelParams?.maxTokens !== undefined) args.push(`max_tokens=${config.modelParams.maxTokens}`);
  if (config.reasoningEffort) args.push(`reasoning=${pyLiteral({ effort: config.reasoningEffort })}`);
  if (config.verbosity) args.push(`verbosity=${pyLiteral(config.verbosity)}`);
  if (config.promptCache?.policy === 'enabled' && providerForModel(config.model) === 'openai') {
    args.push(`extra_body=${pyLiteral({
      ...(config.promptCache.key ? { prompt_cache_key: config.promptCache.key } : {}),
      ...(config.promptCache.retention ? { prompt_cache_retention: config.promptCache.retention } : {}),
    })}`);
  }
  return `ModelSettings(${args.join(', ')})`;
}

function tsHelpers(lines: string[], asts: Record<string, unknown>): void {
  lines.push(`type AnyRecord = Record<string, any>;`);
  lines.push(`type WorkflowMessage = { role: 'user' | 'assistant' | 'system'; content: string };`);
  lines.push(`type WorkflowSecrets = Record<string, string>;`);
  lines.push(`type SubflowRequest = { nodeId: string; workflowId: string; version: number; input: AnyRecord; maxDepth?: number };`);
  lines.push(`type SubflowResult = { id: string; status: 'completed' | 'failed' | 'cancelled'; output?: unknown; state?: AnyRecord; error?: string };`);
  lines.push(`type WorkflowHooks = {`);
  lines.push(`  approve?: (message: string) => boolean | { approved: boolean; reason?: string } | Promise<boolean | { approved: boolean; reason?: string }>;`);
  lines.push(`  guardrail?: (input: string, config: AnyRecord) => boolean | Promise<boolean>;`);
  lines.push(`  fileSearch?: (query: string, vectorStoreIds: string[], config: AnyRecord) => unknown | Promise<unknown>;`);
  lines.push(`  mcp?: (serverId: string, tool: string, args: AnyRecord) => unknown | Promise<unknown>;`);
  lines.push(`  agentTool?: (call: { nodeId: string; kind: string; name: string; arguments: AnyRecord; config: AnyRecord }) => unknown | Promise<unknown>;`);
  lines.push(`  subflow?: (request: SubflowRequest) => SubflowResult | Promise<SubflowResult>;`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`function agentInput(history: WorkflowMessage[], prompt: string): AgentInputItem[] {`);
  lines.push(`  const items: AgentInputItem[] = history.map((message) => (message.role === 'assistant'`);
  lines.push(`    ? { role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: message.content }] }`);
  lines.push(`    : message.role === 'system' ? { role: 'system', content: message.content } : { role: 'user', content: message.content }) as AgentInputItem);`);
  lines.push(`  if (!(history.length && history[history.length - 1].role === 'user' && history[history.length - 1].content === prompt)) items.push({ role: 'user', content: prompt });`);
  lines.push(`  return items;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`function size(value: any): number {`);
  lines.push(`  return typeof value === 'string' || Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;`);
  lines.push(`}`);
  lines.push(`function has(value: any, key: string): boolean {`);
  lines.push(`  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);`);
  lines.push(`}`);
  lines.push(`function requireTransition(nodeId: string, target: string | null): string {`);
  lines.push(`  if (target === null) throw new Error("Node '" + nodeId + "' has no executable transition");`);
  lines.push(`  return target;`);
  lines.push(`}`);
  lines.push(`function matches(value: any, pattern: string): boolean {`);
  lines.push(`  return new RegExp(pattern).test(String(value ?? ''));`);
  lines.push(`}`);
  lines.push(`function resolveHttpTemplate(template: string, scope: AnyRecord, secrets: WorkflowSecrets): string {`);
  lines.push(`  const tokens: Array<{ token: string; value: string }> = [];`);
  lines.push(`  const protectedTemplate = template.replace(/\\{\\{\\s*secrets\\.([A-Z][A-Z0-9_]{0,127})\\s*\\}\\}/g, (_match, name) => {`);
  lines.push(`    const value = secrets[name]; if (typeof value !== 'string' || value.length === 0) throw new Error("secret '" + name + "' is required");`);
  lines.push(`    const token = '__WILLOW_SECRET_' + tokens.length + '__'; tokens.push({ token, value }); return token;`);
  lines.push(`  });`);
  lines.push(`  if (/\\{\\{\\s*secrets\\./i.test(protectedTemplate)) throw new Error('invalid secret reference; use {{secrets.NAME}}');`);
  lines.push(`  let output = String(resolveValue(protectedTemplate, scope) ?? ''); for (const item of tokens) output = output.split(item.token).join(item.value); return output;`);
  lines.push(`}`);
  lines.push(`function redactSecrets(value: any, secrets: WorkflowSecrets): any {`);
  lines.push(`  const variants = (secret: string): string[] => { const bytes = new TextEncoder().encode(secret); const base64 = typeof btoa === 'function' ? btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')) : ''; const encoded = encodeURIComponent(secret); return [secret, encoded, encoded.toLowerCase(), base64, base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')].filter(Boolean); };`);
  lines.push(`  const values = [...new Set(Object.values(secrets).filter(Boolean).flatMap(variants))].sort((a, b) => b.length - a.length);`);
  lines.push(`  const visit = (input: any): any => typeof input === 'string' ? values.reduce((text, secret) => text.split(secret).join('[REDACTED]'), input) : Array.isArray(input) ? input.map(visit) : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).map(([key, item]) => [key, visit(item)])) : input;`);
  lines.push(`  return visit(value);`);
  lines.push(`}`);
  lines.push(`async function executeHttpTool(config: AnyRecord, args: AnyRecord, scope: AnyRecord, secrets: WorkflowSecrets): Promise<any> {`);
  lines.push(`  const execution = config.execution ?? {}; const url = resolveHttpTemplate(String(execution.url ?? ''), scope, secrets);`);
  lines.push(`  const headers = Object.fromEntries(Object.entries(execution.headers ?? {}).map(([name, value]) => [name, resolveHttpTemplate(String(value), scope, secrets)]));`);
  lines.push(`  try { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(args) }); const text = await response.text(); if (!response.ok) throw new Error('function endpoint HTTP ' + response.status + ': ' + String(redactSecrets(text, secrets)).slice(0, 400)); try { return redactSecrets(JSON.parse(text), secrets); } catch { return redactSecrets(text, secrets); } }`);
  lines.push(`  catch (error) { throw new Error(String(redactSecrets((error as Error).message, secrets))); }`);
  lines.push(`}`);
  lines.push(`async function runToolCall<T>(call: () => Promise<T> | T, config: AnyRecord, fallbackTimeoutMs: number): Promise<T> {`);
  lines.push(`  const policy = config.executionPolicy ?? {}; const attempts = Math.max(1, Math.min(6, Number(policy.maxRetries ?? 0) + 1));`);
  lines.push(`  const timeoutMs = Math.max(100, Number(policy.timeoutMs ?? config.timeoutMs ?? fallbackTimeoutMs));`);
  lines.push(`  for (let attempt = 1; attempt <= attempts; attempt++) {`);
  lines.push(`    let timer: ReturnType<typeof setTimeout> | undefined;`);
  lines.push(`    try { const value = await Promise.race([Promise.resolve().then(call), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('tool execution timed out after ' + timeoutMs + 'ms')), timeoutMs); })]); if (timer) clearTimeout(timer); return value; }`);
  lines.push(`    catch (error) { if (timer) clearTimeout(timer); const message = String((error as Error).message ?? error); const transient = /timed out|timeout|network|fetch failed|ECONN|socket|transport|HTTP (429|5\\d\\d)/i.test(message); if (attempt >= attempts || !transient) throw error; await new Promise((resolve) => setTimeout(resolve, Math.min(60000, Number(policy.retryBackoffMs ?? 250) * 2 ** (attempt - 1)))); }`);
  lines.push(`  } throw new Error('tool execution exhausted attempts');`);
  lines.push(`}`);
  lines.push(`const CEL_ASTS: AnyRecord = ${configLiteral(asts)};`);
  lines.push(`const celOwn=(o:any,k:any)=>o!==null&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,String(k));`);
  lines.push(`const celEq=(a:any,b:any):boolean=>a===b||(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>celEq(v,b[i])))||(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>celOwn(b,k)&&celEq(a[k],b[k])));`);
  lines.push(`function celEval(n:any,s:AnyRecord):any{switch(n.kind){case'lit':return n.value;case'ident':if(celOwn(s,n.name))return s[n.name];throw Error("unknown variable '"+n.name+"'");case'list':return n.items.map((x:any)=>celEval(x,s));case'map':return Object.fromEntries(n.entries.map((e:any)=>[String(celEval(e.key,s)),celEval(e.value,s)]));case'member':{const o=celEval(n.obj,s);if(celOwn(o,n.prop))return o[n.prop];throw Error("no such field '"+n.prop+"'")}case'index':{const o=celEval(n.obj,s),i=celEval(n.index,s);if((Array.isArray(o)||typeof o==='string')&&Number.isInteger(i)&&i>=0&&i<o.length)return o[i];if(celOwn(o,i))return o[String(i)];throw Error('invalid index')}case'unary':{const v=celEval(n.operand,s);if(n.op==='!'){if(typeof v!=='boolean')throw Error('operator !: expected bool');return!v}if(typeof v!=='number')throw Error('operator -: expected number');return-v}case'ternary':{const c=celEval(n.cond,s);if(typeof c!=='boolean')throw Error('ternary condition: expected bool');return celEval(c?n.then:n.else,s)}case'binary':return celBinary(n,s);case'call':return celCall(n,s)}}`);
  lines.push(`function celBinary(n:any,s:AnyRecord):any{if(n.op==='&&'){const a=celEval(n.left,s);if(typeof a!=='boolean')throw Error('&&: expected bool');return a?celEval(n.right,s):false}if(n.op==='||'){const a=celEval(n.left,s);if(typeof a!=='boolean')throw Error('||: expected bool');return a?true:celEval(n.right,s)}const a=celEval(n.left,s),b=celEval(n.right,s);switch(n.op){case'==':return celEq(a,b);case'!=':return!celEq(a,b);case'in':return Array.isArray(b)?b.some((x:any)=>celEq(a,x)):typeof b==='string'?b.includes(a):celOwn(b,a);case'+':return Array.isArray(a)&&Array.isArray(b)?[...a,...b]:a+b;case'-':return a-b;case'*':return a*b;case'/':if(b===0)throw Error('division by zero');return a/b;case'%':if(b===0)throw Error('modulo by zero');return a%b;case'<':return a<b;case'<=':return a<=b;case'>':return a>b;case'>=':return a>=b}throw Error('unsupported operator '+n.op)}`);
  lines.push(`function celCall(n:any,s:AnyRecord):any{const macros=['filter','map','exists','all','exists_one'];if(n.callee&&macros.includes(n.name)){const t=celEval(n.callee,s),items=Array.isArray(t)?t:Object.keys(t),v=n.args[0].name,f=(x:any)=>celEval(n.args[1],{...s,[v]:x});if(n.name==='filter')return items.filter(f);if(n.name==='map')return items.map(f);if(n.name==='exists')return items.some(f);if(n.name==='all')return items.every(f);return items.filter(f).length===1}if(!n.callee&&n.name==='has'){const a=n.args[0];try{if(a.kind==='ident')return celOwn(s,a.name);if(a.kind==='member')return celOwn(celEval(a.obj,s),a.prop);if(a.kind==='index')return celOwn(celEval(a.obj,s),celEval(a.index,s))}catch{return false}throw Error('has() requires a field selection')}const t=n.callee?celEval(n.callee,s):null,args=n.args.map((a:any)=>celEval(a,s));if(!n.callee){if(n.name==='size')return size(args[0]);if(n.name==='string')return args[0]&&typeof args[0]==='object'?JSON.stringify(args[0]):String(args[0]);if(n.name==='int')return Math.trunc(Number(args[0]));if(n.name==='double')return Number(args[0]);if(n.name==='bool'){if(args[0]===true||args[0]==='true')return true;if(args[0]===false||args[0]==='false')return false;throw Error('bool() cannot convert')}if(n.name==='type')return args[0]===null?'null':Array.isArray(args[0])?'list':typeof args[0]==='boolean'?'bool':typeof args[0]==='number'?(Number.isInteger(args[0])?'int':'double'):typeof args[0]==='object'?'map':typeof args[0];if(n.name==='matches')return matches(args[0],args[1]);if(n.name==='min'||n.name==='max'){const x=Array.isArray(args[0])&&args.length===1?args[0]:args;return(n.name==='min'?Math.min:Math.max)(...x)}throw Error("unknown function '"+n.name+"'")}if(typeof t==='string'){if(n.name==='contains')return t.includes(args[0]);if(n.name==='startsWith')return t.startsWith(args[0]);if(n.name==='endsWith')return t.endsWith(args[0]);if(n.name==='matches')return matches(t,args[0]);if(n.name==='lowerAscii'||n.name==='toLowerCase')return t.toLowerCase();if(n.name==='upperAscii'||n.name==='toUpperCase')return t.toUpperCase();if(n.name==='trim')return t.trim();if(n.name==='size')return t.length;if(n.name==='split')return t.split(args[0]);if(n.name==='replace')return t.split(args[0]).join(args[1]);if(n.name==='indexOf')return t.indexOf(args[0])}if(Array.isArray(t)){if(n.name==='size')return t.length;if(n.name==='join')return t.map((x:any)=>typeof x==='string'?x:JSON.stringify(x)).join(args[0]??'');if(n.name==='indexOf')return t.findIndex((x:any)=>celEq(x,args[0]))}if(t&&typeof t==='object'){if(n.name==='size')return Object.keys(t).length;if(n.name==='keys')return Object.keys(t);if(n.name==='values')return Object.values(t)}throw Error("cannot call method '"+n.name+"'")}`);
  lines.push(`function evaluateExpression(expression:string,scope:AnyRecord):any{const ast=CEL_ASTS[expression];if(!ast)throw Error('CEL expression was not compiled: '+expression);try{return celEval(ast,scope)}catch(error){throw Error('CEL expression failed: '+expression+' ('+(error as Error).message+')')}}`);
  lines.push(`function coerceVariable(value: any, type: string): any {`);
  lines.push(`  if (value == null) return type === 'string' ? '' : type === 'number' ? 0 : type === 'boolean' ? false : type === 'object' ? {} : type === 'list' ? [] : value;`);
  lines.push(`  if (type === 'string') return typeof value === 'string' ? value : JSON.stringify(value);`);
  lines.push(`  if (type === 'number') { const number = typeof value === 'number' ? value : Number(value); if (Number.isFinite(number)) return number; throw new Error("cannot coerce '" + String(value) + "' to number"); }`);
  lines.push(`  if (type === 'boolean') { if (value === true || value === 'true') return true; if (value === false || value === 'false') return false; throw new Error("cannot coerce '" + String(value) + "' to boolean"); }`);
  lines.push(`  if (type === 'object') { const parsed = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; throw new Error('cannot coerce value to object'); }`);
  lines.push(`  if (type === 'list') { const parsed = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value; if (Array.isArray(parsed)) return parsed; throw new Error('cannot coerce value to list'); }`);
  lines.push(`  return value;`);
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
  lines.push(`function assertSchema(value: any, schema: AnyRecord, path = '$'): void {`);
  lines.push(`  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;`);
  lines.push(`  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];`);
  lines.push(`  if (types.length && !types.some((type: string) => type === actual || (type === 'number' && actual === 'integer'))) throw new Error(path + ' expected ' + types.join('|') + ', got ' + actual);`);
  lines.push(`  if (schema.enum && !schema.enum.some((item: any) => JSON.stringify(item) === JSON.stringify(value))) throw new Error(path + ' value not in enum');`);
  lines.push(`  if (schema.anyOf && !schema.anyOf.some((item: AnyRecord) => { try { assertSchema(value, item, path); return true; } catch { return false; } })) throw new Error(path + ' did not match anyOf');`);
  lines.push(`  if (value && typeof value === 'object' && !Array.isArray(value)) {`);
  lines.push(`    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(path + '.' + key + ' is required');`);
  lines.push(`    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) throw new Error(path + '.' + key + ' is not allowed');`);
  lines.push(`    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) assertSchema(value[key], child as AnyRecord, path + '.' + key);`);
  lines.push(`  }`);
  lines.push(`  if (Array.isArray(value)) { if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(path + ' has too few items'); if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(path + ' has too many items'); if (schema.items) value.forEach((item, index) => assertSchema(item, schema.items, path + '[' + index + ']')); }`);
  lines.push(`  if (typeof value === 'number') { if (schema.minimum !== undefined && value < schema.minimum) throw new Error(path + ' below minimum'); if (schema.maximum !== undefined && value > schema.maximum) throw new Error(path + ' above maximum'); }`);
  lines.push(`  if (typeof value === 'string') { if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(path + ' shorter than minLength'); if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(path + ' longer than maxLength'); }`);
  lines.push(`}`);
  lines.push(``);
}

export function exportTypeScript(name: string, rawGraph: WorkflowGraph): string {
  const normalized = normalizeGraph(rawGraph, { migrateLegacyTerminal: true });
  const graph = stripEmbeddedHttpCredentials(normalized.graph);
  const varNames = normalized.varNames;
  const agents = graph.nodes.filter((node) => node.type === 'agent');
  const start = graph.nodes.find((node) => node.type === 'start');
  const startCfg = (start?.config ?? {}) as unknown as StartNodeConfig;
  const lines: string[] = [];

  lines.push(`// ${name} — exported from Willow Agent Builder`);
  lines.push(`// Requires: npm install @openai/agents zod`);
  lines.push(`import { Agent, run, tool } from '@openai/agents';`);
  lines.push(`import type { AgentInputItem } from '@openai/agents-core';`);
  lines.push(`import { z } from 'zod';`);
  lines.push(``);
  tsHelpers(lines, compiledCel(graph));

  lines.push(`export async function runWorkflow(inputAsText: string, variables: AnyRecord = {}, hooks: WorkflowHooks = {}, history: WorkflowMessage[] = [], secrets: WorkflowSecrets = {}, context?: AnyRecord): Promise<unknown> {`);
  lines.push(`  const workflow = { input_as_text: inputAsText, ...${jsonLiteral(Object.fromEntries((startCfg.inputVariables ?? []).filter((decl) => decl.name !== 'input_as_text' && decl.defaultValue !== undefined).map((decl) => [decl.name, decl.defaultValue])))}, ...variables };`);
  lines.push(`  const conversationHistory = history.map((message) => ({ ...message }));`);
  lines.push(`  const pendingHandoffs: AnyRecord = {};`);
  for (const agent of agents) {
    const cfg = agent.config as unknown as AgentNodeConfig;
    const variable = varNames.get(agent.id) ?? toVarName(agent.name);
    const tools = exportTools(cfg.tools ?? []);
    tools.forEach((exported, index) => {
      lines.push(`  const ${variable}_tool_${index} = tool({`);
      lines.push(`    name: ${jsStr(exported.name)}, description: ${jsStr(exported.description)},`);
      lines.push(`    parameters: ${zodExpression(exported.parameters)}, needsApproval: ${exported.needsApproval},`);
      lines.push(`    execute: async (args: AnyRecord) => {`);
      if (exported.kind === 'function' && (exported.config.execution as { mode?: string } | undefined)?.mode === 'http') {
        lines.push(`      return runToolCall(() => executeHttpTool(${configLiteral(exported.config)}, args, scope(), secrets), ${configLiteral(exported.config)}, 60000);`);
      } else {
        lines.push(`      if (!hooks.agentTool) throw new Error(${jsStr(`Agent tool '${exported.name}' requires hooks.agentTool`)});`);
        lines.push(`      return runToolCall(() => hooks.agentTool!({ nodeId: ${jsStr(agent.id)}, kind: ${jsStr(exported.kind)}, name: ${jsStr(exported.name)}, arguments: args, config: ${configLiteral(exported.config)} }), ${configLiteral(exported.config)}, 60000);`);
      }
      lines.push(`    },`);
      lines.push(`  });`);
    });
    const handoffToolNames = new Set(tools.map((tool) => tool.name));
    const handoffs = (cfg.handoffs ?? []).map((handoff, index) => {
      const target = graph.nodes.find((candidate) => candidate.id === handoff.targetNodeId);
      const base = safeToolName(handoff.toolName || `transfer_to_${target?.name || target?.id || handoff.targetNodeId}`);
      let toolName = base;
      let suffix = 2;
      while (handoffToolNames.has(toolName)) toolName = `${base}_${suffix++}`;
      handoffToolNames.add(toolName);
      lines.push(`  const ${variable}_handoff_${index} = tool({`);
      lines.push(`    name: ${jsStr(toolName)}, description: ${jsStr(handoff.description || `Transfer control to specialist '${target?.name || target?.id || handoff.targetNodeId}'.`)},`);
      lines.push(`    parameters: z.object({ reason: z.string().optional() }).strict(),`);
      lines.push(`    execute: async (args: AnyRecord) => { pendingHandoffs[${jsStr(agent.id)}] = { targetNodeId: ${jsStr(handoff.targetNodeId)}, reason: typeof args.reason === 'string' ? args.reason : undefined }; return 'Transfer accepted.'; },`);
      lines.push(`  });`);
      return toolName;
    });
    lines.push(`  const create_${variable} = () => new Agent({`);
    lines.push(`    name: ${jsStr(agent.name)}, model: ${jsStr(cfg.model)}, instructions: String(resolveValue(${jsStr(cfg.instructions ?? '')}, scope()) ?? ''),`);
    if (cfg.outputFormat === 'json' && cfg.outputSchema) lines.push(`    outputType: ${zodExpression(cfg.outputSchema)},`);
    lines.push(`    modelSettings: ${configLiteral({
      toolChoice: sdkToolChoice(cfg),
      parallelToolCalls: cfg.parallelToolCalls !== false,
      ...(cfg.modelParams?.temperature !== undefined ? { temperature: cfg.modelParams.temperature } : {}),
      ...(cfg.modelParams?.topP !== undefined ? { topP: cfg.modelParams.topP } : {}),
      ...(cfg.modelParams?.maxTokens !== undefined ? { maxTokens: cfg.modelParams.maxTokens } : {}),
      ...(cfg.reasoningEffort ? { reasoning: { effort: cfg.reasoningEffort } } : {}),
      ...(cfg.verbosity ? { text: { verbosity: cfg.verbosity } } : {}),
      ...(cfg.promptCache?.policy === 'enabled' && providerForModel(cfg.model) === 'openai' ? {
        providerData: {
          ...(cfg.promptCache.key ? { prompt_cache_key: cfg.promptCache.key } : {}),
          ...(cfg.promptCache.retention ? { prompt_cache_retention: cfg.promptCache.retention } : {}),
        },
      } : {}),
    })},`);
    lines.push(`    resetToolChoice: ${cfg.resetToolChoice !== false},`);
    lines.push(`    tools: [${[...tools.map((_, index) => `${variable}_tool_${index}`), ...handoffs.map((_, index) => `${variable}_handoff_${index}`)].join(', ')}],`);
    lines.push(`  });`);
  }
  lines.push(`  const state: AnyRecord = Object.fromEntries(${configLiteral((startCfg.stateVariables ?? []).map((decl) => ({ name: decl.name, type: decl.type, value: decl.initialValue ?? null })))}.map((declaration: AnyRecord) => [declaration.name, coerceVariable(declaration.value, declaration.type)]));`);
  lines.push(`  const outputs: AnyRecord = {};`);
  lines.push(`  const whileCounts: AnyRecord = {};`);
  lines.push(`  const whileBodies: AnyRecord = ${configLiteral(whileBodyMap(graph))};`);
  lines.push(`  const scope = () => ({ workflow, state, ...outputs });`);
  const errorPolicyNodes = graph.nodes.filter((node) => ['agent', 'subflow', 'fileSearch', 'mcp', 'ifElse', 'while', 'userApproval', 'transform', 'setState'].includes(node.type));
  const errorPolicies = Object.fromEntries(errorPolicyNodes.map((node) => {
    const config = node.config as Record<string, unknown>;
    return [node.id, {
      onError: config.onError ?? 'fail',
      nodeType: node.type,
      variable: varNames.get(node.id) ?? node.id,
      defaultTarget: edgeTarget(graph, node.id, null),
      errorTarget: edgeTarget(graph, node.id, 'error'),
    }];
  }));
  lines.push(`  const nodeErrorPolicies: AnyRecord = ${configLiteral(errorPolicies)};`);
  lines.push(`  let current: string | null = ${jsonLiteral(start?.id ?? null)};`);
  lines.push(`  let finalOutput: unknown = null;`);
  lines.push(`  let guard = 0;`);
  lines.push(`  let lastNodeId: string | null = null;`);
  lines.push(`  while (current) {`);
  lines.push(`    if (++guard > 10000) throw new Error('step limit exceeded');`);
  lines.push(`    const cameFrom = lastNodeId;`);
  lines.push(`    lastNodeId = current;`);
  const switchStart = lines.length;
  lines.push(`    switch (current) {`);

  for (const node of graph.nodes) {
    if (node.type === 'note') continue;
    const variable = varNames.get(node.id) ?? node.id;
    lines.push(`      case ${jsonLiteral(node.id)}: { // ${node.type}: ${node.name}`);
    switch (node.type) {
      case 'start':
        lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
        break;
      case 'agent': {
        const cfg = node.config as unknown as AgentNodeConfig;
        lines.push(`        delete pendingHandoffs[${jsonLiteral(node.id)}];`);
        lines.push(`        const ${variable}_prompt = ${cfg.userMessage ? `String(resolveValue(${jsStr(cfg.userMessage)}, scope()) ?? '')` : 'inputAsText'};`);
        lines.push(`        const ${variable}_input = ${cfg.includeChatHistory ? `agentInput(conversationHistory, ${variable}_prompt)` : `${variable}_prompt`};`);
        lines.push(`        const ${variable}_result = await run(create_${variable}(), ${variable}_input, { maxTurns: ${cfg.maxTurns ?? 10}, ...(context === undefined ? {} : { context }) });`);
        lines.push(`        const ${variable}_handoff = pendingHandoffs[${jsonLiteral(node.id)}];`);
        lines.push(`        if (${variable}_handoff) { outputs[${jsonLiteral(variable)}] = { output_text: '', handoff_target: ${variable}_handoff.targetNodeId, ...(${variable}_handoff.reason ? { handoff_reason: ${variable}_handoff.reason } : {}) }; current = ${variable}_handoff.targetNodeId; break; }`);
        lines.push(`        const ${variable}_output_text = typeof ${variable}_result.finalOutput === 'string' ? ${variable}_result.finalOutput : JSON.stringify(${variable}_result.finalOutput ?? null);`);
        if (cfg.outputFormat === 'json') {
          lines.push(`        const ${variable}_parsed = typeof ${variable}_result.finalOutput === 'string' ? JSON.parse(${variable}_result.finalOutput) : ${variable}_result.finalOutput;`);
          if (cfg.outputSchema) lines.push(`        assertSchema(${variable}_parsed, ${configLiteral(cfg.outputSchema)});`);
          lines.push(`        outputs[${jsonLiteral(variable)}] = { output_text: ${variable}_output_text, output_parsed: ${variable}_parsed };`);
        } else {
          lines.push(`        outputs[${jsonLiteral(variable)}] = { output_text: ${variable}_output_text };`);
        }
        if (cfg.writeToConversationHistory) lines.push(`        if (${variable}_output_text) conversationHistory.push({ role: 'assistant', content: ${variable}_output_text });`);
        lines.push(`        finalOutput = ${variable}_result.finalOutput;`);
        lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
        break;
      }
      case 'ifElse': {
        const cfg = node.config as unknown as IfElseNodeConfig;
        const branches = cfg.branches ?? [];
        if (!branches.length) {
          lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'else'))});`);
        } else {
          branches.forEach((branch, index) => {
            lines.push(`        ${index === 0 ? 'if' : 'else if'} (Boolean(evaluateExpression(${jsStr(branch.condition)}, scope()))) {`);
            lines.push(`          current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, branch.id))});`);
            lines.push(`        }`);
          });
          lines.push(`        else { current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'else'))}); }`);
        }
        break;
      }
      case 'while': {
        const cfg = node.config as unknown as WhileNodeConfig;
        lines.push(`        if (whileCounts[${jsonLiteral(node.id)}] !== undefined && (!cameFrom || !whileBodies[${jsonLiteral(node.id)}].includes(cameFrom))) delete whileCounts[${jsonLiteral(node.id)}];`);
        lines.push(`        const ${variable}_iterations = whileCounts[${jsonLiteral(node.id)}] ?? 0;`);
        lines.push(`        if (${variable}_iterations >= ${cfg.maxIterations ?? 100}) {`);
        lines.push(`          outputs[${jsonLiteral(variable)}] = { iterations: ${variable}_iterations };`);
        lines.push(`          delete whileCounts[${jsonLiteral(node.id)}];`);
        if (cfg.onMaxIterations === 'break') {
          lines.push(`          current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'done'))});`);
        } else {
          lines.push(`          throw new Error(${jsStr(`While '${node.name}' exceeded maxIterations`)});`);
        }
        lines.push(`        } else if (Boolean(evaluateExpression(${jsStr(cfg.condition)}, scope()))) {`);
        lines.push(`          whileCounts[${jsonLiteral(node.id)}] = ${variable}_iterations + 1;`);
        lines.push(`          outputs[${jsonLiteral(variable)}] = { iterations: whileCounts[${jsonLiteral(node.id)}] };`);
        lines.push(`          current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'loop'))});`);
        lines.push(`        } else {`);
        lines.push(`          outputs[${jsonLiteral(variable)}] = { iterations: ${variable}_iterations };`);
        lines.push(`          delete whileCounts[${jsonLiteral(node.id)}];`);
        lines.push(`          current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'done'))});`);
        lines.push(`        }`);
        break;
      }
      case 'transform': {
        const cfg = node.config as unknown as TransformNodeConfig;
        lines.push(`        outputs[${jsonLiteral(variable)}] = {};`);
        for (const output of cfg.outputs ?? []) {
          lines.push(`        outputs[${jsonLiteral(variable)}][${jsonLiteral(output.name)}] = coerceVariable(evaluateExpression(${jsStr(output.expression)}, scope()), ${jsStr(output.type)});`);
        }
        lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
        break;
      }
      case 'setState': {
        const cfg = node.config as unknown as SetStateNodeConfig;
        for (const assignment of cfg.assignments ?? []) {
          const declaration = (startCfg.stateVariables ?? []).find((value) => value.name === assignment.name);
          const expression = `evaluateExpression(${jsStr(assignment.expression)}, scope())`;
          lines.push(`        state[${jsonLiteral(assignment.name)}] = ${declaration ? `coerceVariable(${expression}, ${jsStr(declaration.type)})` : expression};`);
        }
        lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
        break;
      }
      case 'userApproval': {
        const cfg = node.config as unknown as UserApprovalNodeConfig;
        lines.push(`        if (!hooks.approve) throw new Error(${jsStr(`User approval '${node.name}' requires hooks.approve`)});`);
        if (cfg.timeoutMs && cfg.timeoutMs > 0) {
          lines.push(`        const approvalResult = await Promise.race([hooks.approve(String(resolveValue(${jsStr(cfg.message)}, scope()) ?? '')), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Approval timed out')), ${cfg.timeoutMs}))]);`);
        } else {
          lines.push(`        const approvalResult = await hooks.approve(String(resolveValue(${jsStr(cfg.message)}, scope()) ?? ''));`);
        }
        lines.push(`        const approved = typeof approvalResult === 'boolean' ? approvalResult : approvalResult.approved;`);
        lines.push(`        const reason = typeof approvalResult === 'boolean' ? '' : (approvalResult.reason ?? '');`);
        lines.push(`        outputs[${jsonLiteral(variable)}] = { approved, reason };`);
        lines.push(`        current = approved ? requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'approved'))}) : requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'rejected'))});`);
        break;
      }
      case 'guardrail': {
        const config = node.config as Record<string, unknown>;
        lines.push(`        if (!hooks.guardrail) throw new Error(${jsStr(`Guardrail '${node.name}' requires hooks.guardrail`)});`);
        lines.push(`        const guardrailInput = String(resolveValue(${jsStr(String(config.input ?? '{{workflow.input_as_text}}'))}, scope()) ?? '');`);
        if (config.continueOnError) {
          lines.push(`        let passed = true;`);
          lines.push(`        try { passed = await hooks.guardrail(guardrailInput, ${configLiteral(config)}); } catch { passed = true; }`);
        } else {
          lines.push(`        const passed = await hooks.guardrail(guardrailInput, ${configLiteral(config)});`);
        }
        if (config.onTripwire === 'stop') lines.push(`        if (!passed) throw new Error(${jsStr(`Guardrails '${node.name}' tripwire triggered`)});`);
        lines.push(`        current = passed ? requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'pass'))}) : requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, 'fail'))});`);
        break;
      }
      case 'fileSearch': {
        const config = node.config as Record<string, unknown>;
        lines.push(`        if (!hooks.fileSearch) throw new Error(${jsStr(`File search '${node.name}' requires hooks.fileSearch`)});`);
        lines.push(`        const searchQuery = String(resolveValue(${jsStr(String(config.query ?? ''))}, scope()) ?? '');`);
        lines.push(`        const searchResult = await runToolCall(() => hooks.fileSearch!(searchQuery, ${jsonLiteral(config.vectorStoreIds ?? [])}, ${configLiteral(config)}), ${configLiteral(config)}, 60000);`);
        lines.push(`        outputs[${jsonLiteral(variable)}] = { results: searchResult, output_text: JSON.stringify(searchResult), query: searchQuery };`);
        lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
        break;
      }
      case 'mcp': {
        const config = node.config as Record<string, unknown>;
        lines.push(`        if (!hooks.mcp) throw new Error(${jsStr(`MCP '${node.name}' requires hooks.mcp`)});`);
        lines.push(`        const mcpArgs = resolveValue(${configLiteral(config.arguments ?? {})}, scope());`);
        if (config.requireApproval === 'always') {
          lines.push(`        if (!hooks.approve) throw new Error(${jsStr(`MCP '${node.name}' requires hooks.approve`)});`);
          lines.push(`        const mcpApprovalResult = await hooks.approve(${jsStr(`Call MCP tool '${String(config.tool ?? '')}'?`)});`);
          lines.push(`        const mcpApproved = typeof mcpApprovalResult === 'boolean' ? mcpApprovalResult : mcpApprovalResult.approved;`);
          lines.push(`        if (!mcpApproved) { outputs[${jsonLiteral(variable)}] = { approved: false, reason: typeof mcpApprovalResult === 'boolean' ? '' : (mcpApprovalResult.reason ?? ''), result: null, output_text: '' }; current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))}); break; }`);
        }
        if (config.continueOnError) {
          lines.push(`        try {`);
          lines.push(`          const mcpResult = await runToolCall(() => hooks.mcp!(${jsStr(String(config.serverId ?? ''))}, ${jsStr(String(config.tool ?? ''))}, mcpArgs), ${configLiteral(config)}, 300000);`);
          lines.push(`          outputs[${jsonLiteral(variable)}] = { result: mcpResult, output_text: typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult) };`);
          lines.push(`        } catch (error) { outputs[${jsonLiteral(variable)}] = { result: null, output_text: '', error: (error as Error).message }; }`);
        } else {
          lines.push(`        const mcpResult = await runToolCall(() => hooks.mcp!(${jsStr(String(config.serverId ?? ''))}, ${jsStr(String(config.tool ?? ''))}, mcpArgs), ${configLiteral(config)}, 300000);`);
          lines.push(`        outputs[${jsonLiteral(variable)}] = { result: mcpResult, output_text: typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult) };`);
        }
        lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
        break;
      }
      case 'subflow': {
        const cfg = node.config as unknown as SubflowNodeConfig;
        lines.push(`        if (!hooks.subflow) throw new Error(${jsStr(`Subflow '${node.name}' requires hooks.subflow`)});`);
        lines.push(`        const childInput: AnyRecord = {};`);
        for (const mapping of cfg.inputMappings ?? []) {
          const value = `resolveValue(${configLiteral(mapping.value)}, scope())`;
          if (mapping.target === 'input_as_text') {
            lines.push(`        { const value = ${value}; childInput.input_as_text = typeof value === 'string' ? value : JSON.stringify(value ?? null); }`);
          } else if (mapping.target.startsWith('variables.')) {
            lines.push(`        childInput.variables ??= {}; childInput.variables[${jsStr(mapping.target.slice('variables.'.length))}] = ${value};`);
          } else if (mapping.target.startsWith('state_variables.')) {
            lines.push(`        childInput.state_variables ??= {}; childInput.state_variables[${jsStr(mapping.target.slice('state_variables.'.length))}] = ${value};`);
          } else {
            lines.push(`        throw new Error(${jsStr(`Subflow '${node.name}' has unsupported input mapping target '${mapping.target}'`)});`);
          }
        }
        lines.push(`        const childRun = await hooks.subflow({ nodeId: ${jsStr(node.id)}, workflowId: ${jsStr(cfg.workflowId)}, version: ${cfg.version}, input: childInput, maxDepth: ${cfg.maxDepth ?? 'undefined'} });`);
        lines.push(`        if (!childRun || typeof childRun !== 'object' || typeof childRun.id !== 'string' || typeof childRun.status !== 'string') throw new Error(${jsStr(`Subflow '${node.name}' hook returned an invalid child result`)});`);
        lines.push(`        if (childRun.status !== 'completed') throw new Error(${jsStr(`Subflow '${node.name}' child failed`)} + ' (' + childRun.status + ')' + (childRun.error ? ': ' + childRun.error : ''));`);
        lines.push(`        const childOutputText = typeof childRun.output === 'string' ? childRun.output : JSON.stringify(childRun.output ?? null);`);
        lines.push(`        const child = { output: childRun.output ?? null, output_text: childOutputText, state: childRun.state ?? {}, status: childRun.status, run_id: childRun.id };`);
        lines.push(`        outputs[${jsStr(variable)}] = { output: child.output, output_text: child.output_text, state: child.state, child_run_id: childRun.id, status: child.status };`);
        for (const mapping of cfg.outputMappings ?? []) {
          lines.push(`        outputs[${jsStr(variable)}][${jsStr(mapping.name)}] = resolveValue(${jsStr(mapping.expression)}, { ...scope(), child });`);
        }
        lines.push(`        current = requireTransition(${jsStr(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
        break;
      }
      case 'end': {
        const cfg = node.config as unknown as EndNodeConfig;
        if (cfg.output) {
          lines.push(`        finalOutput = resolveValue(${jsStr(cfg.output)}, scope());`);
        }
        if (cfg.outputSchema) lines.push(`        assertSchema(finalOutput, ${configLiteral(cfg.outputSchema)});`);
        lines.push(`        current = null;`);
        break;
      }
      default:
        lines.push(`        current = requireTransition(${jsonLiteral(node.id)}, ${jsonLiteral(edgeTarget(graph, node.id, null))});`);
    }
    lines.push(`        break;`);
    lines.push(`      }`);
  }

  lines.push(`      default: throw new Error("Unknown workflow node '" + current + "'");`);
  lines.push(`    }`);
  const switchLines = lines.splice(switchStart);
  lines.push(`    try {`);
  lines.push(...switchLines.map((line) => `  ${line}`));
  lines.push(`    } catch (error) {`);
  lines.push(`      const failedNode: string | null = current;`);
  lines.push(`      const policy: AnyRecord | undefined = failedNode ? nodeErrorPolicies[failedNode] : undefined;`);
  lines.push(`      if (!policy || policy.onError === 'fail') throw error;`);
  lines.push(`      const details = { type: 'node_execution_error', message: String((error as Error).message ?? error), nodeId: failedNode, nodeType: policy.nodeType };`);
  lines.push(`      outputs[policy.variable] = { output_text: '', error: details };`);
  lines.push(`      current = policy.onError === 'branch'`);
  lines.push(`        ? requireTransition(failedNode!, policy.errorTarget)`);
  lines.push(`        : requireTransition(failedNode!, policy.defaultTarget);`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  return finalOutput;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`// Example: await runWorkflow('Hello!');`);
  return lines.join('\n');
}

function pyHelpers(lines: string[], asts: Record<string, unknown>): void {
  lines.push(`class DotDict(dict):`);
  lines.push(`    __getattr__ = dict.get`);
  lines.push(``);
  lines.push(`def _wrap(value):`);
  lines.push(`    if isinstance(value, dict): return DotDict({key: _wrap(item) for key, item in value.items()})`);
  lines.push(`    if isinstance(value, list): return [_wrap(item) for item in value]`);
  lines.push(`    return value`);
  lines.push(``);
  lines.push(`def _assert_schema(value, schema, path="$"):`);
  lines.push(`    actual = "null" if value is None else "boolean" if isinstance(value, bool) else "integer" if isinstance(value, int) else "number" if isinstance(value, float) else "array" if isinstance(value, list) else "object" if isinstance(value, dict) else "string" if isinstance(value, str) else type(value).__name__`);
  lines.push(`    types = schema.get("type", [])`);
  lines.push(`    types = [types] if isinstance(types, str) else types`);
  lines.push(`    if types and not any(t == actual or (t == "number" and actual == "integer") for t in types): raise ValueError(f"{path} expected {'|'.join(types)}, got {actual}")`);
  lines.push(`    if "enum" in schema and value not in schema["enum"]: raise ValueError(f"{path} value not in enum")`);
  lines.push(`    if schema.get("anyOf"):`);
  lines.push(`        matched = False`);
  lines.push(`        for child in schema["anyOf"]:`);
  lines.push(`            try: _assert_schema(value, child, path); matched = True; break`);
  lines.push(`            except ValueError: pass`);
  lines.push(`        if not matched: raise ValueError(f"{path} did not match anyOf")`);
  lines.push(`    if isinstance(value, dict):`);
  lines.push(`        for key in schema.get("required", []):`);
  lines.push(`            if key not in value: raise ValueError(f"{path}.{key} is required")`);
  lines.push(`        if schema.get("additionalProperties") is False:`);
  lines.push(`            for key in value:`);
  lines.push(`                if key not in schema.get("properties", {}): raise ValueError(f"{path}.{key} is not allowed")`);
  lines.push(`        for key, child in schema.get("properties", {}).items():`);
  lines.push(`            if key in value: _assert_schema(value[key], child, f"{path}.{key}")`);
  lines.push(`    if isinstance(value, list) and schema.get("items"):`);
  lines.push(`        for index, item in enumerate(value): _assert_schema(item, schema["items"], f"{path}[{index}]")`);
  lines.push(`    if isinstance(value, list):`);
  lines.push(`        if "minItems" in schema and len(value) < schema["minItems"]: raise ValueError(f"{path} has too few items")`);
  lines.push(`        if "maxItems" in schema and len(value) > schema["maxItems"]: raise ValueError(f"{path} has too many items")`);
  lines.push(`    if isinstance(value, (int, float)) and not isinstance(value, bool):`);
  lines.push(`        if "minimum" in schema and value < schema["minimum"]: raise ValueError(f"{path} below minimum")`);
  lines.push(`        if "maximum" in schema and value > schema["maximum"]: raise ValueError(f"{path} above maximum")`);
  lines.push(`    if isinstance(value, str):`);
  lines.push(`        if "minLength" in schema and len(value) < schema["minLength"]: raise ValueError(f"{path} shorter than minLength")`);
  lines.push(`        if "maxLength" in schema and len(value) > schema["maxLength"]: raise ValueError(f"{path} longer than maxLength")`);
  lines.push(``);
  lines.push(`def _size(value):`);
  lines.push(`    return len(value) if isinstance(value, (str, list, dict)) else 0`);
  lines.push(``);
  lines.push(`def _has(value, key):`);
  lines.push(`    return isinstance(value, dict) and key in value`);
  lines.push(``);
  lines.push(`def _require_transition(node_id, target):`);
  lines.push(`    if target is None: raise RuntimeError(f"Node '{node_id}' has no executable transition")`);
  lines.push(`    return target`);
  lines.push(``);
  lines.push(`def _matches(value, pattern):`);
  lines.push(`    return re.search(pattern, str(value or "")) is not None`);
  lines.push(``);
  lines.push(`async def _call(hook, *args):`);
  lines.push(`    result = hook(*args)`);
  lines.push(`    return await result if inspect.isawaitable(result) else result`);
  lines.push(``);
  lines.push(`async def _run_tool(call, config, fallback_timeout):`);
  lines.push(`    policy = config.get("executionPolicy") or {}`);
  lines.push(`    attempts = max(1, min(6, int(policy.get("maxRetries", 0)) + 1))`);
  lines.push(`    timeout = max(0.1, float(policy.get("timeoutMs", config.get("timeoutMs", fallback_timeout))) / 1000)`);
  lines.push(`    for attempt in range(1, attempts + 1):`);
  lines.push(`        try: return await asyncio.wait_for(call(), timeout=timeout)`);
  lines.push(`        except Exception as error:`);
  lines.push(`            transient = re.search(r"timed out|timeout|network|fetch failed|ECONN|socket|transport|HTTP (429|5\\d\\d)", str(error), re.I) is not None`);
  lines.push(`            if attempt >= attempts or not transient: raise`);
  lines.push(`            await asyncio.sleep(min(60, float(policy.get("retryBackoffMs", 250)) / 1000 * (2 ** (attempt - 1))) )`);
  lines.push(`    raise RuntimeError("tool execution exhausted attempts")`);
  lines.push(``);
  lines.push(`_CEL_ASTS = ${pyLiteral(asts)}`);
  lines.push(`def _own(value, key): return isinstance(value, dict) and str(key) in value`);
  lines.push(`def _cel(node, scope):`);
  lines.push(`    kind = node["kind"]`);
  lines.push(`    if kind == "lit": return node.get("value")`);
  lines.push(`    if kind == "ident":`);
  lines.push(`        if node["name"] in scope: return scope[node["name"]]`);
  lines.push(`        raise RuntimeError("unknown variable '" + node["name"] + "'")`);
  lines.push(`    if kind == "list": return [_cel(item, scope) for item in node["items"]]`);
  lines.push(`    if kind == "map": return {str(_cel(item["key"], scope)): _cel(item["value"], scope) for item in node["entries"]}`);
  lines.push(`    if kind == "member":`);
  lines.push(`        obj = _cel(node["obj"], scope); key = node["prop"]`);
  lines.push(`        if _own(obj, key): return obj[key]`);
  lines.push(`        raise RuntimeError("no such field '" + key + "'")`);
  lines.push(`    if kind == "index":`);
  lines.push(`        obj, index = _cel(node["obj"], scope), _cel(node["index"], scope)`);
  lines.push(`        if isinstance(obj, (list, str)) and isinstance(index, int) and 0 <= index < len(obj): return obj[index]`);
  lines.push(`        if _own(obj, index): return obj[str(index)]`);
  lines.push(`        raise RuntimeError("invalid index")`);
  lines.push(`    if kind == "unary":`);
  lines.push(`        value = _cel(node["operand"], scope)`);
  lines.push(`        if node["op"] == "!":`);
  lines.push(`            if not isinstance(value, bool): raise RuntimeError("operator !: expected bool")`);
  lines.push(`            return not value`);
  lines.push(`        if not isinstance(value, (int, float)) or isinstance(value, bool): raise RuntimeError("operator -: expected number")`);
  lines.push(`        return -value`);
  lines.push(`    if kind == "ternary":`);
  lines.push(`        condition = _cel(node["cond"], scope)`);
  lines.push(`        if not isinstance(condition, bool): raise RuntimeError("ternary condition: expected bool")`);
  lines.push(`        return _cel(node["then"] if condition else node["else"], scope)`);
  lines.push(`    if kind == "binary": return _cel_binary(node, scope)`);
  lines.push(`    if kind == "call": return _cel_call(node, scope)`);
  lines.push(`def _cel_binary(node, scope):`);
  lines.push(`    op = node["op"]`);
  lines.push(`    if op == "&&": return bool(_cel(node["left"], scope)) and bool(_cel(node["right"], scope))`);
  lines.push(`    if op == "||": return bool(_cel(node["left"], scope)) or bool(_cel(node["right"], scope))`);
  lines.push(`    left, right = _cel(node["left"], scope), _cel(node["right"], scope)`);
  lines.push(`    if op == "==": return left == right`);
  lines.push(`    if op == "!=": return left != right`);
  lines.push(`    if op == "in": return left in right`);
  lines.push(`    if op == "+": return left + right`);
  lines.push(`    if op == "-": return left - right`);
  lines.push(`    if op == "*": return left * right`);
  lines.push(`    if op == "/":`);
  lines.push(`        if right == 0: raise RuntimeError("division by zero")`);
  lines.push(`        return left / right`);
  lines.push(`    if op == "%":`);
  lines.push(`        if right == 0: raise RuntimeError("modulo by zero")`);
  lines.push(`        return left % right`);
  lines.push(`    return {"<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right}[op]`);
  lines.push(`def _cel_call(node, scope):`);
  lines.push(`    name = node["name"]`);
  lines.push(`    if node.get("callee") is not None and name in ("filter", "map", "exists", "all", "exists_one"):`);
  lines.push(`        target = _cel(node["callee"], scope); items = target if isinstance(target, list) else list(target.keys()); variable = node["args"][0]["name"]`);
  lines.push(`        values = [_cel(node["args"][1], {**scope, variable: item}) for item in items]`);
  lines.push(`        if name == "filter": return [item for item, keep in zip(items, values) if keep]`);
  lines.push(`        if name == "map": return values`);
  lines.push(`        if name == "exists": return any(values)`);
  lines.push(`        if name == "all": return all(values)`);
  lines.push(`        return sum(bool(value) for value in values) == 1`);
  lines.push(`    if node.get("callee") is None and name == "has":`);
  lines.push(`        arg = node["args"][0]`);
  lines.push(`        try:`);
  lines.push(`            if arg["kind"] == "ident": return arg["name"] in scope`);
  lines.push(`            if arg["kind"] == "member": return _own(_cel(arg["obj"], scope), arg["prop"])`);
  lines.push(`            if arg["kind"] == "index": return _own(_cel(arg["obj"], scope), _cel(arg["index"], scope))`);
  lines.push(`        except Exception: return False`);
  lines.push(`    target = _cel(node["callee"], scope) if node.get("callee") is not None else None; args = [_cel(arg, scope) for arg in node["args"]]`);
  lines.push(`    if target is None:`);
  lines.push(`        if name == "size": return len(args[0])`);
  lines.push(`        if name == "string": return json.dumps(args[0], separators=(",", ":")) if isinstance(args[0], (dict, list)) else str(args[0]).lower() if isinstance(args[0], bool) else "null" if args[0] is None else str(args[0])`);
  lines.push(`        if name == "int": return int(float(args[0]))`);
  lines.push(`        if name == "double": return float(args[0])`);
  lines.push(`        if name == "bool":`);
  lines.push(`            if args[0] in (True, "true"): return True`);
  lines.push(`            if args[0] in (False, "false"): return False`);
  lines.push(`            raise RuntimeError("bool() cannot convert")`);
  lines.push(`        if name == "type": return "null" if args[0] is None else "bool" if isinstance(args[0], bool) else "list" if isinstance(args[0], list) else "map" if isinstance(args[0], dict) else "int" if isinstance(args[0], int) else "double" if isinstance(args[0], float) else "string"`);
  lines.push(`        if name == "matches": return _matches(args[0], args[1])`);
  lines.push(`        if name in ("min", "max"): return (min if name == "min" else max)(args[0] if len(args) == 1 and isinstance(args[0], list) else args)`);
  lines.push(`    if isinstance(target, str):`);
  lines.push(`        if name == "contains": return args[0] in target`);
  lines.push(`        if name == "startsWith": return target.startswith(args[0])`);
  lines.push(`        if name == "endsWith": return target.endswith(args[0])`);
  lines.push(`        if name == "matches": return _matches(target, args[0])`);
  lines.push(`        if name in ("lowerAscii", "toLowerCase"): return target.lower()`);
  lines.push(`        if name in ("upperAscii", "toUpperCase"): return target.upper()`);
  lines.push(`        if name == "trim": return target.strip()`);
  lines.push(`        if name == "size": return len(target)`);
  lines.push(`        if name == "split": return target.split(args[0])`);
  lines.push(`        if name == "replace": return target.replace(args[0], args[1])`);
  lines.push(`        if name == "indexOf": return target.find(args[0])`);
  lines.push(`    if isinstance(target, list):`);
  lines.push(`        if name == "size": return len(target)`);
  lines.push(`        if name == "join": return (args[0] if args else "").join(value if isinstance(value, str) else json.dumps(value, separators=(",", ":")) for value in target)`);
  lines.push(`        if name == "indexOf": return target.index(args[0]) if args[0] in target else -1`);
  lines.push(`    if isinstance(target, dict):`);
  lines.push(`        if name == "size": return len(target)`);
  lines.push(`        if name == "keys": return list(target.keys())`);
  lines.push(`        if name == "values": return list(target.values())`);
  lines.push(`    raise RuntimeError("unknown CEL function or method: " + name)`);
  lines.push(`def _eval(expression, scope):`);
  lines.push(`    if expression not in _CEL_ASTS: raise RuntimeError("CEL expression was not compiled: " + expression)`);
  lines.push(`    try: return _cel(_CEL_ASTS[expression], scope)`);
  lines.push(`    except Exception as error: raise RuntimeError(f"CEL expression failed: {expression} ({error})") from error`);
  lines.push(``);
  lines.push(`def _coerce_variable(value, variable_type):`);
  lines.push(`    if value is None: return "" if variable_type == "string" else 0 if variable_type == "number" else False if variable_type == "boolean" else {} if variable_type == "object" else [] if variable_type == "list" else value`);
  lines.push(`    if variable_type == "string": return value if isinstance(value, str) else json.dumps(value, separators=(",", ":"))`);
  lines.push(`    if variable_type == "number":`);
  lines.push(`        if isinstance(value, bool): raise RuntimeError("cannot coerce boolean to number")`);
  lines.push(`        try: number = float(value)`);
  lines.push(`        except (TypeError, ValueError): raise RuntimeError("cannot coerce value to number")`);
  lines.push(`        if not math.isfinite(number): raise RuntimeError("cannot coerce value to number")`);
  lines.push(`        return int(number) if number.is_integer() else number`);
  lines.push(`    if variable_type == "boolean":`);
  lines.push(`        if value is True or value == "true": return True`);
  lines.push(`        if value is False or value == "false": return False`);
  lines.push(`        raise RuntimeError("cannot coerce value to boolean")`);
  lines.push(`    if variable_type in ("object", "list"):`);
  lines.push(`        if isinstance(value, str):`);
  lines.push(`            try: value = json.loads(value)`);
  lines.push(`            except json.JSONDecodeError: raise RuntimeError("cannot coerce value to " + variable_type)`);
  lines.push(`        if variable_type == "object" and isinstance(value, dict): return value`);
  lines.push(`        if variable_type == "list" and isinstance(value, list): return value`);
  lines.push(`        raise RuntimeError("cannot coerce value to " + variable_type)`);
  lines.push(`    return value`);
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
  lines.push(`def _resolve_http_template(template, scope, secrets):`);
  lines.push(`    tokens = []`);
  lines.push(`    def protect(match):`);
  lines.push(`        name = match.group(1); value = secrets.get(name)`);
  lines.push(`        if not isinstance(value, str) or not value: raise RuntimeError("secret '" + name + "' is required")`);
  lines.push(`        token = "__WILLOW_SECRET_" + str(len(tokens)) + "__"; tokens.append((token, value)); return token`);
  lines.push(`    protected = re.sub(r"\\{\\{\\s*secrets\\.([A-Z][A-Z0-9_]{0,127})\\s*\\}\\}", protect, str(template))`);
  lines.push(`    if re.search(r"\\{\\{\\s*secrets\\.", protected, re.I): raise RuntimeError("invalid secret reference; use {{secrets.NAME}}")`);
  lines.push(`    output = str(_resolve(protected, scope) or "")`);
  lines.push(`    for token, value in tokens: output = output.replace(token, value)`);
  lines.push(`    return output`);
  lines.push(``);
  lines.push(`def _redact_secrets(value, secrets):`);
  lines.push(`    def variants(secret):`);
  lines.push(`        encoded = urllib.parse.quote(secret, safe="~()*!.'-")`);
  lines.push(`        b64 = base64.b64encode(secret.encode("utf-8")).decode("ascii")`);
  lines.push(`        return [secret, encoded, encoded.lower(), b64, b64.rstrip("=").replace("+", "-").replace("/", "_")]`);
  lines.push(`    values = sorted(set(item for secret in secrets.values() if secret for item in variants(secret) if item), key=len, reverse=True)`);
  lines.push(`    if isinstance(value, str):`);
  lines.push(`        for secret in values: value = value.replace(secret, "[REDACTED]")`);
  lines.push(`        return value`);
  lines.push(`    if isinstance(value, list): return [_redact_secrets(item, secrets) for item in value]`);
  lines.push(`    if isinstance(value, dict): return {key: _redact_secrets(item, secrets) for key, item in value.items()}`);
  lines.push(`    return value`);
  lines.push(``);
  lines.push(`async def _execute_http_tool(config, args, scope, secrets):`);
  lines.push(`    execution = config.get("execution") or {}; url = _resolve_http_template(execution.get("url") or "", scope, secrets)`);
  lines.push(`    headers = {name: _resolve_http_template(value, scope, secrets) for name, value in (execution.get("headers") or {}).items()}`);
  lines.push(`    headers = {"content-type": "application/json", **headers}`);
  lines.push(`    def request():`);
  lines.push(`        req = urllib.request.Request(url, data=json.dumps(args).encode("utf-8"), headers=headers, method="POST")`);
  lines.push(`        try:`);
  lines.push(`            with urllib.request.urlopen(req, timeout=60) as response: return response.status, response.read().decode("utf-8", errors="replace")`);
  lines.push(`        except urllib.error.HTTPError as error: return error.code, error.read().decode("utf-8", errors="replace")`);
  lines.push(`    try:`);
  lines.push(`        status, text = await asyncio.to_thread(request)`);
  lines.push(`        if status < 200 or status >= 300: raise RuntimeError("function endpoint HTTP " + str(status) + ": " + _redact_secrets(text, secrets)[:400])`);
  lines.push(`        try: return _redact_secrets(json.loads(text), secrets)`);
  lines.push(`        except json.JSONDecodeError: return _redact_secrets(text, secrets)`);
  lines.push(`    except Exception as error: raise RuntimeError(_redact_secrets(str(error), secrets))`);
  lines.push(``);
  lines.push(`def _agent_input(history, prompt):`);
  lines.push(`    items = []`);
  lines.push(`    for message in history:`);
  lines.push(`        if message.get("role") == "assistant": items.append({"role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": str(message.get("content", ""))}]})`);
  lines.push(`        else: items.append({"role": message.get("role", "user"), "content": str(message.get("content", ""))})`);
  lines.push(`    if not history or history[-1].get("role") != "user" or str(history[-1].get("content", "")) != prompt: items.append({"role": "user", "content": prompt})`);
  lines.push(`    return items`);
  lines.push(``);
}

export function exportPython(name: string, rawGraph: WorkflowGraph): string {
  const normalized = normalizeGraph(rawGraph, { migrateLegacyTerminal: true });
  const graph = stripEmbeddedHttpCredentials(normalized.graph);
  const varNames = normalized.varNames;
  const agents = graph.nodes.filter((node) => node.type === 'agent');
  const start = graph.nodes.find((node) => node.type === 'start');
  const startCfg = (start?.config ?? {}) as unknown as StartNodeConfig;
  const lines: string[] = [];

  lines.push(`# ${name} — exported from Willow Agent Builder`);
  lines.push(`# Requires: pip install openai-agents`);
  lines.push(`import asyncio`);
  lines.push(`import inspect`);
  lines.push(`import json`);
  lines.push(`import math`);
  lines.push(`import re`);
  lines.push(`import base64`);
  lines.push(`import urllib.error`);
  lines.push(`import urllib.parse`);
  lines.push(`import urllib.request`);
  lines.push(`from agents import Agent, FunctionTool, ModelSettings, Runner`);
  lines.push(``);
  pyHelpers(lines, compiledCel(graph));

  lines.push(`async def run_workflow(input_as_text: str, variables=None, hooks=None, history=None, secrets=None, context=None):`);
  lines.push(`    variables = variables or {}`);
  lines.push(`    hooks = hooks or {}`);
  lines.push(`    secrets = secrets or {}`);
  lines.push(`    conversation_history = [dict(message) for message in (history or [])]`);
  lines.push(`    pending_handoffs = {}`);
  for (const agent of agents) {
    const cfg = agent.config as unknown as AgentNodeConfig;
    const variable = varNames.get(agent.id) ?? toVarName(agent.name);
    const tools = exportTools(cfg.tools ?? []);
    tools.forEach((exported, index) => {
      lines.push(`    async def ${variable}_invoke_${index}(_context, raw_args):`);
      lines.push(`        config = ${pyLiteral(exported.config)}`);
      if (exported.kind === 'function' && (exported.config.execution as { mode?: string } | undefined)?.mode === 'http') {
        lines.push(`        return await _run_tool(lambda: _execute_http_tool(config, json.loads(raw_args or "{}"), scope(), secrets), config, 60000)`);
      } else {
        lines.push(`        hook = hooks.get("agent_tool")`);
        lines.push(`        if not hook: raise RuntimeError(${JSON.stringify(`Agent tool '${exported.name}' requires hooks['agent_tool']`)})`);
        lines.push(`        return await _run_tool(lambda: _call(hook, {"nodeId": ${JSON.stringify(agent.id)}, "kind": ${JSON.stringify(exported.kind)}, "name": ${JSON.stringify(exported.name)}, "arguments": json.loads(raw_args or "{}"), "config": config}), config, 60000)`);
      }
      lines.push(`    ${variable}_tool_${index} = FunctionTool(name=${JSON.stringify(exported.name)}, description=${JSON.stringify(exported.description)}, params_json_schema=${pyLiteral(exported.parameters)}, on_invoke_tool=${variable}_invoke_${index}, strict_json_schema=False, needs_approval=${exported.needsApproval ? 'True' : 'False'})`);
    });
    const handoffToolNames = new Set(tools.map((tool) => tool.name));
    const handoffs = (cfg.handoffs ?? []).map((handoff, index) => {
      const target = graph.nodes.find((candidate) => candidate.id === handoff.targetNodeId);
      const base = safeToolName(handoff.toolName || `transfer_to_${target?.name || target?.id || handoff.targetNodeId}`);
      let toolName = base;
      let suffix = 2;
      while (handoffToolNames.has(toolName)) toolName = `${base}_${suffix++}`;
      handoffToolNames.add(toolName);
      lines.push(`    async def ${variable}_handoff_invoke_${index}(_context, raw_args):`);
      lines.push(`        args = json.loads(raw_args or "{}")`);
      lines.push(`        pending_handoffs[${JSON.stringify(agent.id)}] = {"targetNodeId": ${JSON.stringify(handoff.targetNodeId)}, "reason": args.get("reason") if isinstance(args.get("reason"), str) else None}`);
      lines.push(`        return "Transfer accepted."`);
      lines.push(`    ${variable}_handoff_${index} = FunctionTool(name=${JSON.stringify(toolName)}, description=${JSON.stringify(handoff.description || `Transfer control to specialist '${target?.name || target?.id || handoff.targetNodeId}'.`)}, params_json_schema={"type": "object", "properties": {"reason": {"type": "string"}}, "additionalProperties": False}, on_invoke_tool=${variable}_handoff_invoke_${index}, strict_json_schema=False, needs_approval=False)`);
      return toolName;
    });
    lines.push(`    def create_${variable}():`);
    lines.push(`        return Agent(`);
    lines.push(`            name=${JSON.stringify(agent.name)}, model=${JSON.stringify(cfg.model)}, instructions=str(_resolve(${pyStr(cfg.instructions ?? '')}, scope()) or ''),`);
    if (cfg.outputFormat === 'json') lines.push(`            output_type=dict,`);
    lines.push(`            model_settings=${pyModelSettings(cfg)},`);
    lines.push(`            reset_tool_choice=${cfg.resetToolChoice !== false ? 'True' : 'False'},`);
    lines.push(`            tools=[${[...tools.map((_, index) => `${variable}_tool_${index}`), ...handoffs.map((_, index) => `${variable}_handoff_${index}`)].join(', ')}],`);
    lines.push(`        )`);
  }
  lines.push(`    workflow = {"input_as_text": input_as_text, **${pyLiteral(Object.fromEntries((startCfg.inputVariables ?? []).filter((decl) => decl.name !== 'input_as_text' && decl.defaultValue !== undefined).map((decl) => [decl.name, decl.defaultValue])))}, **variables}`);
  lines.push(`    state = {declaration["name"]: _coerce_variable(declaration.get("value"), declaration["type"]) for declaration in ${pyLiteral((startCfg.stateVariables ?? []).map((decl) => ({ name: decl.name, type: decl.type, value: decl.initialValue ?? null })))}}`);
  lines.push(`    outputs = {}`);
  lines.push(`    while_counts = {}`);
  lines.push(`    while_bodies = ${pyLiteral(whileBodyMap(graph))}`);
  lines.push(`    def scope(): return {"workflow": workflow, "state": state, **outputs}`);
  const pyErrorPolicies = Object.fromEntries(graph.nodes.filter((node) => ['agent', 'subflow', 'fileSearch', 'mcp', 'ifElse', 'while', 'userApproval', 'transform', 'setState'].includes(node.type)).map((node) => {
    const config = node.config as Record<string, unknown>;
    return [node.id, {
      onError: config.onError ?? 'fail',
      nodeType: node.type,
      variable: varNames.get(node.id) ?? node.id,
      defaultTarget: edgeTarget(graph, node.id, null),
      errorTarget: edgeTarget(graph, node.id, 'error'),
    }];
  }));
  lines.push(`    node_error_policies = ${pyLiteral(pyErrorPolicies)}`);
  lines.push(`    current = ${jsonLiteral(start?.id ?? null)}`);
  lines.push(`    final_output = None`);
  lines.push(`    guard = 0`);
  lines.push(`    last_node_id = None`);
  lines.push(`    while current is not None:`);
  lines.push(`        guard += 1`);
  lines.push(`        if guard > 10000: raise RuntimeError("step limit exceeded")`);
  lines.push(`        came_from = last_node_id`);
  lines.push(`        last_node_id = current`);

  const controlStart = lines.length;
  let first = true;
  for (const node of graph.nodes) {
    if (node.type === 'note') continue;
    const variable = varNames.get(node.id) ?? node.id;
    const kw = first ? 'if' : 'elif';
    first = false;
    const nxt = (handle: string | null) => `_require_transition(${jsonLiteral(node.id)}, ${pyLiteral(edgeTarget(graph, node.id, handle))})`;
    lines.push(`        ${kw} current == ${jsonLiteral(node.id)}:  # ${node.type}: ${node.name}`);
    switch (node.type) {
      case 'start':
        lines.push(`            current = ${nxt(null)}`);
        break;
      case 'agent': {
        const cfg = node.config as unknown as AgentNodeConfig;
        lines.push(`            pending_handoffs.pop(${JSON.stringify(node.id)}, None)`);
        lines.push(`            prompt = str(_resolve(${jsStr(cfg.userMessage ?? '')}, scope())) if ${cfg.userMessage ? 'True' : 'False'} else input_as_text`);
        lines.push(`            agent_input = _agent_input(conversation_history, prompt) if ${cfg.includeChatHistory ? 'True' : 'False'} else prompt`);
        lines.push(`            result = await Runner.run(create_${variable}(), agent_input${cfg.maxTurns !== undefined ? `, max_turns=${cfg.maxTurns}` : ''}, context=context)`);
        lines.push(`            handoff = pending_handoffs.get(${JSON.stringify(node.id)})`);
        lines.push(`            if handoff:`);
        lines.push(`                outputs[${JSON.stringify(variable)}] = {"output_text": "", "handoff_target": handoff["targetNodeId"], **({"handoff_reason": handoff["reason"]} if handoff.get("reason") else {})}`);
        lines.push(`                current = handoff["targetNodeId"]`);
        lines.push(`                continue`);
        lines.push(`            output_text = result.final_output if isinstance(result.final_output, str) else json.dumps(result.final_output if result.final_output is not None else None)`);
        if (cfg.outputFormat === 'json') {
          lines.push(`            parsed_output = json.loads(result.final_output) if isinstance(result.final_output, str) else result.final_output`);
          if (cfg.outputSchema) lines.push(`            _assert_schema(parsed_output, ${pyLiteral(cfg.outputSchema)})`);
          lines.push(`            outputs[${jsonLiteral(variable)}] = {"output_text": output_text, "output_parsed": parsed_output}`);
        } else {
          lines.push(`            outputs[${jsonLiteral(variable)}] = {"output_text": output_text}`);
        }
        if (cfg.writeToConversationHistory) lines.push(`            if output_text: conversation_history.append({"role": "assistant", "content": output_text})`);
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
        lines.push(`            if ${jsonLiteral(node.id)} in while_counts and (not came_from or came_from not in while_bodies[${jsonLiteral(node.id)}]): while_counts.pop(${jsonLiteral(node.id)}, None)`);
        lines.push(`            iterations = while_counts.get(${jsonLiteral(node.id)}, 0)`);
        lines.push(`            if iterations >= ${cfg.maxIterations ?? 100}:`);
        lines.push(`                outputs[${jsonLiteral(variable)}] = {"iterations": iterations}`);
        lines.push(`                while_counts.pop(${jsonLiteral(node.id)}, None)`);
        if (cfg.onMaxIterations === 'break') lines.push(`                current = ${nxt('done')}`);
        else lines.push(`                raise RuntimeError(${jsonLiteral(`While '${node.name}' exceeded maxIterations`)})`);
        lines.push(`            elif bool(_eval(${jsonLiteral(cfg.condition)}, scope())):`);
        lines.push(`                while_counts[${jsonLiteral(node.id)}] = iterations + 1`);
        lines.push(`                outputs[${jsonLiteral(variable)}] = {"iterations": while_counts[${jsonLiteral(node.id)}]}`);
        lines.push(`                current = ${nxt('loop')}`);
        lines.push(`            else:`);
        lines.push(`                outputs[${jsonLiteral(variable)}] = {"iterations": iterations}`);
        lines.push(`                while_counts.pop(${jsonLiteral(node.id)}, None)`);
        lines.push(`                current = ${nxt('done')}`);
        break;
      }
      case 'transform': {
        const cfg = node.config as unknown as TransformNodeConfig;
        lines.push(`            outputs[${jsonLiteral(variable)}] = {}`);
        for (const output of cfg.outputs ?? []) {
          lines.push(`            outputs[${jsonLiteral(variable)}][${jsonLiteral(output.name)}] = _coerce_variable(_eval(${jsonLiteral(output.expression)}, scope()), ${jsonLiteral(output.type)})`);
        }
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'setState': {
        const cfg = node.config as unknown as SetStateNodeConfig;
        for (const assignment of cfg.assignments ?? []) {
          const declaration = (startCfg.stateVariables ?? []).find((value) => value.name === assignment.name);
          const expression = `_eval(${jsonLiteral(assignment.expression)}, scope())`;
          lines.push(`            state[${jsonLiteral(assignment.name)}] = ${declaration ? `_coerce_variable(${expression}, ${jsonLiteral(declaration.type)})` : expression}`);
        }
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'userApproval': {
        const cfg = node.config as unknown as UserApprovalNodeConfig;
        lines.push(`            if not hooks.get("approve"): raise RuntimeError(${JSON.stringify(`User approval '${node.name}' requires hooks['approve']`)})`);
        if (cfg.timeoutMs && cfg.timeoutMs > 0) {
          lines.push(`            approval_result = await asyncio.wait_for(_call(hooks["approve"], _resolve(${jsonLiteral(cfg.message)}, scope())), timeout=${cfg.timeoutMs / 1000})`);
        } else {
          lines.push(`            approval_result = await _call(hooks["approve"], _resolve(${jsonLiteral(cfg.message)}, scope()))`);
        }
        lines.push(`            approved = bool(approval_result.get("approved")) if isinstance(approval_result, dict) else bool(approval_result)`);
        lines.push(`            reason = str(approval_result.get("reason") or "") if isinstance(approval_result, dict) else ""`);
        lines.push(`            outputs[${jsonLiteral(variable)}] = {"approved": approved, "reason": reason}`);
        lines.push(`            current = ${nxt('approved')} if approved else ${nxt('rejected')}`);
        break;
      }
      case 'guardrail': {
        const config = node.config as Record<string, unknown>;
        lines.push(`            if not hooks.get("guardrail"): raise RuntimeError(${JSON.stringify(`Guardrail '${node.name}' requires hooks['guardrail']`)})`);
        lines.push(`            guard_input = str(_resolve(${jsonLiteral(String(config.input ?? '{{workflow.input_as_text}}'))}, scope()))`);
        if (config.continueOnError) {
          lines.push(`            try: passed = bool(await _call(hooks["guardrail"], guard_input, ${pyLiteral(config)}))`);
          lines.push(`            except Exception: passed = True`);
        } else {
          lines.push(`            passed = bool(await _call(hooks["guardrail"], guard_input, ${pyLiteral(config)}))`);
        }
        if (config.onTripwire === 'stop') lines.push(`            if not passed: raise RuntimeError(${jsonLiteral(`Guardrails '${node.name}' tripwire triggered`)})`);
        lines.push(`            current = ${nxt('pass')} if passed else ${nxt('fail')}`);
        break;
      }
      case 'fileSearch': {
        const config = node.config as Record<string, unknown>;
        lines.push(`            if not hooks.get("file_search"): raise RuntimeError(${JSON.stringify(`File search '${node.name}' requires hooks['file_search']`)})`);
        lines.push(`            query = str(_resolve(${jsonLiteral(String(config.query ?? ''))}, scope()))`);
        lines.push(`            result = await _run_tool(lambda: _call(hooks["file_search"], query, ${pyLiteral(config.vectorStoreIds ?? [])}, ${pyLiteral(config)}), ${pyLiteral(config)}, 60000)`);
        lines.push(`            outputs[${jsonLiteral(variable)}] = {"results": result, "output_text": str(result), "query": query}`);
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'mcp': {
        const config = node.config as Record<string, unknown>;
        lines.push(`            if not hooks.get("mcp"): raise RuntimeError(${JSON.stringify(`MCP '${node.name}' requires hooks['mcp']`)})`);
        lines.push(`            mcp_args = _resolve(${pyLiteral(config.arguments ?? {})}, scope())`);
        if (config.requireApproval === 'always') {
          lines.push(`            if not hooks.get("approve"): raise RuntimeError(${JSON.stringify(`MCP '${node.name}' requires hooks['approve']`)})`);
          lines.push(`            mcp_approval_result = await _call(hooks["approve"], ${jsonLiteral(`Call MCP tool '${String(config.tool ?? '')}'?`)})`);
          lines.push(`            mcp_approved = mcp_approval_result if isinstance(mcp_approval_result, bool) else bool(mcp_approval_result.get("approved"))`);
          lines.push(`            if not mcp_approved:`);
          lines.push(`                outputs[${jsonLiteral(variable)}] = {"approved": False, "reason": "" if isinstance(mcp_approval_result, bool) else str(mcp_approval_result.get("reason") or ""), "result": None, "output_text": ""}`);
          lines.push(`                current = ${nxt(null)}`);
          lines.push(`                continue`);
        }
        if (config.continueOnError) {
          lines.push(`            try:`);
          lines.push(`                result = await _run_tool(lambda: _call(hooks["mcp"], ${jsonLiteral(String(config.serverId ?? ''))}, ${jsonLiteral(String(config.tool ?? ''))}, mcp_args), ${pyLiteral(config)}, 300000)`);
          lines.push(`                outputs[${jsonLiteral(variable)}] = {"result": result, "output_text": result if isinstance(result, str) else str(result)}`);
          lines.push(`            except Exception as error:`);
          lines.push(`                outputs[${jsonLiteral(variable)}] = {"result": None, "output_text": "", "error": str(error)}`);
        } else {
          lines.push(`            result = await _run_tool(lambda: _call(hooks["mcp"], ${jsonLiteral(String(config.serverId ?? ''))}, ${jsonLiteral(String(config.tool ?? ''))}, mcp_args), ${pyLiteral(config)}, 300000)`);
          lines.push(`            outputs[${jsonLiteral(variable)}] = {"result": result, "output_text": result if isinstance(result, str) else str(result)}`);
        }
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'subflow': {
        const cfg = node.config as unknown as SubflowNodeConfig;
        lines.push(`            subflow_hook = hooks.get("subflow")`);
        lines.push(`            if not subflow_hook: raise RuntimeError(${JSON.stringify(`Subflow '${node.name}' requires hooks['subflow']`)})`);
        lines.push(`            child_input = {}`);
        for (const mapping of cfg.inputMappings ?? []) {
          lines.push(`            mapped_value = _resolve(${pyLiteral(mapping.value)}, scope())`);
          if (mapping.target === 'input_as_text') {
            lines.push(`            child_input["input_as_text"] = mapped_value if isinstance(mapped_value, str) else json.dumps(mapped_value if mapped_value is not None else None)`);
          } else if (mapping.target.startsWith('variables.')) {
            lines.push(`            child_input.setdefault("variables", {})[${JSON.stringify(mapping.target.slice('variables.'.length))}] = mapped_value`);
          } else if (mapping.target.startsWith('state_variables.')) {
            lines.push(`            child_input.setdefault("state_variables", {})[${JSON.stringify(mapping.target.slice('state_variables.'.length))}] = mapped_value`);
          } else {
            lines.push(`            raise RuntimeError(${JSON.stringify(`Subflow '${node.name}' has unsupported input mapping target '${mapping.target}'`)})`);
          }
        }
        lines.push(`            child_run = await _call(subflow_hook, {"nodeId": ${JSON.stringify(node.id)}, "workflowId": ${JSON.stringify(cfg.workflowId)}, "version": ${cfg.version}, "input": child_input, "maxDepth": ${pyLiteral(cfg.maxDepth)}})`);
        lines.push(`            if not isinstance(child_run, dict) or not isinstance(child_run.get("id"), str) or not isinstance(child_run.get("status"), str): raise RuntimeError(${JSON.stringify(`Subflow '${node.name}' hook returned an invalid child result`)})`);
        lines.push(`            if child_run["status"] != "completed": raise RuntimeError(${JSON.stringify(`Subflow '${node.name}' child failed`)} + " (" + child_run["status"] + ")" + ((": " + str(child_run.get("error"))) if child_run.get("error") else ""))`);
        lines.push(`            child_output = child_run.get("output")`);
        lines.push(`            child_output_text = child_output if isinstance(child_output, str) else json.dumps(child_output if child_output is not None else None)`);
        lines.push(`            child = {"output": child_output, "output_text": child_output_text, "state": child_run.get("state") or {}, "status": child_run["status"], "run_id": child_run["id"]}`);
        lines.push(`            outputs[${JSON.stringify(variable)}] = {"output": child["output"], "output_text": child["output_text"], "state": child["state"], "child_run_id": child_run["id"], "status": child["status"]}`);
        for (const mapping of cfg.outputMappings ?? []) {
          lines.push(`            outputs[${JSON.stringify(variable)}][${JSON.stringify(mapping.name)}] = _resolve(${JSON.stringify(mapping.expression)}, {**scope(), "child": child})`);
        }
        lines.push(`            current = ${nxt(null)}`);
        break;
      }
      case 'end': {
        const cfg = node.config as unknown as EndNodeConfig;
        if (cfg.output) lines.push(`            final_output = _resolve(${jsonLiteral(cfg.output)}, scope())`);
        if (cfg.outputSchema) lines.push(`            _assert_schema(final_output, ${pyLiteral(cfg.outputSchema)})`);
        lines.push(`            current = None`);
        break;
      }
      default:
        lines.push(`            current = ${nxt(null)}`);
    }
  }
  lines.push(`        else: raise RuntimeError(f"Unknown workflow node '{current}'")`);
  const controlLines = lines.splice(controlStart);
  lines.push(`        try:`);
  lines.push(...controlLines.map((line) => `    ${line}`));
  lines.push(`        except Exception as error:`);
  lines.push(`            failed_node = current`);
  lines.push(`            policy = node_error_policies.get(failed_node)`);
  lines.push(`            if not policy or policy.get("onError") == "fail": raise`);
  lines.push(`            details = {"type": "node_execution_error", "message": str(error), "nodeId": failed_node, "nodeType": policy["nodeType"]}`);
  lines.push(`            outputs[policy["variable"]] = {"output_text": "", "error": details}`);
  lines.push(`            current = _require_transition(failed_node, policy["errorTarget"] if policy.get("onError") == "branch" else policy["defaultTarget"])`);
  lines.push(`    return final_output`);
  lines.push(``);
  lines.push(`if __name__ == "__main__":`);
  lines.push(`    print(asyncio.run(run_workflow("Hello!")))`);
  return lines.join('\n');
}

export interface SdkCodeBundleManifest {
  formatVersion: 1;
  generator: {
    name: 'willow-agent-builder';
    version: string;
  };
  target: {
    framework: 'openai-agents-sdk';
    package: string;
    version: string;
  };
  compatibility: {
    mode: 'hybrid';
    warnings: string[];
  };
  agents: Array<{ id: string; name?: string }>;
  transitions: Array<{ source: string; target: string; handle: string | null }>;
  handoffCandidates: Array<{ source: string; target: string }>;
  subflows: Array<{ nodeId: string; workflowId: string; version: number }>;
  requiredSecrets: string[];
  requiredHooks: Array<'approve' | 'guardrail' | 'fileSearch' | 'mcp' | 'agentTool' | 'subflow'>;
}

export interface SdkCodeBundle {
  mode: 'agents-sdk';
  language: 'typescript' | 'python';
  entrypoint: string;
  dependencies: Array<{
    name: string;
    version: string;
    kind: 'runtime' | 'development';
  }>;
  installCommand: string;
  runCommand: string;
  manifest: SdkCodeBundleManifest;
  files: Record<string, string>;
}

function sdkBundleManifest(
  graph: WorkflowGraph,
  targetPackage: string,
): SdkCodeBundleManifest {
  const normalized = normalizeGraph(graph, { migrateLegacyTerminal: true }).graph;
  const subflows = normalized.nodes
    .filter((node) => node.type === 'subflow')
    .map((node) => {
      const config = node.config as unknown as SubflowNodeConfig;
      return { nodeId: node.id, workflowId: config.workflowId, version: config.version };
    });
  const requiredHooks = [
    ...(normalized.nodes.some((node) => node.type === 'userApproval' || (node.type === 'mcp' && (node.config as Record<string, unknown>).requireApproval === 'always')) ? ['approve' as const] : []),
    ...(normalized.nodes.some((node) => node.type === 'guardrail') ? ['guardrail' as const] : []),
    ...(normalized.nodes.some((node) => node.type === 'fileSearch') ? ['fileSearch' as const] : []),
    ...(normalized.nodes.some((node) => node.type === 'mcp') ? ['mcp' as const] : []),
    ...(normalized.nodes.some((node) => node.type === 'agent' && exportTools(((node.config as unknown as AgentNodeConfig).tools ?? [])).some((tool) => tool.kind !== 'function' || (tool.config.execution as { mode?: string } | undefined)?.mode !== 'http')) ? ['agentTool' as const] : []),
    ...(subflows.length ? ['subflow' as const] : []),
  ];
  return {
    formatVersion: 1,
    generator: { name: 'willow-agent-builder', version: '0.1.0' },
    target: {
      framework: 'openai-agents-sdk',
      package: targetPackage,
      version: 'latest',
    },
    compatibility: {
      mode: 'hybrid',
      warnings: [
        'Agent and tool calls use SDK-native primitives; visual routing uses a generated deterministic orchestrator to preserve workflow semantics.',
        'SDK dependencies use the floating "latest" version. Pin and test exact versions before production deployment.',
        ...(subflows.length ? ['Pinned subflows require a runtime subflow hook; generated runners fail closed when it is absent.'] : []),
      ],
    },
    agents: normalized.nodes.filter((node) => node.type === 'agent').map((node) => ({ id: node.id, name: node.name })),
    transitions: normalized.edges.map((edge) => ({ source: edge.source, target: edge.target, handle: edge.sourceHandle ?? null })),
    handoffCandidates: [
      ...normalized.edges.filter((edge) => normalized.nodes.some((node) => node.id === edge.source && node.type === 'agent') && normalized.nodes.some((node) => node.id === edge.target && node.type === 'agent')).map((edge) => ({ source: edge.source, target: edge.target })),
      ...normalized.nodes.filter((node) => node.type === 'agent').flatMap((node) => ((node.config.handoffs ?? []) as unknown as Array<{ targetNodeId: string }>).map((handoff) => ({ source: node.id, target: handoff.targetNodeId }))),
    ].filter((candidate, index, all) => all.findIndex((item) => item.source === candidate.source && item.target === candidate.target) === index),
    subflows,
    requiredSecrets: requiredSecretNames(normalized),
    requiredHooks,
  };
}

export function exportTypeScriptSdkPackage(name: string, graph: WorkflowGraph): SdkCodeBundle {
  const workflow = exportTypeScript(name, graph);
  const manifest = sdkBundleManifest(graph, '@openai/agents');
  const secretNames = manifest.requiredSecrets;
  return {
    mode: 'agents-sdk',
    language: 'typescript',
    entrypoint: 'src/index.ts',
    dependencies: [
      { name: '@openai/agents', version: 'latest', kind: 'runtime' },
      { name: '@openai/agents-core', version: 'latest', kind: 'runtime' },
      { name: 'zod', version: 'latest', kind: 'runtime' },
      { name: 'tsx', version: 'latest', kind: 'development' },
      { name: 'typescript', version: 'latest', kind: 'development' },
      { name: '@types/node', version: 'latest', kind: 'development' },
    ],
    installCommand: 'npm install',
    runCommand: 'npm start -- "your input"',
    manifest,
    files: {
      'src/workflow.ts': workflow,
      'src/index.ts': [
        "import { runWorkflow } from './workflow.js';",
        '',
        "const input = process.argv.slice(2).join(' ') || 'Hello';",
        `const secretNames: string[] = ${JSON.stringify(secretNames)};`,
        "const secrets = Object.fromEntries(secretNames.map((name) => { const value = process.env[name]; if (!value) throw new Error(`Missing required secret ${name}`); return [name, value]; }));",
        'const output = await runWorkflow(input, {}, {}, [], secrets);',
        'console.log(typeof output === \'string\' ? output : JSON.stringify(output, null, 2));',
        '',
      ].join('\n'),
      'package.json': JSON.stringify({
        name: toVarName(name).replace(/_/g, '-'),
        private: true,
        type: 'module',
        scripts: { start: 'tsx src/index.ts', typecheck: 'tsc --noEmit' },
        dependencies: { '@openai/agents': 'latest', '@openai/agents-core': 'latest', zod: 'latest' },
        devDependencies: { tsx: 'latest', typescript: 'latest', '@types/node': 'latest' },
      }, null, 2) + '\n',
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
          esModuleInterop: true, skipLibCheck: true, outDir: 'dist',
        },
        include: ['src/**/*.ts'],
      }, null, 2) + '\n',
      'workflow.manifest.json': JSON.stringify(manifest, null, 2) + '\n',
      'README.md': [
        `# ${name}`,
        '',
        'Generated from Willow Agent Builder as a hybrid OpenAI Agents SDK package.',
        'Agent and tool calls use SDK-native primitives. Arbitrary visual graph routing cannot be expressed as SDK handoffs without changing semantics, so loops, approvals, branches, and error policies use a generated deterministic orchestrator.',
        ...(manifest.subflows.length ? ['', 'This workflow contains pinned subflows. Pass a `subflow` hook to `runWorkflow`; execution fails closed when the hook is absent. See `workflow.manifest.json` for required workflow IDs and versions.'] : []),
        ...(manifest.requiredHooks.length ? ['', `Required runtime hooks: ${manifest.requiredHooks.map((item) => `\`${item}\``).join(', ')}. Pass them in the \`hooks\` argument to \`runWorkflow\`; generated runners fail closed when a required hook is absent.`] : []),
        ...(secretNames.length ? ['', `Required HTTP tool secrets: ${secretNames.map((item) => `\`${item}\``).join(', ')}. Provide them as process environment variables or pass the final \`secrets\` argument to \`runWorkflow\`.`] : []),
        '',
        '```bash',
        'npm install',
        'npm start -- "your input"',
        '```',
        '',
        'Set `OPENAI_API_KEY` in your shell before running. No credentials are embedded in this package.',
        '',
      ].join('\n'),
    },
  };
}

export function exportPythonSdkPackage(name: string, graph: WorkflowGraph): SdkCodeBundle {
  const workflow = exportPython(name, graph);
  const manifest = sdkBundleManifest(graph, 'openai-agents');
  const secretNames = manifest.requiredSecrets;
  return {
    mode: 'agents-sdk',
    language: 'python',
    entrypoint: 'main.py',
    dependencies: [
      { name: 'openai-agents', version: 'latest', kind: 'runtime' },
    ],
    installCommand: 'python -m pip install .',
    runCommand: 'python main.py "your input"',
    manifest,
    files: {
      'workflow.py': workflow,
      'main.py': [
        'import asyncio',
        'import json',
        'import os',
        'import sys',
        'from workflow import run_workflow',
        '',
        'async def main():',
        '    user_input = " ".join(sys.argv[1:]) or "Hello"',
        `    secret_names = ${pyLiteral(secretNames)}`,
        '    secrets = {name: os.environ[name] for name in secret_names if os.environ.get(name)}',
        '    missing = [name for name in secret_names if name not in secrets]',
        '    if missing: raise RuntimeError("Missing required secret " + ", ".join(missing))',
        '    output = await run_workflow(user_input, secrets=secrets)',
        '    print(output if isinstance(output, str) else json.dumps(output, indent=2))',
        '',
        'if __name__ == "__main__":',
        '    asyncio.run(main())',
        '',
      ].join('\n'),
      'pyproject.toml': [
        '[project]',
        `name = ${JSON.stringify(toVarName(name).replace(/_/g, '-'))}`,
        'version = "0.1.0"',
        `description = ${JSON.stringify(`OpenAI Agents SDK export for ${name}`)}`,
        'requires-python = ">=3.10"',
        'dependencies = ["openai-agents"]',
        '',
      ].join('\n'),
      'workflow.manifest.json': JSON.stringify(manifest, null, 2) + '\n',
      'README.md': [
        `# ${name}`,
        '',
        'Generated from Willow Agent Builder as a hybrid OpenAI Agents SDK package.',
        'Agent and tool calls use SDK-native primitives. Arbitrary visual graph routing cannot be expressed as SDK handoffs without changing semantics, so loops, approvals, branches, and error policies use a generated deterministic orchestrator.',
        ...(manifest.subflows.length ? ['', 'This workflow contains pinned subflows. Pass a `subflow` hook to `run_workflow`; execution fails closed when the hook is absent. See `workflow.manifest.json` for required workflow IDs and versions.'] : []),
        ...(manifest.requiredHooks.length ? ['', `Required runtime hooks: ${manifest.requiredHooks.map((item) => `\`${item === 'fileSearch' ? 'file_search' : item === 'agentTool' ? 'agent_tool' : item}\``).join(', ')}. Pass them in the \`hooks\` dictionary to \`run_workflow\`; generated runners fail closed when a required hook is absent.`] : []),
        ...(secretNames.length ? ['', `Required HTTP tool secrets: ${secretNames.map((item) => `\`${item}\``).join(', ')}. Provide them as process environment variables or pass the \`secrets\` keyword argument to \`run_workflow\`.`] : []),
        '',
        '```bash',
        'python -m pip install .',
        'python main.py "your input"',
        '```',
        '',
        'Set `OPENAI_API_KEY` in your shell before running. No credentials are embedded in this package.',
        '',
      ].join('\n'),
    },
  };
}
