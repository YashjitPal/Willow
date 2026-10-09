import { useCallback, useEffect, useState } from 'react';
import { Keyboard, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The space to keep clear at the bottom of a full-screen view: the navigation bar,
 * or the keyboard while it is up. Edge to edge, Android no longer resizes the window
 * for the keyboard; measuring against the view's own height stays right on devices
 * that still do. Pass `onLayout` to the full-screen view.
 */
export function useBottomInset(): { bottom: number; onLayout: (event: LayoutChangeEvent) => void } {
  const insets = useSafeAreaInsets();
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
  }, []);

  const bottom =
    keyboardTop != null && height > 0
      ? Math.max(insets.bottom, height - keyboardTop)
      : insets.bottom;
  return { bottom, onLayout };
}
