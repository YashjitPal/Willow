import clsx from "clsx";
import { Fragment, type FormEvent, type ReactElement, type ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ChevronDownMdLight16Icon } from "../icons/chevron-down-md-light-16";
import { Avatar } from "./avatar";
import { Dialog, DialogDescription, DialogTitle, type DialogSize, type DialogVariant } from "./dialog";
import { DialogBody, DialogFooter, DialogHeader, DialogSection } from "./dialog-layout";
import { DsButton } from "./ds-button";
import { DsMenu } from "./ds-menu";
import { LoadingShimmer } from "./loading-shimmer";
import { ScrollArea } from "./scroll-area";
import { Spinner } from "./spinner";

export interface ShareDialogLayoutProps {
  children?: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  collapseEmptyContent?: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}

/** `uz` (app-initial): pinned header, divider-faded scrolling content and footer; a `<form>` when it submits. */
export function ShareDialogLayout({ children, header, footer, collapseEmptyContent = false, onSubmit }: ShareDialogLayoutProps) {
  const collapsed = collapseEmptyContent && children == null;
  const className = clsx("grid grid-cols-1", collapsed ? "grid-rows-[minmax(0,max-content)_auto]" : "grid-rows-[minmax(0,max-content)_1fr_auto]");
  const content = (
    <>
      <div className="min-h-0 overflow-y-auto overscroll-contain">{header}</div>
      {collapsed ? null : (
        <ScrollArea className="relative -mx-5 flex min-h-24 flex-col" fade="divider" scrollClassName="min-h-0 overflow-y-auto overscroll-contain px-5">
          <div className="py-5">{children}</div>
        </ScrollArea>
      )}
      <DialogFooter className="shrink-0 flex-wrap" expandSingleButton={false}>
        {footer}
      </DialogFooter>
    </>
  );
  if (onSubmit == null) {
    return (
      <DialogBody className={className} size="scrollable">
        {content}
      </DialogBody>
    );
  }
  return (
    <DialogBody className={className} as="form" size="scrollable" onSubmit={onSubmit}>
      {content}
    </DialogBody>
  );
}

export interface ShareDialogShellProps {
  children?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  headerContent?: ReactNode;
  headerActions?: ReactNode;
  footer: ReactNode;
  collapseEmptyContent?: boolean;
  /** Blocks every dismissal path (and hides the close button) while an action runs. */
  isDismissalDisabled?: boolean;
  size?: DialogSize;
  variant?: DialogVariant;
  onClose: () => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** Receives the dialog content element so popovers inside can portal into it. */
  onPortalContainerChange?: (container: HTMLElement) => void;
  onSubmit?: () => void;
}

/** `t` in dialog-shell: the always-open frame of the share and remove-access dialogs. */
export function ShareDialogShell({
  children,
  title,
  subtitle,
  headerContent,
  headerActions,
  footer,
  collapseEmptyContent = false,
  isDismissalDisabled = false,
  size,
  variant = "opaque",
  onClose,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onPortalContainerChange,
  onSubmit,
}: ShareDialogShellProps) {
  const header = (
    <>
      <div className="mb-2 flex items-center gap-2 pe-8">
        <DialogHeader
          className="min-w-0 flex-1"
          title={<DialogTitle className="contents">{title}</DialogTitle>}
          titleClassName="truncate"
          subtitle={subtitle == null ? undefined : <DialogDescription className="contents">{subtitle}</DialogDescription>}
        />
        {headerActions}
      </div>
      {headerContent}
    </>
  );
  return (
    <Dialog
      open
      contentOverflow="visible"
      contentProps={{
        ...(subtitle == null ? { "aria-describedby": undefined } : {}),
        shouldStopPointerDownPropagation: false,
        onCloseAutoFocus,
        onOpenAutoFocus: (event) => {
          if (event.currentTarget instanceof HTMLElement) onPortalContainerChange?.(event.currentTarget);
          onOpenAutoFocus?.(event);
        },
      }}
      shouldIgnoreClickOutside={isDismissalDisabled}
      showDialogClose={!isDismissalDisabled}
      size={size}
      variant={variant}
      onOpenChange={(open) => {
        if (!open && !isDismissalDisabled) onClose();
      }}
    >
      <ShareDialogLayout
        collapseEmptyContent={collapseEmptyContent}
        header={header}
        footer={footer}
        onSubmit={
          onSubmit == null
            ? undefined
            : (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!isDismissalDisabled) onSubmit();
              }
        }
      >
        {children}
      </ShareDialogLayout>
    </Dialog>
  );
}

