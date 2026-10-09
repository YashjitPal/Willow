import { useEffect, useRef } from 'react';
import './m3';

/**
 * Material's `md-switch`, controlled: the user's toggle reaches `onToggle` through the element's own `change`
 * event, and `selected` always shows what React says — so a toggle the app refuses springs back.
 */
export function M3Switch({ selected, onToggle, label, disabled }: { selected: boolean; onToggle: (selected: boolean) => void; label: string; disabled?: boolean }) {
  const ref = useRef<HTMLElement & { selected: boolean }>(null);
  const handler = useRef(onToggle);
  handler.current = onToggle;

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const onChange = () => {
      const next = element.selected;
      // Back to what React drew until the new state arrives.
      element.selected = !next;
      handler.current(next);
    };
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.selected = selected;
  }, [selected]);

  return <md-switch ref={ref} selected={selected} disabled={disabled} aria-label={label} />;
}
