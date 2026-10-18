import React, { useState } from 'react';

type InteractionHandlers<T extends HTMLElement> = Pick<
  React.DOMAttributes<T>,
  'onMouseEnter' | 'onMouseLeave' | 'onMouseDown' | 'onMouseUp' | 'onFocus' | 'onBlur'
>;

/**
 * The states of Gemini's React-island controls (its Luminous library): hovered from mouseenter to
 * mouseleave, pressed from mousedown to mouseup or mouseleave, focus-visible when focus arrives
 * as :focus-visible, until blur. These are mouse events, not :hover / :active, so a held touch
 * shows nothing until the mouse events that follow it, a press dragged off the control ends, and
 * Space doesn't press. Spread the result on the element; the stylesheet reads `data-hovered`,
 * `data-pressed` and `data-focus-visible`. The given handlers still run.
 */
export const useIslandInteraction = <T extends HTMLElement>(
  own: InteractionHandlers<T> = {},
  disabled = false,
) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  return {
    'data-hovered': hovered ? '' : undefined,
    'data-pressed': pressed ? '' : undefined,
    'data-focus-visible': focusVisible ? '' : undefined,
    onMouseEnter: (event: React.MouseEvent<T>) => {
      if (!disabled) setHovered(true);
      own.onMouseEnter?.(event);
    },
    onMouseLeave: (event: React.MouseEvent<T>) => {
      setHovered(false);
      setPressed(false);
      own.onMouseLeave?.(event);
    },
    onMouseDown: (event: React.MouseEvent<T>) => {
      if (!disabled) setPressed(true);
      own.onMouseDown?.(event);
    },
    onMouseUp: (event: React.MouseEvent<T>) => {
      setPressed(false);
      own.onMouseUp?.(event);
    },
    onFocus: (event: React.FocusEvent<T>) => {
      if (!disabled && event.target instanceof Element && event.target.matches(':focus-visible')) setFocusVisible(true);
      own.onFocus?.(event);
    },
    onBlur: (event: React.FocusEvent<T>) => {
      setFocusVisible(false);
      own.onBlur?.(event);
    },
  };
};

/** A button of Gemini's React islands: the "Search chats" button and the search panel's pills and Close. */
export const IslandButton: React.FC<React.ComponentProps<'button'>> = ({
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  onMouseUp,
  onFocus,
  onBlur,
  ...props
}) => {
  const interaction = useIslandInteraction<HTMLButtonElement>(
    { onMouseEnter, onMouseLeave, onMouseDown, onMouseUp, onFocus, onBlur },
    Boolean(props.disabled),
  );
  return <button type="button" {...props} {...interaction} />;
};
