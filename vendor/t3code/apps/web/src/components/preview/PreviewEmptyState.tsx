import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Globe, History, RadioTower } from "lucide-react";

import type { BrowserHistoryEntry } from "~/browserHistoryStore";
import { DiscoveryList } from "../ui/discovery-list";

import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import { PreviewRecentUrlCard } from "./PreviewRecentUrlCard";
import { useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  recentEntries: ReadonlyArray<BrowserHistoryEntry>;
  onRemoveRecent: (url: string) => void;
  onOpenUrl: (url: string) => void;
}

export function PreviewEmptyState({
  threadRef,
  environmentId,
  configuredUrls,
  recentEntries,
  onRemoveRecent,
  onOpenUrl,
}: Props) {
  const servers = useDiscoveredLocalServers({
    environmentId,
    configuredUrls,
  });
  const recents = recentEntries.filter((entry) => URL.canParse(entry.url)).slice(0, 8);

  // Codex's browser start page (BrowserPanel): a faint globe over a 15px title and 13px detail.
  if (servers.length === 0 && recents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center select-none">
        <Globe className="mb-2 size-6 text-[color-mix(in_oklab,var(--codex-ink)_30%,transparent)]" />
        <div className="text-[15px] leading-5 font-medium text-(--codex-ink)">No preview yet</div>
        <div className="max-w-sm text-[13px] leading-[18px] text-(--codex-ink-tertiary)">
          Type a URL above, or run a dev script. Browser-ready localhost servers will show up here
          automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-y-auto px-3 py-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        {recents.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1 text-[13px] leading-[18px] text-(--codex-ink-tertiary)">
              <History className="size-4 shrink-0" />
              <h2>Recently used</h2>
            </div>
            <DiscoveryList>
              {recents.map((entry) => (
                <PreviewRecentUrlCard
                  key={entry.url}
                  threadRef={threadRef}
                  entry={entry}
                  onOpen={() => onOpenUrl(entry.url)}
                  onRemove={() => onRemoveRecent(entry.url)}
                />
              ))}
            </DiscoveryList>
          </div>
        ) : null}
        {servers.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1 text-[13px] leading-[18px] text-(--codex-ink-tertiary)">
              <RadioTower className="size-4 shrink-0" />
              <h2>Local servers</h2>
            </div>
            <DiscoveryList>
              {servers.map((server) => (
                <PreviewLocalServerCard
                  key={`${server.host}:${server.port}`}
                  threadRef={threadRef}
                  server={server}
                  onOpen={() => onOpenUrl(server.requestedUrl)}
                />
              ))}
            </DiscoveryList>
            <p className="px-1 text-xs text-(--codex-ink-tertiary)">
              Select a live local server to open it in this browser tab.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
