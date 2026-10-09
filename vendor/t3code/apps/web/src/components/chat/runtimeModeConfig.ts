import type { RuntimeMode } from "@t3tools/contracts";
import type { LucideIcon } from "lucide-react";

import { willowSymbol } from "~/willow/icons";

/** Each mode's Material Symbol, as Willow draws its own; the first is the Codex app's wording. */
export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Ask for approval",
    description: "Ask before commands and file changes.",
    icon: willowSymbol("back_hand"),
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: willowSymbol("edit_note"),
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: willowSymbol("verified_user"),
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: willowSymbol("lock", "luminous"),
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
