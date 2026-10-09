import clsx from "clsx";
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../codex/ui/button";
import { CompactRelativeTime } from "../../codex/ui/compact-relative-time";
import { ContentSection } from "../../codex/ui/content-section";
import { DetailSectionState } from "../../codex/ui/detail-section-state";
import { ListRow } from "../../codex/ui/list-row";
import { Spinner } from "../../codex/ui/spinner";
import { usePageActivityStore, type PageMentionNotification } from "../state/page-activity-store";
import { DotAvatar } from "../willow/dot/character";
import { dotName, resolveDot, useDots } from "../willow/dot/dot-identity";
import { WillowMark } from "../willow/willow-mark";

interface PageNavigationTarget {
  blockId?: string | null;
  threadId?: string;
  messageId?: string;
}

/** `YZ` (app-shared): a Page URL that scrolls to a block or opens a comment. */
function pagePath(pageId: string, target?: PageNavigationTarget) {
  const params = new URLSearchParams();
  if (target?.blockId != null) params.set("block", target.blockId);
  if (target?.threadId != null) params.set("thread", target.threadId);
  if (target?.messageId != null) params.set("message", target.messageId);
  const search = params.toString();
  return `/space/${encodeURIComponent(pageId)}${search === "" ? "" : `?${search}`}`;
}

