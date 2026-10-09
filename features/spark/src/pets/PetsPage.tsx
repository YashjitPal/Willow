import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { onDesktopMessage } from '@willow/core/desktop-bridge';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';
import { useSparkAccentVars } from '../spark-accent';
import { PetPawIcon } from './PetPawIcon';
import { createPetWithGemini } from './pet-create';
import { openPetFolder, petLibrary, refreshPetLibrary, selectPet } from './pet-library';
import {
  PET_FORCES,
  PET_MAX_WIDTH,
  PET_MIN_WIDTH,
  petDetails,
  petSelection,
  petSettings,
  petShown,
  petStatusLine,
  setPetDetails,
  updatePetSettings,
  type PetForce,
} from './pet-store';
import rockySheet from './assets/rocky.webp?url';
import '../SparkCustomisePages.css';
import './PetsPage.css';

/*
 * The Pets page: BetterGravity's Pets library, as one of Spark's Customise pages.
 * Choose the companion, see every animation it has, rename it, open the folder
 * the library lives in, and create one with the Hatch Pet skill. The pet's own
 * settings, which the plugin kept in its settings panel, sit at the end.
 */

/** The nine animation rows a preview can loop, with the plugin's timings. */
const PREVIEW_STATES = [
  { id: 'idle', label: 'Idle', row: 0, durations: [1680, 660, 660, 840, 840, 1920] },
  { id: 'running', label: 'Thinking', row: 7, count: 6, duration: 120, last: 220 },
  { id: 'waiting', label: 'Needs input', row: 6, count: 6, duration: 150, last: 260 },
  { id: 'review', label: 'Ready', row: 8, count: 6, duration: 150, last: 280 },
  { id: 'waving', label: 'Waving', row: 3, count: 4, duration: 140, last: 280 },
  { id: 'jumping', label: 'Jumping', row: 4, count: 5, duration: 140, last: 280 },
  { id: 'running-right', label: 'Running right', row: 1, count: 8, duration: 120, last: 220 },
  { id: 'running-left', label: 'Running left', row: 2, count: 8, duration: 120, last: 220 },
  { id: 'failed', label: 'Blocked', row: 5, count: 8, duration: 140, last: 240 },
] as const;

const STAGES = ['preparing', 'imagining', 'posing', 'hatching'] as const;
const STAGE_LABELS = ['Getting ready', 'Imagining the main look', 'Picturing the poses', 'Hatching'];

