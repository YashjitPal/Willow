import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useAuth } from '@willow/auth/AuthContext';
import { getWorkspaceTheme } from '@willow/core/workspace-theme';

import './notebooks.css';
import { NOTEBOOK_VERTICALS, type NotebookVertical } from './notebook-types';
import { NotebooksSplashScreen } from './NotebooksSplashScreen';
import {
  hydrateNotebooks,
  notebooksHydratedStore,
  notebooksStore,
  subscribeToNotebookWrites,
} from './notebooks-store';
import { useNotebookDisk } from './useNotebookDisk';

/**
 * The "What are you working on?" create screen — Gemini's
 * `project-create-window-v2`.
 *
 * Measured on the live page at a 1248px content width. The vertical rhythm is
 * tight and every gap here is read, not chosen:
 *
 *   .prompt-container    h 68  = 28px icon + 16px gap + 24px heading
 *   .project-form-wrapper       starts immediately after (0 gap)
 *   form.project-name-form      4px into the wrapper, h 52
 *   .suggestions-row            40px after the form, h 138, 12px between chips
 *
 * ── The name field is a bare display-size input, not a text box ──────────────
 *
 * `input.project-name-input.gds-display-m` is **36px/44px at weight 320** with a
 * fully transparent background and no border — it reads as an editable title, not
 * a form control. It also carries `padding-left: 16px` while the field around it
 * carries `margin-left: -16px`, which cancel out so the *text* lands at the same
 * x as the icon and heading above it while the field's hit area still extends
 * 16px further left. Caret is `rgb(168,199,250)`.
 *
 * ── The submit button tracks the text ───────────────────────────────────────
 *
 * There is no button at rest. Type anything and a 36x36 `arrow_forward` appears
 * 8px past the field's right edge, and it *moves right as you type* because the
 * field grows to fit its content.
 *
 * The width comes from a hidden mirror. Gemini keeps a `div.dupe-title` at
 * `opacity: 0`, `position: absolute`, `pointer-events: none`, holding the same
 * string in the same 36px/44px face, and sizes the field to
 * `max(400px, mirrorWidth + 16px)` — 400 being the resting minimum and 16 the
 * input's left padding. Verified: "Physics…" mirror 698px → field 714px → button
 * at field.right + 8.
 *
 * The growth is **NOT animated**. Gemini's `transition: all` resolves to a 0s
 * duration, and frame-sampling a big paste showed the width jump 400 → 732 in a
 * single frame. Adding an eased width transition here would look smoother than
 * the real thing and lag the caret behind the text.
 *
 * ── The placeholder types itself, per vertical ──────────────────────────────
 *
 * Sampled 32s per vertical: four phrases cycle, each typed a character at a time,
 * held ~2050ms, then deleted a character at a time. The two verticals have
 * **entirely different lists** — Organize cycles "Project or idea…", Study cycles
 * "Subject or topic…" — and switching chips restarts from the first phrase. The
 * lists live on `NOTEBOOK_VERTICALS`; timings are the `PLACEHOLDER_*` constants.
 *
 * ── Heading ────────────────────────────────────────────────────────────────
 *
 * `gds-headline-s` is 20px/24px `wght 470` but ALSO `wdth 94` and `ROND 20`, and
 * the family must be declared: Willow's global sans is Inter, which is ~8% wider
 * and made this heading measure 248.19px against Gemini's 228.85px. The copy also
 * follows the vertical — "What are you working on?" / "What are you studying?".
 */
export interface NotebookCreatePageProps {
  /** Called with the new notebook's id once it is created. */
  onCreated: (notebookId: string) => void;
  onCancel?: () => void;
}

/** Median inter-character delay while typing forwards. */
const PLACEHOLDER_TYPE_MS = 63;
/** Median inter-character delay while deleting. */
const PLACEHOLDER_DELETE_MS = 58;
/** Dwell at the complete phrase before deleting. Measured 2044–2090ms. */
const PLACEHOLDER_HOLD_MS = 2050;

