import type { FileDiffMetadata } from "@pierre/diffs";
import { useState } from "react";

import { CodexDiffStats, CodexIcon, fileNameOf } from "./activity";

const CHANGE_TAGS: Partial<Record<FileDiffMetadata["type"], string>> = {
  new: "new",
  deleted: "deleted",
  "rename-pure": "renamed",
  "rename-changed": "renamed",
};

/**
 * A file's header in the review, as Codex's ChangesPanel draws it: chevron, document, the name
 * then its folder, the kind of change, the line counts. The name carries `data-title` and the
 * path, which the panel opens in the editor when the name is clicked.
 */
export function CodexReviewFileHeader(props: {
  path: string;
  change: FileDiffMetadata["type"];
  additions: number;
  deletions: number;
  collapsed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const name = fileNameOf(props.path);
  const folder = props.path.slice(0, Math.max(0, props.path.length - name.length - 1));
  const tag = CHANGE_TAGS[props.change];
  return (
    <span className="willow-diff-file">
      <button
        type="button"
        className="willow-diff-file__toggle"
        aria-label={props.collapsed ? `Expand ${props.path}` : `Collapse ${props.path}`}
        aria-expanded={!props.collapsed}
        disabled={props.disabled}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggle();
        }}
      >
        <CodexIcon
          name="chevron-right-sm"
          className="willow-diff-file__chevron"
          data-expanded={props.collapsed ? undefined : ""}
        />
      </button>
      <CodexIcon name="document" className="willow-diff-file__icon" />
      <span className="willow-diff-file__label">
        <span
          className="willow-diff-file__name"
          data-title=""
          data-file-path={props.path}
          title={props.path}
        >
          {name}
        </span>
        {folder ? <span className="willow-diff-file__folder">{folder}</span> : null}
      </span>
      {tag ? (
        <span className="willow-diff-file__tag" data-change={props.change}>
          {tag}
        </span>
      ) : null}
      <CodexDiffStats added={props.additions} deleted={props.deletions} />
    </span>
  );
}

export interface CodexReviewFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** The review's files beside it, as Codex's ChangesPanel lists them: a filter, then a row each. */
export function CodexReviewFileList(props: {
  files: ReadonlyArray<CodexReviewFile>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const visible = query ? props.files.filter((file) => file.path.toLowerCase().includes(query)) : props.files;
  return (
    <div className="willow-review-files">
      <div className="willow-review-files__filter">
        <label className="willow-review-files__search">
          <CodexIcon name="filter" className="willow-icon-2xs" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter files…"
            aria-label="Filter files"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="willow-review-files__list">
        {visible.length === 0 ? <div className="willow-review-files__empty">No matching files</div> : null}
        {visible.map((file) => (
          <button
            key={file.path}
            type="button"
            title={file.path}
            className="willow-review-files__row"
            data-selected={file.path === props.selectedPath ? "" : undefined}
            onClick={() => props.onSelect(file.path)}
          >
            <CodexIcon name="document" className="willow-review-files__icon" />
            <span className="willow-review-files__name">{fileNameOf(file.path)}</span>
            <CodexDiffStats added={file.additions} deleted={file.deletions} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Codex's "File actions" button closing the header. */
export function CodexReviewFileActions({ onOpen }: { onOpen: (anchor: DOMRect) => void }) {
  return (
    <button
      type="button"
      className="willow-icon-button willow-icon-button--sm willow-diff-file__actions"
      aria-label="File actions"
      title="File actions"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget.getBoundingClientRect());
      }}
    >
      <CodexIcon name="ellipsis" className="willow-icon-2xs" />
    </button>
  );
}
