import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type RefObject } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import {
  AnalyticsLight16Icon,
  AnalyticsLight20Icon,
  LockLight12Icon,
  magicWandLight16,
  magicWandLight20,
  PhotoLight16Icon,
  PhotoLight20Icon,
  plusSquareLight16,
  plusSquareLight20,
  shapesLight16,
  shapesLight20,
  SquareAndPencilLight16Icon,
  SquareAndPencilLight20Icon,
  TextBubbleLight16Icon,
  TextBubbleLight20Icon,
  TextPageLight16Icon,
  TextPageLight20Icon,
} from "../../codex/icons";
import { ContextMenu, type ContextMenuItem } from "../../codex/ui/context-menu";
import { FloatingControlButton } from "../../codex/ui/floating-control";
import { Menu, menuContentMaxHeight } from "../../codex/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../codex/ui/popover";
import { SizedIcon, type SizedIconSource } from "../../codex/ui/sized-icon";
import { SuggestionSurface } from "../../codex/ui/suggestion-menu";
import { Tooltip } from "../../codex/ui/tooltip";
import { FloatingControlGroup, FloatingControlIconButton, ViewerHeader, type FloatingControlIconButtonProps } from "../../codex/ui/viewer-header";
import { ViewerTitleButton, ViewerTitleMenu } from "../../codex/ui/viewer-title-menu";
import { PageArchiveDialog } from "../dialogs/page-archive-dialog";
import { PageRenameDialog } from "../dialogs/page-rename-dialog";
import { PageDotsControls } from "../dialogs/page-dots-controls";
import { canDeletePage, pageMenuItems } from "../menus/page-actions";
import { pageMentionPrompt, startChatWithPrompt } from "../navigation";
import { pagePinKey, usePage, useSpacesStore } from "../state";
import { headerMessages, pageMessages } from "./messages";
import type { PageEditorHandle } from "./page-editor";
import { nextOptionId, SlashMenuList } from "./slash-menu";
import { slashOptions } from "./slash-options";
import { usePageEditorUiStore } from "./state/page-editor-ui-store";

const headerCss = { Header: "_Header_2v07i_1" } as const;

type EditingAction = "generate" | "image" | "visualize" | "insert";

/** `it` / `at` in the title-menu chunk. */
const editingActionIcons: Record<EditingAction, SizedIconSource> = {
  generate: { assets: { 16: magicWandLight16, 20: magicWandLight20 } },
  image: { 16: PhotoLight16Icon, 20: PhotoLight20Icon },
  visualize: { assets: { 16: shapesLight16, 20: shapesLight20 } },
  insert: { assets: { 16: plusSquareLight16, 20: plusSquareLight20 } },
};

const editingActionMessages = {
  generate: headerMessages.generate,
  image: headerMessages.image,
  visualize: headerMessages.visualize,
  insert: headerMessages.insert,
} as const;

const quickActions = ["generate", "image", "visualize"] as const;

function preventMouseDown(event: { preventDefault: () => void }) {
  event.preventDefault();
}

/** `An` with `appearance="viewer"` (filename-menu-actions chunk), labelled by `Nt` for a Page editing action. */
function EditingActionButton({ action, ...rest }: Omit<FloatingControlIconButtonProps, "children"> & { action: EditingAction }) {
  const intl = useIntl();
  const label = intl.formatMessage(editingActionMessages[action]);
  return (
    <Tooltip tooltipContent={label} triggerPopupOpen={rest["aria-expanded"] === true}>
      <FloatingControlIconButton {...rest} aria-label={label} uniform>
        <SizedIcon icon={editingActionIcons[action]} />
      </FloatingControlIconButton>
    </Tooltip>
  );
}

