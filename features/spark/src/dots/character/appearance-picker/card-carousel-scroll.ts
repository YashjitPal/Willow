type Direction = "ltr" | "rtl";

/** lodash `clamp`: the upper bound applies first, the lower bound wins. */
function clamp(value: number, lower: number, upper: number) {
  return Math.max(lower, Math.min(value, upper));
}

function scrollPadding(container: HTMLElement, direction: Direction) {
  const style = getComputedStyle(container);
  const padding = Number.parseFloat(direction === "rtl" ? style.scrollPaddingRight : style.scrollPaddingLeft);
  return Number.isNaN(padding) ? 0 : padding;
}

function itemScrollPosition(container: HTMLElement, item: HTMLElement, direction: Direction) {
  if (direction === "rtl") return item.offsetLeft - container.offsetLeft + item.offsetWidth - container.clientWidth + scrollPadding(container, direction);
  return item.offsetLeft - container.offsetLeft - scrollPadding(container, direction);
}

/** Scroll range of a carousel, starting at its first item's snap position. */
export function carouselScrollBounds(container: HTMLElement, direction: Direction = "ltr") {
  const overflow = Math.max(0, container.scrollWidth - container.clientWidth);
  if (direction === "rtl") return { maximum: 0, minimum: -overflow };
  const first = container.firstElementChild;
  const maximum = overflow;
  return { maximum, minimum: Math.min(maximum, first instanceof HTMLElement ? Math.max(0, itemScrollPosition(container, first, direction)) : 0) };
}

/** Where to scroll for the next (`1`) or previous (`-1`) page, aligned to an item. */
export function carouselPagePosition(container: HTMLElement, step: 1 | -1, direction: Direction = "ltr") {
  const { maximum, minimum } = carouselScrollBounds(container, direction);
  const delta = direction === "rtl" ? -step : step;
  const target = clamp(container.scrollLeft + delta * (container.clientWidth - scrollPadding(container, direction)), minimum, maximum);
  const items = container.children;
  for (let index = step === 1 ? 0 : items.length - 1; index >= 0 && index < items.length; index += step) {
    const item = items.item(index);
    if (!(item instanceof HTMLElement)) continue;
    const position = clamp(itemScrollPosition(container, item, direction), minimum, maximum);
    if ((delta === 1 && position >= target - 1) || (delta === -1 && position <= target + 1)) return position;
  }
  return delta === 1 ? maximum : minimum;
}
