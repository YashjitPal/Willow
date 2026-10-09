import { useEffect, useSyncExternalStore } from "react";
import { getCharacterFrameUrl } from "./character-frame";

/**
 * Compiles the character engine's shader programs in the background, once per page load, before a character frame
 * needs them. Chrome keeps compiled programs for the rest of the browser session and reuses them in every later
 * context, so a frame then boots in seconds instead of compiling them itself, which takes the better part of a minute
 * on Windows (one program alone takes about 30 s). `shader-programs.json` next to the frame is a recording of what
 * this engine build links. KHR_parallel_shader_compile keeps the work on the GPU process's worker threads; without it,
 * compiling here would stall every tab, so nothing is compiled and frames boot as before.
 */
interface RecordedPrograms {
  extensions: string[];
  programs: { shaders: { type: number; source: string }[] }[];
}

const COMPLETION_STATUS_KHR = 0x91b1;
const POLL_INTERVAL_MS = 100;

let prewarm: Promise<void> | null = null;
let warm = false;
const listeners = new Set<() => void>();
/**
 * The compile context and its programs live as long as the page. Destroying a context that holds these programs,
 * by `loseContext()` or by garbage collection, stalls Chrome's GPU process (every tab) for a few seconds.
 */
let compiled: { gl: WebGL2RenderingContext; programs: WebGLProgram[] } | null = null;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function compileRecordedPrograms() {
  const response = await fetch(new URL("shader-programs.json", new URL(getCharacterFrameUrl(), window.location.origin)));
  if (!response.ok) return;
  const recorded = (await response.json()) as RecordedPrograms;
  const gl = document.createElement("canvas").getContext("webgl2");
  if (gl == null || gl.getExtension("KHR_parallel_shader_compile") == null) return;
  for (const name of recorded.extensions) gl.getExtension(name);
  const programs = recorded.programs.map(({ shaders }) => {
    const program = gl.createProgram();
    for (const { type, source } of shaders) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    return program;
  });
  compiled = { gl, programs };
  for (const program of programs) {
    while (gl.getProgramParameter(program, COMPLETION_STATUS_KHR) === false) await wait(POLL_INTERVAL_MS);
  }
}

/** Starts the background compile; resolves once it has finished, or could not run. */
export function prewarmCharacterShaders(): Promise<void> {
  prewarm ??= compileRecordedPrograms()
    .catch(() => {})
    .finally(() => {
      warm = true;
      for (const listener of listeners) listener();
    });
  return prewarm;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const isWarm = () => warm;

/** Starts the background compile once the page is idle, for views that show characters soon. */
export function usePrewarmCharacterShaders() {
  useEffect(() => {
    const handle = requestIdleCallback(() => void prewarmCharacterShaders(), { timeout: 3000 });
    return () => cancelIdleCallback(handle);
  }, []);
}

/** Whether character frames may boot: once the background compile has finished, so they reuse its programs. */
export function useCharacterShadersWarm() {
  useEffect(() => {
    void prewarmCharacterShaders();
  }, []);
  return useSyncExternalStore(subscribe, isWarm, isWarm);
}
