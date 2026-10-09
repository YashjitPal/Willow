// The Characters tab's grid — Flow's: a "New character" tile, then a square per character, its
// portrait under its name, the character badge, a favorite mark, and a hover hotbar with Favorite
// and a menu. The squares go through the gallery's own rows (gallery-layout.ts), New character as one
// more 1:1 tile, so the tab arranges like All media; the last row keeps the others' size, as Flow's.
import React from 'react';
import { motion } from 'framer-motion';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { GeneratingLayers } from '../GalleryTile';
import { layoutGallery, type GalleryCell } from '../gallery-layout';
import { FlowIcon, FlowMatDivider, FlowMatMenu, FlowMatMenuItem, FlowRenameOverlay, type MenuAnchor } from '../scenes/flow-ui';
import { useLongPress } from '../use-long-press';
import { TouchMoreButton } from '../TouchMoreButton';
import { characterName, type Character } from './character-store';
import './characters.css';

const NEW_CHARACTER = 'new-character';

const LAYOUT_EASE = [0.16, 1, 0.3, 1] as const;

const tileBox = (cell: GalleryCell<unknown>): React.CSSProperties => ({
  flexGrow: cell.isLastRow ? 0 : cell.ar,
  flexBasis: `${cell.finalWidth}px`,
  height: `${cell.finalHeight}px`,
});

const NewCharacterTile: React.FC<{ box: React.CSSProperties; layoutDuration: number; onClick: () => void }> = ({ box, layoutDuration, onClick }) => (
  <motion.button layout transition={{ duration: layoutDuration, ease: LAYOUT_EASE }} style={box} type="button" className="cg-custom" onClick={onClick}>
    <FlowIcon name="add" size={40} fill className="cg-custom__icon" />
    <span className="cg-custom__label">New character</span>
  </motion.button>
);

/** A character's square, here and among All media's tiles, as Flow's `flow-character-tile` is in both. */
export const CharacterTile: React.FC<{
  character: Character;
  portrait?: MediaItem;
  box: React.CSSProperties;
  layoutDuration: number;
  onOpen: () => void;
  onFavorite: () => void;
  onAddToPrompt: () => void;
  onCopy: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}> = ({ character, portrait, box, layoutDuration, onOpen, onFavorite, onAddToPrompt, onCopy, onRename, onDelete }) => {
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const tileRef = React.useRef<HTMLDivElement>(null);
  const [menu, setMenu] = React.useState<MenuAnchor | null>(null);
  const [renaming, setRenaming] = React.useState<DOMRect | null>(null);
  const pending = portrait?.status === 'generating';
  // A touch screen's right-click.
  const hold = useLongPress((x, y) => setMenu({ kind: 'point', x, y }));
  return (
    <motion.div
      ref={tileRef}
      layout
      transition={{ duration: layoutDuration, ease: LAYOUT_EASE }}
      style={box}
      className="cg-tile"
      role="button"
      tabIndex={0}
      aria-label={characterName(character)}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onContextMenu={(e) => {
        // A right-click goes on to the gallery's own menu, as before; a held finger opens this one.
        if (!hold.justFired() && !hold.isPressing()) return;
        e.preventDefault();
        e.stopPropagation();
        if (!hold.justFired()) setMenu({ kind: 'point', x: e.clientX, y: e.clientY });
        hold.cancel();
      }}
      {...hold.handlers}
    >
      {pending ? (
        <div className="sb-step__pending"><GeneratingLayers isRevealing={false} /></div>
      ) : portrait?.url ? (
        <img className="cg-tile__thumb" src={portrait.url} alt="Character thumbnail" draggable={false} />
      ) : null}
      <span className="cg-tile__name">{characterName(character)}</span>
      <span className="cg-tile__type"><FlowIcon name="accessibility_new" size={22} /></span>
      <div className="cg-tile__pre-hover">
        {character.favorite && <span className="cg-tile__status"><FlowIcon name="favorite" size={18} fill /></span>}
      </div>
      <div className="cg-tile__hover">
        <div className="sb-hotbar-wrap">
          <div className="sb-hotbar">
            <Tooltip content={character.favorite ? 'Remove favorite' : 'Favorite'} position="above" className="sb-tooltip">
              <button type="button" aria-label="Favorite" className="sb-hotbar-btn" onClick={(e) => { e.stopPropagation(); onFavorite(); }}>
                <FlowIcon name="favorite" size={18} fill={!!character.favorite} />
              </button>
            </Tooltip>
            <Tooltip content="More" position="above" className="sb-tooltip">
              <button
                ref={moreRef}
                type="button"
                aria-label="More options"
                aria-expanded={!!menu}
                className="sb-hotbar-btn"
                onClick={(e) => { e.stopPropagation(); setMenu(menu ? null : { kind: 'below', rect: moreRef.current!.getBoundingClientRect() }); }}
              >
                <FlowIcon name="more_vert" size={18} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <TouchMoreButton open={!!menu} hidden={!!renaming} onToggle={(rect) => setMenu(menu ? null : { kind: 'below', rect })} />
      <FlowMatMenu open={!!menu} onClose={() => setMenu(null)} anchor={menu} ignoreRefs={[moreRef]}>
        <FlowMatMenuItem icon="add_2" label="Add to prompt" disabled={!portrait?.url} onSelect={onAddToPrompt} />
        <FlowMatMenuItem icon="favorite" iconFill={!!character.favorite} label={character.favorite ? 'Remove favorite' : 'Favorite'} onSelect={onFavorite} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="content_copy" label="Copy" onSelect={onCopy} />
        <FlowMatMenuItem icon="edit" label="Rename" onSelect={() => setRenaming(tileRef.current?.getBoundingClientRect() ?? null)} />
        <FlowMatDivider />
        <FlowMatMenuItem icon="delete" label="Delete" onSelect={onDelete} />
      </FlowMatMenu>
      <FlowRenameOverlay
        open={!!renaming}
        anchor={renaming}
        value={characterName(character)}
        onCommit={onRename}
        onClose={() => setRenaming(null)}
      />
    </motion.div>
  );
};

