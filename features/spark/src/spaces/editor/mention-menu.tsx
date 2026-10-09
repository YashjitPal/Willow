import type { PointerEvent, ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { MenuRowContent, SuggestionMenuRow, SuggestionSurface } from "../../codex/ui";
import { DotAvatar } from "../willow/dot/character";
import type { Dot } from "../willow/dot/state/dot-store";
import { WillowMark } from "../willow/willow-mark";
import { mentionMessages } from "./messages";

export type MentionOption =
  | { kind: "chatgpt"; id: "chatgpt" }
  | { kind: "dot"; id: string; conversationId: string; name: string | null }
  | { kind: "person"; id: string; accountUserId: string; name: string };

function matches(terms: (string | null | undefined)[], query: string) {
  const needle = query.trim().toLowerCase();
  return needle === "" || terms.some((term) => term != null && term.toLowerCase().includes(needle));
}

/** Page mention menu entries: the Willow task row, then each of your bots (`orbitMention`). Pages have no other people. */
export function mentionOptions({ query, dots, canStartTask }: { query: string; dots: readonly Dot[]; canStartTask: boolean }) {
  const options: MentionOption[] = [];
  if (canStartTask && matches(["Willow", "task"], query)) options.push({ kind: "chatgpt", id: "chatgpt" });
  for (const dot of dots) {
    if (matches(["bot", dot.name], query)) options.push({ kind: "dot", id: `dot:${dot.conversationId}`, conversationId: dot.conversationId, name: dot.name });
  }
  return options;
}

function preventPointerDown(event: PointerEvent) {
  event.preventDefault();
}

function OptionRow({ option }: { option: MentionOption }) {
  let icon: ReactNode;
  let label: ReactNode;
  let detail: ReactNode = null;
  if (option.kind === "chatgpt") {
    icon = <WillowMark className="icon-xs shrink-0" />;
    label = <FormattedMessage {...mentionMessages.taskMentionLabel} />;
    detail = <FormattedMessage {...mentionMessages.taskMentionDetail} />;
  } else if (option.kind === "dot") {
    icon = <DotAvatar className="size-4" identity={option.conversationId} animated={false} />;
    label = option.name ?? "bot";
    detail = (
      <FormattedMessage
        {...mentionMessages.orbitMentionDetailRich}
        values={{ isDefault: String(option.name == null), name: option.name, b: (chunks: ReactNode[]) => <b key="name">{chunks}</b> }}
      />
    );
  } else {
    label = option.name;
  }
  return (
    <MenuRowContent leftIcon={icon}>
      <span className="flex w-full min-w-0 items-center gap-menu-row-content">
        <span className={detail == null ? "min-w-0 flex-1 truncate" : "max-w-[60%] flex-none truncate"}>{label}</span>
        {detail == null ? null : <span className="min-w-0 flex-1 truncate text-sm text-codex-description">{detail}</span>}
      </span>
    </MenuRowContent>
  );
}

interface MentionMenuProps {
  /** Rows get `${id}-option-${option.id}` ids for the input's `aria-activedescendant`. */
  id?: string;
  options: MentionOption[];
  highlightedId?: string;
  onHighlight: (id: string) => void;
  onSelect: (option: MentionOption) => void;
}

/** Floating `@` menu shown at the caret while typing a mention in a Page or comment. */
export function MentionMenu({ id, options, highlightedId, onHighlight, onSelect }: MentionMenuProps) {
  if (options.length === 0) return null;
  return (
    <SuggestionSurface id={id} variant="floating" width="panelWide" role="menu">
      {options.map((option) => (
        <SuggestionMenuRow
          key={option.id}
          id={id == null ? undefined : `${id}-option-${option.id}`}
          highlighted={option.id === highlightedId}
          role="menuitem"
          tabIndex={-1}
          onMouseMove={() => onHighlight(option.id)}
          onPointerDown={preventPointerDown}
          onClick={() => onSelect(option)}
        >
          <OptionRow option={option} />
        </SuggestionMenuRow>
      ))}
    </SuggestionSurface>
  );
}
