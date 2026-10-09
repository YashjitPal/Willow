/**
 * A harness turn, drawn the way the Code tab has always drawn a reply.
 *
 * Prose renders through the same `renderText` the sidebar uses for every
 * message. Work renders as the default transcript's indicators — an 18px icon
 * in #81888f, a 15.15px verb, the file name in a mono pill, a shimmer while it
 * is happening — and consecutive work of one kind collapses behind a chevron,
 * exactly like the old "Edited App.tsx ⌄" row. Nothing here introduces a new
 * visual language; it extends the one `collapsible-indicators.tsx` set.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  ArrowUpDown,
  BookOpen,
  Camera,
  ChevronDown,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  CircleDot,
  CornerDownLeft,
  FileCode2,
  FileSearch,
  FolderTree,
  Hand,
  Hourglass,
  Image as ImageIcon,
  Info,
  Keyboard,
  LayoutTemplate,
  ListChecks,
  MonitorSmartphone,
  MousePointer2,
  MousePointerClick,
  Package,
  Plug,
  Route,
  ScanEye,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useCodeSession } from '../../session/code-session';
import type { CheckStep, ComputerAction, DesignStep, ImageStep, NoticeStep, PlanStep, TextStep, TurnPhase, TurnStep } from '../protocol';

const MUTED = '#81888f';
const SHIMMER_CLASS = 'animate-shimmer bg-clip-text text-transparent bg-[length:200%_100%]';
const SHIMMER_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(90deg, #81888f 0%, #ffffff 50%, #81888f 100%)',
  animationDuration: '1.5s',
};

type ActivityStep = Exclude<TurnStep, TextStep | PlanStep | CheckStep | NoticeStep | ImageStep | DesignStep>;
type GroupKind = 'file' | 'explore' | 'dependency' | 'tool' | 'computer';

interface ActivityItem {
  key: string;
  icon: LucideIcon;
  verb: string;
  label?: string;
  title?: string;
  running: boolean;
  failed: boolean;
}

type Block =
  | { type: 'text'; key: string; step: TextStep }
  | { type: 'group'; key: string; kind: GroupKind; steps: ActivityStep[] }
  | { type: 'plan'; key: string; step: PlanStep }
  | { type: 'check'; key: string; step: CheckStep }
  | { type: 'notice'; key: string; step: NoticeStep }
  | { type: 'image'; key: string; step: ImageStep }
  | { type: 'design'; key: string; step: DesignStep };

const baseName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

function groupOf(step: ActivityStep): GroupKind {
  switch (step.kind) {
    case 'file':
      return 'file';
    case 'dependency':
      return 'dependency';
    case 'tool':
      return 'tool';
    case 'computer':
      return 'computer';
    default:
      return 'explore';
  }
}

/** Verb forms (doing, done, failed) and icon for each thing done to the preview. */
const COMPUTER_ACTIONS: Record<ComputerAction, { verbs: [string, string, string]; icon: LucideIcon }> = {
  screenshot: { verbs: ['Looking at the app', 'Looked at the app', "Couldn't look at the app"], icon: Camera },
  inspect: { verbs: ['Inspecting', 'Inspected', "Couldn't inspect"], icon: ScanSearch },
  click: { verbs: ['Clicking', 'Clicked', "Couldn't click"], icon: MousePointerClick },
  type: { verbs: ['Typing', 'Typed', "Couldn't type"], icon: Keyboard },
  press: { verbs: ['Pressing', 'Pressed', "Couldn't press"], icon: CornerDownLeft },
  hover: { verbs: ['Hovering over', 'Hovered over', "Couldn't hover over"], icon: MousePointer2 },
  scroll: { verbs: ['Scrolling', 'Scrolled', "Couldn't scroll"], icon: ArrowUpDown },
  select: { verbs: ['Choosing in', 'Chose in', "Couldn't choose in"], icon: ChevronsUpDown },
  drag: { verbs: ['Dragging', 'Dragged', "Couldn't drag"], icon: Hand },
  wait: { verbs: ['Waiting for', 'Waited for', 'Gave up waiting for'], icon: Hourglass },
  navigate: { verbs: ['Opening', 'Opened', "Couldn't open"], icon: Route },
  viewport: { verbs: ['Switching to', 'Switched to', "Couldn't switch to"], icon: MonitorSmartphone },
};

const VIEWPORT_NAMES: Record<string, string> = { mobile: 'phone size', tablet: 'tablet size', desktop: 'full width' };

