import { useEffect, useRef, useState, type MouseEvent, type Ref } from "react";
import { LegacyChevronRightACcc1Icon, LegacyChevronRightL6b7bIcon, LegacyDatePickerAF5b3Icon } from "../icons";
import { DatePickerChunkClassNames } from "./date-picker-chunk-classes";
import { DsButton, type DsButtonSize } from "./ds-button";
import { DsPopover, useDsPopoverClose } from "./ds-popover";
import { setPressableScale } from "./pressable-scale";
import { SelectControl, type SelectControlDropdownIconType, type SelectControlVariant } from "./select-control";
import { afterFrames, TransitionGroup } from "./transition-group";

const css = {
  CalendarContainer: "_CalendarContainer_1gw5r_1",
  Previous: "_Previous_1gw5r_9",
  Next: "_Next_1gw5r_42",
  CalendarWrapper: "_CalendarWrapper_1gw5r_81",
  CalendarRange: "_CalendarRange_1gw5r_86",
  Calendar: "_Calendar_1gw5r_1",
  Week: "_Week_1gw5r_100",
  DayLabel: "_DayLabel_1gw5r_109",
  MonthLabel: "_MonthLabel_1gw5r_121",
  Day: "_Day_1gw5r_109",
  InteractiveDay: "_InteractiveDay_1gw5r_146",
  TodayDot: "_TodayDot_1gw5r_196",
} as const;

/** `Ru`: width of one month in the sliding range. */
const monthWidth = 242;

/** `Wa`: weekday labels when there is no `locale`. */
const weekdayLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, -1);
}

