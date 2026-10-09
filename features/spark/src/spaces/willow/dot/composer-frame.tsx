import clsx from "clsx";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type MouseEvent, type ReactNode, type Ref } from "react";
import { useThemeVariant } from "../../../codex/lib/theme";
import { useReducedMotion } from "../../../codex/lib/theme-engine";

export type ComposerLayout = "single-line" | "multiline";

const css = {
  root: "_ComposerLayoutRoot_gcdh7_2",
  body: "_ComposerLayoutBody_gcdh7_2",
  replyContext: "_ComposerLayoutReplyContext_gcdh7_2",
  attachments: "_ComposerLayoutAttachments_gcdh7_2",
  input: "_ComposerLayoutInput_gcdh7_2",
  footer: "_ComposerLayoutFooter_gcdh7_2",
  adaptiveFooterInput: "_AdaptiveFooterInput_gcdh7_2",
} as const;

export type ComposerUtilityBarVariant = "default" | "home";
export type ComposerRadiusVariant = "default" | "compact" | "large" | "single-line";
export type ComposerSurfaceVariant = "default" | "inline" | "document" | "opaque" | "secondary";

interface FrameContextValue {
  canStackSingleLine: boolean;
  isDictating: boolean;
  isHome: boolean;
}

const FrameContext = createContext<FrameContextValue>({ canStackSingleLine: false, isDictating: false, isHome: false });

export function useComposerFrameDictating() {
  return useContext(FrameContext).isDictating;
}

/** Targets that keep their own pointer behaviour inside the frame. */
const interactiveSelector =
  "a[href], button, input, select, textarea, [contenteditable='true'], [draggable='true'], [role='button'], [role='link'], [role='menuitem'], [role='option'], [tabindex]:not([tabindex='-1'])";

/** Pressing empty frame space focuses the editor instead of blurring it. */
function focusEditorOnFramePress(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0 || event.defaultPrevented) return;
  const target = event.target;
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
  const editor = event.currentTarget.querySelector<HTMLElement>(".ProseMirror");
  if (editor == null || editor.contains(target)) return;
  const interactive = target.closest(interactiveSelector);
  if (interactive != null && event.currentTarget.contains(interactive)) return;
  event.preventDefault();
  editor.focus();
}

interface RootProps {
  layout: ComposerLayout;
  utilityBarVariant?: ComposerUtilityBarVariant;
  radiusVariant?: ComposerRadiusVariant;
  surfaceVariant?: ComposerSurfaceVariant;
  children: ReactNode;
}

function Root({ layout, utilityBarVariant = "default", radiusVariant = "default", surfaceVariant = "default", children }: RootProps) {
  const dark = useThemeVariant() === "dark";
  const canStackSingleLine = radiusVariant === "default" && surfaceVariant === "default";
  return (
    <FrameContext.Provider value={{ canStackSingleLine, isDictating: false, isHome: utilityBarVariant === "home" }}>
      <div
        className={css.root}
        data-composer-dark={dark ? "" : undefined}
        data-composer-layout={layout}
        data-composer-padding-variant="none"
        data-composer-radius-variant={radiusVariant}
        data-composer-density="default"
        data-composer-surface-overflow={surfaceVariant === "document" ? "visible" : "auto"}
        data-composer-surface-variant={surfaceVariant}
        data-composer-utility-bar-variant={utilityBarVariant}
        role="presentation"
        onMouseDown={focusEditorOnFramePress}
      >
        {children}
      </div>
    </FrameContext.Provider>
  );
}

const homeUtilityBarEase = [0.23, 1, 0.32, 1] as const;