/** `PageActivityFeed` (inbox chunk), the Space home branch: a preview of the current user's Page mentions. */
export function PageActivityFeed({ searchQuery }: { searchQuery: string }) {
  const intl = useIntl();
  const navigate = useNavigate();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const status = usePageActivityStore((state) => state.status);
  const notifications = usePageActivityStore((state) => state.notifications);
  const loadedCount = usePageActivityStore((state) => state.loadedCount);
  const isFetchingNextPage = usePageActivityStore((state) => state.isFetchingNextPage);
  const dots = useDots();
  const actorOf = (item: PageMentionNotification) => resolveDot(dots, item.actor_dot_id);

  useEffect(() => {
    if (status === "idle") void usePageActivityStore.getState().load();
  }, [status]);

  const isPending = status === "idle" || (status === "loading" && loadedCount === 0);
  const isError = status === "error";
  const loaded = isPending || isError ? undefined : notifications.slice(0, loadedCount);
  const hasNextPage = loaded != null && notifications.length > loadedCount;
  const searchTerm = searchQuery.trim().toLocaleLowerCase();
  const matches = loaded?.filter((item) => {
    const actor = actorOf(item);
    return !searchTerm || item.page_title.toLocaleLowerCase().includes(searchTerm) || (actor != null && dotName(actor).toLocaleLowerCase().includes(searchTerm));
  });
  const visible = !expanded && !searchTerm ? matches?.slice(0, 3) : matches;

  const open = async (item: PageMentionNotification) => {
    if (openingId != null) return;
    setOpeningId(item.notification_id);
    try {
      await usePageActivityStore.getState().markRead(item.notification_id);
      void navigate(pagePath(item.page_id, { blockId: item.block_id, threadId: item.thread_id ?? undefined, messageId: item.message_id ?? undefined }));
    } catch {
      toast.error(
        intl.formatMessage({
          id: "codex.pages.mentions.openError",
          defaultMessage: "Could not open this mention. Try again.",
          description: "Error when marking a Page mention notification read before navigating to its target",
        }),
      );
    }
    setOpeningId(null);
  };

  const states = (
    <>
      {isPending ? (
        <DetailSectionState role="status">
          <Spinner className="icon-xs" />
          <FormattedMessage
            id="codex.pages.mentions.inboxLoading"
            defaultMessage="Loading mentions…"
            description="Loading state while fetching the current workspace's Page mentions inbox"
          />
        </DetailSectionState>
      ) : null}
      {isError ? (
        <DetailSectionState role="alert" tone="danger">
          <FormattedMessage id="codex.pages.mentions.inboxError" defaultMessage="Could not load mentions" description="Error in the Page mentions inbox when notifications cannot be loaded" />
          <Button color="secondary" size="compact" onClick={() => void usePageActivityStore.getState().load()}>
            <FormattedMessage id="codex.pages.mentions.retry" defaultMessage="Try again" description="Button that retries loading Page mention notifications" />
          </Button>
        </DetailSectionState>
      ) : null}
      {visible?.length === 0 && !hasNextPage ? (
        <DetailSectionState>
          {searchTerm ? (
            <FormattedMessage id="codex.pages.mentions.noMatches" defaultMessage="No matching mentions" description="Empty state when loaded Page mentions do not match the search" />
          ) : (
            <FormattedMessage
              id="codex.pages.mentions.noUnreadNotifications"
              defaultMessage="No unread notifications"
              description="Empty state when no notifications remain in the unread filter"
            />
          )}
        </DetailSectionState>
      ) : null}
    </>
  );

  const list = visible?.length ? (
    <ul className="ws-activity flex shrink-0 flex-col select-none">
      {visible.map((item) => {
        const actor = actorOf(item);
        return (
        <li key={item.notification_id}>
          <ListRow
            density="row"
            titleWrap
            icon={
              actor != null ? (
                <span className="ws-activity__avatar">
                  <DotAvatar className="size-full" identity={actor.conversationId} animated={false} />
                </span>
              ) : (
                <WillowMark className="size-5" />
              )
            }
            isDisabled={openingId != null}
            isSelected={false}
            onSelect={() => void open(item)}
            secondLine={
              <span className="text-sm text-secondary">
                <CompactRelativeTime dateString={item.created_at} format="relative" />
              </span>
            }
            title={
              <span className={clsx("text-sm", item.read_at == null ? "text-default" : "text-tertiary")}>
                <FormattedMessage
                  id="willow.pages.mentions.notificationSentence"
                  defaultMessage="{knownActor, select, true {{actor}} other {Willow}} mentioned you in {page}"
                  description="Notification sentence. actor is the bot that mentioned the recipient; page is the full Page title."
                  values={{ knownActor: String(actor != null), actor: actor == null ? null : dotName(actor), page: item.page_title }}
                />
              </span>
            }
            rightText={
              item.read_at == null ? (
                <span
                  className="size-2 shrink-0 rounded-full bg-chart-blue"
                  role="img"
                  aria-label={intl.formatMessage({
                    id: "codex.pages.mentions.unread",
                    defaultMessage: "Unread",
                    description: "Accessible indication that a Page mention notification has not been read",
                  })}
                />
              ) : null
            }
          />
        </li>
        );
      })}
    </ul>
  ) : null;

  const showMore =
    hasNextPage && (expanded || searchTerm) ? (
      <div className="flex shrink-0 flex-col gap-2">
        <Button color="secondary" loading={isFetchingNextPage} size="compact" onClick={() => void usePageActivityStore.getState().fetchNextPage()}>
          <FormattedMessage id="codex.pages.mentions.more" defaultMessage="Show more" description="Loads the next page of mention notifications" />
        </Button>
      </div>
    ) : null;

  return (
    <ContentSection
      title={<FormattedMessage id="space.activity.title" defaultMessage="Activity" description="Heading for the activity feed on Space home" />}
      compact
      actions={
        (matches?.length ?? 0) > 3 || hasNextPage ? (
          <Button color="ghost" size="toolbar" onClick={() => setExpanded(!expanded)}>
            {expanded ? (
              <FormattedMessage id="codex.pages.mentions.showLess" defaultMessage="Show less" description="Collapse the mentions preview on Space home" />
            ) : (
              <FormattedMessage id="codex.pages.mentions.viewAll" defaultMessage="View all" description="Expand the mentions preview on Space home" />
            )}
          </Button>
        ) : null
      }
    >
      {states}
      {list}
      {showMore}
    </ContentSection>
  );
}
