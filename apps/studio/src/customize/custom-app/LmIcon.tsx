import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

/** Gemini's `lm-icon-*` sizes and the weight each computes; every one at `"ROND" 100`, unfilled. */
const WEIGHT: Record<16 | 20 | 24 | 28 | 32, number> = { 16: 330, 20: 320, 24: 300, 28: 260, 32: 260 };

export const LmIcon: React.FC<{
  name: string;
  size: 16 | 20 | 24 | 28 | 32;
  family?: 'luminous' | 'google-symbols';
  className?: string;
}> = ({ name, size, family = 'luminous', className }) => (
  <MaterialSymbol
    family={family}
    name={name}
    size={size}
    weight={WEIGHT[size]}
    variationSettings={`"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" ${WEIGHT[size]}`}
    className={className}
  />
);