/** Skills' Luminous Symbols outlines at 24px / weight 300. */
const ICONS = {
  previous: 'M10.454 12 14.527 16.073Q14.735 16.281 14.739 16.595Q14.744 16.91 14.527 17.127Q14.31 17.344 14 17.344Q13.69 17.344 13.473 17.127L8.979 12.633Q8.838 12.492 8.781 12.337Q8.723 12.181 8.723 12Q8.723 11.819 8.781 11.663Q8.838 11.508 8.979 11.367L13.473 6.873Q13.681 6.665 13.995 6.661Q14.31 6.656 14.527 6.873Q14.744 7.09 14.744 7.4Q14.744 7.71 14.527 7.927Z',
  next: 'M12.946 12 8.873 7.927Q8.665 7.719 8.661 7.405Q8.656 7.09 8.873 6.873Q9.09 6.656 9.4 6.656Q9.71 6.656 9.927 6.873L14.421 11.367Q14.562 11.508 14.619 11.663Q14.677 11.819 14.677 12Q14.677 12.181 14.619 12.337Q14.562 12.492 14.421 12.633L9.927 17.127Q9.719 17.335 9.405 17.339Q9.09 17.344 8.873 17.127Q8.656 16.91 8.656 16.6Q8.656 16.29 8.873 16.073Z',
  create: 'M11.458 21.5Q9.471 21.5 8.55 21.402Q7.629 21.304 7.023 20.998Q6.356 20.652 5.849 20.143Q5.342 19.635 5.012 18.967Q4.706 18.346 4.603 17.425Q4.5 16.504 4.5 14.533V9.477Q4.5 7.481 4.598 6.56Q4.696 5.638 5.012 5.033Q5.358 4.356 5.857 3.844Q6.356 3.333 7.023 3.012Q7.644 2.696 8.565 2.598Q9.487 2.5 11.458 2.5H13Q13.319 2.5 13.535 2.715Q13.75 2.931 13.75 3.25Q13.75 3.569 13.535 3.785Q13.319 4 13 4H11.458Q9.842 4 9.042 4.035Q8.242 4.069 7.702 4.344Q7.258 4.563 6.918 4.913Q6.579 5.263 6.344 5.717Q6.069 6.267 6.035 7.06Q6 7.852 6 9.477V14.533Q6 16.148 6.035 16.948Q6.069 17.748 6.344 18.298Q6.569 18.742 6.916 19.082Q7.263 19.421 7.717 19.665Q8.258 19.94 9.05 19.97Q9.842 20 11.458 20H12.619Q14.225 20 15.025 19.97Q15.825 19.94 16.365 19.665Q16.819 19.446 17.159 19.091Q17.498 18.737 17.733 18.283Q18.008 17.733 18.038 16.94Q18.067 16.148 18.067 14.533Q18.067 14.213 18.283 13.998Q18.498 13.783 18.817 13.783Q19.137 13.783 19.352 13.998Q19.567 14.213 19.567 14.533Q19.567 16.519 19.469 17.44Q19.371 18.362 19.065 18.967Q18.719 19.644 18.215 20.156Q17.712 20.667 17.044 20.998Q16.423 21.304 15.507 21.402Q14.59 21.5 12.619 21.5ZM10.121 14.692Q9.802 14.692 9.587 14.469Q9.371 14.246 9.371 13.927Q9.396 12.358 9.779 11.209Q10.162 10.06 11.271 8.95L16.913 3.288Q17.3 2.902 17.792 2.701Q18.285 2.5 18.817 2.5Q19.933 2.5 20.721 3.288Q21.51 4.077 21.51 5.192Q21.51 5.725 21.309 6.217Q21.108 6.71 20.721 7.106L15.079 12.767Q13.944 13.912 12.817 14.294Q11.69 14.677 10.121 14.692ZM10.902 13.162Q11.775 13.09 12.514 12.777Q13.254 12.463 14.01 11.698L19.667 6.037Q19.831 5.873 19.915 5.652Q20 5.431 20 5.202Q20 4.7 19.66 4.35Q19.319 4 18.817 4Q18.588 4 18.375 4.089Q18.162 4.179 17.983 4.358L12.34 10.019Q11.61 10.75 11.296 11.512Q10.983 12.273 10.902 13.162Z',
  folder: 'M4.25 19.5Q3.521 19.5 3.011 18.989Q2.5 18.479 2.5 17.75V6.308Q2.5 5.579 3.039 5.039Q3.579 4.5 4.308 4.5H9.05Q9.412 4.5 9.745 4.64Q10.079 4.781 10.325 5.027L11.798 6.5H20.663Q20.983 6.5 21.198 6.715Q21.413 6.931 21.413 7.25Q21.413 7.569 21.198 7.785Q20.983 8 20.663 8H11.185L9.185 6H4.308Q4.173 6 4.087 6.087Q4 6.173 4 6.308V18Q4 17.865 4.053 17.899Q4.106 17.933 4.192 17.981L6.138 11.483Q6.319 10.9 6.804 10.546Q7.288 10.192 7.881 10.192H20.742Q21.662 10.192 22.201 10.923Q22.74 11.654 22.485 12.517L20.762 18.258Q20.59 18.821 20.12 19.161Q19.65 19.5 19.077 19.5ZM5.763 18H19.038Q19.144 18 19.226 17.942Q19.308 17.885 19.337 17.779L21.04 12.087Q21.088 11.933 20.992 11.812Q20.896 11.692 20.742 11.692H7.881Q7.775 11.692 7.693 11.75Q7.612 11.808 7.583 11.913ZM5.763 18 7.583 11.913Q7.602 11.865 7.612 11.822Q7.621 11.779 7.631 11.75Q7.64 11.721 7.65 11.692Q7.631 11.75 7.612 11.817Q7.602 11.865 7.578 11.937Q7.554 12.01 7.535 12.087L5.831 17.779Q5.812 17.827 5.802 17.87Q5.792 17.913 5.783 17.942Q5.773 17.971 5.763 18Z',
  refresh: 'M12 20.657Q10.199 20.657 8.626 19.974Q7.052 19.292 5.883 18.124Q4.714 16.955 4.032 15.381Q3.35 13.808 3.35 12.007Q3.35 10.227 4.032 8.652Q4.714 7.077 5.883 5.899Q7.052 4.721 8.625 4.048Q10.199 3.375 12 3.375Q13.534 3.375 14.95 3.897Q16.367 4.419 17.534 5.418V4.468Q17.534 4.118 17.771 3.881Q18.008 3.643 18.359 3.643Q18.71 3.643 18.947 3.881Q19.184 4.118 19.184 4.468V7.297Q19.184 7.698 18.915 7.965Q18.647 8.233 18.251 8.233H15.419Q15.069 8.233 14.831 7.995Q14.594 7.758 14.594 7.407Q14.594 7.057 14.831 6.82Q15.069 6.583 15.419 6.583H16.341Q15.426 5.83 14.317 5.427Q13.208 5.025 12 5.025Q9.093 5.025 7.047 7.064Q5 9.103 5 12.005Q5 14.932 7.038 16.969Q9.075 19.007 12 19.007Q14.925 19.007 16.962 16.969Q19 14.932 19 12.007Q19 11.656 19.237 11.419Q19.474 11.182 19.825 11.182Q20.176 11.182 20.413 11.419Q20.65 11.656 20.65 12.007Q20.65 13.808 19.968 15.381Q19.286 16.955 18.117 18.124Q16.948 19.292 15.375 19.974Q13.802 20.657 12 20.657Z',
} as const;

