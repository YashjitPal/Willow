import { ArrowLeftIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { usePullRequestsSupported } from "../../state/environments";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { WillowSidebarFooter, WillowSidebarHeader, WillowSidebarHeaderProbe } from "~/willow/WillowSidebar";

// Willow's header: the agent's mark and name, as Willow's sidebar shows its own.
export const SidebarChromeHeader = memo(function SidebarChromeHeader(_props: { isElectron: boolean }) {
  return <WillowSidebarHeader />;
});

// Measures the header's name with its insets, so the sidebar minimum follows font size and zoom.
export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = useCallback(
    (probe: HTMLDivElement) => {
      const observer = new ResizeObserver(([entry]) => {
        if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
      });
      observer.observe(probe);
      return () => observer.disconnect();
    },
    [onWidthChange],
  );

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max"
      ref={observeWidth}
    >
      <WillowSidebarHeaderProbe />
    </div>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    void navigateToMainApp();
  }, [closeMobileSidebar, navigateToMainApp]);

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label="Pull Requests"
              onClick={handlePullRequestsClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
          />
        </>
      )}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

// Pull requests and usage are rows at the top of Willow's sidebar; settings is the gear here.
export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter className="gap-1 p-0">
      <div className="flex flex-col gap-2 px-2 empty:hidden">
        <SidebarThreadUndoNotice />
        <SidebarProviderUpdatePill />
        <SidebarUpdateArchitectureWarning />
      </div>
      <WillowSidebarFooter />
    </SidebarFooter>
  );
});