export interface ShareDialogFooterProps {
  copyLink?: ReactNode;
  disabled?: boolean;
  hasPendingAccessChange: boolean;
  hasPendingInvitees: boolean;
  isSaving: boolean;
  isBusy?: boolean;
  isCancelDisabled?: boolean;
  inviteLabel?: ReactNode;
  saveLabel?: ReactNode;
  onCancel: () => void;
  onClose: () => void;
}

/** `L` in modal-footer: copy-link slot, Cancel while changes are staged, and Done / Save / Invite / Saving. */
export function ShareDialogFooter({
  copyLink,
  disabled,
  hasPendingAccessChange,
  hasPendingInvitees,
  isSaving,
  isBusy = isSaving,
  isCancelDisabled = isBusy,
  inviteLabel,
  saveLabel,
  onCancel,
  onClose,
}: ShareDialogFooterProps) {
  const hasPendingChange = hasPendingAccessChange || hasPendingInvitees;
  let label: ReactNode;
  if (isSaving) {
    label = <FormattedMessage id="shareDialog.primaryAction.saving" defaultMessage="Saving" description="Button label while a share dialog saves permissions or invites" />;
  } else if (hasPendingInvitees) {
    label = inviteLabel ?? (
      <FormattedMessage id="shareDialog.primaryAction.invite" defaultMessage="Invite" description="Button label for inviting selected people or groups in a share dialog" />
    );
  } else if (hasPendingChange) {
    label = saveLabel ?? <FormattedMessage id="shareDialog.primaryAction.save" defaultMessage="Save" description="Button label for saving a share dialog access change" />;
  } else {
    label = <FormattedMessage id="shareDialog.done" defaultMessage="Done" description="Button closing the sharing dialog when there are no unsaved changes" />;
  }
  return (
    <>
      <div className="me-auto">{copyLink}</div>
      {hasPendingChange && (
        <DsButton color="secondary" size="xl" type="button" disabled={isCancelDisabled} onClick={onCancel}>
          <FormattedMessage id="shareDialog.primaryAction.cancel" defaultMessage="Cancel" description="Button label for cancelling staged changes in a share dialog" />
        </DsButton>
      )}
      <DsButton
        color="primary"
        size="xl"
        type={hasPendingChange ? "submit" : "button"}
        disabled={isSaving || isBusy || (hasPendingChange && disabled)}
        aria-busy={isSaving}
        onClick={hasPendingChange ? undefined : onClose}
      >
        {isSaving ? <span role="status">{label}</span> : label}
        {isSaving && <Spinner className="icon-2xs" />}
      </DsButton>
    </>
  );
}

export interface ShareSectionProps {
  children?: ReactNode;
  kind?: "people" | "link";
  title?: ReactNode;
  variant?: "default" | "selection";
}

/** `iz` (app-initial): a titled share-dialog section ("Link access" / "Who has access" by default). */
export function ShareSection({ children, kind = "people", title, variant = "default" }: ShareSectionProps) {
  return (
    <DialogSection spacing="large">
      <div className={variant === "selection" ? "flex max-h-40 min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-default p-3" : "flex flex-col gap-3"}>
        <div className={variant === "selection" ? "sr-only" : "text-sm font-medium select-none"}>
          {title ??
            (kind === "link" ? (
              <FormattedMessage id="shareDialog.linkAccess" defaultMessage="Link access" description="Heading above the sharing setting for who can open the link" />
            ) : (
              <FormattedMessage
                id="shareDialog.collaborators.heading"
                defaultMessage="Who has access"
                description="Heading above the audience, people, groups, and permissions in a share dialog"
              />
            ))}
        </div>
        {children}
      </div>
    </DialogSection>
  );
}

export interface ShareAccessRowProps {
  avatar?: ReactNode;
  children?: ReactNode;
  colorKey?: string;
  label: ReactNode;
  avatarLabel?: string;
  size?: "default" | "compact";
  stackActionsOnNarrow?: boolean;
  secondaryLabel?: ReactNode;
  trailingContent?: ReactNode;
}

