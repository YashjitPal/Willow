/**
 * The agent tab's sidebar chrome, built as Willow's own sidebar is (apps/studio's Sidebar.tsx and
 * its Spark rows): the agent's mark and name in the 52px header, 32px pill rows, the project tree
 * between them, and the account row and gear at the foot. Collapsed it is Willow's 52px rail: the
 * mark, each row's glyph with its name as a tooltip, and the gear over the account. The gear opens
 * Willow's settings pane, each of its rows opening one of T3's settings pages.
 */
import { useAtomValue } from "@effect/atom-react";
import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  BlocksIcon,
  BotIcon,
  CalendarClockIcon,
  GitBranchIcon,
  HardDriveIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  PanelsTopLeftIcon,
  Settings2Icon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  ProviderInstanceIcon,
  providerTextColorClassName,
} from "~/components/chat/ProviderInstanceIcon";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "~/components/pullRequest/pullRequestListPreferences";
import { validateSettingsScopeSearch } from "~/components/settings/settingsScope";
import {
  isSettingsOverviewVisible,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
} from "~/components/settings/settingsSearch";
import { useSidebar } from "~/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { shortcutLabelForCommand } from "~/keybindings";
import { startNewThreadFromContext } from "~/lib/chatThreadActions";
import { cn } from "~/lib/utils";
import { isLocalEnvironmentDisabled } from "~/localEnvironment";
import { usePullRequestsSupported } from "~/state/environments";
import { primaryServerKeybindingsAtom, primaryServerProvidersAtom } from "~/state/server";

import { harnessLabel, isWillowEmbedded, useWillowScope } from "./harness";
import { willowSymbol } from "./icons";
import { useAddProjectFromPicker } from "./useAddProject";

type GlyphFamily = "luminous" | "google" | "material";

const GLYPH_CLASS: Record<GlyphFamily, string> = {
  luminous: "willow-glyph",
  google: "willow-glyph willow-glyph--google",
  material: "willow-glyph willow-glyph--material",
};

/** A 20px glyph from one of Willow's icon faces. Luminous and Google Symbols carry only the glyphs Willow names. */
export function Glyph({
  name,
  family = "luminous",
  className,
}: {
  name: string;
  family?: GlyphFamily;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn(GLYPH_CLASS[family], className)}>
      {name}
    </span>
  );
}

function HarnessMark({ driver, label }: { driver: string; label: string }) {
  const kind = ProviderDriverKind.make(driver);
  return (
    <ProviderInstanceIcon
      driverKind={kind}
      displayName={label}
      className="size-[22px]"
      iconClassName={cn("size-[22px]", providerTextColorClassName(kind))}
    />
  );
}

/** Whether the sidebar is Willow's collapsed rail (a phone's sheet is never one). */
function useWillowRail(): boolean {
  const { isMobile, state } = useSidebar();
  return state === "collapsed" && !isMobile;
}

/**
 * The agent's mark and name where Willow's sidebar has its own. The mark collapses and expands the
 * sidebar, showing the expand glyph under the pointer on the rail; open, the name fades in behind
 * the width and the collapse button lands as it settles.
 */
export function WillowSidebarHeader() {
  const scope = useWillowScope();
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const collapsed = useWillowRail();
  const label = scope ? harnessLabel(scope) : "Willow";
  const toggle = () => (isMobile ? setOpenMobile(false) : toggleSidebar());
  return (
    <div className="willow-sidebar-header" data-collapsed={collapsed ? "true" : undefined}>
      <button
        type="button"
        className="willow-sidebar-header__mark"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={toggle}
      >
        <span className="willow-sidebar-header__logo">
          {scope ? (
            <HarnessMark driver={scope} label={label} />
          ) : (
            <img src="/willow/logo.png" alt="" />
          )}
        </span>
        {collapsed ? (
          <span className="willow-sidebar-header__expand">
            <Glyph name="side_nav_expand" />
          </span>
        ) : null}
      </button>
      {collapsed ? null : (
        <span className="willow-sidebar-header__name willow-sidenav-text">{label}</span>
      )}
      {collapsed ? null : (
        <button
          type="button"
          className="willow-sidebar-header__collapse willow-sidenav-close-button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={toggle}
        >
          <Glyph name="side_nav" />
        </button>
      )}
    </div>
  );
}

/** The header at its name's length: the mark's 46px before the name, the collapse button's 58px after it. */
export function WillowSidebarHeaderProbe() {
  const scope = useWillowScope();
  return (
    <span className="willow-sidebar-header__name" style={{ margin: "0 58px 0 46px" }}>
      {scope ? harnessLabel(scope) : "Willow"}
    </span>
  );
}

/**
 * A row of the sidebar's top, a tab of its own page: its glyph and name, and its shortcut in the
 * trailing slot while pointed at. On the rail it is the glyph alone, its name as a tooltip.
 */
