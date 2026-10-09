// Flow's `flow-image-cropper`, which wraps Cropper.js: the image dimmed to half under a crop box
// that shows it at full strength, thirds drawn dashed, a crosshair at the centre and 10px corner
// points. A fixed ratio hides the edge handles and keeps the box's shape; Freeform adds them.
// The box starts as the largest crop of that ratio, centred (Cropper's autoCropArea of 1).
import React from 'react';

export interface CropBox { x: number; y: number; w: number; h: number }

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN = 24;

function initialBox(width: number, height: number, ratio: number | null): CropBox {
  if (!ratio) return { x: 0, y: 0, w: width, h: height };
  let w = width;
  let h = w / ratio;
  if (h > height) { h = height; w = h * ratio; }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export const ImageCropper: React.FC<{
  src: string;
  /** Width over height, or null for Freeform. */
  ratio: number | null;
  /** The crop as fractions of the image. */
  onChange: (box: CropBox) => void;
}> = ({ src, ratio, onChange }) => {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = React.useState<CropBox | null>(null);
  const drag = React.useRef<{ handle: Handle; x: number; y: number; start: CropBox } | null>(null);

  // Fit the image into the space left inside the 5px padding, as the ghost image does in Flow.
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !natural) return undefined;
    const fit = () => {
      const availW = el.clientWidth - 10;
      const availH = el.clientHeight - 10;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / natural.w, availH / natural.h, Infinity);
      setSize({ w: natural.w * scale, h: natural.h * scale });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural]);

  React.useEffect(() => {
    if (size) setBox(initialBox(size.w, size.h, ratio));
  }, [size?.w, size?.h, ratio]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (box && size) onChange({ x: box.x / size.w, y: box.y / size.h, w: box.w / size.w, h: box.h / size.h });
  }, [box, size, onChange]);

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    if (!box || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: box };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !size) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const s = d.start;
    if (d.handle === 'move') {
      setBox({ ...s, x: Math.min(Math.max(0, s.x + dx), size.w - s.w), y: Math.min(Math.max(0, s.y + dy), size.h - s.h) });
      return;
    }
    let left = s.x;
    let top = s.y;
    let right = s.x + s.w;
    let bottom = s.y + s.h;
    if (d.handle.includes('w')) left = Math.min(Math.max(0, s.x + dx), right - MIN);
    if (d.handle.includes('e')) right = Math.max(Math.min(size.w, s.x + s.w + dx), left + MIN);
    if (d.handle.includes('n')) top = Math.min(Math.max(0, s.y + dy), bottom - MIN);
    if (d.handle.includes('s')) bottom = Math.max(Math.min(size.h, s.y + s.h + dy), top + MIN);
    if (ratio && d.handle.length === 2) {
      // Keep the shape from the opposite corner: follow whichever axis moved further.
      let w = right - left;
      let h = bottom - top;
      if (w / h > ratio) w = h * ratio; else h = w / ratio;
      const maxW = d.handle.includes('w') ? s.x + s.w : size.w - s.x;
      const maxH = d.handle.includes('n') ? s.y + s.h : size.h - s.y;
      if (w > maxW) { w = maxW; h = w / ratio; }
      if (h > maxH) { h = maxH; w = h * ratio; }
      if (d.handle.includes('w')) left = s.x + s.w - w; else right = left + w;
      if (d.handle.includes('n')) top = s.y + s.h - h; else bottom = top + h;
    }
    setBox({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const onPointerUp = () => { drag.current = null; };

  const handles: Handle[] = ratio ? ['nw', 'ne', 'sw', 'se'] : ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

  return (
    <div ref={wrapRef} className="ie-cropper">
      {/* Measures the image's natural size; never shown. */}
      <img src={src} alt="" style={{ display: 'none' }} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {size && (
        <div className="ie-cropper__box" style={{ width: size.w, height: size.h }}>
          <div className="ie-cropper__layer" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div className="ie-cropper__canvas"><img src={src} alt="" draggable={false} /></div>
            <div className="ie-cropper__modal" />
            {box && (
              <div className="ie-cropper__crop" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
                <span className="ie-cropper__view">
                  <img src={src} alt="" draggable={false} style={{ left: -box.x, top: -box.y, width: size.w, height: size.h }} />
                </span>
                <span className="ie-cropper__dashed ie-cropper__dashed--h" />
                <span className="ie-cropper__dashed ie-cropper__dashed--v" />
                <span className="ie-cropper__center" />
                <span className="ie-cropper__face" onPointerDown={onPointerDown('move')} />
                {!ratio && (['e', 'n', 'w', 's'] as const).map((h) => (
                  <span key={`line-${h}`} className={`ie-cropper__line ie-cropper__line--${h}`} onPointerDown={onPointerDown(h)} />
                ))}
                {handles.map((h) => (
                  <span key={h} className={`ie-cropper__point ie-cropper__point--${h}`} onPointerDown={onPointerDown(h)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Cuts `box` (fractions) out of the image at full resolution. */
export async function cropImage(src: string, box: CropBox): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const sx = Math.round(box.x * img.naturalWidth);
  const sy = Math.round(box.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(box.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(box.h * img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return { dataUrl: canvas.toDataURL('image/png'), width: sw, height: sh };
}
