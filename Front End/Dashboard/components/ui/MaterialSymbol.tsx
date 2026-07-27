import React from 'react';

interface MaterialSymbolProps {
  name: string;
  family?: 'material-rounded' | 'luminous' | 'google-symbols';
  size?: number;
  weight?: number;
  fill?: boolean;
  grade?: number;
  roundness?: number;
  symbolWidth?: number;
  opticalSize?: number;
  variationSettings?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const MaterialSymbol: React.FC<MaterialSymbolProps> = ({
  name,
  family = 'material-rounded',
  size = 20,
  weight = 320,
  fill = false,
  grade = 0,
  roundness,
  symbolWidth,
  opticalSize = size,
  variationSettings,
  className = '',
  style,
}) => {
  const familyClass = family === 'luminous'
    ? 'luminous-symbols'
    : family === 'google-symbols'
      ? 'google-symbols'
      : 'material-symbols-rounded';
  const axes = family === 'google-symbols'
    ? [
        `"ROND" ${roundness ?? 0}`,
        '"slnt" 0',
        ...(symbolWidth === undefined ? [] : [`"wdth" ${symbolWidth}`]),
        `"wght" ${weight}`,
      ]
    : [
        `"FILL" ${fill ? 1 : 0}`,
        `"wght" ${weight}`,
        `"GRAD" ${grade}`,
        ...(roundness === undefined ? [] : [`"ROND" ${roundness}`]),
        `"opsz" ${opticalSize}`,
        ...(symbolWidth === undefined ? [] : [`"wdth" ${symbolWidth}`]),
      ];

  return (
    <span
      aria-hidden="true"
      className={`${familyClass} inline-flex shrink-0 select-none items-center justify-center overflow-hidden align-middle ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size,
        fontWeight: weight,
        lineHeight: `${size}px`,
        fontVariationSettings: variationSettings ?? axes.join(', '),
        ...style,
      }}
    >
      {name}
    </span>
  );
};
