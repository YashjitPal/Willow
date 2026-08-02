// Where to open a dropdown panel: below its button, or above it when the
// viewport has no room below.
//
// Both helpers were defined inside MediaView's component body but never read
// anything from it — they take their inputs as arguments and measure the
// element and the window directly.

/** Estimate dropdown panel height: each item ~42px + container padding 8px. */
export const estimateDropdownHeight = (itemCount: number) => itemCount * 42 + 8;

/** 'down' unless the panel (plus a 12px margin) would overflow the viewport. */
export const computeDropDirection = (
  buttonEl: HTMLElement | null,
  panelHeight: number,
): 'down' | 'up' => {
  if (!buttonEl) return 'down';
  const rect = buttonEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const margin = 12;
  return spaceBelow >= panelHeight + margin ? 'down' : 'up';
};
