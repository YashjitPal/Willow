import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { FormattedMessage, useIntl } from "react-intl";
import { ClockLight16Icon, Icon } from "../icons";
import { Button } from "./button";
import { ColorPalette } from "./color-palette";
import { composeRefs } from "./compose-refs";
import { emojiCategories, emojiSections, suggestedEmojiHeading } from "./emoji-search";
import { useRecentEmojiStore } from "./recent-emoji";
import { SymbolGrid, useSymbolSections } from "./symbol-grid";
import { searchProjectIcons, teamIconSections } from "./symbol-picker-icons";
import { SymbolPickerHeader, SymbolPickerLayout, type SymbolPickerSearchProps } from "./symbol-picker-layout";
import type { IconChoice, SymbolBrowserProps, SymbolChoice, SymbolSection } from "./symbol-picker-types";

/** `Be1Component`: jumps to the suggested emoji or an emoji category. */
function EmojiCategoryBar({ activeSectionId, suggestedLabel, onSelect }: { activeSectionId: string | null; suggestedLabel: string; onSelect?: (sectionId: string) => void }) {
  const intl = useIntl();
  const items = [
    { id: "suggested", icon: <ClockLight16Icon />, label: suggestedLabel },
    ...emojiCategories.map((category) => ({ id: category.id, icon: <Icon asset={category.icon} />, label: intl.formatMessage(category.label) })),
  ];
  return (
    <div
      className="flex items-center justify-between gap-0.5"
      role="group"
      aria-label={intl.formatMessage({
        id: "emoji.categories.label",
        defaultMessage: "Emoji categories",
        description: "Accessible label for emoji category navigation",
      })}
      inert={onSelect == null}
    >
      {items.map((item) => (
        <Button
          key={item.id}
          color={activeSectionId === item.id ? "secondary" : "ghost"}
          focusRing="inset"
          size="compact"
          uniform
          radius="full"
          aria-label={item.label}
          aria-current={activeSectionId === item.id ? "true" : undefined}
          onClick={() => onSelect?.(item.id)}
        >
          {item.icon}
        </Button>
      ))}
    </div>
  );
}

interface FocusedChoice {
  resultsKey: string;
  sectionId: string;
  index: number;
}

interface SymbolBrowserViewProps extends SymbolBrowserProps {
  sections: SymbolSection[];
  choices: SymbolChoice[];
  sectionIds: string[];
  selectedValues?: string[];
  suggestedLabel: string;
  onSelectSymbol: (choice: SymbolChoice, source?: HTMLElement) => void;
}

