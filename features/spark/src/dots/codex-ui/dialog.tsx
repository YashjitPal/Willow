import clsx from 'clsx';
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { LegacySharedDbi838cIcon } from '../codex-icons/legacy-shared-dbi-838c';
import { XmarkMdLight20Icon } from '../codex-icons/xmark-md-light-20';

/**
 * Codex's dialog (`ZS`) without Radix: the same size, position, surface and
 * close-button classes, portalled into a `.willow-dots` root so the Codex rules
 * apply, on Willow's dialog surface (`willow-dots-dialog` in dots-theme.css).
 */
export type DialogVariant = 'default' | 'opaque' | 'chatgpt' | 'onboarding' | 'mediaDetail' | 'form';
export type DialogSize = 'default' | 'large' | 'narrow' | 'compact' | 'medium' | 'wide' | 'xwide' | 'xxwide' | 'editor';
export type DialogContentPosition = 'centered' | 'scrollable';

function dialogSizeClass(size: DialogSize | undefined) {
  switch (size) {
    case 'large':
      return 'w-lg';
    case 'narrow':
      return 'w-[380px]';
    case 'compact':
      return 'w-105';
    case 'medium':
      return 'w-md';
    case 'wide':
      return 'w-150';
    case 'xwide':
      return 'w-[680px]';
    case 'xxwide':
      return 'w-[800px]';
    case 'editor':
      return 'w-[600px] h-[720px] max-w-full max-h-full';
    default:
      return 'w-130';
  }
}

interface DialogContentProps {
  className?: string;
  style?: CSSProperties;
  'aria-describedby'?: string;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export interface DialogProps {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerContent?: ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
  variant?: DialogVariant;
  size?: DialogSize;
  contentPosition?: DialogContentPosition;
  contentClassName?: string;
  overlayClassName?: string;
  showDialogClose?: boolean;
  shouldIgnoreClickOutside?: boolean;
  dialogCloseLabel?: string;
  contentProps?: DialogContentProps;
}

const DialogIdsContext = createContext<{ titleId: string; descriptionId: string } | null>(null);

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  children,
  open = false,
  onOpenChange,
  triggerContent,
  variant = 'default',
  size = 'default',
  contentPosition = 'centered',
  contentClassName,
  overlayClassName,
  showDialogClose = true,
  shouldIgnoreClickOutside = false,
  dialogCloseLabel,
  contentProps = {},
}: DialogProps) {
  const trigger =
    isValidElement<{ onClick?: (event: ReactMouseEvent) => void }>(triggerContent) &&
    cloneElement(triggerContent as ReactElement<Record<string, unknown>>, {
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'data-state': open ? 'open' : 'closed',
      onClick: (event: ReactMouseEvent) => {
        triggerContent.props.onClick?.(event);
        if (!event.defaultPrevented) onOpenChange?.(true);
      },
    });
  return (
    <>
      {trigger}
      {open ? (
        <DialogPortal
          variant={variant}
          size={size}
          contentPosition={contentPosition}
          contentClassName={contentClassName}
          overlayClassName={overlayClassName}
          showDialogClose={showDialogClose}
          shouldIgnoreClickOutside={shouldIgnoreClickOutside}
          dialogCloseLabel={dialogCloseLabel}
          contentProps={contentProps}
          onClose={() => onOpenChange?.(false)}
        >
          {children}
        </DialogPortal>
      ) : null}
    </>
  );
}

interface DialogPortalProps extends Omit<DialogProps, 'open' | 'onOpenChange' | 'triggerContent' | 'triggerRef'> {
  onClose: () => void;
}

