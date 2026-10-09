import type React from 'react';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme, type WorkspaceComputedTheme } from '@willow/core/workspace-theme';
import { useThemeMode } from '@willow/core/theme-mode';

/*
 * Spark's accent, from the workspace colour.
 *
 * Spark was transcribed from Gemini, so its accents came across as Gemini's
 * literal blues — `#1f3b9b` on the primary buttons, `#3186ff` on the suggested-
 * row indicator and inside the working-spark animation. Those are correct for a
 * blue workspace and wrong for the other eight.
 *
 * Each variable maps to the theme token that already plays that role elsewhere
 * in the app, so a green workspace gets Spark's buttons in the same green as the
 * composer's send button rather than an independently invented green:
 *
 *   --spark-accent         sendButton.bg     filled CTA, and the indicator at rest
 *   --spark-accent-hover   sendButton.hover  that CTA's hover
 *   --spark-accent-bright  creamy.hex        the pastel Spark lifts to — the
 *                                            indicator on hover, the working glyph
 *   --spark-task-detail-accent  glowAccent   the prompt-box glow and the wide
 *                                            background wash behind it
 *   --spark-tonal-bg / -text   notice       Gemini's tonal (secondary-container)
 *                                            buttons: the remote browser's "Take
 *                                            over task" and "Go back to Willow"
 *
 * Every stylesheet reads these through `var(…, <the measured Gemini blue>)`, so
 * an unthemed render is byte-identical to what the fidelity harness in
 * `tools/ui-research/scrapers/spark/` was written against.
 *
 * There is no single themed host over all of Spark — `SparkWorkspace` returns
 * Home, Schedules, Skills and Apps without the `wrapConnectedPage` shell — so
 * each page root declares these itself.
 */
export const sparkAccentVars = (workspaceColor?: string | null, isLight?: boolean): React.CSSProperties =>
  sparkAccentVarsFor(getWorkspaceTheme(workspaceColor), !workspaceColor, isLight);

/**
 * `sparkAccentVars` for a theme already in hand — a bot's, from its own colour. With `geminiBlue`, or a blue theme,
 * the light theme keeps Gemini's measured blues, as an unset workspace colour does.
 */
export const sparkAccentVarsFor = (theme: WorkspaceComputedTheme, geminiBlue = false, isLight?: boolean): React.CSSProperties => {
  const resolvedIsLight = isLight ?? (
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('light-theme') || document.documentElement.getAttribute('data-theme') === 'light'
      : false
  );

  const isBlue = theme.id === 'blue' || geminiBlue;
  const primaryBtnBg = resolvedIsLight ? (isBlue ? '#9dd2ff' : theme.sendButton.lightBg) : theme.sendButton.bg;
  const primaryBtnHover = resolvedIsLight ? (isBlue ? '#8ec7f7' : theme.sendButton.lightHover) : theme.sendButton.hover;
  const glowLight = isBlue ? 'rgb(157, 210, 255)' : theme.glowAccentLight;
  // Blue keeps Gemini's measured secondary container; other colours take the
  // notice callout's tonal pair, which is derived the same way for every colour.
  const tonalBg = resolvedIsLight ? (isBlue ? '#c2e7ff' : theme.toggle.track) : (isBlue ? '#004a77' : theme.notice.bg);
  const tonalText = resolvedIsLight ? (isBlue ? '#001d35' : theme.toggle.thumb) : (isBlue ? '#c2e7ff' : theme.notice.text);

  return {
    '--spark-accent': primaryBtnBg,
    '--spark-accent-hover': primaryBtnHover,
    '--spark-accent-bright': resolvedIsLight ? '#000000' : theme.creamy.hex,
    '--spark-task-detail-accent': resolvedIsLight ? glowLight : theme.glowAccent,
    '--spark-home-glow': resolvedIsLight ? glowLight : theme.glowAccent,
    '--spark-notice-bg': theme.notice.bg,
    '--spark-notice-text': theme.notice.text,
    '--spark-toggle-track': theme.toggle.track,
    '--spark-toggle-thumb': theme.toggle.thumb,
    '--spark-accent-btn-bg': primaryBtnBg,
    '--spark-accent-btn-hover': primaryBtnHover,
    '--spark-accent-btn-text': resolvedIsLight ? '#000000' : '#ffffff',
    '--spark-tonal-bg': tonalBg,
    '--spark-tonal-text': tonalText,
  } as React.CSSProperties;
};

/** `sparkAccentVars` for the workspace colour on screen, signed in or out. */
export const useSparkAccentVars = (): React.CSSProperties => {
  const { workspaceColor } = useAuth();
  const { isLight } = useThemeMode();
  return sparkAccentVars(workspaceColor, isLight);
};
