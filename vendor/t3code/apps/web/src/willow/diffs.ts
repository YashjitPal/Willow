/**
 * The diff viewer's own chrome as the Codex app draws a review (the Codex app UI clone's
 * ChangesPanel `FileDiff` and `DiffView`). These rules run inside each file's shadow root.
 */

/** A file's header row, Codex's `h-9`. The viewer's virtual list sizes every file from it. */
export const WILLOW_DIFF_HEADER_HEIGHT = 36;

/**
 * Every diff viewer: the header's geometry and type, and Codex's row tints — a whole changed
 * row, gutters included, takes its git colour at 23% (15% on light), a little more under the
 * pointer, and the +/- signs take the colour itself.
 */
export const WILLOW_DIFF_UNSAFE_CSS = `
[data-diffs-header] {
  min-height: ${WILLOW_DIFF_HEADER_HEIGHT}px !important;
  padding-block: 0 !important;
  padding-inline: 8px 6px !important;
  gap: 6px !important;
  font-size: 13px !important;
}

[data-diffs-header] [data-header-content] {
  gap: 6px !important;
}

[data-diff],
[data-file] {
  --diffs-addition-color-override: var(--codex-git-added);
  --diffs-deletion-color-override: var(--codex-git-deleted);
}

[data-column-number]:not([data-selected-line]) {
  color: color-mix(in srgb, var(--codex-ink) 30%, transparent) !important;
}

:is([data-line], [data-no-newline], [data-column-number], [data-gutter-buffer]):is(
    [data-line-type="change-addition"],
    [data-line-type="change-deletion"]
  ) {
  --diffs-bg-addition-override: var(--codex-git-added);
  --diffs-bg-addition-number-override: var(--codex-git-added);
  --diffs-bg-deletion-override: var(--codex-git-deleted);
  --diffs-bg-deletion-number-override: var(--codex-git-deleted);
  --mix-light: 85%;
  --mix-dark: 77%;
}

:is([data-line], [data-no-newline], [data-column-number], [data-gutter-buffer]):is(
    [data-line-type="change-addition"],
    [data-line-type="change-deletion"]
  )[data-hovered] {
  --mix-light: 80%;
  --mix-dark: 70%;
}
`;

/**
 * The review panel's files. Willow draws each header's content in the viewer's prefix slot, so
 * the viewer's icon, title and counts step aside; the title stays in the tree because the panel
 * reads a header's path from it. An opened file's lines sit 8px in under a hairline frame with
 * 8px corners, the viewer's 8px under the last line staying below the frame (it is in the
 * virtual list's geometry), and a hairline closes every file.
 */
export const WILLOW_REVIEW_FILES_UNSAFE_CSS = `
[data-diffs-header] :is([data-change-icon], [data-rename-icon], [data-title], [data-prev-name]),
[data-diffs-header] :is([data-additions-count], [data-deletions-count]) {
  display: none !important;
}

[data-diffs-header] [data-header-content] {
  flex: 1 1 auto;
  min-width: 0;
}

[data-diffs-header]:hover {
  box-shadow: none !important;
}

:host {
  position: relative;
}

:host::after {
  position: absolute;
  inset: auto 0 0;
  z-index: 5;
  height: 1px;
  content: "";
  background: var(--codex-border);
  pointer-events: none;
}

[data-diffs-header] ~ :is([data-diff], [data-file]) {
  position: relative;
  padding-inline: 8px !important;
}

[data-diffs-header] ~ :is([data-diff], [data-file]) [data-code] {
  clip-path: inset(0 round 8px 8px 0 0);
}

[data-diffs-header] ~ :is([data-diff], [data-file])::after {
  position: absolute;
  inset: 0 8px var(--diffs-gap-block, var(--diffs-gap-fallback));
  z-index: 3;
  content: "";
  border: 1px solid var(--codex-border);
  border-radius: 8px;
  pointer-events: none;
}
`;