/** `R0`: Generate / Image / Visualize shortcuts and the Insert menu, all inserting below the current block. */
function PageEditingTools({ editor }: { editor: RefObject<PageEditorHandle | null> }) {
  const intl = useIntl();
  const capabilities = usePageEditorUiStore((state) => state.capabilities);
  usePageEditorUiStore((state) => state.generating);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ReturnType<typeof slashOptions>>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const listId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ value: "", time: 0 });
  /** "Page" creates the subpage once the menu has closed, so the new Page's title can take focus. */
  const deferredSubpage = useRef(false);
  const maxHeight = menuContentMaxHeight("tall", "var(--radix-popover-content-available-height)");
  const label = intl.formatMessage(headerMessages.insert);

  const availableOptions = () => {
    const handle = editor.current;
    return handle == null ? [] : slashOptions(capabilities, handle.slashContext(), { insertBelow: true });
  };
  const currentOptionId = options.find((option) => option.id === highlightedId)?.id ?? options[0]?.id;

  useEffect(() => {
    if (open) contentRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [currentOptionId, open]);

  const select = (commandId: string) => {
    if (!availableOptions().some((option) => option.id === commandId)) return;
    setOpen(false);
    if (commandId === "page") deferredSubpage.current = true;
    else editor.current?.runCommand(commandId, { insertBelow: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.shiftKey && event.key.length !== 1)) return;
    const next = nextOptionId(options, currentOptionId, event.key);
    if (next != null) {
      event.preventDefault();
      setHighlightedId(next);
    } else if (event.key === "Enter" || (event.key === " " && Date.now() - typeahead.current.time >= 1000)) {
      event.preventDefault();
      if (!event.repeat && currentOptionId != null) select(currentOptionId);
    } else if (event.key.length === 1) {
      const time = Date.now();
      typeahead.current = { value: `${time - typeahead.current.time < 1000 ? typeahead.current.value : ""}${event.key}`, time };
      const match = options.find((option) => intl.formatMessage(option.label).toLocaleLowerCase(intl.locale).startsWith(typeahead.current.value.toLocaleLowerCase(intl.locale)));
      if (match != null) setHighlightedId(match.id);
    }
  };

  const enabledIds = new Set(availableOptions().map((option) => option.id));
  return (
    <>
      <span className="inline-flex items-center gap-1" data-viewer-header-collapsible="">
        {quickActions.map((action) => (
          <EditingActionButton key={action} action={action} disabled={!enabledIds.has(action)} onMouseDown={preventMouseDown} onClick={() => select(action)} />
        ))}
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOptions(next ? availableOptions() : []);
          setOpen(next);
          setHighlightedId(null);
          typeahead.current = { value: "", time: 0 };
        }}
      >
        <PopoverTrigger asChild>
          <EditingActionButton action="insert" disabled={editor.current == null} onMouseDown={preventMouseDown} />
        </PopoverTrigger>
        <PopoverContent
          ref={contentRef}
          className="z-50 m-px outline-hidden"
          aria-label={label}
          aria-activedescendant={currentOptionId == null ? undefined : `${listId}-${currentOptionId}`}
          align="start"
          asChild
          role="menu"
          tabIndex={-1}
          unstyled
          style={{ maxHeight }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (deferredSubpage.current) {
              deferredSubpage.current = false;
              event.preventDefault();
              editor.current?.runCommand("page", { insertBelow: true });
            } else if (editor.current?.hasFocus() || document.activeElement?.closest("[role=dialog]") != null) event.preventDefault();
          }}
          onKeyDown={onKeyDown}
        >
          <SuggestionSurface variant="floating" width="panelWide">
            <SlashMenuList id={listId} maxHeight={maxHeight} options={options} query="" currentOptionId={currentOptionId} onHighlight={setHighlightedId} onSelect={select} />
          </SuggestionSurface>
        </PopoverContent>
      </Popover>
    </>
  );
}

/** `It`: lock badge for viewers who cannot edit the Page directly. */
function ReadOnlyStatus({ canRequestChanges }: { canRequestChanges: boolean }) {
  const intl = useIntl();
  return (
    <Tooltip side="bottom" tooltipContent={intl.formatMessage(canRequestChanges ? pageMessages.requestChangesExplanation : pageMessages.readOnlyExplanation)}>
      <span className="inline-flex shrink-0 items-center text-secondary select-none no-drag" role="status" tabIndex={0}>
        <LockLight12Icon />
        <span className="sr-only">
          <FormattedMessage {...(canRequestChanges ? pageMessages.requestChangesLabel : pageMessages.readOnlyLabel)} />
        </span>
      </span>
    </Tooltip>
  );
}