function HomeUtilityBar({ className, isHidden, position, children }: { className: string; isHidden: boolean; position: "above" | "below"; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const visible = useIsPresent() && !isHidden;
  const offset = reducedMotion ? "translateY(0)" : position === "above" ? "translateY(100%)" : "translateY(-100%)";
  return (
    <motion.div
      aria-hidden={!visible}
      className={clsx(className, !visible && "pointer-events-none")}
      inert={!visible}
      initial={{ opacity: 0, transform: offset }}
      animate={{ opacity: 1, transform: "translateY(0)" }}
      exit={{ opacity: 0, transform: offset }}
      transition={{ duration: 0.3, ease: homeUtilityBarEase }}
    >
      <div className={clsx(isHidden && "opacity-0")}>{children}</div>
    </motion.div>
  );
}

interface UtilityBarSlotProps {
  isHidden?: boolean;
  isVisible: boolean;
  position?: "above" | "below";
  variant: ComposerUtilityBarVariant;
  children: ReactNode;
}

function UtilityBarSlot({ isHidden = false, isVisible, position = "above", variant, children }: UtilityBarSlotProps) {
  const { isHome } = useContext(FrameContext);
  if (variant !== "home") {
    return isVisible ? (
      <div aria-hidden={isHidden} className={clsx(isHidden && "pointer-events-none opacity-0")} inert={isHidden}>
        {children}
      </div>
    ) : null;
  }
  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <HomeUtilityBar
          key="home-utility-bar"
          className={clsx("z-0", isHome ? "absolute inset-x-0" : "relative -mb-2", isHome && (position === "above" ? "bottom-full" : "top-full"))}
          isHidden={isHidden}
          position={position}
        >
          {children}
        </HomeUtilityBar>
      ) : null}
    </AnimatePresence>
  );
}

function Body({ layout = "multiline", ref, children }: { layout?: ComposerLayout; ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div ref={ref} className={css.body} data-composer-layout={layout} data-composer-body="">
      {children}
    </div>
  );
}

function ReplyContext({ children }: { children: ReactNode }) {
  return <div className={css.replyContext}>{children}</div>;
}

function Attachments({ hasVisibleAttachments, spacing, children }: { hasVisibleAttachments: boolean; spacing: "flush" | "default"; children: ReactNode }) {
  return (
    <div
      className={css.attachments}
      data-composer-attachments=""
      data-composer-spacing={spacing}
      data-visible-attachments={hasVisibleAttachments ? "" : undefined}
    >
      {children}
    </div>
  );
}

function Input({ layout, ref, children }: { layout: ComposerLayout; ref?: Ref<HTMLDivElement> | null; children: ReactNode }) {
  const { isDictating } = useContext(FrameContext);
  const inputLayout = isDictating ? "multiline" : layout;
  return (
    <div
      ref={ref ?? undefined}
      className={clsx(css.input, inputLayout === "single-line" ? "min-w-0" : "flex-grow overflow-y-auto")}
      data-composer-layout={inputLayout}
      data-composer-spacing="default"
      data-composer-input-variant="default"
      data-composer-input=""
    >
      {children}
    </div>
  );
}

function FooterActions({ ref, children }: { ref?: Ref<HTMLDivElement>; children?: ReactNode }) {
  return (
    <div ref={ref} className={clsx("flex shrink-0 items-center", "gap-2")}>
      {children}
    </div>
  );
}

function FooterControls({ layout = "multiline", children }: { layout?: ComposerLayout; children: ReactNode }) {
  return <div className={clsx("flex min-w-0 items-center justify-end", layout === "multiline" ? "w-full" : "shrink-0")}>{children}</div>;
}

