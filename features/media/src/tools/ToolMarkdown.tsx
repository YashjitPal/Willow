// Flow's `flow-markdown-content`: a tool's community description, the Tool Builder's replies and
// thoughts. Its stylesheet is Flow's (`.ng-flow-markdown-content .markdown-container …`).
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from './ui';

const COMPONENTS = {
  a: ({ node: _node, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

export const ToolMarkdown: React.FC<{ text: string; className?: string }> = React.memo(({ text, className }) => (
  <div className={cx('ng-flow-markdown-content', className)}>
    <div className="markdown-container">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  </div>
));
ToolMarkdown.displayName = 'ToolMarkdown';
