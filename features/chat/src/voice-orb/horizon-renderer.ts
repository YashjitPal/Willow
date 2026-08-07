/**
 * WebGL2 renderer for the voice orb.
 *
 * Two passes, matching the shipped implementation:
 *
 *  1. Interior — draws the animated watercolour field into a framebuffer-backed
 *     texture at `INTERIOR_SCALE` of the drawing buffer. Skipped entirely while
 *     the pre-connection dot is showing, since nothing samples it then.
 *  2. Composite — an SDF circle that samples that texture and writes
 *     premultiplied alpha, so the orb has a clean antialiased edge.
 *
 * The interior parameters travel through a std140 uniform block whose offsets
 * are read back by introspection rather than hardcoded: drivers report block
 * members as `HorizonUniformsObject.waveFrame`, and the layout can legally
 * differ between implementations.
 */

import {
  INTERIOR_SCALE,
  INTERIOR_TEXTURE_UNIT,
  QUAD_GENERATED,
  QUAD_POSITIONS,
  UNIFORM_BLOCK_NAME,
  VERTEX_COUNT,
  WATERCOLOR_TEXTURE_UNIT,
} from './horizon-constants';

/** Everything the two shader programs need for one frame. */
export interface HorizonFrameVariables {
  paletteIndex: number;
  waveFrame: number;
  baseShaderFrame: number;
  waveAmplitude: number;
  textureFlowFrame: number;
  textureEdgeWarp: number;
  listeningTextureNoiseScale: number;
  micLevel: number;
  surfaceScale: number;
  userSpeakingScale: number;
  connectionRevealAmount: number;
  preConnectionDotVisibility: number;
  preConnectionDotColor: readonly [number, number, number, number];
  speakingWatercolorOffset0: readonly [number, number];
  speakingWatercolorOffset1: readonly [number, number];
  speakingWatercolorOffset2: readonly [number, number];
}

const UBO_FIELDS = [
  'waveFrame',
  'baseShaderFrame',
  'waveAmplitude',
  'textureFlowFrame',
  'textureEdgeWarp',
  'listeningTextureNoiseScale',
  'speakingWatercolorOffset0',
  'speakingWatercolorOffset1',
  'speakingWatercolorOffset2',
  'paletteIndex',
] as const;

type UboField = (typeof UBO_FIELDS)[number];

const COMPOSITE_UNIFORMS = [
  'uBaseShaderFrame',
  'uMicLevel',
  'uSurfaceScale',
  'uUserSpeakingScale',
  'uConnectionRevealAmount',
  'uPreConnectionDotVisibility',
  'uPreConnectionDotColor',
] as const;

type CompositeUniform = (typeof COMPOSITE_UNIFORMS)[number];

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not create ${label} shader.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Could not compile ${label} shader: ${log}`);
  }
  return shader;
};

const linkProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error(`Could not create ${label} program.`);
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // Shaders can be released as soon as they are linked into the program.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Could not link ${label} program: ${log}`);
  }
  return program;
};

const createStaticBuffer = (
  gl: WebGL2RenderingContext,
  data: Float32Array,
): WebGLBuffer => {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Could not create orb vertex buffer.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
};

export interface HorizonShaderSources {
  interiorVertex: string;
  interiorFragment: string;
  compositeVertex: string;
  compositeFragment: string;
}

export class HorizonRenderer {
  private readonly gl: WebGL2RenderingContext;

  private readonly interiorProgram: WebGLProgram;

  private readonly compositeProgram: WebGLProgram;

  private readonly positionBuffer: WebGLBuffer;

  private readonly generatedBuffer: WebGLBuffer;

  private readonly watercolorTexture: WebGLTexture;

  private readonly interiorTexture: WebGLTexture;

  private readonly framebuffer: WebGLFramebuffer;

  private readonly uniformBuffer: WebGLBuffer;

  private readonly uboData: ArrayBuffer;

  private readonly uboFloats: Float32Array;

  private readonly uboUints: Uint32Array;

  private readonly uboOffsets: Partial<Record<UboField, number>> = {};

  private readonly compositeLocations = {} as Record<CompositeUniform, WebGLUniformLocation>;

  private readonly interiorAttribs: { position: number; generated: number };

  private readonly compositeAttribs: { position: number };

  private interiorWidth = 0;

  private interiorHeight = 0;

  private disposed = false;

