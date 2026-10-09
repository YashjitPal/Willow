import React from 'react';

/**
 * The pet's paw, from BetterGravity's Pets plugin: four toes of radius 100 above a
 * 520 x 380 pad, on Material's 0 -960 960 960 box, in the text colour.
 */
const TOE = 'q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29Z';
export const PAW_PATH = `M180-475${TOE}M360-635${TOE}M600-635${TOE}M780-475${TOE}M220-250a260 190 0 1 0 520 0a260 190 0 1 0-520 0Z`;

export const PetPawIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
    <path d={PAW_PATH} />
  </svg>
);

export default PetPawIcon;
