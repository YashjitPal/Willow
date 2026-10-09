import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  MousePointerClick,
  PictureInPicture2,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import {
  FOLD_ORDER,
  type FoldedAction,
  FoldedActions,
  foldTerminal,
  useOfferedTerminal,
} from "~/willow/panelFolds";

/** The address keeps at least this much before a button folds into the menu. */
const MIN_ADDRESS_WIDTH = 180;
/** What a folded button gives back: the widest of them, the terminal's 36px header button and gap. */
const FOLD_STEP = 40;

interface Props {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshDisabled: boolean;
  inputDisabled?: boolean | undefined;
  /** Bumping this value re-focuses and selects the URL input. */
  focusUrlNonce?: number | undefined;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onSubmit: (url: string) => void;
  /** When provided, renders an "Open in browser" affordance to the right. */
  onOpenInBrowser?: (() => void) | undefined;
  onCapture?: ((record: boolean) => void) | undefined;
  captureDisabled?: boolean | undefined;
  recording?: boolean | undefined;
  onPictureInPicture?: (() => void) | undefined;
  pictureInPicture?: boolean | undefined;
  pictureInPictureDisabled?: boolean | undefined;
  /**
   * When provided, renders an annotation-mode toggle button to the right of
   * the URL input. Pressed while annotation mode is active (button shows in `pressed`
   * state). Disabled in `pickDisabled` mode.
   */
  onPickElement?: (() => void) | undefined;
  pickActive?: boolean | undefined;
  pickDisabled?: boolean | undefined;
  /** Optional reason string surfaced in the disabled tooltip. */
  pickDisabledReason?: string | undefined;
  /**
   * Trailing slot rendered after the URL input. Used by the preview view
   * to mount the three-dot menu (hard reload, devtools, zoom, clear data).
   */
  trailingActions?: ReactNode;
  /**
   * Slot between the nav buttons and the URL input. The preview view uses it
   * to name the tab's browser profile, which is otherwise invisible.
   */
  leadingActions?: ReactNode;
}

const NOOP = () => {};