  constructor(
    gl: WebGL2RenderingContext,
    sources: HorizonShaderSources,
    watercolorImage: TexImageSource,
  ) {
    this.gl = gl;

    this.interiorProgram = linkProgram(
      gl,
      sources.interiorVertex,
      sources.interiorFragment,
      'orb interior',
    );
    this.compositeProgram = linkProgram(
      gl,
      sources.compositeVertex,
      sources.compositeFragment,
      'orb composite',
    );

    this.positionBuffer = createStaticBuffer(gl, QUAD_POSITIONS);
    this.generatedBuffer = createStaticBuffer(gl, QUAD_GENERATED);

    const interiorPosition = gl.getAttribLocation(this.interiorProgram, 'aPosition');
    const interiorGenerated = gl.getAttribLocation(this.interiorProgram, 'aGenerated');
    const compositePosition = gl.getAttribLocation(this.compositeProgram, 'aPosition');
    if (interiorPosition === -1) throw new Error('Missing orb attribute: aPosition (interior).');
    if (interiorGenerated === -1) throw new Error('Missing orb attribute: aGenerated.');
    if (compositePosition === -1) throw new Error('Missing orb attribute: aPosition (composite).');
    this.interiorAttribs = { position: interiorPosition, generated: interiorGenerated };
    this.compositeAttribs = { position: compositePosition };

    this.watercolorTexture = this.createWatercolorTexture(watercolorImage);
    this.interiorTexture = this.createInteriorTexture();
    this.framebuffer = this.createFramebuffer(this.interiorTexture);

    const block = this.setupUniformBlock();
    this.uniformBuffer = block.buffer;
    this.uboData = block.data;
    this.uboFloats = new Float32Array(this.uboData);
    this.uboUints = new Uint32Array(this.uboData);

    gl.useProgram(this.interiorProgram);
    const imageLocation = gl.getUniformLocation(this.interiorProgram, 'uImage_0');
    if (!imageLocation) throw new Error('Missing orb uniform: uImage_0.');
    gl.uniform1i(imageLocation, WATERCOLOR_TEXTURE_UNIT);

    gl.useProgram(this.compositeProgram);
    const interiorLocation = gl.getUniformLocation(this.compositeProgram, 'uInteriorTexture');
    if (!interiorLocation) throw new Error('Missing orb uniform: uInteriorTexture.');
    gl.uniform1i(interiorLocation, INTERIOR_TEXTURE_UNIT);

    for (const name of COMPOSITE_UNIFORMS) {
      const location = gl.getUniformLocation(this.compositeProgram, name);
      if (!location) throw new Error(`Missing orb composite uniform: ${name}`);
      this.compositeLocations[name] = location;
    }
  }

  /**
   * Upload the watercolour source.
   *
   * The flip and colourspace settings matter: the shader samples this texture in
   * its own space and expects no browser colour conversion, and mipmaps are
   * required because the interior samples it with explicit gradients.
   */
  private createWatercolorTexture(image: TexImageSource): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create orb watercolour texture.');
    gl.activeTexture(gl.TEXTURE0 + WATERCOLOR_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  private createInteriorTexture(): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create orb interior texture.');
    gl.activeTexture(gl.TEXTURE0 + INTERIOR_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  }

  private createFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
    const { gl } = this;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Could not create orb framebuffer.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  /** Introspect the std140 block so field offsets are never assumed. */
  private setupUniformBlock(): { buffer: WebGLBuffer; data: ArrayBuffer } {
    const { gl } = this;
    const blockIndex = gl.getUniformBlockIndex(this.interiorProgram, UNIFORM_BLOCK_NAME);
    if (blockIndex === gl.INVALID_INDEX) {
      throw new Error(`Could not find orb uniform block: ${UNIFORM_BLOCK_NAME}`);
    }

    const blockSize = gl.getActiveUniformBlockParameter(
      this.interiorProgram,
      blockIndex,
      gl.UNIFORM_BLOCK_DATA_SIZE,
    ) as number;

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not create orb uniform buffer.');
    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, blockSize, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buffer);
    gl.uniformBlockBinding(this.interiorProgram, blockIndex, 0);

    const indices = gl.getActiveUniformBlockParameter(
      this.interiorProgram,
      blockIndex,
      gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES,
    ) as Uint32Array;

    for (const index of indices) {
      const info = gl.getActiveUniform(this.interiorProgram, index);
      if (!info) continue;
      // Members are reported as "HorizonUniformsObject.waveFrame"; key by the
      // bare field name so lookups below stay readable.
      const field = info.name.replace(/\[0\]$/, '').replace(/^.*\./, '') as UboField;
      const offset = gl.getActiveUniforms(
        this.interiorProgram,
        [index],
        gl.UNIFORM_OFFSET,
      )[0] as number;
      this.uboOffsets[field] = offset;
    }

    const missing = UBO_FIELDS.filter((field) => this.uboOffsets[field] === undefined);
    if (missing.length) {
      throw new Error(`Orb uniform block missing fields: ${missing.join(', ')}`);
    }

    return { buffer, data: new ArrayBuffer(blockSize) };
  }

