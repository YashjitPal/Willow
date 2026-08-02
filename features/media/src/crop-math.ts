// Pure crop-geometry math for the MediaView image editor.
//
// Both functions used to be defined inside MediaView's component body, reading
// the selected item from closure. They are pure now: pass the image's ratio
// string (or the computed aspect ratio) and get the same numbers back. The
// original `!selectedItem` fallback is expressed as `!ratio`, which is
// equivalent because the only caller-visible input is `selectedItem?.ratio`.

/** Parse the image's own aspect ratio number; 16:9 is the fallback. */
export const getImageAr = (ratio?: string): number => {
  if (!ratio) return 16 / 9;
  if (ratio === '4:3') return 4 / 3;
  if (ratio === '1:1') return 1;
  if (ratio === '3:4') return 3 / 4;
  if (ratio === '9:16') return 9 / 16;
  return 16 / 9;
};

/** Maximized crop box (percent coords) for a crop ratio inside the image's AR. */
export const computeMaxCropBox = (cropRatio: string, imageAr: number) => {
  if (cropRatio === 'freeform') return { x: 0, y: 0, w: 100, h: 100 };
  const [cw, ch] = cropRatio.split(':').map(Number);
  const cropAr = cw / ch;
  // Compare crop AR to image AR to decide which dimension is the constraint
  let boxW: number, boxH: number;
  if (cropAr >= imageAr) {
    // Crop is wider relative to image → width-constrained
    boxW = 100;
    boxH = (imageAr / cropAr) * 100;
  } else {
    // Crop is taller relative to image → height-constrained
    boxH = 100;
    boxW = (cropAr / imageAr) * 100;
  }
  return { x: (100 - boxW) / 2, y: (100 - boxH) / 2, w: boxW, h: boxH };
};
