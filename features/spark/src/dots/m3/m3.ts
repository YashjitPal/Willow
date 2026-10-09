/**
 * Material 3 for the web (`@material/web`): the components a bot's conversation and profile are
 * built from. Importing this module registers them; `m3.css` sets their colour, shape and type
 * tokens to Willow's (Gemini's palette, tinted by the bot through `useDotTint`).
 *
 * React 19 sets a custom element's properties directly when the element has them, so `selected`,
 * `label`, `elevated` and the rest are passed as props and stay in sync with React's state.
 */
import '@material/web/button/filled-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/text-button.js';
import '@material/web/divider/divider.js';
import '@material/web/elevation/elevation.js';
import '@material/web/focus/md-focus-ring.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/labs/card/outlined-card.js';
import '@material/web/progress/circular-progress.js';
import '@material/web/ripple/ripple.js';
import '@material/web/switch/switch.js';
import '@material/web/textfield/outlined-text-field.js';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import './m3.css';

type M3Element<Props = object> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Props;

interface ButtonProps {
  disabled?: boolean;
  softDisabled?: boolean;
  hasIcon?: boolean;
  trailingIcon?: boolean;
  type?: 'button' | 'submit' | 'reset';
  href?: string;
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'md-icon-button': M3Element<{ disabled?: boolean; softDisabled?: boolean; href?: string; toggle?: boolean; selected?: boolean }>;
      'md-divider': M3Element<{ inset?: boolean; insetStart?: boolean; insetEnd?: boolean }>;
      'md-elevation': M3Element;
      'md-focus-ring': M3Element<{ inward?: boolean; visible?: boolean }>;
      'md-ripple': M3Element<{ disabled?: boolean }>;
      'md-switch': M3Element<{ selected?: boolean; disabled?: boolean; icons?: boolean; showOnlySelectedIcon?: boolean }>;
      'md-text-button': M3Element<ButtonProps>;
      'md-filled-button': M3Element<ButtonProps>;
      'md-filled-tonal-button': M3Element<ButtonProps>;
      'md-outlined-card': M3Element;
      'md-circular-progress': M3Element<{ indeterminate?: boolean; value?: number; max?: number }>;
      'md-outlined-text-field': M3Element<{
        label?: string;
        type?: string;
        rows?: number;
        value?: string;
        placeholder?: string;
        maxLength?: number;
        supportingText?: string;
        disabled?: boolean;
      }>;
    }
  }
}

/** The class that puts Material's tokens in scope; pair it with the bot's tint for its colours. */
export const M3_SCOPE = 'dot-m3';
