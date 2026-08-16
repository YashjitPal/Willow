import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

import './notebooks.css';
import { NOTEBOOK_VERTICALS, type NotebookVertical } from './notebook-types';
import { createNotebook } from './notebooks-store';

/**
 * The "What are you working on?" create screen — Gemini's
 * `project-create-window-v2`.
 *
 * Geometry, measured on the live page at a 1248px content width:
 *
 *   content-wrapper        760 wide, vertically centred
 *   prompt-container       h 68  — notebook glyph 28px (wght 260) then the heading
 *   h1.prompt-text         20px/24px w470   "What are you working on?"
 *   form.project-name-form h 52, input field 400 wide
 *   suggestions-row        h 138, 12px gap between chips
 *   chip                   160 wide unselected, 200 selected, h 138
 *
 * The chip interaction is the part worth being careful about, and it is not the
 * obvious implementation. The chip animates its **width**, and the subtext inside
 * is laid out at the *selected* width (176px) while the collapsed chip clips it
 * with `overflow: hidden`. So selecting a chip does three things on one 400ms
 * overshoot spring — grow the box, fade the subtext up, pop the check badge from
 * scale(0) — and none of them animate the text itself. See `notebooks.css`.
 *
 * The two chip icons are **Google Symbols**, not Luminous: `lightbulb` and
 * `school` at `wght 300, ROND 100`. Every other icon on this screen is Luminous.
 * Asking the Luminous face for `lightbulb` renders a blank box.
 */
export interface NotebookCreatePageProps {
  /** Called with the new notebook's id once it is created. */
  onCreated: (notebookId: string) => void;
  onCancel?: () => void;
}

export const NotebookCreatePage: React.FC<NotebookCreatePageProps> = ({ onCreated, onCancel }) => {
  const [title, setTitle] = useState('');
  const [vertical, setVertical] = useState<NotebookVertical>('organize');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Gemini lands with the name field focused, so typing works immediately.
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const notebook = createNotebook({ title, vertical });
    onCreated(notebook.id);
  };

  return (
    <div className="nb-spring flex h-full w-full items-center justify-center overflow-y-auto px-6">
      <div className="flex w-full max-w-[760px] flex-col">
        {/* ── prompt ─────────────────────────────────────────────────────── */}
        <div className="nb-rise flex flex-col gap-4">
          <MaterialSymbol
            name="notebook"
            family="luminous"
            size={28}
            weight={260}
            roundness={100}
            opticalSize={28}
            className="text-[#e6e6e6]"
          />
          <h1 className="text-[20px] font-[470] leading-6 text-[#e3e3e3]">What are you working on?</h1>
        </div>

        {/* ── name + verticals ───────────────────────────────────────────── */}
        <form
          className="nb-rise nb-rise-delay-1 mt-1 flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex h-[52px] w-full max-w-[400px] items-center">
            <input
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && onCancel) onCancel();
              }}
              placeholder="Notebook name"
              aria-label="Notebook name"
              maxLength={200}
              className="h-[52px] w-full rounded-2xl bg-[#171717] px-4 text-[17px] leading-6 text-[#e6e6e6] outline-none placeholder:text-white/40 focus:bg-[#1f1f1f] transition-colors duration-200"
            />
          </div>

          <div className="nb-rise nb-rise-delay-2 mt-5 flex gap-3">
            {NOTEBOOK_VERTICALS.map((option) => {
              const isSelected = vertical === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setVertical(option.id)}
                  className={`nb-chip ${isSelected ? 'is-selected' : ''}`}
                >
                  <MaterialSymbol
                    name={option.icon}
                    family="google-symbols"
                    size={24}
                    weight={300}
                    roundness={100}
                    className="nb-chip-icon"
                  />
                  <span className="nb-chip-name">{option.name}</span>
                  <span className={`nb-chip-subtext ${isSelected ? 'is-visible' : ''}`}>{option.subtext}</span>
                  <span className={`nb-chip-badge ${isSelected ? 'is-visible' : ''}`} aria-hidden="true">
                    <MaterialSymbol
                      name="check"
                      family="luminous"
                      size={16}
                      weight={330}
                      roundness={100}
                      opticalSize={16}
                      className="text-[#e6e6e6]"
                    />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              /*
               * Gemini's `gds-button-primary`: 36px tall, fully round, the
               * accent container fill, 13px/17px label at weight 540.
               */
              className="flex h-9 items-center rounded-full bg-[#a8c7fa] px-5 text-[13px] font-[540] leading-[17px] text-[#062e6f] transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
            >
              Create notebook
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex h-9 items-center rounded-full px-5 text-[13px] font-[540] leading-[17px] text-[#e6e6e6] transition-colors duration-200 hover:bg-white/[0.08]"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
