import * as Battery from 'expo-battery';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { Alert, Linking } from 'react-native';

import { getAgentAccess } from './settings';

/** What agents on the PC may ask this phone to do (`window.__WILLOW_ANDROID__.tools`). */
export const TOOL_NAMES = [
  'phone_status',
  'phone_location',
  'phone_notify',
  'phone_vibrate',
  'phone_open_url',
  'phone_clipboard_set',
  'phone_photo',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

type Args = Record<string, unknown>;

const NOTIFICATION_CHANNEL = 'agents';
const LOCATION_TIMEOUT_MS = 20_000;
const LAST_KNOWN_LOCATION_MAX_AGE_MS = 10 * 60_000;

// Without a handler expo-notifications drops notifications while the app is in front,
// which is exactly when agents send them.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const tools: Record<ToolName, (args: Args) => Promise<unknown>> = {
  phone_status: status,
  phone_location: location,
  phone_notify: notify,
  phone_vibrate: vibrate,
  phone_open_url: openUrl,
  phone_clipboard_set: clipboardSet,
  phone_photo: photo,
};

/** Runs one tool. Rejects with a message meant for the agent. */
export async function dispatch(tool: string, args: unknown): Promise<unknown> {
  if (!getAgentAccess()) {
    throw new Error('Agent access is turned off on this phone');
  }
  if (!(TOOL_NAMES as readonly string[]).includes(tool)) {
    throw new Error(`Unknown phone tool: ${tool || '(none)'}`);
  }
  if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
    throw new Error('args must be an object');
  }
  return tools[tool as ToolName]((args as Args | null | undefined) ?? {});
}

async function status() {
  const [level, state, network] = await Promise.all([
    Battery.getBatteryLevelAsync().catch(() => -1),
    Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
    Network.getNetworkStateAsync().catch(() => null),
  ]);
  return {
    model: Device.modelName,
    manufacturer: Device.manufacturer,
    osName: Device.osName,
    osVersion: Device.osVersion,
    battery: {
      level: level >= 0 ? Math.round(level * 100) / 100 : null,
      state: batteryState(state),
    },
    network: {
      type: (network?.type ?? Network.NetworkStateType.UNKNOWN).toLowerCase(),
      connected: network?.isConnected ?? false,
    },
  };
}

function batteryState(state: Battery.BatteryState): 'charging' | 'full' | 'unplugged' | 'unknown' {
  switch (state) {
    case Battery.BatteryState.CHARGING:
      return 'charging';
    case Battery.BatteryState.FULL:
      return 'full';
    case Battery.BatteryState.UNPLUGGED:
      return 'unplugged';
    default:
      return 'unknown';
  }
}

async function location(args: Args) {
  const accuracy = optionalChoice(args, 'accuracy', ['balanced', 'high'] as const) ?? 'balanced';
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) {
    throw new Error('The phone owner has not allowed Willow to use the location');
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Location is turned off on this phone');
  }
  let position: Location.LocationObject | null;
  try {
    position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: accuracy === 'high' ? Location.Accuracy.High : Location.Accuracy.Balanced,
      }),
      LOCATION_TIMEOUT_MS,
    );
  } catch {
    position = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_LOCATION_MAX_AGE_MS,
    }).catch(() => null);
  }
  if (!position) {
    throw new Error('The phone could not get a location fix in time');
  }
  const { latitude, longitude, accuracy: radius, altitude } = position.coords;
  return { latitude, longitude, accuracy: radius, altitude, timestamp: position.timestamp };
}

let notificationChannel: Promise<unknown> | null = null;

/**
 * Shows a notification. Also Willow's own (an agent's turn finishing, through the page's
 * `notify` message), which agent access does not gate; one with a `tag` replaces the last
 * with that tag.
 */
export async function showNotification(title: string, body?: string, tag?: string): Promise<void> {
  // Android 13+ shows the notification permission prompt only once a channel exists.
  notificationChannel ??= Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL, {
    name: 'Agents',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await notificationChannel;
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    throw new Error('Notifications are turned off for Willow on this phone');
  }
  await Notifications.scheduleNotificationAsync({
    ...(tag ? { identifier: `willow-${tag}` } : {}),
    content: body ? { title, body } : { title },
    trigger: { channelId: NOTIFICATION_CHANNEL },
  });
}

