import type { ScopedThreadRef } from "@t3tools/contracts";
import { X } from "lucide-react";

import { isValidHistoryTimestamp, type BrowserHistoryEntry } from "~/browserHistoryStore";
import { useNowMinute } from "~/hooks/useNowMinute";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";

interface Props {
  threadRef: ScopedThreadRef;
  entry: BrowserHistoryEntry;
  onOpen: () => void;
  onRemove: () => void;
}

export function PreviewRecentUrlCard({ threadRef, entry, onOpen, onRemove }: Props) {
  const parsed = new URL(entry.url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const label = `${parsed.host}${path}${parsed.search}${parsed.hash}`;
  const visitedAt = isValidHistoryTimestamp(entry.lastVisitedAt)
    ? formatRelativeTimeLabel(new Date(entry.lastVisitedAt).toISOString())
    : "";
  useNowMinute();
  return (
    <div className="group relative flex w-full items-center">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-10 w-full items-center gap-2.5 rounded-lg bg-[color-mix(in_oklab,var(--codex-ink)_2.5%,transparent)] px-2.5 py-2 pr-10 text-left transition-colors hover:bg-(--codex-secondary-soft) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--codex-border-heavy)"
      >
        <PreviewFaviconIcon threadRef={threadRef} url={entry.url} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[18px] text-(--codex-ink)">
            {entry.title ?? label}
          </span>
          <span className="truncate text-xs leading-4 text-(--codex-ink-tertiary)">
            {entry.title ? `${label} · ` : ""}
            {visitedAt}
          </span>
        </div>
      </button>
      <button
        type="button"
        aria-label={`Remove ${label} from history`}
        onClick={onRemove}
        className="absolute right-2 flex size-6 items-center justify-center rounded-md text-[color-mix(in_oklab,var(--codex-ink)_60%,transparent)] opacity-0 hover:bg-(--codex-tertiary-hover) hover:text-(--codex-ink) focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
