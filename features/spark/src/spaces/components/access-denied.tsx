import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router-dom";
import { Button } from "../../codex/ui/button";
import { EmptyState } from "../../codex/ui/empty-state";

export interface DeniedTarget {
  kind: "page" | "space";
  id: string;
}

export interface AccessDeniedProps {
  target: DeniedTarget;
  /** Kept for Codex's callers; Pages are yours alone, so there is no one to ask. */
  canRequestAccess?: boolean;
  onRetry?: () => void;
}

/** `FeComponent` (denied chunk), for Pages that are yours alone: a link to a Page that no longer exists, or never did. */
export function AccessDenied({ onRetry }: AccessDeniedProps) {
  const navigate = useNavigate();
  return (
    <EmptyState
      layout="page"
      title={<FormattedMessage id="willow.pages.unavailable.title" defaultMessage="This page isn’t available" description="Shown for a link to a Page that does not exist" />}
      description={
        <FormattedMessage
          id="willow.pages.unavailable.description"
          defaultMessage="It may have been deleted, or the link may be wrong"
          description="Explains why a linked Page cannot be opened"
        />
      }
      actions={
        <div className="flex items-center gap-2">
          {onRetry != null ? (
            <Button color="secondary" onClick={onRetry}>
              <FormattedMessage id="codex.pages.accessDenied.retryOpen" defaultMessage="Try again" description="Retries opening the Page" />
            </Button>
          ) : null}
          <Button color="primary" onClick={() => void navigate("/space")}>
            <FormattedMessage id="willow.pages.unavailable.back" defaultMessage="Back to Pages" description="Returns to the Pages home" />
          </Button>
        </div>
      }
    />
  );
}
