/**
 * How the bot's character fills its Discord picture as fully as a circle allows: the smallest circle that holds every
 * solid pixel of it becomes the picture, the character copied into it pixel for pixel — never enlarged, so never
 * softened — on transparency, which Discord shows over its own background. Discord cuts every picture to a circle, so
 * this is the largest the character can be with none of it cut away.
 */

/** Opaque enough to count as the character rather than the soft edge around it. */
export const SOLID_ALPHA = 32;

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * The corners of the character's outermost solid pixels, row by row: every point that can be on its outline's hull,
 * from RGBA bytes `width` pixels wide.
 */
export const outlinePoints = (rgba: ArrayLike<number>, width: number, height: number, solid = SOLID_ALPHA): [number, number][] => {
  const points: [number, number][] = [];
  for (let y = 0; y < height; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3]! <= solid) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    points.push([first, y], [last + 1, y], [first, y + 1], [last + 1, y + 1]);
  }
  return points;
};

const holds = (circle: Circle, [x, y]: [number, number]) => Math.hypot(x - circle.x, y - circle.y) <= circle.r + 1e-7;

const throughTwo = ([ax, ay]: [number, number], [bx, by]: [number, number]): Circle => ({ x: (ax + bx) / 2, y: (ay + by) / 2, r: Math.hypot(ax - bx, ay - by) / 2 });

const throughThree = (a: [number, number], b: [number, number], c: [number, number]): Circle | null => {
  const [ax, ay] = a;
  const [bx, by] = b;
  const [cx, cy] = c;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { x, y, r: Math.hypot(ax - x, ay - y) };
};

/** The smallest circle holding every point (Welzl's, as the incremental "minidisk"; expected linear time). */
export const smallestCircle = (points: readonly [number, number][], random: () => number = Math.random): Circle | null => {
  if (points.length === 0) return null;
  const order = [...points];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  let circle: Circle = { x: order[0]![0], y: order[0]![1], r: 0 };
  for (let i = 1; i < order.length; i += 1) {
    const p = order[i]!;
    if (holds(circle, p)) continue;
    circle = { x: p[0], y: p[1], r: 0 };
    for (let j = 0; j < i; j += 1) {
      const q = order[j]!;
      if (holds(circle, q)) continue;
      circle = throughTwo(p, q);
      for (let k = 0; k < j; k += 1) {
        const s = order[k]!;
        if (holds(circle, s)) continue;
        // Three in a line: the two farthest apart hold the third.
        circle = throughThree(p, q, s) ?? [throughTwo(p, q), throughTwo(p, s), throughTwo(q, s)].reduce((best, next) => (next.r > best.r ? next : best));
      }
    }
  }
  return circle;
};

/**
 * Where the character goes in its picture: the picture's side, and the offset that puts the character's smallest
 * circle in its middle — whole pixels, so the copy is exact. Null when there is nothing solid to show.
 */
export const pictureFrame = (rgba: ArrayLike<number>, width: number, height: number): { size: number; left: number; top: number } | null => {
  const circle = smallestCircle(outlinePoints(rgba, width, height));
  if (!circle || circle.r <= 0) return null;
  // A pixel of room round the edge, so antialiasing at the circle's edge never shaves the outline.
  const radius = Math.ceil(circle.r) + 1;
  return { size: radius * 2, left: Math.round(radius - circle.x), top: Math.round(radius - circle.y) };
};
