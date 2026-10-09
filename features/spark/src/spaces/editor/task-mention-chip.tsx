import { useState, type KeyboardEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import { ExclamationMarkTriangleLight16Icon, OpenLinkLight16Icon, PauseCircleLight16Icon, PlayCircleLight16Icon } from "../../codex/icons";
import { Button, InlineMention, Tooltip } from "../../codex/ui";
import { DotAvatar } from "../willow/dot/character";
import { dotName, useResolvedDot } from "../willow/dot/dot-identity";
import { mentionMessages } from "./messages";
import { SelectionToolbarFrame } from "./selection-toolbar";
import type { PageTaskMention } from "./state/page-document";

/** `$w` (label chunk): "@{dot name}" for a request to one of your bots, "@Willow" for Willow's tasks. */
function TaskMentionLabel({ mention }: { mention: PageTaskMention; viewer: string }) {
  const dot = useResolvedDot(mention.orbit?.threadId);
  if (mention.orbit != null) return <>@{dot == null ? "bot" : dotName(dot)}</>;
  return <FormattedMessage {...mentionMessages.selfLabel} />;
}

/** `SF`: pause/resume and "Open task" for a started ChatGPT task. */
function TaskMentionToolbar({ disabled, onOpen }: { disabled: boolean; onOpen: () => void }) {
  const intl = useIntl();
  const [active, setActive] = useState(true);
  const label = intl.formatMessage(active ? mentionMessages.stop : mentionMessages.start);
  return (
    <SelectionToolbarFrame>
      <Tooltip tooltipContent={label}>
        <Button color="ghostActive" size="toolbar" uniform disabled={disabled} aria-label={label} onClick={() => setActive((value) => !value)}>
          {active ? <PauseCircleLight16Icon /> : <PlayCircleLight16Icon />}
        </Button>
      </Tooltip>
      <Button color="ghostActive" size="toolbar" onClick={onOpen}>
        <OpenLinkLight16Icon />
        <FormattedMessage {...mentionMessages.open} />
      </Button>
    </SelectionToolbarFrame>
  );
}

function activateOnKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.currentTarget.click();
}

interface TaskMentionChipProps {
  mention: PageTaskMention;
  viewer: string;
  resolved?: boolean;
  onCompose: (mentionId: string) => void;
}

/** `JF1`: the chip inside a `data-page-task-mention` atom, with the retry action after a failed send. */
export function TaskMentionChip({ mention, viewer, resolved = false, onCompose }: TaskMentionChipProps) {
  const intl = useIntl();
  const navigate = useNavigate();
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const busy = mention.status === "pending";
  const failed = mention.status === "failed";
  const hiddenOrbit = resolved && mention.orbit != null;
  const threadId = mention.threadId ?? (hiddenOrbit ? (mention.orbit?.threadId ?? null) : null);
  const retryLabel =
    mention.orbit != null
      ? intl.formatMessage(mentionMessages.dotSendRetryPrivateProductName, { dot: "bot" })
      : threadId == null
        ? intl.formatMessage(mentionMessages.retry)
        : intl.formatMessage(mentionMessages.checkTask);
  const openDot = () => {
    if (mention.orbit != null) void navigate(`/dots/${mention.orbit.threadId}`);
  };
  const activate = () => {
    if (threadId == null && mention.orbit == null) {
      if (!busy) onCompose(mention.id);
    } else if (mention.orbit == null) setToolbarOpen(true);
    else if (mention.status === "composing" || failed) onCompose(mention.id);
    else openDot();
  };
  const chip = (
    <InlineMention
      tone="neutral"
      icon={mention.orbit == null ? undefined : <DotAvatar identity={mention.orbit.threadId} animated={false} />}
      interactive
      role="button"
      aria-disabled={busy}
      tabIndex={0}
      onClick={activate}
      onKeyDown={activateOnKey}
    >
      <TaskMentionLabel mention={mention} viewer={viewer} />
    </InlineMention>
  );
  return (
    <>
      {threadId == null || mention.orbit != null ? (
        chip
      ) : (
        <Tooltip
          align="start"
          cloneCustomTrigger
          interactive
          keyboardNavigation
          open={toolbarOpen}
          onOpenChange={setToolbarOpen}
          side="top"
          sideOffset={8}
          variant="unstyled"
          tooltipContent={
            <span data-page-comment-thread-id={mention.commentThreadId}>
              <TaskMentionToolbar disabled={busy} onOpen={() => setToolbarOpen(false)} />
            </span>
          }
        >
          {chip}
        </Tooltip>
      )}
      {failed && !busy && !hiddenOrbit ? (
        <Tooltip tooltipContent={retryLabel}>
          <Button color="ghost" size="inline" uniform aria-label={retryLabel} onClick={() => onCompose(mention.id)}>
            <ExclamationMarkTriangleLight16Icon />
          </Button>
        </Tooltip>
      ) : null}
    </>
  );
}
