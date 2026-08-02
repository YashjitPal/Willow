import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  runComputerUseTask,
  type ComputerUseTaskResult,
  type ConversationMessage,
  type TestUpdate,
} from '@willow/ai/computer-use/session';
import {
  activateBrowserTab,
  hasBrowserTabsBridge,
  requestBrowserTabs,
  subscribeToBrowserTabEvents,
  type BrowserTabSnapshot,
} from './browser-tabs-bridge';
import {
  localCompanion,
  type CompanionFrame,
  type CompanionTabsResult,
} from '@willow/code/local-companion';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import './SparkComputerUsePanel.css';

type BrowserAccess = 'checking' | 'local' | 'limited' | 'blocked';
type BrowserRunStatus = 'idle' | 'loading' | 'running' | 'complete' | 'limited' | 'error' | 'stopped';

interface BrowserActivity {
  id: string;
  type: TestUpdate['type'];
  message: string;
  actionType?: string;
}

interface SparkBrowserTab {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
}

export interface SparkComputerUsePanelProps {
  taskId: string;
  prompt: string;
  apiKey?: string;
  autoStart?: boolean;
  conversationHistory?: ConversationMessage[];
  onProgress?: (message: string) => void;
  onResponse?: (response: string) => void;
  onComplete?: (result: ComputerUseTaskResult, stopped?: boolean) => void;
}

const SYMBOL_PROPS = {
  family: 'google-symbols' as const,
  weight: 400,
  roundness: 0,
  symbolWidth: 92,
};

