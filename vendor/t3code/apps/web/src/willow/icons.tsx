/**
 * T3's icons in Willow's: `lucide-react` resolves to this module everywhere but here (the
 * `willow:icons` plugin in vite.config.ts), and each icon T3 imports draws the Material Symbols
 * glyph Willow uses for that meaning. It is still an <svg>, so the sizing and colour rules T3's
 * components write for `svg` children keep applying. Git's glyphs have no Material counterpart
 * and stay lucide's, drawn at Material's lighter stroke.
 *
 * Every name T3 imports must be exported here, or the build fails on the missing export.
 */
import { createElement, forwardRef } from "react";
import {
  GitBranchIcon as LucideGitBranch,
  GitBranchPlusIcon as LucideGitBranchPlus,
  GitForkIcon as LucideGitFork,
  GitPullRequestArrowIcon as LucideGitPullRequestArrow,
  GitPullRequestClosedIcon as LucideGitPullRequestClosed,
  GitPullRequestDraftIcon as LucideGitPullRequestDraft,
  createLucideIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export { createLucideIcon };
export type { LucideIcon, LucideProps };

/** Willow's Plan tool (its composer-icons `CodexPlanIcon`), lucide's own lightbulb. */
export { LightbulbIcon as WillowPlanIcon } from "lucide-react";

const FILLED_CLASS = /(^|\s)fill-(?!none\b|transparent\b)/;

/**
 * A Material Symbols Rounded glyph in an <svg> box, or one from Willow's own Luminous Symbols,
 * whose kit holds only the glyphs Willow draws from it (a missing one would print its name).
 */
const symbol = (glyph: string, family: "material" | "luminous" = "material"): LucideIcon => {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function WillowIcon(
    {
      size = 24,
      color = "currentColor",
      strokeWidth: _strokeWidth,
      absoluteStrokeWidth: _absolute,
      className,
      children,
      fill,
      ...props
    },
    ref,
  ) {
    const filled =
      (typeof fill === "string" && fill !== "none" && fill !== "transparent") ||
      FILLED_CLASS.test(className ?? "");
    return createElement(
      "svg",
      {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: color,
        className: className ? `lucide ${className}` : "lucide",
        "data-willow-icon": glyph,
        "aria-hidden": props["aria-label"] ? undefined : true,
        ...props,
      },
      // The ligature is painted from the attribute, so it never joins the text around the icon
      // ("Continue" stays "Continue", not "Continuearrow_forward").
      createElement(
        "foreignObject",
        { x: 0, y: 0, width: 24, height: 24 },
        createElement("i", {
          className: [
            "willow-icon-glyph",
            filled && "willow-icon-glyph--filled",
            family === "luminous" && "willow-icon-glyph--luminous",
          ]
            .filter(Boolean)
            .join(" "),
          "data-glyph": glyph,
        }),
      ),
      children,
    );
  });
  Icon.displayName = `WillowIcon(${glyph})`;
  return Icon as LucideIcon;
};

/** Any Material Symbols glyph as an icon, for Willow's own components (willow/codexWork.tsx). */
export const willowSymbol = symbol;

/** A lucide icon at the stroke weight of Material's glyphs beside it. */
const stroked = (Lucide: LucideIcon): LucideIcon => {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function WillowStrokedIcon(
    { strokeWidth = 1.6, ...props },
    ref,
  ) {
    return createElement(Lucide, { ref, strokeWidth, ...props });
  });
  Icon.displayName = Lucide.displayName;
  return Icon as LucideIcon;
};

export const GitBranchIcon = stroked(LucideGitBranch);
export const GitBranchPlusIcon = stroked(LucideGitBranchPlus);
export const GitForkIcon = stroked(LucideGitFork);
export const GitPullRequestArrowIcon = stroked(LucideGitPullRequestArrow);
export const GitPullRequestClosedIcon = stroked(LucideGitPullRequestClosed);
export const GitPullRequestDraftIcon = stroked(LucideGitPullRequestDraft);

