import type React from 'react';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';
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
 *
 * Every stylesheet reads these through `var(…, <the measured Gemini blue>)`, so
 * an unthemed render is byte-identical to what the fidelity harness in
 * `tools/ui-research/scrapers/spark/` was written against.
 *
 * There is no single themed host over all of Spark — `SparkWorkspace` returns
 * Home, Schedules, Skills and Apps without the `wrapConnectedPage` shell — so
 * each page root declares these itself.
 */
export const sparkAccentVars = (workspaceColor?: string | null, isLight?: boolean): React.CSSProperties => {
  const theme = getWorkspaceTheme(workspaceColor);
  const resolvedIsLight = isLight ?? (
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('light-theme') || document.documentElement.getAttribute('data-theme') === 'light'
      : false
  );

  const primaryBtnBg = resolvedIsLight ? (theme.id === 'blue' || !workspaceColor ? '#9dd2ff' : theme.sendButton.lightBg) : theme.sendButton.bg;
  const primaryBtnHover = resolvedIsLight ? (theme.id === 'blue' || !workspaceColor ? '#8ec7f7' : theme.sendButton.lightHover) : theme.sendButton.hover;
  const glowLight = theme.id === 'blue' || !workspaceColor ? 'rgb(157, 210, 255)' : theme.glowAccentLight;

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
  } as React.CSSProperties;
};

/** `sparkAccentVars` for the signed-in user's workspace colour. */
export const useSparkAccentVars = (): React.CSSProperties => {
  const { userProfile } = useAuth();
  const { isLight } = useThemeMode();
  return sparkAccentVars(userProfile?.workspaceColor, isLight);
};
