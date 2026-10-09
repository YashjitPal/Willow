import {
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListTodoIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { memo, useState, type ComponentProps } from "react";

import { formatDuration } from "../../session-logic";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";

export interface ComposerTasksProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface ComposerTaskStep {
  readonly durationMs?: number;
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

const MAX_TASK_SEGMENTS = 10;

const taskStatusLabels = {
  pending: "Pending",
  inProgress: "Running",
  completed: "Completed",
} satisfies Record<ComposerTaskStep["status"], string>;

function keyedTaskSteps(steps: readonly ComposerTaskStep[]) {
  const occurrences = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = occurrences.get(step.step) ?? 0;
    occurrences.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

function TaskSegments({
  className,
  steps,
}: {
  readonly className?: string;
  readonly steps: readonly ComposerTaskStep[];
}) {
  if (steps.length <= 1 || steps.length > MAX_TASK_SEGMENTS) return null;

  return (
    <span aria-hidden className={cn("flex w-10 shrink-0 items-center gap-0.5", className)}>
      {keyedTaskSteps(steps).map(({ key, step }) => (
        <span
          key={key}
          className={cn(
            "h-[3px] min-w-0 flex-1 rounded-full",
            step.status === "completed"
              ? "bg-success"
              : step.status === "inProgress"
                ? "bg-primary"
                : "bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}

function TaskSummary({
  expanded,
  progress,
  steps,
}: {
  readonly expanded: boolean;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  return (
    <>
      <ComposerBanner.Icon>
        <ListTodoIcon />
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span className="shrink-0 text-muted-foreground">Tasks</span>
        <span
          className="min-w-0 flex-1 truncate text-left font-medium text-foreground/80"
          data-composer-task-current="true"
        >
          {progress.step}
        </span>
      </ComposerBanner.Content>
      <ComposerBanner.Actions>
        <ComposerBanner.Count
          className={progress.completedSteps >= progress.totalSteps ? "text-success" : undefined}
          data-composer-task-progress="true"
        >
          {progress.completedSteps}/{progress.totalSteps}
        </ComposerBanner.Count>
        <TaskSegments className="hidden w-20 @min-[560px]:flex" steps={steps} />
        <ComposerBanner.ToggleIcon expanded={expanded} />
      </ComposerBanner.Actions>
    </>
  );
}

export const ComposerTasksBadge = memo(function ComposerTasksBadge({
  expanded,
  onToggle,
  placement = "tab",
  progress,
  steps,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly placement?: "inline" | "tab";
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  if (progress.totalSteps <= 0) return null;

  const row = (
    <ComposerBanner.Row
      render={<button type="button" />}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse tasks" : "Tasks"}: ${progress.completedSteps} of ${progress.totalSteps} complete. Current task: ${progress.step}`}
      data-composer-tasks-badge="true"
      onClick={onToggle}
      onPointerDown={(event) => event.preventDefault()}
    >
      <TaskSummary expanded={expanded} progress={progress} steps={steps} />
    </ComposerBanner.Row>
  );
  return placement === "inline" ? (
    row
  ) : (
    <ComposerBanner.Root density="comfortable" data-composer-shoulder-tab>
      {row}
    </ComposerBanner.Root>
  );
});

/** Codex's plan donut (TodoListItem ProgressDonut): a 14px ring, its track at 22%. */
function ProgressDonut({
  percent,
  size = 14,
}: {
  readonly percent: number;
  readonly size?: number;
}) {
  const radius = (size - 2.5) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg
      aria-hidden
      className="shrink-0 -rotate-90"
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={2.5}
      />
      <circle
        className="transition-[stroke-dashoffset] duration-500 ease-out"
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        strokeLinecap="round"
        strokeWidth={2.5}
      />
    </svg>
  );
}

/**
 * Codex's in-progress plan pill (its todo-plan pill, centred over the composer): the donut and
 * "Step N / M" in the secondary ink, brightening while pointed at; pointing at it or focusing it
 * opens every step in a card above.
 */
export const ComposerPlanPill = memo(function ComposerPlanPill({
  progress,
  steps,
}: {
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  const [open, setOpen] = useState(false);
  const total = steps.length > 0 ? steps.length : progress.totalSteps;
  const done =
    steps.length > 0
      ? steps.filter((step) => step.status === "completed").length
      : progress.completedSteps;
  const running = steps.findIndex((step) => step.status === "inProgress");
  const firstOpen = steps.findIndex((step) => step.status !== "completed");
  const current = (running >= 0 ? running : firstOpen >= 0 ? firstOpen : total - 1) + 1;

  return (
    <div
      className="relative"
      data-composer-plan-pill="true"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Step ${current} of ${total}. Current task: ${progress.step}`}
        className="-my-1.5 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-1.5 text-[13px] leading-[18px] text-(--codex-ink-secondary) transition-colors hover:text-(--codex-ink) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--codex-border-heavy)"
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onPointerDown={(event) => event.preventDefault()}
      >
        <span className="text-(--willow-settings-primary)">
          <ProgressDonut percent={total > 0 ? (done / total) * 100 : 0} />
        </span>
        <span className="tabular-nums">
          Step {current} / {total}
        </span>
      </button>
      {open ? (
        <ul
          aria-label={`Task list. ${done} of ${total} complete.`}
          className="absolute bottom-full left-1/2 z-30 mb-2 flex max-h-72 w-max max-w-80 -translate-x-1/2 flex-col gap-2 overflow-y-auto rounded-[20px] border border-(--willow-menu-border) bg-(--willow-menu-surface) p-3 shadow-(--willow-menu-shadow)"
          role="list"
        >
          {keyedTaskSteps(steps).map(({ key, step }) => (
            <li key={key} className="flex max-w-72 min-w-0 items-start gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                {step.status === "completed" ? (
                  <CircleCheckIcon className="text-(--willow-muted-text)" />
                ) : step.status === "inProgress" ? (
                  <LoaderCircleIcon className="animate-spin text-(--willow-menu-text)" />
                ) : (
                  <CircleIcon className="text-(--willow-menu-text)" />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 text-[13px] leading-4 break-words",
                  step.status === "completed"
                    ? "text-(--willow-muted-text)"
                    : "text-(--willow-menu-text)",
                )}
              >
                <span className="sr-only">{taskStatusLabels[step.status]}: </span>
                {step.step}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

export const ComposerTasksContent = memo(function ComposerTasksContent({
  expanded,
  onToggle,
  progress,
  steps,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  return (
    <div
      data-chat-composer-collapsed-controls="true"
      data-chat-composer-tasks-drawer={expanded ? "true" : undefined}
    >
      <ComposerTasksBadge
        expanded={expanded}
        onToggle={onToggle}
        placement="inline"
        progress={progress}
        steps={steps}
      />
      {expanded ? (
        <ComposerBanner.Scroll data-composer-tasks-scroll="true">
          <ComposerBanner.Children
            render={<ul role="list" />}
            aria-label={`Task list. ${progress.completedSteps} of ${progress.totalSteps} complete.`}
            data-composer-tasks-list="true"
          >
            {keyedTaskSteps(steps).map(({ key, step }) => (
              <ComposerBanner.Row key={key} render={<li />} className="items-start py-1 pe-2">
                <ComposerBanner.Icon
                  className={cn(
                    "h-4",
                    step.status === "completed"
                      ? "text-success"
                      : step.status === "inProgress"
                        ? "text-primary"
                        : "text-muted-foreground/40",
                  )}
                >
                  {step.status === "completed" ? (
                    <CheckIcon />
                  ) : step.status === "inProgress" ? (
                    <CircleDotIcon />
                  ) : (
                    <CircleIcon />
                  )}
                </ComposerBanner.Icon>
                <ComposerBanner.Content
                  className={cn(
                    "block wrap-anywhere",
                    step.status === "completed"
                      ? "text-muted-foreground/55"
                      : step.status === "inProgress"
                        ? "text-foreground/90"
                        : "text-muted-foreground/70",
                  )}
                >
                  <span className="sr-only">{taskStatusLabels[step.status]}: </span>
                  {step.step}
                </ComposerBanner.Content>
                <ComposerBanner.Actions>
                  <span
                    className="w-12 text-right text-3xs/4 text-muted-foreground/45 tabular-nums"
                    data-composer-task-duration="true"
                  >
                    {step.durationMs !== undefined
                      ? formatDuration(step.durationMs)
                      : step.status === "inProgress"
                        ? "now"
                        : null}
                  </span>
                </ComposerBanner.Actions>
              </ComposerBanner.Row>
            ))}
          </ComposerBanner.Children>
        </ComposerBanner.Scroll>
      ) : null}
    </div>
  );
});

export const ComposerTasksDrawer = memo(function ComposerTasksDrawer({
  onCollapse,
  ...props
}: Omit<ComponentProps<typeof ComposerTasksContent>, "expanded" | "onToggle"> & {
  readonly onCollapse: () => void;
}) {
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root>
        <ComposerTasksContent {...props} expanded onToggle={onCollapse} />
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
});