interface FooterProps {
  layout?: ComposerLayout;
  responsive?: boolean;
  rows?: "inline" | "stacked" | "responsive";
  spacing?: "default" | "flush";
  dictationEnabled?: boolean;
  dictationView?: "text" | "waveform";
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/** `cFt`: the footer grid below the input. */
function Footer({ layout = "multiline", responsive = false, rows, spacing = "default", dictationEnabled = false, dictationView, ref, children }: FooterProps) {
  return (
    <div
      ref={ref}
      className={css.footer}
      data-dictation-view={dictationView}
      data-dictation-enabled={dictationEnabled ? "" : undefined}
      data-composer-footer-responsive={responsive ? "" : undefined}
      data-composer-layout={layout}
      data-composer-rows={rows}
      data-composer-spacing={spacing}
    >
      {children}
    </div>
  );
}

const narrowQuery = "(width < 40rem)";

function subscribeNarrow(onChange: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useNarrowViewport() {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(narrowQuery).matches);
}

interface Dictation {
  showTranscript: boolean;
  controls: ReactNode;
}

interface AdaptiveFooterProps {
  layout: ComposerLayout;
  dictation?: Dictation;
  dictationEnabled: boolean;
  input: ReactNode;
  leadingControls: ReactNode;
  trailingControls: ReactNode;
}

function AdaptiveFooter({ layout, dictation, dictationEnabled, input, leadingControls, trailingControls }: AdaptiveFooterProps) {
  const frame = useContext(FrameContext);
  const reducedMotion = useReducedMotion();
  const narrow = useNarrowViewport();
  const footerRef = useRef<HTMLDivElement>(null);
  const responsive = dictation == null && layout === "single-line" && frame.canStackSingleLine;
  const hideInput = dictation != null && !dictation.showTranscript;
  const rows = dictation != null || layout === "multiline" ? "stacked" : "inline";
  const inputFirst = rows === "stacked" || (responsive && narrow);
  const wasHidingInput = useRef(hideInput);

  useEffect(() => {
    const ended = wasHidingInput.current && !hideInput;
    wasHidingInput.current = hideInput;
    if (!ended) return;
    const body = footerRef.current?.closest("[data-composer-body]");
    const active = document.activeElement;
    if (active == null || active === document.body || (body != null && body.contains(active))) {
      body?.querySelector<HTMLElement>(".ProseMirror")?.focus();
    }
  }, [hideInput]);

  const leading = (
    <div
      key="leading"
      className={clsx(
        "min-w-0",
        dictation != null && "hidden",
        rows === "stacked" && "col-start-1 row-start-2",
        responsive && "max-sm:col-start-1 max-sm:row-start-2",
      )}
    >
      {dictation == null ? leadingControls : null}
    </div>
  );
  const inputCell = (
    <motion.div
      key="input"
      className={clsx(
        "min-w-0",
        css.adaptiveFooterInput,
        dictation != null && "overflow-hidden",
        rows === "stacked" && "col-span-full row-start-1",
        rows === "stacked" && "-mx-2",
        responsive && "max-sm:col-span-full max-sm:row-start-1 max-sm:-mx-2",
      )}
      inert={hideInput}
      aria-hidden={hideInput || undefined}
      data-composer-layout={layout}
      style={{ height: hideInput ? 0 : "auto" }}
      initial={false}
      animate={{ opacity: hideInput ? 0 : 1 }}
      transition={{ opacity: { duration: reducedMotion ? 0 : hideInput ? 0.12 : 0.16, delay: reducedMotion || hideInput ? 0 : 0.04 } }}
    >
      <FrameContext.Provider value={{ ...frame, isDictating: dictation != null }}>{input}</FrameContext.Provider>
    </motion.div>
  );
  const trailing = (
    <div
      key="trailing"
      className={clsx(
        "min-w-0",
        dictation != null && "hidden",
        rows === "stacked" && "col-start-3 row-start-2",
        responsive && "max-sm:col-start-3 max-sm:row-start-2",
      )}
    >
      {dictation == null ? trailingControls : null}
    </div>
  );

  return (
    <div
      ref={footerRef}
      className={css.footer}
      data-dictation-view={dictation == null ? undefined : dictation.showTranscript ? "text" : "waveform"}
      data-dictation-enabled={dictationEnabled ? "" : undefined}
      data-composer-footer-responsive=""
      data-composer-layout={layout}
      data-composer-rows={responsive ? "responsive" : rows}
      data-composer-spacing="default"
    >
      {inputFirst ? [inputCell, leading, trailing] : [leading, inputCell, trailing]}
      {dictation == null ? null : (
        <div key="dictation" className={clsx("col-span-full min-w-0", inputFirst && "row-start-2")}>
          {dictation.controls}
        </div>
      )}
    </div>
  );
}

export const ComposerFrame = Object.assign(Root, {
  UtilityBarSlot,
  Body,
  ReplyContext,
  Attachments,
  Input,
  AdaptiveFooter,
  Footer,
  FooterActions,
  FooterControls,
});