/** `nz` (app-initial): avatar, name and secondary line, with the permission control trailing. */
export function ShareAccessRow({
  avatar,
  children,
  colorKey,
  label,
  avatarLabel,
  size = "default",
  stackActionsOnNarrow = false,
  secondaryLabel,
  trailingContent,
}: ShareAccessRowProps) {
  const compact = size === "compact";
  const row = (
    <>
      <div className={clsx(compact ? "flex min-h-9 items-center gap-2" : "flex items-center gap-3", stackActionsOnNarrow && "@max-md:flex-wrap")}>
        <span className={clsx("flex shrink-0 items-center justify-center", compact ? "size-6" : "size-8")}>
          {avatar ?? <Avatar alt="" colorKey={colorKey} name={avatarLabel ?? (typeof label === "string" ? label : "")} size={compact ? "sm" : "md"} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{label}</div>
          {secondaryLabel == null ? null : <div className="truncate text-xs text-codex-description">{secondaryLabel}</div>}
        </div>
        {stackActionsOnNarrow ? <div className="@max-md:w-full">{trailingContent}</div> : trailingContent}
      </div>
      {children == null ? null : <div className={compact ? "ps-8" : "ps-12"}>{children}</div>}
    </>
  );
  return stackActionsOnNarrow ? <div className="@container w-full">{row}</div> : row;
}

/** `ZR` (app-initial): the disabled link-access control shown before the setting loads. */
export function ShareLinkAccessLoading() {
  return (
    <div className="flex h-10 items-center">
      <DsButton color="primary" variant="ghost" size="2xl" pill={false} gutterSize="sm" disabled>
        <FormattedMessage
          id="shareDialog.loadingLinkAccess"
          defaultMessage="Loading link access…"
          description="Disabled sharing control shown while the current link access setting is loading; no access setting is known yet"
        />
        <ChevronDownMdLight16Icon />
      </DsButton>
    </div>
  );
}

/** `ez` (app-initial): placeholder access rows while sharing settings load. */
export function ShareAccessLoading({ layout = "collaborators" }: { layout?: "collaborators" | "access-and-owner" | "owner" }) {
  return (
    <div className={layout === "access-and-owner" ? "flex flex-col gap-3" : "flex flex-col gap-2"} role="status" aria-busy="true">
      <span className="sr-only">
        <FormattedMessage id="shareDialog.loading" defaultMessage="Loading sharing settings…" description="Status while a sharing dialog loads current permissions" />
      </span>
      {layout === "access-and-owner" ? (
        <div className="flex h-10 items-center gap-3" aria-hidden>
          <div className="size-8 shrink-0 overflow-hidden rounded-lg">
            <LoadingShimmer size="fill" />
          </div>
          <LoadingShimmer className="w-36" size="md" />
        </div>
      ) : null}
      <div aria-hidden>
        <ShareAccessRow
          avatar={
            <div className="size-8 overflow-hidden rounded-full">
              <LoadingShimmer size="fill" />
            </div>
          }
          label={
            <span className="flex h-lh items-center">
              <LoadingShimmer className="w-36" size="md" />
            </span>
          }
          secondaryLabel={
            <span className="flex h-lh items-center">
              <LoadingShimmer className="w-36" size="md" />
            </span>
          }
          trailingContent={<LoadingShimmer className={layout === "owner" ? "me-4 w-12" : "w-12"} size="md" />}
        />
      </div>
    </div>
  );
}

export interface ShareAccessEntry {
  id: string;
  label: string;
  row: ReactNode;
  isTeam?: boolean;
  isOwner?: boolean;
  isSelf?: boolean;
}

/** `S` in access-list: people first (owner, then you), then teams under a "Teams" subheading, each alphabetical. */
export function ShareAccessList({ entries }: { entries: ShareAccessEntry[] }) {
  const { locale } = useIntl();
  const sorted = [...entries].sort(
    (a, b) =>
      Number(!!a.isTeam) - Number(!!b.isTeam) ||
      Number(!!b.isOwner) - Number(!!a.isOwner) ||
      Number(!!b.isSelf) - Number(!!a.isSelf) ||
      a.label.localeCompare(b.label, locale, { sensitivity: "base" }),
  );
  return (
    <>
      {sorted.map((entry, index) => (
        <Fragment key={entry.id}>
          {entry.isTeam && index > 0 && !sorted[index - 1].isTeam && (
            <div className="mt-2 text-sm font-medium text-secondary select-none">
              <FormattedMessage
                id="shareDialog.accessList.teams"
                defaultMessage="Teams"
                description="Subheading separating teams with access from individual people in a sharing dialog; shown only when both people and teams have access"
              />
            </div>
          )}
          {entry.row}
        </Fragment>
      ))}
    </>
  );
}

export interface SharePermissionOption<T extends string> {
  value: T;
  ariaLabel?: string;
  description?: string;
  disabled?: boolean;
}

export interface SharePermissionDropdownProps<T extends string> {
  alignOffset?: number;
  options: SharePermissionOption<T>[];
  disabled?: boolean;
  indicatorVariant?: "radio" | "checkmark";
  renderLabel: (value: T) => ReactNode;
  mixed?: boolean;
  opticallyAlign?: "start" | "end";
  removeLabel?: ReactNode;
  sideOffset?: number;
  size?: "sm" | "md";
  variant?: "default" | "inline";
  value: T;
  onChange?: (value: T) => void;
  onRemoveAccess?: () => void;
}

/** `P` in modal-permission-dropdown: role menu with an optional danger "remove" item. */
export function SharePermissionDropdown<T extends string>({
  alignOffset,
  options,
  disabled = false,
  indicatorVariant = "checkmark",
  renderLabel,
  mixed = false,
  opticallyAlign,
  removeLabel,
  sideOffset,
  size = "sm",
  variant = "default",
  value,
  onChange,
  onRemoveAccess,
}: SharePermissionDropdownProps<T>) {
  return (
    <span className="inline-flex" role="presentation" onMouseDown={(event) => event.stopPropagation()}>
      <DsMenu>
        <DsMenu.Trigger disabled={disabled}>
          <DsButton
            color="secondary"
            variant="ghost"
            size={size}
            pill
            gutterSize={variant === "inline" ? "sm" : undefined}
            opticallyAlign={opticallyAlign}
            disabled={disabled}
          >
            {mixed ? (
              <FormattedMessage
                id="shareDialog.mixedRoles"
                defaultMessage="Mixed"
                description="Role selector label when selected sharing recipients have different permissions"
              />
            ) : (
              renderLabel(value)
            )}
            <ChevronDownMdLight16Icon />
          </DsButton>
        </DsMenu.Trigger>
        <DsMenu.Content align="end" alignOffset={alignOffset} minWidth="auto" sideOffset={sideOffset}>
          <DsMenu.RadioGroup
            value={mixed ? "" : value}
            onChange={(next) => {
              const option = options.find((candidate) => candidate.value === next);
              if (option != null) onChange?.(option.value);
            }}
          >
            {options.map((option) => (
              <DsMenu.RadioItem
                key={option.value}
                indicatorVariant={indicatorVariant}
                value={option.value}
                disabled={disabled || option.disabled}
                aria-label={option.ariaLabel}
                aria-description={option.description}
              >
                <span className="flex max-w-64 min-w-0 flex-1 flex-col">
                  <span>{renderLabel(option.value)}</span>
                  {option.description == null ? null : <span className="text-sm text-pretty whitespace-normal text-secondary">{option.description}</span>}
                </span>
              </DsMenu.RadioItem>
            ))}
          </DsMenu.RadioGroup>
          {onRemoveAccess == null ? null : (
            <>
              <DsMenu.Separator />
              <DsMenu.Item color="danger" disabled={disabled} onSelect={onRemoveAccess}>
                {removeLabel}
              </DsMenu.Item>
            </>
          )}
        </DsMenu.Content>
      </DsMenu>
    </span>
  );
}

export interface ShareAccessModeOption<T extends string> {
  value: T;
  icon?: ReactElement;
  description?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
}

export interface ShareAccessModeSelectProps<T extends string> {
  disabled?: boolean;
  iconVariant?: "plain" | "thumbnail";
  options: ShareAccessModeOption<T>[];
  value: T;
  renderLabel: (value: T) => ReactNode;
  onChange: (value: T) => void;
}

/** `zR` (app-initial): the link-access audience menu. */
export function ShareAccessModeSelect<T extends string>({ disabled = false, iconVariant = "plain", options, value, renderLabel, onChange }: ShareAccessModeSelectProps<T>) {
  const selected = options.find((option) => option.value === value);
  return (
    <DsMenu>
      <DsMenu.Trigger disabled={disabled}>
        <DsButton
          color="primary"
          variant="ghost"
          size="2xl"
          pill={false}
          gutterSize="sm"
          opticallyAlign={iconVariant === "thumbnail" ? "start" : undefined}
          disabled={disabled}
        >
          {iconVariant === "thumbnail" ? <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-text/10">{selected?.icon}</span> : selected?.icon}
          <span className="truncate leading-normal">{renderLabel(value)}</span>
          <ChevronDownMdLight16Icon />
        </DsButton>
      </DsMenu.Trigger>
      <DsMenu.Content align="start">
        <DsMenu.RadioGroup
          value={value}
          onChange={(next) => {
            const option = options.find((candidate) => candidate.value === next);
            if (option != null) onChange(option.value);
          }}
        >
          {options
            .filter((option) => !option.hidden)
            .map((option) => (
              <DsMenu.RadioItem key={option.value} indicatorVariant="checkmark" value={option.value} disabled={disabled || option.disabled}>
                {option.icon}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{renderLabel(option.value)}</span>
                  {option.description == null ? null : <span className="text-sm text-secondary">{option.description}</span>}
                </span>
              </DsMenu.RadioItem>
            ))}
        </DsMenu.RadioGroup>
      </DsMenu.Content>
    </DsMenu>
  );
}
