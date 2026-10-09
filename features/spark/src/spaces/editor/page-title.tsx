import clsx from "clsx";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { useIntl } from "react-intl";
import { CubeLight32Icon, EmojiFaceBadgePlusLight16Icon } from "../../codex/icons";
import { Button, Popover, PopoverContent, PopoverTrigger, SymbolPicker, SymbolTile, Tooltip, type ButtonColor, type SymbolValue } from "../../codex/ui";
import { resolveProjectColor } from "../../codex/ui/project-appearance";
import { useIsDarkTheme } from "../../codex/ui/use-is-dark-theme";
import { usePagesViewSettings } from "../../codex/lib/pages-view-settings";
import { DocumentTitle } from "../willow/shell/document-title";
import { appearanceSymbol, splitLeadingEmoji, useSpaceAppearance } from "../components/space-icon";
import { useSpacesStore } from "../state";
import { pageCss } from "./css";
import { pageMessages } from "./messages";
import { keepsLiteralPunctuation, smartPunctuationFor, smartPunctuationTriggers } from "./smart-punctuation";

type PageTitleInputProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> };

/** `Ie` (title-menu chunk): the symbol "Your guide to pages" shows until it gets one of its own. */
const welcomePageSymbol: SymbolValue = { kind: "icon", value: "graduation-cap", color: "blue" };

interface Conversion {
  value: string;
  caret: number;
  shortcut: string;
}

/** `VeComponent` (title-menu chunk): the auto-sizing title field above a Page, with smart punctuation. */
function PageTitleInput({ onPaste, onKeyDown, onSelect, onInput, onBlur, ...props }: PageTitleInputProps) {
  const intl = useIntl();
  const { smartPunctuationEnabled } = usePagesViewSettings();
  const conversionRef = useRef<Conversion | undefined>(undefined);
  const pastingRef = useRef(false);

  return (
    <textarea
      {...props}
      className={`${pageCss.PageTitle} relative block field-sizing-content w-full min-w-0 resize-none overflow-hidden border-none bg-transparent font-semibold break-words text-default outline-none`}
      aria-label={intl.formatMessage(pageMessages.titleLabel)}
      aria-multiline={false}
      placeholder={intl.formatMessage(pageMessages.untitled)}
      rows={1}
      onPaste={(event) => {
        conversionRef.current = undefined;
        pastingRef.current = true;
        try {
          onPaste?.(event);
        } finally {
          pastingRef.current = false;
        }
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        const input = event.currentTarget;
        const conversion = conversionRef.current;
        if (
          event.key === "Backspace" &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !input.disabled &&
          !input.readOnly &&
          conversion != null &&
          input.value === conversion.value &&
          input.selectionStart === conversion.caret &&
          input.selectionEnd === conversion.caret &&
          input.ownerDocument.execCommand("undo")
        ) {
          event.preventDefault();
        }
      }}
      onSelect={(event) => {
        const input = event.currentTarget;
        const conversion = conversionRef.current;
        if (conversion != null && (input.value !== conversion.value || input.selectionStart !== conversion.caret || input.selectionEnd !== conversion.caret)) {
          conversionRef.current = undefined;
        }
        onSelect?.(event);
      }}
      onInput={(event) => {
        onInput?.(event);
        const input = event.currentTarget;
        const nativeEvent = event.nativeEvent;
        const conversion = conversionRef.current;
        if (nativeEvent instanceof InputEvent && conversion != null) {
          if (nativeEvent.inputType === "historyUndo" && input.value === conversion.value.slice(0, conversion.caret - 1) + conversion.shortcut + conversion.value.slice(conversion.caret)) {
            input.setSelectionRange(input.selectionEnd, input.selectionEnd);
            return;
          }
          if (nativeEvent.inputType === "historyRedo" && input.value === conversion.value) return;
        }
        conversionRef.current = undefined;
        if (
          pastingRef.current ||
          !smartPunctuationEnabled ||
          input.disabled ||
          input.readOnly ||
          !(nativeEvent instanceof InputEvent) ||
          nativeEvent.isComposing ||
          nativeEvent.inputType !== "insertText" ||
          nativeEvent.data?.length !== 1 ||
          !smartPunctuationTriggers.includes(nativeEvent.data) ||
          input.selectionStart !== input.selectionEnd
        ) {
          return;
        }
        const typed = nativeEvent.data;
        const value = input.value;
        const caret = input.selectionStart;
        const before = value.slice(0, caret - typed.length);
        const previousShortcut = conversion?.caret === caret - 1 && conversion.value === before + value.slice(caret) ? conversion.shortcut : undefined;
        const replacement = smartPunctuationFor(before, typed, previousShortcut);
        if (replacement == null || keepsLiteralPunctuation(before, typed, replacement.from)) return;
        queueMicrotask(() => {
          const unchanged = input.ownerDocument.activeElement === input && !input.disabled && !input.readOnly && input.value === value && input.selectionStart === caret && input.selectionEnd === caret;
          if (!unchanged) return;
          input.setSelectionRange(replacement.from, caret);
          if (replacement.continuation) {
            const extended = input.ownerDocument.execCommand("insertText", false, replacement.shortcut);
            if (!extended || input.value !== value.slice(0, replacement.from) + replacement.shortcut + value.slice(caret)) return;
            input.setSelectionRange(replacement.from, replacement.from + replacement.shortcut.length);
          }
          if (input.ownerDocument.execCommand("insertText", false, replacement.glyph)) {
            conversionRef.current = { value: input.value, caret: input.selectionStart, shortcut: replacement.shortcut };
          }
        });
      }}
      onBlur={(event) => {
        conversionRef.current = undefined;
        onBlur?.(event);
      }}
    />
  );
}

