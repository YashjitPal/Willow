import clsx from "clsx";
import { Dialog as RadixDialog } from "radix-ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { useEscapeKeyStack } from "./escape-key-stack";
import { afterFrames, TransitionGroup } from "./transition-group";
import { useStableCallback } from "./use-stable-callback";
import { getPortalRoot } from "./portal-root";

const css = {
  ModalPortal: "_ModalPortal_ovjjw_2",
  ModalPortalInner: "_ModalPortalInner_ovjjw_2",
  ModalBackdrop: "_ModalBackdrop_ovjjw_2",
  ModalContainer: "_ModalContainer_ovjjw_2",
  ModalContainerInner: "_ModalContainerInner_ovjjw_2",
  Modal: "_Modal_ovjjw_2",
  Form: "_Form_ovjjw_2",
  Body: "_Body_ovjjw_2",
  Header: "_Header_ovjjw_2",
  Title: "_Title_ovjjw_2",
  Footer: "_Footer_ovjjw_2",
  Description: "_Description_ovjjw_2",
} as const;

const ENTER_DURATION_MS = 600;
const EXIT_DURATION_MS = 300;
const WIDE_QUERY = "(min-width: 48rem)";
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Returning `deny` from a registered check keeps the modal open. */
export type ModalCloseCheck = () => "allow" | "deny";

interface ModalContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  shake: boolean;
  setShake: (shake: boolean) => void;
  checkAllowClose: RefObject<Set<ModalCloseCheck>>;
}

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext() {
  const context = useContext(ModalContext);
  if (context == null) throw new Error("Modal components or hooks must be wrapped in <Modal />");
  return context;
}

/** Element nested Radix portals render into (`radixPortalContainer` of `gz` in app-initial). */
export const ModalPortalContainerContext = createContext<HTMLElement | null>(null);

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useIsWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);
}

/** Password managers, Grammarly and toasts must not dismiss the modal (`hzo`). */
function isIgnoredOutsideTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return (
    target.hasAttribute("data-grammarly-shadow-root") ||
    target.tagName === "COM-1PASSWORD-BUTTON" ||
    target.closest("[data-sonner-toast], [data-sonner-toaster]") != null ||
    target.closest("[data-puik-ignore-outside-interaction]") != null
  );
}

export interface ModalProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

/**
 * Design-system modal (`pz` / `a4` in app-initial): a non-modal Radix dialog whose content slides in through a
 * transition group, with `Trigger`, `Form`, `Header`, `Body`, `Footer`, `Title`, `Description` and `Close` parts.
 */
export function Modal({ open, defaultOpen = false, onOpenChange, children }: ModalProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [shake, setShake] = useState(false);
  const checkAllowClose = useRef(new Set<ModalCloseCheck>());
  const isOpen = open ?? uncontrolledOpen;
  const notifyOpenChange = useStableCallback((next: boolean) => onOpenChange?.(next));
  const setOpen = useCallback(
    (next: boolean) => {
      if (isOpen === next) return;
      if (!next) setShake(false);
      notifyOpenChange(next);
      if (open === undefined) setUncontrolledOpen(next);
    },
    [isOpen, notifyOpenChange, open],
  );
  const context = useMemo(() => ({ open: isOpen, setOpen, shake, setShake, checkAllowClose }), [isOpen, setOpen, shake]);
  return (
    <ModalContext.Provider value={context}>
      <RadixDialog.Root open={isOpen} onOpenChange={setOpen} modal={false}>
        {children}
      </RadixDialog.Root>
    </ModalContext.Provider>
  );
}

type RadixContentProps = ComponentProps<typeof RadixDialog.Content>;

export interface ModalContentProps extends Omit<RadixContentProps, "forceMount" | "onOpenAutoFocus" | "onEscapeKeyDown"> {
  portalClassName?: string;
  maxWidth?: number;
  scroll?: "inside" | "outside";
  backdrop?: "dim" | "fade";
  /** Called once the exit transition has finished. */
  onAfterClose?: () => void;
  animateOnMount?: boolean;
}

/**
 * `a4.Content`: backdrop + centered sheet; Escape (through the escape-key stack) and outside clicks close it unless a
 * close check denies.
 */
