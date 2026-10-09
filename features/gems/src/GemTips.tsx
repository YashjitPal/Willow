import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

/**
 * An info button and the `tips-card` it opens: 312 wide on `rgb(31,55,96)`, 8px corners,
 * standing 8px above the button with their left edges flush and pushed back on screen.
 * An optional 13px title over 15px body copy, then "Got it". Gemini's cards also carry a
 * "Learn more" into Google's help centre, which Willow has no equivalent of.
 */
export const GemTips: React.FC<{
  label: string;
  title?: string;
  body: string;
  /** The Knowledge button is padded 10, every other one 8 — measured. */
  padding?: number;
}> = ({ label, title, body, padding = 8 }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !cardRef.current) return;
    const button = buttonRef.current.getBoundingClientRect();
    const card = cardRef.current;
    const left = Math.max(8, Math.min(button.left, window.innerWidth - card.offsetWidth - 8));
    const above = button.top - 8 - card.offsetHeight;
    setPosition({ left, top: above >= 8 ? above : button.bottom + 8 });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => { setOpen(false); setPosition(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="gems-icon-button"
        style={{ padding }}
        onClick={() => {
          setOpen((value) => !value);
          setPosition(null);
        }}
      >
        <MaterialSymbol name="info" family="google-symbols" size={20} weight={400} />
      </button>
      {open && createPortal(
        <div
          ref={cardRef}
          role="dialog"
          aria-label={title ?? label}
          className="gems-surface gems-tips"
          style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
        >
          {title && <h4 className="gems-tips-title">{title}</h4>}
          <p className="gems-tips-body">{body}</p>
          <div className="gems-tips-actions">
            <button type="button" className="gems-text-button" onClick={() => { setOpen(false); setPosition(null); }}>
              Got it
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
