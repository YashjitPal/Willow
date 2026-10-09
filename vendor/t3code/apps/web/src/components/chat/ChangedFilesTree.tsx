import { type RunId } from "@t3tools/contracts";
import { type MouseEvent, memo, useCallback, useMemo, useState } from "react";
import { type TurnDiffFileChange } from "../../types";
import {
  buildTurnDiffTree,
  summarizeTurnDiffStats,
  type TurnDiffTreeNode,
} from "../../lib/turnDiffTree";
import { ChevronRightIcon } from "lucide-react";
import { Folder, FolderClosed } from "lucide";
import { cn } from "~/lib/utils";
import { CodexDiffStats, CodexIcon } from "../../willow/activity";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { MiddleTruncate } from "../ui/middle-truncate";
import { MorphIcon } from "~/components/MorphIcon";

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {};

/** Opens the OS-level context menu for a changed file (reveal in file manager, open in editor). */
export type ChangedFileContextMenuHandler = (filePath: string, event: MouseEvent) => void;

export const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  runId: RunId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const { runId, files, onOpenTurnDiff, onFileContextMenu } = props;
  const summaryStat = useMemo(() => summarizeTurnDiffStats(files), [files]);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? files : files.slice(0, CHANGED_FILES_VISIBLE);
  const hidden = files.length - CHANGED_FILES_VISIBLE;

  // Codex's end-of-turn card (TurnDiffCard): the count and stats, View changes, then three files
  // and the rest behind "Show N more files".
  return (
    <div className="willow-turn-diff" data-changed-files-state="list">
      <div data-changed-files-header="" className="willow-turn-diff__header">
        <span className="willow-turn-diff__title">
          {files.length === 1 ? "1 file changed" : `${files.length} files changed`}
        </span>
        <CodexDiffStats added={summaryStat.additions} deleted={summaryStat.deletions} />
        <span className="willow-turn-diff__actions">
          <button
            type="button"
            className="willow-pill-button willow-pill-button--secondary"
            onClick={() => onOpenTurnDiff(runId, files[0]?.path)}
          >
            View changes
            <CodexIcon name="arrow-up-right" className="willow-icon-2xs willow-pill-button__trailing" />
          </button>
        </span>
      </div>
      <div className="willow-turn-diff__files">
        {visible.map((file) => {
          const slash = Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\"));
          return (
            <button
              key={file.path}
              type="button"
              className="willow-turn-diff__file"
              title={file.path}
              onClick={() => onOpenTurnDiff(runId, file.path)}
              onContextMenu={
                onFileContextMenu
                  ? (event) => {
                      event.preventDefault();
                      onFileContextMenu(file.path, event);
                    }
                  : undefined
              }
            >
              <CodexIcon name="document" className="willow-icon-2xs willow-turn-diff__icon" />
              <span className="willow-turn-diff__name">{file.path.slice(slash + 1)}</span>
              <span className="willow-turn-diff__dir">{slash > 0 ? file.path.slice(0, slash) : ""}</span>
              <CodexDiffStats
                added={file.additions ?? 0}
                deleted={file.deletions ?? 0}
                className="willow-turn-diff__stats"
              />
            </button>
          );
        })}
        {hidden > 0 ? (
          <button
            type="button"
            data-scroll-anchor-ignore
            className="willow-turn-diff__more"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "Collapse files" : `Show ${hidden} more ${hidden === 1 ? "file" : "files"}`}
          </button>
        ) : null}
      </div>
    </div>
  );
});

const CHANGED_FILES_VISIBLE = 3;

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  runId: RunId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const { files, allDirectoriesExpanded, onOpenTurnDiff, resolvedTheme, runId, onFileContextMenu } =
    props;
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  const hasDirectoryNodes = directoryPathsKey.length > 0;
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string;
    overrides: Record<string, boolean>;
  }>(() => ({
    key: expansionStateKey,
    overrides: {},
  }));
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES;

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) => {
        const nextOverrides = current.key === expansionStateKey ? current.overrides : {};
        return {
          key: expansionStateKey,
          overrides: {
            ...nextOverrides,
            [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
          },
        };
      });
    },
    [allDirectoriesExpanded, expansionStateKey],
  );

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = 8 + depth * 14;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            data-scroll-anchor-ignore
            aria-expanded={isExpanded}
            className="group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                isExpanded && "rotate-90",
              )}
            />
            <MorphIcon
              className="size-3.5 shrink-0 text-muted-foreground/75"
              icon={isExpanded ? Folder : FolderClosed}
            />
            <span className="truncate font-mono text-2xs text-muted-foreground/90 group-hover:text-foreground/90">
              {node.name}
            </span>
            {hasNonZeroStat(node.stat) && (
              <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            )}
          </button>
          {isExpanded && (
            <div>{node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}</div>
          )}
        </div>
      );
    }

    return (
      <button
        key={`file:${node.path}`}
        type="button"
        className="group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={() => onOpenTurnDiff(runId, node.path)}
        onContextMenu={
          onFileContextMenu
            ? (event) => {
                event.preventDefault();
                onFileContextMenu(node.path, event);
              }
            : undefined
        }
      >
        {hasDirectoryNodes || depth > 0 ? (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        ) : null}
        <PierreEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 text-muted-foreground/70"
        />
        <span className="flex min-w-0 font-mono text-xs text-foreground/85 group-hover:text-foreground">
          <MiddleTruncate value={node.name} />
        </span>
        {node.stat && (
          <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        )}
      </button>
    );
  };

  return <div className="p-2">{treeNodes.map((node) => renderTreeNode(node, 0))}</div>;
});

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}
