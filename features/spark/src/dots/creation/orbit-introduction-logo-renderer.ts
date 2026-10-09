/**
 * Spinning bot logo of the onboarding steps. The original renders an unlit torus
 * (radius 112, tube 47) through an orthographic camera with three.js; its silhouette is the
 * torus' central circle, rotated about Y and projected, stroked with the tube diameter.
 */

const angles = [
  0, 0.66148, 2.103122, 3.214896, 4.031711, 4.752532, 5.393067, 5.962045, 6.480408, 6.944665, 7.389724, 7.79115, 8.162905, 8.515461, 8.840093, 9.135053,
  9.498082, 9.745919, 9.993755, 10.255555, 10.489429, 10.711086, 10.932742, 11.133455, 11.335913, 11.5279, 11.71465, 11.880456, 12.056734, 12.203342,
  12.369148, 12.494812, 12.711233, 12.821189, 12.953834, 13.076007, 13.203416, 13.322098, 13.43729, 13.550736, 13.665928, 13.765412, 13.868386, 13.969615,
  14.058627, 14.15113, 14.229669, 14.313445, 14.405948, 14.477506, 14.557791, 14.634586, 14.704399, 14.760249, 14.837044, 14.89813, 14.962708, 15.022049,
  15.070918, 15.138986, 15.184364, 15.229743, 15.283848, 15.3205, 15.386823, 15.418239, 15.468853, 15.510741, 15.564846, 15.564846, 15.636405, 15.636405,
  15.707963, 15.781267, 15.781267, 15.781267, 15.852826, 15.852826, 15.852826, 15.905185, 15.947073, 15.947073, 15.962781, 15.997688, 15.997688, 16.029104,
  16.043066, 16.070992, 16.070992, 16.095426, 16.095426, 16.109389, 16.132078, 16.132078, 16.132078, 16.166985, 16.166985, 16.166985, 16.166985, 16.186183,
  16.186183, 16.186183, 16.186183, 16.200146, 16.200146, 16.217599, 16.217599, 16.217599, 16.217599, 16.217599, 16.217599, 16.217599, 16.200146, 16.200146,
  16.200146, 16.186183, 16.186183, 16.186183, 16.186183, 16.166985, 16.166985, 16.166985, 16.166985, 16.166985, 16.153022, 16.132078, 16.132078, 16.132078,
  16.132078, 16.109389, 16.095426, 16.095426, 16.095426, 16.070992, 16.070992, 16.070992, 16.043066, 16.043066, 16.029104, 16.029104, 16.029104, 15.997688,
  15.997688, 15.997688, 15.962781, 15.947073, 15.947073, 15.947073, 15.947073, 15.905185, 15.905185, 15.905185, 15.905185, 15.905185, 15.852826, 15.852826,
  15.852826, 15.852826, 15.852826, 15.852826, 15.852826, 15.781267, 15.781267, 15.781267, 15.781267, 15.781267, 15.781267, 15.781267, 15.781267, 15.781267,
  15.781267, 15.781267, 15.781267, 15.781267, 15.707963, 15.707963, 15.707963, 15.707963, 15.707963, 15.707963, 15.707963,
];

const spinDurationMs = 3000;
const maxLandingDurationMs = 900;
const turns = 2;
const frustum = 159;
const torusRadius = 112;
const tubeRadius = 47;
const tubularSegments = 160;

export interface LogoSpinRequest {
  color: string;
  landingColor: string;
  palette?: string[];
  repeatDelayMs?: number;
}

export interface OrbitIntroductionLogo {
  spin: (request: LogoSpinRequest) => void;
  settle: () => Promise<void>;
  dispose: () => void;
}

type LinearColor = [number, number, number];

const toLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const toSrgb = (c: number) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);

