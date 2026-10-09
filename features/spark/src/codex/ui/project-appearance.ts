/** `GQt` (`tDt` in app-shared): the project icon catalog, in picker order. */
export const projectIconIds = [
  "folder",
  "currency-dollar",
  "book",
  "graduation-cap",
  "edit",
  "writing",
  "function",
  "terminal",
  "music",
  "popcorn",
  "customize",
  "palette",
  "stethoscope",
  "health",
  "lotus",
  "suitcase",
  "bar-chart",
  "kettlebell",
  "dumbbell",
  "logs",
  "scale",
  "desk-globe",
  "plane",
  "globe",
  "wrench",
  "paw",
  "flask",
  "brain",
  "heart",
  "plant",
] as const;

export type ProjectIconId = (typeof projectIconIds)[number];

/** `iDt`: stored ids of retired icons and the catalog icon that replaces them. */
const retiredProjectIcons: Record<string, ProjectIconId> = {
  "balancing-scale": "scale",
  building: "folder",
  bug: "folder",
  cat: "paw",
  code: "function",
  "code-brackets": "function",
  cube: "folder",
  gift: "folder",
  "globe-spin": "desk-globe",
  graduation: "graduation-cap",
  lightbulb: "brain",
  lightning: "folder",
  lite: "lotus",
  network: "brain",
  notebook: "logs",
  openai: "folder",
  pencil: "edit",
  pens: "customize",
  pointer: "folder",
  presentation: "bar-chart",
  puzzle: "customize",
  search: "globe",
  star: "folder",
  target: "folder",
  waveform: "music",
};

function isProjectIconId(value: string): value is ProjectIconId {
  return (projectIconIds as readonly string[]).includes(value);
}

/** `JQt` (`$Et`): a stored icon id as a catalog icon; `null` for anything else (an emoji, nothing). */
export function normalizeProjectIcon(value: unknown): ProjectIconId | null {
  if (typeof value !== "string") return null;
  if (isProjectIconId(value)) return value;
  return Object.hasOwn(retiredProjectIcons, value) ? retiredProjectIcons[value] : null;
}

/** `rfr`: the named colors a project icon can take. */
export const projectColorNames = ["orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type ProjectColorName = (typeof projectColorNames)[number];

/** A named color or `black`, the default icon color. */
export type ProjectColor = ProjectColorName | "black";

/** `ifr`: CSS colors per color scheme. */
export const projectColorValues: Record<ProjectColorName, { dark: string; light: string }> = {
  blue: { dark: "#339cff", light: "#0285ff" },
  green: { dark: "#40c977", light: "#04b84c" },
  orange: { dark: "#ff8549", light: "#fb6a22" },
  pink: { dark: "#ff8cc1", light: "#ff66ad" },
  purple: { dark: "#ad7bf9", light: "#924ff7" },
  red: { dark: "#ff6764", light: "#fa423e" },
  yellow: { dark: "#ffd240", light: "#ffc300" },
};

/** `afr`: colors stored by earlier versions that map onto a named color. */
const projectColorAliases: Record<ProjectColorName, string[]> = {
  blue: ["#3a83f7"],
  green: ["#53b559"],
  orange: ["#ee7c37"],
  pink: ["#f6c8c6"],
  purple: ["#c9b1f6"],
  red: [],
  yellow: ["#f8d45d"],
};

/** `c1t` (`nfr`): swatch and icon classes per color. */
export const projectColorClasses: Record<ProjectColor, { swatchClassName: string; accentClassName: string }> = {
  black: { swatchClassName: "bg-codex-icon", accentClassName: "text-codex-icon" },
  blue: { swatchClassName: "bg-[#0285ff] dark:bg-[#339cff]", accentClassName: "text-[#0285ff] dark:text-[#339cff]" },
  green: { swatchClassName: "bg-[#04b84c] dark:bg-[#40c977]", accentClassName: "text-[#04b84c] dark:text-[#40c977]" },
  orange: { swatchClassName: "bg-[#fb6a22] dark:bg-[#ff8549]", accentClassName: "text-[#fb6a22] dark:text-[#ff8549]" },
  pink: { swatchClassName: "bg-[#ff66ad] dark:bg-[#ff8cc1]", accentClassName: "text-[#ff66ad] dark:text-[#ff8cc1]" },
  purple: { swatchClassName: "bg-[#924ff7] dark:bg-[#ad7bf9]", accentClassName: "text-[#924ff7] dark:text-[#ad7bf9]" },
  red: { swatchClassName: "bg-[#fa423e] dark:bg-[#ff6764]", accentClassName: "text-[#fa423e] dark:text-[#ff6764]" },
  yellow: { swatchClassName: "bg-[#ffc300] dark:bg-[#ffd240]", accentClassName: "text-[#ffc300] dark:text-[#ffd240]" },
};

/** `l1t` (`efr`): the color a stored theme names; `black` when empty, `null` for a custom color. */
export function projectColorName(value: string | null | undefined): ProjectColor | null {
  const trimmed = value?.trim();
  if (trimmed == null || trimmed.length === 0) return "black";
  const normalized = trimmed.toLowerCase();
  if (normalized === "black") return "black";
  return (
    projectColorNames.find(
      (name) =>
        name === normalized ||
        Object.values(projectColorValues[name]).some((color) => color.toLowerCase() === normalized) ||
        projectColorAliases[name].some((color) => color === normalized),
    ) ?? null
  );
}

/** `d1t` (`BL`): the CSS color of a stored theme in a color scheme; `null` for the default color. */
export function resolveProjectColor(value: string | null | undefined, scheme: "light" | "dark") {
  const name = projectColorName(value);
  if (name == null) return value?.trim() ?? null;
  if (name === "black") return null;
  return projectColorValues[name][scheme];
}

/** `u1t` (`tfr`): the theme stored for a picked color. */
export function projectColorTheme(color: ProjectColor) {
  return color === "black" ? null : projectColorValues[color].light;
}
