/**
 * Where the ported Codex UI portals its menus, popovers, tooltips and dialogs:
 * one `.willow-spaces` host on <body>, so the scoped Codex rules and Willow's
 * Spaces theme reach content that leaves the page's tree.
 */
let root: HTMLElement | null = null;

export function getPortalRoot(): HTMLElement {
  if (root?.isConnected) return root;
  root = document.createElement('div');
  root.className = 'willow-spaces willow-spaces-portal-root';
  document.body.append(root);
  return root;
}