export function ModalContent({
  children,
  className,
  portalClassName,
  maxWidth,
  scroll = "inside",
  backdrop = "dim",
  style,
  onCloseAutoFocus,
  onAfterClose,
  animateOnMount = false,
  ...rest
}: ModalContentProps) {
  const wide = useIsWide();
  const { open, setOpen, shake, checkAllowClose } = useModalContext();
  const portalContainer = useContext(ModalPortalContainerContext);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const latest = useRef({ open, onAfterClose });
  useLayoutEffect(() => {
    latest.current = { open, onAfterClose };
  });

  const closeDenied = () => [...checkAllowClose.current].some((check) => check() === "deny");

  useEscapeKeyStack(open, () => {
    if (!closeDenied()) setOpen(false);
  });

  useEffect(() => {
    if (content != null && !content.contains(document.activeElement)) content.focus({ preventScroll: true });
  }, [content]);

  const guardOutsideInteraction = (event: CustomEvent) => {
    if (
      isIgnoredOutsideTarget(event.target) ||
      event.type === "dismissableLayer.focusOutside" ||
      event.type === "dismissableLayer.blurOutside" ||
      closeDenied()
    ) {
      event.preventDefault();
    }
  };

  return (
    <RadixDialog.Portal forceMount container={portalContainer ?? getPortalRoot()}>
      <TransitionGroup
        preventInitialTransition={!animateOnMount}
        enterDuration={ENTER_DURATION_MS}
        exitDuration={EXIT_DURATION_MS}
        className={clsx(css.ModalPortal, portalClassName)}
      >
        {open && (
          <div key="modal" className={css.ModalPortalInner} data-backdrop={backdrop}>
            <div className={css.ModalBackdrop} />
            <div className={css.ModalContainer} data-modal-scroll={wide ? scroll : "inside"}>
              <div className={css.ModalContainerInner}>
                <RadixDialog.Content
                  forceMount
                  {...rest}
                  ref={setContent}
                  className={clsx("ws-dialog", "ws-dialog--modal", css.Modal, className)}
                  style={{ ...style, ...(maxWidth == null ? null : { "--modal-max-width": `${maxWidth}px` }) } as CSSProperties}
                  data-animate={shake ? "shake" : undefined}
                  onCloseAutoFocus={(event) => {
                    onCloseAutoFocus?.(event);
                    if (!latest.current.open) latest.current.onAfterClose?.();
                  }}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onEscapeKeyDown={(event) => event.preventDefault()}
                  onKeyDown={(event) => {
                    if (content == null || event.target !== content || event.key !== "Tab" || !event.shiftKey) return;
                    event.preventDefault();
                    event.stopPropagation();
                    Array.from(content.querySelectorAll<HTMLElement>(TABBABLE)).at(-1)?.focus();
                  }}
                  onPointerDownOutside={guardOutsideInteraction}
                  onInteractOutside={guardOutsideInteraction}
                >
                  {children}
                </RadixDialog.Content>
              </div>
            </div>
          </div>
        )}
      </TransitionGroup>
    </RadixDialog.Portal>
  );
}

/** `a4.Trigger`: opens the modal on click of its child. */
export function ModalTrigger({ children, ref }: { children: ReactElement; ref?: Ref<HTMLButtonElement> }) {
  return (
    <RadixDialog.Trigger asChild ref={ref}>
      {children}
    </RadixDialog.Trigger>
  );
}

/** `a4.Form`. */
export function ModalForm({ children, className, ...rest }: ComponentProps<"form">) {
  return (
    <form className={clsx(css.Form, className)} {...rest}>
      {children}
    </form>
  );
}

/** `a4.Header`. */
export function ModalHeader({ children }: { children?: ReactNode }) {
  return <div className={css.Header}>{children}</div>;
}

/** `zRo`: whether `ref`'s element overflows and where it is scrolled to, following scrolling and resizes. */
function useScrollState(ref: RefObject<HTMLElement | null>) {
  const [isScrollable, setIsScrollable] = useState(false);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element == null) return;
    const update = () => {
      const { scrollHeight, clientHeight, scrollTop } = element;
      setIsScrollable(scrollHeight > clientHeight);
      setIsAtStart(scrollTop === 0);
      setIsAtEnd(scrollTop + clientHeight >= scrollHeight);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref]);
  return { isScrollable, isAtStart, isAtEnd };
}

/** `a4.Body`: the scrolling area, marked with whether it overflows and whether it is scrolled to the top. */
export function ModalBody({ children, className, ...rest }: ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const { isScrollable, isAtStart } = useScrollState(ref);
  return (
    <div ref={ref} className={clsx(css.Body, className)} data-scrollable={isScrollable} data-scroll-at-top={isAtStart} {...rest}>
      {children}
    </div>
  );
}

/** `a4.Footer`. */
export function ModalFooter({ children, className, ...rest }: ComponentProps<"div">) {
  return (
    <div className={clsx(css.Footer, className)} {...rest}>
      {children}
    </div>
  );
}

/** `a4.Title`. */
export function ModalTitle({ className, ...rest }: ComponentProps<typeof RadixDialog.Title>) {
  return <RadixDialog.Title className={clsx(css.Title, className)} {...rest} />;
}

export interface ModalDescriptionProps {
  children?: ReactNode;
  className?: string;
  visuallyHidden?: boolean;
}

/** `a4.Description`. */
export function ModalDescription({ children, className, visuallyHidden = false }: ModalDescriptionProps) {
  return (
    <RadixDialog.Description className={clsx(css.Description, className)} data-visually-hidden={visuallyHidden ? "" : undefined}>
      {children}
    </RadixDialog.Description>
  );
}

export interface ModalCloseProps {
  children: ReactElement | ((controls: { close: () => void }) => ReactNode);
}

/** `a4.Close`: closes on click of its child, or hands a `close` callback to a render function. */
export function ModalClose({ children }: ModalCloseProps) {
  const { setOpen } = useModalContext();
  if (typeof children === "function") return <>{children({ close: () => setOpen(false) })}</>;
  return <RadixDialog.Close asChild>{children}</RadixDialog.Close>;
}

/** `JRo`: shakes the modal. The attribute is removed and painted first so a repeated shake restarts the animation. */
function useModalShake() {
  const { setShake } = useModalContext();
  return useCallback(() => {
    flushSync(() => setShake(false));
    afterFrames(() => setShake(true));
  }, [setShake]);
}

/**
 * `XRo`: `close` closes the surrounding modal and `shake` shakes it; `onRequestClose` can veto Escape and outside clicks
 * while it is mounted.
 */
export function useModalClose({ onRequestClose }: { onRequestClose?: ModalCloseCheck } = {}) {
  const { setOpen, checkAllowClose } = useModalContext();
  const shake = useModalShake();
  useEffect(() => {
    if (onRequestClose == null) return;
    const checks = checkAllowClose.current;
    checks.add(onRequestClose);
    return () => {
      checks.delete(onRequestClose);
    };
  }, [checkAllowClose, onRequestClose]);
  return { close: useCallback(() => setOpen(false), [setOpen]), shake };
}
