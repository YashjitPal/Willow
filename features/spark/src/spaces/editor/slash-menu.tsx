import clsx from "clsx";
import { motion } from "framer-motion";
import { Fragment, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { FormattedMessage } from "react-intl";
import { useReducedMotion } from "../../codex/lib/theme-engine";
import { Menu, MenuRowContent, ScrollArea, SizedIcon, SuggestionMenuRow } from "../../codex/ui";
import { slashMenuMessages } from "./messages";
import { slashSectionMessages, type SlashCommand } from "./slash-commands";
import { slashCommandPrompt } from "./slash-options";

/** `jT` */
export const menuEase = [0.23, 1, 0.32, 1] as const;

function preventPointerDown(event: PointerEvent) {
  event.preventDefault();
}

/** `$I`: Home/End/Arrow navigation over menu options. */
export function nextOptionId(options: SlashCommand[], currentId: string | undefined, key: string) {
  if (key === "Home") return options[0]?.id;
  if (key === "End") return options.at(-1)?.id;
  if (options.length === 0 || (key !== "ArrowUp" && key !== "ArrowDown")) return undefined;
  const index = Math.max(0, options.findIndex((option) => option.id === currentId));
  return options[(index + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.id;
}

interface SlashMenuRowProps {
  id?: string;
  option: SlashCommand;
  query: string;
  isOnlyResult: boolean;
  selected: boolean;
  onHighlight: (id: string) => void;
  onSelect: (id: string) => void;
}

/** `GL1`: one command row; non-basic rows show their description beside the label. */
function SlashMenuRow({ id, option, query, isOnlyResult, selected, onHighlight, onSelect }: SlashMenuRowProps) {
  const labelId = useId();
  const descriptionId = useId();
  const described = option.section !== "basic";
  const prompt = slashCommandPrompt(option, query);
  let label = <FormattedMessage {...option.label} />;
  if (option.id === "generatePrompt") {
    label = isOnlyResult ? <>{query}</> : <FormattedMessage {...slashMenuMessages.generateQuery} values={{ query }} />;
  } else if (prompt && option.id === "canvas") {
    label = <FormattedMessage {...slashMenuMessages.canvasQuery} values={{ query: prompt }} />;
  } else if (prompt) {
    label = <FormattedMessage {...slashMenuMessages.visualizeQuery} values={{ query: prompt }} />;
  }
  return (
    <SuggestionMenuRow
      id={id}
      highlighted={selected}
      aria-current={selected ? "true" : undefined}
      aria-describedby={described ? descriptionId : undefined}
      aria-labelledby={labelId}
      role="menuitem"
      tabIndex={-1}
      onMouseMove={() => onHighlight(option.id)}
      onFocus={() => onHighlight(option.id)}
      onPointerDown={preventPointerDown}
      onClick={() => onSelect(option.id)}
    >
      <MenuRowContent
        leftIcon={<SizedIcon icon={option.icon} />}
        trailingContent={option.shortcut == null ? null : <span aria-hidden className="ms-2 shrink-0 text-xs text-codex-description">{option.shortcut}</span>}
      >
        <span className="flex w-full min-w-0 items-center gap-menu-row-content">
          <span id={labelId} className={clsx("truncate", described ? "max-w-[60%] flex-none" : "min-w-0 flex-1")}>
            {label}
          </span>
          {described && option.description != null ? (
            <span id={descriptionId} className="min-w-0 flex-1 truncate text-sm text-codex-description">
              <FormattedMessage {...option.description} />
            </span>
          ) : null}
        </span>
      </MenuRowContent>
    </SuggestionMenuRow>
  );
}

export interface SlashMenuListProps {
  id?: string;
  maxHeight?: string;
  options: SlashCommand[];
  query: string;
  currentOptionId?: string;
  onHighlight: (id: string) => void;
  onSelect: (id: string) => void;
}

/** `HL1`: section-labelled command list that animates its height as the query filters it. */
export function SlashMenuList({ id, maxHeight, options, query, currentOptionId, onHighlight, onSelect }: SlashMenuListProps) {
  const reducedMotion = useReducedMotion();
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const element = innerRef.current;
    if (element == null) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    setHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className="flex min-h-0 shrink-0 flex-col overflow-hidden"
      initial={false}
      animate={{ height: height ?? "auto" }}
      transition={{ duration: reducedMotion ? 0 : 0.15, ease: menuEase }}
    >
      <div
        ref={innerRef}
        className="flex shrink-0 flex-col"
        style={{ maxHeight: maxHeight == null ? undefined : `max(0px, calc(${maxHeight} - 2 * var(--app-menu-gutter, var(--spacing))))` }}
      >
        <ScrollArea className="relative flex min-h-0 flex-col" fade="none" peekMenuItems scrollClassName="min-h-0 overflow-y-auto">
          {options.map((option, index) => (
            <Fragment key={option.id}>
              {options.length > 1 && options[index - 1]?.section !== option.section ? (
                <Menu.SectionLabel>
                  <FormattedMessage {...slashSectionMessages[option.section]} />
                </Menu.SectionLabel>
              ) : null}
              <SlashMenuRow
                id={id == null ? undefined : `${id}-${option.id}`}
                option={option}
                query={query}
                isOnlyResult={options.length === 1}
                selected={currentOptionId === option.id}
                onHighlight={onHighlight}
                onSelect={onSelect}
              />
            </Fragment>
          ))}
        </ScrollArea>
      </div>
    </motion.div>
  );
}
