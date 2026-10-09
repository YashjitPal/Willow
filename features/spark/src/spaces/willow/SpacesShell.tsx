import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { PaneHeaderSlotContext } from '../../codex/ui/pane-header';
import { useSpacesHeaderStore } from './shell/main-area';
import { useRightPanelStore } from './shell/right-panel-state';
import { SpacesSidePanel } from './SpacesSidePanel';
import '../codex-spaces.css';
import './spaces-theme.css';
import './spaces-design.css';
import './spaces-shell.css';

/**
 * Pages inside Spark: the page a Pages route renders, the top bar that holds
 * the header a Page or a scrolled page puts there (Codex's shell header slot),
 * the side sheet that Codex's right panel tabs open in, and the snackbars.
 */
export function SpacesShell({ children }: { children: ReactNode }) {
  const pageHeader = useSpacesHeaderStore((state) => state.pageHeader);
  const [paneHeader, setPaneHeader] = useState<ReactNode>(null);
  const sidePanelOpen = useRightPanelStore((state) => state.isOpen);
  const sidePanelFullWidth = useRightPanelStore((state) => state.isFullWidth);
  const topBar = pageHeader ?? paneHeader;
  return (
    <PaneHeaderSlotContext.Provider value={setPaneHeader}>
      <div
        className="willow-spaces spaces-shell"
        data-side-panel={sidePanelOpen ? (sidePanelFullWidth ? 'full' : 'open') : undefined}
      >
        <div className="spaces-shell__workspace" data-page-header={pageHeader != null || undefined}>
          {topBar != null && <header className={`spaces-shell__topbar${pageHeader == null ? ' is-pane-header' : ''}`}>{topBar}</header>}
          <div className="spaces-shell__main">{children}</div>
        </div>
        <SpacesSidePanel />
        <Toaster
          className="spaces-snackbars"
          position="bottom-left"
          gap={8}
          visibleToasts={3}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast: 'spaces-snackbar',
              title: 'spaces-snackbar__title',
              description: 'spaces-snackbar__description',
              actionButton: 'spaces-snackbar__action',
              cancelButton: 'spaces-snackbar__action',
              closeButton: 'spaces-snackbar__close',
              icon: 'spaces-snackbar__icon',
            },
          }}
        />
      </div>
    </PaneHeaderSlotContext.Provider>
  );
}
