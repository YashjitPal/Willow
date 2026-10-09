import type { CSSProperties } from "react";

/**
 * Shadow-root overrides that draw a Pierre file tree as the Codex app's file rows (FilesPanel):
 * 13px on 6px corners, a soft fill under the pointer and on the chosen row, the panel's hairline
 * for focus where the tree would use its accent, and Codex's git colours.
 */
export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-fg-muted-override: color-mix(in srgb, var(--codex-ink, currentColor) 50%, transparent);
    --trees-selected-fg-override: var(--codex-ink, currentColor);
    --trees-selected-bg-override: var(--codex-secondary-soft, color-mix(in srgb, currentColor 12%, transparent));
    --trees-bg-muted-override: var(--codex-tertiary-hover, color-mix(in srgb, currentColor 7%, transparent));
    --trees-border-color-override: var(--codex-border, color-mix(in srgb, currentColor 14%, transparent));
    --trees-focus-ring-color-override: var(--codex-border-heavy, currentColor);
    --trees-selected-focused-border-color-override: transparent;
    --trees-border-radius-override: 6px;
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 13px;
    --trees-status-added-override: var(--codex-git-added);
    --trees-status-untracked-override: var(--codex-git-added);
    --trees-status-deleted-override: var(--codex-git-deleted);
  }
`;

/** Codex's tree row: 28px (FilesPanel's h-7). */
export const PIERRE_TREE_ITEM_HEIGHT = 28;

/** Host styles that keep a Pierre tree on the active color scheme and Codex's secondary ink. */
export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--codex-ink-secondary, var(--contrast-foreground))",
  };
}
