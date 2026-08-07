import React from 'react';

/**
 * The notice Gemini shows in place of a finished reply when the user stops one.
 *
 * Every value here was measured off `response-info-line` in the live app rather
 * than matched by eye. The two rules that are easy to get wrong:
 *
 *   • The dividers are flex children with `flex: 1 1 0%` and `min-width: 24px`,
 *     not fixed-width rules. They share the leftover width equally, so the label
 *     stays centred at any container width and collapses gracefully when narrow.
 *   • The 16px gap is the flex `gap`, not padding on the label. Measured spacing
 *     came back 16.000px left and 15.990px right — a single gap, not two paddings.
 *
 * Gemini runs no entry animation on this element (`getAnimations()` returned an
 * empty list), so it appears in place with the surrounding layout shift only.
 */

/** Measured off the live element; exported so a test can pin them. */
export const RESPONSE_INFO_LINE = {
  height: 20,
  gap: 16,
  dividerMinWidth: 24,
  dividerHeight: 1,
  dividerColor: '#444746',
  textColor: '#c4c7c5',
  fontSize: 15,
  lineHeight: 20,
  fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 370',
  stoppedLabel: 'You stopped this response',
} as const;

const dividerStyle: React.CSSProperties = {
  flex: '1 1 0%',
  minWidth: RESPONSE_INFO_LINE.dividerMinWidth,
  height: RESPONSE_INFO_LINE.dividerHeight,
  backgroundColor: RESPONSE_INFO_LINE.dividerColor,
};

export const ResponseInfoLine: React.FC<{ label?: string }> = ({
  label = RESPONSE_INFO_LINE.stoppedLabel,
}) => (
  <div
    className="flex items-center"
    style={{ height: RESPONSE_INFO_LINE.height, gap: RESPONSE_INFO_LINE.gap }}
  >
    <div style={dividerStyle} />
    <div
      style={{
        color: RESPONSE_INFO_LINE.textColor,
        fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
        fontSize: RESPONSE_INFO_LINE.fontSize,
        lineHeight: `${RESPONSE_INFO_LINE.lineHeight}px`,
        fontWeight: 370,
        fontVariationSettings: RESPONSE_INFO_LINE.fontVariationSettings,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
    <div style={dividerStyle} />
  </div>
);
