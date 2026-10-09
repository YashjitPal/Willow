import clsx from "clsx";
import { ContextMenu as RadixContextMenu } from "radix-ui";
import {
  Fragment,
  cloneElement,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { FormattedMessage, useIntl, type IntlShape, type MessageDescriptor } from "react-intl";
import { LegacySharedSvi9324Icon } from "../icons/legacy-shared-svi-9324";
import { LegacySharedT7A513Icon } from "../icons/legacy-shared-t7-a513";
import { acceleratorToAriaKeyShortcuts, formatAccelerator } from "./accelerator";
import { DropdownMenu, type DropdownMenuAlign, type DropdownMenuProps } from "./dropdown-menu";
import { Menu, menuClasses, type MenuContentWidth, type MenuItemTone } from "./menu";
import { OverlayOwnerContext, useWindowZoom } from "./overlay-context";
import { Tooltip } from "./tooltip";
import { useStableCallback } from "./use-stable-callback";
import { getPortalRoot } from "./portal-root";

type MessageValues = Record<string, string | number | boolean | null | undefined | Date>;

export interface ContextMenuItem {
  id: string;
  type?: "normal" | "label" | "separator" | "checkbox" | "radio";
  message?: MessageDescriptor;
  messageValues?: MessageValues;
  tooltipMessage?: MessageDescriptor;
  tooltipMessageValues?: MessageValues;
  enabled?: boolean;
  checked?: boolean;
  closeOnSelect?: boolean;
  /** Element, component, image URL or `data:image/svg+xml` mask URL. */
  icon?: ReactNode | ComponentType;
  tone?: MenuItemTone;
  href?: string;
  /** Electron accelerator, e.g. `CmdOrCtrl+Shift+K`. */
  accelerator?: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onSelect?: () => void;
  /** Runs `onSelect` after the menu has closed and focus has been restored. */
  selectAfterClose?: boolean;
  submenu?: ContextMenuItem[];
}

interface ResolvedContextMenuItem extends ContextMenuItem {
  nativeLabel: string;
  nativeTooltip?: string;
  submenu?: ResolvedContextMenuItem[];
}

type SelectItem = (item: ContextMenuItem, event: Event) => void;

export interface ContextMenuRenderDropdownProps extends DropdownMenuProps {
  items: ContextMenuItem[];
  onSelect: SelectItem;
  renderItemContent: (item: ContextMenuItem) => ReactNode;
  renderSubmenu: (item: ContextMenuItem, onSelect?: SelectItem) => ReactNode;
}

export interface ContextMenuTriggerProps {
  "aria-expanded"?: boolean;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface ContextMenuProps {
  items?: ContextMenuItem[];
  /** Called when the menu opens; may resolve asynchronously. */
  getItems?: () => ContextMenuItem[] | Promise<ContextMenuItem[]>;
  children: ReactElement<ContextMenuTriggerProps>;
  /** `contextmenu` opens at the pointer on right click; `click` renders a dropdown anchored to `children`. */
  trigger?: "contextmenu" | "click";
  /** Opts out of the desktop app's native menu; the clone always renders the web menus. */
  disableNative?: boolean;
  preserveBrowserContextMenu?: boolean;
  align?: DropdownMenuAlign;
  contentWidth?: MenuContentWidth;
  loadingMessage?: MessageDescriptor;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  onAfterClose?: () => void;
  renderItem?: (item: ContextMenuItem, onSelect: SelectItem) => ReactNode;
  renderDropdown?: (props: ContextMenuRenderDropdownProps) => ReactNode;
  /** Shortcut labels by item id, overriding the formatted accelerators. */
  shortcuts?: Record<string, ReactNode>;
  awaitBeforeOpen?: boolean;
  onBeforeOpen?: () => void | Promise<void>;
}

function resolveItems(items: ContextMenuItem[], formatMessage: IntlShape["formatMessage"]): ResolvedContextMenuItem[] {
  return items.map((item) => {
    if (item.type === "separator") return { ...item, nativeLabel: "", submenu: undefined };
    return {
      ...item,
      nativeLabel: item.message ? formatMessage(item.message, item.messageValues) : item.id,
      nativeTooltip: item.tooltipMessage ? formatMessage(item.tooltipMessage, item.tooltipMessageValues) : undefined,
      submenu: item.submenu ? resolveItems(item.submenu, formatMessage) : undefined,
    };
  });
}

function itemLabel(item: ContextMenuItem): ReactNode {
  return item.message ? <FormattedMessage {...item.message} values={item.messageValues} /> : item.id;
}

function itemTooltip(item: ContextMenuItem) {
  return item.tooltipMessage ? <FormattedMessage {...item.tooltipMessage} values={item.tooltipMessageValues} /> : null;
}

function shortcutLabel(accelerator: string | undefined) {
  return accelerator == null ? undefined : formatAccelerator(accelerator);
}

function hasIcon(item: ContextMenuItem) {
  return item.icon != null;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value != null && "then" in value && typeof value.then === "function";
}

export interface ContextMenuItemContentProps {
  checked?: boolean;
  icon?: ReactNode | ComponentType;
  label?: ReactNode;
  /** Keeps an empty icon slot so labels align with siblings that have icons. */
  reserveIcon?: boolean;
  shortcutLabel?: ReactNode;
  showCheckbox?: boolean;
  showChevron?: boolean;
}

/** Row content of context-menu items: check slot, icon, label, shortcut, submenu chevron. */
export function ContextMenuItemContent({ checked, icon, label, reserveIcon, shortcutLabel, showCheckbox, showChevron }: ContextMenuItemContentProps) {
  let rendered: ReactNode = typeof icon === "function" ? createElement(icon) : (icon as ReactNode);
  if (typeof rendered === "string" && rendered && !rendered.startsWith("data:image/svg+xml")) {
    rendered = <img className="icon-sm shrink-0 object-contain" alt="" src={rendered} />;
  }
  const maskUrl = typeof rendered === "string" ? rendered : undefined;
  return (
    <span className="flex w-full items-center gap-1.5">
      {showCheckbox ? <span className={menuClasses.leadingIcon}>{checked ? <LegacySharedT7A513Icon aria-hidden className="icon-xs" /> : null}</span> : null}
      {icon || (reserveIcon && !showCheckbox) ? (
        <span className={menuClasses.leadingIcon}>
          {rendered != null && typeof rendered !== "string" ? (
            rendered
          ) : (
            <span
              aria-hidden
              className={clsx("icon-sm shrink-0", maskUrl && "bg-current")}
              style={maskUrl ? { maskImage: `url("${maskUrl}")`, maskPosition: "center", maskRepeat: "no-repeat", maskSize: "contain" } : undefined}
            />
          )}
        </span>
      ) : null}
      <span className="truncate">{label}</span>
      {shortcutLabel == null ? null : <span aria-hidden className="ms-auto shrink-0 text-xs text-codex-description">{shortcutLabel}</span>}
      {showChevron ? <LegacySharedSvi9324Icon className="icon-xs ms-auto opacity-50" data-rtl-flip="" /> : null}
    </span>
  );
}

const CONTEXT_ITEM_CLASS =
  "outline-hidden flex min-h-[var(--app-menu-item-height,0px)] items-center justify-center rounded-xl p-[var(--app-menu-item-padding,calc(var(--spacing)*1.5))] text-sm cursor-interaction hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover";

/**
 * Item-driven context menu (`iC` in the bundles): right-click opens a Radix context menu at the pointer;
 * `trigger="click"` renders the items in a `DropdownMenu`.
 */
export function ContextMenu({
  items,
  getItems,
  children,
  trigger = "contextmenu",
  align,
  contentWidth,
  loadingMessage,
  onOpenChange,
  open,
  onCloseAutoFocus,
  onAfterClose,
  renderItem,
  renderDropdown,
  shortcuts,
  awaitBeforeOpen = true,
  onBeforeOpen,
}: ContextMenuProps) {
  const intl = useIntl();
  const overlayOwner = useContext(OverlayOwnerContext);
  const zoom = useWindowZoom();
  const [resolvedItems, setResolvedItems] = useState(() => resolveItems(items ?? [], intl.formatMessage));
  const [openMode, setOpenMode] = useState<"dropdown" | null>(null);
  const isOpen = open ?? openMode === "dropdown";
  const registerOpen = overlayOwner?.registerOpen;
  useLayoutEffect(() => {
    if (!(trigger === "contextmenu" && isOpen)) return;
    const unregister = registerOpen?.();
    return typeof unregister === "function" ? unregister : undefined;
  }, [isOpen, registerOpen, trigger]);

  const preparation = useRef<AbortController | null>(null);
  const pendingSelect = useRef<(() => void) | undefined>(undefined);
  const finishPreparation = useStableCallback((controller: AbortController | null) => {
    if (controller != null && preparation.current === controller) {
      preparation.current = null;
      onAfterClose?.();
    }
  });
  useEffect(
    () => () => {
      const current = preparation.current;
      current?.abort();
      pendingSelect.current = undefined;
      finishPreparation(current);
    },
    [],
  );

  const startPreparation = () => {
    preparation.current?.abort();
    pendingSelect.current = undefined;
    const controller = new AbortController();
    preparation.current = controller;
    return controller;
  };
  const failPreparation = (controller: AbortController) => {
    if (controller.signal.aborted) return;
    controller.abort();
    if (trigger === "contextmenu" || (trigger === "click" && loadingMessage != null)) {
      setResolvedItems([]);
      setOpenMode(null);
      onOpenChange?.(false);
    }
  };
  const applyItems = (next: ContextMenuItem[], controller: AbortController) => {
    if (controller.signal.aborted) return [];
    const resolved = resolveItems(next, intl.formatMessage);
    setResolvedItems(resolved);
    if (trigger === "contextmenu" || (trigger === "click" && loadingMessage != null && next.length === 0)) {
      setOpenMode(next.length > 0 ? "dropdown" : null);
      if (next.length === 0) onOpenChange?.(false);
    }
    return resolved;
  };
  const loadItems = (controller: AbortController) => {
    if (controller.signal.aborted) return [];
    const next = getItems ? getItems() : (items ?? []);
    if (!isPromiseLike(next)) return applyItems(next, controller);
    const placeholder = items != null && items.length > 0 ? items : undefined;
    setResolvedItems(
      resolveItems(placeholder ?? (loadingMessage == null ? [] : [{ id: "context-menu-loading", message: loadingMessage, enabled: false }]), intl.formatMessage),
    );
    if (placeholder != null) setOpenMode("dropdown");
    const listeners = new AbortController();
    const stopListening = () => listeners.abort();
    controller.signal.addEventListener("abort", stopListening, { once: true });
    if (trigger === "contextmenu" && loadingMessage == null && placeholder == null) {
      const cancel = () => {
        controller.abort();
        setOpenMode(null);
        onOpenChange?.(false);
      };
      const options = { capture: true, signal: listeners.signal };
      document.addEventListener("pointerdown", cancel, options);
      document.addEventListener("contextmenu", cancel, options);
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") cancel();
        },
        options,
      );
      window.addEventListener("blur", cancel, options);
    }
    Promise.resolve(next)
      .then((loaded) => applyItems(loaded, controller))
      .catch(() => failPreparation(controller))
      .finally(() => {
        controller.signal.removeEventListener("abort", stopListening);
        listeners.abort();
      });
    return [];
  };
  const prepare = (controller: AbortController) => {
    if (!awaitBeforeOpen) {
      const loaded = loadItems(controller);
      const beforeOpen = onBeforeOpen?.();
      if (beforeOpen != null) Promise.resolve(beforeOpen).then(() => loadItems(controller)).catch(() => failPreparation(controller));
      return loaded;
    }
    const beforeOpen = onBeforeOpen?.();
    if (beforeOpen != null) Promise.resolve(beforeOpen).then(() => loadItems(controller)).catch(() => failPreparation(controller));
    return loadItems(controller);
  };

  useEffect(() => {
    if (!getItems) setResolvedItems(resolveItems(items ?? [], intl.formatMessage));
  }, [getItems, intl, items]);

  const selectItem = useStableCallback((item: ContextMenuItem, event: Event) => {
    if (item.enabled === false) {
      event.preventDefault();
      return;
    }
    if (item.selectAfterClose) pendingSelect.current = item.onSelect;
    else item.onSelect?.();
  });
  const handleCloseAutoFocus = useStableCallback((event: Event) => {
    const pending = pendingSelect.current;
    pendingSelect.current = undefined;
    if (pending != null) {
      event.preventDefault();
      pending();
    }
    onCloseAutoFocus?.(event);
    if (!(open ?? openMode === "dropdown")) finishPreparation(preparation.current);
  });
  const handleOpenChange = useStableCallback((next: boolean) => {
    if (next) {
      const controller = startPreparation();
      setOpenMode("dropdown");
      onOpenChange?.(true);
      try {
        prepare(controller);
      } catch {
        failPreparation(controller);
      }
    } else {
      setOpenMode(null);
      onOpenChange?.(false);
      preparation.current?.abort();
    }
  });
  const handleKeyDown = useStableCallback((event: KeyboardEvent<HTMLElement>) => {
    children.props.onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      event.target !== event.currentTarget ||
      (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (trigger === "click") {
      handleOpenChange(true);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }));
  });
  const handleContextMenu = useStableCallback((event: MouseEvent<HTMLElement>) => {
    children.props.onContextMenu?.(event);
    event.stopPropagation();
    if (event.defaultPrevented) return;
    if (trigger === "click") {
      event.preventDefault();
      handleOpenChange(true);
    }
    if (trigger === "contextmenu" && openMode === "dropdown") handleOpenChange(true);
  });

  const triggerElement = cloneElement(children, {
    "aria-expanded": isOpen,
    onContextMenu: handleContextMenu,
    onKeyDown: handleKeyDown,
  });

  if (trigger === "click") {
    const renderMenuItems = (list: ContextMenuItem[], select: SelectItem = selectItem): ReactNode =>
      list.map((item) => {
        const custom = renderItem?.(item, select);
        if (custom != null) return <Fragment key={item.id}>{custom}</Fragment>;
        if (item.type === "separator") return <Menu.Separator key={item.id} />;
        if (item.type === "label") return <Menu.Title key={item.id}>{itemLabel(item)}</Menu.Title>;
        const label = itemLabel(item);
        const tooltip = itemTooltip(item) ?? undefined;
        if (item.submenu) {
          return (
            <Menu.FlyoutSubmenuItem
              key={item.id}
              label={<ContextMenuItemContent icon={item.icon} label={label} reserveIcon={list.some(hasIcon)} />}
              disabled={item.enabled === false}
              tooltipText={tooltip}
            >
              {renderMenuItems(item.submenu, select)}
            </Menu.FlyoutSubmenuItem>
          );
        }
        if (item.type === "checkbox") {
          return (
            <Tooltip key={item.id} tooltipContent={tooltip}>
              <Menu.CheckboxItem
                checked={item.checked}
                closeOnSelect={item.closeOnSelect}
                disabled={item.enabled === false}
                aria-keyshortcuts={acceleratorToAriaKeyShortcuts(item.accelerator)}
                onSelect={(event) => select(item, event)}
              >
                {item.accelerator == null ? label : <ContextMenuItemContent label={label} shortcutLabel={shortcutLabel(item.accelerator)} />}
              </Menu.CheckboxItem>
            </Tooltip>
          );
        }
        const shortcut = shortcuts != null && Object.hasOwn(shortcuts, item.id) ? shortcuts[item.id] : shortcutLabel(item.accelerator);
        return (
          <Menu.Item
            key={item.id}
            disabled={item.enabled === false}
            href={item.href}
            role={item.type === "radio" ? "menuitemradio" : "menuitem"}
            aria-checked={item.type === "radio" ? item.checked === true : undefined}
            RightIcon={item.checked === true ? LegacySharedT7A513Icon : undefined}
            aria-keyshortcuts={shortcut == null ? undefined : acceleratorToAriaKeyShortcuts(item.accelerator)}
            onClick={item.onClick}
            onSelect={item.onClick == null ? (event) => select(item, event) : undefined}
            tone={item.tone}
            tooltipText={tooltip}
          >
            <ContextMenuItemContent icon={item.icon} label={label} reserveIcon={list.some(hasIcon)} shortcutLabel={shortcut} />
          </Menu.Item>
        );
      });
    const dropdownItems = open === true && items != null ? resolveItems(items, intl.formatMessage) : resolvedItems;
    const dropdownProps: DropdownMenuProps = {
      open: isOpen,
      onCloseAutoFocus: (event) => handleCloseAutoFocus(event),
      triggerButton: triggerElement,
      align,
      contentWidth: contentWidth ?? "menu",
      onOpenChange: (next) => handleOpenChange(next),
      children: renderMenuItems(dropdownItems),
    };
    if (renderDropdown == null) return <DropdownMenu {...dropdownProps} />;
    return renderDropdown({
      ...dropdownProps,
      items: open === true && items != null ? items : resolvedItems,
      onSelect: selectItem,
      renderItemContent: (item) => (
        <ContextMenuItemContent
          icon={item.icon}
          label={item.message ? <FormattedMessage {...item.message} values={item.messageValues} /> : item.id}
          showCheckbox={item.type === "checkbox"}
          checked={item.checked}
          shortcutLabel={shortcuts != null && Object.hasOwn(shortcuts, item.id) ? shortcuts[item.id] : shortcutLabel(item.accelerator)}
        />
      ),
      renderSubmenu: (item, select) => (item.submenu == null ? null : renderMenuItems(resolveItems(item.submenu, intl.formatMessage), select)),
    });
  }

  const renderContextItems = (list: ResolvedContextMenuItem[]): ReactNode =>
    list.map((item) => {
      if (item.type === "label") return <Menu.Title key={item.id}>{itemLabel(item)}</Menu.Title>;
      if (item.type === "separator") {
        return <RadixContextMenu.Separator key={item.id} className="mx-1 my-[var(--app-menu-separator-gutter,var(--spacing))] border-t border-border/60" />;
      }
      if (item.type === "checkbox") {
        return (
          <Tooltip key={item.id} tooltipContent={itemTooltip(item)}>
            <RadixContextMenu.CheckboxItem
              checked={item.checked ?? false}
              className={clsx(
                "text-default outline-hidden flex min-h-[var(--app-menu-item-height,0px)] items-center justify-center rounded-xl p-[var(--app-menu-item-padding,calc(var(--spacing)*1.5))] text-sm cursor-interaction hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover",
                item.enabled === false && "cursor-default opacity-50",
              )}
              disabled={item.enabled === false}
              aria-keyshortcuts={acceleratorToAriaKeyShortcuts(item.accelerator)}
              onSelect={(event) => selectItem(item, event)}
            >
              <ContextMenuItemContent
                checked={item.checked === true}
                label={itemLabel(item)}
                reserveIcon={list.some(hasIcon)}
                shortcutLabel={shortcutLabel(item.accelerator)}
                showCheckbox
              />
            </RadixContextMenu.CheckboxItem>
          </Tooltip>
        );
      }
      if (item.submenu) {
        return (
          <RadixContextMenu.Sub key={item.id}>
            <RadixContextMenu.SubTrigger
              className="flex min-h-[var(--app-menu-item-height,0px)] cursor-interaction items-center justify-between gap-1.5 rounded-xl p-[var(--app-menu-item-padding,calc(var(--spacing)*1.5))] text-sm text-default outline-hidden hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover"
              disabled={item.enabled === false}
            >
              <ContextMenuItemContent icon={item.icon} label={itemLabel(item)} reserveIcon={list.some(hasIcon)} showChevron />
            </RadixContextMenu.SubTrigger>
            <RadixContextMenu.Portal container={getPortalRoot()}>
              <RadixContextMenu.SubContent
                data-overlay-owner={overlayOwner?.id}
                className="ws-menu z-50 m-px flex min-w-[200px] flex-col rounded-2xl bg-surface-elevated-secondary p-[var(--app-menu-gutter,var(--spacing))] text-default shadow-lg ring-[0.5px] ring-border select-none"
                alignOffset={-11}
                collisionPadding={6}
                style={{ zoom: zoom === 1 ? undefined : zoom }}
              >
                {renderContextItems(item.submenu)}
              </RadixContextMenu.SubContent>
            </RadixContextMenu.Portal>
          </RadixContextMenu.Sub>
        );
      }
      return (
        <Tooltip key={item.id} tooltipContent={itemTooltip(item)}>
          <RadixContextMenu.Item
            className={clsx(CONTEXT_ITEM_CLASS, item.tone === "danger" ? "text-danger" : "text-default", item.enabled === false && "cursor-default opacity-50")}
            onSelect={(event) => selectItem(item, event)}
            aria-disabled={item.enabled === false}
            role={item.type === "radio" ? "menuitemradio" : "menuitem"}
            aria-checked={item.type === "radio" ? item.checked === true : undefined}
            aria-keyshortcuts={acceleratorToAriaKeyShortcuts(item.accelerator)}
          >
            <ContextMenuItemContent
              checked={item.checked === true}
              showCheckbox={item.type === "radio"}
              icon={item.icon}
              label={itemLabel(item)}
              reserveIcon={list.some(hasIcon)}
              shortcutLabel={shortcutLabel(item.accelerator)}
            />
          </RadixContextMenu.Item>
        </Tooltip>
      );
    });

  return (
    <RadixContextMenu.Root open={isOpen} onOpenChange={(next) => handleOpenChange(next)}>
      <RadixContextMenu.Trigger asChild>{triggerElement}</RadixContextMenu.Trigger>
      {resolvedItems.length > 0 && (
        <RadixContextMenu.Portal container={getPortalRoot()}>
          <RadixContextMenu.Content
            data-overlay-owner={overlayOwner?.id}
            className="ws-menu z-50 m-px flex min-w-[180px] flex-col rounded-2xl bg-surface-elevated-secondary p-[var(--app-menu-gutter,var(--spacing))] text-default shadow-lg ring-[0.5px] ring-border select-none"
            collisionPadding={6}
            onCloseAutoFocus={(event) => handleCloseAutoFocus(event)}
            style={{ zoom: zoom === 1 ? undefined : zoom }}
          >
            {renderContextItems(resolvedItems)}
          </RadixContextMenu.Content>
        </RadixContextMenu.Portal>
      )}
    </RadixContextMenu.Root>
  );
}
