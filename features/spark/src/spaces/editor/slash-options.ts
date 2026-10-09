import { slashCommands, type SlashCommand, type SlashSection } from "./slash-commands";

export interface SlashCapabilities {
  canCreateSubpage: boolean;
  canCreateCanvas: boolean;
  canGenerate: boolean;
  canInsertTask: boolean;
  canInsertAgentInstructions: boolean;
  canVisualize: boolean;
  canInsertImage: boolean;
  canLinkPage: boolean;
  canMention: boolean;
  canCreateArtifacts: boolean;
  canUploadFiles: boolean;
}

/** Defaults of `eL`'s options; the gated ones (canvas, task, instructions, artifacts) start off. */
export const defaultSlashCapabilities: SlashCapabilities = {
  canCreateSubpage: true,
  canCreateCanvas: false,
  canGenerate: true,
  canInsertTask: false,
  canInsertAgentInstructions: false,
  canVisualize: true,
  canInsertImage: true,
  canLinkPage: true,
  canMention: true,
  canCreateArtifacts: false,
  canUploadFiles: true,
};

/** Where the caret sits, as `eL` reads it from the ProseMirror selection. */
export interface SlashContext {
  /** `$from.depth === 1` and the parent is a paragraph. */
  inTopLevelParagraph: boolean;
  /** `$from.depth === 1`. */
  topLevel: boolean;
  inTable: boolean;
  inCallout: boolean;
  /** The parent holds inline content and is not code. */
  inlineContent: boolean;
  /** A text or visualization generation is already running on this page. */
  generating: boolean;
}

const generateKeywords = "generate agi write draft";

const emptyQueryOrder: SlashSection[] = ["generate", "create", "media", "basic", "mentioned", "table", "generatePrompt"];

const artifactCommandIds = new Set(["canvas", "presentation", "spreadsheet"]);

/** `tL`: the prompt typed after one of a command's prefixes ("visualize a funnel" -> "a funnel"). */
export function slashCommandPrompt(command: SlashCommand, query: string) {
  const prefix = command.commands?.find((entry) => query.toLowerCase().startsWith(`${entry} `));
  return prefix == null ? null : query.slice(prefix.length).trimStart();
}

/** `nL`: the artifact type a query asks for, if any. */
function artifactForQuery(query: string) {
  for (const command of slashCommands) {
    if (artifactCommandIds.has(command.id) && (query === command.id || slashCommandPrompt(command, query) != null)) return command.id;
  }
  return null;
}

function sortBySection(options: SlashCommand[], rank: (command: SlashCommand) => number) {
  return options
    .map((command, index) => ({ command, index, rank: rank(command) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command);
}

/** `eL`: the commands offered by the slash menu (`/query`) and the header Insert menu (`insertBelow`). */
export function slashOptions(
  capabilities: SlashCapabilities,
  context: SlashContext,
  { insertBelow = false, query = "", canCreateArtifact = () => true }: { insertBelow?: boolean; query?: string; canCreateArtifact?: (id: string) => boolean } = {},
): SlashCommand[] {
  const requested = artifactForQuery(query);
  if (requested != null && !canCreateArtifact(requested)) return [];
  const inTable = !insertBelow && context.inTable;
  const atParagraph = insertBelow || context.inTopLevelParagraph;
  const canGenerateHere = capabilities.canGenerate && !context.generating && atParagraph;
  const canVisualizeHere = capabilities.canVisualize && !context.generating && (insertBelow || context.topLevel);
  const options = slashCommands.filter((command) => {
    const { id } = command;
    if (inTable ? !(command.section === "table" || ["paragraph", "unorderedList", "orderedList", "code"].includes(id)) : command.section === "table") return false;
    if (id === "page" && !capabilities.canCreateSubpage) return false;
    if (id === "agentInstructions" && !(capabilities.canInsertAgentInstructions && atParagraph)) return false;
    if (artifactCommandIds.has(id) && !canCreateArtifact(id)) return false;
    if (id === "canvas" && !(capabilities.canCreateCanvas && atParagraph && (slashCommandPrompt(command, query) == null || capabilities.canGenerate))) return false;
    if (id === "generate" && !canGenerateHere) return false;
    if (id === "prompt" && !atParagraph) return false;
    if (id === "task" && !(capabilities.canGenerate && capabilities.canInsertTask && atParagraph)) return false;
    if (id === "image" && !capabilities.canInsertImage) return false;
    if (id === "callout" && !(insertBelow || !context.inCallout)) return false;
    if (id === "linkPage" && !capabilities.canLinkPage) return false;
    if (command.section === "mentioned" && !capabilities.canMention) return false;
    if ((id === "spreadsheet" || id === "presentation") && !(capabilities.canCreateArtifacts && context.inlineContent)) return false;
    if (id === "file" && !capabilities.canUploadFiles) return false;
    if (command.commands != null && id !== "canvas" && !canVisualizeHere) return false;
    if (query === "" && command.prompt != null) return false;
    if (id === "generatePrompt") return canGenerateHere && query !== "" && !generateKeywords.includes(query);
    return command.keywords.includes(query) || slashCommandPrompt(command, query) != null || (id === "table" && query.startsWith("table"));
  });
  if (query !== "" && options.some((command) => command.id === "generate")) {
    return sortBySection(options, (command) => (command.section === "create" && command.id !== "page" ? 0 : command.section === "generate" ? 1 : 2));
  }
  if (query === "") return sortBySection(options, (command) => emptyQueryOrder.indexOf(command.section));
  return options;
}
