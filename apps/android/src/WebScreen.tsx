import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewNavigationEvent,
  WebViewProgressEvent,
} from 'react-native-webview/lib/WebViewTypes';

import WillowTunnel from '../modules/willow-tunnel';
import { AGENTS_ORIGIN, WILLOW_URL } from './connection';
import { useBottomInset } from './keyboard';
import {
  bridgeScript,
  deliverScript,
  isPageOrigin,
  PAGE_ORIGINS,
  parsePageMessage,
  toolsChangedScript,
  type NativeMessage,
} from './page-bridge';
import { dispatch, showNotification, TOOL_NAMES } from './phoneTools';
import { useAgentAccess } from './settings';
import { usePalette } from './theme';
import { Button, MenuButton, messageOf } from './ui';

const PAIRING_TIMEOUT_MS = 15_000;
const USER_AGENT_SUFFIX = `WillowAndroid/${Constants.expoConfig?.version ?? '1'}`;

type Props = {
  url: string;
  /** `url` is the agents' /pair page; Willow follows once the client has paired. */
  pairing: boolean;
  onPairingRequired(): void;
  onOpenSettings(): void;
  onConnectAnother(): void;
  /** Reconnects to the PC; rejects with a message for the owner. */
  onRetry(): Promise<void>;
};

