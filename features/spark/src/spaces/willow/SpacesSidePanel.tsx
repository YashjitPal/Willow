import { useEffect, useRef } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import {
  activateRightPanelTab,
  closeRightPanelTab,
  setRightPanelFullWidth,
  setRightPanelOpen,
  useRightPanelOutletStore,
  useRightPanelStore,
} from './shell/right-panel-state';

const SYMBOL = { size: 20, opticalSize: 20, weight: 400 } as const;

/**
 * Codex's right panel as a Material side sheet: a preview a page published
 * (`RightPanelOutlet`) or the tabs opened beside it (a Page, a library file).
 */
export function SpacesSidePanel() {
  const isOpen = useRightPanelStore((state) => state.isOpen);
  const isFullWidth = useRightPanelStore((state) => state.isFullWidth);
  const tabs = useRightPanelStore((state) => state.tabs);
  const activeTabId = useRightPanelStore((state) => state.activeTabId);
  const detail = useRightPanelOutletStore((state) => state.detail);
  const active = tabs.find((tab) => tab.tabId === activeTabId) ?? null;
  const showsTabs = detail == null && active != null;
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen || !showsTabs || !active?.closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // Kept mounted behind another tab (`inert`), Spark leaves the Escape to the tab on show.
      if (panelRef.current?.closest('[inert]')) return;
      event.preventDefault();
      closeRightPanelTab(active.tabId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, isOpen, showsTabs]);

  if (!isOpen || (detail == null && active == null)) return null;

  return (
    <aside ref={panelRef} className={`spaces-side-panel${isFullWidth ? ' is-full-width' : ''}`} aria-label={showsTabs ? active.title : undefined}>
      {detail != null ? (
        <div className="spaces-side-panel__detail">{detail}</div>
      ) : (
        <>
          <header className="spaces-side-panel__header">
            <div className="spaces-side-panel__tabs" role="tablist">
              {tabs.map((tab) => (
                <button
                  key={tab.tabId}
                  type="button"
                  role="tab"
                  data-tab-id={tab.tabId}
                  aria-selected={tab.tabId === activeTabId}
                  title={tab.tooltip ?? tab.title}
                  className={`spaces-side-panel__tab${tab.tabId === activeTabId ? ' is-active' : ''}`}
                  onClick={() => activateRightPanelTab(tab.tabId)}
                >
                  {tab.icon != null && <span className="spaces-side-panel__tab-icon">{tab.icon}</span>}
                  <span className="spaces-side-panel__tab-title">{tab.titleContent ?? tab.title}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Close ${tab.title}`}
                    className="spaces-side-panel__tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeRightPanelTab(tab.tabId);
                    }}
                  >
                    <MaterialSymbol name="close" size={16} opticalSize={20} weight={400} />
                  </span>
                </button>
              ))}
            </div>
            <div className="spaces-side-panel__actions">
              {active.allowFullWidth && (
                <button
                  type="button"
                  className="spaces-icon-button"
                  aria-label={isFullWidth ? 'Exit full width' : 'Full width'}
                  title={isFullWidth ? 'Exit full width' : 'Full width'}
                  onClick={() => setRightPanelFullWidth(!isFullWidth)}
                >
                  <MaterialSymbol name={isFullWidth ? 'close_fullscreen' : 'open_in_full'} {...SYMBOL} />
                </button>
              )}
              <button type="button" className="spaces-icon-button" aria-label="Close panel" title="Close panel" onClick={() => setRightPanelOpen(false)}>
                <MaterialSymbol name="right_panel_close" {...SYMBOL} />
              </button>
            </div>
          </header>
          <div className="spaces-side-panel__body">
            {tabs.map((tab) => (
              <div key={tab.tabId} className="spaces-side-panel__tab-panel" data-tab-id={tab.tabId} hidden={tab.tabId !== activeTabId} role="tabpanel">
                {tab.render({ isVisible: tab.tabId === activeTabId, onClose: () => closeRightPanelTab(tab.tabId) })}
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
