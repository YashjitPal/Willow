/**
 * Willow Figma — workspace root mounted by the studio's "Figma" tab.
 *
 * Owns the surface switch (home file browser ⇄ editor), the EditorStore
 * lifecycle for the open file, autosave, thumbnails and the realtime
 * multiplayer connection. Everything below this component is Figma-clone UI.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './figma.css';
import { figmaApi } from './lib/api';
import { RealtimeClient } from './lib/realtime';
import { diffDocs, EditorContext, EditorStore } from './lib/store';
import { getLocalUser } from './lib/user';
import { layoutDocument } from './lib/scene';
import type { FigDocument, FigFileMeta } from './lib/types';
import { FigmaHome } from './home/FigmaHome';
import { EditorView } from './editor/EditorView';
import { renderThumbnail } from './lib/export';

interface FigmaWorkspaceProps {
  isSidebarCollapsed?: boolean;
  onClose?: () => void;
}

type Surface = { kind: 'home' } | { kind: 'loading'; fileId: string } | { kind: 'editor'; fileId: string };

const SAVE_DEBOUNCE_MS = 800;
const THUMBNAIL_INTERVAL_MS = 15000;

export const FigmaWorkspace: React.FC<FigmaWorkspaceProps> = ({ onClose }) => {
  const [surface, setSurface] = useState<Surface>({ kind: 'home' });
  const [store, setStore] = useState<EditorStore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const user = useMemo(() => getLocalUser(), []);

  const realtimeRef = useRef<RealtimeClient | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const thumbTimerRef = useRef<number | null>(null);
  const suppressBroadcastRef = useRef(false);
  const storeRef = useRef<EditorStore | null>(null);
  storeRef.current = store;

  const flushSave = useCallback(async () => {
    const s = storeRef.current;
    if (!s || s.state.saveState === 'saved') return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const doc = s.state.doc;
    s.setState({ saveState: 'saving' });
    try {
      await figmaApi.saveDoc(doc.id, doc);
      // Only mark saved when no newer edits arrived while the PUT ran.
      if (storeRef.current === s && s.state.doc.revision === doc.revision) {
        s.setState({ saveState: 'saved' });
      } else if (storeRef.current === s) {
        s.setState({ saveState: 'dirty' });
      }
    } catch {
      if (storeRef.current === s) s.setState({ saveState: 'offline' });
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const pushThumbnail = useCallback(async () => {
    const s = storeRef.current;
    if (!s) return;
    try {
      const dataUrl = renderThumbnail(s.state.doc, s.state.currentPageId, 480, 300);
      if (dataUrl) await figmaApi.patchFile(s.state.doc.id, { thumbnail: dataUrl });
    } catch {
      /* thumbnails are best-effort */
    }
  }, []);

  const openFile = useCallback(
    async (fileId: string) => {
      setLoadError(null);
      setSurface({ kind: 'loading', fileId });
      let doc: FigDocument;
      let file: FigFileMeta;
      try {
        const res = await figmaApi.getFile(fileId);
        doc = res.doc;
        file = res.file;
      } catch (e) {
        setLoadError((e as Error).message);
        setSurface({ kind: 'home' });
        return;
      }

      const s = new EditorStore(layoutDocument(doc), file);

      // Realtime: presence + live ops relay.
      const rt = new RealtimeClient(fileId, user, {
        onWelcome: (_selfId, peers) => {
          for (const p of peers) s.setPeer(p.peerId, p.state);
        },
        onPeerJoin: (peerId, state) => s.setPeer(peerId, state),
        onPeerLeave: (peerId) => s.setPeer(peerId, null),
        onCursor: (peerId, pageId, x, y) => s.patchPeer(peerId, { pageId, cursor: { x, y } }),
        onCursorHide: (peerId) => s.patchPeer(peerId, { cursor: null }),
        onSelection: (peerId, ids, pageId) => s.patchPeer(peerId, { selection: ids, pageId }),
        onOps: (_peerId, ops) => {
          suppressBroadcastRef.current = true;
          try {
            s.applyRemoteOps(ops);
          } finally {
            suppressBroadcastRef.current = false;
          }
        },
      });
      realtimeRef.current = rt;

      s.onDocCommitted = (prev, next) => {
        if (suppressBroadcastRef.current) return; // remote merge — don't echo or save
        const ops = diffDocs(prev, next);
        if (ops) rt.sendOps(ops);
        scheduleSave();
      };

      // Comments load (best-effort).
      void figmaApi
        .listComments(fileId)
        .then(({ comments }) => {
          if (storeRef.current === s || storeRef.current === null) s.setState({ comments });
        })
        .catch(() => undefined);

      setStore(s);
      setSurface({ kind: 'editor', fileId });

      // Periodic thumbnail refresh while editing.
      thumbTimerRef.current = window.setInterval(() => void pushThumbnail(), THUMBNAIL_INTERVAL_MS);
    },
    [pushThumbnail, scheduleSave, user],
  );

  const closeFile = useCallback(async () => {
    await flushSave();
    void pushThumbnail();
    realtimeRef.current?.destroy();
    realtimeRef.current = null;
    if (thumbTimerRef.current !== null) window.clearInterval(thumbTimerRef.current);
    thumbTimerRef.current = null;
    setStore(null);
    setSurface({ kind: 'home' });
  }, [flushSave, pushThumbnail]);

  // Teardown when the whole tab unmounts.
  useEffect(() => {
    return () => {
      realtimeRef.current?.destroy();
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (thumbTimerRef.current !== null) window.clearInterval(thumbTimerRef.current);
      // Fire-and-forget final save.
      const s = storeRef.current;
      if (s && s.state.saveState !== 'saved') {
        void figmaApi.saveDoc(s.state.doc.id, s.state.doc).catch(() => undefined);
      }
    };
  }, []);

  return (
    <div className="figx-root h-full w-full overflow-hidden" style={{ background: '#1e1e1e' }}>
      {surface.kind === 'home' && (
        <FigmaHome onOpenFile={(id) => void openFile(id)} onExit={onClose} loadError={loadError} />
      )}
      {surface.kind === 'loading' && (
        <div className="flex h-full w-full items-center justify-center" style={{ background: '#1e1e1e' }}>
          <div className="flex flex-col items-center gap-3">
            <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.15)', borderTopColor: '#0d99ff' }} />
            <span style={{ color: '#b3b3b3', fontSize: 12 }}>Opening file…</span>
          </div>
        </div>
      )}
      {surface.kind === 'editor' && store && (
        <EditorContext.Provider value={store}>
          <EditorView onBack={() => void closeFile()} />
        </EditorContext.Provider>
      )}
    </div>
  );
};

export default FigmaWorkspace;
