import type { ReactNode } from "react";
import { defineMessages, FormattedMessage } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";
import { PlusLgLight20Icon, textPageLight24 } from "../../codex/icons";
import { Icon } from "../../codex/icons/icon";
import { Button } from "../../codex/ui/button";
import { EmptyState } from "../../codex/ui/empty-state";
import { createAndOpenPage } from "../navigation";

const messages = defineMessages({
  pagesTitle: { id: "space.empty.pages.title", defaultMessage: "No pages yet", description: "Empty state heading for the Pages list" },
  pagesDescription: {
    id: "willow.pages.empty.description",
    defaultMessage: "Write, plan and think things through with Willow and your bots",
    description: "First-use guidance for the Pages list",
  },
});

const views = {
  pages: { icon: textPageLight24, title: messages.pagesTitle, description: messages.pagesDescription },
};

export type SpaceEmptyStateView = keyof typeof views;

/** `TLo` with `ALo`: creates a Page and opens it with its title focused. */
export function NewPageButton() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Button color="primary" size="pageAction" uniformAtMobile onClick={() => createAndOpenPage(navigate, location)}>
      <PlusLgLight20Icon className="hidden browser:max-md:block" />
      <span className="browser:max-md:sr-only">
        <FormattedMessage id="willow.pages.new" defaultMessage="New page" description="Creates a Page and opens it" />
      </span>
    </Button>
  );
}

export interface SpaceEmptyStateProps {
  view: SpaceEmptyStateView;
  description?: ReactNode;
}

/** `space-empty-state` chunk: the first-use empty state of the Pages list. */
export function SpaceEmptyState({ view, description }: SpaceEmptyStateProps) {
  const config = views[view];
  return (
    <EmptyState
      className="select-none"
      layout="page"
      spacing="default"
      illustrationSize="tile"
      illustration={<Icon asset={config.icon} />}
      title={
        <h2>
          <FormattedMessage {...config.title} />
        </h2>
      }
      description={description === undefined ? <FormattedMessage {...config.description} /> : description}
      actions={<NewPageButton />}
    />
  );
}
