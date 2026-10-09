import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { cn } from "~/lib/utils";
import { CodexIcon, type CodexIconName } from "../../willow/activity";
import { harnessLabel, useWillowScope } from "../../willow/harness";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

/**
 * A pending approval as the Codex app asks it (ApprovalRequest's ApprovalCard): what is asking
 * ("Terminal", "Edit files"), the question, then the request itself in a code block.
 */
export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const scope = useWillowScope();
  const agent = scope ? harnessLabel(scope) : "the agent";
  const Detail = approval.requestKind === "mcp-elicitation" ? "span" : "code";
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access approval"
      : approval.requestKind === "command"
        ? "Command approval"
        : approval.requestKind === "file-read"
          ? "File read approval"
          : approval.requestKind === "permission"
            ? "App permission approval"
            : "File change approval";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access request"
      : approval.requestKind === "command"
        ? "Command"
        : approval.requestKind === "file-read"
          ? "File to read"
          : approval.requestKind === "permission"
            ? "Permission request"
            : "File change";
  const header: { icon: CodexIconName; label: string } =
    approval.requestKind === "command"
      ? { icon: "terminal", label: "Terminal" }
      : approval.requestKind === "file-read"
        ? { icon: "book-open", label: "Read files" }
        : approval.requestKind === "mcp-elicitation" || approval.requestKind === "permission"
          ? { icon: "mcp", label: approval.appName ?? "Connector" }
          : { icon: "pencil", label: "Edit files" };
  const question =
    approval.requestKind === "command"
      ? `Do you want ${agent} to run this command?`
      : approval.requestKind === "file-read"
        ? `Allow ${agent} to read this file?`
        : approval.requestKind === "mcp-elicitation" || approval.requestKind === "permission"
          ? `Allow ${approval.appName ?? agent} to continue?`
          : `Allow ${agent} to edit these files?`;

  return (
    <span
      aria-label={fallbackLabel}
      className={cn("willow-approval", className)}
      role="group"
      data-willow-approval={approval.requestKind}
    >
      <span className="willow-approval__header">
        <CodexIcon name={header.icon} className="willow-approval__icon" />
        <span className="min-w-0 truncate">{header.label}</span>
        {pendingCount > 1 ? (
          <span className="willow-approval__count">1/{pendingCount}</span>
        ) : null}
      </span>
      <span className="willow-approval__question">{question}</span>
      <Detail
        aria-label={detailAriaLabel}
        className={cn(
          "willow-approval__detail",
          approval.requestKind === "mcp-elicitation"
            ? "whitespace-pre-wrap font-sans wrap-break-word"
            : "whitespace-pre-wrap font-mono break-words",
        )}
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.responseCapability === "not_resumable"
          ? "Provider process is gone — interrupt or restart the run to respond."
          : approval.detail || fallbackLabel}
      </Detail>
    </span>
  );
});