/** `JeComponent`: search, category bar or color palette, the grid, and type-to-search. */
function SymbolBrowserView({
  sections,
  choices,
  sectionIds,
  selectedValues,
  suggestedLabel,
  onSelectSymbol,
  autoFocus = true,
  disabled = false,
  inputRef,
  layout = "grid",
  showHeadings,
  showSearch = true,
  availableHeight,
  capabilities,
  footer,
  keyboardTarget,
  kind,
  onClear,
  onKindChange,
  onQueryChange,
  onReturnToSearch,
  query,
  inputValue,
}: SymbolBrowserViewProps) {
  const searchValue = inputValue ?? query;
  const searchRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<HTMLDivElement | null>(null);
  const gridId = useId();
  const resultsKey = `${kind}:${query}`;
  const highlightFirstResult = query.trim().length > 0;
  const [focus, setFocus] = useState<FocusedChoice | null>(null);
  const currentFocus = focus?.resultsKey === resultsKey ? focus : null;
  if (focus !== currentFocus) setFocus(null);
  const selectedSection = useMemo(
    () => sections.find((section) => section.choices.some((choice) => selectedValues?.includes(choice.value))) ?? sections[0],
    [sections, selectedValues],
  );
  const focusChoice = useCallback(
    (sectionId: string, index: number, key = resultsKey) =>
      setFocus((current) => (current?.resultsKey === key && current.sectionId === sectionId && current.index === index ? current : { resultsKey: key, sectionId, index })),
    [resultsKey],
  );
  const { activeSectionId, scrollToSection, setSectionElement } = useSymbolSections({ container: results, sectionIds });

  let categories: ReactNode;
  if (kind === "emoji" && capabilities.emoji?.allowedEmojis == null) {
    categories = (
      <EmojiCategoryBar
        activeSectionId={highlightFirstResult ? null : activeSectionId}
        suggestedLabel={suggestedLabel}
        onSelect={
          disabled
            ? undefined
            : (sectionId) => {
                flushSync(() => {
                  onQueryChange("");
                  focusChoice(sectionId, 0, "emoji:");
                });
                scrollToSection(sectionId);
              }
        }
      />
    );
  } else if (kind === "icon" && capabilities.icons?.onColorChange != null) {
    categories = <ColorPalette color={capabilities.icons.color} disabled={disabled} onColorChange={capabilities.icons.onColorChange} />;
  }

  const headerRef = useMemo(() => composeRefs(searchRef, inputRef), [inputRef]);
  const search: SymbolPickerSearchProps | undefined = showSearch
    ? {
        autoFocus,
        disabled,
        "aria-controls": gridId,
        value: searchValue,
        onChange: (event) => onQueryChange(event.currentTarget.value),
        onKeyDown: (event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            results?.querySelector("button")?.focus();
          } else if (event.key === "Enter") {
            event.preventDefault();
            const first = choices[0];
            if (first != null) onSelectSymbol(first);
          }
        },
      }
    : undefined;

  const onMouseDown =
    keyboardTarget == null
      ? undefined
      : (event: MouseEvent<HTMLDivElement>) => {
          if (event.target !== searchRef.current) event.preventDefault();
        };

  const typeToSearch = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      disabled ||
      !showSearch ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.key.length !== 1 ||
      event.key.trim() === "" ||
      !(event.target instanceof HTMLElement) ||
      !event.currentTarget.contains(event.target) ||
      event.target.closest("input, textarea, [contenteditable]") != null
    ) {
      return;
    }
    event.preventDefault();
    onQueryChange(searchValue + event.key);
    searchRef.current?.focus();
  };

  const focusedIndex = currentFocus?.index ?? Math.max(0, selectedSection?.choices.findIndex((choice) => selectedValues?.includes(choice.value)) ?? -1);

  return (
    <SymbolPickerLayout
      availableHeight={availableHeight}
      collapseSearchOnScroll={kind !== "teamIcon"}
      compact={layout === "compact"}
      hasSearch={showSearch}
      header={<SymbolPickerHeader ref={headerRef} capabilities={capabilities} disabled={disabled} kind={kind} onClear={onClear} onKindChange={onKindChange} search={search} />}
      onMouseDown={onMouseDown}
      onKeyDown={typeToSearch}
      categories={categories}
      resultsKey={resultsKey}
      resultsRef={setResults}
      footer={highlightFirstResult ? undefined : footer}
    >
      <div className="flex flex-col gap-1 select-none">
        {choices.length > 0 ? (
          <div className="sr-only" role="status" aria-atomic="true">
            {kind === "emoji" ? (
              <FormattedMessage
                id="emoji.search.count"
                defaultMessage="{count, plural, one {# emoji} other {# emojis}}"
                description="Screen reader announcement of the number of emoji in the browser results"
                values={{ count: choices.length }}
              />
            ) : (
              <FormattedMessage
                id="symbolPicker.icons.count"
                defaultMessage="{count, plural, one {# icon} other {# icons}}"
                description="Screen reader announcement of the number of icons in the picker results"
                values={{ count: choices.length }}
              />
            )}
          </div>
        ) : null}
        <SymbolGrid
          id={gridId}
          kind={kind}
          sections={sections}
          showHeadings={layout !== "compact" && (showHeadings ?? (kind !== "icon" || highlightFirstResult))}
          autoFocus={autoFocus && !showSearch && keyboardTarget == null}
          compact={layout === "compact"}
          disabled={disabled}
          keyboardTarget={keyboardTarget}
          selectedValues={selectedValues}
          setSectionElement={setSectionElement}
          focusedSectionId={currentFocus?.sectionId ?? selectedSection?.id ?? ""}
          focusedIndex={focusedIndex}
          onFocusChoice={focusChoice}
          highlightFirstResult={highlightFirstResult}
          onSelect={onSelectSymbol}
          onReturnToSearch={onReturnToSearch ?? (() => searchRef.current?.focus())}
        />
        {choices.length === 0 ? (
          <div className="py-4 text-center text-sm text-secondary" role="status">
            {kind === "emoji" ? (
              <FormattedMessage id="emoji.search.empty" defaultMessage="No matching emoji" description="Shown when no emoji name or shortcode matches the search" />
            ) : (
              <FormattedMessage id="symbolPicker.icons.empty" defaultMessage="No matching icons" description="Shown when no icon name or keyword matches the search" />
            )}
          </div>
        ) : null}
      </div>
    </SymbolPickerLayout>
  );
}

