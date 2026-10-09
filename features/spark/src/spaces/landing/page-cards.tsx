import clsx from "clsx";
import { useMemo, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";
import { CompactRelativeTime } from "../../codex/ui/compact-relative-time";
import { ListRow } from "../../codex/ui/list-row";
import { PageIcon } from "../components/space-icon";
import { openPage } from "../navigation";
import { descendantPageIds, useDotsInTree, useSpacesStore, type PageMetadata } from "../state";
import { DotFacepile } from "../willow/dot/dot-facepile";
import { useGettingStartedCard } from "./getting-started";
import { PagePinButton, PageRowMenu } from "./page-content-item";
import { petBlossomSrc, petShadesSrc } from "./welcome-pets";

interface CardLayoutProps {
  actions?: ReactNode;
  ariaLabel: string;
  description?: ReactNode;
  icon?: ReactNode;
  isDisabled?: boolean;
  onSelect: () => void;
  title: ReactNode;
  variant?: "default" | "welcome";
}

/** `Bt1Component` (legacy-page chunk): a raised card on the Pages home. */
function CardLayout({ actions, ariaLabel, description, icon, isDisabled, onSelect, title, variant = "default" }: CardLayoutProps) {
  const welcome = variant === "welcome";
  return (
    <ListRow
      className={clsx("ws-space-card", welcome && "ws-space-card--welcome _welcome_18ad9_2")}
      surface="raised"
      title={title}
      ariaLabel={ariaLabel}
      isSelected={false}
      isDisabled={isDisabled}
      hasInteractiveContent
      onSelect={onSelect}
    >
      <div className="ws-space-card__body flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <span className={clsx("ws-space-card__icon flex size-10 shrink-0 items-center justify-center rounded-full", welcome ? "text-media-foreground" : "text-default")}>{icon}</span>
          <div className="ws-space-card__actions pointer-events-auto flex items-center gap-1">{actions}</div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={clsx("ws-space-card__title truncate text-lg font-medium", welcome && "text-media-foreground")}>{title}</span>
          <div className={clsx("ws-space-card__meta flex min-h-7 items-center text-sm", welcome ? "text-media-foreground/70" : "text-secondary")}>{description}</div>
        </div>
      </div>
    </ListRow>
  );
}

/** A top-level Page on the Pages home: its symbol, the bots working anywhere in it, and how much it holds. */
export function PageCard({ page }: { page: PageMetadata }) {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const dots = useDotsInTree(page.page_id);
  const pages = useSpacesStore((state) => state.pages);
  const subpages = useMemo(() => descendantPageIds(pages, page.page_id).filter((id) => pages[id]?.deleted_at == null).length, [page.page_id, pages]);
  const untitled = intl.formatMessage({ id: "codex.space.page.untitledRow", defaultMessage: "Untitled page", description: "Fallback title for a Page without a title" });
  const title = page.title?.trim() || untitled;

  return (
    <PageRowMenu page={page}>
      {(menu) => (
        <CardLayout
          title={title}
          ariaLabel={title}
          icon={
            <PageIcon iconColor="file-type" iconSize={20} pageId={page.page_id} symbol={page.symbol} title={page.title ?? ""} iconClassName="ws-page-card__glyph">
              {({ icon }) => icon}
            </PageIcon>
          }
          onSelect={() => openPage(navigate, location, page.page_id)}
          description={
            <span className="ws-page-card__meta">
              {dots.length > 0 ? <DotFacepile dots={dots} max={4} size={24} /> : null}
              <span className="truncate">
                {subpages > 0 ? (
                  <FormattedMessage
                    id="willow.pages.card.subpages"
                    defaultMessage="{count, plural, one {# page} other {# pages}} ·"
                    description="How many subpages a Page holds, before its last edit time"
                    values={{ count: subpages }}
                  />
                ) : null}{" "}
                <CompactRelativeTime dateString={page.updated_at} />
              </span>
            </span>
          }
          actions={
            <span className="pointer-events-auto flex items-center gap-1">
              <PagePinButton page={page} />
              {menu}
            </span>
          }
        />
      )}
    </PageRowMenu>
  );
}

/** `ItComponent` / `LtComponent` / `MtComponent`: the "Your guide to pages" card for people new to Pages. */
export function WelcomeCard() {
  const intl = useIntl();
  const { visible, opening, open } = useGettingStartedCard();
  if (!visible) return null;
  return (
    <CardLayout
      isDisabled={opening}
      variant="welcome"
      title={<FormattedMessage id="space.gettingStartedPages.title" defaultMessage="Your guide to pages" description="Title of the introductory Getting Started Page and its card" />}
      ariaLabel={intl.formatMessage({
        id: "space.gettingStartedPages.open",
        defaultMessage: "Open Your guide to pages",
        description: "Open the introductory Getting Started with Pages Page",
      })}
      icon={null}
      description={
        opening ? (
          <span role="status">
            <FormattedMessage id="space.welcome.opening" defaultMessage="Opening…" description="Status while creating or opening the welcome Page" />
          </span>
        ) : (
          <FormattedMessage
            id="space.gettingStartedPages.subtitle"
            defaultMessage="Learn the basics"
            description="Subtitle inviting new users to open the Getting Started with Pages Page"
          />
        )
      }
      onSelect={() => void open()}
      actions={
        <div className="pointer-events-none relative h-10 w-24" aria-hidden>
          <img className="absolute top-0 right-0 block size-9 rotate-12 object-contain" alt="" draggable={false} src={petShadesSrc} />
          <img className="absolute top-6 right-12 block size-9 -rotate-12 object-contain" alt="" draggable={false} src={petBlossomSrc} />
        </div>
      }
    />
  );
}