/** Luxon `plus({ months })`: the same day in the target month, clamped to its last day. */
function plusMonths(date: Date, months: number) {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  result.setDate(Math.min(date.getDate(), new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  return result;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `La`: every day of the month at midnight. */
function daysOfMonth(month: Date) {
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
}

/** `Va` */
function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/** `Ka`: `Intl` options for the tokens of a Luxon format string. */
function dateTimeFormatOptions(format: string) {
  const options: Intl.DateTimeFormatOptions = { calendar: "gregory" };
  const tokens = format.replace(/'(?:[^']|'')*'/g, "");
  if (tokens.includes("y")) options.year = tokens.includes("yyyy") ? "numeric" : "2-digit";
  if (tokens.includes("MMMM")) options.month = "long";
  else if (tokens.includes("MMM")) options.month = "short";
  else if (tokens.includes("MM")) options.month = "2-digit";
  else if (tokens.includes("M")) options.month = "numeric";
  if (tokens.includes("dd")) options.day = "2-digit";
  else if (tokens.includes("d")) options.day = "numeric";
  if (tokens.includes("hh") || tokens.includes("h")) {
    options.hour = tokens.includes("hh") ? "2-digit" : "numeric";
    options.hour12 = true;
  } else if (tokens.includes("HH") || tokens.includes("H")) {
    options.hour = tokens.includes("HH") ? "2-digit" : "numeric";
    options.hour12 = false;
  }
  if (tokens.includes("mm")) options.minute = "2-digit";
  else if (tokens.includes("m")) options.minute = "numeric";
  if (tokens.includes("ss")) options.second = "2-digit";
  else if (tokens.includes("s")) options.second = "numeric";
  if (tokens.includes("a")) options.hour12 = true;
  if (tokens.includes("Z")) options.timeZoneName = "shortOffset";
  return options;
}

/** A month name the way Luxon's `MMM` / `MMMM` format it (in a date, not standalone). */
function monthName(date: Date, month: "short" | "long") {
  return new Intl.DateTimeFormat(undefined, { month, day: "numeric" }).formatToParts(date).find((part) => part.type === "month")?.value ?? "";
}

/**
 * `qa`: with a `locale`, `Intl` with the format's options; without one, Luxon `toFormat` — ported for the date
 * tokens only (`yyyy`, `yy`, `MMMM`, `MMM`, `MM`, `M`, `dd`, `d`).
 */
function formatDate(date: Date, format: string, locale: string | undefined) {
  if (locale) return date.toLocaleString(locale, dateTimeFormatOptions(format));
  return format.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d/g, (token) => {
    switch (token) {
      case "yyyy":
        return String(date.getFullYear()).padStart(4, "0");
      case "yy":
        return String(date.getFullYear()).slice(-2).padStart(2, "0");
      case "MMMM":
        return monthName(date, "long");
      case "MMM":
        return monthName(date, "short");
      case "MM":
        return String(date.getMonth() + 1).padStart(2, "0");
      case "M":
        return String(date.getMonth() + 1);
      case "dd":
        return String(date.getDate()).padStart(2, "0");
      default:
        return String(date.getDate());
    }
  });
}

/** `Ja` */
function monthLabel(month: Date, locale: string | undefined) {
  return month.toLocaleString(locale, { calendar: "gregory", month: "long", year: "numeric" });
}

/** `Ya`: from Sunday; localized only with a `locale`. */
function weekdayNames(locale: string | undefined) {
  if (!locale) return weekdayLabels;
  return weekdayLabels.map((_, days) => new Date(2024, 0, 7 + days).toLocaleString(locale, { calendar: "gregory", weekday: "short" }));
}

interface CalendarMonthProps {
  date: Date;
  selectedDate: Date | null;
  min?: Date;
  max?: Date;
  locale?: string;
  /** The step this month was created at; it keeps that position while the range slides. */
  stepPosition: number;
  onDateSelect: (date: Date) => void;
}

/** `Bu`: one month grid; days outside `[min, max)` are disabled. */
function CalendarMonth({ date, selectedDate, min, max, locale, stepPosition, onDateSelect }: CalendarMonthProps) {
  const [step] = useState(stepPosition);
  const start = startOfMonth(date);
  const enabledStart = (min ?? start).getTime();
  const enabledEnd = (max ?? endOfMonth(date)).getTime();
  const weeks = chunk<Date | null>([...Array<null>(start.getDay()).fill(null), ...daysOfMonth(start)], 7);
  const today = new Date();
  return (
    <div className={css.Calendar} style={{ left: step * monthWidth }} data-calendar>
      <p className={css.MonthLabel}>{monthLabel(start, locale)}</p>
      <div className={css.Week}>
        {weekdayNames(locale).map((label) => (
          <div key={label} className={css.DayLabel}>
            {label}
          </div>
        ))}
      </div>
      {weeks.map((week, weekIndex) => (
        <div key={weekIndex} className={css.Week}>
          {week.map((day, dayIndex) => {
            if (!day) return <div key={`${weekIndex}-${dayIndex}`} className={css.Day} />;
            const enabled = enabledStart <= day.getTime() && day.getTime() < enabledEnd;
            const selected = enabled && selectedDate != null && isSameDay(day, selectedDate);
            return (
              <div key={dayIndex} className={css.Day} data-is-selected={selected ? "" : undefined}>
                <button className={css.InteractiveDay} disabled={!enabled} onClick={() => onDateSelect(day)}>
                  {day.getDate()}
                  {isSameDay(day, today) && <span className={css.TodayDot} />}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface CalendarProps {
  value: Date | null;
  initialCalendarDate?: Date;
  min?: Date;
  max?: Date;
  locale?: string;
  onChange: (date: Date | null) => void;
}

/**
 * `zu`: months slide by `monthWidth` per step and the container eases to the current month's height. A value outside
 * the shown month jumps there without sliding.
 */
function Calendar({ value, initialCalendarDate, min, max, locale, onChange }: CalendarProps) {
  const close = useDsPopoverClose();
  const containerRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [viewKey, setViewKey] = useState(0);
  const [month, setMonth] = useState(() => value ?? initialCalendarDate ?? new Date());
  const canGoBack = !min || min.getTime() < startOfMonth(month).getTime();
  const canGoForward = !max || endOfMonth(month).getTime() < max.getTime();
  const valueTime = value?.getTime();

  useEffect(() => {
    if (valueTime == null || (startOfMonth(month).getTime() <= valueTime && valueTime < endOfMonth(month).getTime())) return;
    setStep(0);
    setMonth(new Date(valueTime));
    setViewKey((key) => key + 1);
  }, [valueTime]);

  useEffect(() => {
    afterFrames(() => {
      const container = containerRef.current;
      if (!container) return;
      let height = -Infinity;
      container.querySelectorAll<HTMLElement>("[data-calendar]").forEach((calendar) => {
        if (!calendar.closest("[data-exiting]") && calendar.clientHeight > height) height = calendar.clientHeight;
      });
      container.style.height = `${height}px`;
      if (!container.style.transition) {
        afterFrames(() => {
          container.style.transition = "height 0.25s var(--cubic-move)";
        });
      }
    });
  }, [month]);

  return (
    <div key={`stable-view-${viewKey}`} className={css.CalendarWrapper}>
      <div ref={containerRef} className={css.CalendarContainer}>
        <div className={css.Previous}>
          <DsButton
            variant="ghost"
            color="secondary"
            size="sm"
            gutterSize="2xs"
            iconSize="sm"
            pill={false}
            squircle={false}
            onPointerEnter={setPressableScale}
            onClick={() => {
              setStep((current) => current - 1);
              setMonth((current) => plusMonths(current, -1));
            }}
            disabled={!canGoBack}
          >
            <LegacyChevronRightACcc1Icon />
          </DsButton>
        </div>
        <div className={css.Next}>
          <DsButton
            variant="ghost"
            color="secondary"
            size="sm"
            gutterSize="2xs"
            iconSize="sm"
            pill={false}
            squircle={false}
            onPointerEnter={setPressableScale}
            onClick={() => {
              setStep((current) => current + 1);
              setMonth((current) => plusMonths(current, 1));
            }}
            disabled={!canGoForward}
          >
            <LegacyChevronRightL6b7bIcon />
          </DsButton>
        </div>
        <div className={css.CalendarRange} style={{ transform: `translate(${step * -1 * monthWidth}px, 0)` }}>
          <TransitionGroup enterDuration={400} exitDuration={400}>
            <CalendarMonth
              key={month.toLocaleString(undefined, { month: "long", year: "numeric" })}
              stepPosition={step}
              date={month}
              selectedDate={value}
              min={min}
              max={max}
              locale={locale}
              onDateSelect={(date) => {
                onChange(date);
                close();
              }}
            />
          </TransitionGroup>
        </div>
      </div>
    </div>
  );
}

export interface DatePickerProps {
  id: string;
  value: Date | null;
  /** First selectable day; must be before `max`. */
  min?: Date;
  /** Days from here on are disabled. */
  max?: Date;
  initialCalendarDate?: Date;
  /** Localizes the month, weekdays and trigger text; without it the trigger uses Luxon formatting and English weekdays. */
  locale?: string;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  align?: "start" | "center" | "end";
  alignOffset?: number;
  variant?: SelectControlVariant;
  size?: DsButtonSize;
  clearable?: boolean;
  disabled?: boolean;
  dropdownIconType?: SelectControlDropdownIconType;
  placeholder?: string;
  pill?: boolean;
  disablePressable?: boolean;
  block?: boolean;
  triggerClassName?: string;
  onTriggerClickCapture?: (event: MouseEvent<HTMLSpanElement>) => void;
  triggerRef?: Ref<HTMLSpanElement>;
  triggerShowIcon?: boolean;
  /** Luxon format tokens for the trigger text. */
  triggerDateFormat?: string;
  invalid?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  onChange: (date: Date | null) => void;
}

/**
 * `Wu` (export `n` of `DatePicker-653dbdbea596.js`): a select-control trigger opening a month calendar in a popover;
 * picking a day closes it. Values are `Date`s at local midnight (the original's `valueType="date"`; its Luxon values
 * are not ported).
 */
export function DatePicker({
  id,
  value,
  min,
  max,
  initialCalendarDate,
  locale,
  side = "bottom",
  sideOffset = 8,
  align = "center",
  alignOffset,
  variant = "outline",
  size = "md",
  clearable = false,
  disabled = false,
  dropdownIconType,
  placeholder = "Select date...",
  pill = false,
  disablePressable,
  block = false,
  triggerClassName,
  onTriggerClickCapture,
  triggerRef,
  triggerShowIcon = true,
  triggerDateFormat = "MM/dd/yy",
  invalid,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  onChange,
}: DatePickerProps) {
  if (min && max && !(min.getTime() < max.getTime())) throw new Error("DatePicker error: `min` date must be before the `max` date");
  const valueId = `${id}-value`;
  return (
    <DatePickerChunkClassNames>
      <DsPopover>
        <DsPopover.Trigger>
          <SelectControl
            ref={triggerRef}
            id={id}
            className={triggerClassName}
            selected={!!value}
            variant={variant}
            pill={pill}
            disablePressable={disablePressable}
            block={block}
            size={size}
            disabled={disabled}
            invalid={invalid}
            aria-labelledby={[ariaLabelledBy, valueId].filter(Boolean).join(" ")}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            StartIcon={triggerShowIcon ? LegacyDatePickerAF5b3Icon : undefined}
            dropdownIconType={dropdownIconType}
            onClickCapture={onTriggerClickCapture}
            onClearClick={clearable ? () => onChange(null) : undefined}
          >
            <span id={valueId} className="tabular-nums">
              {value ? formatDate(value, triggerDateFormat, locale) : placeholder}
            </span>
          </SelectControl>
        </DsPopover.Trigger>
        <DsPopover.Content minWidth={230} side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset ?? (align === "center" ? 0 : -5)}>
          <Calendar value={value} initialCalendarDate={initialCalendarDate} min={min} max={max} locale={locale} onChange={onChange} />
        </DsPopover.Content>
      </DsPopover>
    </DatePickerChunkClassNames>
  );
}