  private bindInteriorAttribs(): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.interiorAttribs.position);
    gl.vertexAttribPointer(this.interiorAttribs.position, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.generatedBuffer);
    gl.enableVertexAttribArray(this.interiorAttribs.generated);
    gl.vertexAttribPointer(this.interiorAttribs.generated, 3, gl.FLOAT, false, 0, 0);
  }

  private bindCompositeAttribs(): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.compositeAttribs.position);
    gl.vertexAttribPointer(this.compositeAttribs.position, 2, gl.FLOAT, false, 0, 0);
  }

  /** Resize the interior render target, reallocating only when it changes. */
  private ensureInteriorSize(width: number, height: number): void {
    if (this.interiorWidth === width && this.interiorHeight === height) return;
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + INTERIOR_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.interiorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Could not create orb interior framebuffer.');
    }
    this.interiorWidth = width;
    this.interiorHeight = height;
  }

  private writeUniformBlock(variables: HorizonFrameVariables): void {
    const { gl, uboOffsets, uboFloats, uboUints } = this;

    uboFloats[uboOffsets.waveFrame! / 4] = variables.waveFrame;
    uboFloats[uboOffsets.baseShaderFrame! / 4] = variables.baseShaderFrame;
    uboFloats[uboOffsets.waveAmplitude! / 4] = variables.waveAmplitude;
    uboFloats[uboOffsets.textureFlowFrame! / 4] = variables.textureFlowFrame;
    uboFloats[uboOffsets.textureEdgeWarp! / 4] = variables.textureEdgeWarp;
    uboFloats[uboOffsets.listeningTextureNoiseScale! / 4] =
      variables.listeningTextureNoiseScale;
    uboFloats.set(variables.speakingWatercolorOffset0, uboOffsets.speakingWatercolorOffset0! / 4);
    uboFloats.set(variables.speakingWatercolorOffset1, uboOffsets.speakingWatercolorOffset1! / 4);
    uboFloats.set(variables.speakingWatercolorOffset2, uboOffsets.speakingWatercolorOffset2! / 4);
    // paletteIndex is a uint in the block, so it must be written as one.
    uboUints[uboOffsets.paletteIndex! / 4] = variables.paletteIndex;

    gl.bindBuffer(gl.UNIFORM_BUFFER, this.uniformBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.uboData);
  }

  private writeCompositeUniforms(variables: HorizonFrameVariables): void {
    const { gl, compositeLocations } = this;
    gl.uniform1f(compositeLocations.uBaseShaderFrame, variables.baseShaderFrame);
    gl.uniform1f(compositeLocations.uMicLevel, variables.micLevel);
    gl.uniform1f(compositeLocations.uSurfaceScale, variables.surfaceScale);
    gl.uniform1f(compositeLocations.uUserSpeakingScale, variables.userSpeakingScale);
    gl.uniform1f(compositeLocations.uConnectionRevealAmount, variables.connectionRevealAmount);
    gl.uniform1f(
      compositeLocations.uPreConnectionDotVisibility,
      variables.preConnectionDotVisibility,
    );
    gl.uniform4fv(
      compositeLocations.uPreConnectionDotColor,
      variables.preConnectionDotColor as unknown as Float32List,
    );
  }

  /**
   * Draw one frame.
   *
   * Returns the interior render-target size so callers can report it without
   * recomputing the scale rule.
   */
  render(variables: HorizonFrameVariables): { width: number; height: number } {
    if (this.disposed) return { width: 0, height: 0 };
    const { gl } = this;

    const bufferWidth = gl.drawingBufferWidth;
    const bufferHeight = gl.drawingBufferHeight;
    const interiorWidth = Math.max(1, Math.floor(bufferWidth * INTERIOR_SCALE));
    const interiorHeight = Math.max(1, Math.floor(bufferHeight * INTERIOR_SCALE));
    this.ensureInteriorSize(interiorWidth, interiorHeight);

    // While the dot is fully visible the composite ignores the interior texture,
    // so the expensive pass is skipped rather than drawn and discarded.
    if (variables.preConnectionDotVisibility < 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.viewport(0, 0, interiorWidth, interiorHeight);
      gl.useProgram(this.interiorProgram);
      this.bindInteriorAttribs();
      this.writeUniformBlock(variables);
      gl.drawArrays(gl.TRIANGLES, 0, VERTEX_COUNT);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bufferWidth, bufferHeight);
    gl.useProgram(this.compositeProgram);
    this.bindCompositeAttribs();
    this.writeCompositeUniforms(variables);
    gl.drawArrays(gl.TRIANGLES, 0, VERTEX_COUNT);

    return { width: interiorWidth, height: interiorHeight };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { gl } = this;
    gl.deleteTexture(this.watercolorTexture);
    gl.deleteTexture(this.interiorTexture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.generatedBuffer);
    gl.deleteBuffer(this.uniformBuffer);
    gl.deleteProgram(this.interiorProgram);
    gl.deleteProgram(this.compositeProgram);
  }
}
