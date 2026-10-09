// Flow's `flow-character-ingredient-preview`: the card a character ingredient shows above itself
// on hover. Its portrait at 200px in a 4px frame, and in the corner how many images the character
// has (and a voice row when it has one).
import React from 'react';
import { FlowIcon } from '../scenes/flow-ui';
import './characters.css';

export const CharacterIngredientCard: React.FC<{
  thumbnail?: string;
  imageCount: number;
  hasVoice: boolean;
}> = ({ thumbnail, imageCount, hasVoice }) => (
  <div className="cp-ingredient-card">
    <div className="cp-ingredient-card__image-box">
      {thumbnail ? (
        <img className="cp-ingredient-card__image" src={thumbnail} alt="" />
      ) : (
        <div className="cp-ingredient-card__placeholder"><FlowIcon name="face" size={40} /></div>
      )}
      {(imageCount > 0 || hasVoice) && (
        <div className="cp-ingredient-card__counts">
          {imageCount > 0 && (
            <div className="cp-ingredient-card__count" aria-label={`${imageCount} images`}>
              <FlowIcon name="image" size={16} />
              <span className="cp-ingredient-card__count-text">{imageCount}</span>
            </div>
          )}
          {hasVoice && (
            <div className="cp-ingredient-card__count" aria-label="1 voice">
              <FlowIcon name="voice_selection" size={16} />
              <span className="cp-ingredient-card__count-text">1</span>
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);
