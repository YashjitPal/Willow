/**
 * A subagent's avatar as the Codex app draws it (its webview's AgentAvatar): one of its 28 gradient
 * designs, chosen by hashing the agent's id so the agent wears it wherever it appears, in the
 * variant drawn for the theme.
 */
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

import { AGENT_AVATARS } from "./agentAvatars";

const HASH_MODULUS = 2147483647;

export function agentAvatarIndex(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % HASH_MODULUS;
  }
  return hash % AGENT_AVATARS.length;
}

export function AgentAvatar({ seed, className }: { seed: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const avatar = AGENT_AVATARS[agentAvatarIndex(seed)] ?? AGENT_AVATARS[0];
  return (
    <img
      src={resolvedTheme === "dark" ? avatar?.dark : avatar?.light}
      alt=""
      aria-hidden
      draggable={false}
      data-agent-avatar=""
      className={cn("size-3.5 shrink-0", className)}
    />
  );
}
