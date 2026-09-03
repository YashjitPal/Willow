import type React from 'react';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';

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
export const sparkAccentVars = (workspaceColor?: string | null): React.CSSProperties => {
  const theme = getWorkspaceTheme(workspaceColor);
  return {
    '--spark-accent': theme.sendButton.bg,
    '--spark-accent-hover': theme.sendButton.hover,
    '--spark-accent-bright': theme.creamy.hex,
    '--spark-task-detail-accent': theme.glowAccent,
  } as React.CSSProperties;
};

/** `sparkAccentVars` for the signed-in user's workspace colour. */
export const useSparkAccentVars = (): React.CSSProperties => {
  const { userProfile } = useAuth();
  return sparkAccentVars(userProfile?.workspaceColor);
};
