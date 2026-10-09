/** `MC` in the bundles. */
export function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return (navigator.platform ?? "").startsWith("Mac");
}

function isLinuxPlatform() {
  if (typeof navigator === "undefined") return false;
  return (navigator.platform ?? "").startsWith("Linux");
}

/** Splits an accelerator sequence into chords (`IC` in the bundles). */
export function splitAcceleratorChords(accelerator: string) {
  return accelerator.trim().split(/\s+/).filter(Boolean);
}

const MAC_CHORD_LABELS = new Map([
  ["LeftOption+RightOption", "⌥ + ⌥"],
  ["LeftAlt+RightAlt", "⌥ + ⌥"],
  ["LeftCommand+RightCommand", "⌘ + ⌘"],
  ["LeftCmd+RightCmd", "⌘ + ⌘"],
  ["LeftMeta+RightMeta", "⌘ + ⌘"],
  ["LeftShift+RightShift", "⇧ + ⇧"],
]);

function formatKey(key: string, mac: boolean, linux: boolean) {
  if (mac && key === "Plus") return "+";
  switch (key) {
    case "Enter":
      return "⏎";
    case "Escape":
      return "Esc";
    case "Left":
      return "←";
    case "Right":
      return "→";
    case "Up":
      return "↑";
    case "Down":
      return "↓";
    case "LeftOption":
      return mac ? "Left ⌥" : "Left Alt";
    case "RightOption":
      return mac ? "Right ⌥" : "Right Alt";
    case "DoubleOption":
      return mac ? "⌥ + ⌥" : "Double Option";
    case "LeftCommand":
      return mac ? "Left ⌘" : linux ? "Left Super" : "Left Win";
    case "DoubleCommand":
      return mac ? "⌘ + ⌘" : "Double Command";
    case "RightCommand":
      return mac ? "Right ⌘" : linux ? "Right Super" : "Right Win";
    case "LeftControl":
      return mac ? "Left ⌃" : "Left Control";
    case "RightControl":
      return mac ? "Right ⌃" : "Right Control";
    case "LeftShift":
      return mac ? "Left ⇧" : "Left Shift";
    case "RightShift":
      return mac ? "Right ⇧" : "Right Shift";
    case "DoubleShift":
      return mac ? "⇧ + ⇧" : "Double Shift";
    case "Dictation":
      return "F5";
    case "Fn":
      return "Fn";
    case "MouseBack":
      return "Mouse Back";
    case "MouseForward":
      return "Mouse Forward";
    default:
      return key;
  }
}

const MAC_MODIFIER_SYMBOLS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘" };

function formatChord(chord: string, mac: boolean, linux: boolean) {
  const known = MAC_CHORD_LABELS.get(chord);
  if (mac && known != null) return known;
  const modifiers = new Set<string>();
  const keys: string[] = [];
  for (const part of chord.split("+").filter(Boolean)) {
    switch (part) {
      case "CmdOrCtrl":
        modifiers.add(mac ? "Command" : "Ctrl");
        break;
      case "Command":
      case "Cmd":
      case "Super":
        modifiers.add(mac ? "Command" : linux ? "Super" : "Win");
        break;
      case "Control":
      case "Ctrl":
        modifiers.add("Ctrl");
        break;
      case "Alt":
      case "Option":
        modifiers.add("Alt");
        break;
      case "Shift":
        modifiers.add("Shift");
        break;
      default:
        keys.push(part);
    }
  }
  if (mac && keys.length === 1 && keys[0] === "/" && modifiers.has("Shift")) {
    modifiers.delete("Shift");
    keys[0] = "?";
  }
  const keyLabel = keys.map((key) => formatKey(key, mac, linux)).join("+");
  if (mac) {
    return `${["Ctrl", "Alt", "Shift", "Command"]
      .filter((modifier) => modifiers.has(modifier))
      .map((modifier) => MAC_MODIFIER_SYMBOLS[modifier])
      .join("")}${keyLabel}`;
  }
  const names = Array.from(modifiers).map((modifier) => (modifier === "Command" ? "Cmd" : modifier));
  return [...["Ctrl", "Alt", "Shift", "Cmd", "Super", "Win"].filter((modifier) => names.includes(modifier)), keyLabel].filter(Boolean).join("+");
}

/** Electron accelerator (`CmdOrCtrl+Shift+K`) as a platform label (`⇧⌘K` / `Ctrl+Shift+K`); `NC` in the bundles. */
export function formatAccelerator(accelerator: string, mac = isMacPlatform(), linux = !mac && isLinuxPlatform()) {
  return splitAcceleratorChords(accelerator)
    .map((chord) => formatChord(chord, mac, linux))
    .join(" ");
}

/** Electron accelerator as an `aria-keyshortcuts` value. */
export function acceleratorToAriaKeyShortcuts(accelerator: string | undefined) {
  return accelerator
    ?.split("+")
    .map((part) => {
      if (part === "CmdOrCtrl" || part === "CommandOrControl") return isMacPlatform() ? "Meta" : "Control";
      if (part === "Command" || part === "Cmd") return "Meta";
      if (part === "Ctrl") return "Control";
      if (part === "Option") return "Alt";
      return part;
    })
    .join("+");
}
