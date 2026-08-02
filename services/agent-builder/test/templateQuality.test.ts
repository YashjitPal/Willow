import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import ts from 'typescript';
import { exportPython, exportTypeScript } from '../src/codegen/index.ts';
import { normalizeGraph } from '../src/domain/normalize.ts';
import { validateGraph } from '../src/domain/validate.ts';
import { analyzeTemplateRisk, templateRiskLevel, WORKFLOW_TEMPLATES } from '../src/services/templates.ts';
import { makeApp, waitForRun, type App } from './helpers.ts';

let app: App;
let cleanup: () => Promise<void>;

before(async () => {
  ({ app, cleanup } = await makeApp());
});

after(async () => {
  await cleanup();
});

describe('bundled workflow template quality', () => {
  for (const template of WORKFLOW_TEMPLATES) {
    it(`${template.id} validates, exports, and executes representative paths`, async () => {
      assert.ok(template.verification.cases.length > 0, 'template needs at least one verification case');
      const graph = normalizeGraph(template.graph).graph;
      const validation = validateGraph(graph);
      assert.equal(validation.valid, true, JSON.stringify(validation.errors));
      const riskFactors = analyzeTemplateRisk(template.graph);
      assert.ok(riskFactors.length > 0, 'template risk needs a graph-derived explanation');
      assert.equal(templateRiskLevel(template.graph), template.riskLevel, 'declared risk level must match the graph capabilities');
      for (const factor of riskFactors) assert.ok(graph.nodes.some((node) => node.id === factor.nodeId), `risk factor references missing node ${factor.nodeId}`);

      const tsCode = exportTypeScript(template.name, graph);
      const transpiled = ts.transpileModule(tsCode, {
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      assert.deepEqual(transpiled.diagnostics ?? [], []);

      const pyCode = exportPython(template.name, graph);
      const python = spawnSync('python', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: pyCode, encoding: 'utf8' });
      if (!python.error || (python.error as NodeJS.ErrnoException).code !== 'ENOENT') assert.equal(python.status, 0, python.stderr);

      const created = await app.workflows.createFromTemplate({ templateId: template.id });
      assert.ok(created);
      if (template.id === 'retrieval-qa') {
        const store = await app.vectorStores.createStore('Template knowledge', undefined);
        const file = await app.vectorStores.enqueueFile(store.id, 'knowledge.txt', 'The template knowledge question is answered by this grounded source.', undefined);
        for (let attempt = 0; attempt < 100; attempt++) {
          const current = await app.vectorStores.getFile(store.id, file.id);
          if (current?.status === 'ready') break;
          if (current?.status === 'error') throw new Error(current.error);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const graph = structuredClone(created!.workflow.draft);
        const search = graph.nodes.find((node) => node.id === 'search');
        assert.ok(search);
        search!.config = { ...search!.config, vectorStoreIds: [store.id] };
        const saved = await app.workflows.saveDraft(created!.workflow.id, graph, created!.workflow.draftRevision);
        assert.ok(saved?.validation.valid, JSON.stringify(saved?.validation.errors));
      }
      for (const verification of template.verification.cases) {
        const started = await app.engine.createRun({ workflowId: created!.workflow.id, input: verification.input });
        if (verification.approval !== undefined) {
          const paused = await waitForRun(app, started.id, ['awaiting_approval', 'failed']);
          assert.equal(paused.status, 'awaiting_approval', paused.error);
          assert.ok(paused.pendingApproval);
          await app.engine.resolveApproval(started.id, paused.pendingApproval!.id, { approved: verification.approval });
        }
        const completed = await waitForRun(app, started.id, ['completed', 'failed', 'cancelled']);
        assert.equal(completed.status, verification.expectedStatus, `${verification.name}: ${completed.error ?? ''}`);
        const outputText = typeof completed.output === 'string'
          ? completed.output
          : JSON.stringify(completed.output);
        assert.match(outputText, new RegExp(verification.expectedOutputContains, 'i'));
        const spans = await app.engine.traceSpans(started.id);
        const visited = new Set((spans ?? []).filter((span) => span.type === 'node').map((span) => span.nodeId));
        for (const nodeId of verification.expectedNodeIds) assert.ok(visited.has(nodeId), `${verification.name}: missing node span ${nodeId}`);
      }

      const published = await app.workflows.publish(created!.workflow.id, 'Bundled template quality gate');
      assert.ok(published);
      assert.equal(published!.validation.valid, true, JSON.stringify(published!.validation.errors));
      const deployment = await app.deployments.create({
        workflowId: created!.workflow.id,
        ownerId: created!.workflow.ownerId,
        workspaceId: created!.workflow.workspaceId,
        name: `${template.name} verification`,
        environment: `template-${template.id}`,
        activeVersion: published!.version.version,
        status: 'active',
        allowedOrigins: [],
        sessionRateLimitPerMinute: 10,
        maxActiveSessions: 10,
        maxTokensPerDay: 1_000_000,
      });
      const reservation = await app.deployments.runReservation(deployment.id, published!.version.version);
      assert.ok(reservation.tokens > 0, `${template.id} should reserve a finite positive token bound`);
      assert.ok(reservation.tokens <= 1_000_000);
    });
  }
});