/** The field's resting width, and the input's left padding. */
const FIELD_MIN_WIDTH = 400;
const INPUT_LEFT_PADDING = 16;

/**
 * Drive the typewriter placeholder.
 *
 * A single `setTimeout` chain rather than an interval: the three phases have
 * different delays, so a fixed tick would have to divide them and would drift.
 * Paused while the field has a value — the placeholder is not visible then, and
 * animating it would keep a timer alive for nothing. `phraseRef` survives the
 * pause so clearing the field resumes mid-cycle rather than snapping to phrase 0.
 *
 * `phrases` is per-vertical and swaps wholesale when the chip changes. Switching
 * restarts from the first phrase, which is what Gemini does — timing it after a
 * click showed the new phrase typed from empty, not the old one finishing first.
 */
const useTypewriterPlaceholder = (phrases: readonly string[], isPaused: boolean): string => {
  const [text, setText] = useState('');
  const phraseRef = useRef(0);
  const charRef = useRef(0);
  const deletingRef = useRef(false);

  /*
   * Reset on a vertical change only. Deliberately keyed on `phrases` and not
   * folded into the timer effect below, which also re-runs on pause — a pause
   * must resume mid-cycle, so it must not reset these.
   */
  useEffect(() => {
    phraseRef.current = 0;
    charRef.current = 0;
    deletingRef.current = false;
    setText('');
  }, [phrases]);

  useEffect(() => {
    if (isPaused) return;
    let timer: number | undefined;

    const step = () => {
      const phrase = phrases[phraseRef.current % phrases.length];

      if (!deletingRef.current) {
        charRef.current += 1;
        setText(phrase.slice(0, charRef.current));
        if (charRef.current >= phrase.length) {
          deletingRef.current = true;
          timer = window.setTimeout(step, PLACEHOLDER_HOLD_MS);
          return;
        }
        timer = window.setTimeout(step, PLACEHOLDER_TYPE_MS);
        return;
      }

      charRef.current -= 1;
      setText(phrase.slice(0, Math.max(0, charRef.current)));
      if (charRef.current <= 0) {
        deletingRef.current = false;
        phraseRef.current += 1;
        charRef.current = 0;
      }
      timer = window.setTimeout(step, PLACEHOLDER_DELETE_MS);
    };

    timer = window.setTimeout(step, PLACEHOLDER_TYPE_MS);
    return () => window.clearTimeout(timer);
  }, [isPaused, phrases]);

  return text;
};

