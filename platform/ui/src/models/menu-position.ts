export type MenuSide = 'top' | 'bottom';

export const chooseMenuSide = ({
  preferredSide,
  menuHeight,
  spacing,
  spaceAbove,
  spaceBelow,
}: {
  preferredSide: MenuSide;
  menuHeight: number;
  spacing: number;
  spaceAbove: number;
  spaceBelow: number;
}): MenuSide => {
  const requiredSpace = menuHeight + spacing;
  const preferredSpace = preferredSide === 'top' ? spaceAbove : spaceBelow;
  const oppositeSpace = preferredSide === 'top' ? spaceBelow : spaceAbove;

  if (preferredSpace >= requiredSpace || preferredSpace >= oppositeSpace) {
    return preferredSide;
  }

  return preferredSide === 'top' ? 'bottom' : 'top';
};

export const getViewportConstrainedOffset = ({
  bottom,
  viewportHeight,
  margin = 16,
}: {
  bottom: number;
  viewportHeight: number;
  margin?: number;
}): number => {
  return Math.min(0, viewportHeight - margin - bottom);
};
