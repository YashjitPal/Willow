/**
 * Flow's tool page (`flow-applet-view-page`) at /media/tool/<id>: its header, the tool running in
 * its frame, Flow's footer, and in Edit the Preview/Code tabs with the Tool Builder beside them.
 *
 * As in Flow:
 * - a template opens as your copy of it ("Remix of …", made once and reused), and the address
 *   moves to the copy; community tools run as they are, and only Remix makes them yours;
 * - your own tool's header edits its name and icon and switches Tool/Edit; anyone else's offers
 *   Remix tool instead;
 * - the frame sits under Flow's Perlin overlay while it compiles and boots, a compile failure
 *   shows "Tool has failed to run." with Fix it (Remix & Fix for a tool not yours), and a runtime
 *   error shows the warning banner above it;
 * - Back and Done go to the Tools page when the tool was opened from there, else to the gallery.
 *
 * Willow's: Reload runs the tool again rather than reloading the whole page, and the footer says
 * "Willow" where Flow's says "Google Flow".
 */
import React from 'react';
import { useStore } from '@nanostores/react';
import { FlowMatDivider, FlowMatMenu, FlowMatMenuItem } from '../scenes/flow-ui';
import { showSnack } from '../scenes/scene-store';
import { builderSession, type BuilderEnv } from './builder-session';
import { ASSET_BASE } from './catalog';
import { openReport } from './ToolDialogs';
import { ToolBuilderPanel } from './ToolBuilderPanel';
import { ToolCodeExplorer } from './ToolCodeExplorer';
import { ToolRunner, type RunnerEvent } from './runtime/bridge';
import type { ToolFile } from './runtime/compiler';
import { createToolSdkHost } from './tool-sdk-host';
import type { ToolsHost } from './tools-host';
import { galleryLocation, toolLocation, toolsLocation, type ToolMode, type ToolsRoute } from './tools-routes';
import {
  $toolPrefs, $tools, loadLocalStorage, loadToolFiles, noteToolOpened, openTemplateCopy, remixTool, renameTool,
  toggleFavorite, togglePin, toolEntry, toolKind, touchTool, UNTITLED_TOOL, type ToolEntry,
} from './tools-store';
import { useToolsUi, type ToolsUi } from './tools-ui';
import { cx, EditableText, FlowButton, FlowIconButton, FlowToggles, MatIcon, useTooltip, type EditableTextHandle } from './ui';
import { useMediaViewport } from '../use-media-viewport';

type ViewRoute = Extract<ToolsRoute, { page: 'view' }>;
type ContentTab = 'PREVIEW' | 'CODE';

const MODES = [{ value: 'APP', label: 'Tool' }, { value: 'EDIT', label: 'Edit' }] as const;
const TABS: readonly { id: ContentTab; label: string; tabId: string; panelId: string }[] = [
  { id: 'PREVIEW', label: 'Preview', tabId: 'applet-tab-preview', panelId: 'applet-panel-preview' },
  { id: 'CODE', label: 'Code', tabId: 'applet-tab-code', panelId: 'applet-panel-code' },
];
const PERLIN_URL = `url(https://www.gstatic.com/aitestkitchen/website/flow/images/perlin.png)`;
const NOT_FOUND_IMAGE = `${ASSET_BASE}default/ada-not-found.png`;
const REPORT_UNSAFE_URL = 'https://support.google.com/legal/troubleshooter/1114905?uraw=r_20cf4f41bc75e35e#ts=1115658%2C13774968';
const DISCLAIMER = 'Willow can make mistakes, so double check it.';
const CREDITS = 'This Tool may consume credits';
const CREDITS_TIP = 'Running this Tool could consume your AI credits. Ensure you are aware of how many credits may be used before running.';

const builderEnv = (host: ToolsHost): BuilderEnv => ({ modelConfig: host.modelConfig, apiKeys: host.apiKeys, geminiKey: host.geminiKeys[0] });

