/**
 * A turn's activity as the Codex app draws it (the Codex app UI clone's components/thread): its
 * icons, the disclosure chevron that fades in beside a summary, the shell card under a command,
 * the unified diff under an edit, and the diff stats. activitySummary.ts names the work.
 */
import { createContext, use, useMemo, useState, type SVGProps } from "react";

import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";

import type { CodexLabel } from "./activitySummary";
import { codexIcons, type CodexIconName } from "./codexIcons";

export type { CodexIconName };
export { fileNameOf, formatCodexElapsed } from "./activitySummary";

/** Under it Codex's icons keep their own drawings, as the timeline draws a turn's work. */
export const CodexDrawings = createContext(false);

/**
 * Willow's glyph (Material Symbols Rounded) for each Codex icon that means the same thing. Brand
 * marks and the git glyphs, which Willow has no glyph for, keep Codex's drawing.
 */
const WILLOW_GLYPHS: Partial<Record<CodexIconName, string>> = {
  "arrow-left": "arrow_back",
  "arrow-right": "arrow_forward",
  "arrow-up-right": "arrow_outward",
  bolt: "bolt",
  "book-open": "menu_book",
  brain: "psychology",
  browser: "web",
  camera: "photo_camera",
  check: "check",
  "check-circle": "check_circle",
  "chevron-down-sm": "keyboard_arrow_down",
  "chevron-right-sm": "chevron_right",
  "chevron-up-down": "unfold_more",
  "chrome-logo": "web",
  circle: "radio_button_unchecked",
  "clipboard-list": "assignment",
  close: "close",
  code: "code",
  collapse: "collapse_content",
  copy: "content_copy",
  desktop: "desktop_windows",
  diff: "difference",
  document: "description",
  ellipsis: "more_horiz",
  expand: "expand_content",
  eye: "visibility",
  filter: "filter_list",
  folder: "folder",
  "folder-open": "folder_open",
  gear: "settings",
  globe: "language",
  hand: "back_hand",
  info: "info",
  laptop: "laptop",
  lightbulb: "lightbulb",
  "list-bullet": "format_list_bulleted",
  mcp: "extension",
  minus: "remove",
  "open-link": "open_in_new",
  pencil: "edit",
  photo: "image",
  plus: "add",
  "pop-out": "open_in_new",
  reload: "refresh",
  robot: "smart_toy",
  search: "search",
  sparkles: "auto_awesome",
  spinner: "progress_activity",
  stack: "stacks",
  stop: "stop_circle",
  subagents: "group",
  summary: "summarize",
  tasks: "checklist",
  terminal: "terminal",
  "text-wrap": "wrap_text",
  toolbox: "home_repair_service",
  trash: "delete",
  undo: "undo",
  "view-split": "vertical_split",
  "view-unified": "view_agenda",
  warning: "warning",
  wrench: "build",
  "x-circle": "cancel",
};

/**
 * One of the Codex desktop icons, drawn with Willow's glyph for it when Willow has one, except
 * under CodexDrawings.
 */
export function CodexIcon({
  name,
  className,
  ...rest
}: { name: CodexIconName; className?: string | undefined } & Omit<
  SVGProps<SVGSVGElement>,
  "name" | "className"
>) {
  const glyph = use(CodexDrawings) ? undefined : WILLOW_GLYPHS[name];
  if (glyph) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        data-codex-icon={name}
        data-willow-icon={glyph}
        className={cn("shrink-0", className)}
        {...rest}
      >
        <foreignObject x={0} y={0} width={24} height={24}>
          <i className="willow-icon-glyph" data-glyph={glyph} />
        </foreignObject>
      </svg>
    );
  }
  const icon = codexIcons[name];
  return (
    <svg
      viewBox={icon.viewBox}
      fill="none"
      aria-hidden
      data-codex-icon={name}
      className={cn("shrink-0", className)}
      // The bodies are the app's own static icon set.
      dangerouslySetInnerHTML={{ __html: icon.body.replace(FIXED_INK, 'fill="currentColor"') }}
      {...rest}
    />
  );
}

