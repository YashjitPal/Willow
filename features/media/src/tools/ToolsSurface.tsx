/**
 * The Tools pages (Flow's Tools tab), over the Media editor: the manager at /media/tools, a tool
 * at /media/tool/<id> and Create tool at /media/create-tool. MediaView mounts this as it mounts
 * the Scenebuilder, portalled to <body> and stopped at its root, and hands it a `ToolsHost`.
 *
 * Everything Flow styles lives under `.ng-flow-tools` (see `flow-tools.css`). The dialogs any
 * page opens are held here, so a dialog outlives the page that asked for it.
 */
import React from 'react';
import { useStore } from '@nanostores/react';
import type { MediaItem } from '../types';
import { SceneMediaPicker, type PickerMode } from '../scenes/SceneMediaPicker';
import { ConfirmDialog } from '../editor/editor-overlays';
import { showSnack } from '../scenes/scene-store';
import { CreateToolPage } from './CreateToolPage';
import { CommunityPreviewDialog, DescriptionDialog, EditIconDialog, imageToDataUrl, ShareToolDialog, SubmitToGalleryDialog } from './ToolDialogs';
import { ToolsManagerPage } from './ToolsManagerPage';
import { ToolViewPage } from './ToolViewPage';
import type { MediaPickRequest } from './tool-sdk-host';
import type { ToolsHost } from './tools-host';
import type { ToolsRoute } from './tools-routes';
import { $toolsLoaded, deleteTool, initToolsStore, type ToolEntry } from './tools-store';
import { ToolsUiContext, type ToolsUi } from './tools-ui';
import { TooltipHost } from './ui';
import './tools-defaults.css';
import './flow-tools.css';
import './tools-willow.css';
import './tools-responsive.css';

interface PickState {
  request: MediaPickRequest;
  resolve: (items: MediaItem[] | null) => void;
}

const pickerMode = (request: MediaPickRequest): PickerMode =>
  request.filter === 'image' ? 'image' : request.filter === 'video' ? 'clip' : 'tool';

export const ToolsSurface: React.FC<{ route: ToolsRoute; host: ToolsHost }> = ({ route, host }) => {
  const hostRef = React.useRef(host);
  hostRef.current = host;
  const loaded = useStore($toolsLoaded);
  React.useEffect(() => { void initToolsStore(host.scopeId); }, [host.scopeId]);

  const [share, setShare] = React.useState<ToolEntry | null>(null);
  const [featured, setFeatured] = React.useState<ToolEntry | null>(null);
  const [iconFor, setIconFor] = React.useState<ToolEntry | null>(null);
  const [describing, setDescribing] = React.useState<ToolEntry | null>(null);
  const [deleting, setDeleting] = React.useState<{ entry: ToolEntry; resolve: (gone: boolean) => void } | null>(null);
  const confirmed = React.useRef(new WeakSet<object>());
  const [preview, setPreview] = React.useState<{ entry: ToolEntry; resolve: (open: boolean) => void } | null>(null);
  const [pick, setPick] = React.useState<PickState | null>(null);

  const pickMedia = React.useCallback((request: MediaPickRequest) => new Promise<MediaItem[] | null>((resolve) => {
    setPick((prev) => { prev?.resolve(null); return { request, resolve }; });
  }), []);
  const finishPick = (items: MediaItem[] | null) => {
    pick?.resolve(items);
    setPick(null);
  };
  /** A picture from the project (or an upload), as a data URL for an icon or a cover. */
  const pickImage = React.useCallback(async (max: number): Promise<string | null> => {
    const [item] = (await pickMedia({ filter: 'image', multiple: false })) ?? [];
    if (!item?.url) return null;
    try {
      return await imageToDataUrl(item.url, max, 'image/webp');
    } catch {
      showSnack({ icon: 'error', text: 'Failed to read that image', actions: [{ label: 'Dismiss' }], tone: 'error' });
      return null;
    }
  }, [pickMedia]);

  const ui = React.useMemo<ToolsUi>(() => ({
    get host() { return hostRef.current; },
    openShare: setShare,
    confirmDelete: (entry) => new Promise<boolean>((resolve) => setDeleting({ entry, resolve })),
    previewCommunity: (entry) => new Promise<boolean>((resolve) => setPreview({ entry, resolve })),
    pickMedia,
    openIconDialog: setIconFor,
    openFeatured: setFeatured,
    openDescription: setDescribing,
    pickImage,
  }), [pickMedia, pickImage]);

  return (
    <ToolsUiContext.Provider value={ui}>
      <div className="ng-flow-tools wt-tools-surface dark-theme">
        {loaded && route.page === 'manager' && <ToolsManagerPage />}
        {loaded && route.page === 'create' && <CreateToolPage />}
        {loaded && route.page === 'view' && <ToolViewPage key={route.toolId} route={route} />}
        {!loaded && <div className="wt-tools-loading" />}
      </div>
      <TooltipHost />
      <ShareToolDialog entry={share} onClose={() => setShare(null)} />
      <SubmitToGalleryDialog entry={featured} onClose={() => setFeatured(null)} pickImage={() => pickImage(1600)} />
      <EditIconDialog entry={iconFor} onClose={() => setIconFor(null)} pickImage={() => pickImage(512)} />
      <DescriptionDialog entry={describing} onClose={() => setDescribing(null)} />
      <CommunityPreviewDialog
        entry={preview?.entry ?? null}
        onClose={(open) => { preview?.resolve(open); setPreview(null); }}
      />
      <ConfirmDialog
        open={!!deleting}
        icon="warning"
        message="Deleting this app will delete it for anyone who it's been shared with."
        confirmLabel="Delete"
        onClose={() => {
          // ConfirmDialog closes before it confirms; a close that no confirm follows is a cancel.
          const target = deleting;
          setDeleting(null);
          queueMicrotask(() => { if (target && !confirmed.current.has(target)) target.resolve(false); });
        }}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          confirmed.current.add(target);
          void deleteTool(target.entry.id)
            .then(() => target.resolve(true))
            .catch(() => {
              target.resolve(false);
              showSnack({ icon: 'error', text: 'Failed to delete tool', actions: [{ label: 'Dismiss' }], tone: 'error' });
            });
        }}
      />
      <SceneMediaPicker
        open={!!pick}
        mode={pick ? pickerMode(pick.request) : 'image'}
        multiple={pick?.request.multiple}
        maxCount={pick?.request.maxCount}
        items={host.mediaItems}
        projectName={host.projectName}
        projectId={host.projectId}
        projects={host.listProjects()}
        loadProjectMedia={host.loadProjectMedia}
        adopt={host.adoptMedia}
        onClose={() => finishPick(null)}
        onImport={host.importFiles}
        onConfirm={(item) => finishPick([item])}
        onConfirmMany={(items) => finishPick(items)}
      />
    </ToolsUiContext.Provider>
  );
};

export default ToolsSurface;
