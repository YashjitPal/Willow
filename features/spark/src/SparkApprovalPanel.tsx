import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import type { NativeApprovalDecision } from './harness/native/native-approvals';
import { resolveSparkApproval, sparkPendingApprovals, sparkTaskProject } from './spark-projects';
import './SparkQuestionPanel.css';
import './SparkApprovalPanel.css';

/**
 * A command or an edit waiting for the user's approval, in the desktop app.
 *
 * It takes the composer's place, as a pending question does (`SparkQuestionPanel`),
 * and offers Codex's choices in Codex's words: proceed once, proceed and stop
 * asking for commands that start with the same prefix, allow everything for the
 * rest of the task, or decline. Declining tells the model "exec command rejected
 * by user", which it is told not to work around.
 *
 * Enter proceeds once and Escape declines, as in the Codex CLI.
 */
export function SparkApprovalPanel({ taskId }: { taskId: string }): React.ReactElement | null {
  const pending = useStore(sparkPendingApprovals)[taskId]?.[0];

  useEffect(() => {
    if (!pending) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        resolveSparkApproval(taskId, pending.id, 'deny');
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        resolveSparkApproval(taskId, pending.id, 'once');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, taskId]);

  if (!pending) return null;
  const { request } = pending;
  const decide = (decision: NativeApprovalDecision) => resolveSparkApproval(taskId, pending.id, decision);
  const project = sparkTaskProject(taskId);
  const where = request.cwd && project && request.cwd.toLowerCase().startsWith(project.path.toLowerCase())
    ? `${project.name}${request.cwd.slice(project.path.replace(/[\\/]+$/, '').length)}`
    : request.cwd;
  const isCommand = request.kind === 'command';
  const prefix = request.prefixRule?.join(' ');

  const options: { decision: NativeApprovalDecision; label: React.ReactNode; hint?: string }[] = [
    { decision: 'once', label: 'Yes, proceed', hint: 'Enter' },
    ...(isCommand && prefix
      ? [{ decision: 'prefix' as const, label: <>Yes, and don&rsquo;t ask again for commands that start with <code className="spark-approval__inline-code">{prefix}</code></> }]
      : []),
    { decision: 'task', label: 'Yes, and allow everything for this task' },
    { decision: 'deny', label: isCommand ? 'No, don\u2019t run it' : 'No, don\u2019t make these edits', hint: 'Esc' },
  ];

  return (
    <div className="spark-question spark-approval" role="group" aria-label={isCommand ? 'Approve command' : 'Approve edits'}>
      <div className="spark-question__head">
        <span className="spark-question__header">{isCommand ? 'Run this command?' : 'Edit files outside this folder?'}</span>
      </div>
      <div className="spark-question__body">
        {request.justification && <p className="spark-question__prompt">{request.justification}</p>}
        {isCommand ? (
          <pre className="spark-approval__command"><code>{request.command}</code></pre>
        ) : (
          <ul className="spark-approval__paths">
            {(request.paths ?? []).map((path) => <li key={path}><code>{path}</code></li>)}
          </ul>
        )}
        {isCommand && where && <span className="spark-approval__where">in {where}</span>}
        <div className="spark-question__options">
          {options.map((option, index) => (
            <button
              key={option.decision}
              type="button"
              className={`spark-question__option spark-approval__option${index === 0 ? ' spark-question__option--selected' : ''}`}
              onClick={() => decide(option.decision)}
            >
              <span className="spark-question__option-label">{option.label}</span>
              {option.hint && <span className="spark-approval__hint" aria-hidden="true">{option.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SparkApprovalPanel;
