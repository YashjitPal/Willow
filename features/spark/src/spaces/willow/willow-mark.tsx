import logo from '@willow/assets/brand/logo.png';

/** Willow's sparkle, where Codex draws the ChatGPT mark: the agent's comments and its mention. */
export function WillowMark({ className }: { className?: string }) {
  return <img src={logo} alt="" aria-hidden draggable={false} className={className} />;
}