/** `AL`: toggles the comments sidebar. */
function CommentsToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const intl = useIntl();
  const label = intl.formatMessage(headerMessages.toggleComments);
  return (
    <Tooltip tooltipContent={label} triggerPopupOpen={active}>
      <FloatingControlButton aria-label={label} aria-expanded={active} aria-pressed={active} variant={active ? "selected" : "default"} onClick={onToggle} uniform>
        <SizedIcon icon={{ 16: TextBubbleLight16Icon, 20: TextBubbleLight20Icon }} />
      </FloatingControlButton>
    </Tooltip>
  );
}

type PageDialog = "archive" | "rename" | null;

const pageIcon = <SizedIcon icon={{ 16: TextPageLight16Icon, 20: TextPageLight20Icon }} />;

type ContextMenuDropdownProps = Parameters<NonNullable<ComponentProps<typeof ContextMenu>["renderDropdown"]>>[0];

interface PageTitleMenuProps {
  pageId: string;
  /** Opens "Bots on this page". */
  onShare: (() => void) | undefined;
  onDialog: (dialog: PageDialog) => void;
}

/** `St` (title-menu chunk) inside the companion tab's page `ContextMenu`: page actions plus "Show attribution" and "Page activity". */
function PageTitleMenu({ pageId, onShare, onDialog }: PageTitleMenuProps) {
  const intl = useIntl();
  const navigate = useNavigate();
  const page = usePage(pageId);
  const showAttribution = usePageEditorUiStore((state) => state.showAttribution);
  const setShowAttribution = usePageEditorUiStore((state) => state.setShowAttribution);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const title = page?.title?.trim() || intl.formatMessage(pageMessages.untitled);
  const attributionIcon = <SizedIcon icon={{ 16: SquareAndPencilLight16Icon, 20: SquareAndPencilLight20Icon }} />;

  const getItems = (): ContextMenuItem[] => {
    const current = useSpacesStore.getState().pages[pageId];
    if (current == null) return [];
    const pinKey = pagePinKey(pageId);
    const requestChanges = current.interaction_mode === "request_changes";
    const items = pageMenuItems({
      page: current,
      isPinned: useSpacesStore.getState().pinnedKeys.includes(pinKey),
      onTogglePinned: () => useSpacesStore.getState().setPinned(pinKey, !useSpacesStore.getState().pinnedKeys.includes(pinKey)),
      onRename: () => onDialog("rename"),
      onArchive: canDeletePage(current) && !requestChanges ? () => onDialog("archive") : undefined,
      onNewChat: () => startChatWithPrompt(navigate, pageMentionPrompt(pageId, current.title)),
      onShare:
        onShare == null
          ? undefined
          : () => {
              if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
              onShare();
            },
    });
    items.push(
      { id: "page-editor-separator", type: "separator" },
      {
        id: "page-attribution",
        type: "checkbox",
        checked: usePageEditorUiStore.getState().showAttribution,
        closeOnSelect: true,
        icon: attributionIcon,
        message: headerMessages.attributionToggle,
        onSelect: () => setShowAttribution(!usePageEditorUiStore.getState().showAttribution),
      },
      { id: "page-activity", icon: <SizedIcon icon={{ 16: AnalyticsLight16Icon, 20: AnalyticsLight20Icon }} />, enabled: false, message: headerMessages.activity },
    );
    return items;
  };

  const renderDropdown = ({ items: _items, onSelect: _onSelect, renderItemContent: _renderItemContent, renderSubmenu: _renderSubmenu, align: _align, contentWidth: _contentWidth, ...dropdown }: ContextMenuDropdownProps) => (
    <ViewerTitleMenu {...dropdown} title={title} icon={pageIcon} />
  );

  return (
    <ContextMenu
      trigger="click"
      getItems={getItems}
      renderDropdown={renderDropdown}
      renderItem={(item) =>
        item.id === "page-attribution" ? (
          <Menu.CheckboxItem checked={showAttribution} closeOnSelect={item.closeOnSelect} leftIcon={attributionIcon} onCheckedChange={setShowAttribution}>
            <FormattedMessage {...headerMessages.attributionToggle} />
          </Menu.CheckboxItem>
        ) : undefined
      }
    >
      <ViewerTitleButton ref={triggerRef} title={title} icon={pageIcon} />
    </ContextMenu>
  );
}

