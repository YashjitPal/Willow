/**
 * Where a character of a textarea sits on screen, measured with a hidden copy of the textarea laid
 * out the same way: same box, same type, same wrapping. A textarea exposes no geometry for its
 * text, and the mention menu opens at the trigger character, as Gemini's does.
 */

const MIRRORED = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily', 'fontVariationSettings', 'fontFeatureSettings',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform', 'textIndent', 'tabSize', 'direction',
] as const;

/** Copies the textarea's text layout onto another element. */
export const mirrorTextareaStyle = (textarea: HTMLTextAreaElement, target: HTMLElement): void => {
  const style = getComputedStyle(textarea);
  for (const property of MIRRORED) target.style[property] = style[property];
  target.style.whiteSpace = 'pre-wrap';
  target.style.overflowWrap = 'break-word';
  target.style.wordBreak = style.wordBreak;
  // The scrollbar's room, if any, is not text room.
  target.style.width = `${textarea.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
  target.style.boxSizing = 'border-box';
};

/** The viewport position of the character at `index`: its left edge, and the top of its line box. */
export const caretRect = (textarea: HTMLTextAreaElement, index: number): { left: number; top: number; lineHeight: number } => {
  const mirror = document.createElement('div');
  mirrorTextareaStyle(textarea, mirror);
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.height = 'auto';
  mirror.textContent = textarea.value.slice(0, index);
  // One character in the marker, so it is one line however the rest wraps.
  const marker = document.createElement('span');
  marker.textContent = textarea.value[index] ?? '\u200b';
  mirror.appendChild(marker);
  mirror.appendChild(document.createTextNode(textarea.value.slice(index + 1)));
  document.body.appendChild(mirror);
  const style = getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const box = textarea.getBoundingClientRect();
  const left = box.left + marker.offsetLeft - textarea.scrollLeft;
  // An inline box sits centred in its line; the menu hangs from the line itself.
  const top = box.top + marker.offsetTop - (lineHeight - marker.offsetHeight) / 2 - textarea.scrollTop;
  mirror.remove();
  return { left, top, lineHeight };
};
