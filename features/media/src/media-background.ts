import { createContext } from 'react';
import { atom } from 'nanostores';

/**
 * True while the open Media project is working: an agent turn, or any item
 * still generating.
 *
 * App reads it to keep the Media editor mounted, hidden, after the user leaves
 * it: the agent, the generation callbacks and the gallery they fill all live in
 * the editor's own state, and unmounting it would drop every one of them.
 */
export const $mediaWorkRunning = atom(false);

/**
 * True while the editor is kept alive off screen. Its full-screen overlays are
 * portalled to the body, outside the hidden host, so they must not render then.
 */
export const MediaBackgroundContext = createContext(false);
