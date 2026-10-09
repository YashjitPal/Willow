// Flow's image view, opened by pressing an image in the gallery: `flow-editor-page` with
// `flow-image-editor`. One full-window surface:
//
//   header    back · editable name · info │ navigation rail │ favorite · share · trash · download · history · Done
//   content   crop │ the image (or the cropper) above "What do you want to change?" │ history column
//
// An edit appends a pending card to the bottom of the history column at once and opens it: the
// image becomes the generating liquid until the new version lands, or the card turns into Flow's
// error tile and the image it was made from opens again. Crop is a mode, not a menu: choosing a
// shape swaps the image for the cropper and the prompt for Cancel and Crop; Escape only closes
// the shape menu. Everything was recorded off flow.google.com (see image-editor.css).
import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { Tooltip } from '@willow/ui/Tooltip';
import type { MediaItem } from '../types';
import { GeneratingLayers } from '../GalleryTile';
import { $scenes, openScene, showSnack } from '../scenes/scene-store';
import { FlowEditableText, FlowIcon, FlowMatMenu, FlowMatMenuItem, type MenuAnchor } from '../scenes/flow-ui';
import type { SceneHost } from '../scenes/scene-host';
import { SceneMediaPicker } from '../scenes/SceneMediaPicker';
import { buildRailEntries, NavigationRail } from './NavigationRail';
import { ImageHistory } from './ImageHistory';
import { cropImage, ImageCropper, type CropBox } from './ImageCropper';
import { DownloadMenu, FlagDialog, InfoPopover, ratioIcon, ShareDialog } from './editor-overlays';
import { useMediaViewport } from '../use-media-viewport';
import '../scenes/scene-builder.css';
import './image-editor.css';
import './editor-responsive.css';

export interface ImageEditHost {
  models: { id: string; name: string }[];
  /** The model an edit uses unless the settings panel picks another. */
  defaultModelId: string;
  /** Shown above the prompt when an edit cannot start (no model, no key). */
  notice?: React.ReactNode;
  /** Starts an edit of `source`; returns the new pending version, or null when it could not start. */
  generate(source: MediaItem, prompt: string, ingredients: MediaItem[], modelId: string, ratio: string): MediaItem | null;
  retry(item: MediaItem): void;
  removeVersion(item: MediaItem): void;
  rename(item: MediaItem, name: string): void;
  toggleFavorite(item: MediaItem): void;
  trash(item: MediaItem): void;
  /** Opens another gallery item (rail) or a version (history) in this editor. */
  open(item: MediaItem): void;
}

const ASPECTS = [
  { ratio: '16:9', icon: 'crop_16_9' },
  { ratio: '4:3', icon: 'crop_landscape' },
  { ratio: '1:1', icon: 'crop_square' },
  { ratio: '3:4', icon: 'crop_portrait' },
  { ratio: '9:16', icon: 'crop_9_16' },
];

const CROP_SHAPES: { id: string; icon: string; label: string; ratio: number | null }[] = [
  { id: '16:9', icon: 'crop_16_9', label: '16:9 Landscape', ratio: 16 / 9 },
  { id: '9:16', icon: 'crop_9_16', label: '9:16 Portrait', ratio: 9 / 16 },
  { id: '1:1', icon: 'crop_square', label: '1:1 Square', ratio: 1 },
  { id: 'free', icon: 'crop', label: 'Freeform', ratio: null },
];

const uid = () => `${Date.now()}-edit-${Math.random().toString(36).slice(2, 8)}`;

function defaultCropShape(ratio: string | undefined): (typeof CROP_SHAPES)[number] {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  const ar = w && h ? w / h : 16 / 9;
  return CROP_SHAPES.find((s) => s.ratio && Math.abs(s.ratio - ar) < 0.02) ?? CROP_SHAPES[3];
}

/** Flow's crop shape menu: a plain overlay 8px right of the button, centred on it, the current
 * shape highlighted. It appears without animating, and Escape or a press outside closes it while
 * cropping carries on. */
