// Flow's `flow-character-prompt-box`: the base prompt box with a Format chip and the model family
// picker. Ingredients sit in a bar above the text with Clear prompt beside them, and Clear empties
// both. Format is disabled until there is text: for a portrait it rewrites the text as a detailed
// character description; for a body it puts Flow's triptych instruction in front of the text, and
// is spent once that is there. The chip glows once, the first time it can be pressed. Start
// generation stays disabled, with "Prompt must be provided" as its tooltip, until there is text.
import React from 'react';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { FlowIcon, FlowMatMenu, FlowMatMenuItem, FlowSpinner, type MenuAnchor } from '../scenes/flow-ui';
import type { CharacterSlot } from './character-host';

/** What Flow's Format writes in front of a body description. */
export const BODY_TRIPTYCH = 'Full-body triptych, three distinct views: front facing, 3/4 side view, and back view. High resolution, flat studio lighting, consistent anatomical proportions across all views, solid white background.';

export const CharacterPromptBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  refs: MediaItem[];
  onRemoveRef: (id: string) => void;
  onAddIngredients: () => void;
  ingredientsOpen: boolean;
  models: { id: string; name: string }[];
  modelId: string;
  onModel: (id: string) => void;
  onFormat: () => Promise<void>;
  onSubmit: () => void;
  /** The slot the prompt generates into; a body's Format is Flow's triptych instruction. */
  slot?: CharacterSlot;
  /** Clear prompt: the text and the ingredients. */
  onClear?: () => void;
  /** A preset is writing the prompt, or the page is otherwise busy: the send button spins. */
  busy?: boolean;
  disabled?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}> = ({ value, onChange, placeholder, refs, onRemoveRef, onAddIngredients, ingredientsOpen, models, modelId, onModel, onFormat, onSubmit, slot = 'portrait', onClear, busy, disabled, textareaRef }) => {
  const ownRef = React.useRef<HTMLTextAreaElement>(null);
  const ta = textareaRef ?? ownRef;
  const modelRef = React.useRef<HTMLButtonElement>(null);
  const [modelMenu, setModelMenu] = React.useState<MenuAnchor | null>(null);
  const [formatting, setFormatting] = React.useState(false);
  const [glowing, setGlowing] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value, ta]);
  const modelName = models.find((m) => m.id === modelId)?.name ?? 'No image model';
  const empty = !value.trim();
  const bodyFormatted = slot === 'body' && value.trimStart().startsWith(BODY_TRIPTYCH);
  const formatDisabled = empty || formatting || !!busy || bodyFormatted;
  const glowedRef = React.useRef(false);
  React.useEffect(() => {
    if (formatDisabled || glowedRef.current) return;
    glowedRef.current = true;
    setGlowing(true);
  }, [formatDisabled]);
  const format = () => {
    if (slot === 'body') { onChange(`${BODY_TRIPTYCH} ${value.trim()}`); return; }
    setFormatting(true);
    void onFormat().finally(() => setFormatting(false));
  };
  const clearButton = (value || refs.length > 0) && (
    <Tooltip content="Clear prompt" className="sb-tooltip">
      <button type="button" aria-label="Clear prompt" className="sb-icon-btn sb-prompt-clear" onClick={() => (onClear ? onClear() : onChange(''))}>
        <FlowIcon name="close" size={16} />
      </button>
    </Tooltip>
  );
  return (
    <div className="sb-prompt-wrapper">
      <div className="sb-prompt-box">
        {refs.length > 0 && (
          <div className="sb-prompt-top">
            <div className="cp-ingredients">
              {refs.map((r) => (
                <button key={r.id} type="button" aria-label="Ingredient" className="cp-ingredient" onClick={() => onRemoveRef(r.id)}>
                  <img src={r.url} alt="" draggable={false} />
                  <span className="cp-ingredient__hover"><FlowIcon name="cancel" size={16} /></span>
                </button>
              ))}
            </div>
            <div className="sb-prompt-actions">{clearButton}</div>
          </div>
        )}
        <div className="sb-prompt-top">
          <div className="sb-prompt-input" onClick={() => ta.current?.focus()}>
            {!value && <span className="sb-prompt-input__placeholder">{placeholder}</span>}
            <textarea
              ref={ta}
              className="sb-prompt-input__textarea"
              rows={1}
              value={value}
              aria-label={placeholder}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!empty && !busy) onSubmit(); }
                if (e.key === 'Escape') ta.current?.blur();
              }}
            />
          </div>
          {/* Flow keeps the actions slot when empty, so the row's 4px gap is always there; with
            * ingredients the slot is in the bar's row instead. */}
          {refs.length === 0 && <div className="sb-prompt-actions">{clearButton}</div>}
        </div>
        <div className="sb-prompt-bottom">
          <Tooltip content="Add ingredients" className="sb-tooltip">
            <button
              type="button"
              aria-label="Add ingredients to the prompt box"
              className={`sb-icon-btn sb-prompt-add${ingredientsOpen ? ' is-active' : ''}`}
              onClick={onAddIngredients}
            >
              <FlowIcon name="add" size={20} weight={200} />
            </button>
          </Tooltip>
          <button
            type="button"
            aria-label="Format"
            className={`cp-chip${glowing ? ' is-glowing' : ''}`}
            disabled={formatDisabled}
            onAnimationEnd={() => setGlowing(false)}
            onClick={format}
          >
            {formatting ? <FlowSpinner size={16} /> : <FlowIcon name="personal_recommendations" size={18} />}
            <span>Format</span>
          </button>
          <div className="sb-prompt-submit">
            <button
              ref={modelRef}
              type="button"
              aria-label="Select model family"
              aria-expanded={!!modelMenu}
              className="cp-chip cp-chip--model"
              disabled={!!busy}
              onClick={() => setModelMenu(modelMenu ? null : { kind: 'below', rect: modelRef.current!.getBoundingClientRect() })}
            >
              <span>{/banana/i.test(modelName) ? `\u{1F34C} ${modelName}` : modelName}</span>
              <FlowIcon name="arrow_drop_down" size={18} />
            </button>
            <Tooltip content={empty ? 'Prompt must be provided' : 'Start generation'} className="sb-tooltip">
              <span style={{ display: 'inline-flex' }}>
                <button
                  type="submit"
                  aria-label="Start generation"
                  className="sb-icon-btn sb-generate"
                  disabled={empty || busy || formatting || disabled}
                  onClick={onSubmit}
                >
                  {busy || formatting ? <FlowSpinner size={20} /> : <FlowIcon name="arrow_forward" size={18} />}
                </button>
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
      <FlowMatMenu open={!!modelMenu} onClose={() => setModelMenu(null)} anchor={modelMenu} ignoreRefs={[modelRef]} ariaLabel="Model family">
        {models.length === 0 && <FlowMatMenuItem label="No image models added" disabled />}
        {models.map((m) => (
          <FlowMatMenuItem key={m.id} label={m.name} onSelect={() => onModel(m.id)} />
        ))}
      </FlowMatMenu>
    </div>
  );
};
