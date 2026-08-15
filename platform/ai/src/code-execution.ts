// The code-execution tool's output, carried from the provider stream to the
// chat turn that renders it. Kept beside the other provider-shaped chat types
// rather than inside the chat feature, because the streaming layer is what
// produces it and both halves need the same shape.

/**
 * One code-execution round: the program the model ran and what the sandbox
 * printed. The two arrive as *separate* stream parts (`executableCode`, then
 * `codeExecutionResult`), so a block exists with no `output` for the window
 * between them — which is exactly the state the panel renders while running.
 */
export interface CodeExecution {
  /** Language as the provider reported it, e.g. `PYTHON`. */
  language: string;
  code: string;
  /** stdout/stderr from the sandbox. Absent until the result part arrives. */
  output?: string;
  /** Provider outcome, e.g. `OUTCOME_OK` / `OUTCOME_FAILED`. */
  outcome?: string;
  /**
   * Offset into the turn's answer text at the moment this block was emitted.
   *
   * Indexed the same way citations are, and for the same reason: the model can
   * emit prose, run code, then keep writing, and the panel has to land where it
   * happened rather than being bolted to the end. A turn whose code ran before
   * any prose gets 0.
   */
  position: number;
}

/** Whether the sandbox reported a failure, for the panels that show it. */
export const codeExecutionFailed = (execution: Pick<CodeExecution, 'outcome'>): boolean =>
  typeof execution.outcome === 'string'
  && execution.outcome.length > 0
  && !/ok/i.test(execution.outcome);
