/**
 * Flow's `flow-applet-code-explorer`, the Edit view's Code tab: the tool's files in their stored
 * order on the left (the first is open until another is picked), the open one highlighted with
 * line numbers on the right. Read-only, as Flow's is.
 */
import React from 'react';
import type { ToolFile } from './runtime/compiler';
import { fileIcon, highlightLines } from './code-highlight';
import { cx, MatIcon } from './ui';

export const ToolCodeExplorer: React.FC<{ files: readonly ToolFile[] }> = ({ files }) => {
  const [picked, setPicked] = React.useState<string | null>(null);
  const open = files.find((f) => f.path === picked) ?? files[0];
  const lines = React.useMemo(() => (open ? highlightLines(open.path, open.content) : []), [open]);
  return (
    <div className="ng-flow-applet-code-explorer">
      <div className="applet-code-explorer">
        <div className="code-explorer-sidebar">
          <div className="sidebar-title">Files</div>
          <div className="file-list">
            {files.map((f) => {
              const selected = f.path === open?.path;
              return (
                <button
                  key={f.path}
                  type="button"
                  className={cx('file-item', selected && 'file-item-selected')}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => setPicked(f.path)}
                >
                  <MatIcon name={fileIcon(f.path)} className="file-icon" />
                  <span className="file-name">{f.path}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="code-container">
          {lines.length > 0
            ? (
              <div className="code-block">
                {lines.map((html, i) => (
                  // eslint-disable-next-line react/no-array-index-key -- a line is its number
                  <div key={i} className="code-line">
                    <span className="line-number">{i + 1}</span>
                    <span className="line-content" dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                ))}
              </div>
            )
            : <div className="no-content">No content available.</div>}
        </div>
      </div>
    </div>
  );
};
