/**
 * Willow Figma — canvas host: owns the <canvas>, the rAF paint loop
 * (scene → overlays), DPR/resize handling, pointer/wheel/keyboard wiring
 * into the InteractionEngine, and the DOM overlays (text editing, comments,
 * multiplayer cursors).
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '../../lib/store';
import type { InteractionEngine, PointerEventLike } from '../../lib/contracts';
import type { Vec2 } from '../../lib/types';
import { screenToWorld } from '../../lib/geometry';
import { createImageCache, renderScene } from './render';
import { renderOverlays } from './overlays';
import { createInteractionEngine } from './interactions';
import { TextEditorOverlay } from './TextEditorOverlay';
import { CommentsOverlay } from './CommentsOverlay';
import { CursorsOverlay } from './CursorsOverlay';

interface CanvasHostProps {
  engineRef: React.MutableRefObject<InteractionEngine | null>;
  onContextMenu: (screen: Vec2, world: Vec2) => void;
}

export const CanvasHost: React.FC<CanvasHostProps> = ({ engineRef, onContextMenu }) => {
  const store = useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dirtyRef = useRef(true);

  const images = useMemo(() => createImageCache(() => store.requestRepaint()), [store]);

  // Interaction engine lifecycle.
  useEffect(() => {
    const engine = createInteractionEngine(store);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [engineRef, store]);

  // Paint loop: repaint at most once per frame, only when dirty.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      store.viewport = { w: width, h: height };
      engineRef.current?.setViewport(width, height);
      dirtyRef.current = true;
    };

    const paint = () => {
      rafRef.current = requestAnimationFrame(paint);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const s = store.state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderScene(ctx, s.doc, s.currentPageId, s.camera, {
        dpr,
        viewportW: width,
        viewportH: height,
        showPixelGrid: s.showPixelGrid,
        images,
        skip: s.editingTextId ? new Set([s.editingTextId]) : undefined,
        frameLabels: true,
        selection: new Set(s.selection),
      });
      renderOverlays(ctx, { store, viewportW: width, viewportH: height, dpr });
    };

    const markDirty = () => {
      dirtyRef.current = true;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const unsubscribe = store.onRepaint(markDirty);
    rafRef.current = requestAnimationFrame(paint);

    return () => {
      observer.disconnect();
      unsubscribe();
      cancelAnimationFrame(rafRef.current);
    };
  }, [engineRef, images, store]);

  // Wheel must be non-passive to preventDefault (browser zoom/scroll).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      engineRef.current?.onWheel(e, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [engineRef]);

  const toPointerLike = (e: React.PointerEvent | React.MouseEvent): PointerEventLike => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      clientX: e.clientX,
      clientY: e.clientY,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      button: 'button' in e ? e.button : 0,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden" style={{ background: '#1e1e1e' }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: 'default', touchAction: 'none' }}
        onPointerDown={(e) => {
          if (e.button === 2) return; // context menu path
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          canvasRef.current?.focus();
          engineRef.current?.onPointerDown(toPointerLike(e));
          syncCursor(canvasRef.current, engineRef.current);
        }}
        onPointerMove={(e) => {
          engineRef.current?.onPointerMove(toPointerLike(e));
          syncCursor(canvasRef.current, engineRef.current);
        }}
        onPointerUp={(e) => {
          engineRef.current?.onPointerUp(toPointerLike(e));
          syncCursor(canvasRef.current, engineRef.current);
        }}
        onDoubleClick={(e) => engineRef.current?.onDoubleClick(toPointerLike(e))}
        onContextMenu={(e) => {
          e.preventDefault();
          const rect = canvasRef.current!.getBoundingClientRect();
          const screen = { x: e.clientX, y: e.clientY };
          const canvasPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          onContextMenu(screen, screenToWorld(store.state.camera, canvasPoint));
        }}
        tabIndex={0}
      />
      <CursorsOverlay />
      <CommentsOverlay />
      <TextEditorOverlay />
    </div>
  );
};

function syncCursor(canvas: HTMLCanvasElement | null, engine: InteractionEngine | null): void {
  if (!canvas || !engine) return;
  const cursor = engine.getCursor();
  if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
}
