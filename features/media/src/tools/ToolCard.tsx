/**
 * Flow's `flow-applet-card`, both ways it draws one: `default` (My Tools: the square icon, name,
 * author, a two-line description) and `gallery` (Templates and Community: the preview picture,
 * then the 92px icon beside the text). Its More options menu is Flow's per kind of tool:
 *
 * - your own: Favorite, Edit, Set cover, Pin to dock, Remix tool, Share, Delete;
 * - a template or a community tool: Favorite, Pin to dock, Remix tool, Share.
 */
import React from 'react';
import { FlowMatMenu, FlowMatMenuItem } from '../scenes/flow-ui';
import type { ToolEntry } from './tools-store';
import { ToolMarkdown } from './ToolMarkdown';
import { FlowIconButton, MatIcon } from './ui';

export interface ToolCardActions {
  open(entry: ToolEntry): void;
  edit(entry: ToolEntry): void;
  setCover(entry: ToolEntry): void;
  remix(entry: ToolEntry): void;
  toggleFavorite(entry: ToolEntry): void;
  togglePin(entry: ToolEntry): void;
  share(entry: ToolEntry): void;
  remove(entry: ToolEntry): void;
}

export const ToolCard: React.FC<{ entry: ToolEntry; variant: 'default' | 'gallery'; actions: ToolCardActions }> = React.memo(({ entry, variant, actions }) => {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const open = () => actions.open(entry);
  const own = entry.kind === 'self';
  const menu = (
    <FlowMatMenu
      open={menuOpen}
      onClose={() => setMenuOpen(false)}
      anchor={menuOpen && buttonRef.current ? { kind: 'below', rect: buttonRef.current.getBoundingClientRect() } : null}
      ignoreRefs={[buttonRef]}
    >
      <FlowMatMenuItem icon="favorite" iconFill={entry.favorite} label={entry.favorite ? 'Remove favorite' : 'Favorite'} onSelect={() => actions.toggleFavorite(entry)} />
      {own && <FlowMatMenuItem icon="edit" label="Edit" onSelect={() => actions.edit(entry)} />}
      {own && <FlowMatMenuItem icon="photo" label="Set cover" onSelect={() => actions.setCover(entry)} />}
      <FlowMatMenuItem icon="push_pin" iconFill={entry.pinned} label={entry.pinned ? 'Unpin' : 'Pin to dock'} onSelect={() => actions.togglePin(entry)} />
      <FlowMatMenuItem icon="shuffle" label="Remix tool" onSelect={() => actions.remix(entry)} />
      <FlowMatMenuItem icon="share" label="Share" onSelect={() => actions.share(entry)} />
      {own && <FlowMatMenuItem icon="delete" label="Delete" onSelect={() => actions.remove(entry)} />}
    </FlowMatMenu>
  );
  const menuButton = (
    <FlowIconButton
      ref={buttonRef}
      icon="more_vert"
      label="More options"
      menuTrigger
      iconClassName="flow-icon-s"
      className="applet-menu-button"
      onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
    />
  );
  const keys = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
  const textGroup = (
    <div className="applet-title-row">
      <div className="applet-text-group">
        <span className="applet-name">{entry.name}</span>
        <span className="applet-author">{entry.author}</span>
      </div>
      {menuButton}
    </div>
  );
  const description = entry.kind === 'community'
    ? <ToolMarkdown text={entry.description} className="applet-description" />
    : <span className="applet-description">{entry.description}</span>;

  if (variant === 'gallery') {
    return (
      <div className="ng-flow-applet-card">
        <div className="applet-card">
          <div className="applet-card-main" role="button" tabIndex={0} onClick={open} onKeyDown={keys}>
            <div className="applet-preview-container">
              {entry.preview && !previewFailed
                ? <img className="applet-preview-image" src={entry.preview} alt="" loading="lazy" draggable={false} onError={() => setPreviewFailed(true)} />
                : <div className="applet-preview-placeholder"><img className="applet-preview-image" src={entry.icon} alt="" loading="lazy" draggable={false} /></div>}
            </div>
            <div className="applet-gallery-footer">
              <div className="applet-tool-icon"><img className="applet-tool-icon-image" src={entry.icon} alt="" loading="lazy" draggable={false} /></div>
              <div className="applet-card-info">
                {textGroup}
                {description}
              </div>
            </div>
          </div>
        </div>
        {menu}
      </div>
    );
  }

  return (
    <div className="ng-flow-applet-card">
      <div className="applet-card">
        <div className="applet-card-main" role="button" tabIndex={0} onClick={open} onKeyDown={keys}>
          <div className="applet-thumbnail">
            {entry.preview || entry.icon
              ? <img className="applet-thumbnail-image" src={entry.preview || entry.icon} alt="" loading="lazy" draggable={false} />
              : <div className="applet-empty-icon"><MatIcon name="app_registration" className="flow-icon-xl applet-empty-icon-graphic" /></div>}
          </div>
          <div className="applet-card-footer">
            <div className="applet-card-info">
              {textGroup}
              {description}
            </div>
          </div>
        </div>
      </div>
      {menu}
    </div>
  );
});
ToolCard.displayName = 'ToolCard';

/** Flow's Create New card, first in My creations. */
export const CreateToolCard: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div
    className="create-applet-card"
    role="button"
    tabIndex={0}
    onClick={onCreate}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCreate(); } }}
  >
    <div className="create-applet-thumbnail">
      <MatIcon name="add" className="create-applet-icon" />
    </div>
    <div className="create-applet-footer">
      <span className="create-applet-name">Create New</span>
    </div>
  </div>
);