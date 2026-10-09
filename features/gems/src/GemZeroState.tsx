import React from 'react';

import './gems.css';
import { GemLogo, type GemLogoSpec } from './GemLogo';

/**
 * A Gem's chat before its first message — Gemini's `bot-info-card`, measured on
 * `/gem/brainstormer` and on a custom Gem at 1536x826: a 62px logo, the name at 30px/36px
 * with the Experiment badge after it, the description at 15px/20px, then (premade Gems
 * only) a sideways-scrolling row of 170px prompt cards. Centred in the thread area while
 * the composer stays docked. The editor's preview renders the same card.
 */
export const GemZeroState: React.FC<{
  logo: GemLogoSpec;
  name: string;
  description?: string;
  experiment?: boolean;
  starters?: readonly string[];
  onStarter?: (prompt: string) => void;
}> = ({ logo, name, description, experiment, starters, onStarter }) => (
  <div className="gems-surface gem-zero">
    <div className="gem-zero-card">
      <div className="gem-zero-info">
        <GemLogo spec={logo} size={62} />
        <div className="gem-zero-name">
          <span className="gem-zero-name-text">{name}</span>
          {experiment && <span className="gems-experiment-badge">Experiment</span>}
        </div>
        {description && <div className="gem-zero-description">{description}</div>}
      </div>
      {!!starters?.length && (
        <div className="gem-zero-starters">
          {starters.map((prompt) => (
            <button key={prompt} type="button" className="gem-zero-starter" onClick={() => onStarter?.(prompt)}>
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
);
