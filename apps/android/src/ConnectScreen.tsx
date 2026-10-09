import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  describeConnection,
  parsePairingLink,
  type Connection,
  type PairingLink,
} from './connection';
import { useBottomInset } from './keyboard';
import { usePalette } from './theme';
import { Button, ErrorBox, MenuButton, messageOf } from './ui';

type Props = {
  error?: string;
  saved: Connection | null;
  /** Rejects with a message for the owner; on success the app moves on. */
  onConnect(link: PairingLink): Promise<void>;
  onReconnect(): void;
  onOpenSettings(): void;
};

export function ConnectScreen({ error: initialError, saved, onConnect, onReconnect, onOpenSettings }: Props) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { bottom, onLayout } = useBottomInset();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const scanned = useRef(false);

  const submit = async (text: string) => {
    if (busy) return;
    let parsed: PairingLink;
    try {
      parsed = parsePairingLink(text);
    } catch (problem) {
      setError(messageOf(problem));
      return;
    }
    setError(null);
    setScanning(false);
    setBusy(true);
    try {
      await onConnect(parsed);
    } catch (problem) {
      setError(messageOf(problem));
      setBusy(false);
    }
  };

  const startScanning = async () => {
    setError(null);
    const status = permission?.granted ? permission : await requestPermission();
    if (!status.granted) {
      setError('Willow needs the camera to scan the pairing code. You can paste the link instead.');
      return;
    }
    scanned.current = false;
    setScanning(true);
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (scanned.current) return;
    scanned.current = true;
    setScanning(false);
    setLink(data);
    void submit(data);
  };

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (text.trim()) setLink(text.trim());
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
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Image source={require('../assets/willow.png')} style={styles.logo} />
        <Text style={[styles.title, { color: palette.text }]}>Connect to your PC</Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          On your PC, open Willow's agents tab and go to Settings {'>'} Connections. Turn on
          Network access, then scan the pairing QR code shown there. Your phone and PC need to be
          on the same network.
        </Text>

        {scanning ? (
          <View style={styles.scanner}>
            <View style={[styles.camera, { borderColor: palette.border }]}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onScanned}
              />
            </View>
            <Button title="Cancel" variant="text" onPress={() => setScanning(false)} />
          </View>
        ) : (
          <Button title="Scan the QR code" onPress={startScanning} disabled={busy} />
        )}

        <Text style={[styles.label, { color: palette.muted }]}>Or paste the pairing link</Text>
        <View style={[styles.field, { backgroundColor: palette.input }]}>
          <TextInput
            value={link}
            onChangeText={setLink}
            onSubmitEditing={() => void submit(link)}
            placeholder="http://192.168.1.20:3773/pair#token=…"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            editable={!busy}
            style={[styles.input, { color: palette.text }]}
          />
          <Button title="Paste" variant="text" onPress={() => void paste()} disabled={busy} />
        </View>
        <Button
          title="Connect"
          variant="secondary"
          onPress={() => void submit(link)}
          disabled={!link.trim()}
          busy={busy}
        />

        {error ? <ErrorBox text={error} /> : null}

        {saved && !busy ? (
          <Button
            title={`Try ${describeConnection(saved)} again`}
            variant="text"
            onPress={onReconnect}
          />
        ) : null}
      </ScrollView>

      <MenuButton
        onPress={onOpenSettings}
        style={[styles.menu, { top: insets.top + 8, right: insets.right + 8 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 32,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  logo: {
    width: 72,
    height: 72,
    alignSelf: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  scanner: {
    gap: 8,
  },
  camera: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 360,
    alignSelf: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  label: {
    fontSize: 13,
    marginTop: 8,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingLeft: 14,
  },
  input: {
    flex: 1,
    minHeight: 48,
    fontSize: 15,
  },
  menu: {
    position: 'absolute',
  },
});