/** The light theme's ink, which two one-colour drawings (mcp, spinner) carry instead of currentColor. */
const FIXED_INK = /fill="(?:#222326|black)"/g;

/** The 14px chevron after a row's summary: hidden until the row is pointed at, turned while open. */
export function CodexChevron({ expanded }: { expanded: boolean }) {
  return (
    <span className="willow-activity-chevron-slot" aria-hidden>
      <CodexIcon
        name="chevron-right-sm"
        className="willow-activity-chevron"
        data-expanded={expanded ? "" : undefined}
      />
    </span>
  );
}

/**
 * A row's words, the file it names standing out at 60% as Codex's file links do among the row's
 * dimmer words ("Read SettingsPage.tsx"), its full path as the title.
 */
export function CodexLabelView({ label }: { label: CodexLabel }) {
  return (
    <>
      {label.lead}
      {label.file ? (
        <>
          {" "}
          <span className="willow-activity-file" title={label.file.path}>
            {label.file.name}
          </span>
        </>
      ) : null}
      {label.rest ? ` ${label.rest}` : null}
    </>
  );
}

/** "+12 -3", in the git colours. */
export function CodexDiffStats({
  added,
  deleted,
  className,
}: {
  added: number;
  deleted: number;
  className?: string;
}) {
  if (added === 0 && deleted === 0) return null;
  return (
    <span className={cn("willow-diff-stats", className)}>
      {added > 0 ? <span className="willow-diff-stats__added">+{added}</span> : null}
      {deleted > 0 ? <span className="willow-diff-stats__deleted">-{deleted}</span> : null}
    </span>
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The sources an opened "Searched the web for …" row lists (WebSearchItem). */
export function CodexWebResults({
  results,
}: {
  results: ReadonlyArray<{ readonly title: string; readonly url: string | null }>;
}) {
  return (
    <div className="willow-web-results">
      {results.map((result, index) =>
        result.url ? (
          <a
            key={`${result.url}:${index}`}
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="willow-web-results__item"
            onClick={(event) => {
              event.preventDefault();
              void ensureLocalApi().shell.openExternal(result.url!);
            }}
          >
            <CodexIcon name="globe" className="willow-web-results__icon" />
            <span className="willow-web-results__title">{result.title}</span>
            <span className="willow-web-results__domain">{domainOf(result.url)}</span>
          </a>
        ) : (
          <span key={`${result.title}:${index}`} className="willow-web-results__item">
            <CodexIcon name="globe" className="willow-web-results__icon" />
            <span className="willow-web-results__title">{result.title}</span>
          </span>
        ),
      )}
    </div>
  );
}

function CopyIconButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="willow-icon-button willow-icon-button--sm"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      <CodexIcon name={copied ? "check" : "copy"} className="willow-icon-2xs" />
    </button>
  );
}

export type CodexShellStatus = "running" | "success" | "failed" | "stopped";

/**
 * The terminal card under an opened command (ShellBlock): the shell's name, the `$ command` line,
 * the output in a fading 144px scrollback pinned to its end, and the exit status under them.
 */
export function CodexShellBlock(props: {
  command: string;
  output: string | null | undefined;
  status: CodexShellStatus;
  exitCode?: number | null | undefined;
  shell?: string | undefined;
  cwd?: string | undefined;
  note?: string | null | undefined;
}) {
  const output = props.output ?? "";
  return (
    <div className="willow-shell" onClick={(event) => event.stopPropagation()}>
      <div className="willow-shell__label">
        <span title={props.cwd ? `cwd\n${props.cwd}` : undefined}>{props.shell ?? "Shell"}</span>
      </div>
      <div className="willow-shell__body">
        <div className="willow-shell__command-row">
          <div className="willow-shell__command">
            <span className="willow-shell__prompt">$</span>
            {props.command}
          </div>
          <span className="willow-shell__copy">
            <CopyIconButton label="Copy command" text={props.command} />
          </span>
        </div>
        <div className="willow-shell__output-row">
          <div className="willow-shell__output">
            <div className="willow-shell__output-text">
              {output || props.note || (props.status === "running" ? "" : " ")}
            </div>
          </div>
          {output ? (
            <span className="willow-shell__copy willow-shell__copy--output">
              <CopyIconButton label="Copy output" text={output} />
            </span>
          ) : null}
        </div>
      </div>
      <div className="willow-shell__footer">
        {props.status === "running" ? null : props.status === "stopped" ? (
          <span>Stopped</span>
        ) : props.status === "success" ? (
          <span className="willow-shell__success">
            <CodexIcon name="check" className="willow-icon-2xs" />
            Success
          </span>
        ) : (
          <span>
            {props.exitCode !== undefined && props.exitCode !== null
              ? `Exit code ${props.exitCode}`
              : "Failed"}
          </span>
        )}
      </div>
    </div>
  );
}

