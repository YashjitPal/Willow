# features/agent-builder

The Agents app. A React-Flow canvas where the user drags-and-drops workflow nodes
to build an agent pipeline (start → prompt → choose model → branch → …), previews
it in real time, and publishes it. Powered by the backend at
`services/agent-builder`.

## Files

| Path | Role |
| --- | --- |
| `src/AgentsWorkspace.tsx` | Entry. Agents/Drafts/Templates tablist, the React-Flow canvas, and the open/save UX. |
| `src/AgentBuilder.tsx` | The canvas, the Agent config panel, and the toolbar (5548 lines — see below). |
| `src/canvas-nodes.tsx` | All React-Flow node renderers + the `nodeTypes`/`edgeTypes` registries and the custom connection line. Presentational; the only outside state it reads is `evaluationGraderCounts` (for the grader badge on agent nodes). |
| `src/workflow-graph.ts` | The starter graph (`initialNodes`/`initialEdges`) plus the pure naming helpers that keep node namespaces and duplicated ids unique. Closure-free. |
| `src/agent-node-schema.ts` | Model metadata (`APIModel`, `formatModelName`), the Agent node's error policy, and the builder that turns the Simple/Advanced schema editor into a validated JSON Schema. Closure-free. |
| `src/StartConfigPanel.tsx` | Config editor for the Start node: the workflow's input and state variable declarations. |
| `src/GuardrailConfigPanel.tsx` | Config editor for the Guardrail node: the four checks (PII, moderation, jailbreak, hallucination) and their per-check settings. |
| `src/InstructionsModal.tsx` | Full-screen editor for an Agent node's instructions. Portalled to `document.body` so the canvas transform cannot clip it. |
| `src/TemplatePicker.tsx` | Template catalog overlay for starting a workflow from a preset. |
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

`AgentBuilder.tsx` is 5548 lines (was 6916: the node renderers moved to
`canvas-nodes.tsx`, then the graph helpers, schema types, and four self-contained
panels moved to the modules listed above). What remains: the React-Flow setup,
the toolbar, validation, the docking panels, and one very large config panel —
`AgentConfigPanel` (~3450 lines, lines 147–3617).

`AgentConfigPanel` is deliberately still here. Unlike the panels that were
extracted, it is not a leaf: it closes over the node-update callbacks and backend
hook state, so pulling it out means designing a props contract rather than moving
a block of text. Do that as its own change, not as a side effect of something else.

When extracting from this file, two rules have already caught real bugs:

- **Never move a `motion.div` that is a direct child of `AnimatePresence`.**
  Putting a component boundary where Framer Motion tracks presence silently kills
  the exit animation, and `tsc` will not tell you. Moving an entire
  `AnimatePresence` tree as one unit is fine, and so is moving a component whose
  render site is *already* a boundary (that is why `StartConfigPanel` and
  `GuardrailConfigPanel` were safe).
- **This package is CRLF.** New modules must be written with `\r\n` or the diff
  becomes unreviewable.

Everything in `AgentBuilder.tsx` is reached through three exports —
`AgentBuilder` (the provider wrapper), `AgentBuilderContent`, and
`AgentBuilderFlow`. Nothing else in the file is imported elsewhere, so
extractions here are internal-only and cannot break other features.

Note that `apps/studio/test/agent-builder-overlays.smoke.test.mjs` asserts
against **source text** for invariants that never reach the DOM (clamp bounds,
lock ordering). Those assertions are keyed to file paths, so moving markup
between files means re-pointing the matching assertion at the new module.

## Node types

`start agent end note fileSearch guardrail mcp ifElse while userApproval transform setState`.

All defined in `canvas-nodes.tsx`. To add a node type you must touch two places:
the renderer + the `nodeTypes` registry there, and the config UI in
`NodeConfigPanel.tsx`.

Branch edges: ifElse `<branchId>`/`else`, guardrail `pass`/`fail`, userApproval
`approved`/`rejected`, while `loop`/`done`.
