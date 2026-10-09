/**
 * How the Codex app names a turn's work (the Codex app UI clone's lib/timeline.ts, lib/format.ts
 * and components/thread): which work forms a group, the icon of a row, a row's words while it
 * runs and once it is done, and a finished group's summary.
 */
import * as DateTime from "effect/DateTime";
import { collectToolFilePaths } from "@t3tools/shared/toolActivity";
import {
  toolGroupAction,
  workEntryViewedImagePath,
} from "@t3tools/client-runtime/work-log/presentation";

import type { WorkLogEntry } from "~/session-logic";

import type { CodexIconName } from "./codexIcons";

/** "4s", "2m 14s", "1h 3m": the compact elapsed time of activity labels (formatElapsed). */
export function formatCodexElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** rg-style alternations as quoted terms: `theme|useTheme` -> “theme” and “useTheme”. */
export function formatCodexSearchQuery(query: string): string {
  const terms = query
    .split("|")
    .map((term) => term.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  if (terms.length < 2) return `“${terms[0] ?? query}”`;
  const quoted = terms.map((term) => `“${term}”`);
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(", ")}, and ${quoted.at(-1)}`;
}

export const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() || path;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const firstString = (record: Record<string, unknown> | null, keys: readonly string[]) => {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

function entryItem(entry: WorkLogEntry) {
  return entry.projectedItem?.item ?? entry.structuredPayload;
}

/** How long the work took, from its item's start to its end (or to now, while it runs). */
export function codexEntryDurationMs(entry: WorkLogEntry, nowMs = Date.now()): number | null {
  const item = entryItem(entry);
  if (!item?.startedAt) return null;
  const startedAt = DateTime.toEpochMillis(item.startedAt);
  const endedAt = item.completedAt
    ? DateTime.toEpochMillis(item.completedAt)
    : entry.toolLifecycleStatus === "inProgress"
      ? nowMs
      : null;
  return endedAt === null ? null : Math.max(0, endedAt - startedAt);
}

function entryToolInput(entry: WorkLogEntry): Record<string, unknown> | null {
  const payload = entry.structuredPayload;
  if (payload?.type === "dynamic_tool") return asRecord(payload.input);
  const data = asRecord(entry.toolData);
  return asRecord(data?.rawInput) ?? asRecord(data?.input) ?? asRecord(data?.arguments) ?? data;
}

function entryToolName(entry: WorkLogEntry): string {
  const payload = entry.structuredPayload;
  if (payload?.type === "dynamic_tool" && payload.toolName) return payload.toolName;
  const data = asRecord(entry.toolData);
  return (
    (typeof data?.toolName === "string" ? data.toolName : null) ?? entry.toolTitle ?? entry.label
  );
}

/** A path as the row names it: relative to the project, without a leading `./`. */
function relativePath(path: string, workspaceRoot: string | undefined): string {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const root = workspaceRoot?.replaceAll("\\", "/").replace(/\/+$/, "");
  if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1) || normalized;
  }
  return normalized;
}

function entryReadPaths(entry: WorkLogEntry): string[] {
  if (entry.changedFiles?.length) return [...entry.changedFiles];
  const payload = entry.structuredPayload;
  if (payload?.type === "dynamic_tool") {
    const paths = collectToolFilePaths({ input: payload.input });
    if (paths.length > 0) return paths;
  }
  const paths = collectToolFilePaths(asRecord(entry.toolData) ?? undefined);
  if (paths.length > 0) return paths;
  const detail = entry.detail?.trim();
  return detail && !/[\r\n]/.test(detail) && !/\s/.test(detail) ? [detail] : [];
}

/** The kinds of work Codex draws differently. */
export type CodexWorkKind =
  | "reasoning"
  | "image"
  | "read"
  | "list"
  | "search"
  | "command"
  | "edit"
  | "web"
  | "browser"
  | "device"
  | "tool";

export function codexWorkKind(entry: WorkLogEntry): CodexWorkKind {
  if (entry.itemType === "reasoning") return "reasoning";
  if (workEntryViewedImagePath(entry)) return "image";
  switch (toolGroupAction(entry)) {
    case "read":
      return "read";
    case "code-search":
      return /\b(glob|ls|list|find)\b/i.test(entryToolName(entry)) ? "list" : "search";
    case "command":
      return "command";
    case "edit":
      return "edit";
    case "search":
      return "web";
    case "browser":
      return "browser";
    case "device":
      return "device";
    default:
      return "tool";
  }
}

/** A web search's sources, which its row opens to (WebSearchItem). */
export function codexWebSearchResults(
  entry: WorkLogEntry,
): ReadonlyArray<{ readonly title: string; readonly url: string | null }> {
  const item = entryItem(entry);
  if (item?.type !== "web_search") return [];
  return (item.results ?? []).flatMap((result) => {
    const title = result.title?.trim() || result.url?.trim();
    return title ? [{ title, url: result.url?.trim() || null }] : [];
  });
}

/** Work Codex gathers into a group with its neighbours; the rest stands on its own line. */
export function codexEntryJoinsGroup(entry: WorkLogEntry): boolean {
  const kind = codexWorkKind(entry);
  return kind !== "reasoning" && kind !== "image";
}

/** Reads, searches and listings are one line each and do not open (ExplorationRow). */
export function codexEntryIsExploration(entry: WorkLogEntry): boolean {
  const kind = codexWorkKind(entry);
  return kind === "read" || kind === "list" || kind === "search";
}

/** The icon of a row (ActivityGroup's iconForItem). Reasoning has none. */
export function codexIconForEntry(entry: WorkLogEntry): CodexIconName | null {
  switch (codexWorkKind(entry)) {
    case "reasoning":
      return null;
    case "image":
      return "photo";
    case "read":
      return "book-open";
    case "list":
      return "list-bullet";
    case "search":
      return "search";
    case "command":
      return entry.toolLifecycleStatus === "declined" || entry.toolLifecycleStatus === "stopped"
        ? "stop"
        : "terminal";
    case "edit":
      return "pencil";
    case "web":
      return "globe";
    case "browser":
      return "browser";
    case "device":
      return "desktop";
    default:
      // A provider's status update has no Codex row; it keeps T3's bolt.
      return toolGroupAction(entry) === "update" ? "bolt" : "mcp";
  }
}

/**
 * The icon a finished group shows: the work behind its first summary part (summaryIconItem),
 * a connector or computer use first, then an edit, a read, a command, a web search.
 */
export function codexSummaryIcon(entries: ReadonlyArray<WorkLogEntry>): CodexIconName {
  const tools = entries.filter((entry) => entry.itemType !== "reasoning");
  const kinds = tools.map((entry) => [entry, codexWorkKind(entry)] as const);
  const find = (match: (kind: CodexWorkKind, entry: WorkLogEntry) => boolean) =>
    kinds.find(([entry, kind]) => match(kind, entry))?.[0];
  const entry =
    find(
      (kind, candidate) =>
        candidate.toolSource !== undefined || kind === "browser" || kind === "device",
    ) ??
    find((kind) => kind === "edit") ??
    find((kind) => kind === "read" || kind === "list" || kind === "search") ??
    find((kind) => kind === "command") ??
    find((kind) => kind === "web") ??
    tools[0] ??
    entries[0];
  return (entry && codexIconForEntry(entry)) ?? "sparkles";
}

/**
 * A row's words, as parts: what was done, the file it names (drawn as Codex's file link, its
 * full path as a title), and the rest of the line.
 */
export interface CodexLabel {
  readonly lead: string;
  readonly file?: { readonly name: string; readonly path: string } | undefined;
  readonly rest?: string | undefined;
}

export const codexLabelText = (label: CodexLabel): string =>
  [label.lead, label.file?.name, label.rest]
    .filter(Boolean)
    .join(" ")
    .replace(/ ([,.])/g, "$1");

function editVerb(entry: WorkLogEntry, expanded: boolean): string {
  const status = entry.toolLifecycleStatus;
  const item = entryItem(entry);
  const operation =
    item?.type === "file_change" ? (item.changes?.[0]?.operation ?? "").toLowerCase() : "";
  const kind = /^(add|create|new)/.test(operation)
    ? "add"
    : /^(delete|remove)/.test(operation)
      ? "delete"
      : "update";
  if (status === "stopped") {
    return kind === "add"
      ? "Stopped creating"
      : kind === "delete"
        ? "Stopped deleting"
        : "Stopped editing";
  }
  if (status === "failed" || status === "declined") return "Rejected";
  const active = status === "inProgress";
  if (expanded && !active) {
    return kind === "add" ? "Created file" : kind === "delete" ? "Deleted file" : "Edited file";
  }
  if (kind === "add") return active ? "Creating" : "Created";
  if (kind === "delete") return active ? "Deleting" : "Deleted";
  return active ? "Editing" : "Edited";
}

/**
 * A row's line as Codex words it: "Read SettingsPage.tsx", "Searched for “theme” in src",
 * "Listed files in src", "Ran npm test in 6s" ("Ran command in 6s" once opened, its card then
 * showing the command), "Edited README.md", "Searched the web for …", "Viewed an image",
 * "Thought for 4s". Other work keeps T3's words, `fallback`.
 */
export function codexEntryLabel(
  entry: WorkLogEntry,
  options: {
    readonly expanded: boolean;
    readonly fallback: string;
    readonly workspaceRoot?: string | undefined;
    readonly nowMs?: number | undefined;
  },
): CodexLabel {
  const status = entry.toolLifecycleStatus;
  const finished = status !== "inProgress";
  const durationMs = codexEntryDurationMs(entry, options.nowMs);
  const elapsed = durationMs !== null && durationMs >= 1000 ? formatCodexElapsed(durationMs) : null;
  const input = entryToolInput(entry);
  switch (codexWorkKind(entry)) {
    case "reasoning":
      return { lead: !finished ? "Thinking" : elapsed ? `Thought for ${elapsed}` : "Thought" };
    case "image":
      return { lead: "Viewed an image" };
    case "read": {
      const [path, ...more] = entryReadPaths(entry);
      if (!path) return { lead: finished ? "Read file" : "Reading file" };
      const shown = relativePath(path, options.workspaceRoot);
      return {
        lead: finished ? "Read" : "Reading",
        file: { name: fileNameOf(shown), path: shown },
        ...(more.length > 0 ? { rest: `and ${more.length} more` } : {}),
      };
    }
    case "list": {
      const path = firstString(input, ["path", "directory", "dir"]);
      return {
        lead: `${finished ? "Listed" : "Listing"} files${path ? ` in ${relativePath(path, options.workspaceRoot)}` : ""}`,
      };
    }
    case "search": {
      const item = entryItem(entry);
      const detail = entry.detail?.trim();
      const query =
        (item?.type === "file_search" ? item.pattern?.trim() || null : null) ??
        firstString(input, ["pattern", "query", "regex", "q"]) ??
        (entry.itemType === "file_search" && detail && !/[\r\n]/.test(detail) ? detail : null);
      const path = firstString(input, ["path", "directory", "dir"]);
      return {
        lead: `${finished ? "Searched" : "Searching"} for ${query ? formatCodexSearchQuery(query) : "files"}${
          path ? ` in ${relativePath(path, options.workspaceRoot)}` : ""
        }`,
      };
    }
    case "command": {
      const command = options.fallback.trim() || entry.command?.trim() || "command";
      if (!finished) {
        return { lead: elapsed ? `Running command for ${elapsed}` : "Running command" };
      }
      if (status === "declined" || status === "stopped") {
        return {
          lead: `${options.expanded ? "Stopped command" : `Stopped ${command}`}${elapsed ? ` after ${elapsed}` : ""}`,
        };
      }
      return {
        lead: `${options.expanded ? "Ran command" : `Ran ${command}`}${elapsed ? ` in ${elapsed}` : ""}`,
      };
    }
    case "edit": {
      const item = entryItem(entry);
      const path =
        entry.changedFiles?.[0] ?? (item?.type === "file_change" ? item.fileName : undefined);
      const verb = editVerb(entry, options.expanded);
      if (!path) return { lead: verb.endsWith(" file") ? verb : `${verb} file` };
      if (verb.endsWith(" file")) return { lead: verb };
      const shown = relativePath(path, options.workspaceRoot);
      const others = (entry.changedFiles?.length ?? 1) - 1;
      return {
        lead: verb,
        file: { name: fileNameOf(shown), path: shown },
        ...(others > 0 ? { rest: `and ${others} more` } : {}),
      };
    }
    case "web": {
      const item = entryItem(entry);
      const patterns = item?.type === "web_search" ? item.patterns?.filter(Boolean) : undefined;
      const detail = entry.detail?.trim();
      const query = patterns?.length
        ? patterns.join(", ")
        : detail && !/[\r\n]/.test(detail)
          ? detail
          : firstString(input, ["query", "q"]);
      return {
        lead: `${finished ? "Searched the web" : "Searching the web"}${query ? ` for ${query}` : ""}`,
      };
    }
    case "browser":
      return { lead: finished ? "Used the browser" : options.fallback };
    case "device":
      return { lead: finished ? "Used device controls" : options.fallback };
    default:
      return { lead: options.fallback };
  }
}

/**
 * What a running group's header features: its latest unfinished work in the present tense
 * (activeLabel): "Reading SettingsPage.tsx", "Running npm test", "Editing App.tsx",
 * "Searching for “theme”", "Searching the web for …".
 */
export function codexActiveLabel(
  entry: WorkLogEntry,
  options: { readonly fallback: string; readonly workspaceRoot?: string | undefined },
): CodexLabel {
  const kind = codexWorkKind(entry);
  if (kind === "command") {
    return { lead: `Running ${options.fallback.trim() || entry.command?.trim() || "command"}` };
  }
  if (kind === "reasoning") return { lead: "Thinking" };
  const running: WorkLogEntry = { ...entry, toolLifecycleStatus: "inProgress" };
  return codexEntryLabel(running, {
    expanded: false,
    fallback: options.fallback,
    workspaceRoot: options.workspaceRoot,
  });
}

const plural = (count: number, one: string, other: string) => (count === 1 ? one : other);

/**
 * A group's summary as Codex writes it once the group is done (summaryParts): "Used GitHub,
 * edited files, read files, ran a command, searched the web". Each kind of work the group holds
 * is named once, in that order, joined by commas with no "and".
 */
export function codexToolGroupSummary(entries: ReadonlyArray<WorkLogEntry>): string {
  const tools = entries.filter((entry) => entry.itemType !== "reasoning");
  if (tools.length === 0) return entries.length > 0 ? "Thought" : "Worked";
  const sources = new Set<string>();
  const changedFiles = new Set<string>();
  let unnamedEdits = 0;
  let toolCalls = 0;
  let explored = 0;
  let commands = 0;
  let webSearches = 0;
  let updates = 0;
  for (const entry of tools) {
    if (entry.toolSource) {
      sources.add(entry.toolSource.name);
      continue;
    }
    if (toolGroupAction(entry) === "update") {
      updates += 1;
      continue;
    }
    switch (codexWorkKind(entry)) {
      case "edit":
        if (entry.changedFiles?.length)
          for (const file of entry.changedFiles) changedFiles.add(file);
        else unnamedEdits += 1;
        break;
      case "read":
      case "list":
      case "search":
      case "image":
        explored += 1;
        break;
      case "command":
        commands += 1;
        break;
      case "web":
        webSearches += 1;
        break;
      case "browser":
        sources.add("the browser");
        break;
      case "device":
        sources.add("device controls");
        break;
      default:
        toolCalls += 1;
    }
  }
  const parts: string[] = [];
  if (sources.size > 0) {
    const names = [...sources];
    parts.push(
      `Used ${
        names.length <= 2
          ? names.join(" and ")
          : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`
      }`,
    );
  }
  if (toolCalls > 0) parts.push(plural(toolCalls, "Called a tool", "Called tools"));
  const fileChanges = changedFiles.size + unnamedEdits;
  if (fileChanges > 0) parts.push(plural(fileChanges, "Edited a file", "Edited files"));
  if (explored > 0) parts.push("Read files");
  if (commands > 0) parts.push(plural(commands, "Ran a command", "Ran commands"));
  if (webSearches > 0) parts.push("Searched the web");
  if (updates > 0) parts.push(plural(updates, "Received an update", "Received updates"));
  return parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)))
    .join(", ");
}