const LOCAL_START_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      :root{color-scheme:dark;font-family:"Google Sans Flex","Google Sans",Arial,sans-serif}
      *{box-sizing:border-box}
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101010;color:#e3e3e3}
      main{width:min(560px,calc(100% - 48px));padding:40px;border:1px solid rgba(255,255,255,.08);border-radius:28px;background:#1f1f1f;box-shadow:0 24px 80px rgba(0,0,0,.35)}
      .mark{display:grid;width:44px;height:44px;place-items:center;margin-bottom:22px;border-radius:15px;background:#a8c7fa;color:#062e6f;font-size:23px}
      h1{margin:0 0 12px;font-size:28px;font-weight:520;letter-spacing:-.5px}
      p{margin:0;color:#c4c7c5;font-size:16px;line-height:1.55}
      .hint{margin-top:24px;padding:14px 16px;border-radius:16px;background:#292929;color:#c4c7c5;font-size:14px}
    </style>
  </head>
  <body>
    <main>
      <div class="mark">✦</div>
      <h1>Local browser ready</h1>
      <p>Spark can inspect and interact with pages served by Willow or another same-origin local app.</p>
      <div class="hint">Enter an approved URL in the address bar above, or let the agent choose the next page.</div>
    </main>
  </body>
</html>`;

const getPromptUrl = (prompt: string): string => {
  const match = prompt.match(/https?:\/\/[^\s<>{}\[\]"']+/i)?.[0];
  return match?.replace(/[),.;!?]+$/, '') ?? '';
};

const getTabTitle = (url: string, fallback = 'New tab'): string => {
  if (!url || url === 'about:blank' || url === 'about:srcdoc') return fallback;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') || fallback;
  } catch {
    return fallback;
  }
};

const normalizeAddress = (value: string): string | null => {
  const input = value.trim();
  if (!input || input === 'about:blank' || input === 'about:srcdoc') return 'about:blank';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(candidate, globalThis.location?.href);
    return ['http:', 'https:', 'about:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
};

const getStatusLabel = (status: BrowserRunStatus) => {
  switch (status) {
    case 'loading': return 'Loading';
    case 'running': return 'Working';
    case 'complete': return 'Done';
    case 'limited': return 'Limited access';
    case 'error': return 'Needs attention';
    case 'stopped': return 'Stopped';
    default: return 'Ready';
  }
};

export const SparkComputerUsePanel: React.FC<SparkComputerUsePanelProps> = ({
  taskId,
  prompt,
  apiKey,
  autoStart = false,
  conversationHistory = [],
  onProgress,
  onResponse,
  onComplete,
}) => {
  const promptUrl = useMemo(() => getPromptUrl(prompt), [prompt]);
  const [frameUrl, setFrameUrl] = useState(promptUrl);
  const [address, setAddress] = useState(promptUrl || 'about:blank');
  const [tabs, setTabs] = useState<SparkBrowserTab[]>([
    {
      id: 'spark-tab-1',
      title: getTabTitle(promptUrl),
      url: promptUrl,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState('spark-tab-1');
  const [externalTabs, setExternalTabs] = useState<BrowserTabSnapshot[] | null>(null);
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const [access, setAccess] = useState<BrowserAccess>('checking');
  const [status, setStatus] = useState<BrowserRunStatus>(promptUrl ? 'loading' : 'idle');
  const [activity, setActivity] = useState<BrowserActivity[]>([]);
  const [message, setMessage] = useState('Local browser ready');
  const [frameRevision, setFrameRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [companionConnected, setCompanionConnected] = useState(false);
  const [companionSessionId, setCompanionSessionId] = useState<string | null>(null);
  const [companionFrame, setCompanionFrame] = useState<CompanionFrame | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const companionViewportRef = useRef<HTMLDivElement>(null);
  const companionSessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);
  const autoStartedRef = useRef(false);
  const setCompanionSession = useCallback((sessionId: string | null) => {
    companionSessionRef.current = sessionId;
    setCompanionSessionId(sessionId);
  }, []);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const updateActiveTab = useCallback((update: Partial<SparkBrowserTab>) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === activeTabId ? { ...tab, ...update } : tab
    )));
  }, [activeTabId]);

  const applyCompanionResult = useCallback((result: CompanionTabsResult) => {
    const nextTabs = (result.tabs || []).map((tab) => ({
      id: tab.id,
      title: tab.title || getTabTitle(tab.url),
      url: tab.url === 'about:blank' ? '' : tab.url,
    }));
    if (nextTabs.length) setTabs(nextTabs);
    if (result.activeTabId) setActiveTabId(result.activeTabId);
    if (result.frame) {
      setCompanionFrame(result.frame);
      setFrameUrl(result.frame.url === 'about:blank' ? '' : result.frame.url);
      setAddress(result.frame.url || 'about:blank');
      setAccess('local');
      setStatus((current) => current === 'loading' ? 'idle' : current);
    }
  }, []);

  const refreshExternalTabs = useCallback(async () => {
    const snapshots = await requestBrowserTabs();
    if (snapshots !== null) {
      // A desktop/content-script bridge may only expose postMessage (and not
      // chrome.runtime), so the response itself is the authoritative signal
      // that the user's browser window is connected.
      setBridgeAvailable(true);
      setExternalTabs(snapshots);
      return;
    }

    const runtimeAvailable = hasBrowserTabsBridge();
    setBridgeAvailable(runtimeAvailable);
    if (!runtimeAvailable) setExternalTabs(null);
  }, []);

  const selectExternalTab = useCallback((tab: BrowserTabSnapshot) => {
    const activated = activateBrowserTab(tab.id);
    if (!activated) {
      setMessage('Connect the optional Willow Browser Bridge to switch Chrome tabs from Spark.');
      return;
    }
    setExternalTabs((currentTabs) => currentTabs?.map((candidate) => ({
      ...candidate,
      active: candidate.id === tab.id,
    })) ?? [tab]);
    setMessage(`Switched to ${tab.title || 'the selected Chrome tab'}.`);
  }, []);

  const appendActivity = useCallback((update: TestUpdate) => {
    const item: BrowserActivity = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: update.type,
      message: update.message,
      actionType: update.actionType,
    };
    setActivity((items) => [...items.slice(-10), item]);
  }, []);

  const inspectFrameAccess = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return 'blocked' as const;
    try {
      const document = iframe.contentDocument || iframe.contentWindow?.document;
      if (!document) return 'limited' as const;
      void document.documentElement;
      return 'local' as const;
    } catch {
      return 'limited' as const;
    }
  }, []);

  const handleFrameLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const nextAccess = inspectFrameAccess();
    let loadedUrl = frameUrl;
    let loadedTitle = activeTab?.title || getTabTitle(frameUrl);
    try {
      if (iframe?.contentWindow?.location?.href) loadedUrl = iframe.contentWindow.location.href;
      if (iframe?.contentDocument?.title) loadedTitle = iframe.contentDocument.title.trim();
    } catch {
      // Cross-origin frames intentionally expose neither URL nor title.
    }
    if (loadedUrl !== frameUrl) {
      setFrameUrl(loadedUrl);
      setAddress(loadedUrl || 'about:blank');
    }
    updateActiveTab({
      url: loadedUrl,
      title: loadedTitle || getTabTitle(loadedUrl),
    });
    setAccess(nextAccess);
    if (nextAccess === 'local') {
      setMessage('This page is available to the local computer-use agent.');
      setStatus((current) => current === 'loading' ? 'idle' : current);
    } else {
      setMessage('The page is visible, but browser same-origin rules prevent Willow from inspecting or controlling it.');
      setStatus((current) => current === 'running' ? current : 'limited');
    }
  }, [activeTab?.title, frameUrl, inspectFrameAccess, updateActiveTab]);

  const handleAgentUpdate = useCallback((update: TestUpdate) => {
    appendActivity(update);
    setMessage(update.message);
    if (update.type === 'thinking' || update.type === 'screenshot' || update.type === 'action') {
      setStatus('running');
      onProgress?.(update.message);
    } else if (update.type === 'text' && update.message.trim()) {
      onResponse?.(update.message.trim());
    } else if (update.type === 'complete') {
      setStatus(stoppedRef.current ? 'stopped' : 'complete');
    } else if (update.type === 'error') {
      setStatus(/cross-origin|blocks embedding|cannot inspect/i.test(update.message) ? 'limited' : 'error');
    }
  }, [appendActivity, onProgress, onResponse]);

  const startAgent = useCallback(async () => {
    if (companionConnected) {
      const explanation = 'The local companion browser is connected. Basic browser controls are ready; the agent loop will use this transport in the next pass.';
      setStatus('limited');
      setMessage(explanation);
      appendActivity({ type: 'error', message: explanation });
      onComplete?.({ completed: false, explanation, actionsPerformed: [], limited: true });
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe || runningRef.current) return;
    if (!apiKey) {
      const explanation = 'Add a Gemini API key in Settings > Models to run the local computer-use agent.';
      setStatus('error');
      setMessage(explanation);
      appendActivity({ type: 'error', message: explanation });
      onComplete?.({ completed: false, explanation, actionsPerformed: [] });
      return;
    }
    const currentAccess = inspectFrameAccess();
    if (currentAccess !== 'local') {
      const explanation = 'This page is cross-origin or blocks embedding. It can be viewed here, but a frontend-only iframe cannot expose it to the local agent.';
      setAccess('limited');
      setStatus('limited');
      setMessage(explanation);
      appendActivity({ type: 'error', message: explanation });
      onComplete?.({ completed: false, explanation, actionsPerformed: [], limited: true });
      return;
    }

    runningRef.current = true;
    stoppedRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setActivity([]);
    try {
      const result = await runComputerUseTask(
        apiKey,
        prompt,
        iframe,
        handleAgentUpdate,
        conversationHistory,
        () => stoppedRef.current,
        controller.signal,
      );
      if (stoppedRef.current) setStatus('stopped');
      else if (result.completed) setStatus('complete');
      else if (result.limited) setStatus('limited');
      else setStatus('error');
      setMessage(result.explanation);
      onComplete?.(result, stoppedRef.current);
    } finally {
      runningRef.current = false;
      abortRef.current = null;
    }
  }, [apiKey, appendActivity, companionConnected, conversationHistory, handleAgentUpdate, inspectFrameAccess, onComplete, prompt]);

  useEffect(() => {
    const unsubscribe = subscribeToBrowserTabEvents((event) => {
      if (event.type === 'BROWSER_TABS_RESPONSE' && event.tabs) {
        setExternalTabs(event.tabs);
        setBridgeAvailable(true);
      } else if (event.type === 'BROWSER_TAB_UPDATED' && event.tab) {
        setExternalTabs((currentTabs) => {
          if (!currentTabs) return [event.tab!];
          const exists = currentTabs.some((tab) => tab.id === event.tab!.id);
          return exists
            ? currentTabs.map((tab) => tab.id === event.tab!.id ? event.tab! : tab)
            : [...currentTabs, event.tab!];
        });
      } else if (event.type === 'BROWSER_TAB_ACTIVATED' && event.tab) {
        setExternalTabs((currentTabs) => currentTabs?.map((tab) => ({
          ...tab,
          active: tab.id === event.tab!.id,
          })) ?? [event.tab!]);
      }
    });
    void refreshExternalTabs();
    return unsubscribe;
  }, [refreshExternalTabs]);

  useEffect(() => {
    autoStartedRef.current = false;
    stoppedRef.current = false;
    abortRef.current?.abort();
    setFrameUrl(promptUrl);
    setAddress(promptUrl || 'about:blank');
    const initialTab: SparkBrowserTab = {
      id: `spark-tab-${Date.now()}`,
      title: getTabTitle(promptUrl),
      url: promptUrl,
    };
    setTabs([initialTab]);
    setActiveTabId(initialTab.id);
    setExternalTabs(null);
    setCompanionConnected(false);
    setCompanionSession(null);
    setCompanionFrame(null);
    setAccess('checking');
    setStatus(promptUrl ? 'loading' : 'idle');
    setActivity([]);
    setMessage('Local browser ready');
  }, [promptUrl, setCompanionSession, taskId]);

  useEffect(() => {
    let mounted = true;
    let ownedSessionId: string | null = null;
    const unsubscribe = localCompanion.onMessage((messageEvent) => {
      if (!mounted || messageEvent.type !== 'event') return;
      if (messageEvent.event === 'browser.frame') {
        const frame = messageEvent.payload as CompanionFrame;
        if (companionSessionRef.current && frame.sessionId !== companionSessionRef.current) return;
        setCompanionFrame(frame);
        setFrameUrl(frame.url === 'about:blank' ? '' : frame.url);
        setAddress(frame.url || 'about:blank');
        setAccess('local');
        setStatus((current) => current === 'loading' ? 'idle' : current);
      } else if (messageEvent.event === 'browser.tabs') {
        const result = messageEvent.payload as CompanionTabsResult;
        if (companionSessionRef.current && result.sessionId !== companionSessionRef.current) return;
        applyCompanionResult(result);
      } else if (messageEvent.event === 'browser.error') {
        const error = messageEvent.payload as { sessionId: string; message: string };
        if (companionSessionRef.current && error.sessionId !== companionSessionRef.current) return;
        setMessage(error.message);
      }
    });

    void (async () => {
      const connected = await localCompanion.connect(650);
      if (!mounted || !connected) return;
      setCompanionConnected(true);
      setMessage('Local companion browser ready.');
      try {
        const result = await localCompanion.request<CompanionTabsResult>('browser.launch', {
          url: promptUrl || 'about:blank',
        });
        if (!mounted) {
          if (localCompanion.isConnected) {
            void localCompanion.request('browser.close', { sessionId: result.sessionId }, 2_500).catch(() => undefined);
          }
          return;
        }
        ownedSessionId = result.sessionId;
        setCompanionSession(result.sessionId);
        applyCompanionResult(result);
      } catch (error) {
        if (!mounted) return;
        setCompanionConnected(false);
        setCompanionSession(null);
        setCompanionFrame(null);
        setMessage(error instanceof Error ? error.message : 'The local companion browser could not start.');
      }
    })();

    return () => {
      mounted = false;
      unsubscribe();
      if (ownedSessionId && localCompanion.isConnected) {
        void localCompanion.request('browser.close', { sessionId: ownedSessionId }, 2_500).catch(() => undefined);
      }
    };
  }, [applyCompanionResult, promptUrl, setCompanionSession, taskId]);

  useEffect(() => {
    if (companionConnected || !autoStart || autoStartedRef.current || !['local', 'limited'].includes(access)) return;
    autoStartedRef.current = true;
    void startAgent();
  }, [access, autoStart, companionConnected, startAgent]);

  useEffect(() => () => {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  const requestCompanionBrowser = useCallback(async (
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<CompanionTabsResult | CompanionFrame | null> => {
    if (!companionConnected || !companionSessionId) return null;
    try {
      const result = await localCompanion.request<CompanionTabsResult | CompanionFrame>(type, {
        sessionId: companionSessionId,
        ...payload,
      });
      if ('tabs' in result) applyCompanionResult(result);
      else {
        setCompanionFrame(result);
        setFrameUrl(result.url === 'about:blank' ? '' : result.url);
        setAddress(result.url || 'about:blank');
      }
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The local companion request failed.');
      return null;
    }
  }, [applyCompanionResult, companionConnected, companionSessionId]);

  const resetFrameForTab = (tab: SparkBrowserTab) => {
    stoppedRef.current = true;
    abortRef.current?.abort();
    runningRef.current = false;
    autoStartedRef.current = false;
    setActiveTabId(tab.id);
    setFrameUrl(tab.url);
    setAddress(tab.url || 'about:blank');
    setAccess('checking');
    setStatus(tab.url ? 'loading' : 'idle');
    setMessage(tab.url ? `Opening ${tab.title}` : 'Local browser ready');
    setFrameRevision((revision) => revision + 1);
  };

  const selectTab = async (tabId: string) => {
    if (tabId === activeTabId) return;
    if (companionConnected) {
      await requestCompanionBrowser('browser.activateTab', { tabId });
      return;
    }
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (tab) resetFrameForTab(tab);
  };

  const createTab = async () => {
    if (companionConnected) {
      await requestCompanionBrowser('browser.newTab');
      return;
    }
    const tab: SparkBrowserTab = {
      id: `spark-tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'New tab',
      url: '',
    };
    setTabs((currentTabs) => [...currentTabs, tab]);
    resetFrameForTab(tab);
  };

  const closeTab = async (tabId: string) => {
    if (companionConnected) {
      await requestCompanionBrowser('browser.closeTab', { tabId });
      return;
    }
    if (tabs.length === 1) {
      const blankTab: SparkBrowserTab = { id: tabId, title: 'New tab', url: '' };
      setTabs([blankTab]);
      resetFrameForTab(blankTab);
      return;
    }
    const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    if (tabId === activeTabId) {
      const nextTab = nextTabs[Math.max(0, Math.min(closingIndex, nextTabs.length - 1))];
      if (nextTab) resetFrameForTab(nextTab);
    }
  };

  const navigate = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const normalized = normalizeAddress(address);
    if (!normalized) {
      setStatus('error');
      setMessage('Enter an http:// or https:// address.');
      return;
    }
    if (companionConnected) {
      setStatus('loading');
      setMessage(`Opening ${normalized}`);
      await requestCompanionBrowser('browser.navigate', { url: normalized });
      return;
    }
    stoppedRef.current = true;
    abortRef.current?.abort();
    runningRef.current = false;
    autoStartedRef.current = false;
    setFrameUrl(normalized === 'about:blank' ? '' : normalized);
    setAddress(normalized);
    updateActiveTab({
      url: normalized === 'about:blank' ? '' : normalized,
      title: getTabTitle(normalized, 'New tab'),
    });
    setAccess('checking');
    setStatus(normalized === 'about:blank' ? 'idle' : 'loading');
    setMessage(normalized === 'about:blank' ? 'Local browser ready' : `Opening ${normalized}`);
    setFrameRevision((revision) => revision + 1);
  };

  const goBack = async () => {
    if (companionConnected) {
      await requestCompanionBrowser('browser.back');
      return;
    }
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      setMessage('History controls are unavailable for this embedded page.');
    }
  };

  const goForward = async () => {
    if (companionConnected) {
      await requestCompanionBrowser('browser.forward');
      return;
    }
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {
      setMessage('History controls are unavailable for this embedded page.');
    }
  };

  const reload = async () => {
    if (companionConnected) {
      setStatus('loading');
      await requestCompanionBrowser('browser.reload');
      return;
    }
    setAccess('checking');
    setStatus('loading');
    setFrameRevision((revision) => revision + 1);
  };

  const stopAgent = () => {
    if (!runningRef.current) return;
    stoppedRef.current = true;
    abortRef.current?.abort();
    setStatus('stopped');
    setMessage('Stopping the browser task…');
  };

  const getCompanionPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const frame = companionFrame;
    const viewport = companionViewportRef.current;
    if (!frame || !viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    const drawnWidth = frame.width * scale;
    const drawnHeight = frame.height * scale;
    const offsetX = (rect.width - drawnWidth) / 2;
    const offsetY = (rect.height - drawnHeight) / 2;
    return {
      x: Math.max(0, Math.min(frame.width, (event.clientX - rect.left - offsetX) / scale)),
      y: Math.max(0, Math.min(frame.height, (event.clientY - rect.top - offsetY) / scale)),
    };
  };

  const handleCompanionClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = getCompanionPoint(event);
    if (!point) return;
    event.currentTarget.focus();
    void requestCompanionBrowser('browser.click', { ...point, tabId: activeTabId });
  };

  const handleCompanionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!companionConnected) return;
    event.preventDefault();
    const modifiers = [
      event.ctrlKey ? 'Control' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      event.metaKey ? 'Meta' : '',
    ].filter(Boolean);
    const key = event.key === ' ' ? 'Space' : event.key;
    if (!modifiers.length && key.length === 1) {
      void requestCompanionBrowser('browser.type', { text: key, tabId: activeTabId });
      return;
    }
    void requestCompanionBrowser('browser.key', {
      key: [...modifiers, key].join('+'),
      tabId: activeTabId,
    });
  };

  const handleCompanionWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!companionConnected) return;
    event.preventDefault();
    void requestCompanionBrowser('browser.scroll', {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      tabId: activeTabId,
    });
  };

  const panel = (
    <section
      className={`spark-computer-use${expanded ? ' is-expanded' : ''}`}
      aria-label="Computer use"
    >
      <header className="spark-computer-use__heading">
        <span className="spark-computer-use__heading-icon">
          <MaterialSymbol
            family="google-symbols"
            name="desktop_windows"
            size={20}
            weight={400}
            roundness={100}
            opticalSize={20}
          />
        </span>
        <span className="spark-computer-use__heading-copy">
          <strong>Computer use</strong>
          <span>{message}</span>
        </span>
        <span className={`spark-computer-use__status is-${status}`}>
          {status === 'running' && <span className="spark-computer-use__status-spinner" aria-hidden="true" />}
          {getStatusLabel(status)}
        </span>
      </header>

      <div className="spark-computer-use__browser">
        <div className="spark-computer-use__tab-strip" role="tablist" aria-label="Spark browser tabs">
          <div className="spark-computer-use__local-tabs">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`spark-computer-use__tab${tab.id === activeTabId ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTabId}
                  className="spark-computer-use__tab-select"
                  onClick={() => void selectTab(tab.id)}
                >
                  <MaterialSymbol
                    {...SYMBOL_PROPS}
                    name={tab.url ? 'language' : 'add_circle'}
                    size={15}
                    opticalSize={15}
                  />
                  <span>{tab.title}</span>
                </button>
                <button
                  type="button"
                  className="spark-computer-use__tab-close"
                  aria-label={`Close ${tab.title}`}
                  title="Close tab"
                  onClick={() => void closeTab(tab.id)}
                >
                  <MaterialSymbol {...SYMBOL_PROPS} name="close" size={15} opticalSize={15} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="spark-computer-use__new-tab"
            aria-label="Open a new browser tab"
            title="New tab"
            onClick={() => void createTab()}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="add" size={18} opticalSize={18} />
          </button>
          <span
            className={`spark-computer-use__bridge-status${companionConnected || bridgeAvailable ? ' is-connected' : ''}`}
            title={companionConnected
              ? 'Connected to the local Willow companion browser'
              : bridgeAvailable
              ? 'Connected to the tabs in this Chrome window'
              : 'Embedded session. An optional Willow Browser Bridge is required to mirror your Chrome tabs.'}
          >
            <MaterialSymbol
              {...SYMBOL_PROPS}
              name={companionConnected ? 'computer' : bridgeAvailable ? 'link' : 'web_asset'}
              size={14}
              opticalSize={14}
            />
            {companionConnected ? 'Local companion' : bridgeAvailable ? 'Chrome connected' : 'Embedded session'}
          </span>
        </div>

        {bridgeAvailable && externalTabs && (
          <div className="spark-computer-use__real-tabs" role="list" aria-label="Tabs in the user's browser window">
            <span className="spark-computer-use__real-tabs-label">Chrome window</span>
            <button
              type="button"
              className="spark-computer-use__real-tabs-refresh"
              aria-label="Refresh tabs in Chrome window"
              title="Refresh Chrome tabs"
              onClick={() => void refreshExternalTabs()}
            >
              <MaterialSymbol {...SYMBOL_PROPS} name="refresh" size={14} opticalSize={14} />
            </button>
            {externalTabs.slice(0, 12).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="listitem"
                className={`spark-computer-use__real-tab${tab.active ? ' is-active' : ''}`}
                title={tab.url}
                onClick={() => selectExternalTab(tab)}
              >
                {tab.faviconUrl ? (
                  <img src={tab.faviconUrl} alt="" aria-hidden="true" />
                ) : (
                  <MaterialSymbol {...SYMBOL_PROPS} name="language" size={14} opticalSize={14} />
                )}
                <span>{tab.title || getTabTitle(tab.url)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="spark-computer-use__toolbar">
          <div className="spark-computer-use__history-controls" role="group" aria-label="Browser history">
            <button type="button" aria-label="Back" title="Back" onClick={() => void goBack()}>
              <MaterialSymbol {...SYMBOL_PROPS} name="arrow_back" size={18} opticalSize={18} />
            </button>
            <button type="button" aria-label="Forward" title="Forward" onClick={() => void goForward()}>
              <MaterialSymbol {...SYMBOL_PROPS} name="arrow_forward" size={18} opticalSize={18} />
            </button>
            <button type="button" aria-label="Reload" title="Reload" onClick={() => void reload()}>
              <MaterialSymbol {...SYMBOL_PROPS} name="refresh" size={18} opticalSize={18} />
            </button>
          </div>
          <form className="spark-computer-use__address" onSubmit={navigate}>
            <MaterialSymbol
              {...SYMBOL_PROPS}
              name={access === 'local' ? 'lock' : access === 'limited' ? 'language' : 'hourglass_top'}
              size={16}
              opticalSize={16}
            />
            <input
              value={address}
              aria-label="Browser address"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => setAddress(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
          </form>
          <button
            type="button"
            className="spark-computer-use__open-external"
            aria-label="Open current page in Chrome"
            title="Open current page in Chrome"
            disabled={!frameUrl}
            onClick={() => {
              if (frameUrl) window.open(frameUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="open_in_new" size={18} opticalSize={18} />
          </button>
          <button
            type="button"
            className="spark-computer-use__expand"
            aria-label={expanded ? 'Exit full screen browser' : 'Open browser full screen'}
            title={expanded ? 'Exit full screen' : 'Full screen'}
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <MaterialSymbol
              {...SYMBOL_PROPS}
              name={expanded ? 'fullscreen_exit' : 'fullscreen'}
              size={20}
              opticalSize={20}
            />
          </button>
        </div>

        <div className="spark-computer-use__viewport">
          {companionConnected && companionFrame ? (
            <div
              ref={companionViewportRef}
              className="spark-computer-use__companion-viewport"
              role="img"
              aria-label="Local companion browser"
              tabIndex={0}
              onClick={handleCompanionClick}
              onKeyDown={handleCompanionKeyDown}
              onWheel={handleCompanionWheel}
            >
              <img src={companionFrame.dataUrl} alt="" draggable={false} />
            </div>
          ) : (
            <iframe
              key={`${taskId}-${frameRevision}-${frameUrl || 'local'}`}
              ref={iframeRef}
              title="Spark local browser"
              src={frameUrl || undefined}
              srcDoc={frameUrl ? undefined : LOCAL_START_PAGE}
              allow="clipboard-read; clipboard-write"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={handleFrameLoad}
              onError={() => {
                setAccess('blocked');
                setStatus('error');
                setMessage('This page could not be loaded in the embedded browser.');
              }}
            />
          )}
          {access === 'limited' && (
            <div className="spark-computer-use__limited-note" role="status">
              <MaterialSymbol {...SYMBOL_PROPS} name="info" size={18} opticalSize={18} />
              <span>Visible page, limited agent access. Use a Willow/local URL for direct control.</span>
            </div>
          )}
        </div>
      </div>

      <footer className="spark-computer-use__footer">
        <div className="spark-computer-use__activity" aria-live="polite">
          {activity.length ? activity.slice(-3).map((item, index, items) => (
            <span key={item.id} className={index === items.length - 1 ? 'is-current' : undefined}>
              <MaterialSymbol
                {...SYMBOL_PROPS}
                name={item.type === 'action' ? 'touch_app' : item.type === 'error' ? 'error' : 'progress_activity'}
                size={15}
                opticalSize={15}
              />
              <span>{item.actionType || item.message}</span>
            </span>
          )) : (
            <span className="is-current">
              <MaterialSymbol {...SYMBOL_PROPS} name="shield" size={15} opticalSize={15} />
              <span>{companionConnected ? 'Runs in the Willow local companion' : 'Runs locally in this browser frame'}</span>
            </span>
          )}
        </div>
        {status === 'running' ? (
          <button type="button" className="spark-computer-use__run is-stop" onClick={stopAgent}>
            <span aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="spark-computer-use__run"
            disabled={access !== 'local' || companionConnected}
            onClick={() => {
              stoppedRef.current = false;
              void startAgent();
            }}
          >
            <MaterialSymbol {...SYMBOL_PROPS} name="play_arrow" size={18} opticalSize={18} fill />
            Run agent
          </button>
        )}
      </footer>
    </section>
  );

  return expanded && typeof document !== 'undefined'
    ? createPortal(panel, document.body)
    : panel;
};

export default SparkComputerUsePanel;