/** Back and Done: the Tools page when the tool was opened from it, else the gallery. */
const leave = (host: ToolsHost, from: string | null) => host.navigate(from === 'tools' ? toolsLocation(host.search) : galleryLocation(host.search));

const success = (text: string) => showSnack({ icon: 'check_circle', text, actions: [{ label: 'Dismiss' }] });
const failure = (text: string) => showSnack({ icon: 'error', text, actions: [{ label: 'Dismiss' }], tone: 'error' });

/** Remix tool: your copy, opened in Edit. */
async function remixAndOpen(ui: ToolsUi, entry: ToolEntry): Promise<string | null> {
  try {
    const copy = await remixTool(entry.id);
    success('Tool remixed and added to your gallery.');
    ui.host.navigate(toolLocation(ui.host.search, copy.id, { mode: 'EDIT' }));
    return copy.id;
  } catch {
    failure('Failed to remix tool');
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

export const ToolViewPage: React.FC<{ route: ViewRoute }> = ({ route }) => {
  const ui = useToolsUi();
  useStore($tools);
  useStore($toolPrefs);
  const kind = toolKind(route.toolId);
  const [copyFailed, setCopyFailed] = React.useState(false);

  React.useEffect(() => {
    if (kind !== 'template') return undefined;
    let cancelled = false;
    openTemplateCopy(route.toolId)
      .then((copy) => {
        if (!cancelled) ui.host.navigate(toolLocation(ui.host.search, copy.id, { mode: route.mode ?? undefined, from: route.from }), { replace: true });
      })
      .catch(() => { if (!cancelled) setCopyFailed(true); });
    return () => { cancelled = true; };
  }, [kind, route.toolId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tool deleted from this page stays on screen until Delete's navigation lands.
  const shown = React.useRef<ToolEntry | null>(null);
  const entry = toolEntry(route.toolId) ?? (kind === null ? shown.current : null);
  shown.current = entry;
  if (!entry || copyFailed) return <NotFoundPage onBack={() => leave(ui.host, route.from)} />;
  return <ToolViewer entry={entry} route={route} preparing={kind === 'template'} />;
};

const NotFoundPage: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="ng-flow-applet-view-page">
    <div className="applet-view-page">
      <header className="applet-view-not-found-header">
        <div className="header-left">
          <FlowIconButton icon="arrow_back" label="Back" size="large" iconClassName="mat-icon-rtl-mirror" onClick={onBack} />
        </div>
      </header>
      <div className="applet-not-found-container">
        <div className="ng-flow-applet-not-found">
          <div className="applet-not-found-content">
            <img className="not-found-thumbnail" src={NOT_FOUND_IMAGE} alt="" />
            <h2 className="not-found-title">App not found</h2>
            <p className="not-found-description">The app you&apos;re looking for doesn&apos;t exist or may have been deleted.</p>
            <FlowButton variant="secondary" onClick={onBack}>Go back</FlowButton>
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ *
 * The viewer
 * ------------------------------------------------------------------ */

interface RunState {
  /** Compiling and booting, until the tool mounts or fails. */
  loading: boolean;
  compileError: string | null;
  runtimeError: string | null;
}

const ToolViewer: React.FC<{ entry: ToolEntry; route: ViewRoute; preparing: boolean }> = ({ entry, route, preparing }) => {
  const ui = useToolsUi();
  const host = ui.host;
  const own = entry.kind === 'self';
  /** Create tool's new tool, on its first build: Flow shows it in Edit as "Tool", not yet editable. */
  const creating = !!entry.tool?.pending;
  const mode: ToolMode = route.mode ?? 'APP';
  const editing = mode === 'EDIT' || creating;
  const session = builderSession(entry.id);
  const live = useStore(session.$live);
  const storageFull = useStore(session.$storageFull);
  const streaming = live !== null;
  const versionId = entry.tool?.versionId;
  const [tab, setTab] = React.useState<ContentTab>('PREVIEW');
  // Below 961px Edit is one pane at a time, the Tool Builder or the tool's Preview or Code, where
  // the desktop puts the builder beside them (tools-responsive.css). The tool keeps running hidden.
  const narrow = useMediaViewport() !== 'desktop';
  const [pane, setPane] = React.useState<'AGENT' | ContentTab>('AGENT');
  const [files, setFiles] = React.useState<ToolFile[] | null>(null);
  const [run, setRun] = React.useState<RunState>({ loading: true, compileError: null, runtimeError: null });
  const [runCount, setRunCount] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const runnerRef = React.useRef<ToolRunner | null>(null);

  React.useEffect(() => {
    if (preparing) return;
    noteToolOpened(entry.id);
    touchTool(entry.id);
    session.resetPageState();
  }, [entry.id, preparing]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (preparing) return undefined;
    let cancelled = false;
    setFiles(null);
    loadToolFiles(entry.id)
      .then((next) => { if (!cancelled) setFiles(next); })
      .catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [entry.id, versionId, preparing]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onEvent = (event: RunnerEvent) => {
      switch (event.type) {
        case 'compiling': setRun((s) => ({ ...s, loading: true, compileError: null })); break;
        case 'compile_error': setRun((s) => ({ ...s, loading: false, compileError: event.errors.join('\n') })); break;
        case 'app_mounted': setRun((s) => ({ ...s, loading: false, compileError: null })); break;
        case 'runtime_error': setRun((s) => ({ ...s, loading: false, runtimeError: event.error })); break;
        case 'csp_violation': console.warn('[tools] CSP blocked', event.blockedURI, event.violatedDirective); break;
        case 'sdk_ready': break;
      }
    };
    const runner = new ToolRunner(container, createToolSdkHost(entry.id, () => ui.host, ui.pickMedia), onEvent);
    runnerRef.current = runner;
    return () => { runner.dispose(); runnerRef.current = null; };
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const runner = runnerRef.current;
    if (!runner || !files) return undefined;
    if (files.length === 0) { setRun({ loading: false, compileError: null, runtimeError: null }); return undefined; }
    let cancelled = false;
    setRun({ loading: true, compileError: null, runtimeError: null });
    loadLocalStorage(entry.id)
      .catch(() => ({}))
      .then((stored) => { if (!cancelled) void runner.run(files, stored); });
    return () => { cancelled = true; };
  }, [files, runCount, entry.id]);

  const setMode = (next: ToolMode) => {
    host.navigate(toolLocation(host.search, entry.id, { mode: next, from: route.from }), { replace: true });
  };
  const send = (text: string) => { void session.send(text, builderEnv(host)); };
  const restore = (messageId: string) => { void session.restore(messageId); };

  const fixIt = async () => {
    const error = run.compileError;
    if (!error) return;
    const text = `Applet failed to compile with the following error:\n${error}\n\nPlease fix.`;
    if (own) {
      setMode('EDIT');
      send(text);
      return;
    }
    const copyId = await remixAndOpen(ui, entry);
    if (copyId) void builderSession(copyId).send(text, builderEnv(host));
  };
  const fixRuntime = () => {
    const error = run.runtimeError;
    if (!error) return;
    setMode('EDIT');
    send(`Encountered a runtime error:\n${error}\n\nPlease fix.`);
    setRun((s) => ({ ...s, runtimeError: null }));
  };

  const filesLoading = preparing || files === null || (files.length === 0 && streaming);
  const showLoading = filesLoading || run.loading;
  const showCompileError = !showLoading && !!run.compileError;
  const showSidebar = editing && own;

  return (
    <div className="ng-flow-applet-view-page">
      <div className="applet-view-page">
        <ToolViewHeader
          entry={entry}
          creating={creating}
          mode={mode}
          onMode={setMode}
          onBack={() => leave(host, route.from)}
          onDone={() => { session.stop(); leave(host, route.from); }}
        />
        <div className="wt-tools-body">
          {host.renderSidebar()}
          <div className="wt-tools-main">
            <div className="applet-view-main-container">
              {narrow && showSidebar && (
                <div className="wt-edit-panes" role="tablist" aria-label="Edit">
                  {[{ id: 'AGENT' as const, label: 'Agent' }, ...TABS].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={pane === p.id}
                      className={cx('wt-edit-pane', pane === p.id && 'is-active')}
                      onClick={() => { setPane(p.id); if (p.id !== 'AGENT') setTab(p.id); }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <div className={cx('applet-view-content', editing && 'edit-mode', narrow && showSidebar && (pane === 'AGENT' ? 'wt-pane-agent' : 'wt-pane-app'))}>
                <div className="applet-view-main">
                  {run.runtimeError && (
                    <AppletBanner
                      message={run.runtimeError}
                      actionable={own}
                      streaming={streaming}
                      onAction={fixRuntime}
                      onClose={() => setRun((s) => ({ ...s, runtimeError: null }))}
                    />
                  )}
                  {storageFull && (
                    <AppletBanner
                      message="You've hit the app storage limit. Try reducing your app size or deleting old tools."
                      actionLabel="Ask the agent"
                      actionable={own}
                      streaming={streaming}
                      onAction={() => { session.resetPageState(); setMode('EDIT'); }}
                      onClose={() => session.resetPageState()}
                    />
                  )}
                  <div className="applet-content-container">
                    {editing && (
                      <div className="applet-content-tab-bar" role="tablist" aria-label="Applet content">
                        {TABS.map((t) => (
                          <button
                            key={t.id}
                            id={t.tabId}
                            type="button"
                            role="tab"
                            aria-controls={t.panelId}
                            aria-selected={tab === t.id}
                            className={cx('applet-content-tab', tab === t.id && 'applet-content-tab-active')}
                            onClick={() => setTab(t.id)}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={cx('applet-panel-body', editing && 'applet-panel-body-edit')}>
                      <div id="applet-panel-preview" className={cx('applet-layer', editing && tab !== 'PREVIEW' && 'applet-layer-hidden')}>
                        {showLoading && <div className="loading-overlay"><SoupyOverlay /></div>}
                        {showCompileError && (
                          <div className="applet-compile-error-container">
                            <div className="compile-error-box">
                              <MatIcon name="warning" className="compile-error-icon" />
                              <p className="compile-error-text">
                                Tool has failed to run.
                                <br />
                                Would you like the App Agent to try to fix it?
                              </p>
                              <div className="compile-error-buttons">
                                <FlowButton variant="secondary" className="compile-error-fix-button" disabled={streaming} onClick={() => void fixIt()}>
                                  {own ? 'Fix it' : 'Remix & Fix'}
                                </FlowButton>
                                <FlowButton variant="primary" className="compile-error-reload-button" disabled={streaming} onClick={() => setRunCount((n) => n + 1)}>
                                  Reload
                                </FlowButton>
                              </div>
                            </div>
                          </div>
                        )}
                        <div ref={containerRef} className={cx('iframe-container', (showLoading || showCompileError) && 'iframe-container-hidden')} />
                      </div>
                      {editing && (
                        <div id="applet-panel-code" className={cx('applet-layer', tab !== 'CODE' && 'applet-layer-hidden')}>
                          <ToolCodeExplorer files={files ?? []} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className={cx('sidebar-wrapper', showSidebar && 'sidebar-visible')}>
                  {own && (
                    <ToolBuilderPanel
                      toolId={entry.id}
                      currentVersionId={versionId}
                      onClose={() => setMode('APP')}
                      onSend={send}
                      onRestore={restore}
                      onNavigateAway={() => host.navigate(galleryLocation(host.search))}
                      onOpenSettings={host.openSettings}
                    />
                  )}
                </div>
              </div>
              <ToolViewFooter own={own} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * flow-applet-view-header
 * ------------------------------------------------------------------ */

const ToolViewHeader: React.FC<{
  entry: ToolEntry;
  creating: boolean;
  mode: ToolMode;
  onMode: (mode: ToolMode) => void;
  onBack: () => void;
  onDone: () => void;
}> = ({ entry, creating, mode, onMode, onBack, onDone }) => {
  const ui = useToolsUi();
  const own = entry.kind === 'self';
  const editable = own && !creating;
  // Below 961px Apply to be featured moves into More; a phone's More also takes Favorite and Share,
  // and its back arrow stands in for Done (tools-responsive.css).
  const viewport = useMediaViewport();
  const narrow = viewport !== 'desktop';
  const phone = viewport === 'phone';
  const [menuOpen, setMenuOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const nameRef = React.useRef<EditableTextHandle>(null);
  const iconTip = useTooltip(editable ? 'Edit icon' : undefined);
  const displayName = creating ? 'Tool' : entry.name.trim() || UNTITLED_TOOL;
  const remix = () => { void remixAndOpen(ui, entry); };
  const pin = () => success(togglePin(entry.id) ? 'Pinned to dock' : 'Unpinned from dock');
  const remove = async () => {
    if (await ui.confirmDelete(entry)) onBack();
  };

  return (
    <div className="ng-flow-applet-view-header">
      <header className="applet-view-header">
        <div className="header-left">
          <FlowIconButton icon="arrow_back" label="Back" size="large" iconClassName="mat-icon-rtl-mirror" onClick={onBack} />
          <button
            type="button"
            aria-label="Edit icon"
            className={cx('applet-icon-container', editable && 'mat-mdc-tooltip-trigger editable')}
            disabled={!editable}
            onClick={() => ui.openIconDialog(entry)}
            onMouseEnter={iconTip.onMouseEnter}
            onMouseLeave={iconTip.onMouseLeave}
            onMouseDown={iconTip.onMouseDown}
          >
            {entry.icon
              ? <img className="applet-icon-image" src={entry.icon} alt="" />
              : <div className="applet-icon-placeholder"><MatIcon name="extension" className="flow-icon-m" /></div>}
          </button>
          {editable
            ? <EditableText ref={nameRef} text={entry.name} placeholder={UNTITLED_TOOL} onSubmit={(name) => renameTool(entry.id, name)} />
            : <span className="applet-name">{displayName}</span>}
        </div>
        <div className="header-center">
          {editable && <FlowToggles className="applet-view-toggles" options={MODES} value={mode} onChange={onMode} />}
          {!own && <FlowButton variant="outlined" icon="shuffle" iconClassName="flow-icon-m" onClick={remix}>Remix tool</FlowButton>}
        </div>
        <div className="header-right">
          {editable && !narrow && (
            <FlowButton variant="secondary" className="apply-to-be-featured-button" icon="star" iconClassName="flow-icon-m" onClick={() => ui.openFeatured(entry)}>
              Apply to be featured
            </FlowButton>
          )}
          {!phone && <FlowIconButton icon="favorite" label={entry.favorite ? 'Remove favorite' : 'Favorite'} fill={entry.favorite} onClick={() => toggleFavorite(entry.id)} />}
          {!creating && !phone && <FlowIconButton icon="share" label="Share" onClick={() => ui.openShare(entry)} />}
          <FlowIconButton ref={moreRef} icon="more_vert" label="More options" menuTrigger onClick={() => setMenuOpen((v) => !v)} />
          {!phone && <FlowButton variant="secondary" onClick={onDone}>Done</FlowButton>}
        </div>
      </header>
      <FlowMatMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={menuOpen && moreRef.current ? { kind: 'below', rect: moreRef.current.getBoundingClientRect() } : null}
        ignoreRefs={[moreRef]}
      >
        {phone && (
          <>
            <FlowMatMenuItem icon="favorite" iconFill={entry.favorite} label={entry.favorite ? 'Remove favorite' : 'Favorite'} onSelect={() => toggleFavorite(entry.id)} />
            {!creating && <FlowMatMenuItem icon="share" label="Share" onSelect={() => ui.openShare(entry)} />}
          </>
        )}
        {editable && narrow && <FlowMatMenuItem icon="star" label="Apply to be featured" onSelect={() => ui.openFeatured(entry)} />}
        {narrow && (phone || editable) && <FlowMatDivider />}
        {!creating && <FlowMatMenuItem icon="shuffle" label="Remix tool" onSelect={remix} />}
        <FlowMatMenuItem icon="push_pin" iconFill={entry.pinned} label={entry.pinned ? 'Unpin' : 'Pin'} onSelect={pin} />
        <FlowMatMenuItem icon="flag" label="Report" onSelect={openReport} />
        {editable && (
          <>
            <FlowMatDivider />
            <FlowMatMenuItem icon="edit" label="Rename" onSelect={() => window.setTimeout(() => nameRef.current?.startEditing(), 0)} />
            <FlowMatMenuItem icon="image" label="Edit icon" onSelect={() => ui.openIconDialog(entry)} />
            <FlowMatMenuItem icon="assignment" label="Edit description" onSelect={() => ui.openDescription(entry)} />
            <FlowMatDivider />
            <FlowMatMenuItem icon="delete" label="Delete" danger onSelect={() => void remove()} />
          </>
        )}
      </FlowMatMenu>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Banner, overlay, footer
 * ------------------------------------------------------------------ */

/** Flow's `flow-applet-banner`: a warning over the tool, with Fix it for its owner and Close. */
const AppletBanner: React.FC<{
  message: string;
  actionLabel?: string;
  actionable: boolean;
  streaming: boolean;
  onAction: () => void;
  onClose: () => void;
}> = ({ message, actionLabel = 'Fix it', actionable, streaming, onAction, onClose }) => (
  <div className="ng-flow-applet-banner">
    <div className="applet-banner">
      <div className="banner-icon"><MatIcon name="warning" className="banner-mat-icon" /></div>
      <p className="banner-message" title={message}>{message}</p>
      <div className="banner-actions">
        {actionable && <FlowButton variant="primary" size="small" className="action-button" disabled={streaming} onClick={onAction}>{actionLabel}</FlowButton>}
        <FlowIconButton icon="close" label="Close" onClick={onClose} />
      </div>
    </div>
  </div>
);

/** Flow's `flow-soupy-overlay`: two Perlin layers drifting, each from a random point. */
const SoupyOverlay: React.FC = () => {
  const layer1 = React.useRef<HTMLDivElement>(null);
  const layer2 = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    for (const el of [layer1.current, layer2.current]) {
      for (const animation of el?.getAnimations() ?? []) animation.currentTime = Math.random() * 10_000;
    }
  }, []);
  const style = { ['--perlin-url' as string]: PERLIN_URL };
  return (
    <div className="ng-flow-soupy-overlay" aria-hidden="true">
      <div className="perlin-container">
        <div ref={layer1} className="perlin-layer perlin-layer-1" style={style} />
        <div ref={layer2} className="perlin-layer perlin-layer-2" style={style} />
      </div>
    </div>
  );
};

const ToolViewFooter: React.FC<{ own: boolean }> = ({ own }) => {
  const tip = useTooltip(CREDITS_TIP, 'above');
  return (
    <div className="ng-flow-applet-view-footer">
      <footer className="applet-view-footer">
        {own
          ? <p className="footer-disclaimer-text"> {DISCLAIMER} {CREDITS} </p>
          : (
            <p className="footer-disclaimer-text">
              <span>{DISCLAIMER} This Tool was created by another person and may be inaccurate or unsafe. </span>
              <a className="report-link" href={REPORT_UNSAFE_URL} target="_blank" rel="noopener noreferrer">Report unsafe content.</a>
              <span> {CREDITS}</span>
            </p>
          )}
        <span className="credits-info-icon-wrapper mat-mdc-tooltip-trigger" onMouseEnter={tip.onMouseEnter} onMouseLeave={tip.onMouseLeave}>
          <MatIcon name="info" className="credits-info-icon" />
        </span>
      </footer>
    </div>
  );
};
