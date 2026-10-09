import type { ComponentProps } from 'react';
import { DotAvatar as CodexDotAvatar } from '../../../dots/character/avatar/dot-avatar';
import '../../../dots/codex-dots.css';
import '../../../dots/dots-theme.css';

/** A bot's Codex character inside Spaces, under the bots' own `willow-dots` styles. */
export function DotAvatar(props: ComponentProps<typeof CodexDotAvatar>) {
  return (
    <span className="willow-dots contents">
      <CodexDotAvatar {...props} />
    </span>
  );
}
