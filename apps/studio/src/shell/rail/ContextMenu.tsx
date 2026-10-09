import { useEffect, useState } from 'react';
import { useThemeMode } from '@willow/core/theme-mode';
import { chooseDesktopContextMenu, onDesktopMessage, type DesktopContextMenuItem } from '@willow/core/desktop-bridge';
import { askWillowAbout } from '@willow/chat/ask-willow';
import { MenuPanel, type MenuIcon, type MenuPanelEntry } from './MenuPanel';

/*
 * The desktop app's right-click menu, in Willow's menu (MenuPanel): WebView2's own commands for
 * what was clicked (apps/desktop/src-tauri/src/menus.rs), each enabled as WebView2 has it, and
 * run by WebView2 on what was clicked once chosen, as its own menu would run it. So the menu
 * never takes the keyboard from the page: a paste lands where the caret was. With text selected,
 * Ask Willow comes first: the canvas's floating prompt, opened beside the selection (AskWillow).
 */

/** WebView2's commands, by its names for them, with the glyph each is drawn with. */
const ICONS: Record<string, MenuIcon> = {
  undo: { name: 'undo', family: 'luminous' },
  redo: { name: 'redo', family: 'luminous' },
  cut: { name: 'content_cut', family: 'material-rounded' },
  copy: { name: 'content_copy', family: 'luminous' },
  paste: { name: 'content_paste', family: 'google-symbols' },
  pasteAndMatchStyle: { name: 'content_paste_go', family: 'material-rounded' },
  selectAll: { name: 'select_all', family: 'material-rounded' },
  emoji: { name: 'mood', family: 'material-rounded' },
  back: { name: 'arrow_back', family: 'luminous' },
  forward: { name: 'arrow_forward', family: 'luminous' },
  reload: { name: 'refresh', family: 'luminous' },
  openLinkInNewWindow: { name: 'open_in_new', family: 'luminous' },
  copyLinkLocation: { name: 'link', family: 'google-symbols' },
  saveLinkAs: { name: 'download', family: 'luminous' },
  copyImage: { name: 'image', family: 'luminous' },
  copyImageLocation: { name: 'link', family: 'google-symbols' },
  saveImageAs: { name: 'download', family: 'luminous' },
  saveMediaAs: { name: 'download', family: 'luminous' },
  inspectElement: { name: 'code', family: 'luminous' },
};

/** Willow has one window: a link "opened in a new window" opens in the page, or the browser. */
const LABELS: Record<string, string> = { openLinkInNewWindow: 'Open link' };

/** Willow's menus fade out over 100ms after 25ms (`willow-mat-menu-exit`). */
const EXIT_MS = 125;

interface OpenMenu {
  id: number;
  x: number;
  y: number;
  items: DesktopContextMenuItem[];
  selection: string | null;
}

/** The selection's box on screen; inside a frame it has none here, so the point clicked stands in. */
const selectionBox = (x: number, y: number) => {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const box = selection.getRangeAt(0).getBoundingClientRect();
    if (box.width > 0 || box.height > 0) return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }
  return { left: x, top: y, right: x, bottom: y };
};

export function ContextMenu() {
  const { isLight } = useThemeMode();
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => onDesktopMessage((message) => {
    if (message.kind !== 'context-menu') return;
    setMenu({ id: message.id, x: message.x, y: message.y, items: message.items, selection: message.selection });
    setClosing(false);
  }), []);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => {
      setMenu(null);
      setClosing(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  if (!menu) return null;

  const answer = (command: number | null) => {
    if (closing) return;
    chooseDesktopContextMenu(menu.id, command);
    setClosing(true);
  };

  const commands: MenuPanelEntry[] = menu.items.map((item) =>
    item.command === null
      ? 'separator'
      : {
          label: LABELS[item.name] ?? item.label,
          icon: ICONS[item.name],
          shortcut: item.shortcut || undefined,
          disabled: !item.enabled,
          checked: item.checked ?? undefined,
          run: () => answer(item.command),
        },
  );
  const selection = menu.selection?.trim() ? menu.selection : null;
  const entries: MenuPanelEntry[] = selection
    ? [
        {
          label: 'Ask Willow',
          icon: { name: 'spark', family: 'luminous' },
          run: () => {
            const near = selectionBox(menu.x, menu.y);
            answer(null);
            askWillowAbout(selection, near);
          },
        },
        ...(commands.length ? (['separator'] as MenuPanelEntry[]) : []),
        ...commands,
      ]
    : commands;

  return (
    <MenuPanel
      key={menu.id}
      entries={entries}
      label="Context menu"
      isLight={isLight}
      at={{ x: menu.x, y: menu.y }}
      from="pointer"
      closing={closing}
      onClose={() => answer(null)}
    />
  );
}
