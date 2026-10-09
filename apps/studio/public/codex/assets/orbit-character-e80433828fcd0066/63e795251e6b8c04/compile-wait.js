/*
 * Willow addition to the Codex character frame, loaded before frame.mjs.
 *
 * The engine enables KHR_parallel_shader_compile but asks for COMPILE_STATUS and
 * LINK_STATUS straight after compiling and linking. Chrome answers those on the
 * GPU process's main thread, which then waits for the compile to finish; on
 * Windows (ANGLE on Direct3D 11) the engine's shaders take tens of seconds on a
 * cold shader cache, and every tab stops painting meanwhile, because the same
 * thread composites them all. Polling COMPLETION_STATUS_KHR first keeps the
 * compile on ANGLE's worker threads; the status query that follows returns at
 * once. The engine still gets the real answers, in the same order.
 *
 * While it waits, the frame cannot run anything else, so it posts
 * `orbit-character-progress` once a second: the page's renderer timeout counts
 * from the last one, which tells a slow first boot from a hung renderer.
 */
(() => {
  const proto = WebGL2RenderingContext.prototype;
  const COMPLETION_STATUS_KHR = 0x91b1;
  const POLL_INTERVAL_MS = 4;
  const GIVE_UP_MS = 180000;
  const contexts = new WeakSet();
  const { getExtension, getShaderParameter, getProgramParameter, getShaderInfoLog } = proto;

  let lastProgress = 0;
  const reportProgress = () => {
    const now = performance.now();
    if (now - lastProgress < 1000) return;
    lastProgress = now;
    window.parent.postMessage({ type: "orbit-character-progress" }, location.origin);
  };

  /** `complete` is `null` once the object is gone, which ends the wait like a finished compile. */
  const waitUntil = (complete) => {
    const giveUpAt = performance.now() + GIVE_UP_MS;
    while (complete() === false && performance.now() < giveUpAt) {
      const resumeAt = performance.now() + POLL_INTERVAL_MS;
      while (performance.now() < resumeAt);
      reportProgress();
    }
  };
  const waitForShader = (gl, shader) => {
    if (shader != null && contexts.has(gl)) waitUntil(() => getShaderParameter.call(gl, shader, COMPLETION_STATUS_KHR));
  };
  const waitForProgram = (gl, program) => {
    if (program != null && contexts.has(gl)) waitUntil(() => getProgramParameter.call(gl, program, COMPLETION_STATUS_KHR));
  };

  proto.getExtension = function (name) {
    const extension = getExtension.call(this, name);
    if (extension != null && name === "KHR_parallel_shader_compile") contexts.add(this);
    return extension;
  };
  proto.getShaderParameter = function (shader, pname) {
    if (pname !== COMPLETION_STATUS_KHR) waitForShader(this, shader);
    return getShaderParameter.call(this, shader, pname);
  };
  proto.getShaderInfoLog = function (shader) {
    waitForShader(this, shader);
    return getShaderInfoLog.call(this, shader);
  };
  proto.getProgramParameter = function (program, pname) {
    if (pname !== COMPLETION_STATUS_KHR) waitForProgram(this, program);
    return getProgramParameter.call(this, program, pname);
  };
  for (const name of [
    "getProgramInfoLog",
    "getUniformLocation",
    "getAttribLocation",
    "getActiveUniform",
    "getActiveAttrib",
    "getUniformBlockIndex",
    "getActiveUniformBlockParameter",
    "getActiveUniformBlockName",
    "getActiveUniforms",
    "getUniformIndices",
    "getFragDataLocation",
    "getTransformFeedbackVarying",
  ]) {
    const query = proto[name];
    if (typeof query !== "function") continue;
    proto[name] = function (program, ...rest) {
      waitForProgram(this, program);
      return query.call(this, program, ...rest);
    };
  }
})();
