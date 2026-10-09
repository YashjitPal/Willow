import clsx from "clsx";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { useReducedMotion } from "../lib/theme-engine";
import { XmarkMdLight20Icon } from "../icons/xmark-md-light-20";
import { Button } from "./button";
import { Surface } from "./surface";

export interface SideDrawerProps {
  children?: ReactNode;
  busy?: boolean;
  className?: string;
  label?: string;
  open: boolean;
  /** Keeps the panel mounted (hidden) while closed. */
  preserveContent?: boolean;
  onExitComplete?: () => void;
  height?: "full" | "content";
  size?: "default" | "compact";
  side?: "start" | "end";
}

function DrawerPanel({
  children,
  busy,
  className,
  label,
  onClosed,
  open,
  reducedMotion,
  height,
  size,
  side,
}: Required<Pick<SideDrawerProps, "open" | "height" | "size" | "side">> & Pick<SideDrawerProps, "children" | "busy" | "className" | "label"> & { onClosed?: () => void; reducedMotion: boolean }) {
  const present = useIsPresent();
  const openedRef = useRef(open);
  const rtl = document.documentElement.dir === "rtl";
  const offset = (side === "start") === rtl ? "100%" : "-100%";
  const hidden = !open || !present;
  return (
    <motion.div
      className={clsx("ws-side-drawer", "z-40 col-start-1 row-start-1 flex h-full min-h-0 max-h-full max-w-full shrink-0 p-2 pt-px", height === "content" && "items-start")}
      aria-hidden={hidden}
      inert={hidden}
      initial={open ? { x: offset } : { display: "none", x: offset }}
      animate={open ? "open" : "closed"}
      exit={{ x: offset }}
      onAnimationStart={(definition) => {
        if (definition === "open") openedRef.current = true;
      }}
      onAnimationComplete={(definition) => {
        if (definition === "closed" && openedRef.current) {
          openedRef.current = false;
          onClosed?.();
        }
      }}
      variants={{ open: { x: 0, display: "flex" }, closed: { x: offset, transitionEnd: { display: "none" } } }}
      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 40 }}
    >
      <Surface asChild variant="island">
        <aside
          aria-busy={busy}
          aria-label={label}
          className={clsx("ws-side-drawer__panel", "flex min-h-0 max-h-full max-w-full flex-col text-default", height === "content" ? "overflow-y-auto" : "overflow-hidden", size === "compact" ? "w-74" : "w-80", className)}
        >
          {height === "content" ? <div className="flex shrink-0 flex-col">{children}</div> : children}
        </aside>
      </Surface>
    </motion.div>
  );
}

export interface PanelHeaderProps {
  actions?: ReactNode;
  closeDisabled?: boolean;
  closeLabel: string;
  leading?: ReactNode;
  title: ReactNode;
  titleId?: string;
  onClose: () => void;
}

/** Title row of a side panel with its round close button (`zv` / `CAi` + `wAi` in app-shared). */
export function PanelHeader({ actions, closeDisabled, closeLabel, leading, title, titleId, onClose }: PanelHeaderProps) {
  return (
    <div className="ws-panel-header flex h-11 shrink-0 items-center justify-between gap-2 py-1 ps-4 pe-2">
      {leading}
      <h2 id={titleId} className="min-w-0 flex-1 truncate">
        <span className="ws-panel-header__title text-base font-semibold text-default select-none">{title}</span>
      </h2>
      {actions}
      <Button aria-label={closeLabel} color="secondary" disabled={closeDisabled} radius="full" size="toolbar" uniform onClick={onClose}>
        <XmarkMdLight20Icon />
      </Button>
    </div>
  );
}

/** Island panel that slides in from the inline end of its grid cell (`Rv` in app-shared). */
export function SideDrawer({ children, busy, className, label, onExitComplete, open, preserveContent = false, height = "full", size = "default", side = "end" }: SideDrawerProps) {
  const reducedMotion = useReducedMotion();
  return (
    <AnimatePresence initial={!reducedMotion} onExitComplete={preserveContent ? undefined : onExitComplete}>
      {(open || preserveContent) && (
        <DrawerPanel
          key="panel"
          busy={busy}
          className={className}
          label={label}
          onClosed={preserveContent ? onExitComplete : undefined}
          open={open}
          reducedMotion={reducedMotion}
          height={height}
          size={size}
          side={side}
        >
          {children}
        </DrawerPanel>
      )}
    </AnimatePresence>
  );
}