const Icon: React.FC<{ name: keyof typeof ICONS }> = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

interface PetChoice {
  id: string;
  displayName: string;
  description: string;
  previewDataUrl?: string;
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** The chosen pet looping one animation row at a time; browsing it never changes the live pet. */
const PetPreview: React.FC<{ sheet: string; name: string }> = ({ sheet, name }) => {
  const [index, setIndex] = useState(0);
  const sprite = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLDivElement>(null);
  const state = PREVIEW_STATES[index];
  const select = (next: number) => setIndex((next + PREVIEW_STATES.length) % PREVIEW_STATES.length);

  useEffect(() => {
    const element = sprite.current;
    if (!element) return undefined;
    let frame = 0;
    let timer: number | undefined;
    const count = 'durations' in state ? state.durations.length : state.count;
    const paint = () => {
      element.style.backgroundPosition = `${(frame / 7) * 100}% ${state.row * 10}%`;
      if (reducedMotion()) return;
      const delay = 'durations' in state ? state.durations[frame] : frame === count - 1 ? state.last : state.duration;
      frame = (frame + 1) % count;
      timer = window.setTimeout(paint, delay);
    };
    paint();
    return () => window.clearTimeout(timer);
  }, [state, sheet]);

  return (
    <section
      className="spark-pets__hero"
      aria-label="Pet animations"
      aria-roledescription="carousel"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
        const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
          : event.key === 'Home' ? 0 : event.key === 'End' ? PREVIEW_STATES.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        select(next);
        if ((event.target as HTMLElement).closest('[data-pet-animation]')) {
          requestAnimationFrame(() => dots.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus());
        }
      }}
    >
      <div className="spark-pets__stage">
        <button type="button" className="spark-pets__arrow" aria-label="Previous animation" aria-controls="spark-pets-preview" onClick={() => select(index - 1)}>
          <Icon name="previous" />
        </button>
        <div
          ref={sprite}
          id="spark-pets-preview"
          className="spark-pets__sprite"
          role="img"
          aria-label={`${name}: ${state.label}`}
          data-pet-preview-state={state.id}
          style={{ backgroundImage: `url(${JSON.stringify(sheet)})` }}
        />
        <button type="button" className="spark-pets__arrow" aria-label="Next animation" aria-controls="spark-pets-preview" onClick={() => select(index + 1)}>
          <Icon name="next" />
        </button>
      </div>
      <p className="spark-pets__state-name" aria-live="polite" aria-atomic="true">{state.label}</p>
      <div ref={dots} className="spark-pets__pagination" role="group" aria-label="Choose an animation">
        {PREVIEW_STATES.map((preview, position) => (
          <button
            key={preview.id}
            type="button"
            className="spark-pets__dot"
            data-pet-animation={preview.id}
            aria-label={preview.label}
            aria-controls="spark-pets-preview"
            aria-pressed={position === index}
            tabIndex={position === index ? 0 : -1}
            title={preview.label}
            onClick={() => select(position)}
          >
            <span />
          </button>
        ))}
      </div>
    </section>
  );
};