export function WillowSidebarRow(props: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  shortcut?: string | null;
  onClick: () => void;
}) {
  const collapsed = useWillowRail();
  const rowProps = {
    type: "button" as const,
    className: "willow-sidebar-row",
    "data-active": props.active ? "true" : undefined,
    "data-collapsed": collapsed ? "true" : undefined,
    "aria-label": props.label,
    "aria-current": props.active ? ("page" as const) : undefined,
    onClick: props.onClick,
  };
  const content = (
    <>
      <span className="willow-sidebar-row__icon">{props.icon}</span>
      {collapsed ? null : <span className="willow-sidebar-row__label">{props.label}</span>}
      {!collapsed && props.shortcut ? (
        <span className="willow-sidebar-row__shortcut" aria-hidden="true">
          {props.shortcut}
        </span>
      ) : null}
    </>
  );
  return (
    <div className="willow-sidebar-row-wrap">
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger render={<button {...rowProps} />}>{content}</TooltipTrigger>
          <TooltipPopup side="right">{props.label}</TooltipPopup>
        </Tooltip>
      ) : (
        <button {...rowProps}>{content}</button>
      )}
    </div>
  );
}

/** Spark's section heading: muted, with its actions revealed on hover. */
export function WillowSidebarHeading({ label, actions }: { label: string; actions?: ReactNode }) {
  return (
    <div className="willow-sidebar-heading">
      <span className="willow-sidebar-heading__label">{label}</span>
      {actions ? <span className="willow-sidebar-heading__actions">{actions}</span> : null}
    </div>
  );
}

const NEW_THREAD_SHORTCUT_OPTIONS = { context: { terminalFocus: false, terminalOpen: false } };

/**
 * The top rows, as Willow Spark's: a new thread, Add project under it as Spark's Add folder sits,
 * Search threads opening its page as Willow's Search chats does, and the pull requests and usage
 * pages.
 */
export function WillowSidebarNav({ onAddProjectInPalette }: { onAddProjectInPalette: () => void }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const pullRequestsSupported = usePullRequestsSupported();
  const addProjectFromPicker = useAddProjectFromPicker();
  const newThreadShortcut = isMobile
    ? null
    : (shortcutLabelForCommand(keybindings, "chat.newLocal", NEW_THREAD_SHORTCUT_OPTIONS) ??
      shortcutLabelForCommand(keybindings, "chat.new", NEW_THREAD_SHORTCUT_OPTIONS));
  const closeOnPhone = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <nav className="willow-sidebar-nav" aria-label="Threads">
      <WillowSidebarRow
        icon={<Glyph name="edit_square" />}
        label="New thread"
        shortcut={newThreadShortcut}
        active={pathname === "/" || pathname.startsWith("/draft/")}
        onClick={() => {
          closeOnPhone();
          void startNewThreadFromContext({
            activeDraftThread,
            activeThread: activeThread ?? undefined,
            defaultProjectRef,
            handleNewThread,
          });
        }}
      />
      <WillowSidebarRow
        icon={<Glyph name="create_new_folder" family="google" />}
        label="Add project"
        // Only Willow's window has a folder picker; elsewhere the palette browses the computer's folders.
        onClick={() =>
          isWillowEmbedded() && !isLocalEnvironmentDisabled()
            ? void addProjectFromPicker()
            : onAddProjectInPalette()
        }
      />
      <WillowSidebarRow
        icon={<Glyph name="search" />}
        label="Search threads"
        active={pathname === "/search"}
        onClick={() => {
          closeOnPhone();
          void navigate({ to: "/search" });
        }}
      />
      {pullRequestsSupported ? (
        <WillowSidebarRow
          icon={<PullRequestGlyph.pullRequest className="size-[18px]" />}
          label="Pull requests"
          active={pathname.startsWith("/pull-requests")}
          onClick={() => {
            closeOnPhone();
            void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
          }}
        />
      ) : null}
      <WillowSidebarRow
        icon={<Glyph name="donut_large" family="google" />}
        label="Usage"
        active={pathname === "/usage"}
        onClick={() => {
          closeOnPhone();
          void navigate({ to: "/usage" });
        }}
      />
    </nav>
  );
}

function accountPresentation(provider: ServerProvider | undefined, harness: string) {
  if (!provider) return null;
  if (!provider.enabled) return { label: `Set up ${harness}`, signedIn: false };
  if (!provider.installed) return { label: `Install ${harness}`, signedIn: false };
  if (provider.auth.status === "authenticated") {
    return {
      label: provider.auth.email ?? provider.auth.label ?? `Signed in to ${harness}`,
      signedIn: true,
    };
  }
  if (provider.auth.status === "unauthenticated")
    return { label: `Sign in to ${harness}`, signedIn: false };
  return { label: `Set up ${harness}`, signedIn: false };
}

const SnapShotsIcon = willowSymbol("screenshot_region");

