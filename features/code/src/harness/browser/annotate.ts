/**
 * Marking up a screenshot for the user: a box around each thing the agent is
 * talking about and a numbered badge, matching the numbered notes listed under
 * the picture in the chat. Text stays out of the picture; it is easier to read
 * as text, and badges never cover the thing they point at with words.
 */

import type { Box } from './page-driver';
import type { Screenshot } from './screenshot';

export interface AnnotationMark {
  /** In the frame's CSS pixels. */
  box: Box;
}

export interface AnnotatedImage {
  /** Base64 JPEG, for the model. */
  data: string;
  /** The same, as a data URL, for the chat. */
  dataUrl: string;
}

const ACCENT = '#ff6b2c';
const BADGE_RADIUS = 13;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The screenshot could not be decoded.'));
    image.src = src;
  });
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export async function drawAnnotations(shot: Screenshot, marks: readonly AnnotationMark[]): Promise<AnnotatedImage> {
  const image = await loadImage(`data:${shot.mimeType};base64,${shot.data}`);
  const canvas = document.createElement('canvas');
  canvas.width = shot.width;
  canvas.height = shot.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(image, 0, 0, shot.width, shot.height);

  marks.forEach((mark, index) => {
    const pad = 4;
    const x = Math.max(1, mark.box.x * shot.scale - pad);
    const y = Math.max(1, mark.box.y * shot.scale - pad);
    const width = Math.min(shot.width - x - 1, mark.box.width * shot.scale + pad * 2);
    const height = Math.min(shot.height - y - 1, mark.box.height * shot.scale + pad * 2);

    // A dark halo under the stroke keeps it visible on light and dark interfaces alike.
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    context.lineWidth = 5;
    roundedRect(context, x, y, width, height, 8);
    context.stroke();
    context.strokeStyle = ACCENT;
    context.lineWidth = 2.5;
    roundedRect(context, x, y, width, height, 8);
    context.stroke();

    const cx = Math.min(Math.max(x, BADGE_RADIUS + 2), shot.width - BADGE_RADIUS - 2);
    const cy = Math.min(Math.max(y, BADGE_RADIUS + 2), shot.height - BADGE_RADIUS - 2);
    context.beginPath();
    context.arc(cx, cy, BADGE_RADIUS, 0, Math.PI * 2);
    context.fillStyle = ACCENT;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = '#ffffff';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = 'bold 13px system-ui, -apple-system, Segoe UI, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1), cx, cy + 0.5);
  });

  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl };
}