export const NotebookCreatePage: React.FC<NotebookCreatePageProps> = ({ onCreated, onCancel }) => {
  const { userProfile } = useAuth();
  const theme = getWorkspaceTheme(userProfile?.workspaceColor);

  const notebooks = useStore(notebooksStore);
  const isHydrated = useStore(notebooksHydratedStore);
  const [hasStarted, setHasStarted] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('start') === '1' || params.get('started') === 'true';
    }
    return false;
  });

  const [title, setTitle] = useState('');
  const [vertical, setVertical] = useState<NotebookVertical>('organize');
  const [fieldWidth, setFieldWidth] = useState(FIELD_MIN_WIDTH);
  const isSubmittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const { createNotebookWithFolder } = useNotebookDisk();

  useEffect(() => {
    hydrateNotebooks();
    return subscribeToNotebookWrites();
  }, []);

  /*
   * One lookup for everything that changes with the chip: the heading copy and
   * the placeholder phrase list. `placeholders` keeps a stable identity per
   * vertical because it lives on the module-level constant, which is what lets
   * the typewriter reset on a real change and not on every render.
   */
  const activeVertical =
    NOTEBOOK_VERTICALS.find((option) => option.id === vertical) ?? NOTEBOOK_VERTICALS[0];
  const placeholder = useTypewriterPlaceholder(activeVertical.placeholders, title.length > 0);

  /*
   * Size the field from the mirror. `useLayoutEffect` so the width is committed
   * in the same frame the character lands — in a passive effect the button would
   * visibly trail the caret by a frame on every keystroke.
   */
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    /*
     * Deliberately NOT rounded. Text advance widths are fractional, and Gemini
     * passes the measurement straight through — `Math.ceil` here put the field at
     * 715px where Gemini sits at 714px for the same string. A sub-pixel width is
     * fine in CSS and keeps the button exactly where Gemini puts it.
     */
    const measured = mirror.getBoundingClientRect().width;
    setFieldWidth(Math.max(FIELD_MIN_WIDTH, measured + INPUT_LEFT_PADDING));
  }, [title]);

  useEffect(() => {
    // Focus input when the create form is active
    if (isHydrated && (notebooks.length > 0 || hasStarted)) {
      inputRef.current?.focus();
    }
  }, [isHydrated, hasStarted, notebooks.length]);

  if (!isHydrated) return <div className="h-full w-full" />;

  /*
   * If no notebooks have ever been created, show the first-run splash screen.
   * Clicking "+ Getting started" sets `hasStarted` to true, advancing to the
   * creation form.
   */
  if (notebooks.length === 0 && !hasStarted) {
    return <NotebooksSplashScreen onGetStarted={() => setHasStarted(true)} />;
  }

  const submit = () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    const notebook = createNotebookWithFolder({ title, vertical });
    onCreated(notebook.id);
  };

  const hasTitle = title.trim().length > 0;
  /*
   * Gemini swaps the heading with the vertical — "What are you working on?" for
   * Organize, "What are you studying?" for Study — and changes nothing else on
   * the screen. The copy lives on the vertical so the two cannot fall out of sync.
   */
  const heading = activeVertical.prompt;

  return (
    <div
      className="nb-spring nb-surface nb-create-host"
      style={{
        '--nb-accent-btn-bg': theme.sendButton.bg,
        '--nb-accent-btn-hover': theme.sendButton.hover,
        '--nb-link-color': theme.creamy.hex,
        '--nb-caret-color': theme.creamy.hex,
        '--nb-chip-selected-bg': theme.chipBg,
      } as React.CSSProperties}
    >
      <div className="nb-create-content">
        {/* ── prompt: 28px icon, 16px gap, 24px heading ───────────────────── */}
        <div className="nb-create-prompt">
          <MaterialSymbol
            name="notebook"
            family="luminous"
            size={28}
            weight={260}
            roundness={100}
            opticalSize={28}
            className="text-[#e6e6e6]"
          />
          <h1 className="nb-create-heading">{heading}</h1>
        </div>

        {/* ── name field + the button that follows it ─────────────────────── */}
        <form
          className="nb-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {/*
           * The hidden width mirror — Gemini's `.dupe-title`. It must carry the
           * exact same font as the input or the field mis-sizes; the shared
           * `.nb-create-typescale` class is what guarantees that.
           */}
          <span ref={mirrorRef} aria-hidden="true" className="nb-create-mirror nb-create-typescale">
            {title}
          </span>

          <div className="nb-create-field" style={{ width: fieldWidth }}>
            <input
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && onCancel) onCancel();
              }}
              placeholder={placeholder}
              /* Fixed, so the cycling placeholder never churns the accessible name. */
              aria-label="Notebook name"
              maxLength={200}
              className="nb-create-input nb-create-typescale"
            />
          </div>

          {/*
           * No button at rest — it appears with the first character. Kept inside
           * the form so it submits natively and so the flex row's 8px gap places
           * it, rather than absolute positioning that would need its own maths.
           */}
          {hasTitle && (
            <button type="submit" aria-label="Create notebook" className="nb-create-submit">
              <MaterialSymbol
                name="arrow_forward"
                family="luminous"
                size={24}
                weight={300}
                roundness={100}
                opticalSize={24}
              />
            </button>
          )}
        </form>

        {/* ── verticals ───────────────────────────────────────────────────── */}
        <div className="nb-create-chips">
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
      </div>
    </div>
  );
};
