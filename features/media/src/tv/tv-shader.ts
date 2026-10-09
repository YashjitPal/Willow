// Flow TV's channel-change effect: the outgoing video swirls and blurs, dissolves through a noise
// mask into the incoming one, and settles. Its shaders are Flow TV's, verbatim; the renderer is
// its multi-pass one (a crossfade pass, then ten ping-ponged blur passes) in plain WebGL2, where
// Flow TV's uses twgl.

const VERTEX = `#version 300 es

layout(location = 0) in vec4 position;

void main() {
  gl_Position = position;
}
`;

const CROSSFADE = `#version 300 es

#define PI (3.14159265359)
#define TWO_PI (6.2831853072)
precision highp float;

uniform float strength;
uniform float crossFade;
uniform sampler2D vid1;
uniform sampler2D vid2;
uniform sampler2D noiseTexture;
uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iScreenResolution;

out vec4 fragColor;

mat2 rotate2D(float angle) {
  float sine = sin(angle),
    cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine);
}

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  const float K1 = 0.366025404; // (sqrt(3)-1)/2;
  const float K2 = 0.211324865; // (3-sqrt(3))/6;

  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n =
    h *
    h *
    h *
    h *
    vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
  return dot(n, vec3(70.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  uv.y = 1.0 - uv.y; // flip y

  vec3 col = vec3(0.0);

  // sample the texture N times with different noise offsets
  const float N = 2.0;

  vec2 noiseUV = uv;
  noiseUV.x *= iScreenResolution.x / iScreenResolution.y;
  vec4 noiseColor = texture(noiseTexture, (noiseUV + iTime * 0.05) * 0.5);
  vec3 noiseStepColor = step(noiseColor.rgb, vec3(crossFade));

  // Noise offset strength
  const float offsetStren = 0.2;
  const float noiseFreq = 1.5;
  for (float i = 0.0; i < N; i++) {
    vec2 vv = uv;
    float stren = pow(strength, 1.5) * mix(length(uv - 0.5), 1.0, strength);
    float nois = noise(
      (i + 1.0) * 0.23 + uv * noiseFreq * rotate2D(i * 0.8) + iTime * 0.2
    );
    vv -= 0.5;
    vv *= rotate2D(i * PI * 0.4 + iTime * 0.12 * i);
    vv += 0.5;

    vec2 off = vec2(cos(nois * TWO_PI), sin(nois * TWO_PI));
    vv += off * 0.3 * stren;
    vv += i;

    float no2 = hash(vv).x;
    vec2 noi2 = vec2(cos(no2), sin(no2));
    vec3 cc1 = texture(
      vid1,
      vv + noi2 * offsetStren * length(vv - 0.5) * smoothstep(0.0, 0.1, stren)
    ).rgb;
    vec3 cc2 = texture(
      vid2,
      vv + noi2 * offsetStren * length(vv - 0.5) * smoothstep(0.0, 0.1, stren)
    ).rgb;
    vec3 cc = mix(cc1, cc2, noiseStepColor);
    col = mix(i == 0.0 ? cc : col, cc * nois, i / N * stren);
  }

  fragColor = vec4(col, 1.0);
}
`;

const BLUR = `#version 300 es

precision highp float;

uniform vec2 iResolution;
uniform sampler2D iInputTex;
uniform bool flip;
uniform vec2 direction;
uniform float strength;

vec4 blur13(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
  vec4 color = vec4(0.0);
  vec2 off1 = vec2(1.411764705882353) * direction;
  vec2 off2 = vec2(3.2941176470588234) * direction;
  vec2 off3 = vec2(5.176470588235294) * direction;
  color += texture(image, uv) * 0.1964825501511404;
  color += texture(image, uv + off1 / resolution) * 0.2969069646728344;
  color += texture(image, uv - off1 / resolution) * 0.2969069646728344;
  color += texture(image, uv + off2 / resolution) * 0.09447039785044732;
  color += texture(image, uv - off2 / resolution) * 0.09447039785044732;
  color += texture(image, uv + off3 / resolution) * 0.010381362401148057;
  color += texture(image, uv - off3 / resolution) * 0.010381362401148057;
  return color;
}

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  uv.y = 1.0 - uv.y;

  fragColor = blur13(iInputTex, uv, iResolution.xy, direction * strength);
}
`;

const BLUR_PASSES = 10;

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

interface Pass {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
  /** Off-screen passes render into two targets in turn; the last pass draws to the canvas. */
  targets: Target[] | null;
  size: [number, number];
  index: number;
  direction?: [number, number];
}

/** The values Flow TV animates: the swirl, the dissolve, and the blur. */
export interface ShaderUniforms {
  strength: number;
  crossFade: number;
  blur: number;
}

const uploadable = (v: HTMLVideoElement | null): v is HTMLVideoElement =>
  !!v && v.readyState >= v.HAVE_CURRENT_DATA && v.currentTime > 0;