function DialogPortal({
  children,
  variant = 'default',
  size,
  contentPosition,
  contentClassName,
  overlayClassName,
  showDialogClose,
  shouldIgnoreClickOutside,
  dialogCloseLabel,
  contentProps = {},
  onClose,
}: DialogPortalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [ids] = useState(() => ({ titleId, descriptionId }));
  const latest = useRef({ contentProps, onClose });
  latest.current = { contentProps, onClose };

  useLayoutEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const content = contentRef.current;
    const openEvent = new Event('dialog.openAutoFocus', { cancelable: true });
    latest.current.contentProps.onOpenAutoFocus?.(openEvent);
    if (!openEvent.defaultPrevented && content != null && !content.contains(document.activeElement)) {
      (content.querySelector<HTMLElement>('[autofocus]') ?? content).focus({ preventScroll: true });
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        latest.current.contentProps.onEscapeKeyDown?.(event);
        if (!event.defaultPrevented) latest.current.onClose();
        return;
      }
      if (event.key !== 'Tab' || content == null) return;
      const focusable = Array.from(content.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !content.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      const closeEvent = new Event('dialog.closeAutoFocus', { cancelable: true });
      latest.current.contentProps.onCloseAutoFocus?.(closeEvent);
      if (!closeEvent.defaultPrevented) returnFocus?.focus({ preventScroll: true });
    };
  }, []);

  const plain = variant === 'default' || variant === 'opaque';
  const scrollable = contentPosition === 'scrollable';
  const positionClasses = clsx(
    'codex-dialog z-50 outline-none',
    !scrollable && ['left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2', 'fixed'],
    scrollable && 'relative m-auto shrink-0 pointer-events-auto',
  );
  const surfaceClasses = clsx(
    variant === 'default' && 'bg-surface-elevated-secondary/90 text-default ring-border ring-[0.5px] ring-border shadow-lg backdrop-blur-xl',
    variant === 'chatgpt' && 'dark:bg-surface-tertiary text-default bg-surface shadow-lg',
    variant === 'onboarding' && 'bg-surface-elevated text-default shadow-lg',
    variant === 'mediaDetail' && 'bg-surface text-default shadow-lg',
    variant === 'opaque' && 'bg-surface-elevated-secondary text-default shadow-lg ring-[0.5px] ring-border',
    variant === 'form' && 'rounded-form-dialog bg-surface-elevated-secondary text-default shadow-form-dialog ring-[0.5px] ring-border',
    variant !== 'form' && (variant === 'chatgpt' ? 'rounded-2xl' : 'rounded-3xl'),
    scrollable ? 'max-w-full' : 'max-w-[92vw]',
    'overflow-hidden',
  );

  const closeButton = showDialogClose ? (
    <button
      type="button"
      className={clsx(
        'no-drag cursor-interaction leading-none hover:bg-primary-ghost-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
        variant === 'form' ? 'text-tertiary hover:text-default' : 'text-text/80',
        plain ? 'rounded p-1' : 'flex items-center justify-center rounded-full size-8',
        variant === 'form' ? 'absolute top-4 right-3.5' : ['absolute', variant === 'chatgpt' ? 'top-3 right-3' : 'top-4 right-4'],
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      {plain ? <LegacySharedDbi838cIcon aria-hidden className="icon-xs" /> : <XmarkMdLight20Icon />}
      <span className="sr-only">{dialogCloseLabel || 'Close dialog'}</span>
    </button>
  ) : null;

  const content = (
    <div
      ref={contentRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ids.titleId}
      aria-describedby={'aria-describedby' in contentProps ? contentProps['aria-describedby'] : ids.descriptionId}
      tabIndex={-1}
      className={clsx(positionClasses, surfaceClasses, dialogSizeClass(size), 'willow-dots-dialog', contentClassName, contentProps.className)}
      style={{ ...(scrollable ? { maxWidth: 'calc(100vw - 2rem)' } : null), ...contentProps.style }}
      onClick={contentProps.onClick}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
      {closeButton}
    </div>
  );

  const dismissOutside = (event: { target: EventTarget; currentTarget: EventTarget }) => {
    if (event.target !== event.currentTarget || shouldIgnoreClickOutside) return;
    onClose();
  };

  return createPortal(
    <DialogIdsContext.Provider value={ids}>
      <div className="willow-dots willow-dots-dialog-root">
        <div
          className={clsx('codex-dialog-overlay inset-0 z-50 pointer-events-auto bg-(--color-dialog-overlay) fixed', scrollable && 'overflow-y-auto', overlayClassName)}
          onPointerDown={dismissOutside}
        >
          {scrollable ? (
            <div className="flex min-h-full p-4" onPointerDown={dismissOutside}>
              {content}
            </div>
          ) : null}
        </div>
        {scrollable ? null : content}
      </div>
    </DialogIdsContext.Provider>,
    document.body,
  );
}

export type DialogTitleVariant = 'default' | 'confirmation';

/** Accessible dialog title (`eC`). */
export function DialogTitle({ variant = 'default', className, ...rest }: ComponentProps<'h2'> & { variant?: DialogTitleVariant }) {
  const ids = useContext(DialogIdsContext);
  return (
    <h2
      id={ids?.titleId}
      className={clsx(className, variant === 'confirmation' && 'px-6 text-center text-heading-lg leading-7 font-semibold select-none')}
      {...rest}
    />
  );
}

/** Accessible dialog description (`$S`). */
export function DialogDescription(props: ComponentProps<'p'>) {
  const ids = useContext(DialogIdsContext);
  return <p id={ids?.descriptionId} {...props} />;
}