function describe(step: ActivityStep): ActivityItem {
  const running = 'status' in step && step.status === 'running';
  const failed = 'status' in step && step.status === 'error';
  const pick = (active: string, done: string, error: string) => (running ? active : failed ? error : done);

  switch (step.kind) {
    case 'file': {
      const label = step.action === 'rename' && step.toPath ? `${baseName(step.path)} → ${baseName(step.toPath)}` : baseName(step.path);
      const title = step.action === 'rename' && step.toPath ? `${step.path} → ${step.toPath}` : step.path;
      const verb =
        step.action === 'delete' ? pick('Deleting', 'Deleted', "Couldn't delete")
        : step.action === 'rename' ? pick('Renaming', 'Renamed', "Couldn't rename")
        : pick('Editing', 'Edited', "Couldn't edit");
      return { key: step.id, icon: FileCode2, verb, label, title: step.error ? `${title} — ${step.error}` : title, running, failed };
    }
    case 'read':
      return { key: step.id, icon: FileSearch, verb: pick('Reading', 'Read', "Couldn't read"), label: baseName(step.path), title: step.path, running, failed };
    case 'list':
      return { key: step.id, icon: FolderTree, verb: pick('Listing files', 'Listed files', "Couldn't list files"), label: step.path && step.path !== '/' ? step.path : undefined, running, failed };
    case 'search':
      return { key: step.id, icon: Search, verb: pick('Searching', 'Searched', "Couldn't search"), label: step.query, title: step.matches !== undefined ? `${step.matches} match${step.matches === 1 ? '' : 'es'}` : undefined, running, failed };
    case 'skill':
      return { key: step.id, icon: BookOpen, verb: pick('Reading skill', 'Read skill', "Couldn't read skill"), label: step.name, running, failed };
    case 'dependency':
      return { key: step.id, icon: Package, verb: pick('Adding', 'Added', "Couldn't add"), label: step.name, title: step.version ? `${step.name}@${step.version}` : step.name, running, failed };
    case 'tool':
      return { key: step.id, icon: Plug, verb: pick('Using', 'Used', "Couldn't use"), label: step.label, title: step.error, running, failed };
    case 'computer': {
      const { verbs, icon } = COMPUTER_ACTIONS[step.action] ?? COMPUTER_ACTIONS.screenshot;
      // A look at the whole app reads the same whichever tool took it.
      const looking = step.action === 'inspect' && !step.label;
      const [doing, done, error] = looking
        ? COMPUTER_ACTIONS.screenshot.verbs
        : step.action === 'wait' && !step.label
          ? ['Waiting', 'Waited', "Couldn't wait"]
          : verbs;
      const label = step.action === 'viewport' && step.label ? VIEWPORT_NAMES[step.label] ?? step.label : step.label;
      return { key: step.id, icon: looking ? Camera : icon, verb: pick(doing, done, error), label, title: step.error, running, failed };
    }
  }
}

/**
 * Steps into render blocks.
 *
 * A failed edit that a later step in the same turn redid successfully is
 * dropped: the model fixed its own mistake, and the retry is the story.
 */
function toBlocks(steps: readonly TurnStep[]): Block[] {
  const superseded = new Set<string>();
  steps.forEach((step, index) => {
    if (step.kind !== 'file' || step.status !== 'error') return;
    const redone = steps.slice(index + 1).some((later) => later.kind === 'file' && later.path === step.path && later.status !== 'error');
    if (redone) superseded.add(step.id);
  });

  const blocks: Block[] = [];
  for (const step of steps) {
    if (superseded.has(step.id)) continue;
    if (step.kind === 'text') {
      if (step.text.trim()) blocks.push({ type: 'text', key: step.id, step });
      continue;
    }
    if (step.kind === 'plan') {
      blocks.push({ type: 'plan', key: step.id, step });
      continue;
    }
    if (step.kind === 'check') {
      blocks.push({ type: 'check', key: step.id, step });
      continue;
    }
    if (step.kind === 'notice') {
      blocks.push({ type: 'notice', key: step.id, step });
      continue;
    }
    if (step.kind === 'image') {
      blocks.push({ type: 'image', key: step.id, step });
      continue;
    }
    if (step.kind === 'design') {
      blocks.push({ type: 'design', key: step.id, step });
      continue;
    }
    const kind = groupOf(step);
    const last = blocks[blocks.length - 1];
    if (last?.type === 'group' && last.kind === kind) last.steps.push(step);
    else blocks.push({ type: 'group', key: step.id, kind, steps: [step] });
  }
  return blocks;
}

