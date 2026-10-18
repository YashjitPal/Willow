import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

/**
 * Gemini's `gem-icon` sizes on this page, with the axes each computes: lm-icon-s 16px at 330,
 * lm-icon-m 20px at 320, lm-icon-l 24px at 300 and lm-icon-xl 28px at 260 (the mobile mic), all
 * at "ROND" 100. Its Google Symbols glyphs (filter_list and the Days checkboxes) carry the same axes.
 */
const AXES: Record<16 | 20 | 24 | 28, { weight: number; settings: string }> = {
  16: { weight: 330, settings: '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 16, "wght" 330' },
  20: { weight: 320, settings: '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 20, "wght" 320' },
  24: { weight: 300, settings: '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 24, "wght" 300' },
  28: { weight: 260, settings: '"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" 28, "wght" 260' },
};

export const SchedIcon: React.FC<{
  name: string;
  size?: 16 | 20 | 24 | 28;
  family?: 'luminous' | 'google-symbols';
  className?: string;
}> = ({ name, size = 20, family = 'luminous', className }) => (
  <MaterialSymbol
    name={name}
    family={family}
    size={size}
    weight={AXES[size].weight}
    variationSettings={AXES[size].settings}
    className={className}
  />
);
