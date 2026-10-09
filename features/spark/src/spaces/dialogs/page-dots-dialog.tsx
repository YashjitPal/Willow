import { FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { useNavigate } from "react-router-dom";
import { CheckmarkMdLight16Icon, ChevronDownMdLight16Icon, LinkLight16Icon, PlusLgLight16Icon } from "../../codex/icons";
import { Button } from "../../codex/ui/button";
import { copyToClipboard } from "../../codex/ui/copy-button";
import { Dialog, DialogTitle } from "../../codex/ui/dialog";
import { DialogBody, DialogFooter, DialogHeader, DialogSection } from "../../codex/ui/dialog-layout";
import { DropdownMenu } from "../../codex/ui/dropdown-menu";
import { showLinkCopiedToast } from "../../codex/ui/link-copied-toast";
import { Menu, MenuItem } from "../../codex/ui/menu";
import { pageShareUrl } from "../navigation";
import { dotsOnPage, pageLineage, useDotsOnPage, usePage, useSpacesStore, type DotOnPage, type DotRole } from "../state";
import { DotAvatar } from "../willow/dot/character";
import { dotName, useDots } from "../willow/dot/dot-identity";
import { useDotStore, type Dot } from "../willow/dot/state/dot-store";

const roleMessages: Record<DotRole, MessageDescriptor> = {
  editor: { id: "willow.pages.dots.role.editor", defaultMessage: "Can edit", description: "A bot may edit the Page" },
  commenter: { id: "willow.pages.dots.role.commenter", defaultMessage: "Can comment", description: "A bot may comment on the Page" },
  viewer: { id: "willow.pages.dots.role.viewer", defaultMessage: "Can view", description: "A bot may read the Page" },
};

const roles: DotRole[] = ["editor", "commenter", "viewer"];

/** Takes a bot off a Page: it stops inheriting there too when a parent Page still grants it access. */
function removeDot(pageId: string, dotId: string) {
  const { pages, dotAccess, setDotAccess } = useSpacesStore.getState();
  const parent = pageLineage(pages, pageId)[1];
  const inherits = parent != null && dotsOnPage(pages, dotAccess, useDotStore.getState().dots, parent).some(({ dot }) => dot.conversationId === dotId);
  setDotAccess(pageId, dotId, inherits ? "none" : null);
}

function DotRow({ pageId, entry }: { pageId: string; entry: DotOnPage }) {
  const intl = useIntl();
  const inheritedFrom = usePage(entry.inheritedFrom);
  const name = dotName(entry.dot);
  return (
    <li className="ws-dots-dialog__row">
      <span className="ws-dots-dialog__avatar">
        <DotAvatar className="size-full" identity={entry.dot.conversationId} animated={false} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="ws-dots-dialog__name truncate">{name}</span>
        {inheritedFrom != null ? (
          <span className="ws-dots-dialog__meta truncate">
            <FormattedMessage
              id="willow.pages.dots.inherited"
              defaultMessage="From {page}"
              description="The parent Page a bot's access on this subpage comes from"
              values={{ page: inheritedFrom.title?.trim() || intl.formatMessage({ id: "codex.space.page.untitledRow", defaultMessage: "Untitled page", description: "Fallback title for a Page without a title" }) }}
            />
          </span>
        ) : null}
      </span>
      <DropdownMenu
        align="end"
        contentWidth="menu"
        triggerButton={
          <Button color="ghost" size="toolbar" aria-label={intl.formatMessage({ id: "willow.pages.dots.roleFor", defaultMessage: "Access for {name}", description: "Accessible label of a bot's access menu" }, { name })}>
            <FormattedMessage {...roleMessages[entry.role]} />
            <ChevronDownMdLight16Icon />
          </Button>
        }
      >
        {roles.map((role) => (
          <MenuItem key={role} rightIcon={role === entry.role ? <CheckmarkMdLight16Icon /> : undefined} onSelect={() => useSpacesStore.getState().setDotAccess(pageId, entry.dot.conversationId, role)}>
            <FormattedMessage {...roleMessages[role]} />
          </MenuItem>
        ))}
        <Menu.Separator />
        <MenuItem tone="danger" onSelect={() => removeDot(pageId, entry.dot.conversationId)}>
          <FormattedMessage id="willow.pages.dots.remove" defaultMessage="Remove from page" description="Takes a bot off the Page" />
        </MenuItem>
      </DropdownMenu>
    </li>
  );
}

function AddDotMenu({ pageId, available }: { pageId: string; available: Dot[] }) {
  return (
    <DropdownMenu
      align="start"
      contentWidth="menu"
      triggerButton={
        <Button className="self-start" color="outline" size="toolbar" disabled={available.length === 0}>
          <PlusLgLight16Icon />
          <FormattedMessage id="willow.pages.dots.add" defaultMessage="Add a bot" description="Opens the list of bots to add to the Page" />
        </Button>
      }
    >
      {available.map((dot) => (
        <MenuItem
          key={dot.conversationId}
          leftIcon={
            <span className="ws-dots-dialog__menu-avatar">
              <DotAvatar className="size-full" identity={dot.conversationId} animated={false} />
            </span>
          }
          onSelect={() => useSpacesStore.getState().setDotAccess(pageId, dot.conversationId, "editor")}
        >
          {dotName(dot)}
        </MenuItem>
      ))}
    </DropdownMenu>
  );
}

/** "Bots on this page", where Share used to be: which of your bots can edit, comment on or view a Page and its subpages. */
export function PageDotsDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const intl = useIntl();
  const navigate = useNavigate();
  const page = usePage(pageId);
  const dots = useDots();
  const onPage = useDotsOnPage(pageId);
  const available = dots.filter((dot) => !onPage.some((entry) => entry.dot.conversationId === dot.conversationId));
  const title = page?.title?.trim() || intl.formatMessage({ id: "codex.space.page.untitledRow", defaultMessage: "Untitled page", description: "Fallback title for a Page without a title" });

  return (
    <Dialog
      open
      size="compact"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBody className="ws-dots-dialog">
        <DialogSection>
          <DialogHeader
            title={
              <DialogTitle className="contents">
                <FormattedMessage id="willow.pages.dots.title" defaultMessage="Bots on “{title}”" description="Title of the dialog listing the bots that work on a Page" values={{ title }} />
              </DialogTitle>
            }
            subtitle={
              <FormattedMessage
                id="willow.pages.dots.subtitle"
                defaultMessage="Bots you add can work on this page and its subpages"
                description="Explains what adding a bot to a Page does"
              />
            }
          />
        </DialogSection>
        {dots.length === 0 ? (
          <DialogSection spacing="large">
            <div className="ws-dots-dialog__empty">
              <p>
                <FormattedMessage id="willow.pages.dots.none" defaultMessage="You don’t have any bots yet. Bots are agents that work alongside you on pages." description="Empty state of the Page bots dialog" />
              </p>
              <Button color="primary" size="toolbar" onClick={() => void navigate("/dots")}>
                <FormattedMessage id="willow.pages.dots.create" defaultMessage="Create a bot" description="Opens Bots to create the first bot" />
              </Button>
            </div>
          </DialogSection>
        ) : (
          <>
            <DialogSection spacing="large">
              <AddDotMenu pageId={pageId} available={available} />
            </DialogSection>
            <DialogSection spacing="large">
              {onPage.length === 0 ? (
                <p className="ws-dots-dialog__meta">
                  <FormattedMessage id="willow.pages.dots.empty" defaultMessage="No bots on this page yet" description="Shown when no bot has access to the Page" />
                </p>
              ) : (
                <ul className="ws-dots-dialog__list">
                  {onPage.map((entry) => (
                    <DotRow key={entry.dot.conversationId} pageId={pageId} entry={entry} />
                  ))}
                </ul>
              )}
            </DialogSection>
          </>
        )}
        <DialogSection spacing="large">
          <DialogFooter className="justify-between">
            <Button
              color="outline"
              type="button"
              onClick={() => {
                void copyToClipboard(pageShareUrl(pageId)).then(() => showLinkCopiedToast());
              }}
            >
              <LinkLight16Icon />
              <FormattedMessage id="willow.pages.dots.copyLink" defaultMessage="Copy link" description="Copies the Page's link" />
            </Button>
            <Button type="button" onClick={onClose}>
              <FormattedMessage id="willow.pages.dots.done" defaultMessage="Done" description="Closes the Page bots dialog" />
            </Button>
          </DialogFooter>
        </DialogSection>
      </DialogBody>
    </Dialog>
  );
}