function stopPropagation(event: MouseEvent) {
  event.stopPropagation();
}

interface PageSymbolButtonProps {
  symbol: SymbolValue | null;
  disabled: boolean;
  /** The title belongs to a Space's root Page. */
  space: boolean;
  spaceTheme?: string | null;
  onChange: (value: SymbolValue) => void;
  onClose?: () => void;
}

/** `Xe` (title-menu chunk): the symbol above a Page title, or a hover button beside it, opening the shared `SymbolPicker`. */
function PageSymbolButton({ symbol, disabled, space, spaceTheme, onChange, onClose }: PageSymbolButtonProps) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const dark = useIsDarkTheme();
  const hasSymbol = symbol != null && symbol.kind !== "none";
  const tint = resolveProjectColor(symbol?.kind === "icon" ? symbol.color : spaceTheme, dark ? "dark" : "light");
  if (disabled && open) setOpen(false);
  const label = intl.formatMessage(pageMessages.changeSymbol);

  let content: ReactNode = <EmojiFaceBadgePlusLight16Icon />;
  if (symbol?.kind === "emoji") {
    content = (
      <span className={clsx("flex size-full items-center", space && "justify-center")}>
        <span className="select-none text-5xl leading-none" role="img" aria-label={symbol.value}>
          {symbol.value}
        </span>
      </span>
    );
  } else if (hasSymbol) {
    content = (
      <span className={clsx("flex size-full items-center", space && "justify-center")}>
        <SymbolTile
          className="size-8"
          color={symbol?.kind === "icon" ? symbol.color : spaceTheme}
          defaultIcon={space ? <CubeLight32Icon /> : <EmojiFaceBadgePlusLight16Icon />}
          icon={symbol?.kind === "icon" ? symbol.value : null}
        />
      </span>
    );
  }
  let color: ButtonColor = hasSymbol ? "ghostMuted" : "ghost";
  if (space && hasSymbol) color = tint == null ? "secondary" : "tinted";
  const button = (
    <Button
      className={
        hasSymbol
          ? "self-start"
          : "absolute end-0 top-1/2 -translate-y-1/2 opacity-0 group-focus-within/page-title:opacity-100 group-hover/page-title:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
      }
      aria-label={label}
      color={color}
      disabled={disabled}
      onClick={stopPropagation}
      radius={hasSymbol ? undefined : "small"}
      size={hasSymbol ? "iconLarge" : "compact"}
      uniform={!hasSymbol}
      style={space && hasSymbol ? { color: tint ?? undefined } : undefined}
      type="button"
    >
      {content}
    </Button>
  );

  if (disabled) {
    if (!hasSymbol) return null;
    return space ? button : <span className="flex size-16 items-center justify-center border border-transparent">{content}</span>;
  }
  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <div className={hasSymbol ? "self-start" : clsx(pageCss.PageTitle, "absolute top-0 end-full pe-2 font-semibold")}>
        <span className={hasSymbol ? "flex" : "relative inline-block h-[1cap] align-baseline"}>
          <Tooltip tooltipContent={label} disableHoverOpen={open}>
            <PopoverTrigger asChild>{button}</PopoverTrigger>
          </Tooltip>
        </span>
      </div>
      <PopoverContent
        className="z-50 outline-hidden"
        aria-label={label}
        align="center"
        sideOffset={space && hasSymbol ? 6 : undefined}
        onCloseAutoFocus={
          onClose == null
            ? undefined
            : (event) => {
                event.preventDefault();
                onClose();
              }
        }
        onClick={stopPropagation}
        unstyled
      >
        <SymbolPicker
          disabled={disabled}
          value={symbol}
          defaultColor={spaceTheme}
          defaultKind={symbol?.kind === "emoji" ? "emoji" : "icon"}
          onChange={onChange}
          onSelect={() => setOpen(false)}
          onClear={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface PageTitleProps {
  ref?: Ref<HTMLTextAreaElement>;
  pageId: string;
  canWrite: boolean;
  documentReady: boolean;
  /** Owns the browser tab title. */
  isMainPage: boolean;
  /** Focuses the title once it can be edited, then reports it through `onTitleFocused`. */
  focusTitle?: boolean;
  onTitleFocused?: () => void;
  /** Moves focus into the document; returns whether it could. */
  onFocusBody: () => boolean;
  onEnter: () => void;
}

/** `ML`: the Page title block above the document. */
export function PageTitle({ ref, pageId, canWrite, documentReady, isMainPage, focusTitle = false, onTitleFocused, onFocusBody, onEnter }: PageTitleProps) {
  const intl = useIntl();
  const title = useSpacesStore((state) => state.pages[pageId]?.title ?? "");
  const symbol = useSpacesStore((state) => state.pages[pageId]?.symbol ?? null);
  const rootOfSpace = useSpacesStore((state) => state.spaces.find((space) => space.root_page_id === pageId));
  const welcomePage = useSpacesStore((state) => state.welcomePageId === pageId);
  const spaceAppearance = useSpaceAppearance(rootOfSpace?.id);
  const renamePage = useSpacesStore((state) => state.renamePage);
  const setPageSymbol = useSpacesStore((state) => state.setPageSymbol);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const editable = canWrite && documentReady;
  const space = rootOfSpace != null;
  const flatTitle = title.replace(/[\r\n]+/g, " ");
  const splitsEmoji = !space && symbol == null;
  const { emoji: legacyEmoji, title: shownTitle } = splitsEmoji ? splitLeadingEmoji(flatTitle) : { emoji: null, title: flatTitle };

  /** `Y`: puts the hidden leading emoji back in front of an edited title. */
  const withLegacyEmoji = (value: string) => {
    const emoji = splitsEmoji ? splitLeadingEmoji(title).emoji : null;
    return emoji == null ? value : value.length === 0 ? emoji : `${emoji} ${value}`;
  };

  let shownSymbol: SymbolValue | null = symbol;
  if (shownSymbol == null) {
    shownSymbol = space ? appearanceSymbol(spaceAppearance) : legacyEmoji != null ? { kind: "emoji", value: legacyEmoji } : welcomePage ? welcomePageSymbol : null;
  }

  const changeSymbol = (value: SymbolValue) => {
    if (!editable) return;
    const nextTitle = splitsEmoji ? splitLeadingEmoji(title).title : title;
    setPageSymbol(pageId, value.kind === "none" ? null : value);
    if (nextTitle !== title) renamePage(pageId, nextTitle);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (
      (event.key === "ArrowDown" || event.key === "Tab" || (event.key === "ArrowRight" && atEnd)) &&
      !event.defaultPrevented &&
      !event.nativeEvent.isComposing &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      onFocusBody()
    ) {
      event.preventDefault();
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onEnter();
    }
  };

  return (
    <div className="group/page-title relative flex flex-col gap-6">
      <PageSymbolButton
        disabled={!editable}
        symbol={shownSymbol}
        space={space}
        spaceTheme={symbol == null ? spaceAppearance?.theme : undefined}
        onChange={changeSymbol}
        onClose={() => inputRef.current?.focus()}
      />
      {isMainPage ? (
        <DocumentTitle
          title={flatTitle.trim() ? intl.formatMessage(pageMessages.documentTitle, { title: flatTitle.trim() }) : intl.formatMessage(pageMessages.emptyDocumentTitle)}
        />
      ) : null}
      <PageTitleInput
        ref={(element) => {
          inputRef.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref != null) ref.current = element;
          if (element != null && editable && focusTitle) {
            element.focus();
            if (element.ownerDocument.activeElement === element) onTitleFocused?.();
          }
        }}
        disabled={!documentReady}
        readOnly={!canWrite}
        value={shownTitle}
        onBlur={(event) => {
          const value = event.currentTarget.value;
          if (canWrite && documentReady && value.trim() !== value) renamePage(pageId, withLegacyEmoji(value.trim()));
        }}
        onChange={(event) => {
          const input = event.currentTarget;
          const flat = input.value.replace(/[\r\n]+/g, " ");
          const stored = withLegacyEmoji(flat);
          const shown = splitsEmoji ? splitLeadingEmoji(stored).title : stored;
          if (shown !== input.value) {
            const removed = flat.length - shown.length;
            const start = input.value.slice(0, input.selectionStart).replace(/[\r\n]+/g, " ").length;
            const end = input.value.slice(0, input.selectionEnd).replace(/[\r\n]+/g, " ").length;
            input.value = shown;
            input.setSelectionRange(Math.max(0, start - removed), Math.max(0, end - removed));
          }
          renamePage(pageId, stored);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
