# features/agent-builder

The Agents app. A React-Flow canvas where the user drags-and-drops workflow nodes
to build an agent pipeline (start → prompt → choose model → branch → …), previews
it in real time, and publishes it. Powered by the backend at
`services/agent-builder`.

## Files

| Path | Role |
| --- | --- |
| `src/AgentsWorkspace.tsx` | Entry. Agents/Drafts/Templates tablist, the React-Flow canvas, and the open/save UX. |
| `src/AgentBuilder.tsx` | The canvas, config panels, and toolbar (6357 lines — see below). |
| `src/canvas-nodes.tsx` | All React-Flow node renderers + the `nodeTypes`/`edgeTypes` registries and the custom connection line. Presentational; the only outside state it reads is `evaluationGraderCounts` (for the grader badge on agent nodes). |
| `src/agent-builder-store.ts` | Nanostore. Draft state, workflow name, model/output-format/instructions. Also holds draft flush logic. |
| `src/agent-builder.ts` | Client shim. `getAgentBuilderClient(apiKeys)` forwards user keys via `x-provider-keys`. |
| `src/use-agent-builder-backend.ts` | Integration hook (1248 lines). Autosave → load, run + SSE streaming, publish, code export, approvals. The bridge between the canvas (React-Flow JSON) and the server (pipeline DAG). |
| `src/RunPanel.tsx` | Live run preview + approve/reject controls. |
| `src/NodeConfigPanel.tsx` | Config UI per node type (start, end, note, file-search, MCP, if/else, while, …). |
| `src/CodeExportModal.tsx` | Exports the workflow as TS or Python Agents-SDK code. |
| `src/EvaluationPanel.tsx` | Evaluation run comparison panel (1205 lines). |
| `src/BatchRunPanel.tsx` | Run a single workflow against many inputs. |
| `src/ChatPreviewPanel.tsx` | ChatKit-style test-chat surface. |
| `src/PublishWorkflowModal.tsx` · `src/WorkflowSecretsPanel.tsx` · `src/DeploymentSecretsSection.tsx` | Publish + secrets. |
| `src/VersionHistoryPanel.tsx` · `src/RunHistoryPanel.tsx` | History browsers. |
| `src/ChatKitDeployPanel.tsx` · `src/CollaborationPanel.tsx` | Deploy + sharing. |
| `src/VariablePicker.tsx` | Variable-picker widget for `{{...}}` templating. |
| `src/evaluation-inspection.ts` | Internalisation-level scoring for evaluation runs. |
| `src/usage-display.ts` | Token count / cost estimation panel. |

## The backend

The feature talks to `services/agent-builder` via the client at `@agentbuilder`
(aliased to `services/agent-builder/client/index.ts`). In dev, the backend is
mounted as Vite middleware on the same origin (`/api/v1/*`). The frontend client
defaults to same-origin; set `VITE_AGENT_BUILDER_URL` to point at a standalone
backend instead. Backend down → the UI shows "Backend offline".

## The big one

`AgentBuilder.tsx` is still 6357 lines (was 6916; the node renderers moved to
`canvas-nodes.tsx`). What remains: the React-Flow setup, the toolbar, validation,
the docking panels, and two very large config panels — `AgentConfigPanel`
(~3450 lines, lines 437–3883) and `StartConfigPanel` (~225 lines). Those two are
the next extraction candidates, but they are not leaves: they close over the
node-update callbacks and backend hook state, so pulling them out means defining
a props contract rather than moving a block of text.

Everything in `AgentBuilder.tsx` is reached through three exports —
`AgentBuilder` (the provider wrapper), `AgentBuilderContent`, and
`AgentBuilderFlow`. Nothing else in the file is imported elsewhere, so
extractions here are internal-only and cannot break other features.

## Node types

`start agent end note fileSearch guardrail mcp ifElse while userApproval transform setState`.

All defined in `canvas-nodes.tsx`. To add a node type you must touch two places:
the renderer + the `nodeTypes` registry there, and the config UI in
`NodeConfigPanel.tsx`.

Branch edges: ifElse `<branchId>`/`else`, guardrail `pass`/`fail`, userApproval
`approved`/`rejected`, while `loop`/`done`.