/* ------------------------------------------------------------------------ */
/* Rows                                                                      */
/* ------------------------------------------------------------------------ */

const StatusText: React.FC<{ verb: string; label?: string; title?: string; shimmer: boolean; fading?: boolean }> = ({ verb, label, title, shimmer, fading }) => (
  <span className="text-[15.15px] inline-flex min-w-0 items-center gap-1" title={title}>
    <span className={`shrink-0 ${shimmer ? SHIMMER_CLASS : ''}`} style={shimmer ? SHIMMER_STYLE : undefined}>
      {verb}
    </span>
    {label && (
      <span className="relative inline-block min-w-0">
        <span
          className="font-mono bg-white/5 px-1.5 py-0.5 rounded inline-block max-w-full truncate align-middle transition-opacity duration-300 ease-out"
          style={{ opacity: fading ? 0 : 1 }}
        >
          <span className={shimmer ? SHIMMER_CLASS : ''} style={shimmer ? SHIMMER_STYLE : { color: MUTED }}>
            {label}
          </span>
        </span>
      </span>
    )}
  </span>
);

/** The header item, with the old indicator's fade when the name changes mid-stream. */
function useDisplayedItem(item: ActivityItem, animate: boolean): { item: ActivityItem; fading: boolean } {
  const [shown, setShown] = useState(item);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (item.key === shown.key) {
      if (item !== shown) setShown(item);
      return;
    }
    if (!animate) {
      setShown(item);
      return;
    }
    setFading(true);
    const timer = setTimeout(() => {
      setShown(item);
      setFading(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [item, shown, animate]);
  return { item: item.key === shown.key ? item : shown, fading };
}

const ActivityGroup: React.FC<{ steps: ActivityStep[]; live: boolean }> = ({ steps, live }) => {
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(() => steps.map(describe), [steps]);
  const head = items[items.length - 1]!;
  const { item: shown, fading } = useDisplayedItem(head, live);
  const Icon = shown.icon;
  const shimmer = live && shown.running;
  const earlier = items.slice(0, -1);

  const row = (
    <div className="flex min-w-0 items-center gap-2.5">
      <Icon size={18} className="shrink-0" />
      <StatusText verb={shown.verb} label={shown.label} title={shown.title} shimmer={shimmer} fading={fading} />
    </div>
  );

  if (earlier.length === 0) {
    return (
      <div className={live ? 'animate-textFadeIn' : undefined} style={{ color: MUTED }}>
        {row}
      </div>
    );
  }

  return (
    <div className={`space-y-0${live ? ' animate-textFadeIn' : ''}`}>
      <div className="flex items-center justify-between" style={{ color: MUTED }}>
        {row}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="p-1.5 hover:bg-white/10 rounded transition-colors shrink-0"
          aria-label={expanded ? 'Hide details' : 'Show details'}
          aria-expanded={expanded}
        >
          <ChevronDown size={16} className={`transition-transform duration-300 ease-out ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="pt-4 space-y-4">
          {earlier.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <div
                key={item.key}
                className="flex min-w-0 items-center gap-2.5 transition-all duration-200"
                style={{
                  color: MUTED,
                  opacity: expanded ? 1 : 0,
                  transform: expanded ? 'translateY(0)' : 'translateY(-8px)',
                  transitionDelay: `${index * 30}ms`,
                }}
              >
                <ItemIcon size={18} className="shrink-0" />
                <StatusText verb={item.verb} label={item.label} title={item.title} shimmer={false} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const PlanBlock: React.FC<{ step: PlanStep; live: boolean }> = ({ step, live }) => {
  const [expanded, setExpanded] = useState(true);
  const done = step.items.filter((item) => item.status === 'completed').length;
  return (
    <div className={`space-y-0${live ? ' animate-textFadeIn' : ''}`}>
      <div className="flex items-center justify-between" style={{ color: MUTED }}>
        <div className="flex items-center gap-2.5">
          <ListChecks size={18} className="shrink-0" />
          <StatusText verb="Plan" label={`${done}/${step.items.length}`} shimmer={false} />
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="p-1.5 hover:bg-white/10 rounded transition-colors shrink-0"
          aria-label={expanded ? 'Hide plan' : 'Show plan'}
          aria-expanded={expanded}
        >
          <ChevronDown size={16} className={`transition-transform duration-300 ease-out ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <ul className="pt-3 space-y-2 pl-[2px]">
          {step.items.map((item, index) => {
            const ItemIcon = item.status === 'completed' ? CircleCheck : item.status === 'in_progress' ? CircleDot : Circle;
            return (
              <li key={`${index}-${item.text}`} className="flex items-start gap-2.5 text-[14px] leading-[1.5]" style={{ color: item.status === 'completed' ? MUTED : '#b4b8bd' }}>
                <ItemIcon size={15} className="mt-[3px] shrink-0" />
                <span className={item.status === 'completed' ? 'line-through decoration-white/20' : undefined}>{item.text}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

const CheckBlock: React.FC<{ step: CheckStep; live: boolean }> = ({ step, live }) => {
  const [expanded, setExpanded] = useState(false);
  const running = step.status === 'running';
  const errors = step.errors ?? [];
  const failed = step.status === 'error' && errors.length > 0;
  const Icon = failed ? ShieldAlert : ShieldCheck;
  const text = running
    ? 'Checking for errors'
    : failed
      ? `Found ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`
      : step.skipped
        ? "Couldn't run the error check"
        : 'No errors found';

  return (
    <div className={`space-y-0${live ? ' animate-textFadeIn' : ''}`}>
      <div className="flex items-center justify-between" style={{ color: MUTED }}>
        <div className="flex min-w-0 items-center gap-2.5" title={step.skipped}>
          <Icon size={18} className="shrink-0" />
          <span className={`text-[15.15px] ${live && running ? SHIMMER_CLASS : ''}`} style={live && running ? SHIMMER_STYLE : undefined}>
            {text}
          </span>
        </div>
        {failed && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="p-1.5 hover:bg-white/10 rounded transition-colors shrink-0"
            aria-label={expanded ? 'Hide errors' : 'Show errors'}
            aria-expanded={expanded}
          >
            <ChevronDown size={16} className={`transition-transform duration-300 ease-out ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {failed && (
        <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="pt-3 space-y-1.5 pl-[28px]">
            {errors.map((error, index) => (
              <div key={index} className="font-mono text-[12.5px] leading-[1.5] break-words" style={{ color: MUTED }}>
                {error}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ANNOTATION_ACCENT = '#ff6b2c';

/** An image `generate_image` saved into the project, shown from the project's own file. */
const GeneratedImageBlock: React.FC<{ step: ImageStep; live: boolean; resolveAsset?: (path: string) => string | undefined }> = ({ step, live, resolveAsset }) => {
  const running = step.status === 'running';
  const failed = step.status === 'error';
  const src = step.path && !running ? resolveAsset?.(step.path) : undefined;
  const verb = running ? 'Generating image' : failed ? "Couldn't generate image" : 'Generated image';
  return (
    <div className={live ? 'animate-textFadeIn' : undefined}>
      <div className="flex min-w-0 items-center gap-2.5" style={{ color: MUTED }}>
        <ImageIcon size={18} className="shrink-0" />
        <StatusText verb={verb} label={step.path ? baseName(step.path) : undefined} title={failed ? step.error : step.caption} shimmer={live && running} />
      </div>
      {live && running && <div className="mt-3 h-[150px] w-[240px] max-w-full animate-pulse rounded-xl bg-white/[0.04]" />}
      {src && (
        <img
          src={src}
          alt={step.caption}
          title={step.caption}
          className="mt-3 block max-h-[220px] max-w-[min(100%,320px)] rounded-xl border border-white/10 object-cover"
        />
      )}
    </div>
  );
};

/** A screenshot `annotate` marked up, with its numbered notes. Click to see it larger. */
const AnnotationBlock: React.FC<{ step: ImageStep; live: boolean }> = ({ step, live }) => {
  const [large, setLarge] = useState(false);
  const notes = step.notes ?? [];
  return (
    <div className={live ? 'animate-textFadeIn' : undefined}>
      <div className="flex min-w-0 items-center gap-2.5" style={{ color: MUTED }}>
        <ScanEye size={18} className="shrink-0" />
        <StatusText verb="Annotated the app" label={step.caption || undefined} shimmer={false} />
      </div>
      {step.src && (
        <button
          type="button"
          onClick={() => setLarge((value) => !value)}
          className="mt-3 block max-w-full overflow-hidden rounded-xl border border-white/10"
          aria-label={large ? 'Show smaller' : 'Show larger'}
          style={{ cursor: large ? 'zoom-out' : 'zoom-in' }}
        >
          <img
            src={step.src}
            alt={step.caption || 'Annotated screenshot of the app'}
            className="block w-full object-contain transition-[max-height] duration-300 ease-out"
            style={{ maxHeight: large ? 1200 : 300 }}
          />
        </button>
      )}
      {notes.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {notes.map((note, index) => (
            <li key={index} className="flex items-start gap-2.5 text-[14px] leading-[1.5]" style={{ color: '#b4b8bd' }}>
              <span
                className="mt-[1px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
                style={{ backgroundColor: ANNOTATION_ACCENT }}
              >
                {index + 1}
              </span>
              <span>{note}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/** A screen put on the Design canvas, with a way to go and look at it. */
const DesignBlock: React.FC<{ step: DesignStep; live: boolean; onOpenDesign?: (nodeId: string) => void }> = ({ step, live, onOpenDesign }) => {
  const running = step.status === 'running';
  const failed = step.status === 'error';
  const verb = running ? 'Designing' : failed ? "Couldn't design" : 'Designed';
  return (
    <div className={`flex items-center justify-between gap-3${live ? ' animate-textFadeIn' : ''}`} style={{ color: MUTED }}>
      <div className="flex min-w-0 items-center gap-2.5">
        <LayoutTemplate size={18} className="shrink-0" />
        <StatusText verb={verb} label={step.name} title={step.error} shimmer={live && running} />
      </div>
      {step.nodeId && onOpenDesign && !running && (
        <button
          type="button"
          onClick={() => onOpenDesign(step.nodeId!)}
          className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-[12.5px] font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          View
        </button>
      )}
    </div>
  );
};

const NoticeBlock: React.FC<{ step: NoticeStep }> = ({ step }) => {
  const Icon = step.tone === 'warning' ? TriangleAlert : Info;
  return (
    <div className="flex items-start gap-2.5" style={{ color: MUTED }}>
      <Icon size={18} className="mt-[2px] shrink-0" />
      <span className="text-[14.5px] leading-[1.55]">{step.text}</span>
    </div>
  );
};

/* ------------------------------------------------------------------------ */
/* The timeline                                                              */
/* ------------------------------------------------------------------------ */

export interface TurnTimelineProps {
  steps: readonly TurnStep[];
  /** True while the turn is running. */
  live?: boolean;
  phase?: TurnPhase | null;
  renderText: (text: string, animating: boolean) => React.ReactNode;
  /** A project file's contents by path, for images the turn generated. */
  resolveAsset?: (path: string) => string | undefined;
  /** Opens a design on the Design canvas. */
  onOpenDesign?: (nodeId: string) => void;
}

export const TurnTimeline: React.FC<TurnTimelineProps> = ({ steps, live = false, phase = null, renderText, resolveAsset, onOpenDesign }) => {
  const blocks = useMemo(() => toBlocks(steps), [steps]);

  // Thinking shows once, in the row above the reply, never between the work.
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        switch (block.type) {
          case 'text':
            return (
              <div key={block.key} className="space-y-2">
                {renderText(block.step.text.trim(), live && isLast && phase === 'responding')}
              </div>
            );
          case 'group':
            return <ActivityGroup key={block.key} steps={block.steps} live={live} />;
          case 'plan':
            return <PlanBlock key={block.key} step={block.step} live={live} />;
          case 'check':
            return <CheckBlock key={block.key} step={block.step} live={live} />;
          case 'notice':
            return <NoticeBlock key={block.key} step={block.step} />;
          case 'image':
            return block.step.origin === 'annotation'
              ? <AnnotationBlock key={block.key} step={block.step} live={live} />
              : <GeneratedImageBlock key={block.key} step={block.step} live={live} resolveAsset={resolveAsset} />;
          case 'design':
            return <DesignBlock key={block.key} step={block.step} live={live} onOpenDesign={onOpenDesign} />;
        }
      })}
    </div>
  );
};

/** The turn in flight, read from the live store so token updates re-render only this. */
export const LiveTurnTimeline: React.FC<Pick<TurnTimelineProps, 'renderText' | 'resolveAsset' | 'onOpenDesign'>> = (props) => {
  const turn = useStore(useCodeSession().harness.liveTurn);
  if (!turn) return null;
  return <TurnTimeline steps={turn.steps} live phase={turn.phase} {...props} />;
};