/** The chat rename dialog, for a pet's name and description. */
const PetEditor: React.FC<{ pet: PetChoice; onClose: () => void }> = ({ pet, onClose }) => {
  const [name, setName] = useState(pet.displayName);
  const [description, setDescription] = useState(pet.description ?? '');
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const unchanged = trimmed === pet.displayName && description === (pet.description ?? '');
  const disabled = !trimmed || trimmed.length > 100 || description.length > 500 || unchanged;

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, reducedMotion() ? 0 : 75);
  }, [closing, onClose]);

  useEffect(() => {
    nameField.current?.focus({ preventScroll: true });
    nameField.current?.select();
  }, []);

  const commit = () => {
    if (closing || disabled) return;
    try {
      setPetDetails(pet.id, { displayName: trimmed, description });
      close();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Your changes could not be saved. Try again.');
    }
  };

  return (
    <GeminiDialog
      title="Rename this pet"
      closing={closing}
      onDismiss={close}
      actions={(
        <>
          <GeminiDialogPill onClick={close}>Cancel</GeminiDialogPill>
          <GeminiDialogPill disabled={disabled} onClick={commit}>Rename</GeminiDialogPill>
        </>
      )}
    >
      <div className="spark-pets-editor">
        <label className="spark-pets-editor__label">
          Pet name
          <div className="willow-gdlg-field">
            <input
              ref={nameField}
              className="willow-gdlg-field__input"
              aria-label="Pet name"
              autoComplete="off"
              maxLength={100}
              value={name}
              onChange={(event) => {
                setError('');
                setName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <div aria-hidden="true" className="willow-gdlg-field__outline" />
          </div>
        </label>
        <label className="spark-pets-editor__label">
          Description
          <div className="willow-gdlg-field spark-pets-editor__description">
            <textarea
              className="willow-gdlg-field__input"
              aria-label="Description"
              rows={3}
              maxLength={500}
              value={description}
              onChange={(event) => {
                setError('');
                setDescription(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <div aria-hidden="true" className="willow-gdlg-field__outline" />
          </div>
        </label>
        {error && <p className="spark-pets-editor__error" role="alert">{error}</p>}
      </div>
    </GeminiDialog>
  );
};

const PetSwitch: React.FC<{ checked: boolean; label: string; onChange: (checked: boolean) => void }> = ({ checked, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`spark-app-toggle${checked ? ' spark-app-toggle--checked' : ''}`}
    onClick={() => onChange(!checked)}
  >
    <span className="spark-app-toggle__thumb" />
  </button>
);

const SettingRow: React.FC<{ label: string; description: string; control: React.ReactNode; id?: string }> = ({ label, description, control, id }) => (
  <div className="spark-pets-setting">
    <div className="spark-pets-setting__copy">
      <span className="spark-pets-setting__label" id={id}>{label}</span>
      <span className="spark-pets-setting__description">{description}</span>
    </div>
    <div className="spark-pets-setting__control">{control}</div>
  </div>
);

/** What the plugin kept in its settings panel. */
const PetSettingsSection: React.FC = () => {
  const settings = useStore(petSettings.store);
  const status = useStore(petStatusLine.store);
  const [sheet, setSheet] = useState(settings.sheet);
  const headingId = useId();
  const homeId = useId();
  const sizeId = useId();
  const sheetId = useId();
  const forceId = useId();
  useEffect(() => setSheet(settings.sheet), [settings.sheet]);
  const applySheet = () => {
    if (sheet !== settings.sheet) updatePetSettings({ sheet });
  };

  return (
    <section className="spark-pets__settings" aria-labelledby={headingId}>
      <h2 id={headingId}>Settings</h2>
      <div className="spark-pets__settings-list">
        <SettingRow
          id={homeId}
          label="Where it lives"
          description="On the desktop, in a window of its own, the way Codex does it — so it stays with you when Willow is behind something else. Inside the window if your system will not give it one."
          control={(
            <select
              className="spark-pets-select"
              aria-labelledby={homeId}
              value={settings.home}
              onChange={(event) => updatePetSettings({ home: event.target.value === 'window' ? 'window' : 'desktop' })}
            >
              <option value="desktop">On the desktop</option>
              <option value="window">Inside Willow</option>
            </select>
          )}
        />
        <SettingRow
          id={sizeId}
          label="Size"
          description={`How wide the pet is, in pixels. Codex allows ${PET_MIN_WIDTH} to ${PET_MAX_WIDTH}.`}
          control={(
            <span className="spark-pets-size">
              <input
                type="range"
                aria-labelledby={sizeId}
                min={PET_MIN_WIDTH}
                max={PET_MAX_WIDTH}
                value={settings.size}
                onChange={(event) => updatePetSettings({ size: Number(event.target.value) })}
              />
              <output>{settings.size} px</output>
            </span>
          )}
        />
        <SettingRow
          label="Show what the agent is doing"
          description="Activity cards and an indicator coloured by the most important notification. The pet keeps animating while an agent works, even with cards hidden."
          control={<PetSwitch checked={settings.activity} label="Show what the agent is doing" onChange={(activity) => updatePetSettings({ activity })} />}
        />
        <SettingRow
          label="Throw it"
          description="Let a flick carry the pet on and bounce it off the edges. Off is what Codex does day to day — a drop leaves the pet exactly where you let go."
          control={<PetSwitch checked={settings.bounce} label="Throw it" onChange={(bounce) => updatePetSettings({ bounce })} />}
        />
        <SettingRow
          id={sheetId}
          label="Sprite sheet"
          description="A URL to your own sheet, laid out as 8 columns by 11 rows. Empty uses the chosen pet."
          control={(
            <input
              className="spark-pets-text"
              type="url"
              aria-labelledby={sheetId}
              placeholder="https://example.com/pet.webp"
              value={sheet}
              onChange={(event) => setSheet(event.target.value)}
              onBlur={applySheet}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySheet();
              }}
            />
          )}
        />
        <SettingRow
          id={forceId}
          label="Force a state"
          description="Hold one animation, for looking at it. Auto follows the agent."
          control={(
            <select
              className="spark-pets-select"
              aria-labelledby={forceId}
              value={settings.force}
              onChange={(event) => updatePetSettings({ force: event.target.value as PetForce })}
            >
              {PET_FORCES.map((force) => <option key={force.value} value={force.value}>{force.label}</option>)}
            </select>
          )}
        />
        <div className="spark-pets-setting spark-pets-setting--note">
          <div className="spark-pets-setting__copy">
            <span className="spark-pets-setting__label">Status</span>
            <span className="spark-pets-setting__description" aria-live="polite">{status || 'Waking up.'}</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export const PetsPage: React.FC<{ className?: string }> = ({ className = '' }) => {
  const library = useStore(petLibrary);
  const selection = useStore(petSelection.store);
  const settings = useStore(petSettings.store);
  const shown = useStore(petShown.store);
  useStore(petDetails.store);
  const accentVars = useSparkAccentVars();
  const headingId = useId();
  const availableId = useId();
  const [editing, setEditing] = useState<PetChoice | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    void refreshPetLibrary();
    return onDesktopMessage((message) => {
      if (message.kind === 'pets-changed') void refreshPetLibrary();
    });
  }, []);

  const details = petDetails.get();
  const named = (pet: PetChoice): PetChoice => {
    const saved = details[pet.id];
    return saved ? { ...pet, displayName: saved.displayName || pet.displayName, description: saved.description } : pet;
  };
  const records: PetChoice[] = [
    { id: 'rocky', displayName: 'Rocky', description: 'The original companion.' },
    ...(library.state?.pets ?? []).map((pet) => ({
      id: `custom:${pet.id}`,
      displayName: pet.displayName,
      description: pet.description,
      previewDataUrl: library.previews[pet.id],
    })),
  ].map(named);
  const runs = (library.state?.runs ?? []).filter((run) => run.stage !== 'ready');
  const notice = library.error || (library.state === null ? 'Loading your pets…' : '');
  const current = records.find((pet) => pet.id === selection) ?? records[0];
  const sheet = library.selected?.spritesheetDataUrl || settings.sheet || rockySheet;

  return (
    <main className={`spark-customise-page spark-customise-page--pets ${className}`.trim()} aria-labelledby={headingId} style={accentVars}>
      <div className="spark-customise-page__narrow-inner">
        <header className="spark-customise-header">
          <h1 id={headingId} ref={titleRef} tabIndex={-1}>Pets</h1>
          <p>Choose a companion for your workspace, or create your own with AI.</p>
        </header>

        <div className="spark-page-actions spark-pets__actions" aria-label="Manage pets">
          <button type="button" className="spark-page-action spark-page-action--primary" disabled={library.busy} onClick={() => void createPetWithGemini()}>
            <Icon name="create" />
            {library.creating ? 'Opening…' : 'Create with Gemini'}
          </button>
          <button type="button" className="spark-page-action" onClick={() => void openPetFolder()}>
            <Icon name="folder" />
            Open folder
          </button>
          <button type="button" className="spark-page-action" aria-pressed={shown} onClick={() => petShown.set(!shown)}>
            <PetPawIcon size={24} />
            <span>{shown ? 'Hide pet' : 'Show pet'}</span>
          </button>
          <button
            type="button"
            className="spark-page-action spark-page-action--icon-only"
            aria-label="Refresh pets"
            title="Refresh pets"
            disabled={library.busy}
            onClick={() => void refreshPetLibrary()}
          >
            <Icon name="refresh" />
          </button>
        </div>

        <PetPreview sheet={sheet} name={current?.displayName ?? 'Rocky'} />

        {notice && (
          <p className="spark-pets__notice" role={library.error ? 'alert' : 'status'}>{notice}</p>
        )}

        <section className="spark-pets__available" aria-labelledby={availableId}>
          <h2 id={availableId}>{`Available pets (${records.length})`}</h2>
          <div className="spark-pets__list" role="list">
            {records.map((pet) => {
              const selected = selection === pet.id && !settings.sheet;
              return (
                <div
                  key={pet.id}
                  className="spark-pets__row"
                  role="listitem"
                  tabIndex={0}
                  aria-label={pet.displayName}
                  aria-description="Double-click or press Enter to edit the name and description."
                  aria-keyshortcuts="Enter F2"
                  title="Double-click to edit name and description"
                  data-pet-choice={pet.id}
                  onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest('button')) return;
                    event.preventDefault();
                    setEditing(pet);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || !['Enter', 'F2'].includes(event.key)) return;
                    event.preventDefault();
                    setEditing(pet);
                  }}
                >
                  <div className="spark-pets__thumbnail" data-builtin={pet.previewDataUrl ? undefined : 'true'}>
                    {pet.previewDataUrl && <img src={pet.previewDataUrl} alt="" />}
                  </div>
                  <div className="spark-pets__details">
                    <strong>{pet.displayName}</strong>
                    <span>{pet.description || 'Your custom companion.'}</span>
                  </div>
                  <button
                    type="button"
                    className={`spark-pets__use${selected ? ' is-selected' : ''}`}
                    aria-label={`${selected ? 'Selected pet:' : 'Use pet:'} ${pet.displayName}`}
                    disabled={selected || library.busy}
                    onClick={() => void selectPet(pet.id)}
                  >
                    {selected ? 'Selected' : 'Use pet'}
                  </button>
                </div>
              );
            })}
          </div>
          {library.state && library.state.pets.length === 0 && (
            <p className="spark-pets__empty">Describe a companion or add a reference image in the new chat. Your finished pet will appear here.</p>
          )}
        </section>

        {runs.map((run) => (
          <section key={run.id} className="spark-pets__progress">
            {run.previewDataUrl && <img className="spark-pets__progress-image" src={run.previewDataUrl} alt={`${run.name} in progress`} />}
            <div className="spark-pets__progress-content">
              <strong>{run.name}</strong>
              <ol className="spark-pets__steps" aria-label={`Creating ${run.name}`}>
                {STAGE_LABELS.map((label, index) => {
                  const at = STAGES.indexOf(run.stage as typeof STAGES[number]);
                  const stage = index < at ? 'complete' : STAGES[index] === run.stage ? 'current' : 'pending';
                  return <li key={label} data-stage={stage} aria-current={stage === 'current' ? 'step' : undefined}>{label}</li>;
                })}
              </ol>
              {run.stage === 'error' && <p className="spark-pets__notice">{run.message || 'Creation needs attention.'}</p>}
            </div>
          </section>
        ))}

        <PetSettingsSection />
      </div>
      {editing && (
        <PetEditor
          pet={editing}
          onClose={() => {
            const id = editing.id;
            setEditing(null);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pet-choice="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
          }}
        />
      )}
    </main>
  );
};

export default PetsPage;
