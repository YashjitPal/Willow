import clsx from "clsx";
import type { ComponentType, SVGProps } from "react";
import {
  BalanceScaleLight16Icon,
  BalanceScaleLight20Icon,
  BarChartLight16Icon,
  BarChartLight20Icon,
  BookLight16Icon,
  BookLight20Icon,
  BracesLight16Icon,
  BracesLight20Icon,
  BrainLight16Icon,
  BrainLight20Icon,
  DeskGlobeLight16Icon,
  DeskGlobeLight20Icon,
  DollarsignCircleLight16Icon,
  DollarsignCircleLight20Icon,
  DumbbellLight16Icon,
  DumbbellLight20Icon,
  FlaskLight16Icon,
  FlaskLight20Icon,
  FolderLight16Icon,
  FolderLight20Icon,
  GlobeLight16Icon,
  GlobeLight20Icon,
  GraduationCapLight16Icon,
  GraduationCapLight20Icon,
  HeartLight16Icon,
  HeartLight20Icon,
  KettlebellLight16Icon,
  KettlebellLight20Icon,
  LotusLight16Icon,
  LotusLight20Icon,
  MusicNoteLight16Icon,
  MusicNoteLight20Icon,
  NotebookLight16Icon,
  NotebookLight20Icon,
  PaintbrushOnPencilLight16Icon,
  PaintbrushOnPencilLight20Icon,
  PaintPaletteLight16Icon,
  PaintPaletteLight20Icon,
  PawLight16Icon,
  PawLight20Icon,
  PencilLight16Icon,
  PencilLight20Icon,
  PenTipLight16Icon,
  PenTipLight20Icon,
  PlantLight16Icon,
  PlantLight20Icon,
  PopcornLight16Icon,
  PopcornLight20Icon,
  ProjectBarChartIcon,
  ProjectBookIcon,
  ProjectBrainIcon,
  ProjectCurrencyDollarIcon,
  ProjectCustomizeIcon,
  ProjectDeskGlobeIcon,
  ProjectDumbbellIcon,
  ProjectEditIcon,
  ProjectFlaskIcon,
  ProjectFolderIcon,
  ProjectFunctionIcon,
  ProjectGlobeIcon,
  ProjectGraduationCapIcon,
  ProjectHealthIcon,
  ProjectHeartIcon,
  ProjectKettlebellIcon,
  ProjectLogsIcon,
  ProjectLotusIcon,
  ProjectMusicIcon,
  ProjectPaletteIcon,
  ProjectPawIcon,
  ProjectPlaneIcon,
  ProjectPlantIcon,
  ProjectPopcornIcon,
  ProjectScaleIcon,
  ProjectStethoscopeIcon,
  ProjectSuitcaseIcon,
  ProjectTerminalIcon,
  ProjectWrenchIcon,
  ProjectWritingIcon,
  StarOfLifeLight16Icon,
  StarOfLifeLight20Icon,
  StethoscopeLight16Icon,
  StethoscopeLight20Icon,
  SuitcaseLight16Icon,
  SuitcaseLight20Icon,
  TerminalLight16Icon,
  TerminalLight20Icon,
  WrenchLight16Icon,
  WrenchLight20Icon,
} from "../icons";
import { AdaptiveIcon } from "./adaptive-icon";
import type { ProjectIconId } from "./project-appearance";
import { SizedIcon } from "./sized-icon";

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