export interface PageHeaderProps {
  pageId: string;
  editor: RefObject<PageEditorHandle | null>;
  canWrite: boolean;
  requestChanges: boolean;
  canComment: boolean;
  documentReady: boolean;
  /** Inside a panel tab rather than the app shell header. */
  inset?: boolean;
  /** Overlays the content, fading it out beneath the header. */
  contentFade?: boolean;
}

/**
 * `Tn` (filename-menu-actions chunk) for a Page, inside the sharing controls (`iT`) as the content chunk's page
 * component composes them: title menu, access status, editing tools, Request edit access, comments and sharing.
 */
export function PageHeader({ pageId, editor, canWrite, requestChanges, canComment, documentReady, inset = false, contentFade = false }: PageHeaderProps) {
  const intl = useIntl();
  const page = usePage(pageId);
  const commentsOpen = usePageEditorUiStore((state) => state.commentsOpen);
  const setCommentsOpen = usePageEditorUiStore((state) => state.setCommentsOpen);
  const [dialog, setDialog] = useState<PageDialog>(null);
  const canEdit = canWrite && documentReady;
  const readOnly = !canWrite && page != null;

  return (
    <>
      <PageDotsControls disabled={page == null || requestChanges} pageId={pageId}>
        {({ controls, onShare }) => (
          <div className="@container/page-toolbar w-full min-w-0">
            <ViewerHeader
              className={inset ? "w-full" : `${headerCss.Header} w-full`}
              contentFade={contentFade}
              density="surface"
              inset={inset}
              placement={contentFade ? "overlay" : undefined}
              leading={[
                {
                  id: "title",
                  content: <div className="flex min-w-0 items-center">{page == null ? null : <PageTitleMenu pageId={pageId} onShare={onShare} onDialog={setDialog} />}</div>,
                  collapsePriority: 1,
                },
                { id: "read-only", content: readOnly ? <ReadOnlyStatus canRequestChanges={requestChanges} /> : null, hidePriority: 2 },
                {
                  id: "editing",
                  content: canEdit ? (
                    <FloatingControlGroup label={intl.formatMessage(headerMessages.editingTools)}>
                      <PageEditingTools editor={editor} />
                    </FloatingControlGroup>
                  ) : null,
                  collapsePriority: 2,
                },
              ]}
              trailing={[
                {
                  id: "comments",
                  content: canComment && documentReady ? (
                    <FloatingControlGroup label={intl.formatMessage(headerMessages.comments)}>
                      <CommentsToggle active={commentsOpen} onToggle={() => setCommentsOpen(!commentsOpen)} />
                    </FloatingControlGroup>
                  ) : null,
                },
                {
                  id: "sharing",
                  content:
                    controls == null ? null : (
                      <FloatingControlGroup hideWhenEmpty label={intl.formatMessage(headerMessages.sharing)}>
                        {controls}
                      </FloatingControlGroup>
                    ),
                  collapsePriority: 4,
                },
              ]}
            />
          </div>
        )}
      </PageDotsControls>
      {dialog === "rename" && page != null ? <PageRenameDialog pageId={pageId} title={page.title ?? ""} onSaved={() => setDialog(null)} onClose={() => setDialog(null)} /> : null}
      {dialog === "archive" && page != null ? <PageArchiveDialog pageId={pageId} pageTitle={page.title} documentType={page.document_type} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
