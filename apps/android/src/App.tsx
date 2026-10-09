import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import WillowTunnel from '../modules/willow-tunnel';
import { ConnectScreen } from './ConnectScreen';
import {
  connectWithLink,
  describeConnection,
  disconnect,
  loadConnection,
  reconnect,
  WILLOW_URL,
  type Connection,
  type PairingLink,
} from './connection';
import { loadSettings } from './settings';
import { SettingsSheet } from './SettingsSheet';
import { usePalette } from './theme';
import { Button, messageOf } from './ui';
import { WebScreen } from './WebScreen';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** `visit` changes on every move, so a slow reconnect can tell it was overtaken. */
type Screen =
  | { name: 'starting'; visit: number }
  | { name: 'reconnecting'; connection: Connection; visit: number }
  | { name: 'connect'; error?: string; visit: number }
  | { name: 'web'; url: string; pairing: boolean; visit: number };

const PAIRING_REQUIRED =
  "This phone isn't paired with your PC anymore. Scan the pairing QR code in the agents tab's Settings > Connections again.";

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const palette = usePalette();
  const [screen, setScreen] = useState<Screen>({ name: 'starting', visit: 0 });
  const [saved, setSaved] = useState<Connection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visits = useRef(0);
  const savedRef = useRef<Connection | null>(null);

  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.background).catch(() => {});
  }, [palette.background]);

  const showConnect = useCallback((error?: string) => {
    setScreen({ name: 'connect', error, visit: ++visits.current });
  }, []);

  const showWeb = useCallback((url: string, pairing: boolean) => {
    setScreen({ name: 'web', url, pairing, visit: ++visits.current });
  }, []);

  const reconnectTo = useCallback(
    async (connection: Connection) => {
      const visit = ++visits.current;
      setScreen({ name: 'reconnecting', connection, visit });
      try {
        const fresh = await reconnect(connection);
        if (visits.current !== visit) return;
        setSaved(fresh);
        showWeb(WILLOW_URL, false);
      } catch (error) {
        if (visits.current === visit) showConnect(messageOf(error));
      }
    },
    [showConnect, showWeb],
  );

  useEffect(() => {
    let connection: Connection | null = null;
    Promise.all([loadSettings(), loadConnection()])
      .then(([, stored]) => {
        connection = stored;
      })
      .finally(() => {
        SplashScreen.hideAsync().catch(() => {});
        setSaved(connection);
        if (connection) void reconnectTo(connection);
        else showConnect();
      });
  }, [reconnectTo, showConnect]);

  const connectWith = useCallback(
    async (link: PairingLink) => {
      const visit = visits.current;
      const { connection, pairUrl } = await connectWithLink(link);
      if (visits.current !== visit) return;
      setSaved(connection);
      showWeb(pairUrl, true);
    },
    [showWeb],
  );

  const retry = useCallback(async () => {
    const connection = savedRef.current;
    if (!connection) {
      showConnect();
      return;
    }
    const visit = visits.current;
    const fresh = await reconnect(connection);
    if (visits.current !== visit) return;
    setSaved(fresh);
    showWeb(WILLOW_URL, false);
  }, [showConnect, showWeb]);

  const disconnectPc = useCallback(async () => {
    setSettingsOpen(false);
    await disconnect();
    await WillowTunnel.clearCookies().catch(() => false);
    setSaved(null);
    showConnect();
  }, [showConnect]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const onPairingRequired = useCallback(() => showConnect(PAIRING_REQUIRED), [showConnect]);
  const connectAnother = useCallback(() => showConnect(), [showConnect]);
  const reconnectSaved = useCallback(() => {
    if (savedRef.current) void reconnectTo(savedRef.current);
  }, [reconnectTo]);

  let content: ReactNode = null;
  switch (screen.name) {
    case 'starting':
      content = null;
      break;
    case 'reconnecting':
      content = <Reconnecting connection={screen.connection} onCancel={connectAnother} />;
      break;
    case 'connect':
      content = (
        <ConnectScreen
          key={screen.visit}
          error={screen.error}
          saved={saved}
          onConnect={connectWith}
          onReconnect={reconnectSaved}
          onOpenSettings={openSettings}
        />
      );
      break;
    case 'web':
      content = (
        <WebScreen
          key={screen.visit}
          url={screen.url}
          pairing={screen.pairing}
          onPairingRequired={onPairingRequired}
          onOpenSettings={openSettings}
          onConnectAnother={connectAnother}
          onRetry={retry}
        />
      );
      break;
  }

  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      <StatusBar style={palette.scheme === 'dark' ? 'light' : 'dark'} />
      {content}
      <SettingsSheet
        visible={settingsOpen}
        connection={saved}
        onClose={() => setSettingsOpen(false)}
        onDisconnect={() => void disconnectPc()}
      />
    </View>
  );
}

function Reconnecting({ connection, onCancel }: { connection: Connection; onCancel(): void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.fill,
        styles.center,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <Image source={require('../assets/willow.png')} style={styles.logo} />
      <ActivityIndicator color={palette.muted} />
      <Text style={[styles.status, { color: palette.muted }]}>
        Connecting to your PC at {describeConnection(connection)}…
      </Text>
      <Button title="Connect another PC" variant="text" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  logo: {
    width: 64,
    height: 64,
  },
  status: {
    fontSize: 15,
    textAlign: 'center',
  },
});