export function PreviewChromeRow({
  url,
  loading,
  canGoBack,
  canGoForward,
  refreshDisabled,
  inputDisabled,
  focusUrlNonce,
  onBack,
  onForward,
  onRefresh,
  onSubmit,
  onOpenInBrowser,
  onCapture,
  captureDisabled,
  recording,
  onPictureInPicture,
  pictureInPicture,
  pictureInPictureDisabled,
  onPickElement,
  pickActive,
  pickDisabled,
  pickDisabledReason,
  trailingActions,
  leadingActions,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(url);
  const [inputFocused, setInputFocused] = useState(false);

  // As the row runs short its buttons fold into the "More" menu one at a time (willow/panelFolds),
  // the panel's terminal button too while the bar sits beside the panel's controls.
  const formRef = useRef<HTMLFormElement | null>(null);
  const [foldedCount, setFoldedCount] = useState(0);
  const [besideControls, setBesideControls] = useState(false);
  const offeredTerminal = useOfferedTerminal();
  const present: Record<(typeof FOLD_ORDER)[number], boolean> = {
    pictureInPicture: onPictureInPicture !== undefined,
    terminal: besideControls && offeredTerminal !== null,
    annotate: onPickElement !== undefined,
    screenshot: onCapture !== undefined,
  };
  const foldable = FOLD_ORDER.filter((name) => present[name]);
  const folded = new Set(foldable.slice(0, foldedCount));
  const foldableCount = useRef(foldable.length);
  useLayoutEffect(() => {
    foldableCount.current = foldable.length;
  });
  const foldsTerminal = folded.has("terminal");
  const measureRef = useRef<() => void>(() => undefined);

  // The panel's controls narrow once the terminal's button has gone; the bar takes the room.
  useEffect(() => {
    foldTerminal(foldsTerminal);
    const frame = requestAnimationFrame(() => measureRef.current());
    return () => cancelAnimationFrame(frame);
  }, [foldsTerminal]);
  useEffect(() => () => foldTerminal(false), []);

  useLayoutEffect(() => {
    const form = formRef.current;
    const address = form?.querySelector<HTMLElement>('[data-slot="input-group"]');
    if (!form || !address) return;
    const measure = () => {
      const beside =
        form
          .closest("[data-right-panel-surface-content]")
          ?.previousElementSibling?.hasAttribute("data-willow-strip-tabs") ?? false;
      setBesideControls(beside);
      // Beside the panel's controls the bar ends 4px short of them, however many of them show.
      const bar = form.getBoundingClientRect();
      const controls = beside
        ? [...document.querySelectorAll<HTMLElement>("[data-workspace-titlebar-controls]")]
            .map((element) => element.getBoundingClientRect())
            .find(
              (box) =>
                box.width > 0 &&
                box.left < bar.right &&
                box.right > bar.left &&
                box.top < bar.bottom &&
                box.bottom > bar.top,
            )
        : undefined;
      form.style.paddingInlineEnd = controls ? `${Math.ceil(bar.right - controls.left) + 4}px` : "";
      // Nothing folds without the menu to fold into.
      const hasMenu = form.querySelector('[aria-label="Preview menu"]') !== null;
      const width = address.getBoundingClientRect().width;
      setFoldedCount((count) => {
        if (!hasMenu) return 0;
        if (width < MIN_ADDRESS_WIDTH) return Math.min(count + 1, foldableCount.current);
        if (width >= MIN_ADDRESS_WIDTH + FOLD_STEP) return Math.max(count - 1, 0);
        return count;
      });
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    observer.observe(address);
    return () => observer.disconnect();
  }, []);

  // The menu lists them in the row's order, each named for what it will do.
  const foldedActions: FoldedAction[] = [];
  if (onPickElement && folded.has("annotate")) {
    foldedActions.push({
      key: "annotate",
      label: pickActive ? "Cancel annotation" : "Annotate preview",
      disabled: pickDisabled === true,
      onSelect: onPickElement,
    });
  }
  if (onCapture && folded.has("screenshot")) {
    foldedActions.push({
      key: "screenshot",
      label: recording ? "Stop recording" : "Capture screenshot",
      disabled: captureDisabled === true,
      onSelect: () => onCapture(false),
    });
  }
  if (onPictureInPicture && folded.has("pictureInPicture")) {
    foldedActions.push({
      key: "pictureInPicture",
      label: pictureInPicture ? "Close floating preview" : "Float preview over chat",
      disabled: pictureInPictureDisabled === true,
      onSelect: onPictureInPicture,
    });
  }
  if (offeredTerminal && foldsTerminal) {
    foldedActions.push({
      key: "terminal",
      label: offeredTerminal.open ? "Close terminal drawer" : "Open terminal drawer",
      disabled: !offeredTerminal.available,
      onSelect: offeredTerminal.toggle,
    });
  }

  useEffect(() => {
    if (focusUrlNonce == null) return;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
  }, [focusUrlNonce]);

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const next = draft.trim();
    if (next.length === 0) return;
    onSubmit(next);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <form
        ref={formRef}
        onSubmit={submit}
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <div className="flex items-center gap-0.5" role="group" aria-label="Navigation">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={canGoBack ? onBack : NOOP}
                  disabled={!canGoBack}
                  aria-label="Back"
                  type="button"
                />
              }
            >
              <ArrowLeft />
            </TooltipTrigger>
            <TooltipPopup>Back</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={canGoForward ? onForward : NOOP}
                  disabled={!canGoForward}
                  aria-label="Forward"
                  type="button"
                />
              }
            >
              <ArrowRight />
            </TooltipTrigger>
            <TooltipPopup>Forward</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={refreshDisabled ? NOOP : onRefresh}
                  disabled={refreshDisabled}
                  aria-label={loading ? "Stop" : "Refresh"}
                  type="button"
                />
              }
            >
              <RefreshIcon refreshing={loading} />
            </TooltipTrigger>
            <TooltipPopup>{loading ? "Loading…" : "Refresh"}</TooltipPopup>
          </Tooltip>
        </div>

        {leadingActions}

        <InputGroup variant="ghost" className="group/address h-7 flex-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupInput
                  ref={inputRef}
                  value={inputFocused ? draft : url}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={() => {
                    setDraft(url);
                    setInputFocused(true);
                    queueMicrotask(() => inputRef.current?.select());
                  }}
                  onBlur={() => {
                    setInputFocused(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit(event);
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDraft(url);
                      inputRef.current?.blur();
                    }
                  }}
                  placeholder="Search or enter URL"
                  spellCheck={false}
                  disabled={inputDisabled}
                  data-preview-url-input
                  size="sm"
                />
              }
            />
          </Tooltip>
          {onOpenInBrowser && !inputFocused ? (
            <InputGroupAddon align="inline-end">
              {/* Revealed on hover so a resting address bar reads as plain text. */}
              <span className="pointer-events-none flex opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/address:pointer-events-auto group-hover/address:opacity-100">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={onOpenInBrowser}
                        aria-label="Open in system browser"
                        type="button"
                      />
                    }
                  >
                    <ExternalLink />
                  </TooltipTrigger>
                  <TooltipPopup>Open in system browser</TooltipPopup>
                </Tooltip>
              </span>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {onPickElement && !folded.has("annotate") ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={pickActive ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={onPickElement}
                  disabled={pickDisabled}
                  aria-label={pickActive ? "Cancel annotation" : "Annotate preview"}
                  aria-pressed={pickActive ? "true" : "false"}
                  type="button"
                />
              }
            >
              <MousePointerClick className={cn(pickActive && "text-primary")} />
            </TooltipTrigger>
            <TooltipPopup>
              {pickDisabled && pickDisabledReason
                ? pickDisabledReason
                : pickActive
                  ? "Cancel annotation (Esc)"
                  : "Annotate elements, regions, and drawings"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {onCapture && !folded.has("screenshot") ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={recording ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={(event) => onCapture(event.shiftKey)}
                  aria-label={recording ? "Stop recording" : "Capture screenshot"}
                  type="button"
                  className="relative"
                  disabled={captureDisabled}
                />
              }
            >
              <Camera className={cn(recording && "text-destructive")} />
              {recording ? (
                <span className="absolute right-0.5 top-0.5 size-1.5 animate-status-pulse rounded-full bg-destructive" />
              ) : null}
            </TooltipTrigger>
            <TooltipPopup>
              {recording ? "Stop recording" : "Screenshot · Shift-click to record"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {onPictureInPicture && !folded.has("pictureInPicture") ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={pictureInPicture ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={onPictureInPicture}
                  aria-label={
                    pictureInPicture ? "Close floating preview" : "Float preview over chat"
                  }
                  aria-pressed={pictureInPicture ? "true" : "false"}
                  type="button"
                  disabled={pictureInPictureDisabled}
                />
              }
            >
              <PictureInPicture2 className={cn(pictureInPicture && "text-primary")} />
            </TooltipTrigger>
            <TooltipPopup>
              {pictureInPicture ? "Close floating preview" : "Float preview over chat"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <FoldedActions value={foldedActions}>{trailingActions}</FoldedActions>
      </form>
      <div
        aria-hidden
        data-loading={loading}
        className="preview-loading-progress pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 w-full origin-left rounded-r-full bg-primary"
        style={{ boxShadow: "0 0 6px 1px var(--color-ring)" }}
      />
    </div>
  );
}
