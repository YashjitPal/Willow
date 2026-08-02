// Small shared pieces of the Spark composer UI: the icon defaults every
// MaterialSymbol in this feature spreads, the tool-name lookup, and the two chip
// rows that sit above the input (added files/tool, and a message's attachments).
//
// `mergeSelectedFiles` lived here in triplicate — SparkTaskDetail, SparkAllTasks,
// and SparkHome each had a byte-identical copy. It is defined once now and the
// three callers import it.
import React from 'react';
import type { SparkTaskAttachment } from './spark-store';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

const SYMBOL_PROPS = {
  family: 'luminous' as const,
  weight: 320,
  roundness: 100,
};

const SPARK_TOOL_LABELS: Record<string, string> = {
  images: 'Create image',
  thinking: 'Thinking',
  research: 'Deep research',
  web: 'Web search',
  learn: 'Study and learn',
  canvas: 'Canvas',
  github: 'GitHub',
  quizzes: 'Quizzes',
  spotify: 'Spotify',
};

const mergeSelectedFiles = (current: readonly File[], incoming: readonly File[]): File[] => {
  const merged = [...current];
  const knownFiles = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  incoming.forEach((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (knownFiles.has(key)) return;
    knownFiles.add(key);
    merged.push(file);
  });
  return merged;
};

const SparkComposerContextChip: React.FC<{
  files: readonly File[];
  tool: string | null;
  disabled?: boolean;
  onRemoveFile: (index: number) => void;
  onClearTool: () => void;
}> = ({ files, tool, disabled = false, onRemoveFile, onClearTool }) => {
  if (!files.length && !tool) return null;
  return (
    <div className="spark-task-detail__context-chips" aria-label="Added context">
      {files.map((file, index) => (
        <span
          key={`${file.name}:${file.size}:${file.lastModified}`}
          className="spark-task-detail__context-chip"
          title={file.name}
        >
          <MaterialSymbol
            {...SYMBOL_PROPS}
            name="attach_file"
            size={16}
            opticalSize={16}
          />
          <span>{file.name}</span>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            disabled={disabled}
            onClick={() => onRemoveFile(index)}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="close" size={14} opticalSize={14} />
          </button>
        </span>
      ))}
      {tool && (
        <span className="spark-task-detail__context-chip spark-task-detail__context-chip--tool">
          <MaterialSymbol
            {...SYMBOL_PROPS}
            name="auto_awesome"
            size={16}
            opticalSize={16}
          />
          <span>{SPARK_TOOL_LABELS[tool] ?? tool}</span>
          <button
            type="button"
            aria-label={`Remove ${SPARK_TOOL_LABELS[tool] ?? tool}`}
            disabled={disabled}
            onClick={onClearTool}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="close" size={14} opticalSize={14} />
          </button>
        </span>
      )}
    </div>
  );
};

const getAttachmentSymbol = (attachment: SparkTaskAttachment) => (
  attachment.type === 'image' || attachment.mimeType.startsWith('image/')
    ? 'image'
    : attachment.type === 'text' || attachment.mimeType.startsWith('text/')
      ? 'article'
      : 'description'
);

const SparkAttachmentPills: React.FC<{ attachments?: readonly SparkTaskAttachment[] }> = ({
  attachments,
}) => {
  if (!attachments?.length) return null;
  return (
    <div className="spark-task-detail__attachment-pills" aria-label="Attached files">
      {attachments.map((attachment) => (
        <span key={attachment.id} title={attachment.name}>
          <MaterialSymbol
            {...SYMBOL_PROPS}
            name={getAttachmentSymbol(attachment)}
            size={16}
            opticalSize={16}
          />
          <span>{attachment.name}</span>
        </span>
      ))}
    </div>
  );
};


export { SYMBOL_PROPS, mergeSelectedFiles, getAttachmentSymbol, SparkComposerContextChip, SparkAttachmentPills };