export const ActivityIcon = symbol("vital_signs");
export const AlarmClockIcon = symbol("alarm");
export const AlarmClockOffIcon = symbol("alarm_off");
export const AlertTriangleIcon = symbol("warning");
export const ArchiveIcon = symbol("archive");
export const ArchiveX = symbol("unarchive");
export const ArrowDownIcon = symbol("arrow_downward");
export const ArrowDownUpIcon = symbol("swap_vert");
export const ArrowLeft = symbol("arrow_back");
export const ArrowLeftIcon = ArrowLeft;
export const ArrowRight = symbol("arrow_forward");
export const ArrowRightIcon = ArrowRight;
export const ArrowRightLeftIcon = symbol("swap_horiz");
export const ArrowUpCircleIcon = symbol("arrow_circle_up");
export const ArrowUpDownIcon = symbol("swap_vert");
export const ArrowUpIcon = symbol("arrow_upward");
export const ArrowUpLeftIcon = symbol("north_west");
export const ArrowUpRightIcon = symbol("arrow_outward");
export const BatteryIcon = symbol("battery_full");
export const BlocksIcon = symbol("widgets");
export const BookmarkIcon = symbol("bookmark");
export const BookOpenIcon = symbol("menu_book");
export const BotIcon = symbol("smart_toy");
export const Box = symbol("deployed_code");
export const BrainIcon = symbol("psychology");
export const BugIcon = symbol("bug_report");
export const CalendarArrowDownIcon = symbol("event_upcoming");
export const CalendarArrowUpIcon = symbol("event_repeat");
export const CalendarClockIcon = symbol("calendar_clock");
export const CalendarIcon = symbol("calendar_today");
export const Camera = symbol("photo_camera");
export const ChartNoAxesColumnIcon = symbol("bar_chart");
export const Check = symbol("check");
export const CheckIcon = Check;
export const CheckCircle2Icon = symbol("check_circle");
export const ChevronDown = symbol("keyboard_arrow_down");
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = symbol("chevron_left");
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = symbol("chevron_right");
export const ChevronRightIcon = ChevronRight;
export const ChevronsLeftRightEllipsisIcon = symbol("settings_ethernet");
export const ChevronsUpDownIcon = symbol("unfold_more");
export const ChevronUpIcon = symbol("keyboard_arrow_up");
export const CircleAlertIcon = symbol("error");
export const CircleArrowUpIcon = symbol("arrow_circle_up");
export const CircleCheckIcon = symbol("check_circle");
export const CircleDashedIcon = symbol("radio_button_unchecked");
export const CircleDotIcon = symbol("radio_button_checked");
export const CircleIcon = symbol("circle");
export const CircleSlashIcon = symbol("block");
export const CircleXIcon = symbol("cancel");
export const Clock3Icon = symbol("schedule");
export const ClockIcon = Clock3Icon;
export const CloudDownloadIcon = symbol("cloud_download");
export const CloudIcon = symbol("cloud");
export const CloudUploadIcon = symbol("cloud_upload");
export const CodeIcon = symbol("code");
export const Columns2Icon = symbol("view_column_2");
export const CopyIcon = symbol("content_copy");
export const CornerLeftUpIcon = symbol("subdirectory_arrow_left");
export const CornerUpRightIcon = symbol("turn_right");
export const CpuIcon = symbol("memory");
export const DatabaseIcon = symbol("database");
export const DownloadIcon = symbol("download");
export const EllipsisIcon = symbol("more_vert");
export const ExternalLink = symbol("open_in_new");
export const ExternalLinkIcon = ExternalLink;
export const EyeIcon = symbol("visibility");
export const EyeOffIcon = symbol("visibility_off");
export const FileCode2Icon = symbol("code_blocks");
export const FileDiff = symbol("difference");
export const FileDiffIcon = FileDiff;
export const FileIcon = symbol("draft");
export const FileJsonIcon = symbol("data_object");
export const Files = symbol("file_copy");
export const FileSearchIcon = symbol("find_in_page");
export const FileSpreadsheetIcon = symbol("table_chart");
export const FileTextIcon = symbol("description");
export const FilmIcon = symbol("movie");
export const FlaskConicalIcon = symbol("science");
export const FolderClosedIcon = symbol("folder");
export const FolderCodeIcon = symbol("folder_code");
export const FolderGit2Icon = symbol("source");
export const FolderGitIcon = FolderGit2Icon;
export const FolderIcon = symbol("folder");
export const FolderOpenIcon = symbol("folder_open");
export const FolderPlusIcon = symbol("create_new_folder");
export const FolderTree = symbol("account_tree");
export const FolderTreeIcon = FolderTree;
export const GaugeIcon = symbol("speed");
export const GitCommitHorizontalIcon = symbol("commit");
export const GitCommitIcon = GitCommitHorizontalIcon;
export const GitMergeIcon = symbol("merge");
export const Globe = symbol("language");
export const Globe2 = Globe;
export const Globe2Icon = Globe;
export const GlobeIcon = Globe;
export const GripVerticalIcon = symbol("drag_indicator");
export const HammerIcon = symbol("hardware");
export const HardDriveIcon = symbol("hard_drive");
export const History = symbol("history");
export const HistoryIcon = History;
export const Home = symbol("home");
export const ImageIcon = symbol("image");
export const InboxIcon = symbol("inbox");
export const InfoIcon = symbol("info");
export const Keyboard = symbol("keyboard");
export const KeyboardIcon = Keyboard;
export const LaptopIcon = symbol("laptop");
export const LayersIcon = symbol("layers");
export const LightbulbIcon = symbol("lightbulb");
export const Link2 = symbol("link");
export const Link2Icon = Link2;
export const LinkIcon = Link2;
export const ListChecksIcon = symbol("checklist");
export const ListFilterIcon = symbol("filter_list");
export const ListOrderedIcon = symbol("format_list_numbered");
export const ListTodoIcon = symbol("list_alt");
export const LoaderCircleIcon = symbol("progress_activity");
export const LockIcon = symbol("lock");
export const LockOpenIcon = symbol("lock_open");
export const LogInIcon = symbol("login");
export const MailIcon = symbol("mail");
export const Maximize = symbol("open_in_full");
export const Maximize2Icon = Maximize;
export const MemoryStickIcon = symbol("memory_alt");
export const MessageCircle = symbol("chat_bubble");
export const MessageCircleIcon = MessageCircle;
export const MessageCircleQuestionIcon = symbol("live_help");
export const MessageSquareDashedIcon = symbol("chat_bubble");
export const MessageSquareIcon = symbol("chat");
export const MessageSquareOffIcon = symbol("comments_disabled");
export const MessageSquareWarningIcon = symbol("feedback");
export const MessagesSquareIcon = symbol("forum");
export const Minimize2Icon = symbol("close_fullscreen");
export const Minus = symbol("remove");
export const MinusIcon = Minus;
export const MonitorIcon = symbol("desktop_windows");
export const MoonIcon = symbol("dark_mode");
export const MoreHorizontal = symbol("more_vert");
export const MoreHorizontalIcon = MoreHorizontal;
export const MoreVertical = symbol("more_vert");
export const MousePointer2 = symbol("arrow_selector_tool");
export const MousePointer2Icon = MousePointer2;
export const MousePointerClick = symbol("ads_click");
export const MousePointerClickIcon = MousePointerClick;
export const OctagonAlertIcon = symbol("report");
export const PackageIcon = symbol("package_2");
export const PackagePlusIcon = symbol("add_box");
export const PaintbrushIcon = symbol("brush");
export const PaletteIcon = symbol("palette");
export const PanelBottomIcon = symbol("bottom_panel_open");
export const PanelRightIcon = symbol("right_panel_open");
export const PanelsTopLeftIcon = symbol("dashboard");
export const PaperclipIcon = symbol("attach_file");
export const PencilIcon = symbol("edit");
export const PencilRulerIcon = symbol("design_services");
export const PenLineIcon = symbol("edit");
export const PictureInPicture2 = symbol("picture_in_picture_alt");
export const PilcrowIcon = symbol("format_paragraph");
export const PinIcon = symbol("push_pin");
export const PinOffIcon = symbol("keep_off");
export const PlayIcon = symbol("play_arrow");
export const Plug2Icon = symbol("power");
export const Plus = symbol("add");
export const PlusIcon = Plus;
export const Power = symbol("power_settings_new");
export const PresentationIcon = symbol("slideshow");
export const QrCodeIcon = symbol("qr_code_2");
export const QuoteIcon = symbol("format_quote");
export const RadioTower = symbol("cell_tower");
export const Redo2Icon = symbol("redo");
export const RefreshCwIcon = symbol("refresh");
export const RotateCcw = symbol("replay");
export const RotateCcwIcon = RotateCcw;
export const RotateCwIcon = symbol("rotate_right");
export const RouteIcon = symbol("route");
export const Rows3Icon = symbol("table_rows");
export const ScaleIcon = symbol("balance");
export const SearchIcon = symbol("search");
export const SendIcon = symbol("send");
export const ServerIcon = symbol("dns");
export const Settings2Icon = symbol("tune");
export const SettingsIcon = symbol("settings");
export const ShieldCheckIcon = symbol("verified_user");
export const ShieldIcon = symbol("shield");
export const ShieldQuestionIcon = symbol("shield_question");
export const SlidersHorizontal = symbol("tune");
export const SlidersHorizontalIcon = SlidersHorizontal;
export const Smartphone = symbol("smartphone");
export const SmartphoneIcon = Smartphone;
export const SmilePlusIcon = symbol("add_reaction");
export const SparklesIcon = symbol("auto_awesome");
export const Square = symbol("stop");
export const SquareArrowOutUpRightIcon = symbol("open_in_new");
export const SquareMenuIcon = symbol("menu");
export const SquarePenIcon = symbol("edit_square");
export const SquareSplitHorizontal = symbol("splitscreen_right");
export const SquareSplitVertical = symbol("splitscreen_bottom");
export const StarIcon = symbol("star");
export const SunIcon = symbol("light_mode");
export const TagIcon = symbol("sell");
export const TargetIcon = symbol("target");
export const TerminalIcon = symbol("terminal");
export const TerminalSquare = TerminalIcon;
export const TextIcon = symbol("text_fields");
export const TextSearchIcon = symbol("manage_search");
export const TextWrapIcon = symbol("wrap_text");
export const TicketIcon = symbol("confirmation_number");
export const Trash2 = symbol("delete");
export const Trash2Icon = Trash2;
export const TrendingDownIcon = symbol("trending_down");
export const TrendingUpIcon = symbol("trending_up");
export const Type = symbol("text_fields");
export const TriangleAlertIcon = symbol("warning");
export const Undo2Icon = symbol("undo");
export const Unlink2 = symbol("link_off");
export const Unlink2Icon = Unlink2;
export const UnplugIcon = symbol("power_off");
export const UploadIcon = symbol("upload");
export const UserCheckIcon = symbol("how_to_reg");
export const UserLockIcon = symbol("admin_panel_settings");
export const UserPlusIcon = symbol("person_add");
export const UserRoundIcon = symbol("person");
export const UserRoundXIcon = symbol("person_remove");
export const UsersIcon = symbol("group");
export const WifiOffIcon = symbol("wifi_off");
export const WorkflowIcon = symbol("schema");
export const WrapTextIcon = symbol("wrap_text");
export const WrenchIcon = symbol("build");
export const X = symbol("close");
export const XIcon = X;
export const XCircleIcon = symbol("cancel");
export const ZapIcon = symbol("bolt");