interface DiffLine {
  kind: "context" | "add" | "delete" | "hunk";
  text: string;
  oldLine?: number;
  newLine?: number;
}

/** A unified diff's hunks as rows with old and new line numbers; the file headers are skipped. */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let inHunk = false;
  for (const raw of diff.replace(/\n$/, "").split(/\r?\n/)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: "hunk", text: hunk[3]?.trim() ?? "" });
      continue;
    }
    if (
      !inHunk &&
      /^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(raw)
    ) {
      continue;
    }
    if (raw.startsWith("\\ No newline")) continue;
    if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "delete", text: raw.slice(1), oldLine: oldLine++ });
    } else {
      lines.push({
        kind: "context",
        text: raw.startsWith(" ") ? raw.slice(1) : raw,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }
  return lines;
}

export function unifiedDiffStats(diff: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of parseUnifiedDiff(diff)) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "delete") deleted += 1;
  }
  return { added, deleted };
}

/**
 * A file's change as Codex shows it opened (DiffView): its path and stats in a 32px header, then
 * the hunks with both line-number gutters, added and deleted rows tinted, hunk separators between.
 */
export function CodexDiffView(props: {
  path: string;
  diff: string;
  isNew?: boolean | undefined;
  maxHeight?: number | undefined;
  onOpen?: (() => void) | undefined;
}) {
  const lines = useMemo(() => parseUnifiedDiff(props.diff), [props.diff]);
  const stats = useMemo(() => unifiedDiffStats(props.diff), [props.diff]);
  return (
    <div className="willow-diff" onClick={(event) => event.stopPropagation()}>
      <div className="willow-diff__header">
        <CodexIcon name="document" className="willow-icon-2xs willow-diff__file-icon" />
        <span className="willow-diff__path" title={props.path}>
          {props.path}
        </span>
        {props.isNew ? <span className="willow-diff__new">new</span> : null}
        <CodexDiffStats added={stats.added} deleted={stats.deleted} />
        {props.onOpen ? (
          <span className="willow-diff__actions">
            <button
              type="button"
              aria-label="Open in the diff panel"
              title="Open in the diff panel"
              className="willow-icon-button willow-icon-button--sm"
              onClick={props.onOpen}
            >
              <CodexIcon name="open-link" className="willow-icon-2xs" />
            </button>
          </span>
        ) : null}
      </div>
      <div className="willow-diff__scroll" style={{ maxHeight: props.maxHeight ?? 360 }}>
        <table className="willow-diff__table">
          <tbody>
            {lines.map((line, index) =>
              line.kind === "hunk" ? (
                // Rows of one diff never reorder.
                // oxlint-disable-next-line react/no-array-index-key
                <tr key={index} className="willow-diff__hunk">
                  <td colSpan={3}>
                    <span>
                      <CodexIcon name="chevron-up-down" className="willow-icon-xxs" />
                      {line.text || "\u00a0"}
                    </span>
                  </td>
                </tr>
              ) : (
                // oxlint-disable-next-line react/no-array-index-key
                <tr key={index} data-diff-line={line.kind}>
                  <td className="willow-diff__gutter">{line.oldLine ?? ""}</td>
                  <td className="willow-diff__gutter">{line.newLine ?? ""}</td>
                  <td className="willow-diff__code">
                    <span className="willow-diff__sign">
                      {line.kind === "add" ? "+" : line.kind === "delete" ? "-" : ""}
                    </span>
                    {line.text}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