const CropMenu: React.FC<{
  trigger: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  selected: string | null;
  onPick: (shape: (typeof CROP_SHAPES)[number]) => void;
  onClose: () => void;
}> = ({ trigger, triggerRef, selected, onPick, onClose }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [top, setTop] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (ref.current) setTop(trigger.top + trigger.height / 2 - ref.current.offsetHeight / 2);
  }, [trigger]);
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, triggerRef]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Crop"
      className="ie-crop-menu"
      style={{ left: trigger.right + 8, top: top ?? -9999, visibility: top === null ? 'hidden' : 'visible' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {CROP_SHAPES.map((s) => (
        <button key={s.id} type="button" role="menuitem" className={`ie-crop-menu__item${selected === s.id ? ' is-selected' : ''}`} onClick={() => onPick(s)}>
          <FlowIcon name={s.icon} size={24} weight={300} />
          <span className="ie-crop-menu__label">{s.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
};

const nearestAspect = (ratio: string | undefined) => {
  const [w, h] = (ratio || '16:9').split(':').map(Number);
  const ar = w && h ? w / h : 16 / 9;
  let best = ASPECTS[0].ratio;
  let d = Infinity;
  for (const a of ASPECTS) {
    const [aw, ah] = a.ratio.split(':').map(Number);
    const dd = Math.abs(aw / ah - ar);
    if (dd < d) { d = dd; best = a.ratio; }
  }
  return best;
};

/** Every version of `item`'s image: the original and its edits, oldest first. */
export function imageVersions(item: MediaItem, items: MediaItem[]): MediaItem[] {
  const root = item.historyGroupId || item.id;
  const steps = items.filter((m) => m.kind === 'image' && (m.id === root || m.historyGroupId === root));
  if (!steps.some((m) => m.id === item.id)) steps.push(item);
  return steps.sort((a, b) => a.timestamp - b.timestamp);
}

export const ImageEditor: React.FC<{ itemId: string; host: SceneHost; edit: ImageEditHost }> = ({ itemId, host, edit }) => {
  const scenes = useStore($scenes);
  const itemById = React.useCallback((id: string) => host.mediaItems.find((m) => m.id === id), [host.mediaItems]);
  const item = itemById(itemId);
  const versions = React.useMemo(() => (item ? imageVersions(item, host.mediaItems) : []), [item, host.mediaItems]);

  // An edit that fails hands the view back to the image it was made from, as Flow's does.
  React.useEffect(() => {
    if (item?.status !== 'failed' || !item.historyParentId) return;
    const parent = itemById(item.historyParentId);
    if (parent) edit.open(parent);
  }, [item?.status, item?.historyParentId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- narrow screens (editor-responsive.css) ---- */
  const viewport = useMediaViewport();
  const narrow = viewport !== 'desktop';
  const phone = viewport === 'phone';
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const [moreMenu, setMoreMenu] = React.useState<MenuAnchor | null>(null);

  /* ---- history column ---- */
  const [historyShown, setHistoryShown] = React.useState(true);

  /* ---- header overlays ---- */
  const infoRef = React.useRef<HTMLButtonElement>(null);
  const [infoAnchor, setInfoAnchor] = React.useState<DOMRect | null>(null);
  const downloadRef = React.useRef<HTMLButtonElement>(null);
  const [download, setDownload] = React.useState<{ item: MediaItem; anchor: MenuAnchor; from: 'header' | 'history' } | null>(null);
  const [shareItem, setShareItem] = React.useState<MediaItem | null>(null);
  const [flagOpen, setFlagOpen] = React.useState(false);

  /* ---- crop ---- */
  const cropRef = React.useRef<HTMLButtonElement>(null);
  const [cropMenu, setCropMenu] = React.useState<MenuAnchor | null>(null);
  const [cropShape, setCropShape] = React.useState<(typeof CROP_SHAPES)[number] | null>(null);
  const cropBox = React.useRef<CropBox | null>(null);
  const onCropChange = React.useCallback((b: CropBox) => { cropBox.current = b; }, []);
  const [applyingCrop, setApplyingCrop] = React.useState(false);
  React.useEffect(() => { setCropShape(null); setCropMenu(null); }, [itemId]);

  /* ---- prompt ---- */
  const [prompt, setPrompt] = React.useState('');
  const [refs, setRefs] = React.useState<MediaItem[]>([]);
  const [picker, setPicker] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [prompt]);

  /* ---- edit settings ---- */
  const settingsRef = React.useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [modelMenu, setModelMenu] = React.useState<MenuAnchor | null>(null);
  const modelBtnRef = React.useRef<HTMLButtonElement>(null);
  const [modelId, setModelId] = React.useState(edit.defaultModelId);
  React.useEffect(() => {
    if (!edit.models.some((m) => m.id === modelId)) setModelId(edit.defaultModelId);
  }, [edit.models, edit.defaultModelId, modelId]);
  const [aspect, setAspect] = React.useState(() => nearestAspect(item?.ratio));
  React.useEffect(() => { setAspect(nearestAspect(item?.ratio)); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const modelName = edit.models.find((m) => m.id === modelId)?.name ?? 'No image model';

  const closeEditor = React.useCallback(() => host.close(), [host]);

  /* Escape with nothing open leaves the editor, as in the Scenebuilder. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && !typing && !cropShape) { e.preventDefault(); closeEditor(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeEditor, cropShape]);

  const railEntries = React.useMemo(() => buildRailEntries(scenes, host.mediaItems), [scenes, host.mediaItems]);
  const railActiveId = item ? (item.historyGroupId || item.id) : '';

  if (!item) return null;

  const pending = item.status === 'generating';
  // The header names and acts on the asset, not the version: Flow keeps the original's name, and
  // favourite, rename and trash apply to the whole history.
  const root = itemById(item.historyGroupId || item.id) ?? item;
  const name = root.shortenedPrompt || root.prompt;
  const parentOf = (m: MediaItem) => (m.historyParentId ? itemById(m.historyParentId) : undefined);
  const isGenerated = item.modelId !== 'upload' && item.modelId !== 'crop' && !/^Saved frame/.test(item.prompt);

  const submit = () => {
    const text = prompt.trim();
    if (!text || pending || !item.url) return;
    const created = edit.generate(item, text, refs, modelId, aspect);
    if (!created) return;
    setPrompt('');
    setRefs([]);
    edit.open(created);
  };

  const applyCrop = async () => {
    const box = cropBox.current;
    if (!box || !item.url) return;
    setApplyingCrop(true);
    try {
      const { dataUrl, width, height } = await cropImage(item.url, box);
      const groupId = item.historyGroupId || item.id;
      if (!item.historyGroupId) host.updateMediaItem(item.id, { historyGroupId: groupId });
      const version: MediaItem = {
        id: uid(),
        kind: 'image',
        status: 'completed',
        url: dataUrl,
        prompt: item.prompt,
        shortenedPrompt: item.shortenedPrompt,
        modelId: 'crop',
        modelName: item.modelName,
        ratio: `${width}:${height}`,
        timestamp: Date.now(),
        historyGroupId: groupId,
        historyParentId: item.id,
        collectionId: item.collectionId,
      };
      host.addMediaItem(version);
      host.saveGenerated(version, dataUrl);
      setCropShape(null);
      edit.open(version);
    } catch {
      showSnack({ icon: 'error', tone: 'error', text: 'The image could not be cropped.', actions: [{ label: 'Dismiss' }] });
    } finally {
      setApplyingCrop(false);
    }
  };

  const addToProject = (m: MediaItem) => {
    if (!m.url) return;
    host.addMediaItem({ ...m, id: uid(), historyGroupId: undefined, historyParentId: undefined, timestamp: Date.now(), isSavedToFS: false, fsName: undefined });
    showSnack({ icon: 'check_circle', text: 'Added to project', actions: [{ label: 'Dismiss' }] });
  };

  const historyProps = {
    steps: versions,
    selectedId: item.id,
    hidden: !historyShown,
    itemById,
    downloadFor: download?.from === 'history' ? download.item.id : null,
    actions: {
      onSelect: (m: MediaItem) => { if (m.id !== item.id) edit.open(m); },
      onSave: addToProject,
      onDownload: (m: MediaItem, anchor: MenuAnchor) => setDownload({ item: m, anchor, from: 'history' }),
      onFlag: () => setFlagOpen(true),
      onReuse: (m: MediaItem) => { setPrompt(m.prompt); textareaRef.current?.focus(); },
      onRetry: (m: MediaItem) => edit.retry(m),
      onDelete: (m: MediaItem) => edit.removeVersion(m),
      // Functional, as the narrow strip adds a version's ingredients all at once.
      onAddIngredient: (m: MediaItem) => setRefs((cur) => (cur.some((r) => r.id === m.id) ? cur : [...cur, m])),
    },
  };

  return (
    <div className="sb-editor ie-page" role="region" aria-label="Image editor">
      <header className="sb-header">
        <div className="sb-header__left">
          <nav className="sb-nav-header">
            <Tooltip content="Back" className="sb-tooltip">
              <button type="button" aria-label="Back button to go to previous page" className="sb-icon-btn sb-icon-btn--lg sb-back-btn" onClick={closeEditor}>
                <FlowIcon name="arrow_back" size={24} weight={300} />
              </button>
            </Tooltip>
            <span className="sb-title">
              <FlowEditableText value={name} onCommit={(v) => edit.rename(root, v)} />
            </span>
          </nav>
          {!phone && (
            <Tooltip content="Show asset info" className="sb-tooltip">
              <button
                ref={infoRef}
                type="button"
                aria-label="Show asset info"
                className="sb-icon-btn"
                onClick={() => setInfoAnchor(infoAnchor ? null : infoRef.current!.getBoundingClientRect())}
              >
                <FlowIcon name="info" size={18} />
              </button>
            </Tooltip>
          )}
        </div>
        <div className="sb-header__center">
          <NavigationRail
            entries={railEntries}
            activeId={railActiveId}
            activePending={pending}
            onPick={(entry) => {
              if (entry.id === railActiveId) return;
              if (entry.kind === 'scene') { host.close(); openScene(entry.id); return; }
              const target = itemById(entry.id);
              if (target) host.openMedia(target);
            }}
          />
        </div>
        <div className="sb-header__right">
          <div className="sb-cta">
            <Tooltip content={root.favorite ? 'Remove favorite' : 'Favorite'} className="sb-tooltip">
              <button type="button" aria-label={root.favorite ? 'Remove favorite' : 'Favorite'} className="sb-icon-btn" onClick={() => edit.toggleFavorite(root)}>
                <FlowIcon name="favorite" size={18} fill={!!root.favorite} />
              </button>
            </Tooltip>
            {(isGenerated || pending) && !phone && (
              <Tooltip content="Share" className="sb-tooltip">
                <button type="button" aria-label="Share" className="sb-icon-btn" disabled={pending} onClick={() => setShareItem(item)}>
                  <FlowIcon name="share" size={18} />
                </button>
              </Tooltip>
            )}
            {!phone && (
              <Tooltip content="Move to trash" className="sb-tooltip">
                <button type="button" aria-label="Move to trash" className="sb-icon-btn" onClick={() => edit.trash(root)}>
                  <FlowIcon name="delete" size={18} />
                </button>
              </Tooltip>
            )}
            <Tooltip content="Download media" className="sb-tooltip" disabled={pending}>
              <button
                ref={downloadRef}
                type="button"
                aria-label="Download media"
                aria-expanded={download?.from === 'header'}
                className="sb-icon-btn"
                disabled={pending}
                onClick={() => setDownload(download ? null : { item, anchor: { kind: 'below', rect: downloadRef.current!.getBoundingClientRect() }, from: 'header' })}
              >
                <FlowIcon name="download" size={18} />
              </button>
            </Tooltip>
            <button type="button" className="sb-btn ie-history-btn" onClick={() => setHistoryShown(!historyShown)}>
              <FlowIcon name="history" size={18} className="sb-btn__icon" />
              <span>{historyShown ? 'Hide history' : 'Show history'}</span>
            </button>
            {phone ? (
              <Tooltip content="More options" className="sb-tooltip">
                <button
                  ref={moreRef}
                  type="button"
                  aria-label="More options"
                  aria-expanded={!!moreMenu}
                  className="sb-icon-btn"
                  onClick={() => setMoreMenu(moreMenu ? null : { kind: 'below', rect: moreRef.current!.getBoundingClientRect() })}
                >
                  <FlowIcon name="more_vert" size={18} />
                </button>
              </Tooltip>
            ) : (
              <button type="button" aria-label="Done editing" className="sb-btn sb-btn--tonal" onClick={closeEditor}>
                <span>Done</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="ie-content">
        <div className="ie-editor-container">
          <div className="ie-image-editor">
            <div className="ie-options-and-image">
              <div className="ie-options">
                <Tooltip content="Crop" position="right" className="sb-tooltip" disabled={!!cropMenu}>
                  <button
                    ref={cropRef}
                    type="button"
                    aria-label="Button to open image cropping menu"
                    aria-expanded={!!cropMenu}
                    className={`sb-icon-btn${cropShape ? ' is-selected' : ''}`}
                    disabled={pending || !item.url}
                    onClick={() => {
                      // Narrow, the shapes are a row over Cancel and Crop, and the button toggles.
                      if (narrow) { setCropShape(cropShape ? null : defaultCropShape(item.ratio)); return; }
                      if (cropMenu) { setCropMenu(null); return; }
                      // Pressing crop starts cropping at once, in the shape nearest the image's, and
                      // offers the other shapes beside the button.
                      if (!cropShape) setCropShape(defaultCropShape(item.ratio));
                      setCropMenu({ kind: 'point', x: 0, y: 0 });
                    }}
                  >
                    <FlowIcon name="crop" size={24} weight={300} />
                  </button>
                </Tooltip>
              </div>
              <div className="ie-image-and-crop">
                <div className="ie-image-container">
                  {pending ? (
                    <div className="ie-pending-main" style={{ '--pending-tile-aspect-ratio': (() => { const [w, h] = (item.ratio || '16:9').split(':').map(Number); return w && h ? w / h : 16 / 9; })() } as React.CSSProperties}>
                      <GeneratingLayers isRevealing={false} />
                    </div>
                  ) : cropShape && item.url ? (
                    <ImageCropper key={`${item.id}:${cropShape.id}`} src={item.url} ratio={cropShape.ratio} onChange={onCropChange} />
                  ) : item.url ? (
                    <img className="ie-read-only-image" src={item.url} alt={name} draggable={false} />
                  ) : null}
                </div>
                {narrow && !cropShape && <ImageHistory layout="strip" {...historyProps} />}
                {narrow && cropShape && (
                  <div className="ie-crop-shapes" role="radiogroup" aria-label="Crop shape">
                    {CROP_SHAPES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={cropShape.id === s.id}
                        aria-label={s.label}
                        className={`ie-crop-shape${cropShape.id === s.id ? ' is-selected' : ''}`}
                        onClick={() => setCropShape(s)}
                      >
                        <FlowIcon name={s.icon} size={20} weight={300} />
                        <span>{s.ratio ? s.id : 'Free'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {cropShape ? (
                  <div className="ie-crop-actions">
                    <button type="button" aria-label="Cancel crop" className="sb-btn ie-crop-btn ie-crop-btn--outlined" onClick={() => setCropShape(null)}>
                      <FlowIcon name="close" size={18} weight={300} className="ie-crop-btn__icon" />
                      <span>Cancel</span>
                    </button>
                    <button type="button" aria-label="Apply crop" className="sb-btn ie-crop-btn ie-crop-btn--tonal" disabled={applyingCrop} onClick={() => void applyCrop()}>
                      <FlowIcon name="arrow_forward" size={18} weight={300} className="ie-crop-btn__icon" />
                      <span>Crop</span>
                    </button>
                  </div>
                ) : (
                  <div className="ie-prompt-slot">
                    {edit.notice && <div style={{ marginBottom: 8 }}>{edit.notice}</div>}
                    <div className="sb-prompt-wrapper">
                      <div className="sb-prompt-box">
                        {refs.length > 0 && (
                          <div className="sb-prompt-ingredients">
                            {refs.map((r) => (
                              <div key={r.id} className="sb-ingredient">
                                <img src={r.url} alt="" />
                                <button type="button" aria-label="Remove" className="sb-ingredient__remove" onClick={() => setRefs(refs.filter((x) => x.id !== r.id))}>
                                  <FlowIcon name="close" size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="sb-prompt-top">
                          <div className="sb-prompt-input" onClick={() => textareaRef.current?.focus()}>
                            {!prompt && <span className="sb-prompt-input__placeholder">What do you want to change?</span>}
                            <textarea
                              ref={textareaRef}
                              className="sb-prompt-input__textarea"
                              rows={1}
                              value={prompt}
                              aria-label="What do you want to change?"
                              onChange={(e) => setPrompt(e.target.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                                if (e.key === 'Escape') textareaRef.current?.blur();
                              }}
                            />
                          </div>
                          <div className="sb-prompt-actions">
                            {prompt && (
                              <Tooltip content="Clear prompt" className="sb-tooltip">
                                <button type="button" aria-label="Clear prompt" className="sb-icon-btn sb-prompt-clear" onClick={() => setPrompt('')}>
                                  <FlowIcon name="close" size={16} />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                        <div className="sb-prompt-bottom">
                          <Tooltip content="Add ingredients to the prompt box" className="sb-tooltip">
                            <button
                              type="button"
                              aria-label="Add ingredients to the prompt box"
                              className={`sb-icon-btn sb-prompt-add${picker ? ' is-active' : ''}`}
                              onClick={() => setPicker(!picker)}
                            >
                              <FlowIcon name="add" size={20} weight={200} />
                            </button>
                          </Tooltip>
                          <div className="sb-prompt-submit">
                            <button
                              ref={settingsRef}
                              type="button"
                              aria-label="Settings trigger"
                              aria-expanded={settingsOpen}
                              className="ie-settings-trigger"
                              onClick={() => setSettingsOpen(!settingsOpen)}
                            >
                              <span className="ie-settings-summary">
                                <span>{modelName}</span>
                                <FlowIcon name={ratioIcon(aspect)} size={18} />
                              </span>
                            </button>
                            <Tooltip content="Start generation" className="sb-tooltip" disabled={!prompt.trim()}>
                              <button
                                type="submit"
                                aria-label="Start generation"
                                className="sb-icon-btn sb-generate"
                                disabled={!prompt.trim() || pending || !item.url}
                                onClick={submit}
                              >
                                <FlowIcon name="arrow_forward" size={18} />
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {!narrow && <ImageHistory {...historyProps} />}
      </div>

      <p className="sb-footer-disclaimer">Willow can make mistakes, so double check it</p>

      <InfoPopover item={root} anchor={infoAnchor} triggerRef={phone ? moreRef : infoRef} onClose={() => setInfoAnchor(null)} />
      <DownloadMenu
        item={download?.item ?? null}
        anchor={download?.anchor ?? null}
        onClose={() => setDownload(null)}
        ignoreRefs={download?.from === 'header' ? [downloadRef] : undefined}
      />
      <ShareDialog item={shareItem} parent={shareItem ? parentOf(shareItem) : undefined} onClose={() => setShareItem(null)} />
      <FlagDialog open={flagOpen} onClose={() => setFlagOpen(false)} />

      {cropMenu && cropRef.current && (
        <CropMenu
          trigger={cropRef.current.getBoundingClientRect()}
          triggerRef={cropRef}
          selected={cropShape?.id ?? null}
          onPick={(s) => { setCropShape(s); setCropMenu(null); }}
          onClose={() => setCropMenu(null)}
        />
      )}

      {settingsOpen && (
        <EditSettings
          anchor={settingsRef.current?.getBoundingClientRect() ?? null}
          triggerRef={settingsRef}
          aspect={aspect}
          onAspect={setAspect}
          modelName={modelName}
          modelBtnRef={modelBtnRef}
          onModelMenu={() => setModelMenu(modelMenu ? null : { kind: 'below', rect: modelBtnRef.current!.getBoundingClientRect() })}
          modelMenuOpen={!!modelMenu}
          onClose={() => { setSettingsOpen(false); setModelMenu(null); }}
          sheet={narrow}
        />
      )}
      {phone && (
        <FlowMatMenu open={!!moreMenu} onClose={() => setMoreMenu(null)} anchor={moreMenu} ignoreRefs={[moreRef]} ariaLabel="More options">
          <FlowMatMenuItem icon="info" label="Show asset info" onSelect={() => setInfoAnchor(moreRef.current?.getBoundingClientRect() ?? null)} />
          {(isGenerated || pending) && <FlowMatMenuItem icon="share" label="Share" disabled={pending} onSelect={() => setShareItem(item)} />}
          <FlowMatMenuItem icon="delete" label="Move to trash" onSelect={() => edit.trash(root)} />
        </FlowMatMenu>
      )}
      <FlowMatMenu open={!!modelMenu} onClose={() => setModelMenu(null)} anchor={modelMenu} ignoreRefs={[modelBtnRef]} ariaLabel="Model">
        {edit.models.map((m) => (
          <FlowMatMenuItem key={m.id} label={m.name} onSelect={() => setModelId(m.id)} />
        ))}
      </FlowMatMenu>

      <SceneMediaPicker
        open={picker}
        mode="prompt"
        items={host.mediaItems}
        projectName={host.projectName}
        projectId={host.projectId}
        projects={picker ? host.listProjects() : []}
        loadProjectMedia={host.loadProjectMedia}
        adopt={(m) => m}
        onClose={() => setPicker(false)}
        onImport={(files) => host.importFiles(files)}
        onConfirm={(m) => {
          setPicker(false);
          if (m.url && !refs.some((r) => r.id === m.id)) setRefs([...refs, m]);
        }}
      />
    </div>
  );
};

/** flow-prompt-box-settings for an image edit: the shape, then the model. */
const EditSettings: React.FC<{
  anchor: DOMRect | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  aspect: string;
  onAspect: (ratio: string) => void;
  modelName: string;
  modelBtnRef: React.RefObject<HTMLButtonElement | null>;
  onModelMenu: () => void;
  modelMenuOpen: boolean;
  onClose: () => void;
  /** Below 961px: a sheet docked to the bottom (editor-responsive.css), over a dimmed page. */
  sheet?: boolean;
}> = ({ anchor, triggerRef, aspect, onAspect, modelName, modelBtnRef, onModelMenu, modelMenuOpen, onClose, sheet = false }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    if (sheet) { setPos({ left: 0, top: 0 }); return; }
    if (!anchor || !ref.current) return;
    const h = ref.current.offsetHeight;
    const w = ref.current.offsetWidth;
    setPos({ left: anchor.right - w, top: anchor.top - 12.4 - h });
  }, [anchor, sheet]);
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || triggerRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest('[data-sb-menu]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modelMenuOpen) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, triggerRef, modelMenuOpen]);
  return (
    <>
    {sheet && <div className="ie-settings-backdrop" aria-hidden="true" />}
    <div
      ref={ref}
      className={`ie-settings${sheet ? ' is-sheet' : ''}`}
      style={sheet ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="ie-settings__content">
        <div role="radiogroup" aria-label="Aspect ratio" className="ie-toggles">
          {ASPECTS.map((a) => (
            <button
              key={a.ratio}
              type="button"
              role="radio"
              aria-checked={aspect === a.ratio}
              className={`ie-toggle${aspect === a.ratio ? ' is-checked' : ''}`}
              onClick={() => onAspect(a.ratio)}
            >
              <span className="ie-toggle__label">
                <FlowIcon name={a.icon} size={18} />
                <span className="ie-toggle__text">{a.ratio}</span>
              </span>
            </button>
          ))}
        </div>
        <div role="separator" className="ie-settings__divider" />
        <button
          ref={modelBtnRef}
          type="button"
          aria-label="Select model family"
          aria-expanded={modelMenuOpen}
          className="ie-model-select"
          onClick={onModelMenu}
        >
          <span className="ie-model-select__content">
            <span>{modelName}</span>
            <FlowIcon name="arrow_drop_down" size={18} />
          </span>
        </button>
      </div>
    </div>
    </>
  );
};

export default ImageEditor;
