import React, { useEffect, useRef, useState, useCallback } from 'react';
import { registerLipSyncTarget } from './waifu-audio';
import { WaifuEmotion } from './waifu-personas';
import { Sparkles, Heart, RefreshCw } from 'lucide-react';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  type: 'heart' | 'sparkle';
  vx: number;
  vy: number;
  alpha: number;
}

interface Live2DStageProps {
  modelUrl: string;
  fallbackUrl?: string;
  modelName: string;
  emotion: WaifuEmotion;
  particlesEnabled?: boolean;
  onResetModel?: () => void;
}

/**
 * Script loader helper to dynamically inject scripts in strict sequential order.
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (
        existing.dataset.loaded === 'true' ||
        (existing as any).readyState === 'complete' ||
        (existing as any).readyState === 'loaded'
      ) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', (e) => reject(e), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = (e) => {
      script.remove();
      reject(e);
    };
    document.head.appendChild(script);
  });
}

async function loadScriptWithFallback(primarySrc: string, fallbackSrc?: string): Promise<void> {
  try {
    await loadScript(primarySrc);
  } catch (err) {
    if (fallbackSrc) {
      await loadScript(fallbackSrc);
    } else {
      throw err;
    }
  }
}

export const Live2DStage: React.FC<Live2DStageProps> = ({
  modelUrl,
  fallbackUrl,
  modelName,
  emotion,
  particlesEnabled = true,
  onResetModel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);

  const pixiAppRef = useRef<any>(null);
  const live2dModelRef = useRef<any>(null);
  const isDraggingRef = useRef(false);
  const hasUserAdjustedRef = useRef(false);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const modelPosRef = useRef({ x: 0, y: 0 });
  const baseFitScaleRef = useRef(0.35);
  const zoomScaleRef = useRef(0.35);
  const mouthParamsRef = useRef({ openY: 0, form: 0 });
  const mouthIndicesRef = useRef<number[]>([]);
  const formIndicesRef = useRef<number[]>([]);

  const applyMouthToCore = useCallback((openY: number, form: number) => {
    const model = live2dModelRef.current;
    const core = model?.internalModel?.coreModel;
    if (!core) return;
    try {
      const mouthIdxs = mouthIndicesRef.current;
      const formIdxs = formIndicesRef.current;

      // 1. Direct Cubism 4 WebAssembly heap Float32Array write
      if (core.parameters?.values) {
        for (let i = 0; i < mouthIdxs.length; i++) {
          core.parameters.values[mouthIdxs[i]] = openY;
        }
        for (let i = 0; i < formIdxs.length; i++) {
          core.parameters.values[formIdxs[i]] = form;
        }
      }

      // 2. Index-based CoreModel API & array mirror writes
      for (let i = 0; i < mouthIdxs.length; i++) {
        const idx = mouthIdxs[i];
        if (typeof core.setParameterValueByIndex === 'function') {
          core.setParameterValueByIndex(idx, openY, 1);
        }
        if (core._parameterValues) {
          core._parameterValues[idx] = openY;
        }
        if (core._savedParameters && idx < core._savedParameters.length) {
          core._savedParameters[idx] = openY;
        }
      }

      for (let i = 0; i < formIdxs.length; i++) {
        const idx = formIdxs[i];
        if (typeof core.setParameterValueByIndex === 'function') {
          core.setParameterValueByIndex(idx, form, 1);
        }
        if (core._parameterValues) {
          core._parameterValues[idx] = form;
        }
        if (core._savedParameters && idx < core._savedParameters.length) {
          core._savedParameters[idx] = form;
        }
      }

      // 3. Name-based fallback if indices were not cached
      if (mouthIdxs.length === 0) {
        const mouthCandidates = ['ParamMouthOpenY', 'ParamMouthOpen', 'ParamA', 'PARAM_MOUTH_OPEN_Y'];
        for (const id of mouthCandidates) {
          if (typeof core.setParameterValueById === 'function') {
            core.setParameterValueById(id, openY);
          }
        }
      }
      if (formIdxs.length === 0) {
        const formCandidates = ['ParamMouthForm', 'PARAM_MOUTH_FORM'];
        for (const id of formCandidates) {
          if (typeof core.setParameterValueById === 'function') {
            core.setParameterValueById(id, form);
          }
        }
      }

      // 4. Cubism 2 float setter fallback
      if (typeof core.setParamFloat === 'function') {
        core.setParamFloat('PARAM_MOUTH_OPEN_Y', openY);
        core.setParamFloat('PARAM_MOUTH_FORM', form);
      }
    } catch {}
  }, []);

  // Lip-sync target callback
  useEffect(() => {
    registerLipSyncTarget({
      setMouth: (openY, form) => {
        mouthParamsRef.current = { openY, form };
        applyMouthToCore(openY, form);
      },
    });

    return () => {
      registerLipSyncTarget(null);
    };
  }, [applyMouthToCore]);

  // Update expression on emotion change
  useEffect(() => {
    const model = live2dModelRef.current;
    if (!model) return;

    try {
      if (model.internalModel?.motionManager) {
        const emotionMotionMap: Record<WaifuEmotion, string> = {
          happy: 'idle',
          excited: 'tap_body',
          surprised: 'flick_head',
          thoughtful: 'idle',
          sad: 'shake',
          neutral: 'idle',
        };
        const motionGroup = emotionMotionMap[emotion] || 'idle';
        if (typeof model.motion === 'function') {
          void model.motion(motionGroup);
        }
      }
    } catch {}
  }, [emotion]);

  // Clean up PIXI application on unmount
  useEffect(() => {
    return () => {
      if (live2dModelRef.current) {
        try {
          live2dModelRef.current.destroy({ children: true });
        } catch {}
        live2dModelRef.current = null;
      }
      if (pixiAppRef.current) {
        try {
          const app = pixiAppRef.current;
          pixiAppRef.current = null;
          if (app.view && app.view.parentNode) {
            app.view.parentNode.removeChild(app.view);
          }
          app.destroy(false, { children: true });
        } catch {}
      }
    };
  }, []);

  // Adaptive model scale & centering calculation
  const fitAndCenterModel = useCallback((targetModel: any) => {
    if (!targetModel || !containerRef.current) return;
    const container = containerRef.current;
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 800;

    // Read unscaled canvas dimensions
    const rawWidth = targetModel.internalModel?.width || targetModel.width || 2000;
    const rawHeight = targetModel.internalModel?.height || targetModel.height || 2500;

    // Fit model vertically to ~82% of container height
    let fitScale = (h * 0.82) / rawHeight;
    // Constrain wide models so they fit within 85% of container width
    if (rawWidth * fitScale > w * 0.85) {
      fitScale = (w * 0.85) / rawWidth;
    }

    fitScale = Math.max(0.02, Math.min(4.0, fitScale));
    baseFitScaleRef.current = fitScale;
    zoomScaleRef.current = fitScale;

    if (targetModel.anchor && typeof targetModel.anchor.set === 'function') {
      targetModel.anchor.set(0.5, 0.5);
    }

    targetModel.scale.set(fitScale);

    // Center horizontally; place slightly below vertical center for eye-level headroom
    const posX = w / 2;
    const posY = h / 2 + h * 0.04;
    modelPosRef.current = { x: posX, y: posY };
    targetModel.position.set(posX, posY);
  }, []);

  // Auto-resize renderer when container dimensions change
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && pixiAppRef.current) {
          pixiAppRef.current.renderer.resize(width, height);
          if (live2dModelRef.current) {
            if (!hasUserAdjustedRef.current) {
              fitAndCenterModel(live2dModelRef.current);
            } else {
              live2dModelRef.current.position.set(modelPosRef.current.x, modelPosRef.current.y);
            }
          }
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [fitAndCenterModel]);

  // Load and initialize PIXI + Live2D
  useEffect(() => {
    let isCancelled = false;

    async function initPixiLive2D() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const win = window as any;

        // 1. Ensure Cubism 4, Cubism 2, PIXI v5, and pixi-live2d-display are loaded
        if (!win.PIXI?.live2d?.Live2DModel) {
          await loadScriptWithFallback(
            '/live2dcubismcore.min.js',
            'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
          );
          await loadScriptWithFallback(
            '/live2d.min.js',
            'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js'
          );
          await loadScriptWithFallback(
            '/pixi.min.js',
            'https://cdn.jsdelivr.net/npm/pixi.js@5.3.3/dist/pixi.min.js'
          );

          const savedDefine = win.define;
          try {
            if (savedDefine) {
              win.define = undefined;
            }
            await loadScriptWithFallback(
              '/pixi-live2d-display.min.js',
              'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/index.min.js'
            );
          } finally {
            if (savedDefine) {
              win.define = savedDefine;
            }
          }
        }

        if (isCancelled || !containerRef.current) return;

        const PIXI = win.PIXI;
        const Live2DModel = PIXI?.live2d?.Live2DModel;
        if (!PIXI || !Live2DModel) {
          throw new Error('PIXI Live2D plugin failed to initialize');
        }

        // Register ticker with Live2DModel and start shared ticker
        if (typeof Live2DModel.registerTicker === 'function' && PIXI.Ticker) {
          Live2DModel.registerTicker(PIXI.Ticker);
        }
        if (PIXI.Ticker?.shared && !PIXI.Ticker.shared.started) {
          PIXI.Ticker.shared.start();
        }

        // Evict any stale texture cache entries before loading new model
        if (PIXI.utils?.clearTextureCache) {
          try {
            PIXI.utils.clearTextureCache();
          } catch {}
        }

        // 2. Setup PIXI Application with dynamic canvas
        if (!pixiAppRef.current) {
          const container = containerRef.current;
          const width = Math.max(container.clientWidth || 600, 300);
          const height = Math.max(container.clientHeight || 800, 400);

          const app = new PIXI.Application({
            width,
            height,
            transparent: true,
            autoDensity: true,
            resolution: window.devicePixelRatio || 1,
            antialias: true,
            sharedTicker: true,
          });

          app.view.className = 'absolute inset-0 h-full w-full touch-none pointer-events-none';
          container.prepend(app.view);
          pixiAppRef.current = app;
        } else {
          // Verify canvas is still attached
          const app = pixiAppRef.current;
          if (app.view && !containerRef.current.contains(app.view)) {
            containerRef.current.prepend(app.view);
          }
        }

        const app = pixiAppRef.current;

        // Clean previous model without destroying global textures
        if (live2dModelRef.current) {
          app.stage.removeChild(live2dModelRef.current);
          try {
            live2dModelRef.current.destroy({ children: true });
          } catch {}
          live2dModelRef.current = null;
        }

        // 3. Load Live2D Model (with optional fallback CDN)
        let model: any = null;
        try {
          model = await Live2DModel.from(modelUrl, {
            autoInteract: false,
          });
        } catch (primaryErr) {
          if (fallbackUrl && fallbackUrl !== modelUrl) {
            model = await Live2DModel.from(fallbackUrl, {
              autoInteract: false,
            });
          } else {
            throw primaryErr;
          }
        }

        if (isCancelled) {
          model.destroy({ children: true });
          return;
        }

        // Center and scale model adaptively
        hasUserAdjustedRef.current = false;
        fitAndCenterModel(model);

        app.stage.addChild(model);
        live2dModelRef.current = model;

        // Auto-detect and cache mouth & form parameter indices for instantaneous lookup
        try {
          const internal = model.internalModel;
          const core = internal?.coreModel;
          if (core) {
            const ids: string[] =
              core.parameters?.ids ||
              core._parameterIds ||
              [];
            const count =
              core.parameters?.count ??
              (typeof core.getParameterCount === 'function' ? core.getParameterCount() : ids.length);
            const mouthIdxs: number[] = [];
            const formIdxs: number[] = [];

            const lipSyncIds: string[] =
              internal.settings?.getLipSyncParameters?.() ||
              internal.motionManager?.lipSyncIds ||
              internal.settings?.groups?.find((g: any) => g.Name === 'LipSync' || g.name === 'LipSync')?.Ids ||
              [];

            for (let i = 0; i < count; i++) {
              const id = ids[i] || (typeof core.getParameterId === 'function' ? core.getParameterId(i) : '');
              if (
                lipSyncIds.includes(id) ||
                id === 'ParamMouthOpenY' ||
                id === 'ParamMouthOpen' ||
                id === 'ParamA' ||
                id === 'PARAM_MOUTH_OPEN_Y'
              ) {
                mouthIdxs.push(i);
              }
              if (id === 'ParamMouthForm' || id === 'PARAM_MOUTH_FORM') {
                formIdxs.push(i);
              }
            }

            mouthIndicesRef.current = mouthIdxs;
            formIndicesRef.current = formIdxs;
          }
        } catch {}

        // Enable autoUpdate so internal ticker drives animations
        try {
          model.autoUpdate = true;
        } catch {}

        // Immediately update first frame to ensure vertex/draw order tables are primed
        if (typeof model.update === 'function') {
          model.update(16.6);
        }

        // Ensure mouth parameters are applied right before vertex update AND right before parameter save
        if (model.internalModel?.on) {
          model.internalModel.on('beforeModelUpdate', () => {
            const { openY, form } = mouthParamsRef.current;
            applyMouthToCore(openY, form);
          });
          model.internalModel.on('afterMotionUpdate', () => {
            const { openY, form } = mouthParamsRef.current;
            applyMouthToCore(openY, form);
          });
        }

        // Safety ticker hook: guarantees model frame update and applies mouth parameter per frame
        if (!app._waifuTickerHookAttached) {
          app._waifuTickerHookAttached = true;
          app.ticker.add((delta: number) => {
            const current = live2dModelRef.current;
            if (current && !current._destroyed) {
              const { openY, form } = mouthParamsRef.current;
              applyMouthToCore(openY, form);
              if (!current.autoUpdate && !current.deltaTime) {
                current.update(delta * 16.6);
              }
            }
          });
        }

        // Force immediate render
        app.render();

        setIsLoading(false);
      } catch (err: any) {
        if (!isCancelled) {
          setLoadError(err?.message || 'Could not load character model');
          setIsLoading(false);
        }
      }
    }

    void initPixiLive2D();

    return () => {
      isCancelled = true;
    };
  }, [modelUrl, fallbackUrl, retryCount, fitAndCenterModel]);

  // Handle pointer tracking & eye movement
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!containerRef.current || !live2dModelRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // Head tracking focus
    const model = live2dModelRef.current;
    try {
      if (typeof model.focus === 'function') {
        model.focus(clientX, clientY);
      }
    } catch {}

    // Drag model positioning
    if (isDraggingRef.current) {
      hasUserAdjustedRef.current = true;
      const dx = clientX - dragStartPosRef.current.x;
      const dy = clientY - dragStartPosRef.current.y;
      dragStartPosRef.current = { x: clientX, y: clientY };

      modelPosRef.current = {
        x: modelPosRef.current.x + dx,
        y: modelPosRef.current.y + dy,
      };
      model.position.set(modelPosRef.current.x, modelPosRef.current.y);
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      dragStartPosRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    // Spawn click/pet particles
    if (particlesEnabled && rect) {
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const count = 5 + Math.floor(Math.random() * 4);
      const newP: Particle[] = [];
      const colors = ['#f43f5e', '#ec4899', '#a855f7', '#fbbf24', '#38bdf8'];

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5);
        const speed = 2 + Math.random() * 3;
        newP.push({
          id: Math.random(),
          x: px,
          y: py,
          size: 14 + Math.random() * 8,
          color: colors[Math.floor(Math.random() * colors.length)],
          type: Math.random() > 0.4 ? 'heart' : 'sparkle',
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          alpha: 1.0,
        });
      }
      setParticles((prev) => [...prev, ...newP]);
    }

    // Trigger tap motion
    const model = live2dModelRef.current;
    if (model && typeof model.motion === 'function') {
      try {
        model.motion('tap_body');
      } catch {}
    }
  }, [particlesEnabled]);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Wheel zoom proportional to model's adaptive scale
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const model = live2dModelRef.current;
    if (!model) return;

    hasUserAdjustedRef.current = true;
    const base = baseFitScaleRef.current || 0.35;
    const step = base * 0.08;
    const zoomDelta = e.deltaY < 0 ? step : -step;
    const minScale = base * 0.35;
    const maxScale = base * 3.0;
    const newScale = Math.max(minScale, Math.min(maxScale, zoomScaleRef.current + zoomDelta));
    zoomScaleRef.current = newScale;
    model.scale.set(newScale);
  }, []);

  // Double click to re-center character
  const handleDoubleClick = useCallback(() => {
    hasUserAdjustedRef.current = false;
    if (live2dModelRef.current) {
      fitAndCenterModel(live2dModelRef.current);
    }
  }, [fitAndCenterModel]);

  // Particles animation loop
  useEffect(() => {
    if (particles.length === 0) return;
    const interval = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            alpha: p.alpha - 0.04,
          }))
          .filter((p) => p.alpha > 0)
      );
    }, 24);

    return () => clearInterval(interval);
  }, [particles.length]);

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      className="relative flex h-full w-full select-none items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
    >
      {/* Floating Particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="pointer-events-none absolute"
          style={{
            left: `${p.x}px`,
            top: `${p.y}px`,
            opacity: p.alpha,
            transform: 'translate(-50%, -50%)',
            color: p.color,
          }}
        >
          {p.type === 'heart' ? (
            <Heart size={p.size} fill={p.color} />
          ) : (
            <Sparkles size={p.size} />
          )}
        </div>
      ))}

      {/* Loading Spinner */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-500/20 text-pink-400 animate-pulse">
            <Sparkles className="h-6 w-6 animate-spin" />
          </div>
          <span className="mt-3 text-xs font-medium tracking-wide text-zinc-300">
            Summoning {modelName}...
          </span>
        </div>
      )}

      {/* Error Fallback */}
      {loadError && (
        <div className="absolute inset-x-6 top-6 z-30 flex flex-col items-center justify-center rounded-xl bg-red-500/10 p-4 border border-red-500/20 text-center backdrop-blur-md">
          <span className="text-xs font-semibold text-red-400">Model Loading Error</span>
          <span className="mt-1 text-[11px] text-zinc-400">{loadError}</span>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="flex items-center gap-1.5 rounded-lg bg-pink-500/20 px-3 py-1.5 text-xs font-medium text-pink-300 hover:bg-pink-500/30 transition-colors"
            >
              <RefreshCw size={12} />
              Try Again
            </button>
            {onResetModel && (
              <button
                onClick={onResetModel}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10 transition-colors"
              >
                Switch to Default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
