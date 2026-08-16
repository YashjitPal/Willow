import React from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';

import './notebooks.css';

/**
 * The first-run splash — Gemini's `project-splash-screen.notebook-migration`.
 *
 * This is what `/notebooks/view` shows an account that has **never** created a
 * notebook. It is a different surface from the card grid, not an empty variant of
 * it, so it lives in its own component and `AllNotebooksPage` switches on count.
 *
 * Measured on a fresh account at a 1248px content width:
 *
 *   project-splash-screen      flex column, centred both axes, full height
 *   .splash-container          585 wide, gap 28, text-align center
 *   .splash-title-container    420 wide, gap 8
 *   .notebook-icon             28px glyph, opsz 28 / wght 260, transform scale(2)
 *   h1.title                   32px/44px w320, ROND 100
 *   p.subtitle                 18px/24px w470, rgb(196,199,197), ONE line
 *   .features-grid             flex, gap 60, justify center, 585 wide
 *   .feature-item              block, padding 16px 0, text-align center
 *   .feature-icon-container    48x48 circle, bg rgb(23,23,23)
 *   h3.feature-title           15px/20px w400, margin-top 12
 *   .create-button             wrapper padding 0 32px; button h48, bg rgb(31,59,155)
 *   .notebook-footer           flex, padding 16, disclaimer max-width 1000
 *
 * Two details are easy to get wrong:
 *
 *  • The heading glyph is **28px scaled 2×**, not a 56px glyph. Its variable font
 *    is pinned to `opsz 28`, so rendering at 56px directly picks a different
 *    optical size and the stroke weight comes out visibly heavier.
 *  • The three feature icons do **not** share a font. `forum` is Google Symbols;
 *    `note_stack` and `rule` are Luminous. Reading the row as one set and picking
 *    one family leaves a blank box where the odd one out is.
 *
 * The subtitle's separator is a literal `|` in the text — "Level up your projects
 * | Powered by …" is a single 420px line (285px of text plus a 135px logo).
 *
 * ADAPTED, NOT COPIED — two places, both deliberate:
 *
 *  1. Gemini closes the subtitle with the **Gemini Notebook wordmark** (an inline
 *     135x27 SVG). Willow is not powered by Google's product, so the slot holds
 *     Willow's own name at the same size and weight; the line metrics are
 *     unchanged. Swap `POWERED_BY` if you want something else there.
 *  2. Gemini's disclaimer makes specific claims about Google's model training,
 *     Keep activity, and its privacy notice, and links to Google support pages.
 *     Reproducing that verbatim would state things about Willow that are not
 *     true, so the paragraph is Willow's own at the same length, position, and
 *     type scale, with the same three-link shape. Edit `DISCLAIMER` freely.
 */
export interface NotebooksSplashScreenProps {
  onGetStarted: () => void;
}

/** The trailing lockup in the subtitle. See the "ADAPTED" note above. */
const POWERED_BY = 'Willow';

const FEATURES: ReadonlyArray<{ icon: string; family: 'luminous' | 'google-symbols'; title: string }> = [
  // `forum` is the one Google Symbols glyph in the row.
  { icon: 'forum', family: 'google-symbols', title: 'Group chats by topic' },
  { icon: 'note_stack', family: 'luminous', title: 'Upload up to 50 sources' },
  { icon: 'rule', family: 'luminous', title: 'Set custom instructions' },
];

const DISCLAIMER = (
  <>
    Notebooks group your chats by topic and keep their sources together. Files you add as a source stay
    in your own workspace — Willow does not send them anywhere you have not connected yourself. Chats
    inside a notebook are saved with the rest of your{' '}
    <a className="nb-splash-link" href="/saved-info">
      saved activity
    </a>
    , and you can remove a notebook or any of its sources at any time from{' '}
    <a className="nb-splash-link" href="/notebooks/view">
      All notebooks
    </a>
    . You can still add sources to a notebook even if activity saving is off.{' '}
    <a className="nb-splash-link" href="/connected-apps">
      Learn more
    </a>
    .
  </>
);

export const NotebooksSplashScreen: React.FC<NotebooksSplashScreenProps> = ({ onGetStarted }) => {
  const { userProfile } = useAuth();
  const theme = getWorkspaceTheme(userProfile?.workspaceColor);

  return (
    <div
      className="nb-surface nb-splash-host"
      style={{
        '--nb-accent-btn-bg': theme.sendButton.bg,
        '--nb-accent-btn-hover': theme.sendButton.hover,
        '--nb-link-color': theme.creamy.hex,
      } as React.CSSProperties}
    >
    <div className="nb-splash-container">
      <div className="nb-splash-title-container">
        {/*
         * 28px glyph at scale(2) — see the note above on why this is not a 56px
         * glyph. `nb-splash-icon` owns the transform so the box stays 28px and
         * the flex gap above/below measures from the unscaled box, exactly as
         * Gemini's does.
         */}
        <span className="nb-splash-icon">
          <MaterialSymbol
            name="notebook"
            family="luminous"
            size={28}
            weight={260}
            roundness={100}
            opticalSize={28}
            className="text-[#e6e6e6]"
          />
        </span>

        <h1 className="nb-splash-title">Introducing notebooks</h1>

        {/* Single line. The pipe is literal, not a separator element. */}
        <p className="nb-splash-subtitle">
          Level up your projects | Powered by <span className="nb-splash-poweredby">{POWERED_BY}</span>
        </p>
      </div>

      <div className="nb-splash-features">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="nb-splash-feature">
            <div className="nb-splash-feature-icon">
              <MaterialSymbol
                name={feature.icon}
                family={feature.family}
                size={24}
                weight={300}
                roundness={100}
                opticalSize={24}
                className="text-[#e3e3e3]"
              />
            </div>
            <h3 className="nb-splash-feature-title">{feature.title}</h3>
          </div>
        ))}
      </div>

      <div className="nb-splash-cta">
        <button type="button" onClick={onGetStarted} className="nb-splash-button">
          <MaterialSymbol name="add" family="luminous" size={24} weight={300} roundness={100} opticalSize={24} />
          <span className="nb-splash-button-label">Getting started</span>
        </button>
      </div>
    </div>

    <div className="nb-splash-footer">
      <p className="nb-splash-disclaimer">{DISCLAIMER}</p>
    </div>
    </div>
  );
};