/** T3's settings pages, in its own order, as the rows of Willow's settings pane. */
const SETTINGS_MENU_ITEMS: ReadonlyArray<{
  readonly to: SettingsPath;
  readonly icon: ComponentType<{ className?: string }>;
}> = [
  { to: "/settings/general", icon: Settings2Icon },
  { to: "/settings/appearance", icon: PaletteIcon },
  { to: "/settings/keybindings", icon: KeyboardIcon },
  { to: "/settings/snap-shot", icon: SnapShotsIcon },
  { to: "/settings/providers", icon: BotIcon },
  { to: "/settings/integrations", icon: BlocksIcon },
  { to: "/settings/scheduled-tasks", icon: CalendarClockIcon },
  { to: "/settings/source-control", icon: GitBranchIcon },
  { to: "/settings/storage", icon: HardDriveIcon },
  { to: "/settings/connections", icon: Link2Icon },
  { to: "/settings/archived", icon: ArchiveIcon },
];

/** T3 lists the project's own page first while one project is the settings' scope. */
const PROJECT_SETTINGS_MENU_ITEM = { to: "/settings/projects", icon: PanelsTopLeftIcon } as const;

/** Willow's settings pane leaves over 100ms after a 25ms delay, and stays mounted for both. */
const SETTINGS_MENU_EXIT_MS = 125;

/**
 * Willow's settings pane (its sidebar's GeminiSettingsMenu): 300px of 36px rows over the gear,
 * growing up from its corner, beside the rail when collapsed. Each row opens a settings page.
 */
function WillowSettingsMenu({
  open,
  collapsed,
  triggerRef,
  onClose,
}: {
  open: boolean;
  collapsed: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const showsProjectPage = useLocation({
    select: (location) =>
      location.pathname.startsWith("/settings") &&
      isSettingsOverviewVisible(validateSettingsScopeSearch(location.search)),
  });
  const items = showsProjectPage
    ? [PROJECT_SETTINGS_MENU_ITEM, ...SETTINGS_MENU_ITEMS]
    : SETTINGS_MENU_ITEMS;
  const menuRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const sidebar = triggerRef.current?.closest<HTMLElement>(
      "[data-slot='sidebar-container'], [data-slot='sidebar']",
    );
    const rect = sidebar?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: collapsed ? rect.right : rect.right - 44,
      bottom: window.innerHeight - rect.bottom + (collapsed ? 94 : 50),
    });
  }, [collapsed, open, triggerRef]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setPhase("open");
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setPhase("closing");
    const timer = window.setTimeout(() => setPhase("closed"), SETTINGS_MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    // Captured so the settings pages' own Escape does not also leave the page.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, open, triggerRef]);

  if (phase === "closed" || position === null) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Settings"
      className="willow-settings-menu"
      data-closing={phase === "closing" ? "true" : undefined}
      style={{ left: position.left, bottom: position.bottom }}
    >
      {items.map((item) => (
        <button
          key={item.to}
          type="button"
          role="menuitem"
          className="willow-settings-menu__item"
          onClick={() => {
            onClose();
            if (isMobile) setOpenMobile(false);
            void navigate({ to: item.to });
          }}
        >
          <span className="willow-settings-menu__icon" aria-hidden="true">
            <item.icon />
          </span>
          <span className="willow-settings-menu__label">{SETTINGS_SECTION_LABELS[item.to]}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Willow's account row and gear: the tab's agent account (sign in, API key, base URL) and the
 * settings pane. On the rail the gear stands over the account's disc.
 */
export function WillowSidebarFooter() {
  const scope = useWillowScope();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const navigate = useNavigate();
  const collapsed = useWillowRail();
  const settingsRef = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const harness = scope ? harnessLabel(scope) : "your agents";
  const provider = scope ? providers.find((candidate) => candidate.driver === scope) : undefined;
  const account = scope
    ? accountPresentation(provider, harness)
    : { label: "Agents", signedIn: true };

  return (
    <>
      <div className="willow-sidebar-footer" data-collapsed={collapsed ? "true" : undefined}>
        {account ? (
          <button
            type="button"
            className="willow-sidebar-account"
            title={account.signedIn ? `${harness} account` : account.label}
            onClick={() =>
              void navigate({
                to: "/settings/providers",
                search: provider ? { instanceId: provider.instanceId } : {},
              })
            }
          >
            <span className="willow-sidebar-account__disc">
              {account.signedIn && scope ? (
                <HarnessMark driver={scope} label={harness} />
              ) : (
                <Glyph name={scope ? "login" : "smart_toy"} family="material" />
              )}
            </span>
            {collapsed ? null : (
              <span className="willow-sidebar-account__label">{account.label}</span>
            )}
          </button>
        ) : (
          <span
            className="willow-sidebar-account willow-sidebar-account--pending"
            aria-hidden="true"
          />
        )}
        <button
          ref={settingsRef}
          type="button"
          className="willow-sidebar-footer__settings"
          aria-label="Settings"
          aria-haspopup="menu"
          aria-expanded={settingsOpen}
          data-open={settingsOpen ? "true" : undefined}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <span className="willow-sidebar-footer__state" aria-hidden="true" />
          <Glyph name="settings" />
        </button>
      </div>
      <WillowSettingsMenu
        open={settingsOpen}
        collapsed={collapsed}
        triggerRef={settingsRef}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
