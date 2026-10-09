/**
 * Willow's Search chats page (apps/studio's SearchChats.tsx) for an agent tab's threads: the
 * 64px search pill 100px down the page, then "Recent" over the tab's threads, newest first, each
 * with its day. Typing narrows them by title and by T3's server search through their messages.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { SidebarInset } from "~/components/ui/sidebar";
import { useEscapeToGoBack } from "~/hooks/useNavigateBack";
import { useThreadShells } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { useThreadSearch } from "~/state/queries";
import { buildThreadRouteParams } from "~/threadRoutes";

import { useHarnessThreads } from "./harness";
import { Glyph } from "./WillowSidebar";

const sameDay = (left: Date, right: Date) =>
  left.getDate() === right.getDate() &&
  left.getMonth() === right.getMonth() &&
  left.getFullYear() === right.getFullYear();

/** Willow's search dates: Today, Yesterday, "Oct 3", or "Oct 3, 2025" from another year. */
function formatThreadDay(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const now = new Date();
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export function WillowSearchPage() {
  useEscapeToGoBack();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const shells = useThreadShells();
  const liveShells = useMemo(() => shells.filter((thread) => thread.archivedAt === null), [shells]);
  const threads = useHarnessThreads(liveShells);
  const { environments } = useEnvironments();
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const search = useThreadSearch(environmentIds, query);
  const contentMatches = useMemo(
    () => new Set(search.matches.map((match) => threadSearchMatchKey(match))),
    [search.matches],
  );
  const recent = useMemo(
    () =>
      [...threads].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    [threads],
  );
  const needle = query.trim().toLocaleLowerCase();
  const results = needle
    ? recent.filter(
        (thread) =>
          thread.title.toLocaleLowerCase().includes(needle) ||
          contentMatches.has(
            threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
          ),
      )
    : recent;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <section className="willow-search-page" aria-label="Search threads">
        <div className="willow-search-bar">
          <span className="willow-search-bar__icon" aria-hidden="true">
            <Glyph name="search" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="text"
            placeholder="Search threads"
            aria-label="Search threads"
            className="willow-search-bar__input"
          />
          {query ? (
            <button
              type="button"
              className="willow-search-bar__clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <XIcon />
            </button>
          ) : null}
        </div>
        <div className="willow-search-results">
          <div className="willow-search-results__header">
            <h2 className="willow-search-results__heading">Recent</h2>
          </div>
          <div className="willow-search-results__list">
            <div className="willow-search-results__inner">
              {results.map((thread) => (
                <button
                  key={`${thread.environmentId}:${thread.id}`}
                  type="button"
                  className="willow-search-result"
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(
                        scopeThreadRef(thread.environmentId, thread.id),
                      ),
                    })
                  }
                >
                  <span className="willow-search-result__title">{thread.title}</span>
                  <span className="willow-search-result__date">
                    {formatThreadDay(thread.updatedAt)}
                  </span>
                </button>
              ))}
              {needle && !search.isPending && results.length === 0 ? (
                <div className="willow-search-empty">No threads found with this keyword</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </SidebarInset>
  );
}
