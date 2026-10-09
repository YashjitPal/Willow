import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '@nanostores/react';
import { useThemeMode } from '@willow/core/theme-mode';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { Tooltip } from '@willow/ui/Tooltip';
import { GeminiDialog, GeminiDialogPill } from '@willow/ui/GeminiDialog';
import { showCopyToast } from '@willow/ui/copy-toast-store';

import './gems.css';
import { GemEditor, type GemEditorProps } from './GemEditor';
import { GemLogo, gemLogoSpec } from './GemLogo';
import { GEM_MENU_TRIGGER, GemMenu, anchorOf, type GemAnchor, type GemMenuItem } from './GemMenu';
import { GemTips } from './GemTips';
import { PREMADE_GEMS, type PremadeGem } from './premade-gems';
import { deleteGem, gemsStore, hydrateGems, type Gem } from './gems-store';

/** Which Gems screen a path selects. `/gems` and Gemini's `/gems/view` are the manager. */
export type GemsRoute = { kind: 'view' } | { kind: 'create' } | { kind: 'edit'; id: string };

export const matchGemsRoute = (pathname: string): GemsRoute => {
  if (pathname === '/gems/create') return { kind: 'create' };
  const edit = /^\/gems\/edit\/(.+)$/.exec(pathname);
  if (edit) return { kind: 'edit', id: decodeURIComponent(edit[1]) };
  return { kind: 'view' };
};

export const gemPath = (id: string): string => `/gem/${encodeURIComponent(id)}`;
export const gemEditPath = (id: string): string => `/gems/edit/${encodeURIComponent(id)}`;

/** Router state for "Make a copy": the editor opens on a copy of this Gem. */
export interface GemsCreateState {
  copyFrom?: string;
}

/**
 * Share, locally: Willow has no link to hand out, so the Gem leaves as the same file the
 * workspace's `Gems/` folder syncs — dropped into another workspace's folder, it appears
 * there. The id is not part of the file; the receiving folder names it.
 */