function parseColor(value: string): LinearColor {
  const hex = value.trim().replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

function lerpColor(a: LinearColor, b: LinearColor, t: number): LinearColor {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function cssColor([r, g, b]: LinearColor) {
  const channel = (c: number) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255);
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function paletteColors({ color, palette, landingColor }: LogoSpinRequest) {
  if (palette?.length) return [color, ...palette, ...palette, landingColor].map(parseColor);
  return null;
}

interface Landing {
  angle: number;
  velocity: number;
  target: number;
  scale: number;
  color: LinearColor;
  landingColor: LinearColor;
  duration: number;
}

export function renderOrbitIntroductionLogo(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  initial: LogoSpinRequest,
  onContextLost: () => void,
  onFirstFrame: () => void,
): OrbitIntroductionLogo {
  const context = canvas.getContext("2d");
  let request = initial;
  let rotation = 0;
  let scale = 1;
  let color = parseColor(request.color);
  let palette = paletteColors(request);
  const lastAngle = angles.at(-1) ?? 1;
  const firstAngle = angles[0] ?? 0;
  let frame: number | null = null;
  let repeatTimeout: number | undefined;
  let resumeWhenVisible = document.hidden;
  let disposed = false;
  let startedAt: number | null = null;
  let velocity = 0;
  let settling: { promise: Promise<void>; resolve: () => void } | null = null;
  let landing: Landing | null = null;
  let right = frustum;
  let top = frustum;

  function draw() {
    if (context == null) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const unitX = width / (2 * right);
    const unitY = height / (2 * top);
    const radiusX = torusRadius * scale * Math.abs(Math.cos(rotation)) * unitX;
    const radiusY = torusRadius * scale * unitY;
    context.beginPath();
    for (let i = 0; i <= tubularSegments; i += 1) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const x = width / 2 + radiusX * Math.cos(u);
      const y = height / 2 + radiusY * Math.sin(u);
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.lineWidth = 2 * tubeRadius * scale * Math.min(unitX, unitY);
    context.lineJoin = "round";
    context.lineCap = "round";
    context.strokeStyle = cssColor(color);
    context.stroke();
  }

  function tick(now: number) {
    if (disposed) return;
    if (startedAt == null) {
      startedAt = now;
      onFirstFrame();
    }
    const progress = Math.min(1, (now - startedAt) / (landing?.duration ?? spinDurationMs));
    if (landing != null) {
      const e = progress;
      const distance = landing.target - landing.angle;
      const momentum = (landing.velocity * landing.duration) / 1000;
      rotation = landing.angle + distance * (3 * e * e - 2 * e * e * e) + momentum * (e * e * e - 2 * e * e + e);
      velocity = ((distance * (6 * e - 6 * e * e) + momentum * (3 * e * e - 4 * e + 1)) * 1000) / landing.duration;
      const eased = e * e * (3 - 2 * e);
      scale = lerp(landing.scale, 1, eased);
      color = lerpColor(landing.color, landing.landingColor, eased);
    } else {
      const position = progress * (angles.length - 1);
      const index = Math.floor(position);
      const from = angles[index] ?? lastAngle;
      const to = angles[Math.min(index + 1, angles.length - 1)] ?? lastAngle;
      const angle = lerp(from, to, position - index);
      rotation = (angle / lastAngle) * turns * Math.PI * 2;
      velocity = (((to - from) / lastAngle) * turns * Math.PI * 2 * (angles.length - 1) * 1000) / spinDurationMs;
      scale = 1 - 0.02 * (1 - Math.cos(2 * Math.PI * progress));
      if (palette != null) {
        const step = Math.min(1, Math.max(0, (angle - firstAngle) / (lastAngle - firstAngle) / 0.96)) * (palette.length - 1);
        const stepIndex = Math.floor(step);
        const t = Math.min(1, Math.max(0, (step - stepIndex - 0.55) / 0.45));
        const eased = t * t * t * (t * (t * 6 - 15) + 10);
        const first = palette[0];
        if (first != null) {
          color = lerpColor(palette[stepIndex] ?? first, palette[Math.min(stepIndex + 1, palette.length - 1)] ?? first, eased);
        }
      }
    }
    draw();
    if (progress < 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    frame = null;
    settling?.resolve();
    settling = null;
    if (request.repeatDelayMs != null) {
      repeatTimeout = window.setTimeout(() => spin({ ...request, color: request.landingColor }), request.repeatDelayMs);
    }
  }

  function loseContext(event: Event) {
    event.preventDefault();
    disposed = true;
    window.clearTimeout(repeatTimeout);
    if (frame != null) cancelAnimationFrame(frame);
    settling?.resolve();
    settling = null;
    onContextLost();
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    if (width === 0 || height === 0 || bounds.width === 0 || bounds.height === 0 || disposed) return;
    right = (frustum * width) / bounds.width;
    top = (frustum * height) / bounds.height;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    draw();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas, { box: "devicePixelContentBoxSize" in ResizeObserverEntry.prototype ? "device-pixel-content-box" : "content-box" });
  window.addEventListener("resize", resize);
  resize();
  canvas.addEventListener("contextlost", loseContext);
  document.addEventListener("visibilitychange", visibilityChanged);
  draw();
  if (!document.hidden) frame = requestAnimationFrame(tick);

  function spin(next: LogoSpinRequest) {
    if (disposed) return;
    request = next;
    window.clearTimeout(repeatTimeout);
    repeatTimeout = undefined;
    if (document.hidden) {
      resumeWhenVisible = true;
      return;
    }
    if (frame == null) {
      landing = null;
      startedAt = null;
      palette = paletteColors(next);
      color = parseColor(next.color);
      frame = requestAnimationFrame(tick);
      return;
    }
    const angle = rotation;
    const target = (Math.ceil(angle / (Math.PI * 2)) + 1) * Math.PI * 2;
    landing = {
      angle,
      velocity,
      target,
      scale,
      color,
      landingColor: parseColor(next.landingColor),
      duration: Math.min(maxLandingDurationMs, (3000 * (target - angle)) / Math.max(velocity, 1)),
    };
    startedAt = performance.now();
  }

  function visibilityChanged() {
    if (document.hidden) {
      resumeWhenVisible = frame != null || repeatTimeout != null;
      window.clearTimeout(repeatTimeout);
      repeatTimeout = undefined;
      if (frame != null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (settling != null) {
        resumeWhenVisible = false;
        rotation = 0;
        scale = 1;
        color = parseColor(request.landingColor);
        settling.resolve();
        settling = null;
      }
    } else if (resumeWhenVisible) {
      resumeWhenVisible = false;
      spin({ ...request, color: request.landingColor, palette: request.repeatDelayMs == null ? undefined : request.palette });
    }
  }

  return {
    spin,
    settle() {
      if (settling != null) return settling.promise;
      window.clearTimeout(repeatTimeout);
      repeatTimeout = undefined;
      request = { ...request, repeatDelayMs: undefined };
      if (disposed || document.hidden || frame == null) return Promise.resolve();
      let resolve = () => {};
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      settling = { promise, resolve };
      spin({ ...request, color: request.landingColor, palette: undefined });
      return promise;
    },
    dispose() {
      disposed = true;
      window.clearTimeout(repeatTimeout);
      if (frame != null) cancelAnimationFrame(frame);
      settling?.resolve();
      settling = null;
      canvas.removeEventListener("contextlost", loseContext);
      document.removeEventListener("visibilitychange", visibilityChanged);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    },
  };
}