export function WebScreen({
  url,
  pairing,
  onPairingRequired,
  onOpenSettings,
  onConnectAnother,
  onRetry,
}: Props) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { bottom, onLayout } = useBottomInset();
  const agentAccess = useAgentAccess();
  const tools = useMemo(() => (agentAccess ? [...TOOL_NAMES] : []), [agentAccess]);
  const script = useMemo(() => bridgeScript(tools), [tools]);

  const webView = useRef<WebView>(null);
  const container = useRef<View>(null);
  const canGoBack = useRef(false);
  const stillPairing = useRef(pairing);
  const latestScript = useRef(script);
  useEffect(() => {
    latestScript.current = script;
  }, [script]);

  const [target, setTarget] = useState(url);
  // A new WebView (pairing done, renderer gone) starts with a fresh history. It loads
  // nothing until the bridge is installed in it: `bridgedInstance` catches up.
  const [instance, setInstance] = useState(0);
  const [bridgedInstance, setBridgedInstance] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const finishPairing = useCallback(() => {
    if (!stillPairing.current) return;
    stillPairing.current = false;
    setTarget(WILLOW_URL);
    setInstance((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(finishPairing, PAIRING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pairing, finishPairing]);

  // Each WebView gets the bridge as a document-start script before it loads anything.
  useEffect(() => {
    let cancelled = false;
    setProgress(0);
    void installBridge(container.current, latestScript.current).finally(() => {
      if (!cancelled) setBridgedInstance(instance);
    });
    return () => {
      cancelled = true;
    };
  }, [instance]);

  // The agent-access switch moved while a page is open: tell the page, and future pages.
  const shownTools = useRef(tools);
  useEffect(() => {
    if (shownTools.current === tools) return;
    shownTools.current = tools;
    void installBridge(container.current, script);
    webView.current?.injectJavaScript(toolsChangedScript(tools));
  }, [tools, script]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (loadError || !canGoBack.current) return false;
      webView.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [loadError]);

  const send = useCallback((message: NativeMessage) => {
    webView.current?.injectJavaScript(deliverScript(message));
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (!isPageOrigin(event.nativeEvent.url)) return;
      const message = parsePageMessage(event.nativeEvent.data);
      if (!message) return;
      switch (message.kind) {
        case 'phone-call': {
          const { id } = message;
          dispatch(message.tool, message.args).then(
            (result) => send({ kind: 'phone-result', id, ok: true, result: result ?? null }),
            (error: unknown) => send({ kind: 'phone-result', id, ok: false, error: messageOf(error) }),
          );
          break;
        }
        case 'pairing-required':
          onPairingRequired();
          break;
        case 'open-settings':
          onOpenSettings();
          break;
        case 'open-external':
          if (/^https?:\/\//i.test(message.url)) {
            Linking.openURL(message.url).catch(() => {});
          }
          break;
        case 'notify':
          showNotification(message.title, message.body, message.tag).catch(() => {});
          break;
      }
    },
    [send, onPairingRequired, onOpenSettings],
  );

  const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
    const { url: next } = request;
    if (isLocalUrl(next) || /^(about|data|blob|javascript):/i.test(next)) {
      return true;
    }
    if (/^(https?|mailto|tel):/i.test(next)) {
      Linking.openURL(next).catch(() => {});
    }
    return false;
  }, []);

  const onNavigationStateChange = useCallback(
    (navigation: WebViewNavigation) => {
      canGoBack.current = navigation.canGoBack;
      if (stillPairing.current && leftPairPage(navigation.url)) {
        finishPairing();
      }
    },
    [finishPairing],
  );

  const onLoadStart = useCallback((event: WebViewNavigationEvent) => {
    if (event.nativeEvent.loading) setProgress((value) => (value >= 1 ? 0.05 : value));
  }, []);

  const onLoadProgress = useCallback((event: WebViewProgressEvent) => {
    setProgress(event.nativeEvent.progress);
  }, []);

  const onLoadEnd = useCallback(() => setProgress(1), []);

  const onError = useCallback((event: WebViewErrorEvent) => {
    setLoadError(event.nativeEvent.description || `Error ${event.nativeEvent.code}`);
  }, []);

  const onRenderProcessGone = useCallback(() => {
    setInstance((value) => value + 1);
  }, []);

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await onRetry();
    } catch (error) {
      setRetryError(messageOf(error));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.root,
        {
          backgroundColor: palette.background,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: bottom,
        },
      ]}
    >
      {/* Keyed, so the native lookup under it can only find this WebView, never the last. */}
      <View key={instance} ref={container} collapsable={false} style={styles.page}>
        <WebView
          ref={webView}
          source={bridgedInstance === instance ? { uri: target } : undefined}
          style={{ backgroundColor: palette.background }}
          containerStyle={{ backgroundColor: palette.background }}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowFileAccess
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          geolocationEnabled
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          pullToRefreshEnabled={false}
          overScrollMode="never"
          applicationNameForUserAgent={USER_AGENT_SUFFIX}
          injectedJavaScriptBeforeContentLoaded={script}
          injectedJavaScript={script}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onNavigationStateChange={onNavigationStateChange}
          onLoadStart={onLoadStart}
          onLoadProgress={onLoadProgress}
          onLoadEnd={onLoadEnd}
          onError={onError}
          onRenderProcessGone={onRenderProcessGone}
          onMessage={onMessage}
        />
        {progress < 1 && !loadError ? (
          <View
            pointerEvents="none"
            style={[
              styles.progress,
              { backgroundColor: palette.accent, width: `${Math.max(progress, 0.08) * 100}%` },
            ]}
          />
        ) : null}
        {loadError ? (
          <View style={[styles.error, { backgroundColor: palette.background }]}>
            <Text style={[styles.errorTitle, { color: palette.text }]}>
              Can't reach Willow on your PC
            </Text>
            <Text style={[styles.errorBody, { color: palette.muted }]}>
              {retryError ??
                'Make sure the PC is on, Willow is running, and this phone is on the same network.'}
            </Text>
            <Text style={[styles.errorDetail, { color: palette.muted }]}>{loadError}</Text>
            <View style={styles.errorActions}>
              <Button title="Retry" onPress={() => void retry()} busy={retrying} />
              <Button title="Connect another PC" variant="text" onPress={onConnectAnother} />
            </View>
            <MenuButton onPress={onOpenSettings} style={styles.errorMenu} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Installs the bridge in the WebView under `view`, waiting up to 3 s for it to be mounted
 * natively (that trails React's commit). Past that, the WebView's own injection remains.
 */
async function installBridge(view: View | null, script: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const tag = view ? findNodeHandle(view) : null;
    if (tag != null) {
      const result = await WillowTunnel.installDocumentStartScript(tag, script, PAGE_ORIGINS).catch(
        () => 'no-webview' as const,
      );
      if (result !== 'no-webview') return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|[^/?#@]*\.localhost)(:\d+)?([/?#]|$)/i.test(url);
}

function leftPairPage(url: string): boolean {
  if (!url.startsWith(AGENTS_ORIGIN)) return false;
  const path = /^[^?#]*/.exec(url.slice(AGENTS_ORIGIN.length))?.[0] ?? '';
  return (path.replace(/\/+$/, '') || '/') !== '/pair';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  progress: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 2,
  },
  error: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 420,
  },
  errorDetail: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.8,
  },
  errorActions: {
    marginTop: 12,
    gap: 8,
    width: '100%',
    maxWidth: 360,
  },
  errorMenu: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
});