/** `rmr`: each catalog icon as its legacy glyph and its 16 px (`small`) / 20 px (`medium`) icons. */
const projectIconSources: Record<ProjectIconId, { legacy: Glyph; small?: Glyph; medium?: Glyph }> = {
  "bar-chart": { legacy: ProjectBarChartIcon, small: BarChartLight16Icon, medium: BarChartLight20Icon },
  book: { legacy: ProjectBookIcon, small: BookLight16Icon, medium: BookLight20Icon },
  brain: { legacy: ProjectBrainIcon, small: BrainLight16Icon, medium: BrainLight20Icon },
  "currency-dollar": { legacy: ProjectCurrencyDollarIcon, small: DollarsignCircleLight16Icon, medium: DollarsignCircleLight20Icon },
  customize: { legacy: ProjectCustomizeIcon, small: PaintbrushOnPencilLight16Icon, medium: PaintbrushOnPencilLight20Icon },
  "desk-globe": { legacy: ProjectDeskGlobeIcon, small: DeskGlobeLight16Icon, medium: DeskGlobeLight20Icon },
  dumbbell: { legacy: ProjectDumbbellIcon, small: DumbbellLight16Icon, medium: DumbbellLight20Icon },
  edit: { legacy: ProjectEditIcon, small: PencilLight16Icon, medium: PencilLight20Icon },
  flask: { legacy: ProjectFlaskIcon, small: FlaskLight16Icon, medium: FlaskLight20Icon },
  folder: { legacy: ProjectFolderIcon, small: FolderLight16Icon, medium: FolderLight20Icon },
  function: { legacy: ProjectFunctionIcon, small: BracesLight16Icon, medium: BracesLight20Icon },
  globe: { legacy: ProjectGlobeIcon, small: GlobeLight16Icon, medium: GlobeLight20Icon },
  "graduation-cap": { legacy: ProjectGraduationCapIcon, small: GraduationCapLight16Icon, medium: GraduationCapLight20Icon },
  health: { legacy: ProjectHealthIcon, small: StarOfLifeLight16Icon, medium: StarOfLifeLight20Icon },
  heart: { legacy: ProjectHeartIcon, small: HeartLight16Icon, medium: HeartLight20Icon },
  kettlebell: { legacy: ProjectKettlebellIcon, small: KettlebellLight16Icon, medium: KettlebellLight20Icon },
  logs: { legacy: ProjectLogsIcon, small: NotebookLight16Icon, medium: NotebookLight20Icon },
  lotus: { legacy: ProjectLotusIcon, small: LotusLight16Icon, medium: LotusLight20Icon },
  music: { legacy: ProjectMusicIcon, small: MusicNoteLight16Icon, medium: MusicNoteLight20Icon },
  palette: { legacy: ProjectPaletteIcon, small: PaintPaletteLight16Icon, medium: PaintPaletteLight20Icon },
  paw: { legacy: ProjectPawIcon, small: PawLight16Icon, medium: PawLight20Icon },
  plane: { legacy: ProjectPlaneIcon },
  plant: { legacy: ProjectPlantIcon, small: PlantLight16Icon, medium: PlantLight20Icon },
  popcorn: { legacy: ProjectPopcornIcon, small: PopcornLight16Icon, medium: PopcornLight20Icon },
  scale: { legacy: ProjectScaleIcon, small: BalanceScaleLight16Icon, medium: BalanceScaleLight20Icon },
  stethoscope: { legacy: ProjectStethoscopeIcon, small: StethoscopeLight16Icon, medium: StethoscopeLight20Icon },
  suitcase: { legacy: ProjectSuitcaseIcon, small: SuitcaseLight16Icon, medium: SuitcaseLight20Icon },
  terminal: { legacy: ProjectTerminalIcon, small: TerminalLight16Icon, medium: TerminalLight20Icon },
  wrench: { legacy: ProjectWrenchIcon, small: WrenchLight16Icon, medium: WrenchLight20Icon },
  writing: { legacy: ProjectWritingIcon, small: PenTipLight16Icon, medium: PenTipLight20Icon },
};

export type ProjectIconSize = number | "leading" | "secondary";

export interface ProjectIconProps {
  className?: string;
  icon: ProjectIconId;
  /** Pixel sizes without a matching icon scale the legacy glyph. */
  size?: ProjectIconSize;
}

/** `X$t` (`Tmr1Component`): a catalog icon at a size. */
export function ProjectIcon({ className, icon, size }: ProjectIconProps) {
  const { legacy: Legacy, small: Small, medium: Medium } = projectIconSources[icon];
  if (size === "leading") {
    return Small != null && Medium != null ? (
      <SizedIcon className={className} icon={{ 16: Small, 20: Medium }} aria-hidden={false} />
    ) : (
      <Legacy className={clsx("icon-leading", className)} />
    );
  }
  if (size === "secondary") {
    return Small == null ? (
      <Legacy className="icon-2xs" />
    ) : (
      <AdaptiveIcon className={className} icon16={Small} legacyIcon={Legacy} legacyClassName="icon-2xs" aria-hidden={false} />
    );
  }
  if (size === 20 && Medium != null) return <Medium className={className} aria-hidden={false} />;
  if (size === 16 && Small != null) return <Small className={className} aria-hidden={false} />;
  return <Legacy className={className} {...(size == null ? {} : { width: size, height: size })} />;
}
