import { Fragment, type ReactNode } from 'react';

/**
 * The slice of react-intl the Codex bot components use. Willow ships English
 * only, so every message renders its `defaultMessage`; `id` and `description`
 * stay on the descriptors so the copy keeps pointing at Codex's strings.
 */
export interface MessageDescriptor {
  id?: string;
  defaultMessage: string;
  description?: string;
}

type RichTextFormatter = (chunks: ReactNode[]) => ReactNode;
export type MessageValues = Record<string, ReactNode | RichTextFormatter>;

const TOKEN = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;

function formatParts(message: string, values: MessageValues = {}): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of message.matchAll(TOKEN)) {
    if (match.index > last) parts.push(message.slice(last, match.index));
    const [, tag, inner, name] = match;
    if (tag != null) {
      const formatter = values[tag];
      const chunks = formatParts(inner, values);
      parts.push(typeof formatter === 'function' ? (formatter as RichTextFormatter)(chunks) : chunks);
    } else {
      const value = values[name];
      parts.push(typeof value === 'function' ? null : value);
    }
    last = match.index + match[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return parts;
}

export function formatMessage(descriptor: MessageDescriptor, values?: MessageValues): string {
  return formatParts(descriptor.defaultMessage, values)
    .map((part) => (part == null || typeof part === 'boolean' ? '' : String(part)))
    .join('');
}

const intl = { formatMessage };
export type IntlShape = typeof intl;

export function useIntl(): IntlShape {
  return intl;
}

export function defineMessages<T extends Record<string, MessageDescriptor>>(messages: T): T {
  return messages;
}

export function FormattedMessage({ defaultMessage, values }: MessageDescriptor & { values?: MessageValues }) {
  return (
    <>
      {formatParts(defaultMessage, values).map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
