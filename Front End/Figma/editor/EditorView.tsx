/**
 * Willow Figma — editor layout: docked top bar, left panel (pages/layers/
 * assets), full-bleed canvas, right panel (design/prototype/inspect), the
 * floating bottom toolbar, context menu, quick actions and present mode.
 */

import React, { useCallback, useRef, useState } from 'react';
import { useEditor, useEditorStore } from '../lib/store';
import type { InteractionEngine } from '../lib/contracts';
import type { Vec2 } from '../lib/types';
import { CanvasHost } from './canvas/CanvasHost';
import { TopBar } from './topbar/TopBar';
import { Toolbar } from './toolbar/Toolbar';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { CanvasContextMenu } from './menus/ContextMenu';
import { QuickActions } from './menus/QuickActions';
import { PresentMode } from './PresentMode';
import { useGlobalShortcuts } from './shortcuts';

interface EditorViewProps {
  onBack: () => void;
}

export interface ContextMenuState {
  screen: Vec2;
  world: Vec2;
}

export const EditorView: React.FC<EditorViewProps> = ({ onBack }) => {
  const store = useEditorStore();
  const showUI = useEditor((s) => s.showUI);
  const presentingFrameId = useEditor((s) => s.presentingFrameId);

  const engineRef = useRef<InteractionEngine | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  useGlobalShortcuts({
    engineRef,
    onOpenQuickActions: () => setQuickActionsOpen(true),
  });

  const handleContextMenu = useCallback((screen: Vec2, world: Vec2) => {
    setContextMenu({ screen, world });
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#1e1e1e' }}>
      {/* Canvas fills everything; panels overlay it. */}
      <div className="absolute inset-0" style={{ top: showUI ? 48 : 0 }}>
        <CanvasHost engineRef={engineRef} onContextMenu={handleContextMenu} />
      </div>

      {showUI && (
        <>
          <TopBar onBack={onBack} />
          <div className="absolute left-0 bottom-0" style={{ top: 48, width: 256 }}>
            <LeftPanel />
          </div>
          <div className="absolute right-0 bottom-0" style={{ top: 48, width: 264 }}>
            <RightPanel />
          </div>
          <Toolbar />
        </>
      )}

      {contextMenu && (
        <CanvasContextMenu
          screen={contextMenu.screen}
          world={contextMenu.world}
          onClose={() => setContextMenu(null)}
        />
      )}

      {quickActionsOpen && <QuickActions onClose={() => setQuickActionsOpen(false)} />}

      {presentingFrameId && <PresentMode onExit={() => store.setState({ presentingFrameId: null })} />}
    </div>
  );
};
