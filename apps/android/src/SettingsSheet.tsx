import Constants from 'expo-constants';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeConnection, type Connection } from './connection';
import { setAgentAccess, useAgentAccess } from './settings';
import { usePalette } from './theme';
import { Button } from './ui';

type Props = {
  visible: boolean;
  connection: Connection | null;
  onClose(): void;
  onDisconnect(): void;
};

const version = Constants.expoConfig?.version ?? '?';
const build = Constants.expoConfig?.android?.versionCode;

export function SettingsSheet({ visible, connection, onClose, onDisconnect }: Props) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const agentAccess = useAgentAccess();

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect this PC?',
      "The phone forgets this PC and signs out of it. To connect again, scan the PC's pairing code.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: onDisconnect },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close settings" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              paddingBottom: insets.bottom + 12,
              marginLeft: insets.left,
              marginRight: insets.right,
              maxHeight: '90%',
            },
          ]}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[styles.title, { color: palette.text }]}>Settings</Text>

            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: palette.text }]}>Let agents use this phone</Text>
                <Text style={[styles.rowBody, { color: palette.muted }]}>
                  Agents on your PC can check the battery and network, find where the phone is,
                  show notifications, vibrate, open links and copy text. Taking a photo always
                  asks you first.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Let agents use this phone"
                value={agentAccess}
                onValueChange={setAgentAccess}
                trackColor={{ true: palette.accent, false: palette.input }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            {connection ? (
              <View style={styles.section}>
                <Text style={[styles.rowBody, { color: palette.muted }]}>
                  Connected to the PC at {describeConnection(connection)}
                </Text>
                <Button title="Disconnect this PC" variant="secondary" danger onPress={confirmDisconnect} />
              </View>
            ) : (
              <Text style={[styles.rowBody, { color: palette.muted }]}>Not connected to a PC.</Text>
            )}

            <Text style={[styles.version, { color: palette.muted }]}>
              Willow for Android {version}
              {build != null ? ` (${build})` : ''}
            </Text>
            <Button title="Done" variant="text" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  content: {
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  rowBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  section: {
    gap: 12,
  },
  version: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});
