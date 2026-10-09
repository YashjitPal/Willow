import clsx from "clsx";
import { Dialog as RadixDialog } from "radix-ui";
import {
  Fragment,
  cloneElement,
  isValidElement,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { IntlContext } from "react-intl";
import { LegacySharedDbi838cIcon } from "../icons/legacy-shared-dbi-838c";
import { Icon } from "../icons/icon";
import { XmarkLgLight20Icon } from "../icons/xmark-lg-light-20";
import { xmarkLgRegular20 } from "../icons/xmark-lg-regular-20";
import { XmarkMdLight20Icon, xmarkMdLight20 } from "../icons/xmark-md-light-20";
import { OverlayOwnerContext, dismissTooltips, useWindowZoom } from "./overlay-context";
import { getPortalRoot } from "./portal-root";

const css = {
  beaconModalOverlay: "_beaconModalOverlay_zt97a_2",
  catalogSurface: "_catalogSurface_zt97a_2",
  catalogCompact: "_catalogCompact_zt97a_2",
  creditCheckoutSurface: "_creditCheckoutSurface_zt97a_2",
  centeredTextSurface: "_centeredTextSurface_zt97a_2",
  centeredTextClose: "_centeredTextClose_zt97a_2",
  promotionalTitle: "_promotionalTitle_zt97a_2",
  dimmedOverlay: "_dimmedOverlay_zt97a_2",
  imageOverlay: "_imageOverlay_zt97a_2",
  topPosition: "_topPosition_zt97a_2",
  voicePickerSurface: "_voicePickerSurface_zt97a_2",
  voicePickerClose: "_voicePickerClose_zt97a_2",
  voicePickerOverlay: "_voicePickerOverlay_zt97a_2",
  responsiveSheet: "_responsiveSheet_zt97a_2",
  expressiveBeaconSurface: "_expressiveBeaconSurface_zt97a_2",
  expressiveBeaconTitle: "_expressiveBeaconTitle_zt97a_2",
  photoSetupPosition: "_photoSetupPosition_zt97a_2",
} as const;

const closeButtonMessage = {
  id: "codex.dialog.closeButton",
  defaultMessage: "Close dialog",
  description: "Accessible label for the button that closes a dialog",
};

export type DialogVariant =
  | "default"
  | "opaque"
  | "chatgpt"
  | "photoSetup"
  | "beacon"
  | "beaconModal"
  | "expressiveBeacon"
  | "voicePicker"
  | "onboarding"
  | "mediaDetail"
  | "promotional"
  | "form"
  | "catalog"
  | "centeredText"
  | "confirmation"
  | "creditCheckout"
  | "image";

export type DialogSize =
  | "default"
  | "large"
  | "narrow"
  | "feature"
  | "setup"
  | "catalogDetail"
  | "beacon"
  | "compact"
  | "medium"
  | "wide"
  | "share"
  | "feedback"
  | "xwide"
  | "xwideTall"
  | "xxwide"
  | "xxxwideTall"
  | "editor"
  | "appLauncher"
  | "square"
  | "sheet"
  | "responsiveSheet";

export type DialogContentPosition = "centered" | "top" | "scrollable" | "inline" | "anchored";
export type DialogCloseButtonSize = "default" | "compact" | "large";
export type DialogRadius = "default" | "compact";

function dialogSizeClass(size: DialogSize | undefined) {
  switch (size) {
    case "large":
      return "w-lg";
    case "narrow":
      return "w-[380px]";
    case "feature":
      return "w-[400px]";
    case "setup":
      return "h-[min(600px,calc(100dvh-2rem))] w-120";
    case "catalogDetail":
      return "w-143.5";
    case "beacon":
      return "w-120";
    case "compact":
      return "w-105";
    case "medium":
      return "w-md";
    case "wide":
      return "w-150";
    case "share":
      return "w-160";
    case "feedback":
      return "w-xl";
    case "xwide":
      return "w-[680px]";
    case "xwideTall":
      return "h-[min(92vh,800px)] max-h-[min(92vh,800px)] w-[680px]";
    case "xxwide":
      return "w-[800px]";
    case "xxxwideTall":
      return "h-[min(85vh,740px)] max-h-[min(85vh,740px)] w-[960px]";
    case "editor":
      return "w-[600px] h-[720px] max-w-full max-h-full";
    case "appLauncher":
      return "w-[750px] h-[720px]";
    case "square":
      return "aspect-square";
    case "sheet":
      return "rounded-b-none";
    case "responsiveSheet":
      return css.responsiveSheet;
    default:
      return "w-130";
  }
}

type RadixContentProps = ComponentProps<typeof RadixDialog.Content>;

export interface DialogContentProps extends Omit<RadixContentProps, "children"> {
  children?: ReactNode;
  modal: boolean;
  autoFocusCloseButton?: boolean;
  contentClassName?: string;
  contentOverflow?: "hidden" | "visible";
  contentPosition?: DialogContentPosition;
  dialogCloseClassName?: string;
  closeButtonSize?: DialogCloseButtonSize;
  dialogCloseLabel?: string;
  headerActions?: ReactNode;
  overlayClassName?: string;
  transparentImage?: boolean;
  portalContainer?: HTMLElement | null;
  radius?: DialogRadius;
  showDialogClose?: boolean;
  shouldIgnoreClickOutside?: boolean;
  shouldStopPointerDownPropagation?: boolean;
  unstyledContent?: boolean;
  viewportSized?: boolean;
  variant?: DialogVariant;
  size?: DialogSize;
  widthHint?: number;
}

export interface DialogProps extends Omit<DialogContentProps, "modal" | keyof RadixContentProps>, Omit<ComponentProps<typeof RadixDialog.Root>, "children"> {
  children?: ReactNode;
  triggerContent?: ReactNode;
  triggerAsChild?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  /** Spread onto `DialogContent` after the named props (aria attributes, focus handlers, data attributes, content options). */
  contentProps?: Partial<Omit<DialogContentProps, "children" | "modal">> & Record<`data-${string}`, unknown>;
}

/** Codex dialog (`ZS` in the bundles): Radix dialog root + optional trigger + styled content. */
export function Dialog({
  children,
  modal = true,
  autoFocusCloseButton,
  triggerContent,
  triggerAsChild = true,
  triggerRef,
  contentClassName,
  contentOverflow = "hidden",
  contentPosition = "centered",
  contentProps,
  dialogCloseClassName,
  closeButtonSize,
  dialogCloseLabel,
  headerActions,
  overlayClassName,
  transparentImage,
  portalContainer,
  radius = "default",
  showDialogClose = true,
  shouldIgnoreClickOutside = false,
  unstyledContent = false,
  viewportSized = false,
  variant = "default",
  size = "default",
  widthHint,
  ...rootProps
}: DialogProps) {
  return (
    <RadixDialog.Root modal={modal} {...rootProps}>
      {triggerContent && (
        <RadixDialog.Trigger ref={triggerRef} asChild={triggerAsChild}>
          {triggerContent}
        </RadixDialog.Trigger>
      )}
      <DialogContent
        modal={modal}
        autoFocusCloseButton={autoFocusCloseButton}
        contentClassName={contentClassName}
        contentOverflow={contentOverflow}
        contentPosition={contentPosition}
        closeButtonSize={closeButtonSize}
        dialogCloseClassName={dialogCloseClassName}
        dialogCloseLabel={dialogCloseLabel}
        headerActions={headerActions}
        overlayClassName={overlayClassName}
        transparentImage={transparentImage}
        portalContainer={portalContainer}
        radius={radius}
        showDialogClose={showDialogClose}
        shouldIgnoreClickOutside={shouldIgnoreClickOutside}
        unstyledContent={unstyledContent}
        viewportSized={viewportSized}
        variant={variant}
        size={size}
        widthHint={widthHint}
        {...contentProps}
      >
        {children}
      </DialogContent>
    </RadixDialog.Root>
  );
}

const FIXED_HEIGHT_CLASS = /\bh-(?!auto\b)[^\s]+/;

export function DialogContent({
  children,
  modal,
  autoFocusCloseButton,
  contentClassName,
  contentOverflow,
  contentPosition,
  dialogCloseClassName,
  closeButtonSize = "default",
  dialogCloseLabel,
  headerActions,
  overlayClassName,
  transparentImage,
  portalContainer,
  radius = "default",
  showDialogClose = true,
  shouldIgnoreClickOutside = false,
  shouldStopPointerDownPropagation = true,
  unstyledContent = false,
  viewportSized = false,
  variant = "default",
  size,
  widthHint,
  asChild,
  className,
  onOpenAutoFocus,
  onPointerDown,
  onPointerDownOutside,
  style,
  ...rest
}: DialogContentProps) {
  const intl = useContext(IntlContext);
  const overlayOwner = useContext(OverlayOwnerContext);
  const zoom = useWindowZoom();
  const plain = variant === "default" || variant === "opaque";
  const beacon = variant === "beacon" || variant === "beaconModal" || variant === "expressiveBeacon";
  const catalogLike = variant === "catalog" || variant === "centeredText" || variant === "confirmation";
  const creditCheckout = variant === "creditCheckout";

  const positionClasses = clsx(
    "codex-dialog z-50",
    variant !== "centeredText" && "outline-none",
    size === "sheet" && "bottom-0 left-0",
    contentPosition === "centered" &&
      variant !== "image" &&
      size !== "sheet" &&
      size !== "responsiveSheet" && ["left-1/2 -translate-x-1/2 -translate-y-1/2", variant === "photoSetup" ? css.photoSetupPosition : "top-1/2"],
    contentPosition === "top" && ["left-1/2 -translate-x-1/2", css.topPosition],
    contentPosition === "scrollable" && "relative m-auto shrink-0 pointer-events-auto",
    contentPosition !== "inline" && contentPosition !== "scrollable" && (portalContainer == null ? "fixed" : "absolute"),
  );
  const surfaceClasses = clsx(
    variant === "default" && "bg-surface-elevated-secondary/90 text-default ring-border ring-[0.5px] ring-border shadow-lg backdrop-blur-xl",
    (variant === "chatgpt" || variant === "photoSetup" || beacon) && [
      "dark:bg-surface-tertiary text-default",
      variant === "chatgpt" && contentPosition === "anchored" && size !== "sheet" && size !== "responsiveSheet"
        ? "bg-surface-elevated bg-clip-padding md:border md:border-default md:shadow-2xl"
        : "bg-surface shadow-lg",
    ],
    variant === "expressiveBeacon" && ["border border-default", css.expressiveBeaconSurface],
    variant === "voicePicker" && css.voicePickerSurface,
    variant === "onboarding" && "bg-surface-elevated text-default shadow-lg",
    variant === "mediaDetail" && "bg-surface text-default shadow-lg",
    (variant === "opaque" || variant === "promotional") && "bg-surface-elevated-secondary text-default shadow-lg ring-[0.5px] ring-border",
    variant === "form" && "rounded-form-dialog bg-surface-elevated-secondary text-default shadow-form-dialog ring-[0.5px] ring-border",
    catalogLike && ["bg-surface-elevated-secondary text-default", css.catalogSurface],
    variant === "centeredText" && css.centeredTextSurface,
    catalogLike && radius === "compact" && css.catalogCompact,
    creditCheckout && ["relative rounded-2xl bg-surface", css.creditCheckoutSurface],
    variant !== "image" &&
      variant !== "expressiveBeacon" &&
      variant !== "form" &&
      variant !== "voicePicker" &&
      !catalogLike &&
      !creditCheckout &&
      size !== "responsiveSheet" &&
      (radius === "compact" || variant === "chatgpt" || beacon ? "rounded-2xl" : "rounded-3xl"),
    variant !== "image" &&
      variant !== "voicePicker" &&
      !creditCheckout &&
      size !== "sheet" &&
      size !== "square" &&
      size !== "responsiveSheet" &&
      (contentPosition === "scrollable" ? "max-w-full" : "max-w-[92vw]"),
    contentOverflow === "visible" ? "overflow-visible" : "overflow-hidden",
    beacon && "max-h-[92dvh] overflow-y-auto",
  );

  const sizeStyle: CSSProperties = {};
  if (size === "square") {
    sizeStyle.width = `min(760px, calc(100vw / ${zoom} - 4rem), calc(100dvh / ${zoom} - 6rem))`;
  } else if (size === "sheet") {
    sizeStyle.width = `calc(100vw / ${zoom})`;
    sizeStyle.height = `calc(70dvh / ${zoom})`;
    sizeStyle.maxHeight = `calc(100dvh / ${zoom} - 1rem)`;
  } else if (size === "appLauncher") {
    sizeStyle.maxWidth = `calc(92vw / ${zoom})`;
    sizeStyle.maxHeight = `calc(90dvh / ${zoom})`;
  }
  if (contentPosition === "scrollable" && portalContainer == null) sizeStyle.maxWidth = `calc((100vw - 2rem) / ${zoom})`;

  let sizeClass = dialogSizeClass(size);
  if (variant === "image") sizeClass = "inset-0 flex h-full w-full flex-col";
  else if (creditCheckout) sizeClass = "max-w-125";

  const contentNode = useRef<HTMLDivElement>(null);
  const measuredNode = useRef<HTMLDivElement>(null);
  const hasFixedHeight =
    style?.height != null || FIXED_HEIGHT_CLASS.test(sizeClass) || FIXED_HEIGHT_CLASS.test(contentClassName ?? "") || FIXED_HEIGHT_CLASS.test(className ?? "");
  const animatesHeight =
    !asChild &&
    !unstyledContent &&
    contentPosition !== "top" &&
    size !== "editor" &&
    size !== "square" &&
    size !== "sheet" &&
    size !== "responsiveSheet" &&
    size !== "xxxwideTall" &&
    !hasFixedHeight;

  useLayoutEffect(() => {
    if (!animatesHeight) return;
    const content = contentNode.current;
    const measured = measuredNode.current;
    if (content == null || measured == null || typeof ResizeObserver === "undefined") return;
    let measureFrame: number | null = null;
    let readyFrame: number | null = null;
    let lastHeight = -1;
    let ready = false;
    const applyHeight = (height: number) => {
      if (!Number.isFinite(height) || Math.abs(height - lastHeight) < 0.5) return;
      lastHeight = height;
      content.style.setProperty("--dialog-content-height", `${height}px`);
      content.style.height = "var(--dialog-content-height)";
      if (ready) return;
      if (readyFrame != null) cancelAnimationFrame(readyFrame);
      readyFrame = requestAnimationFrame(() => {
        ready = true;
        content.dataset.dialogHeightReady = "true";
      });
    };
    const scheduleMeasure = () => {
      measureFrame ??= requestAnimationFrame(() => {
        measureFrame = null;
        applyHeight(measured.offsetHeight || measured.scrollHeight);
      });
    };
    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(measured);
    return () => {
      observer.disconnect();
      if (measureFrame != null) cancelAnimationFrame(measureFrame);
      if (readyFrame != null) cancelAnimationFrame(readyFrame);
      content.style.removeProperty("--dialog-content-height");
      content.style.height = "";
      delete content.dataset.dialogHeightReady;
    };
  }, [animatesHeight]);

  const closeLabel = dialogCloseLabel || intl?.formatMessage(closeButtonMessage) || closeButtonMessage.defaultMessage;
  const closeButton = showDialogClose ? (
    <RadixDialog.Close
      className={clsx(
        "no-drag cursor-interaction leading-none hover:bg-primary-ghost-hover",
        variant !== "voicePicker" && "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        creditCheckout && "flex size-9 items-center justify-center rounded-lg text-token-text-secondary",
        !creditCheckout && variant !== "form" && (catalogLike || variant === "voicePicker" ? "text-default" : "text-text/80"),
        variant === "form" && "text-tertiary hover:text-default",
        variant === "voicePicker" && "absolute flex items-center justify-center",
        variant !== "voicePicker" &&
          !creditCheckout &&
          (!plain || closeButtonSize !== "default"
            ? clsx(
                "flex items-center justify-center",
                variant === "chatgpt" || variant === "photoSetup" ? "rounded-lg" : "rounded-full",
                closeButtonSize === "compact" && "size-7 bg-surface shadow-xs ring-[0.5px] ring-border",
                closeButtonSize !== "compact" && (variant === "centeredText" || variant === "expressiveBeacon" || closeButtonSize === "large" ? "size-9" : "size-8"),
              )
            : "rounded p-1"),
        headerActions == null && creditCheckout && "absolute top-4 end-4",
        headerActions == null && variant !== "voicePicker" && !creditCheckout && closeButtonSize === "large" && "absolute top-4.5 end-4.5",
        headerActions == null && variant !== "voicePicker" && !creditCheckout && closeButtonSize !== "large" && variant === "form" && "absolute top-4 right-3.5",
        headerActions == null &&
          variant !== "voicePicker" &&
          !creditCheckout &&
          closeButtonSize !== "large" &&
          variant !== "form" &&
          variant !== "centeredText" && [
            "absolute",
            variant === "photoSetup" && "top-2 right-2",
            (variant === "chatgpt" || variant === "promotional") && "top-3 right-3",
            variant !== "photoSetup" && variant !== "chatgpt" && variant !== "promotional" && "top-4 right-4",
          ],
        variant === "beacon" && closeButtonSize !== "compact" && "size-9 bg-surface/80 shadow-xs backdrop-blur-md",
        variant === "beaconModal" &&
          closeButtonSize !== "compact" &&
          "size-9 bg-surface/20 hover:bg-surface/30 active:bg-surface/80 dark:active:bg-surface/70 shadow-xs backdrop-blur-md transition-colors",
        variant === "centeredText" && css.centeredTextClose,
        variant === "voicePicker" && css.voicePickerClose,
        dialogCloseClassName,
      )}
      autoFocus={autoFocusCloseButton}
      onClick={(event) => event.stopPropagation()}
    >
      {closeButtonSize !== "default" && <XmarkLgLight20Icon />}
      {closeButtonSize === "default" && catalogLike && <Icon asset={xmarkLgRegular20} />}
      {closeButtonSize === "default" && variant === "form" && <Icon asset={xmarkMdLight20} />}
      {closeButtonSize === "default" && !catalogLike && !plain && variant !== "form" && <XmarkMdLight20Icon />}
      {closeButtonSize === "default" && plain && <LegacySharedDbi838cIcon aria-hidden className="icon-xs" />}
      <span className="sr-only">{closeLabel}</span>
    </RadixDialog.Close>
  ) : null;
  const closeArea =
    headerActions == null ? (
      closeButton
    ) : (
      <div className="absolute top-5 right-5 flex items-center gap-1 no-drag">
        {headerActions}
        {closeButton}
      </div>
    );

  const contentWidth = widthHint != null && Number.isFinite(widthHint) && widthHint > 0 ? widthHint : undefined;
  const contentZoom = contentPosition !== "inline" && portalContainer == null && zoom !== 1 ? zoom : undefined;
  const viewportStyle = viewportSized && portalContainer == null ? { height: `calc(100dvh / ${zoom})`, width: `calc(100vw / ${zoom})` } : null;
  const setupStyle = size === "setup" && portalContainer == null ? { height: `min(600px, calc((100dvh - 2rem) / ${zoom}))`, maxWidth: `calc((100dvw - 2rem) / ${zoom})` } : null;

  const body =
    asChild && isValidElement<{ children?: ReactNode }>(children) ? (
      cloneElement(children as ReactElement<{ children?: ReactNode }>, undefined, children.props.children, closeArea)
    ) : (
      <>
        {animatesHeight ? <div ref={measuredNode}>{children}</div> : children}
        {closeArea}
      </>
    );

  const content = (
    <RadixDialog.Content
      asChild={asChild}
      ref={contentNode}
      data-overlay-owner={overlayOwner?.id}
      className={clsx("ws-dialog", `ws-dialog--${variant}`, positionClasses, !unstyledContent && surfaceClasses, !unstyledContent && variant !== "voicePicker" && sizeClass, contentClassName, className)}
      aria-modal={modal}
      style={{ width: contentWidth, zoom: contentZoom, ...sizeStyle, ...viewportStyle, ...setupStyle, ...style }}
      onPointerDownOutside={(event) => {
        if (shouldIgnoreClickOutside) event.preventDefault();
        onPointerDownOutside?.(event);
      }}
      onPointerDown={(event) => {
        if (shouldStopPointerDownPropagation) event.stopPropagation();
        onPointerDown?.(event);
      }}
      onOpenAutoFocus={(event) => {
        dismissTooltips();
        window.getSelection()?.removeAllRanges();
        onOpenAutoFocus?.(event);
      }}
      {...rest}
    >
      {body}
    </RadixDialog.Content>
  );

  const Wrapper = contentPosition === "inline" ? Fragment : RadixDialog.Portal;
  const wrapperProps = contentPosition === "inline" ? {} : { container: portalContainer ?? getPortalRoot() };
  return (
    <Wrapper {...wrapperProps}>
      {contentPosition === "scrollable" && !modal ? (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full p-4">{content}</div>
        </div>
      ) : (
        <>
          <RadixDialog.Overlay asChild>
            <DialogOverlay
              className={clsx(overlayClassName, contentPosition === "scrollable" && "overflow-y-auto")}
              variant={variant}
              transparentImage={transparentImage}
              size={size}
              position={variant === "image" && portalContainer != null ? "absolute" : "fixed"}
            >
              {contentPosition === "scrollable" ? <div className="flex min-h-full p-4">{content}</div> : null}
            </DialogOverlay>
          </RadixDialog.Overlay>
          {contentPosition === "scrollable" ? null : content}
        </>
      )}
    </Wrapper>
  );
}

export interface DialogOverlayProps extends ComponentProps<"div"> {
  variant?: DialogVariant;
  size?: DialogSize;
  position?: "fixed" | "absolute";
  transparentImage?: boolean;
}

/** Dialog backdrop (`QS` in the bundles). */
export function DialogOverlay({ className, transparentImage, variant = "default", size = "default", position = "fixed", ...rest }: DialogOverlayProps) {
  return (
    <div
      className={clsx(
        "codex-dialog-overlay inset-0 z-50 pointer-events-auto",
        position,
        (variant === "beaconModal" || variant === "expressiveBeacon" || size === "responsiveSheet") && css.beaconModalOverlay,
        (variant === "opaque" ||
          variant === "form" ||
          variant === "catalog" ||
          variant === "confirmation" ||
          variant === "centeredText" ||
          variant === "creditCheckout" ||
          variant === "image") &&
          css.dimmedOverlay,
        variant === "image" && css.imageOverlay,
        variant === "voicePicker" && css.voicePickerOverlay,
        (variant === "beacon" || variant === "promotional") && "bg-text/5 backdrop-blur-sm",
        (variant === "default" || variant === "chatgpt" || variant === "photoSetup" || variant === "mediaDetail") &&
          size !== "responsiveSheet" &&
          "bg-(--color-dialog-overlay) codex-dialog-overlay fixed inset-0 z-50",
        className,
      )}
      data-transparent={variant === "image" ? transparentImage : undefined}
      {...rest}
    />
  );
}

export type DialogTitleVariant = "default" | "promotional" | "confirmation" | "expressiveBeacon";

export interface DialogTitleProps extends ComponentProps<typeof RadixDialog.Title> {
  variant?: DialogTitleVariant;
}

/** Accessible dialog title (`eC` in the bundles), a Radix `h2`. */
export function DialogTitle({ variant = "default", className, ...rest }: DialogTitleProps) {
  return (
    <RadixDialog.Title
      className={clsx(
        variant === "default" && "ws-dialog__title",
        className,
        variant === "promotional" && css.promotionalTitle,
        variant === "confirmation" && "px-6 text-center text-heading-lg leading-7 font-semibold select-none",
        variant === "expressiveBeacon" && css.expressiveBeaconTitle,
      )}
      {...rest}
    />
  );
}

/** Accessible dialog description (`$S` in the bundles), a Radix `p`. */
export function DialogDescription(props: ComponentProps<typeof RadixDialog.Description>) {
  return <RadixDialog.Description {...props} />;
}

export const DialogClose = RadixDialog.Close;