const exportGem = (gem: Gem): void => {
  const { id: _id, ...portable } = gem;
  const blob = new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${gem.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Gem'}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showCopyToast('Gem saved as a file. Add it to a workspace’s Gems folder to share it.');
};

const PremadeCard: React.FC<{
  gem: PremadeGem;
  isLight: boolean;
  isMenuOpen: boolean;
  onOpen: () => void;
  onMenu: (anchor: GemAnchor) => void;
}> = ({ gem, isLight, isMenuOpen, onOpen, onMenu }) => (
  <div className={`gems-card${isMenuOpen ? ' is-menu-open' : ''}`}>
    <button type="button" className="gems-card-link" onClick={onOpen} aria-label={gem.name}>
      <div className="gems-card-header">
        <GemLogo spec={gemLogoSpec({ kind: 'premade', gem }, isLight)} size={28} />
        {gem.experiment && <span className="gems-experiment-badge">Experiment</span>}
      </div>
      <div className="gems-card-name">{gem.name}</div>
      <div className="gems-card-description">{gem.description}</div>
    </button>
    <div className="gems-card-actions">
      <button
        type="button"
        {...GEM_MENU_TRIGGER}
        aria-label={`More options for "${gem.name}" Gem`}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        className="gems-icon-button is-small"
        onClick={(event) => onMenu(anchorOf(event.currentTarget))}
      >
        <MaterialSymbol name="more_vert" family="google-symbols" size={20} weight={400} />
      </button>
    </div>
  </div>
);

const GemRow: React.FC<{
  gem: Gem;
  isLight: boolean;
  isMenuOpen: boolean;
  onOpen: () => void;
  onShare: () => void;
  onEdit: () => void;
  onMenu: (anchor: GemAnchor) => void;
}> = ({ gem, isLight, isMenuOpen, onOpen, onShare, onEdit, onMenu }) => {
  // Gemini's second line is the description, or the instructions when there is none.
  const subtitle = gem.description.trim() || gem.instructions.trim().split('\n').find(Boolean) || '';
  return (
    <div className={`gems-row${isMenuOpen ? ' is-menu-open' : ''}`}>
      <button type="button" className="gems-row-link" onClick={onOpen}>
        <GemLogo spec={gemLogoSpec({ kind: 'custom', gem }, isLight)} size={28} />
        <span className="gems-row-info">
          <span className="gems-row-title">{gem.name}</span>
          {subtitle && <span className="gems-row-description">{subtitle}</span>}
        </span>
      </button>
      <div className="gems-row-actions">
        <Tooltip content="Share">
          <button type="button" aria-label="Share" className="gems-icon-button" onClick={onShare}>
            <MaterialSymbol name="share" family="google-symbols" size={20} weight={400} />
          </button>
        </Tooltip>
        <Tooltip content="Edit Gem">
          <button type="button" aria-label="Edit Gem" className="gems-icon-button" onClick={onEdit}>
            <MaterialSymbol name="edit" family="google-symbols" size={20} weight={400} />
          </button>
        </Tooltip>
        <button
          type="button"
          {...GEM_MENU_TRIGGER}
          aria-label={`More options for "${gem.name}" Gem`}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          className="gems-icon-button gems-row-more"
          onClick={(event) => onMenu(anchorOf(event.currentTarget))}
        >
          <MaterialSymbol name="more_vert" family="google-symbols" size={20} weight={400} />
        </button>
      </div>
    </div>
  );
};

type OpenMenu = { kind: 'premade'; id: string; anchor: GemAnchor } | { kind: 'custom'; id: string; anchor: GemAnchor };

/**
 * The Gem manager — Gemini's `all-bots` at `/gems/view`, from its "Gem manager" heading
 * down. Premade Gems are a fixed list (`premade-gems.ts`); the user's own come from
 * `gemsStore`, most recently changed first.
 */
const GemManager: React.FC = () => {
  const { isLight } = useThemeMode();
  const navigate = useNavigate();
  const gems = useStore(gemsStore);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Gem | null>(null);

  const openCopy = (id: string) => navigate('/gems/create', { state: { copyFrom: id } satisfies GemsCreateState });

  const menuItems = (): GemMenuItem[] => {
    if (!menu) return [];
    if (menu.kind === 'premade') {
      return [{ label: 'Make a copy', icon: 'content_copy', onSelect: () => openCopy(menu.id) }];
    }
    const gem = gems.find((candidate) => candidate.id === menu.id);
    if (!gem) return [];
    return [
      { label: 'New chat', icon: 'chat_bubble', onSelect: () => navigate(gemPath(gem.id)) },
      { label: 'Make a copy', icon: 'content_copy', onSelect: () => openCopy(gem.id) },
      { label: 'Delete', icon: 'delete', onSelect: () => setPendingDelete(gem) },
    ];
  };

  return (
    <div className={`gems-surface gems-page gemini-chat-scrollbar${isLight ? ' is-light' : ''}`}>
      <div className="gems-inner">
        <h1 className="gems-title">Gem manager</h1>

        <section aria-label="Premade by Google">
          <div className="gems-section-header">
            <h2 className="gems-section-title">Premade by Google</h2>
            <button
              type="button"
              className="gems-show-more"
              aria-label={expanded ? 'Show fewer Gems premade by Google' : 'Show more Gems premade by Google'}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <span>{expanded ? 'Show less' : 'Show more'}</span>
              <MaterialSymbol name={expanded ? 'collapse_all' : 'expand_all'} family="google-symbols" size={18} weight={400} />
            </button>
          </div>
          <div className={`gems-premade-cards${expanded ? ' is-expanded' : ''}`}>
            <div className="gems-premade-cards-inner">
              {PREMADE_GEMS.map((gem) => (
                <PremadeCard
                  key={gem.id}
                  gem={gem}
                  isLight={isLight}
                  isMenuOpen={menu?.kind === 'premade' && menu.id === gem.id}
                  onOpen={() => navigate(gemPath(gem.id))}
                  onMenu={(anchor) => setMenu((open) => (open?.id === gem.id ? null : { kind: 'premade', id: gem.id, anchor }))}
                />
              ))}
            </div>
          </div>
        </section>

        <section aria-label="My Gems">
          <div className="gems-list-header">
            <div className="gems-list-title">
              <h2 className="gems-section-title">My Gems</h2>
              <GemTips
                label="Notice about where Gems are saved"
                body="Your Gems are saved in this browser, and in the Gems folder of your workspace when one is connected."
              />
            </div>
            <button type="button" className="gems-new-button" onClick={() => navigate('/gems/create')}>
              <MaterialSymbol name="add" family="google-symbols" size={18} weight={400} />
              <span>New Gem</span>
            </button>
          </div>
          <div className="gems-list">
            {gems.map((gem) => (
              <GemRow
                key={gem.id}
                gem={gem}
                isLight={isLight}
                isMenuOpen={menu?.kind === 'custom' && menu.id === gem.id}
                onOpen={() => navigate(gemPath(gem.id))}
                onShare={() => exportGem(gem)}
                onEdit={() => navigate(gemEditPath(gem.id))}
                onMenu={(anchor) => setMenu((open) => (open?.id === gem.id ? null : { kind: 'custom', id: gem.id, anchor }))}
              />
            ))}
          </div>
        </section>
      </div>

      {menu && (
        <GemMenu
          anchor={menu.anchor}
          label="Gem actions"
          items={menuItems()}
          onClose={() => setMenu(null)}
        />
      )}

      {pendingDelete && (
        <GeminiDialog
          headingAs="h1"
          title="Delete Gem?"
          width={512}
          message
          onDismiss={() => setPendingDelete(null)}
          actions={(
            <>
              <GeminiDialogPill onClick={() => setPendingDelete(null)}>Cancel</GeminiDialogPill>
              <GeminiDialogPill
                onClick={() => {
                  deleteGem(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                Delete
              </GeminiDialogPill>
            </>
          )}
        >
          <p>
            Deleting this Gem will delete its instructions and knowledge files. Chats you had with
            it will remain.
          </p>
        </GeminiDialog>
      )}
    </div>
  );
};

export type GemsViewProps = Omit<GemEditorProps, 'route'>;

/** `/gems`, `/gems/view`, `/gems/create` and `/gems/edit/<id>`. */
export const GemsView: React.FC<GemsViewProps> = (props) => {
  const location = useLocation();
  const route = matchGemsRoute(location.pathname);
  useEffect(() => { hydrateGems(); }, []);
  if (route.kind === 'view') return <GemManager />;
  return <GemEditor key={location.key} route={route} {...props} />;
};

export default GemsView;