export const CharactersGrid: React.FC<{
  characters: Character[];
  /** The gallery's frame, so the rows come out as All media's do. */
  width: number;
  targetHeight: number;
  paddingRight: number;
  layoutDuration: number;
  itemById: (id: string) => MediaItem | undefined;
  onNew: () => void;
  onOpen: (id: string) => void;
  onFavorite: (c: Character) => void;
  onAddToPrompt: (c: Character) => void;
  onCopy: (c: Character) => void;
  onRename: (c: Character, name: string) => void;
  onDelete: (c: Character) => void;
}> = ({ characters, width, targetHeight, paddingRight, layoutDuration, itemById, onNew, onOpen, onFavorite, onAddToPrompt, onCopy, onRename, onDelete }) => {
  const cells = React.useMemo(() => layoutGallery<Character | typeof NEW_CHARACTER>([
    { item: NEW_CHARACTER, ar: 1 },
    ...[...characters].sort((a, b) => b.createdAt - a.createdAt).map((c) => ({ item: c, ar: 1 })),
  ], width, targetHeight, { uniformLastRow: true }), [characters, width, targetHeight]);
  return (
    <div className="flex flex-wrap gap-3 pt-[72px] pb-44 w-full" style={{ paddingRight: `${paddingRight}px` }}>
      {cells.map((cell) => {
        const c = cell.item;
        if (c === NEW_CHARACTER) return <NewCharacterTile key={NEW_CHARACTER} box={tileBox(cell)} layoutDuration={layoutDuration} onClick={onNew} />;
        const portrait = c.portraitId ? itemById(c.portraitId) : undefined;
        return (
          <CharacterTile
            key={c.id}
            character={c}
            portrait={portrait}
            box={tileBox(cell)}
            layoutDuration={layoutDuration}
            onOpen={() => onOpen(c.id)}
            onFavorite={() => onFavorite(c)}
            onAddToPrompt={() => onAddToPrompt(c)}
            onCopy={() => onCopy(c)}
            onRename={(name) => onRename(c, name)}
            onDelete={() => onDelete(c)}
          />
        );
      })}
    </div>
  );
};