export class ChannelShaderRenderer {
  private gl: WebGL2RenderingContext;
  private passes: Pass[] = [];
  private quad: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vid1: WebGLTexture | null = null;
  private vid2: WebGLTexture | null = null;
  private noise: WebGLTexture | null = null;
  private raf = 0;

  /** Throws when WebGL2 is not available, as Flow TV logs and gives up. */
  constructor(
    private canvas: HTMLCanvasElement,
    private current: HTMLVideoElement,
    private next: () => HTMLVideoElement | null,
    private uniforms: () => ShaderUniforms,
    noiseUrl: string,
  ) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.vid1 = this.videoTexture(current);
    this.vid2 = this.videoTexture(next());
    this.noise = this.noiseTexture(noiseUrl);

    this.passes.push(this.pass(CROSSFADE, 0, [512, 512], true));
    for (let r = 0; r < BLUR_PASSES; r += 1) {
      const n = 32 - 3.2 * r;
      const pass = this.pass(BLUR, r + 1, [1024, 512], r < BLUR_PASSES - 1);
      pass.direction = r % 2 === 0 ? [n, 0] : [0, n];
      this.passes.push(pass);
    }
  }

  start(): void {
    const frame = (now: number) => {
      this.render(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    const { gl } = this;
    for (const p of this.passes) {
      gl.deleteProgram(p.program);
      for (const t of p.targets ?? []) {
        gl.deleteFramebuffer(t.framebuffer);
        gl.deleteTexture(t.texture);
      }
    }
    gl.deleteTexture(this.vid1);
    gl.deleteTexture(this.vid2);
    gl.deleteTexture(this.noise);
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
    this.passes = [];
  }

  private render(now: number): void {
    const { gl, canvas } = this;
    const { strength, crossFade, blur } = this.uniforms();
    if (uploadable(this.current)) this.upload(this.vid1, this.current);
    const next = this.next();
    if (uploadable(next)) this.upload(this.vid2, next);
    gl.bindVertexArray(this.vao);
    for (const pass of this.passes) {
      const toScreen = !pass.targets;
      const [w, h] = toScreen ? [canvas.width, canvas.height] : pass.size;
      const target = pass.targets ? pass.targets[pass.index % 2] : null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(pass.program);
      gl.uniform1f(pass.uniform('iTime'), now * 0.001);
      gl.uniform2f(pass.uniform('iResolution'), w, h);
      gl.uniform2f(pass.uniform('iScreenResolution'), canvas.width, canvas.height);
      if (pass === this.passes[0]) {
        gl.uniform1f(pass.uniform('strength'), strength);
        gl.uniform1f(pass.uniform('crossFade'), crossFade);
        this.bindTexture(pass, 'vid1', this.vid1, 0);
        this.bindTexture(pass, 'vid2', this.vid2, 1);
        this.bindTexture(pass, 'noiseTexture', this.noise, 2);
      } else {
        const input = this.passes[this.passes.indexOf(pass) - 1];
        gl.uniform1f(pass.uniform('strength'), blur);
        gl.uniform1i(pass.uniform('flip'), 1);
        gl.uniform2f(pass.uniform('direction'), pass.direction![0], pass.direction![1]);
        this.bindTexture(pass, 'iInputTex', input.targets![(input.index + 1) % 2].texture, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (pass.targets) pass.index += 1;
    }
  }

  private bindTexture(pass: Pass, name: string, texture: WebGLTexture | null, unit: number): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(pass.uniform(name), unit);
  }

  private upload(texture: WebGLTexture | null, video: HTMLVideoElement): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      /* a cross-origin frame cannot be read; the texture keeps its last frame */
    }
  }

  private videoTexture(video: HTMLVideoElement | null): WebGLTexture | null {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    if (video && video.readyState >= video.HAVE_CURRENT_DATA) this.upload(texture, video);
    return texture;
  }

  /** Flow TV's noise.png, repeating; a mid-grey pixel until it loads. */
  private noiseTexture(url: string): WebGLTexture | null {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const image = new Image();
    image.onload = () => {
      if (!this.passes.length) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    };
    image.src = url;
    return texture;
  }

  private pass(fragment: string, index: number, size: [number, number], offscreen: boolean): Pass {
    const { gl } = this;
    const defines = [index === 0 ? '#define FIRST_PASS' : '', offscreen ? '#define PING_PONG' : ''].filter(Boolean);
    const lines = fragment.split('\n');
    lines.splice(1, 0, ...defines);
    const program = this.program(VERTEX, lines.join('\n'));
    const cache = new Map<string, WebGLUniformLocation | null>();
    const uniform = (name: string) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    };
    return { program, uniform, targets: offscreen ? [this.target(size), this.target(size)] : null, size, index: 0 };
  }

  private target([w, h]: [number, number]): Target {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture };
  }

  private program(vs: string, fs: string): WebGLProgram {
    const { gl } = this;
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader did not compile');
      return shader;
    };
    const program = gl.createProgram()!;
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program did not link');
    return program;
  }
}
