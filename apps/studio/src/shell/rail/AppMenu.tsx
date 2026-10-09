import { useEffect, useRef, useState } from 'react';
import {
  onDesktopMessage,
  openDesktopMenu,
  pressDesktopMenuKeys,
  runDesktopCommand,
  setDesktopMenu,
  type DesktopMenu,
  type DesktopMenuKeys,
} from '@willow/core/desktop-bridge';
import { MenuPanel, type MenuPanelEntry } from './MenuPanel';

/*
 * The desktop app's File, Edit and View menus, whose names sit in the strip
 * (apps/desktop/shell/tabs.html): Codex's application menu on Windows (`windowsMenuBar`, less
 * Help) for what is in them, Willow's own menu (MenuPanel) for how they look. The strip is a
 * 40px webview with no room below it, so the menu that opens is drawn here, over this page,
 * hanging from the strip's button with no gap, as Willow's menus hang from theirs. Items and
 * order are Codex's where Willow has the same command — Settings at the end of Edit, as Codex
 * has it on Windows. Edit's commands and zoom are their keys, pressed into this page by the app
 * (tabs.rs `menu_keys`), so the page's own undo, paste and zoom answer them.
 */

interface AppMenuProps {
  isLight: boolean;
  isIncognito: boolean;
  onNewChat: () => void;
  onTemporaryChat: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
}

const ORDER: DesktopMenu[] = ['file', 'edit', 'view'];
const NAMES: Record<DesktopMenu, string> = { file: 'File', edit: 'Edit', view: 'View' };
const PAGE_EDITS = new Set<DesktopMenuKeys>(['undo', 'redo', 'cut', 'copy', 'delete', 'selectAll']);
/** Willow's menus fade out over 100ms after 25ms (`willow-mat-menu-exit`). */
const EXIT_MS = 125;

/** Where the app has no keys to press (outside Windows), the page does what it can itself. */
const press = (action: DesktopMenuKeys) => {
  void pressDesktopMenuKeys(action).then((pressed) => {
    if (!pressed && PAGE_EDITS.has(action)) document.execCommand(action);
  });
};

/** Each row's glyph in the face that has it: Luminous wherever it does, as Willow's menus. */
const menusFor = (props: AppMenuProps): Record<DesktopMenu, MenuPanelEntry[]> => ({
  file: [
    { label: 'New Chat', icon: { name: 'edit_square', family: 'luminous' }, run: props.onNewChat },
    {
      label: props.isIncognito ? 'Exit Temporary Chat' : 'Temporary Chat',
      icon: { name: props.isIncognito ? 'close' : 'gemini_chat_temp', family: 'luminous' },
      run: props.onTemporaryChat,
    },
    'separator',
    { label: 'Close', icon: { name: 'close', family: 'luminous' }, shortcut: 'Ctrl+W', run: () => runDesktopCommand('window_close') },
    { label: 'Quit Willow', icon: { name: 'power_settings_new', family: 'google-symbols' }, shortcut: 'Ctrl+Q', run: () => runDesktopCommand('app_quit') },
  ],
  edit: [
    { label: 'Undo', icon: { name: 'undo', family: 'luminous' }, shortcut: 'Ctrl+Z', run: () => press('undo') },
    { label: 'Redo', icon: { name: 'redo', family: 'luminous' }, shortcut: 'Ctrl+Y', run: () => press('redo') },
    'separator',
    { label: 'Cut', icon: { name: 'content_cut', family: 'material-rounded' }, shortcut: 'Ctrl+X', run: () => press('cut') },
    { label: 'Copy', icon: { name: 'content_copy', family: 'luminous' }, shortcut: 'Ctrl+C', run: () => press('copy') },
    { label: 'Paste', icon: { name: 'content_paste', family: 'google-symbols' }, shortcut: 'Ctrl+V', run: () => press('paste') },
    { label: 'Delete', icon: { name: 'delete', family: 'luminous' }, run: () => press('delete') },
    'separator',
    { label: 'Select All', icon: { name: 'select_all', family: 'material-rounded' }, shortcut: 'Ctrl+A', run: () => press('selectAll') },
    'separator',
    { label: 'Settings', icon: { name: 'settings', family: 'luminous' }, shortcut: 'Ctrl+,', run: props.onSettings },
  ],
  view: [
    { label: 'Toggle Sidebar', icon: { name: 'menu', family: 'luminous' }, run: props.onToggleSidebar },
    'separator',
    { label: 'Back', icon: { name: 'arrow_back', family: 'luminous' }, shortcut: 'Ctrl+[', run: () => window.history.back() },
    { label: 'Forward', icon: { name: 'arrow_forward', family: 'luminous' }, shortcut: 'Ctrl+]', run: () => window.history.forward() },
    'separator',
    { label: 'Zoom In', icon: { name: 'zoom_in', family: 'google-symbols' }, shortcut: 'Ctrl+Plus', run: () => press('zoomIn') },
    { label: 'Zoom Out', icon: { name: 'zoom_out', family: 'google-symbols' }, shortcut: 'Ctrl+-', run: () => press('zoomOut') },
    { label: 'Actual Size', icon: { name: 'fit_screen', family: 'material-rounded' }, shortcut: 'Ctrl+0', run: () => press('zoomReset') },
    'separator',
    { label: 'Toggle Full Screen', icon: { name: 'fullscreen', family: 'luminous' }, shortcut: 'F11', run: () => runDesktopCommand('window_fullscreen') },
  ],
});

export function AppMenu(props: AppMenuProps) {
  const [open, setOpen] = useState<{ menu: DesktopMenu; left: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const settings = useRef(props.onSettings);
  settings.current = props.onSettings;

  useEffect(() => onDesktopMessage((message) => {
    if (message.kind !== 'app-menu') return;
    const { menu, left } = message;
    if (!menu) {
      setClosing(true);
      return;
    }
    setOpen((current) => {
      // What had the keyboard before the menu took it, for when it closes or runs a command.
      if (!current) {
        const focused = document.activeElement;
        returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
      }
      return { menu, left: left / window.devicePixelRatio };
    });
    setClosing(false);
  }), []);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => {
      setOpen(null);
      setClosing(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  // Settings' shortcut, Ctrl+, (Codex's): the menu's other shortcuts are the app's or the page's.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.key === ',') {
        event.preventDefault();
        settings.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const close = (restore: boolean) => {
    if (closing) return;
    setClosing(true);
    setDesktopMenu(null);
    if (restore) returnFocus.current?.focus({ preventScroll: true });
    returnFocus.current = null;
  };

  const entries = menusFor(props)[open.menu].map((entry) =>
    entry === 'separator' ? entry : { ...entry, run: () => { close(true); entry.run(); } },
  );

  return (
    <MenuPanel
      entries={entries}
      label={NAMES[open.menu]}
      isLight={props.isLight}
      at={{ x: open.left, y: 0 }}
      from="button"
      closing={closing}
      onClose={close}
      onOtherKey={(key) => {
        if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
        const step = key === 'ArrowRight' ? 1 : -1;
        openDesktopMenu(ORDER[(ORDER.indexOf(open.menu) + step + ORDER.length) % ORDER.length]);
        return true;
      }}
    />
  );
}
