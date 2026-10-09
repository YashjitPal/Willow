import type { CSSProperties } from 'react';
import { decodeCharacterState } from '../character/orbit/appearance-codec';
import { getDotState } from '../character/orbit/conversation-character';
import { browserAgentCursorAsset } from '../creation/assets/browser-agent-cursor';
import { defaultOnboardingColor, orbitCatalogTintColors } from '../state/creation-store';
import { useDotStore } from '../state/dot-store';

const GLOW = '--browser-agent-cursor-glow-color';

/** The bot's character colour, the one Codex's cursor glows in: its catalog tint, grey before one is chosen. */
function useDotTint(dotId: string): string {
  return useDotStore((s) => {
    const dot = s.dots.find((candidate) => candidate.conversationId === dotId);
    const state = dot ? getDotState(dot) : null;
    if (!state) return defaultOnboardingColor;
    try {
      const { color } = decodeCharacterState(state);
      return color.startsWith('#') ? color : (orbitCatalogTintColors as Record<string, string>)[color] ?? defaultOnboardingColor;
    } catch {
      return defaultOnboardingColor;
    }
  });
}

/**
 * Codex's agent cursor (`PiComponent` in its computer step): the arrow upright, in Codex's double glow of the bot's
 * colour, with its tip on the point the bot acts on. It stays Codex's 24px whatever the screen is scaled to.
 */
export function DotAgentCursor({ dotId, x, y, scale }: { dotId: string; x: number; y: number; scale: number }) {
  const tint = useDotTint(dotId);
  return (
    <span className="dot-computer__agent-cursor" style={{ transform: `translate(${x}px, ${y}px) scale(${1 / scale})` }} aria-hidden="true">
      <img
        src={browserAgentCursorAsset}
        alt=""
        width={23}
        height={24}
        draggable={false}
        style={
          {
            [GLOW]: tint,
            filter: `drop-shadow(0 0 6px color-mix(in srgb, var(${GLOW}) 90%, transparent)) drop-shadow(0 0 15px color-mix(in srgb, var(${GLOW}) 48%, transparent))`,
          } as CSSProperties
        }
      />
    </span>
  );
}
