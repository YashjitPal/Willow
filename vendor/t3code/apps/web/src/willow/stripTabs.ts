/**
 * The side panel's tabs in Willow's strip, the bar across its desktop window: drawn there over the
 * panel, up to the window buttons, instead of in the panel's own row (RightPanelTabs.tsx). This
 * page reports them and acts on what is done to them there. The strip has none of Willow's icon
 * fonts, so a tab's glyph travels as a PNG mask the strip fills with its own text colour.
 */
import { useEffect, useRef, useState } from "react";

import type { WillowPanelTab, WillowPanelTabAction } from "./bridge";

/** Whether Willow's desktop app draws the side panel's tabs in its strip. */
export const willowHostsPanelTabs = (): boolean =>
  typeof window !== "undefined" && window.__WILLOW_AGENTS__?.init.stripTabs === true;

const MASK_FONT = "Material Symbols Rounded";
const MASK_SIZE = 32;
const masks = new Map<string, string>();

/** A glyph of Willow's icon font as a PNG mask, or nothing while the font has not loaded. */
function glyphMask(glyph: string): string | undefined {
  const cached = masks.get(glyph);
  if (cached) return cached;
  const font = `300 ${MASK_SIZE}px "${MASK_FONT}"`;
  if (!document.fonts.check(font, glyph)) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = MASK_SIZE;
  canvas.height = MASK_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.font = font;
  // A ligature not in the font draws its name, far wider than the glyph.
  if (context.measureText(glyph).width > MASK_SIZE * 1.5) return undefined;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, MASK_SIZE / 2, MASK_SIZE / 2);
  const mask = canvas.toDataURL("image/png");
  masks.set(glyph, mask);
  return mask;
}

/** A tab as the panel knows it: its glyph by name, which goes to the strip as a mask. */
export interface StripTab extends Omit<WillowPanelTab, "mask"> {
  glyph?: string;
}

/**
 * Reports the panel's tabs to Willow's strip while `enabled`, from the left edge of `panel` (the
 * panel's row), and hands what is done to them there to `onAction`. Sets
 * `--willow-panel-controls-width` on the panel for its bar, which moves up beside the controls.
 */
export function useWillowStripTabs({
  enabled,
  panel,
  tabs,
  add,
  onAction,
}: {
  enabled: boolean;
  panel: HTMLElement | null;
  tabs: readonly StripTab[];
  add: boolean;
  onAction: (action: WillowPanelTabAction) => void;
}): void {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const [fontsLoaded, setFontsLoaded] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const loaded = () => setFontsLoaded((count) => count + 1);
    document.fonts.addEventListener("loadingdone", loaded);
    return () => document.fonts.removeEventListener("loadingdone", loaded);
  }, [enabled]);

  useEffect(() => {
    const embed = window.__WILLOW_AGENTS__;
    if (!embed || !enabled || !panel) return;
    const reported = tabs.map(({ glyph, ...tab }): WillowPanelTab => {
      const mask = glyph ? glyphMask(glyph) : undefined;
      return mask ? { ...tab, mask } : tab;
    });
    const report = () => {
      const box = panel.getBoundingClientRect();
      panel.parentElement?.style.setProperty("--willow-panel-controls-width", `${box.width}px`);
      embed.reportPanelTabs({
        left: panel.parentElement?.getBoundingClientRect().left ?? box.left,
        tabs: reported,
        add,
      });
    };
    report();
    // The panel slides and resizes; its edge is measured again as it settles.
    const frame = requestAnimationFrame(report);
    const observer = new ResizeObserver(report);
    observer.observe(panel);
    if (panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener("resize", report);
    panel.parentElement?.addEventListener("transitionend", report);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", report);
      panel.parentElement?.removeEventListener("transitionend", report);
    };
  }, [enabled, panel, tabs, add, fontsLoaded]);

  // Only when the panel goes are the strip's tabs taken away, not between two reports.
  useEffect(() => {
    if (!enabled) return;
    return () => window.__WILLOW_AGENTS__?.reportPanelTabs(null);
  }, [enabled]);

  useEffect(() => {
    const embed = window.__WILLOW_AGENTS__;
    if (!embed || !enabled) return;
    return embed.onPanelTab((action) => onActionRef.current(action));
  }, [enabled]);
}
