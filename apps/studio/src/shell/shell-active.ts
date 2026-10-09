import { createContext } from 'react';

/**
 * Whether the main shell is on show. It stays mounted, hidden, while a Media or Code project or
 * Willow TV is (App's `ShellKeepAlive`), so its tabs are as they were when the user comes back; what
 * answers the whole window from inside it — the strip's menus, Ask Willow — leaves that meanwhile to
 * the frame on show.
 */
export const ShellActiveContext = createContext(true);
