import { FormattedMessage, useIntl } from "react-intl";
import { Menu, Tooltip } from "../../codex/ui";
import { findSpacesUser, isDotActor, useSpacesStore, type PageActor } from "../state";
import { DotAvatar } from "../willow/dot/character";
import { dotName, useResolvedDot } from "../willow/dot/dot-identity";
import { WillowMark } from "../willow/willow-mark";
import { attributionMessages } from "./messages";
import type { PageBlock, PageBlockAttribution } from "./state/page-document";

/** Consecutive blocks last edited by the same actor share one label (`r_21`). */
export interface AttributionRange {
  key: string;
  blockIds: string[];
  attribution: PageBlockAttribution;
}

function actorKey(actor: PageActor) {
  return actor.actor_type === "agent" ? `agent:${actor.agent_kind ?? ""}:${actor.dot_id ?? actor.account_user_id}` : `${actor.actor_type}:${actor.account_user_id ?? ""}`;
}

export function attributionRanges(blocks: PageBlock[], attribution: Record<string, PageBlockAttribution>) {
  const ranges: AttributionRange[] = [];
  let previousKey: string | null = null;
  for (const block of blocks) {
    const entry = attribution[block.id];
    if (entry == null) {
      previousKey = null;
      continue;
    }
    const key = actorKey(entry.actor);
    const last = ranges.at(-1);
    if (last != null && previousKey === key) {
      last.blockIds.push(block.id);
      if (entry.changedAt > last.attribution.changedAt) last.attribution = entry;
    } else ranges.push({ key: block.id, blockIds: [block.id], attribution: entry });
    previousKey = key;
  }
  return ranges;
}

export interface AttributionPlacement {
  range: AttributionRange;
  top: number;
  height: number;
  lineHeight: number;
}

type ActorDisplay = { kind: "dot"; name: string; dotId: string } | { kind: "willow"; name: string } | { kind: "person"; name: string } | { kind: "other"; name: string };

/** Who an actor is on a Willow Page: one of your bots, Willow itself, you, or the system. */
function useActorDisplay(actor: PageActor): ActorDisplay {
  const intl = useIntl();
  const users = useSpacesStore((state) => state.users);
  const dot = useResolvedDot(actor.actor_type === "agent" && isDotActor(actor) ? actor.dot_id : null);
  if (dot != null) return { kind: "dot", name: dotName(dot), dotId: dot.conversationId };
  if (actor.actor_type === "agent") return { kind: "willow", name: intl.formatMessage(attributionMessages.agentName) };
  const name = findSpacesUser(users, actor.account_user_id)?.display_name;
  return name != null ? { kind: "person", name } : { kind: "other", name: intl.formatMessage(attributionMessages.actor, { type: actor.actor_type }) };
}

function ActorMark({ display }: { display: ActorDisplay }) {
  if (display.kind === "dot") {
    return (
      <span className="ws-attribution-avatar">
        <DotAvatar className="size-full" identity={display.dotId} animated={false} />
      </span>
    );
  }
  return display.kind === "willow" ? <WillowMark className="icon-xs block shrink-0" /> : null;
}

/** `Y`: one `[data-page-attribution-position]` label in the attribution rail, positioned against its blocks. */
function AttributionLabel({ placement }: { placement: AttributionPlacement }) {
  const intl = useIntl();
  const { actor, changedAt } = placement.range.attribution;
  const display = useActorDisplay(actor);
  const date = intl.formatDate(changedAt);
  return (
    <span
      className="pointer-events-none absolute z-10 border-e border-border-subtle pe-3 text-end text-xs text-secondary select-none"
      contentEditable={false}
      data-page-attribution-position={placement.range.blockIds[0]}
      data-page-attribution-end-position={placement.range.blockIds.at(-1)}
      style={{ top: placement.top, height: Math.max(placement.lineHeight, placement.height) }}
    >
      <Tooltip
        className="pointer-events-auto sticky top-6 flex w-full items-center justify-end gap-1 text-end focus-visible:outline-2 focus-visible:outline-ring"
        triggerAsChild={false}
        aria-label={display.name}
        data-page-attribution-label=""
        style={{ height: placement.lineHeight }}
        tooltipContent={<FormattedMessage {...attributionMessages.tooltip} values={{ date, name: display.name }} />}
      >
        <ActorMark display={display} />
        <span className="truncate">{display.name}</span>
      </Tooltip>
    </span>
  );
}

/** `HY1`: labels for every attributed range of blocks, shown while "Show attribution" is on. */
export function PageAttribution({ placements }: { placements: AttributionPlacement[] }) {
  return (
    <>
      {placements.map((placement) => (
        <AttributionLabel key={placement.range.key} placement={placement} />
      ))}
    </>
  );
}

/** Block menu footer naming the block's last editor. */
export function AttributionFooter({ attribution }: { attribution: PageBlockAttribution }) {
  const { actor } = attribution;
  const display = useActorDisplay(actor);
  return (
    <>
      <Menu.Separator />
      <Menu.Message compact>
        {display.kind === "other" ? (
          <FormattedMessage {...attributionMessages.footerActor} values={{ type: actor.actor_type }} />
        ) : (
          <FormattedMessage {...attributionMessages.footerPerson} values={{ name: display.name }} />
        )}
      </Menu.Message>
    </>
  );
}
