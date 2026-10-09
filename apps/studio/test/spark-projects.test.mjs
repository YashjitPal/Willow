/**
 * Spark's folders and approvals in the desktop app: which folder a task works in,
 * what it may do without asking, and the approvals waiting on the user.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
});

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const load = () => importTs(path.join(repoRoot, 'features', 'spark', 'src', 'spark-projects.ts'));
const projects = await load();

it('adds a folder once per path, and files composer tasks under the active one', () => {
  const site = projects.addSparkProject('C:\\Users\\me\\Projects\\site');
  assert.equal(site.name, 'site');
  assert.equal(projects.addSparkProject('c:/users/me/projects/site/').id, site.id);

  assert.equal(projects.claimSparkTaskProject('task-global'), null);
  projects.setSparkActiveProject(site.id);
  assert.equal(projects.claimSparkTaskProject('task-site').id, site.id);
  assert.equal(projects.sparkTaskProject('task-site').path, 'C:\\Users\\me\\Projects\\site');
  assert.equal(projects.sparkTaskProject('task-global'), null);
  projects.setSparkActiveProject(null);
});

it('asks by default, follows the folder default, and lets a task choose for itself', () => {
  const docs = projects.addSparkProject('D:\\docs');
  projects.setSparkActiveProject(docs.id);
  projects.claimSparkTaskProject('task-docs');
  projects.setSparkActiveProject(null);

  assert.equal(projects.sparkTaskApprovalMode('task-docs'), 'ask');
  projects.setSparkProjectFullAccess(docs.id, true);
  assert.equal(projects.sparkTaskApprovalMode('task-docs'), 'full');
  projects.setSparkTaskApprovalMode('task-docs', 'ask');
  assert.equal(projects.sparkTaskApprovalMode('task-docs'), 'ask');
  assert.equal(projects.sparkTaskApprovalMode('task-elsewhere'), 'ask');
});

it('keeps approved prefixes with the folder, or once for tasks with no folder', () => {
  const inSite = projects.createSparkTaskApprovals('task-site');
  inSite.addRule(['npm', 'test']);
  inSite.addRule(['NPM', 'Test']);
  assert.deepEqual(inSite.rules(), [['npm', 'test']]);

  const global = projects.createSparkTaskApprovals('task-global');
  assert.deepEqual(global.rules(), []);
  global.addRule(['git', 'status']);
  assert.deepEqual(projects.createSparkTaskApprovals('another-global-task').rules(), [['git', 'status']]);

  global.allowAll();
  assert.equal(global.mode(), 'full');
});

it('queues approval requests per task and resolves them with the user\'s decision', async () => {
  const approvals = projects.createSparkTaskApprovals('task-queue');
  const first = approvals.request({ kind: 'command', command: 'npm install', cwd: 'C:\\x' });
  const second = approvals.request({ kind: 'patch', paths: ['C:\\y\\a.txt'] });
  const pending = projects.sparkPendingApprovals.get()['task-queue'];
  assert.deepEqual(pending.map((entry) => entry.request.kind), ['command', 'patch']);

  projects.resolveSparkApproval('task-queue', pending[0].id, 'prefix');
  assert.equal(await first, 'prefix');
  assert.deepEqual(projects.sparkPendingApprovals.get()['task-queue'].map((entry) => entry.request.kind), ['patch']);

  projects.resolveSparkApproval('task-queue', pending[1].id, 'deny');
  assert.equal(await second, 'deny');
  assert.equal(projects.sparkPendingApprovals.get()['task-queue'], undefined);
});

it('lets through the commands still waiting when the user allows everything, or a prefix', async () => {
  const approvals = projects.createSparkTaskApprovals('task-release');
  const first = approvals.request({ kind: 'command', command: 'npm test' });
  const second = approvals.request({ kind: 'command', command: 'npm test -- --watch=false' });
  const third = approvals.request({ kind: 'command', command: 'git push' });
  const [entry] = projects.sparkPendingApprovals.get()['task-release'];

  projects.resolveSparkApproval('task-release', entry.id, 'prefix');
  assert.equal(await first, 'prefix');
  approvals.addRule(['npm', 'test']);
  assert.equal(await second, 'once', 'the approved prefix covers the second command');
  assert.deepEqual(projects.sparkPendingApprovals.get()['task-release'].map((pending) => pending.request.command), ['git push']);

  approvals.allowAll();
  assert.equal(await third, 'once');
  assert.equal(projects.sparkPendingApprovals.get()['task-release'], undefined);
});

it('declines a waiting approval when the turn is stopped', async () => {
  const controller = new AbortController();
  const decision = projects.createSparkTaskApprovals('task-stop').request({ kind: 'command', command: 'npm run build' }, controller.signal);
  assert.equal(projects.sparkPendingApprovals.get()['task-stop'].length, 1);
  controller.abort();
  assert.equal(await decision, 'deny');
  assert.equal(projects.sparkPendingApprovals.get()['task-stop'], undefined);
});

it('remembers folders across reloads, and forgets a removed folder\'s tasks', async () => {
  const reloaded = await load();
  reloaded.ensureSparkProjectsLoaded();
  await Promise.resolve();
  assert.deepEqual(reloaded.sparkProjects.get().projects.map((project) => project.name), ['site', 'docs']);
  assert.equal(reloaded.sparkTaskProject('task-site').name, 'site');
  assert.deepEqual(reloaded.createSparkTaskApprovals('task-site').rules(), [['npm', 'test']]);

  const site = reloaded.sparkTaskProject('task-site');
  reloaded.removeSparkProject(site.id);
  assert.equal(reloaded.sparkTaskProject('task-site'), null);
});
