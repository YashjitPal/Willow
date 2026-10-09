import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { usePalette } from './theme';

type ButtonProps = {
  title: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
};

export function Button({ title, onPress, variant = 'primary', disabled, busy, danger }: ButtonProps) {
  const palette = usePalette();
  const inactive = disabled || busy;
  const background =
    variant === 'primary' ? palette.primary : variant === 'secondary' ? palette.input : 'transparent';
  const color = danger
    ? palette.danger
    : variant === 'primary'
      ? palette.onPrimary
      : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'text' && styles.textButton,
        { backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.buttonText, { color }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Android's overflow glyph: opens the settings sheet. */
export function MenuButton({ onPress, style }: { onPress(): void; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }, style]}
    >
      {[0, 1, 2].map((dot) => (
        <View key={dot} style={[styles.menuDot, { backgroundColor: palette.muted }]} />
      ))}
    </Pressable>
  );
}

export function ErrorBox({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.errorBox, { backgroundColor: palette.dangerSurface }]}
    >
      <Text style={[styles.errorText, { color: palette.danger }]}>{text}</Text>
    </View>
  );
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    minHeight: 40,
    paddingHorizontal: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  menuButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  menuDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  errorBox: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