/** `t` of `browser-6002a74562fa.js` (`WdComponent`): the loaded picker; emoji picks are remembered as recent. */
export function SymbolBrowser(props: SymbolBrowserProps) {
  const { capabilities, disabled = false, kind, onSelect, query } = props;
  const intl = useIntl();
  const recentEmojis = useRecentEmojiStore((state) => state.recentEmojis);
  const rememberEmoji = useRecentEmojiStore((state) => state.rememberEmoji);
  const { sections, choices, selectedValues, sectionIds } = useMemo(() => {
    let sections: SymbolSection[];
    if (kind === "emoji" && capabilities.emoji != null) {
      sections = emojiSections({ capability: capabilities.emoji, query, recentEmojis, intl });
    } else if (kind === "teamIcon") {
      sections = teamIconSections({ choices: capabilities.teamIcons?.choices ?? [], query, intl });
    } else {
      const allowedIcons = capabilities.icons?.allowedIcons;
      sections = [
        {
          id: "icons",
          heading: intl.formatMessage({
            id: "symbolPicker.icons.heading",
            defaultMessage: "Icons",
            description: "Heading for available symbols from the icon catalog",
          }),
          choices: searchProjectIcons(query, intl)
            .filter((icon) => allowedIcons == null || allowedIcons.includes(icon.id))
            .map(
              (icon): IconChoice => ({
                kind: "icon",
                value: icon.id,
                metadata: { label: intl.formatMessage(icon.label), categoryId: icon.categoryId, keywords: icon.keywords, color: capabilities.icons?.color },
              }),
            ),
        },
      ];
    }
    let selectedValues: string[] | undefined;
    if (kind === "emoji") {
      selectedValues = capabilities.emoji?.selectedEmojis;
    } else if (kind === "teamIcon") {
      const selected = capabilities.teamIcons?.selectedIcon;
      selectedValues = selected == null ? undefined : [selected];
    } else if (capabilities.icons?.selectedIcon != null) {
      selectedValues = [capabilities.icons.selectedIcon];
    }
    return { sections, choices: sections.flatMap((section) => section.choices), selectedValues, sectionIds: sections.map((section) => section.id) };
  }, [capabilities.emoji, capabilities.icons, capabilities.teamIcons?.choices, capabilities.teamIcons?.selectedIcon, intl, kind, query, recentEmojis]);

  const onSelectSymbol = (choice: SymbolChoice, source?: HTMLElement) => {
    if (disabled) return;
    if (choice.kind === "emoji") rememberEmoji(choice.value);
    onSelect({ ...choice, source });
  };

  return (
    <SymbolBrowserView
      {...props}
      sections={sections}
      choices={choices}
      sectionIds={sectionIds}
      selectedValues={selectedValues}
      suggestedLabel={suggestedEmojiHeading(recentEmojis, intl)}
      onSelectSymbol={onSelectSymbol}
    />
  );
}
