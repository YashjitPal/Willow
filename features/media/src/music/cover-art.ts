// A song cover drawn on the device, used when no Gemini image model is added or the image
// request fails. The colours come from the title, so a song keeps its cover.

const hashOf = (text: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export function drawCoverArt(title: string, size = 800): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return '';

  const seed = hashOf(title || 'Untitled');
  const hue = seed % 360;
  const accent = (hue + 40 + ((seed >>> 9) % 100)) % 360;

  const base = g.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, `hsl(${hue} 55% 24%)`);
  base.addColorStop(1, `hsl(${accent} 60% 10%)`);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  const glowX = size * (0.2 + ((seed >>> 4) % 50) / 100);
  const glowY = size * (0.2 + ((seed >>> 14) % 40) / 100);
  const glow = g.createRadialGradient(glowX, glowY, 0, glowX, glowY, size * 0.8);
  glow.addColorStop(0, `hsla(${accent}, 80%, 62%, 0.55)`);
  glow.addColorStop(1, `hsla(${accent}, 80%, 62%, 0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);

  return canvas.toDataURL('image/jpeg', 0.9);
}