async function notify(args: Args) {
  await showNotification(requiredString(args, 'title', 200), optionalString(args, 'body', 4000));
  return { shown: true };
}

async function vibrate(args: Args) {
  const pattern =
    optionalChoice(args, 'pattern', [
      'light',
      'medium',
      'heavy',
      'success',
      'warning',
      'error',
    ] as const) ?? 'medium';
  switch (pattern) {
    case 'light':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'heavy':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;
    case 'success':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'error':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
  }
  return { done: true };
}

async function openUrl(args: Args) {
  const url = requiredString(args, 'url', 8192);
  if (!isWebUrl(url)) {
    throw new Error('url must be an http:// or https:// address');
  }
  try {
    await Linking.openURL(url);
    return { opened: true };
  } catch {
    return { opened: false };
  }
}

async function clipboardSet(args: Args) {
  const text = args.text;
  if (typeof text !== 'string') {
    throw new Error('text must be a string');
  }
  if (text.length > 1_000_000) {
    throw new Error('text must be at most 1000000 characters');
  }
  await Clipboard.setStringAsync(text);
  return { done: true };
}

let photoPending = false;

async function photo(args: Args) {
  const maxSize = Math.round(optionalNumber(args, 'maxSize', 64, 4096) ?? 1024);
  if (photoPending) {
    throw new Error('Another photo request is already waiting for the phone owner');
  }
  photoPending = true;
  try {
    if (!(await askToTakePhoto())) {
      throw new Error('The phone owner declined');
    }
    let permission = await ImagePicker.getCameraPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await ImagePicker.requestCameraPermissionsAsync();
    }
    if (!permission.granted) {
      throw new Error('The phone owner has not allowed Willow to use the camera');
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      exif: false,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) {
      throw new Error('The phone owner cancelled the photo');
    }
    return await encodePhoto(asset, maxSize);
  } finally {
    photoPending = false;
  }
}

function askToTakePhoto(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Willow',
      'An agent wants to take a photo with your camera. Allow?',
      [
        { text: 'Deny', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Allow', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** A JPEG no larger than `maxSize` on its long edge, as base64. */
async function encodePhoto(asset: ImagePicker.ImagePickerAsset, maxSize: number) {
  const refs: { release(): void }[] = [];
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    refs.push(context);
    if (Math.max(asset.width, asset.height) > maxSize) {
      context.resize(longEdge(asset.width, asset.height, maxSize));
    }
    let image: ImageRef = await context.renderAsync();
    refs.push(image);
    // The picker can report a rotated photo's sides swapped; check what was rendered.
    if (Math.max(image.width, image.height) > maxSize + 1) {
      const again = ImageManipulator.manipulate(image).resize(
        longEdge(image.width, image.height, maxSize),
      );
      refs.push(again);
      image = await again.renderAsync();
      refs.push(image);
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    if (!saved.base64) {
      throw new Error('The photo could not be encoded');
    }
    return { mimeType: 'image/jpeg', base64: saved.base64, width: saved.width, height: saved.height };
  } finally {
    for (const ref of refs) ref.release();
  }
}

function longEdge(width: number, height: number, size: number) {
  return width >= height ? { width: size } : { height: size };
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(url);
}

function requiredString(args: Args, key: string, maxLength: number): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${key} must be at most ${maxLength} characters`);
  }
  return value;
}

function optionalString(args: Args, key: string, maxLength: number): string | undefined {
  if (args[key] == null || args[key] === '') return undefined;
  return requiredString(args, key, maxLength);
}

function optionalNumber(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number from ${min} to ${max}`);
  }
  return value;
}

function optionalChoice<T extends string>(args: Args, key: string, choices: readonly T[]): T | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== 'string' || !(choices as readonly string[]).includes(value)) {
    throw new Error(`${key} must be one of: ${choices.join(', ')}`);
  }
  return value as T;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
