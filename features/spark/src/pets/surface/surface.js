// The pet, verbatim from BetterGravity's Pets plugin (petSurface in
// community/plugins/pets/index.js), and kept that way: pets-controller.ts runs
// it in a Willow page or sends `String(petSurface)` to the desktop app's
// overlay window, where only the document, `host` and `data` exist.

/**
 * The pet, its indicator, and its activity stack.
 *
 * Nothing outside this function is in scope: it is stringified and re-evaluated
 * in another renderer, where the only things that exist are the document, the
 * `host` it is handed, and the JSON in `data`. Adding a reference to anything
 * above this line breaks the desktop half and nothing else, which is the kind of
 * bug that takes an afternoon — so everything the pet needs lives inside.
 *
 * @param {object} host the overlay API, or the page's stand-in for it
 * @param {object} data configuration, serialised across
 */
function petSurface(host, data) {
  /* ── The sheet ──────────────────────────────────────────────────────────
   *
   * codex-pet-assets: the v2 sheet. Nine animation rows, then two rows holding
   * the sixteen directions the pet can look in.
   */

  const SHEET = {
    columns: 8,
    rows: 11,
    cellWidth: 192,
    cellHeight: 208
  };

  /* ── The frame table ────────────────────────────────────────────────────
   *
   * Timing is per frame rather than a fixed rate, and every row holds its last
   * frame roughly twice as long, which is what stops a loop from feeling like a
   * metronome.
   */

  /** One row of the sheet as a run of frames. */
  const row = (rowIndex, count, ms, lastMs) =>
    Array.from({ length: count }, (_unused, columnIndex) => ({
      rowIndex,
      columnIndex,
      frameDurationMs: columnIndex === count - 1 ? lastMs : ms
    }));

  // Idle is the only row whose frames are all timed by hand: a long settle, two
  // quick frames, two medium, then a long hold. It is the breathing loop, so it
  // gets the attention.
  const IDLE_FRAMES = [
    { rowIndex: 0, columnIndex: 0, frameDurationMs: 280 },
    { rowIndex: 0, columnIndex: 1, frameDurationMs: 110 },
    { rowIndex: 0, columnIndex: 2, frameDurationMs: 110 },
    { rowIndex: 0, columnIndex: 3, frameDurationMs: 140 },
    { rowIndex: 0, columnIndex: 4, frameDurationMs: 140 },
    { rowIndex: 0, columnIndex: 5, frameDurationMs: 320 }
  ];

  // Those durations are for a deliberate idle beat; the resting loop runs six
  // times slower. Codex applies this unconditionally, so idle at rest is always
  // the slow version.
  const IDLE_MULTIPLIER = 6;
  const IDLE = IDLE_FRAMES.map((frame) => ({
    ...frame,
    frameDurationMs: frame.frameDurationMs * IDLE_MULTIPLIER
  }));

  /** Every state the pet has, in Codex's own row order. */
  const STATES = {
    idle: IDLE_FRAMES,
    "running-right": row(1, 8, 120, 220),
    "running-left": row(2, 8, 120, 220),
    waving: row(3, 4, 140, 280),
    jumping: row(4, 5, 140, 280),
    failed: row(5, 8, 140, 240),
    waiting: row(6, 6, 150, 260),
    running: row(7, 6, 120, 220),
    review: row(8, 6, 150, 280)
  };

  /* ── Sequencing ─────────────────────────────────────────────────────────
   *
   * Idle loops forever. Reactions use Codex's three bursts and slow idle tail.
   * Working keeps its own row looping until the last active agent stops; an
   * unchanged activity snapshot must not need a hover to restart the animation.
   *
   * Reduced motion is a single frame held still. Not a slower animation: the
   * shipped code returns one frame and no loop, so the pet becomes a picture.
   */
  function buildSequence(state, reducedMotion) {
    const frames = STATES[state] ?? STATES.idle;
    if (reducedMotion) return { frames: [frames[0]], loopStartIndex: null };
    if (state === "idle") return { frames: IDLE, loopStartIndex: 0 };
    if (state === "running") return { frames, loopStartIndex: 0 };
    const burst = [...frames, ...frames, ...frames];
    return { frames: [...burst, ...IDLE], loopStartIndex: burst.length };
  }

  /*
   * A frame as a background-position.
   *
   * Percentages, not pixels: a percentage background position aligns that point
   * of the image with the same point of the box, so column i of 8 lands exactly
   * at i / 7 of the way across. The whole thing is then resolution-independent
   * and the pet's size is just a width.
   */
  const backgroundPositionFor = (frame) =>
    `${(frame.columnIndex / (SHEET.columns - 1)) * 100}% ${(frame.rowIndex / (SHEET.rows - 1)) * 100}%`;

  /* ── Looking at something ───────────────────────────────────────────────
   *
   * The pet turns its head towards a point, and Codex is particular about which
   * point. frame 3805 is the whole rule:
   *
   *   _t = w?.caretPoint ?? Re
   *
   * `caretPoint` rides on `follow-up-editor-changed` (frame 6653) — the caret in
   * the follow-up reply, sent on every keystroke. `Re` is set from
   * `avatar-overlay-computer-use-cursor-changed` (frame 3722), which is the
   * cursor the *agent* is driving during computer use. Both are null by default
   * (page 2997), and when the point is null so is the look frame: the pet just
   * plays its animation.
   *
   * So Codex's pet does not watch the mouse. It watches you type, and it watches
   * itself work. Antigravity has no computer use, which leaves the caret and
   * nothing else — the pointer is read here for proximity and hit testing, never
   * for a direction to face.
   */

  /** 360 / 16. The last two rows hold sixteen directions, one every 22.5°. */
  const LOOK_SECTOR_DEGREES = 22.5;
  const LOOK_DIRECTIONS = 16;
  /** The first of the two direction rows. */
  const LOOK_FIRST_ROW = 9;
  /** Closer than this to the pet's centre there is no direction to face. */
  const LOOK_DEAD_ZONE_PX = 1;

  /**
   * The direction frame for a cursor at `pointer`, or null when the cursor is on
   * top of the pet's own centre.
   *
   * atan2 is called with the arguments swapped and dy negated so that zero is
   * straight up and the angle grows clockwise, which is the order the sixteen
   * frames are laid out in. Rounding rather than flooring means each frame
   * covers the 22.5° centred on the direction it draws.
   */
  function lookFrameFor(rect, pointer) {
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) <= LOOK_DEAD_ZONE_PX) return null;

    const degrees = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360;
    const sector = Math.round(degrees / LOOK_SECTOR_DEGREES) % LOOK_DIRECTIONS;

    return {
      rowIndex: LOOK_FIRST_ROW + Math.floor(sector / SHEET.columns),
      columnIndex: sector % SHEET.columns,
      frameDurationMs: 0
    };
  }

  /*
   * Only these three states look up from what they are doing. A pet mid-jump or
   * mid-panic keeps its own head, which is the difference between a pet that is
   * alive and a weather vane.
   */
  const LOOKING_STATES = new Set(["idle", "running", "waving"]);

  /** The properties mi() copies onto its mirror, in its own order. */
  const MIRROR_STYLES = [
    "border",
    "boxSizing",
    "direction",
    "font",
    "letterSpacing",
    "overflowWrap",
    "padding",
    "tabSize",
    "textAlign",
    "textIndent",
    "textTransform",
    "width",
    "wordBreak"
  ];

  /**
   * Where the caret is in a text field, in client coordinates — mi(), frame 3388.
   *
   * A caret has no box of its own, so it is measured by proxy: a hidden div is
   * given the field's own metrics, filled with the text up to the caret, and a
   * zero-width span put on the end of that text. Wherever the span lands is where
   * the caret is. Inputs use `pre`; a textarea mirrors its line wrapping. The far edge of the
   * selection because that is the end the caret sits at — unless the selection was
   * made backwards, in which case it sits at the near one.
   *
   * Codex returns the point relative to the content frame it found by ancestry,
   * and in that frame's *unscaled* units: it divides the whole delta by the zoom
   * and takes the scroll off afterwards. Ours is wanted in client pixels, to sit
   * in the same space as the pet's own box and the cursor. That makes the mirror
   * measurements free — two client rects subtracted are already scaled — and
   * leaves only the scroll offsets needing the factor, because a field reports
   * those in its own local pixels. At zoom 1 the two forms are identical.
   */
  function caretPointOf(field) {
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    const style = window.getComputedStyle(field);
    const mirror = document.createElement("div");
    for (const property of MIRROR_STYLES) mirror.style[property] = style[property];
    mirror.style.position = "fixed";
    mirror.style.left = "0";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = field.tagName === "TEXTAREA" ? "pre-wrap" : "pre";
    if (field.tagName === "TEXTAREA") mirror.style.overflowWrap = "break-word";

    const end =
      field.selectionDirection === "backward" ? field.selectionStart : field.selectionEnd;
    mirror.textContent = field.value.slice(0, end ?? field.value.length);

    const tail = document.createElement("span");
    tail.textContent = "​";
    mirror.append(tail);
    document.body.append(mirror);

    const mirrorRect = mirror.getBoundingClientRect();
    const tailRect = tail.getBoundingClientRect();
    mirror.remove();

    const scale = field.offsetWidth === 0 ? 1 : rect.width / field.offsetWidth;
    return {
      x: rect.left + (tailRect.left - mirrorRect.left) - field.scrollLeft * scale,
      y:
        rect.top +
        (tailRect.top - mirrorRect.top + tailRect.height / 2) -
        field.scrollTop * scale
    };
  }

  /* ── Dragging and throwing ──────────────────────────────────────────────
   *
   * avatar-overlay-native-page for the pointer half, main for the momentum half.
   * On the desktop these are screen coordinates, exactly as Codex has them; in
   * the window they are client coordinates. Same arithmetic either way, which is
   * the point of the pet not knowing which document it is in.
   */

  /** Movement before a press counts as a drag rather than a click. */
  const DRAG_THRESHOLD_PX = 4;
  /** Sideways movement before the pet turns and runs that way. */
  const RUN_THRESHOLD_PX = 4;
  /** Only pointer samples from this recently are used to measure a throw. */
  const SAMPLE_WINDOW_MS = 160;
  /** A floor on the measured interval, so a 0 ms gap cannot divide by nothing. */
  const MIN_SAMPLE_DT_MS = 8;
  /** Below this, a release is a let-go rather than a throw. */
  const MIN_THROW_SPEED = 320;
  /** Ceiling on release speed, before the multiplier. */
  const MAX_THROW_SPEED = 1600;
  /** Codex throws at three times the speed the hand was moving. */
  const THROW_MULTIPLIER = 3;

  /** The momentum tick, and the interval the friction figure is expressed per. */
  const TICK_MS = 16;
  /** A tick longer than this is treated as this long — a backgrounded window. */
  const MAX_TICK_DT_MS = 32;
  /** Speed kept per 16 ms. */
  const FRICTION = 0.88;
  /** Speed kept when it bounces off an edge. */
  const RESTITUTION = 0.7;
  /** Below this the throw is over. */
  const STOP_SPEED = 65;
  /** And it is over regardless after this long. */
  const MAX_MOMENTUM_MS = 900;

  // Codex's own clamp on the pet's width, from avatar-overlay-mascot-size.
  const MIN_WIDTH_PX = 80;
  const MAX_WIDTH_PX = 224;
  /** 7 rem, Codex's default, at a 16 px root — main/src 17846. */
  const DEFAULT_WIDTH_PX = 112;

  /* ── What a status looks like ───────────────────────────────────────────
   *
   * rr() in avatar-overlay-native-frame, as a table. It is checked in this order
   * — loading, then warning, danger, success, and info as the fallback — and
   * each level decides four things at once: the colour of the indicator, the
   * glyph on the right of the card, the words used when a thread has none of its
   * own, and which animation the pet plays. The strings are Codex's, verbatim.
   *
   * `label` is deliberately not card text. Kr() (js 2774) only ever puts it in
   * an aria label — what the card shows is the thread's own title. It is kept
   * here because the indicator's tooltip is the one place it is read aloud.
   *
   * `icon` is na()'s switch (js 7282), and `spinner` is the interesting one: it
   * renders nothing at all. A running card's whole status indication is the
   * shimmer over its text, which is why `loading` also collapses the space the
   * text leaves free on the right.
   */
  const LEVELS = {
    running: {
      tone: "info",
      label: "Running",
      body: "Thinking",
      mascot: "running",
      icon: "spinner",
      loading: true
    },
    waiting: {
      tone: "warning",
      label: "Needs input",
      body: "Needs input",
      mascot: "waiting",
      icon: "clock",
      loading: false
    },
    failed: {
      tone: "danger",
      label: "Blocked",
      body: "Blocked",
      mascot: "failed",
      icon: "warning",
      loading: false
    },
    review: {
      tone: "success",
      label: "Ready",
      body: "Ready",
      mascot: "review",
      icon: "check-circle",
      loading: false
    },
    // ar in rr(): the fallback level. Codex gives it the same info tone as
    // running and tells them apart by the pale background it fills; here the
    // indicator is six pixels of colour, so idle gets a tone of its own to be
    // quiet with. Same level, one more name for it.
    idle: {
      tone: "idle",
      label: "Info",
      body: "Info",
      mascot: "idle",
      icon: "clock",
      loading: false
    },
    /*
     * or, the greeting: `{...ar, mascotState: 'waving'}` (frame 1814).
     *
     * The only level rr() reaches before looking at anything else — `kind ===
     * 'first-awake'` is its first line — and the only one that differs from the
     * fallback in a single field. So the greeting is idle's tone, idle's clock and
     * idle's label, with the pet waving over the top of it.
     *
     * `controls` is the one thing a level says here that Codex says per
     * notification: Ti() gives the greeting `controlTarget: null` and
     * `notificationPreferenceId: null`, which takes away reply and stop (`me`,
     * frame 5933), the actions button (`_e`, 5936) and the fade that only exists to
     * clear them (`ke`, 6141). The green tick was never on the table — that one
     * wants a check-circle level. A card with nothing to press.
     */
    greeting: {
      tone: "idle",
      label: "Info",
      body: "Info",
      mascot: "waving",
      icon: "clock",
      loading: false,
      controls: "none"
    }
  };

  /* ── The glyphs ─────────────────────────────────────────────────────────
   *
   * Five icons, as the markup they are in app-initial and native-frame. They are
   * written out rather than drawn because the desktop half has no bundler, no
   * React, and no way to import anything: this function arrives there as text.
   *
   * The paths are verbatim. clock is Xns, warning is HK, the tick is aI, reply
   * is Ln, stop is uX, and the dismiss cross is the one inline in yi().
   */

  const ICON_CLOCK =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" d="M8.00037 4.14209C8.29009 4.14235 8.52478 4.37769 8.52478 4.66748V7.86279C8.52464 8.0901 8.43446 8.30843 8.2738 8.46924L6.70447 10.0386C6.49954 10.2433 6.16728 10.2432 5.96228 10.0386C5.75731 9.8336 5.75742 9.50142 5.96228 9.29639L7.47498 7.78369V4.66748C7.47498 4.37753 7.71042 4.14209 8.00037 4.14209Z"/>' +
    '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.00037 1.4751C11.604 1.4751 14.5258 4.39683 14.5258 8.00049C14.5258 11.6041 11.604 14.5259 8.00037 14.5259C4.39671 14.5259 1.47498 11.6041 1.47498 8.00049C1.47498 4.39683 4.39671 1.4751 8.00037 1.4751ZM8.00037 2.52588C4.97661 2.52588 2.52576 4.97673 2.52576 8.00049C2.52576 11.0242 4.97661 13.4751 8.00037 13.4751C11.0241 13.4751 13.475 11.0242 13.475 8.00049C13.475 4.97673 11.0241 2.52588 8.00037 2.52588Z"/>' +
    "</svg>";

  const ICON_WARNING =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
    '<path d="M9.995 12.315c.489 0 .875.37.875.842 0 .473-.386.843-.875.843-.488 0-.875-.37-.875-.843 0-.472.387-.842.875-.842ZM10.001 6c.478 0 .778.295.778.79 0 .042 0 .107-.006.16l-.08 3.716c-.016.456-.252.725-.698.725-.445 0-.681-.269-.692-.725L9.217 6.95c0-.053-.006-.118-.006-.16 0-.495.307-.79.79-.79Z"/>' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M10 2.085a7.915 7.915 0 1 1 0 15.83 7.915 7.915 0 0 1 0-15.83Zm0 1.33a6.585 6.585 0 1 0 0 13.17 6.585 6.585 0 0 0 0-13.17Z"/>' +
    "</svg>";

  const ICON_CHECK =
    '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z"/>' +
    "</svg>";

  const ICON_REPLY =
    '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" d="M12.6961 20.1078C12.9614 20.1078 13.1788 20.0232 13.348 19.8539C13.5173 19.6846 13.602 19.4765 13.602 19.2294V16.3196H13.8216C15.2948 16.3196 16.5186 16.5484 17.4931 17.0059C18.4676 17.4634 19.2843 18.3098 19.9431 19.5451C20.0712 19.7922 20.2176 19.9477 20.3824 20.0118C20.5471 20.0758 20.7118 20.1078 20.8765 20.1078C21.0778 20.1078 21.2608 20.0232 21.4255 19.8539C21.5902 19.6846 21.6725 19.4353 21.6725 19.1059C21.6725 17.2301 21.3958 15.6105 20.8422 14.2471C20.2886 12.8837 19.433 11.8337 18.2755 11.0971C17.118 10.3605 15.6333 9.99216 13.8216 9.99216H13.602V7.09608C13.602 6.84902 13.5173 6.63399 13.348 6.45098C13.1788 6.26797 12.9569 6.17647 12.6824 6.17647C12.4993 6.17647 12.3346 6.21993 12.1882 6.30686C12.0418 6.39379 11.8725 6.52876 11.6804 6.71176L5.6549 12.3255C5.5085 12.4627 5.40784 12.6 5.35294 12.7373C5.29804 12.8745 5.27059 13.0118 5.27059 13.149C5.27059 13.2771 5.29804 13.4098 5.35294 13.5471C5.40784 13.6843 5.5085 13.8216 5.6549 13.9588L11.6804 19.6137C11.8542 19.7784 12.0212 19.902 12.1814 19.9843C12.3415 20.0667 12.5131 20.1078 12.6961 20.1078Z"/>' +
    "</svg>";

  const ICON_STOP =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
    '<path d="M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z"/>' +
    "</svg>";

  const ICON_CLOSE =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M3 3 9 9M9 3 3 9" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/>' +
    "</svg>";

  /*
   * The chevron the badge wears while the pills are out — Af, app-initial 50214.
   * Drawn at 20 x 21 and both filled and stroked at 0.6, which is what keeps it
   * legible at the 18 px `icon-sm` renders it into.
   */
  const ICON_CHEVRON =
    '<svg width="18" height="18" viewBox="0 0 20 21" fill="none" aria-hidden="true">' +
    '<path fill="currentColor" stroke="currentColor" stroke-width="0.6" d="M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z"/>' +
    "</svg>";

  const ICONS = {
    clock: ICON_CLOCK,
    warning: ICON_WARNING,
    "check-circle": ICON_CHECK,
    spinner: ""
  };

  /* ── Geometry ───────────────────────────────────────────────────────────*/

  // The standard mascot uses a corner badge. The separate native voice-control
  // presentation supplies an arc position, which does not apply to this pet.
  const BADGE_CORNERS = ["top-start", "top-end", "bottom-start", "bottom-end"];
  const BADGE_DRAG_THRESHOLD = 4;
  /** rn / an in $t(): the inset from the edge of the screen, and the gap below. */
  const VIEWPORT_INSET = 8;
  const GAP_BELOW = 8;

  /** avatar-overlay-native-frame: the activity card, and Kl's stack ladder. */
  const CARD_HEIGHT = 54;
  /**
   * page 1160: Hr()'s three numbers. A pill is as wide as its widest line of text
   * plus 20 px of side spacing either end, never narrower than 200 and never wider
   * than 315 — which is also the answer when there is nothing to measure with.
   */
  const CARD_WIDTH = 315;
  const CARD_MIN_WIDTH = 200;
  const CARD_SIDE_SPACING = 20;
  /** js 6240: `mx-1.5` on the `•`, so the fold costs 6 px either side of it. */
  const INLINE_SEPARATOR_GAP = 12;
  /** Hr(): the room a card that is neither running nor waiting leaves for its controls. */
  const CONTROL_ROOM = 45;
  /** The family the cards are drawn in, for when the computed one comes back empty. */
  const FALLBACK_FAMILY = "ui-sans-serif, system-ui, sans-serif";
  /** app-initial 22034: how far each backing sits below the one in front. */
  const BACKING_OFFSET_Y = 10;
  /** Kl, in full: the three rungs a collapsed pile is drawn on. */
  const RUNGS = [
    { offsetY: 0, scale: 1 },
    { offsetY: 10, scale: 0.94 },
    { offsetY: 20, scale: 0.86 }
  ];

  /**
   * app-initial 21918: ube(), how far down a rung a backing starts.
   *
   * `offsetY + (height - 54) · (1 - scaleY)`. The second term is what keeps the
   * ladder honest on a card that is not 54 tall: a backing is scaled about its
   * top edge, so scaling alone would pull its bottom edge *up* by
   * `height · (1 - scaleY)`, and the correction pushes it back down by the part
   * of that the 54 px case did not have to pay for. It is zero at 54.
   */
  const rungOffset = (front, rung) => rung.offsetY + (front - CARD_HEIGHT) * (1 - rung.scale);

  /**
   * app-initial 21904: cbe(), how tall a collapsed pile stands.
   *
   * A pile is taller than the card in front of it. The backings are scaled about
   * their top edge and pushed down, so the last rung's bottom edge falls past the
   * front card's and peeks out below it — which is the whole reason a pile reads
   * as a pile. cbe() is `max(front, ube(front, rung) + front·scaleY)`, and every
   * rung is measured off the *front* card because fbe()'s collapsed branch builds
   * all three out of `{...viewport, height: items[0].height}` (21929). At a 54 px
   * card that is 54 for one entry, 60.76 for two, 66.44 for three or more,
   * whatever is behind them.
   */
  function pileHeight(count, front = CARD_HEIGHT) {
    if (count <= 0) return 0;
    const rung = RUNGS[Math.min(count, RUNGS.length) - 1];
    return Math.max(front, rungOffset(front, rung) + front * rung.scale);
  }

  /**
   * app-initial 21924: fbe()'s expanded branch, and Gl's eight slots.
   *
   * The page hands fbe() a 208 px viewport and the *whole* list, cards go in
   * gbe(8) apart, and the viewport is `min(208, contentHeight)` — so a short list
   * makes a short tray and a long one scrolls.
   *
   * Gl's eight slots are a draw pool, not a cap. Up to eight items fbe() lays all
   * of them out; past eight it keeps the ones overlapping the viewport grown by
   * _be(56) of overscan, pads that set back up to eight with whichever excluded
   * cards are nearest the window, and hands item i the pool slot at `i % 8`. The
   * ninth thread is not undrawable — it is off-screen until it is scrolled to.
   */
  const STACK_GAP = 8;
  const STACK_VIEWPORT_HEIGHT = 208;
  const STACK_SLOTS = 8;
  const STACK_OVERSCAN = 56;

  /**
   * app-initial 22117: proximityEnterDistance and proximityExitDistance.
   *
   * The cluster does not open on hover — it opens when the cursor comes within 40
   * px of the pet and closes when it passes 56, which is 16 px of hysteresis so a
   * cursor resting on the boundary cannot make it flicker. Leaving waits
   * compactDismissDelayMs first, so crossing the gap between the pet and its own
   * cards does not shut them.
   */
  const PROXIMITY_ENTER_PX = 40;
  const PROXIMITY_EXIT_PX = 56;
  const DISMISS_DELAY_MS = 300;

  /*
   * qr(): whether the subtitle folds up onto the title's line.
   *
   * `title.length <= 20 && body.length > 40`, once the kind and waitingRequest
   * tests — which Antigravity can never fail — are taken out of it (frame 2819).
   *
   * Nothing is shortened on the way in. jr() (frame 2261) does cut at 48
   * characters, but only inside lr(), which formats the metadata of a waiting
   * request one value at a time and never sees a title or a body: Kr() hands the
   * subtitle over whole (2815), qr() measures the whole of it, and so does Hr()
   * when it works out how wide the card should be. What shortens a card's text is
   * CSS and only CSS — one line with an ellipsis on it, or two with a clamp.
   */
  const INLINE_TITLE_MAX = 20;
  const INLINE_BODY_MIN = 40;

  /**
   * frame 4710 and 140: the composer's wrapper is `relative h-10 w-[344px]
   * shrink-0`, and _QuickChatMaterial_ inside it is 40 px tall. Written out
   * because the hit-test filter needs the pill's box before it has been laid out.
   *
   * The form caps itself at `calc(100vw - 12px)`, so a window narrower than the
   * pill shrinks the pill instead of pushing it off the edge.
   */
  const CHAT_WIDTH = 344;
  const CHAT_HEIGHT = 40;
  const CHAT_VIEWPORT_INSET = 12;
  /** `gap-2` on the column that holds the stack and the composer. */
  const COLUMN_GAP = 8;

  /* ── The state the pet is in ────────────────────────────────────────────*/

  const clampWidth = (value) => {
    const asNumber = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_WIDTH_PX;
    return Math.round(Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, asNumber)));
  };

  /** A sheet has to be fetchable by the document, so only these two are any use. */
  const SHEET_URL = /^(?:https?:\/\/|data:image\/)/i;

  /** True in the transparent desktop window, false in Antigravity's own. */
  const desktop = data?.desktop === true;

  let config = {
    size: DEFAULT_WIDTH_PX,
    force: "auto",
    sheet: "",
    activity: true,
    ...(data?.config ?? {})
  };

  /** The activity entries, already sorted and trimmed by the sensor. */
  let entries = Array.isArray(data?.entries) ? data.entries : [];
  /** Work is independent of notification priority, dismissal, and visibility. */
  let working = data?.working === true || entries.some((entry) => entry.status === "running");

  let width = clampWidth(config.size);
  let height = Math.round((width * SHEET.cellHeight) / SHEET.cellWidth);
  let x = 0;
  let y = 0;

  /** What the agent is doing, as a pet state. */
  let statusState = "idle";
  /** An override that outranks it: which way a dragged pet is being carried. */
  let transient = null;
  /** Where the cursor was last seen, in this document's coordinates. */
  let pointerAt = null;
  /**
   * Where the caret was when the composer last changed, and the reading of the
   * composer that produced it.
   *
   * `w?.caretPoint` (frame 3805) is state rather than a measurement taken on
   * demand: the editor reports it on change, and until it has, there is nothing to
   * look at. Which is why a composer that has been opened but not typed into does
   * not turn the pet's head — the point arrives with the first keystroke. hi()
   * (frame 3428) is the reading the report is gated on, so a keystroke that moves
   * nothing measures nothing.
   */
  let caretAt = null;
  let caretReading = null;
  /** Whether the cursor is on the sprite itself. This is what makes it jump. */
  let hovering = false;
  /**
   * Whether the cursor is *near* the pet, which is a different question.
   *
   * Codex opens the control cluster on proximity, not on hover: pet-pointer-
   * proximity-changed fires at 40 px and stops at 56, and nothing about it needs
   * the cursor to be over the sprite. The two signals do different jobs — this one
   * opens the cluster and the tray, `hovering` makes the pet jump.
   */
  let nearby = false;
  /** Which card the cursor is over, if any: Ui()'s `d`, isPointerSurfaceHovered. */
  let hoveredKey = null;
  /**
   * Whether the stack is open. native-page 2050 starts it closed, so the pile is
   * what you meet first and the list is what a click on the pile gets you.
   */
  let stackExpanded = false;
  /**
   * Whether the pills have been stashed, which is the badge's other job.
   *
   * `areActivityPillsVisible` is not a hover state and not derived from anything:
   * the page reads it out of a persisted setting — `dt = z(wa) ?? b(Ca, !0)`, page
   * 2049 — and the only things that write it are the two controls the badge turns
   * into. Default on, so the pills are out until someone puts them away.
   */
  let stashed = data?.activityPillsVisible === false;
  let badgeCorner = BADGE_CORNERS.includes(data?.badgeCorner) ? data.badgeCorner : "top-end";
  let badgeDrag = null;
  let suppressBadgeClick = false;
  let badgeClickTimer;
  let badgeAnimation;
  let badgeVisible = false;
  let artworkCenter = 0.5;
  let artworkMeasurement = 0;
  /** Requested scroll position; Codex clamps its presentation without overwriting it. */
  let scrollOffset = 0;
  /** Whether the quick-chat pill is showing. */
  let chatOpen = false;
  let menuOpen = false;
  let menuFocus = null;
  let menuRequest = null;
  let menuSequence = 0;
  /** Codex's inline follow-up belongs to its notification, independently of quick chat. */
  let replyState = null;
  let replySequence = 0;
  let replyRevision = 0;
  let replyLayoutTimer;
  let replyFrame;
  let revealReply = false;
  /**
   * Where layout() last put the tray and the chat pill.
   *
   * The hit test needs these to decide whether a cursor is worth asking the
   * document about, and measuring them would defeat the point of asking.
   */
  let trayRect = { left: 0, top: 0, right: 0, bottom: 0 };
  let chatRect = { left: 0, top: 0, right: 0, bottom: 0 };

  let playing = "idle";
  let sequence = buildSequence("idle", false);
  let frameIndex = 0;
  let frameTimer;
  /** Whether the last paint drew a direction, which suspends the sequence. */
  let looking = false;
  let momentumTimer;
  /** compactDismissDelayMs: the wait before a departing cursor closes anything. */
  let dismissTimer;
  let disposed = false;

  /**
   * Live drag state, or null when nobody is holding the pet.
   *
   * `x` and `y` are the last *accepted* pointer position rather than the latest
   * one. Codex only accepts a move once the pointer has travelled 4 px on either
   * axis since the last accepted point, so the whole drag advances in 4 px steps
   * — not just the start of it. That is what keeps a held pet from trembling.
   */
  let drag = null;

  const cleanups = [];
  const track = (cleanup) => void cleanups.push(cleanup);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ── The elements ───────────────────────────────────────────────────────
   *
   * Two for the pet — a positioned wrapper that takes the pointer and the sprite
   * inside it, so the pickup scale never disturbs background-position — plus the
   * tray and the quick-chat pill.
   *
   * The tray has two shapes and one set of elements. Collapsed it is a pile: the
   * front card carries the text and two empty backings sit behind it on Kl's
   * rungs. Expanded it is a 208 px window onto up to eight full cards. Cards are
   * built as they are first needed and then kept, because the pile is what a
   * session mostly shows and building eight of them for it would be waste.
   *
   * `data-pet-hit` is how the desktop half knows which pixels belong to the pet:
   * everything without it is a hole the pointer falls through.
   */

  const make = (tag, className, into) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (into) into.append(element);
    return element;
  };

  const pet = make("div", "bettergravity-pet");
  pet.setAttribute("role", "group");
  pet.setAttribute("aria-label", "Pet");
  pet.dataset.petHit = "pet";
  pet.dataset.petBadge = "hidden";
  pet.dataset.petBadgeKind = "chevron";
  pet.dataset.petCluster = "closed";
  pet.dataset.petTone = "idle";

  const sprite = make("div", "bettergravity-pet__body", pet);
  sprite.setAttribute("aria-hidden", "true");
  const badge = make("button", "bettergravity-pet__badge", pet);
  badge.type = "button";
  badge.dataset.petHit = "badge";
  const badgeCount = make("span", "bettergravity-pet__badge-count", badge);
  const badgeChevron = make("span", "bettergravity-pet__badge-chevron", badge);
  badgeChevron.innerHTML = ICON_CHEVRON;

  const tray = make("div", "bettergravity-pet-tray");
  tray.setAttribute("aria-hidden", "true");
  tray.dataset.petTray = "closed";
  tray.dataset.petStack = "collapsed";
  tray.dataset.petTone = "idle";

  /*
   * The two empty backings, furthest back first. fbe()'s collapsed branch gives
   * every slot after the first a zero-height content rect, which is to say the
   * pile behind the front card is genuinely blank — two pieces of the same
   * material on Kl's lower rungs, and nothing written on either.
   */
  const backings = [2, 1].map((slot) => {
    const backing = make("div", "bettergravity-pet-card", tray);
    backing.dataset.petSlot = String(slot);
    backing.hidden = true;
    return backing;
  });

  /**
   * A card, built once and reused. Eight of them at most, which is Gl's length.
   *
   * Every part named in Ui() that Antigravity can actually reach is here: the
   * content with its title and its body line, the trailing status glyph, the
   * reply/stop row, and the dismiss cross on the corner. The one thing missing is
   * the expand chevron, and it is missing because `be = V != null && ye` needs a
   * waitingRequest — a realtime-voice question — which nothing here produces.
   */
  function buildCard() {
    const root = make("div", "bettergravity-pet-card", tray);
    root.dataset.petHit = "card";
    root.dataset.petPill = "default";
    root.dataset.petInline = "false";
    root.hidden = true;

    const header = make("div", "bettergravity-pet-card__header", root);
    const content = make("div", "bettergravity-pet-card__content", header);
    const text = make("div", "bettergravity-pet-card__text", content);
    const body = make("div", "bettergravity-pet-card__body", content);

    const status = make("div", "bettergravity-pet-card__status", header);
    status.setAttribute("role", "img");
    const statusDisc = make("span", "bettergravity-pet-card__status-disc", status);
    statusDisc.hidden = true;

    const controls = make("div", "bettergravity-pet-card__controls", header);
    controls.dataset.petControls = "default";
    const reply = make("button", "bettergravity-pet-card__control", controls);
    reply.type = "button";
    reply.dataset.petControl = "reply";
    reply.dataset.petHit = "control";
    reply.innerHTML = ICON_REPLY;
    const stop = make("div", "bettergravity-pet-card__control", controls);
    stop.dataset.petControl = "stop";
    stop.dataset.petHit = "control";
    stop.innerHTML = ICON_STOP;
    /*
     * js 6535. A finished card's row is one childless button instead of the pair:
     * a 28 px hit target laid straight over the green check, its own background
     * taken to zero so the check is all you see. The row's inset (14.5 + 14) and
     * the status box's (13 + 15.5) both come out at 28.5 from the right edge,
     * which is how the two land on top of one another.
     */
    const dismiss = make("div", "bettergravity-pet-card__control", controls);
    dismiss.dataset.petControl = "success";
    dismiss.dataset.petHit = "control";
    dismiss.hidden = true;

    const close = make("div", "bettergravity-pet-card__close", root);
    close.dataset.petControl = "close";
    close.dataset.petHit = "control";
    close.innerHTML = ICON_CLOSE;

    const replyBox = make("div", "bettergravity-pet-card__reply", root);
    replyBox.inert = true;
    const replyForm = make("form", "bettergravity-pet-card__reply-form", replyBox);
    const replyInput = make("textarea", "bettergravity-pet-card__reply-input", replyForm);
    replyInput.rows = 1;
    replyInput.placeholder = "Follow up";
    const replyError = make("div", "bettergravity-pet-card__reply-error", replyForm);
    replyError.setAttribute("role", "alert");
    replyError.textContent = "Unable to send reply";
    replyError.hidden = true;

    const card = {
      root,
      header,
      content,
      text,
      body,
      status,
      statusDisc,
      controls,
      reply,
      stop,
      dismiss,
      close,
      replyBox,
      replyForm,
      replyInput,
      replyError
    };
    wireReply(card);
    cardResizeObserver?.observe(root);
    cardResizeObserver?.observe(replyForm);
    return card;
  }

  /** Built on demand: a pile needs one, an open stack up to eight. */
  const cards = [];
  const cardAt = (index) => {
    while (cards.length <= index && cards.length < STACK_SLOTS) {
      const built = buildCard();
      cards.push(built);
    }
    return cards[index];
  };
  const cardFor = (key) => cards.find((card) => card.root.dataset.petKey === key);

  /*
   * Quick chat. frame 140: a 40 px pill with the reply glyph on the end of it,
   * stacked with the activity tray in one column — see layout().
   *
   * Two placeholders, and which one is showing says what the pill is for:
   * `De = hasNotifications ? startNewTaskPlaceholder : askPlaceholder` (frame
   * 5496), whose own descriptions are "when the floating pet has activity" and
   * "when the floating pet is idle" (7412). The idle one is reachable because the
   * pill outlives the cards: it comes out over the tray and stays until the
   * cursor leaves the pet altogether, so the last card being dismissed under it
   * turns "Start new chat" back into "Ask".
   */
  const chat = make("div", "bettergravity-pet-chat");
  chat.dataset.petHit = "chat";
  chat.dataset.petChat = "closed";
  const chatInput = make("input", "bettergravity-pet-chat__input", chat);
  chatInput.type = "text";
  chatInput.placeholder = "Ask";
  chatInput.setAttribute("aria-label", "Chat");
  const chatSend = make("div", "bettergravity-pet-card__control bettergravity-pet-chat__send", chat);
  chatSend.dataset.petControl = "send";
  chatSend.dataset.petHit = "control";
  chatSend.innerHTML = ICON_REPLY;

  // Codex's context menu contains a single plain Close pet action.
  const petMenu = make("div", "bettergravity-pet-menu");
  petMenu.setAttribute("role", "menu");
  petMenu.setAttribute("aria-label", "Pet");
  petMenu.dataset.petHit = "menu";
  petMenu.hidden = true;
  const closePetItem = make("button", "bettergravity-pet-menu__item", petMenu);
  closePetItem.type = "button";
  closePetItem.setAttribute("role", "menuitem");
  closePetItem.textContent = "Close pet";
  pet.setAttribute("aria-haspopup", "menu");

  /* ── Which sheet, and how big ───────────────────────────────────────────*/

  /** Set when a custom sheet was asked for and could not be used. */
  let sheetProblem = "";
  let sheetObjectUrl = "";

  function releaseSheetObjectUrl() {
    if (!sheetObjectUrl) return;
    URL.revokeObjectURL(sheetObjectUrl);
    sheetObjectUrl = "";
  }
  track(releaseSheetObjectUrl);

  function sheetImageUrl(custom) {
    // A generated sheet can put megabytes in the sprite's style attribute.
    // Updating its frame then makes the theme's style selectors scan that
    // image again. A local URL keeps the exact bytes out of the moving style.
    if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") return custom;
    const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/i.exec(custom);
    if (!match) return custom;
    try {
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: match[1] }));
    } catch {
      // Keep the original image path when conversion is unavailable.
      return custom;
    }
  }

  // Use one stable center for the idle artwork. Transparent padding and a thin
  // tail can leave the visible body off-center within an otherwise valid sheet.
  // Measuring once per sheet keeps the card column still while frames animate.
  async function measureArtwork() {
    const measurement = ++artworkMeasurement;
    artworkCenter = 0.5;
    if (typeof Image !== "function" || typeof Image.prototype.decode !== "function") return;
    try {
      const background = getComputedStyle(sprite).backgroundImage;
      if (!background.startsWith("url(")) return;
      const image = new Image();
      image.src = JSON.parse(background.slice(4, -1));
      await image.decode();
      if (disposed || measurement !== artworkMeasurement) return;
      const canvas = document.createElement("canvas");
      canvas.width = SHEET.cellWidth;
      canvas.height = SHEET.cellHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      let mass = 0;
      let weightedX = 0;
      for (let frame = 0; frame < SHEET.columns; frame++) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, frame * image.naturalWidth / SHEET.columns, 0,
          image.naturalWidth / SHEET.columns, image.naturalHeight / SHEET.rows,
          0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          const alpha = pixels[index];
          mass += alpha;
          weightedX += alpha * (((index - 3) / 4) % canvas.width + 0.5);
        }
      }
      if (mass > 0) {
        const measured = weightedX / mass / canvas.width;
        artworkCenter = Math.abs(measured - 0.5) < 0.01 ? 0.5 : measured;
        layout();
      }
      canvas.width = canvas.height = 0;
    } catch {
      // Cross-origin sheets without canvas access keep their geometric center.
    }
  }

  function applySheet() {
    const custom = typeof config.sheet === "string" ? config.sheet.trim() : "";

    if (custom.length === 0 || !SHEET_URL.test(custom)) {
      sheetProblem = custom.length === 0 ? "" : "the sprite sheet needs an http, https, or data URL";
      sprite.style.removeProperty("background-image");
      pet.dataset.pet = "rocky";
      releaseSheetObjectUrl();
      void measureArtwork();
      return;
    }

    sheetProblem = "";
    pet.dataset.pet = "custom";
    const image = sheetImageUrl(custom);
    // Keep the previous image alive until its replacement is assigned.
    sprite.style.backgroundImage = `url(${JSON.stringify(image)})`;
    releaseSheetObjectUrl();
    if (image !== custom) sheetObjectUrl = image;
    void measureArtwork();
  }

  /* ── Where it stands, and where the tray goes ───────────────────────────
   *
   * On the desktop the document is exactly the working area of the screen, so
   * `window.innerWidth` is the screen and the pet bounces off its edges. In
   * Antigravity's window it is the window. Nothing here has to know which.
   *
   * Codex reserves 8 px under the pet and nothing at the sides: yf, main 11518,
   * is `{ top: 8, right: 28, bottom: 8, left: 0 }`, and only `bottom` reaches the
   * anchor clamp — Ff (main 11723) is
   *
   *   x: Vf(e.x, t.x, t.x + t.width  - e.width)
   *   y: Vf(e.y, t.y, t.y + t.height - e.height - yf.bottom - (n ? Cf : 0))
   *
   * where the extra Cf (32) is the tray caption's room and is not ours.
   */

  const ANCHOR_BOTTOM_RESERVE = 8;

  // Deliberately unclamped: Ff does not floor these at zero, so a pet wider or
  // taller than the space it is in hands clampAnchor an inverted range, which is
  // the case Vf centres. Flooring them here would pin it to the top-left instead.
  const maxX = () => window.innerWidth - width;
  const maxY = () => window.innerHeight - height - ANCHOR_BOTTOM_RESERVE;

  /**
   * Vf, main 11767, verbatim:
   *
   *   function Vf(e, t, n) {
   *     return t > n ? Math.round((t + n) / 2) : Math.min(Math.max(Math.round(e), t), n);
   *   }
   *
   * Two things in it matter. It **rounds**, so the applied position is always a
   * whole pixel — which is what keeps a pixelated sprite from crawling as it
   * slides. And when the range inverts, because the pet is wider or taller than
   * the space it is being clamped into, it centres in that impossible range
   * rather than picking an edge.
   */
  const clampAnchor = (value, low, high) =>
    low > high ? Math.round((low + high) / 2) : Math.min(Math.max(Math.round(value), low), high);

  /** Proximity reveals the quick-chat controls; the corner badge stays visible. */
  const cluster = () => nearby;

  /**
   * Lays out the cluster, the tray and the chat pill around wherever the pet is.
   *
   * The tray and quick chat share a vertical column. frame 4867 stacks them in
   * a `flex flex-col items-center
   * gap-2` and picks the order from isTrayAboveMascot — composer first when the
   * column is above the mascot, last when it is below — so the activity stack is
   * always the member touching the pet and the composer is always on the far side
   * of it. The column centers on the pet when there is room, and shifts inward
   * at a screen edge without changing the pet's position.
   *
   * Where the column starts is Jt(): under the pet, or under the open cluster when
   * that is what is showing, flipping above when the whole column would run past
   * the bottom of the screen. How wide it is is Hr(): the widest pill's own
   * measured text, which is the tray's whole coordinate space.
   *
   * The tray's height is the one number the stylesheet cannot work out for itself:
   * cbe()'s pile height while the stack is shut, and `min(208, contentHeight)`
   * once it is open.
   */
  function layout() {
    /*
     * The activity width is measured — page 2191 hands the stack a
     * `viewportRect` of `{height: 208, left: 0, top: 0, width: Hr().width}` and
     * fbe() gives every row `left: viewportRect.left` and `width: viewportRect.width`,
     * independently of the quick-chat pill's 344px width.
     */
    const room = Math.max(0, window.innerWidth - VIEWPORT_INSET * 2);
    const trayWidth = Math.min(cardWidth(), room);
    const chatWidth = Math.min(CHAT_WIDTH, Math.max(0, window.innerWidth - CHAT_VIEWPORT_INSET));

    const trayHeight = stackExpanded
      ? Math.min(STACK_VIEWPORT_HEIGHT, contentHeight())
      : pileHeight(entries.length, entries[0] === undefined ? CARD_HEIGHT : heightOf(entries[0].key));

    // Which members the column actually has. A tray with nothing to draw is not
    // one of them, and that is what lets the pill sit directly under the pet when
    // no thread is running — Codex renders the stack only when it has items.
    const trayShown = tray.dataset.petTray === "open";
    const column = [];
    if (trayShown) column.push({ tray: true, size: trayHeight });
    if (chatOpen) column.push({ tray: false, size: CHAT_HEIGHT });
    const columnHeight = column.reduce((sum, member, index) => sum + member.size + (index > 0 ? COLUMN_GAP : 0), 0);

    // Each surface fits its own width at the edge. Using the 344px composer's
    // width for the tray leaves short cards stranded well inside the screen.
    // Their resting centers agree wherever there is room around the artwork.
    const artworkOffset = Math.round(width * (artworkCenter - 0.5));
    const centerX = x + width / 2 + artworkOffset;
    const fitCenter = (size, margin) => {
      const inset = Math.min(margin, Math.max(0, (window.innerWidth - size) / 2));
      return Math.min(Math.max(centerX, inset + size / 2), window.innerWidth - inset - size / 2);
    };
    const trayCentreX = fitCenter(trayWidth, VIEWPORT_INSET);
    const chatCentreX = fitCenter(chatWidth, CHAT_VIEWPORT_INSET / 2);

    const below = y + height + GAP_BELOW;
    // Jt(): the test is against the bottom of the screen, and a flipped column
    // hangs off the pet's own top rather than the cluster's.
    const flipped = below + columnHeight > window.innerHeight;
    const columnTop = flipped ? Math.max(VIEWPORT_INSET, y - columnHeight - GAP_BELOW) : below;
    // isTrayAboveMascot. The badge's chevron reads it: `f.placement.startsWith
    // ('bottom') && 'rotate-180'` (frame 3888), so it always points at the mascot.
    pet.dataset.petTrayAbove = flipped ? "true" : "false";

    // Walk it in order and give each member its top. Reversing the list is the
    // whole of isTrayAboveMascot: the stack ends up adjacent to the pet either
    // way, because the pet is at whichever end of the column it was flipped to.
    let cursor = columnTop;
    let trayTop = columnTop;
    let chatTop = columnTop;
    for (const member of flipped ? [...column].reverse() : column) {
      if (member.tray) trayTop = cursor;
      else chatTop = cursor;
      cursor += member.size + COLUMN_GAP;
    }

    tray.style.setProperty("--pet-tray-x", `${trayCentreX}px`);
    tray.style.setProperty("--pet-tray-y", `${trayTop}px`);
    tray.style.setProperty("--pet-tray-width", `${trayWidth}px`);
    tray.style.setProperty("--pet-tray-height", `${trayHeight}px`);

    chat.style.setProperty("--pet-chat-x", `${chatCentreX}px`);
    chat.style.setProperty("--pet-chat-y", `${chatTop}px`);
    chat.style.setProperty("--pet-chat-width", `${chatWidth}px`);

    // Kept for the hit-test filter, which needs to know where the cards ended up
    // without measuring them. Padded by the 12 px the dismiss button and the
    // shadows hang outside the box.
    trayRect = {
      left: trayCentreX - trayWidth / 2 - 12,
      top: trayTop - 12,
      right: trayCentreX + trayWidth / 2 + 12,
      bottom: trayTop + trayHeight + 12
    };

    chatRect = {
      left: chatCentreX - chatWidth / 2,
      top: chatTop,
      right: chatCentreX + chatWidth / 2,
      bottom: chatTop + CHAT_HEIGHT
    };
  }

  function place(nextX, nextY) {
    x = clampAnchor(nextX, 0, maxX());
    y = clampAnchor(nextY, 0, maxY());
    pet.style.left = `${x}px`;
    pet.style.top = `${y}px`;
    layout();
    // The direction is measured from the pet's own centre, so moving the pet
    // changes it even with the cursor still. Codex recomputes on the mascot rect
    // as well as the pointer — frame 3812 memoises Rt on [avatar, point, rect].
    paint();
  }

  const report = () => host.send({ t: "at", x, y });

  function applySize() {
    width = clampWidth(config.size);
    height = Math.round((width * SHEET.cellHeight) / SHEET.cellWidth);
    pet.style.setProperty("--pet-width", `${width}px`);
    // A pet that just grew may no longer fit where it was standing.
    place(x, y);
  }

  /* ── Playing the animation ──────────────────────────────────────────────*/

  /**
   * Which state wins. Codex's order is transient, then hover, then the status; a
   * forced state is put above all three because the point of it is to hold still
   * while being looked at, and looking at it means putting a cursor near it.
   */
  function effectiveState() {
    if (config.force !== "auto" && STATES[config.force]) return config.force;
    if (transient !== null) return transient;
    return hovering ? "jumping" : statusState;
  }

  /**
   * The point the pet should be facing, or null when it should be showing its own
   * animation instead.
   *
   * frame 3805's `w?.caretPoint ?? Re`, with the one source Antigravity has in place
   * of Codex's two: the caret in the composer. There is no computer use here to
   * supply the second, and the mouse is not a source in Codex, so it is not one
   * here either.
   */
  function lookPoint() {
    return replyState === null ? null : caretAt;
  }

  /**
   * The direction the pet should be facing right now, or null when it should be
   * showing its own animation instead.
   *
   * Derived rather than stored, so a state that starts looking picks the
   * direction up at once instead of waiting for the point to move again. The
   * rect is built from the position already known rather than measured, which
   * keeps a cursor crossing the screen from forcing a layout on every event.
   */
  function currentLookFrame() {
    if (drag !== null) return null; // A hand on the pet is not something to look at.
    if (!LOOKING_STATES.has(playing)) return null;
    const point = lookPoint();
    if (point === null) return null;
    return lookFrameFor({ left: x, top: y, width, height }, point);
  }

  function paint() {
    const look = currentLookFrame();

    if (look !== null) {
      // The shipped effect returns before it ever starts a timer when it has a
      // look frame — assets 116-124. So a pet facing the cursor is a still: the
      // sequence is not running underneath the pose, it is not running at all.
      looking = true;
      clearTimeout(frameTimer);
      frameTimer = undefined;
      sprite.style.backgroundPosition = backgroundPositionFor(look);
      return;
    }

    // lookFrame is one of that effect's dependencies, so losing it tears the
    // whole thing down and sets it up again: the animation begins at its first
    // frame rather than resuming wherever a timer would have got to. Which is
    // the difference between a pet that goes back to what it was doing and one
    // that starts doing it.
    if (looking) {
      looking = false;
      rebuild();
      return;
    }

    const frame = sequence.frames[frameIndex];
    if (frame) sprite.style.backgroundPosition = backgroundPositionFor(frame);
  }

  function schedule() {
    clearTimeout(frameTimer);
    frameTimer = undefined;
    if (looking) return;

    const frame = sequence.frames[frameIndex];
    // One frame is a picture, which is what reduced motion asks for.
    if (!frame || sequence.frames.length < 2) return;

    frameTimer = setTimeout(() => {
      const next = frameIndex + 1;
      if (next < sequence.frames.length) frameIndex = next;
      else if (sequence.loopStartIndex !== null) frameIndex = sequence.loopStartIndex;
      else return; // Nothing to loop back to; the last frame is held.
      paint();
      schedule();
    }, frame.frameDurationMs);
  }

  function rebuild() {
    sequence = buildSequence(playing, reducedMotion.matches);
    frameIndex = 0;
    paint();
    schedule();
  }

  /** Starts the winning state, and only if it is not the one already running. */
  function refresh() {
    const next = effectiveState();
    if (next === playing) return;
    playing = next;
    pet.dataset.petState = next;
    rebuild();
    host.send({ t: "playing", state: next });
  }

  /* ── The indicator ──────────────────────────────────────────────────────
   *
   * avatar-mascot-button's standard presentation: a 24px glass disc, defaulting
   * to top-end. Its contents remain visible independently of pointer proximity.
   *
   * What is *on* the disc is the part that is easy to get wrong. Frame 3868-3952 is
   * one if/else over the same variable, and the number is only ever the second of
   * the two branches:
   *
   * - pills out (`_e && wt && F != null`): an icon-only chevron, labelled `Collapse
   *   activity stack` while the stack is open and `Hide activity` otherwise, with
   *   `rotate-180` when the tray sits below the mascot. Its click is onHideActivity-
   *   Pills. No number.
   * - pills stashed (`_e && ie != null && Ve && !le`): a glassy badge whose content
   *   is `S.length` and whose label is `Show activity, N items`. Its click is
   *   onShowActivityPills.
   *
   * So the count is not a running tally that sits on the pet — it is what the way
   * back looks like once the pills have been put away. Both branches need at least
   * one notification, which is the third state: with nothing to say there is no
   * badge. A new badge enters from {opacity: 0, scale: 0.7, y: 3}; the standard
   * presentation removes it immediately when its last notification disappears.
   */
  function enterBadge() {
    if (reducedMotion.matches || typeof badge.animate !== "function") return;
    // Codex's badge spring: damping 20, mass .7, stiffness 420, zero velocity.
    const decay = 20 / (2 * 0.7);
    const frequency = Math.sqrt(420 / 0.7 - decay * decay);
    const frames = [];
    let elapsed = 0;
    for (; elapsed <= 1000; elapsed += 1000 / 120) {
      const seconds = elapsed / 1000;
      const envelope = Math.exp(-decay * seconds);
      const displacement = envelope * (Math.cos(frequency * seconds) + decay / frequency * Math.sin(frequency * seconds));
      const velocity = envelope * (420 / 0.7) / frequency * Math.sin(frequency * seconds);
      frames.push({ opacity: 1 - displacement, transform: `translateY(${3 * displacement}px) scale(${1 - 0.3 * displacement})` });
      if (Math.abs(3 * displacement) < 0.005 && Math.abs(3 * velocity) < 0.01) break;
    }
    frames[frames.length - 1] = { opacity: 1, transform: "translateY(0px) scale(1)" };
    badgeAnimation = badge.animate(frames, { duration: elapsed, easing: "linear" });
  }

  function renderBadge() {
    const level = LEVELS[entries[0]?.status] ?? LEVELS.idle;
    pet.dataset.petTone = level.tone;
    tray.dataset.petTone = level.tone;

    const count = entries.length;
    const kind = stashed ? "count" : "chevron";
    pet.dataset.petBadgeKind = kind;
    badgeCount.textContent = kind === "count" && count > 0 ? String(count) : "";
    const label =
      count === 0
        ? ""
        : kind === "count"
          ? `Show activity, ${count} ${count === 1 ? "item" : "items"}`
          : stackExpanded && count > 1
            ? "Collapse activity stack"
            : "Hide activity";

    badge.setAttribute("aria-label", label);
    pet.dataset.petBadgeCorner = badgeCorner;
    const visible = config.activity !== false && count > 0;
    pet.dataset.petBadge = visible ? "visible" : "hidden";
    badge.hidden = !visible;
    badge.disabled = !visible;
    if (visible && !badgeVisible) enterBadge();
    else if (!visible) badgeAnimation?.cancel();
    badgeVisible = visible;
  }

  /* ── The activity stack ─────────────────────────────────────────────────
   *
   * fbe() has two branches and the page picks between them, so this does too.
   *
   * A pile is one card with two empty backings behind it. An open stack is a 208
   * px window onto the whole list, each card `54 + 8` below the last and shifted
   * by whatever has been scrolled, with `zIndex = items.length - index` keeping
   * the top one on top. Eight cards exist; the list behind them can be any length.
   */

  /** The two strings one entry puts on its card, whole. */
  function copyOf(entry) {
    const level = LEVELS[entry.status] ?? LEVELS.idle;
    const own = (typeof entry.subtitle === "string" ? entry.subtitle : "").trim();
    return {
      level,
      title: (typeof entry.title === "string" ? entry.title : "").trim(),
      body: own.length > 0 ? own : level.body
    };
  }

  /**
   * frame 2818: qr(), whether the body folds up onto the title's line.
   *
   * `kind !== 'activity' && waitingRequest == null && title.length <= 20 &&
   * subtitle.length > 40`. Every card here is a session notification — Ei() builds
   * them with `kind: 'session'` — so the kind term is always true. The waiting term
   * is not: a card that is asking a question keeps its two lines, because the
   * question is the point of it.
   */
  const inlineFold = (entry, title, body) =>
    entry.status !== "waiting" && title.length <= INLINE_TITLE_MAX && body.length > INLINE_BODY_MIN;

  /**
   * page 1160: Hr(), how wide the pills are.
   *
   * Codex measures rather than guesses, and measures once for the whole tray: every
   * pill is as wide as the widest of them, so the stack has one edge rather than a
   * ragged one. Each pill's text is its title at 13px bold plus, if the body folds
   * up onto that line, `•` and the body at 13px regular and the 12 px the separator's
   * margins take — or, if it does not fold, whichever of the two lines is wider. A
   * card that is neither running nor waiting adds 45 px for the controls it shows.
   *
   * The tray and its card text declare the same font family. Reading it from the
   * tray also works before a card is visible; the blank desktop document's body
   * would otherwise supply Times New Roman. With no canvas — Hr()'s `t ==
   * null` — the answer is the 315 ceiling, which is what it was before any of this.
   */
  let widthContext;
  let widthKey = null;
  let widthValue = CARD_WIDTH;

  /** Ur(): the signature that says a re-measure is worth doing. This runs on a poll. */
  const widthSignature = () =>
    JSON.stringify(entries.map((entry) => [entry.key, entry.status, entry.title, entry.subtitle]));

  function cardWidth() {
    const family = window.getComputedStyle(tray).fontFamily || FALLBACK_FAMILY;
    const key = `${family}|${widthSignature()}`;
    if (key !== widthKey) {
      widthKey = key;
      widthValue = measureCards(family);
    }
    return widthValue;
  }

  function measureCards(family) {
    if (widthContext === undefined) {
      widthContext = document.createElement("canvas").getContext("2d") ?? null;
    }
    if (widthContext === null || entries.length === 0) return CARD_WIDTH;

    let widest = 0;
    for (const entry of entries) {
      const { level, title, body } = copyOf(entry);

      widthContext.font = `700 13px ${family}`;
      let text = widthContext.measureText(title).width;

      widthContext.font = `400 13px ${family}`;
      if (inlineFold(entry, title, body)) {
        text += widthContext.measureText(`•${body}`).width + INLINE_SEPARATOR_GAP;
      } else {
        text = Math.max(text, widthContext.measureText(body).width);
      }

      if (!level.loading && entry.status !== "waiting") text += CONTROL_ROOM;
      widest = Math.max(widest, text);
    }
    return Math.min(CARD_WIDTH, Math.max(CARD_MIN_WIDTH, Math.ceil(widest + CARD_SIDE_SPACING * 2)));
  }

  /**
   * What each card actually came out at, keyed by thread.
   *
   * Codex does not assume its rows are 54 px — it measures them. Every row root
   * carries `"data-avatar-overlay-measure": "notification-tray-row"` (frame 3144)
   * and the height that comes back is what fbe() lays out with, which is why
   * `fbe` sums `t.reduce((e, t) => e + t.height, 0)` rather than multiplying by a
   * constant. The pill is `min-h-[54px]` with no height, so 54 is the floor and
   * not the answer; a card whose text needs a second line is 54 + 17 and the one
   * behind it has to be moved down, or it gets painted over — which is exactly
   * the bleed. This map is that measurement, and CARD_HEIGHT is only the value to
   * lay out with before the first one has been taken.
   */
  const heights = new Map();
  const heightOf = (key) => heights.get(key) ?? CARD_HEIGHT;
  /** The shape the map was last filled against; see renderTray for what is in it. */
  let heightKey = null;

  /** gbe(): how tall the whole list is, every card's own height plus the gaps. */
  const contentHeight = () => {
    const total = entries.length;
    if (total === 0) return 0;
    let sum = (total - 1) * STACK_GAP;
    for (const entry of entries) sum += heightOf(entry.key);
    return sum;
  };

  /** dbe(): a scroll offset is only ever as far as there is something to scroll. */
  const clampScroll = (value) =>
    Math.min(Math.max(0, contentHeight() - STACK_VIEWPORT_HEIGHT), Math.max(0, value));

  /**
   * app-initial 21957: which entries an open stack draws, and where each one goes.
   *
   * Every entry gets a top, and fbe() walks the list to find it: a cursor starts
   * at `viewport.top - scrollOffset` and each row advances it by its own height
   * plus gbe(8). The ones nobody can see are placed too, because their tops are
   * precisely what puts them outside the window. Up to eight entries fbe() draws
   * the lot without filtering anything; past eight it keeps whatever overlaps the
   * viewport grown by 56 px of overscan, tops that set back up to eight with the
   * excluded entries nearest the window, and hands entry i the pool card at
   * a bounded pool of eight. This renderer keeps each drawn entry's element by
   * key, so a notification reorder also preserves its reply selection and focus.
   *
   * The window can never be more than seven long: 208 px of viewport plus 56 px of
   * overscan either side is 320, and a card's pitch is at least 54 + 8. Codex
   * asserts this outright — `throw Error("Activity stack overscan exceeds its
   * bounded slot pool")` at 21980 — and the floor under a card's height is what
   * makes the assertion safe.
   */
  function windowed() {
    let cursor = -clampScroll(scrollOffset);
    const placed = entries.map((entry, index) => {
      const height = heightOf(entry.key);
      const top = cursor;
      cursor += height + STACK_GAP;
      return { entry, index, top, height };
    });
    if (placed.length <= STACK_SLOTS) return placed;

    const viewport = Math.min(STACK_VIEWPORT_HEIGHT, contentHeight());
    const low = -STACK_OVERSCAN;
    const high = viewport + STACK_OVERSCAN;
    const drawn = placed.filter((slot) => slot.top < high && slot.top + slot.height > low);

    if (drawn.length < STACK_SLOTS) {
      // How far outside the window it fell, so the nearest are taken first.
      const away = (slot) => (slot.top >= high ? slot.top - high : low - (slot.top + slot.height));
      const inside = new Set(drawn.map((slot) => slot.index));
      drawn.push(
        ...placed
          .filter((slot) => !inside.has(slot.index))
          .sort((a, b) => away(a) - away(b) || a.index - b.index)
          .slice(0, STACK_SLOTS - drawn.length)
      );
      drawn.sort((a, b) => a.index - b.index);
    }
    return drawn.slice(0, STACK_SLOTS);
  }

  function say(into, className, text) {
    const span = make("span", className ? `bettergravity-pet-card__${className}` : "", into);
    span.textContent = text;
    return span;
  }

  /**
   * Writes one entry onto one card.
   *
   * Kr() is worth restating: the level's label is *not* card text. What the card
   * shows is the thread's title and, under it, its own body or the level's
   * fallback — Thinking, Needs input, Blocked, Ready. qr() folds the body up onto
   * the title's line when the title is short and the body long, and that folded
   * form is the one that goes secondary and clamps to two lines.
   */
  function writeCard(card, entry) {
    const { level, title, body } = copyOf(entry);
    const inline = inlineFold(entry, title, body);

    const root = card.root;
    root.hidden = false;
    root.dataset.petKey = entry.key;
    root.dataset.petTone = level.tone;
    root.dataset.petInline = inline ? "true" : "false";
    root.dataset.petHovered = hoveredKey === entry.key ? "true" : "false";
    // A single card is not a collapsed stack (native-frame 3822).
    root.dataset.petCollapsed = !stackExpanded && entries.length > 1 ? "true" : "false";
    // Inert under aria-hidden, but this is where Codex keeps the level's name and
    // the only place it belongs.
    root.setAttribute("aria-label", `${level.label} · ${title}`);

    /*
     * Which controls this card has, and therefore how much of its right-hand side
     * is spoken for. Ui() builds the pill's own class list out of exactly three
     * questions (frame 6047): loading, waiting on a request, and one control
     * instead of two. A card with no controls at all answers no to all three and
     * keeps the base padding — the status box is still over there — but `ke` is
     * false, so the text that runs under it is not faded out.
     */
    const controls = level.controls ?? (level.tone === "success" ? "success" : "default");
    root.dataset.petPill = level.loading ? "loading" : controls === "none" ? "none" : "default";
    root.dataset.petControlsVisible = controls !== "none" &&
      (replyState?.key === entry.key || ((stackExpanded || entries.length === 1) && hoveredKey === entry.key))
      ? "true" : "false";

    card.text.textContent = "";
    if (inline) {
      say(card.text, "title", title);
      say(card.text, "separator", "•");
      say(card.text, "subtitle", body);
      card.body.textContent = "";
    } else {
      card.text.textContent = title;
      card.body.textContent = body;
    }
    card.text.dataset.petLoading = level.loading ? "true" : "false";

    // na() returns null for the spinner, so a running card's status box is empty
    // and the shimmer on its text is the whole indication. Only re-parse the
    // glyph when it actually changes; this runs on every poll.
    if (card.status.dataset.petStatus !== level.icon) {
      card.status.dataset.petStatus = level.icon;
      card.status.querySelector("svg")?.remove();
      const glyph = ICONS[level.icon] ?? "";
      if (glyph.length > 0) card.status.insertAdjacentHTML("beforeend", glyph);
    }
    card.statusDisc.hidden = level.icon !== "check-circle";

    card.controls.dataset.petControls = controls;
    card.reply.hidden = controls !== "default";
    card.stop.hidden = controls !== "default";
    card.dismiss.hidden = controls !== "success";
    // Oe: stop is enabled only on a card that is actually running.
    card.stop.setAttribute("aria-hidden", level.loading ? "false" : "true");
    syncReply(card, entry);
  }

  /**
   * Where one card sits, which is the only thing about it that a measurement can
   * change. Kept apart from writeCard so a second pass can move a card without
   * touching a word of what it says.
   *
   * zIndex is `items.length - index` (21995), so the front of the list is on top
   * and a card that has been scrolled under the one above it stays under it.
   */
  function placeCard(card, slot, total) {
    const root = card.root;
    if (stackExpanded) {
      delete root.dataset.petSlot;
      root.style.setProperty("--pet-card-y", `${slot.top}px`);
      root.style.setProperty("--pet-card-z", String(total - slot.index));
    } else {
      root.dataset.petSlot = "0";
      root.style.removeProperty("--pet-card-y");
      root.style.removeProperty("--pet-card-z");
    }
  }

  /**
   * What the cards came out at, read back in one batch.
   *
   * offsetHeight and not getBoundingClientRect: a collapsed backing is drawn
   * through a transform, and the rect would report the scaled box while what the
   * ladder is built from is the unscaled one. Every read happens after every
   * write in the same pass, so this costs one forced layout rather than one per
   * card — and it is a layout of the whole host document, which is why the caller
   * only asks when something that could change a height has changed.
   *
   * A card with no box at all reports 0, which is not a measurement. That happens
   * before the stylesheet has landed, and `blind` is how the caller knows not to
   * write the attempt down as done.
   *
   * @returns `moved` if a card is a different height than the pass assumed,
   *   `blind` if nothing could be measured, `same` otherwise
   */
  function measureHeights(drawn) {
    if (drawn.length === 0) return "same";
    let moved = false;
    let read = false;
    for (const slot of drawn) {
      const measured = cardFor(slot.entry.key)?.root.offsetHeight ?? 0;
      if (measured <= 0) continue;
      read = true;
      const height = Math.max(CARD_HEIGHT, Math.ceil(measured));
      if (heights.get(slot.entry.key) === height) continue;
      heights.set(slot.entry.key, height);
      moved = true;
    }
    return read ? (moved ? "moved" : "same") : "blind";
  }

  /**
   * One pass of the stack: work out which entries are on screen, write them, and
   * put them where they go.
   *
   * @returns the slots it drew
   */
  function paintCards(total) {
    // A pile draws the front entry and nothing else, because fbe()'s collapsed
    // branch gives everything behind it a zero-height content rect.
    const drawn =
      total === 0
        ? []
        : stackExpanded
          ? windowed()
          : [{ entry: entries[0], index: 0, top: 0, height: heightOf(entries[0].key) }];

    // Anything the pointer was on that is no longer drawn cannot stay hovered,
    // and writeCard reads that, so it has to be settled first.
    if (hoveredKey !== null && !drawn.some((slot) => slot.entry.key === hoveredKey)) hoveredKey = null;

    const wanted = new Set(drawn.map((slot) => slot.entry.key));
    const used = new Set();
    for (const slot of drawn) {
      const card = cardFor(slot.entry.key) ??
        cards.find((candidate) => !wanted.has(candidate.root.dataset.petKey) && !used.has(candidate)) ??
        cardAt(cards.length);
      if (card.root.dataset.petKey !== slot.entry.key && document.activeElement === card.replyInput) {
        card.replyInput.blur();
      }
      if (card.root.dataset.petKey !== slot.entry.key) {
        card.replyMotion = null;
        card.replyTargetHeight = 0;
        card.replyBox.style.height = "0px";
        card.replyBox.style.marginBottom = "0px";
      }
      used.add(card);
      writeCard(card, slot.entry);
      placeCard(card, slot, total);
    }
    for (const card of cards) {
      if (used.has(card)) continue;
      if (document.activeElement === card.replyInput) card.replyInput.blur();
      card.root.hidden = true;
      card.root.dataset.petHovered = "false";
    }
    return drawn;
  }

  function renderTray() {
    const total = entries.length;

    // Bi()'s `hasNotifications`: what the pill offers to do depends on whether
    // there is anything in the tray under it.
    chatInput.placeholder = total > 0 ? "Start new chat" : "Ask";

    tray.dataset.petStack = stackExpanded ? "expanded" : "collapsed";

    // A measurement belongs to a thread, so a thread that has gone takes its own
    // with it rather than sizing whatever entry inherits its slot.
    for (const key of [...heights.keys()]) {
      if (!entries.some((entry) => entry.key === key)) heights.delete(key);
    }

    if (replyState !== null && !entries.some((entry) => entry.key === replyState.key)) closeReply();

    /*
     * Draw, measure, and draw again if the measurement moved anything.
     *
     * Two passes at most, and the second is not a guess: it lays out against
     * heights read off the very text the first pass wrote, and writing the same
     * text again cannot change them. The second pass is what a taller card needs
     * — its own top is already right, but every card below it has to come down,
     * and one of them may be pushed clean out of the window while another is
     * pulled into it, which only re-windowing can find.
     *
     * The measure itself is behind a shape check, because reading offsetHeight
     * forces a layout of the host document and this runs on every wheel tick. A
     * card's height is decided by three things — the copy in it, how wide the tray
     * is, and whether the stack is open — and cardWidth() has already worked out a
     * signature over the first of those for its own memo. A scroll changes none of
     * them, so a scroll pays nothing.
     */
    const shape = `${stackExpanded}|${cardWidth()}|${widthKey}|${replyRevision}`;
    const first = paintCards(total);
    if (shape !== heightKey) {
      const settled = measureHeights(first);
      // `blind` is the stylesheet not having landed yet. Leaving the key alone is
      // what brings the pass back on the next render.
      if (settled !== "blind") heightKey = shape;
      if (settled === "moved") paintCards(total);
    }
    if (revealReply && scrollReplyIntoView()) paintCards(total);

    // The pile's own backings, which are empty for the same reason. lbe(): all
    // three rungs are built out of `{...viewport, height: items[0].height}`, the
    // front of the *list* and not of the window, so the two behind it are that
    // card scaled — not a 54 px stand-in.
    const front = entries[0] === undefined ? CARD_HEIGHT : heightOf(entries[0].key);
    tray.style.setProperty("--pet-pile-front", `${front}px`);
    tray.style.setProperty("--pet-pile-y-1", `${rungOffset(front, RUNGS[1])}px`);
    tray.style.setProperty("--pet-pile-y-2", `${rungOffset(front, RUNGS[2])}px`);
    backings[0].hidden = stackExpanded || total < 3;
    backings[1].hidden = stackExpanded || total < 2;

    // The masked edge is whichever side has something scrolled off it.
    const visibleScrollOffset = clampScroll(scrollOffset);
    const above = visibleScrollOffset > 0;
    const belowEdge = visibleScrollOffset < contentHeight() - STACK_VIEWPORT_HEIGHT;
    if (stackExpanded && (above || belowEdge)) {
      tray.dataset.petOverflow = above && belowEdge ? "both" : above ? "top" : "bottom";
    } else delete tray.dataset.petOverflow;

    /*
     * Whether the pills are on screen at all — a question the cursor has no say in.
     *
     * Codex's gate is `wt = le && Ve` (frame 3819): `areActivityPillsVisible` and a
     * non-empty list. `le` is not a hover state and not derived from one — the page
     * reads it straight out of a persisted setting, `dt = z(wa) ?? b(Ca, !0)` (page
     * 2049), and the only writers are the badge's two branches. The status pill is
     * the point of the whole feature, so it hangs under the mascot for as long as
     * there is something to say. Proximity adds the cluster, the card controls and
     * the quick chat on top; it takes none of this away.
     */
    // Codex only resets expansion on an explicit collapse or hide/show action.
    // An empty notification snapshot must not collapse a list that was open.
    const open = config.activity && !stashed && total > 0;
    tray.dataset.petTray = open ? "open" : "closed";
    tray.setAttribute("aria-hidden", String(!open));
    tray.inert = !open;
  }

  /** Everything that depends on the activity list, in the order it depends on it. */
  function renderActivity() {
    statusState = working ? "running" : (LEVELS[entries[0]?.status] ?? LEVELS.idle).mascot;
    renderBadge();
    renderTray();
    layout();
    refresh();
  }

  /* ── Which pixels belong to the pet ─────────────────────────────────────
   *
   * On the desktop the window covers the whole working area, so it has to be a
   * hole everywhere the pet is not. The main process keeps it click-through with
   * `setIgnoreMouseEvents(true, { forward: true })`, and the forwarding is what
   * makes this possible at all: mouse moves still reach the document while it is
   * ignoring the mouse, so the surface can ask what is under the cursor and turn
   * the window solid for exactly those pixels. `data-pet-hit` marks them.
   *
   * elementFromPoint is a real hit test — it respects the cards' corner radii —
   * but it is also the one thing here that can force a layout, and in
   * Antigravity's window the document under the cursor is the whole editor. So it
   * only runs when the cursor is already inside one of the boxes below: the pet
   * plus the 56 px the proximity test itself reaches, the tray while it is open,
   * and the chat pill while it is out. A cursor anywhere else costs nothing.
   */

  const inRect = (rect, px, py) =>
    px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;

  function near(px, py) {
    if (menuOpen) return true;
    if (
      px >= x - PROXIMITY_EXIT_PX &&
      px <= x + width + PROXIMITY_EXIT_PX &&
      py >= y - PROXIMITY_EXIT_PX &&
      py <= y + height + PROXIMITY_EXIT_PX
    ) {
      return true;
    }
    if (tray.dataset.petTray === "open" && inRect(trayRect, px, py)) return true;
    return chatOpen && inRect(chatRect, px, py);
  }

  /** Whatever part of the pet the cursor is on, or null. */
  function hitAt(px, py) {
    if (!near(px, py)) return null;
    const element = document.elementFromPoint(px, py);
    return element === null ? null : element.closest("[data-pet-hit]");
  }

  /**
   * How far the cursor is from the pet, measured to the nearest point of its box
   * and so zero while it is on it.
   *
   * This is what pet-pointer-proximity-changed is reporting. It is the pet's own
   * rect and nothing else's: the cards the pet has put on screen do not enlarge
   * it, which is why being over one of them counts separately below.
   */
  function distanceTo(px, py) {
    const dx = Math.max(x - px, 0, px - (x + width));
    const dy = Math.max(y - py, 0, py - (y + height));
    return Math.hypot(dx, dy);
  }

  /**
   * Opens or closes the cluster, with the hysteresis and the delay Codex uses.
   *
   * 40 px in, 56 px out, so a cursor resting on the boundary cannot make it
   * flicker; and leaving waits compactDismissDelayMs, so crossing the gap between
   * the pet and its own cards — or reaching past one control to another — does
   * not shut everything on the way.
   *
   * @returns whether anything needs redrawing now
   */
  function setNearby(next) {
    // A caret in either editor pins everything open. Codex's 300 ms is there to
    // forgive a cursor crossing a gap, not to take a half-typed question away.
    if (next || isPetEditor(document.activeElement)) {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
      if (nearby) return false;
      nearby = true;
      return true;
    }

    if (!nearby || dismissTimer !== undefined) return false;
    dismissTimer = setTimeout(() => {
      dismissTimer = undefined;
      nearby = false;
      chatOpen = false;
      hoveredKey = null;
      renderCluster();
    }, DISMISS_DELAY_MS);
    return false;
  }

  /** Everything the cluster's own state decides, in the order it decides it. */
  function renderCluster() {
    pet.dataset.petCluster = nearby ? "open" : "closed";
    chat.dataset.petChat = chatOpen ? "open" : "closed";
    renderBadge();
    renderTray();
    layout();
    refresh();
  }

  /**
   * Everything that follows the cursor: the window's own solidity, how near the
   * pet the pointer is, which card it is over, and which way the pet is looking.
   *
   * A held pet or badge keeps the window solid whatever the hit test says. A hand can
   * leave the sprite between two moves, and going click-through there would drop
   * the drag on the floor.
   */
  function updatePointer(px, py) {
    pointerAt = { x: px, y: py };

    const hit = drag !== null ? pet : badgeDrag !== null ? badge : hitAt(px, py);
    if (desktop) host.setInteractive(menuOpen || hit !== null);

    // Over the pet's own surface counts as near it however far the cursor has
    // reached down the stack, which is Ui()'s isPointerSurfaceHovered.
    const threshold = nearby ? PROXIMITY_EXIT_PX : PROXIMITY_ENTER_PX;
    let changed = setNearby(hit !== null || distanceTo(px, py) <= threshold);

    /*
     * The Ask pill's own trigger, which is not the pet's.
     *
     * Codex hangs onQuickChatPointerEnter on the tray column rather than on the
     * mascot (frame 4115), and leaves that wrapper `pointer-events-none` until
     * `Tt` — pills up with something in them, or the quick chat already out
     * (4094). So the pill comes out when the cursor reaches the cards, not when
     * it comes near the pet, and a pet with nothing to report has no way of
     * being asked anything: there is nothing there to hover.
     *
     * Nor does leaving the column put it away. onQuickChatPointerLeave starts a
     * 300 ms timer that gives up if any hit region is still hovered (3843), and
     * every part of this is a hit region — so what actually closes the pill is
     * the cluster's own dismissal, which setNearby already does.
     */
    const column = hit !== null && !["pet", "badge", "menu"].includes(hit.dataset.petHit);
    if (column && !chatOpen) {
      chatOpen = true;
      changed = true;
    }

    const over = hit !== null && hit.dataset.petHit === "pet";
    if (over !== hovering) {
      hovering = over;
      changed = true;
    }

    const key = hit?.closest("[data-pet-key]")?.dataset.petKey ?? null;
    if (key !== hoveredKey) {
      hoveredKey = key;
      changed = true;
    }

    if (changed) renderCluster();
    paint();
  }

  /** The cursor has left for somewhere this document cannot see. */
  function forgetPointer() {
    if (pointerAt === null && !nearby && !hovering) return;
    pointerAt = null;
    hovering = false;
    setNearby(false);
    renderCluster();
    if (desktop && drag === null && badgeDrag === null) host.setInteractive(menuOpen);
    paint();
  }

  /** Adds a listener and remembers how to take it off again. */
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    track(() => target.removeEventListener(type, handler, options));
  };

  function closePetMenu(restoreFocus = false) {
    if (!menuOpen) return;
    menuOpen = false;
    petMenu.hidden = true;
    pet.setAttribute("aria-expanded", "false");
    if (restoreFocus && menuFocus?.isConnected) menuFocus.focus({ preventScroll: true });
    if (desktop) host.setFocusable?.(isPetEditor(document.activeElement));
    if (pointerAt) updatePointer(pointerAt.x, pointerAt.y);
    else if (desktop) host.setInteractive(false);
    menuFocus = null;
  }

  function showPetMenu(point) {
    if (disposed) return;
    menuFocus = document.activeElement;
    menuOpen = true;
    petMenu.hidden = false;
    pet.setAttribute("aria-expanded", "true");
    const rect = petMenu.getBoundingClientRect();
    petMenu.style.left = `${Math.max(6, Math.min(point.x, window.innerWidth - (rect.width || 200) - 6))}px`;
    petMenu.style.top = `${Math.max(6, Math.min(point.y, window.innerHeight - (rect.height || 40) - 6))}px`;
    if (desktop) {
      host.setInteractive(true);
      host.setFocusable?.(true);
    }
    closePetItem.focus({ preventScroll: true });
  }

  on(pet, "contextmenu", event => {
    event.preventDefault();
    event.stopPropagation();
    if (drag !== null) endDrag({ pointerId: drag.pointerId }, false);
    stopMomentum();
    closePetMenu();
    const point = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: x + width, y: y + height / 2 };
    if (desktop) {
      menuRequest = { id: `pet-menu-${++menuSequence}`, point };
      host.send({ type: "bettergravity:overlay-context-menu", requestId: menuRequest.id,
        items: [{ id: "close-pet", label: "Close pet" }] });
    } else showPetMenu(point);
  });
  on(closePetItem, "click", event => {
    event.preventDefault();
    event.stopPropagation();
    closePetMenu();
    host.send({ t: "hide" });
  });
  on(document, "pointerdown", event => {
    if (!menuOpen || petMenu.contains(event.target)) return;
    closePetMenu();
    event.preventDefault();
    event.stopPropagation();
  }, true);
  on(petMenu, "keydown", event => {
    event.stopPropagation();
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      closePetItem.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      closePetMenu(true);
    }
  });

  // A downloaded font can change the widest card without changing its text.
  if (document.fonts?.addEventListener) on(document.fonts, "loadingdone", () => {
    widthKey = null;
    heightKey = null;
    renderTray();
    layout();
  });

  // Follow the reply's actual animated height. A second spring on the tray or
  // its neighboring cards would lag behind it and briefly overlap their content.
  const cardResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver((changes) => {
    if (disposed) return;
    let moved = false;
    for (const change of changes) {
      const card = cards.find((candidate) => candidate.root === change.target || candidate.replyForm === change.target);
      if (!card || card.root.hidden) continue;
      if (change.target === card.replyForm) {
        if (replyState?.key === card.root.dataset.petKey) sizeReply(card);
        continue;
      }
      const measured = change.borderBoxSize?.[0]?.blockSize ?? card.root.offsetHeight;
      if (measured <= 0) continue;
      const next = Math.max(CARD_HEIGHT, Math.round(measured));
      const key = card.root.dataset.petKey;
      if (heights.get(key) === next) continue;
      heights.set(key, next);
      moved = true;
    }
    if (moved) {
      renderTray();
      layout();
    }
  }) : null;
  track(() => cardResizeObserver?.disconnect());

  // `mousemove` rather than `pointermove`, because a forwarded mouse message is
  // what Electron promises to deliver to a click-through window; pointer events
  // are for the drag, which only happens once the window is solid.
  on(document, "mousemove", (event) => updatePointer(event.clientX, event.clientY), {
    passive: true
  });
  on(document, "mouseleave", forgetPointer);
  on(window, "blur", () => {
    closePetMenu();
    if (drag !== null) endDrag({ pointerId: drag.pointerId }, false);
    if (desktop && isPetEditor(document.activeElement)) document.activeElement.blur();
    else forgetPointer();
  });

  on(reducedMotion, "change", () => {
    if (reducedMotion.matches) badgeAnimation?.cancel();
    rebuild();
    if (reducedMotion.matches && replyFrame !== undefined) {
      cancelAnimationFrame(replyFrame);
      animateReplies(performance.now());
    }
  });

  on(window, "resize", () => {
    closePetMenu();
    // Same clamp as a drag: the pet stays inside whatever the work area now is.
    place(x, y);
    report();
  });

  /* ── Picking it up ──────────────────────────────────────────────────────*/

  const sampleOf = (event) => ({ x: event.clientX, y: event.clientY, timeMs: event.timeStamp });

  /** Only the last 160 ms of a drag says anything about how hard it was thrown. */
  function prune(list) {
    const newest = list.at(-1);
    return newest == null
      ? [...list]
      : list.filter((entry) => newest.timeMs - entry.timeMs <= SAMPLE_WINDOW_MS);
  }

  /**
   * The sample at which the pointer stopped moving.
   *
   * Walks back from the newest sample through every sample within the 4 px
   * threshold of it and returns the oldest of them. Hold the pet still for a
   * moment before letting go and this lands on the first stationary sample, which
   * leaves nothing older in the window to measure against — so a deliberate
   * placement never turns into an accidental throw.
   */
  function movementEnd(list) {
    const newest = list.at(-1);
    if (newest == null) return undefined;

    let index = list.length - 1;
    while (index > 0) {
      const previous = list[index - 1];
      if (previous == null) break;
      if (Math.abs(newest.x - previous.x) >= DRAG_THRESHOLD_PX) break;
      if (Math.abs(newest.y - previous.y) >= DRAG_THRESHOLD_PX) break;
      index -= 1;
    }
    return list[index];
  }

  /**
   * How fast the pet was moving when it was let go, in pixels per second, or null
   * when the release was a placement rather than a throw.
   */
  function velocityOf(list) {
    const end = movementEnd(list);
    if (end == null) return null;
    const start = list.find((entry) => end.timeMs - entry.timeMs > 0);
    if (start == null) return null;

    const seconds = Math.max(end.timeMs - start.timeMs, MIN_SAMPLE_DT_MS) / 1000;
    const velocity = { x: (end.x - start.x) / seconds, y: (end.y - start.y) / seconds };
    const speed = Math.hypot(velocity.x, velocity.y);

    if (speed < MIN_THROW_SPEED) return null;
    if (speed <= MAX_THROW_SPEED) return velocity;

    // Faster than the ceiling: keep the direction, cap the magnitude.
    const scale = MAX_THROW_SPEED / speed;
    return { x: velocity.x * scale, y: velocity.y * scale };
  }

  /* ── Throwing it ────────────────────────────────────────────────────────*/

  function stopMomentum() {
    clearTimeout(momentumTimer);
    momentumTimer = undefined;
  }

  /**
   * Flies the pet from where it is, bouncing off the edges of the work area, until
   * it is slower than the stop speed or 900 ms have passed.
   *
   * **This is off by default, because in Codex it very nearly never runs.** The one
   * route into it is the `avatar-overlay-drag-release` message (main 55418), and the
   * release handler only sends that message when `usesOrbPhysics` is set — page 2734:
   *
   *   n.usesOrbPhysics && o != null &&
   *     K.dispatchMessage(`avatar-overlay-drag-release`, {
   *       shouldBounce: !0, velocityX: o.x * 3, velocityY: o.y * 3,
   *     });
   *
   * and `usesOrbPhysics` (page 2761) is `R && !A`, where `R` needs a live realtime
   * voice session and `A` is a feature gate. No voice call, no throw: dropping the
   * mascot in the Codex or ChatGPT app just leaves it where you let go, which is why
   * a plugin that threw it on every release felt wrong. "Throw it" turns it back on.
   *
   * Codex runs this in its main process, moving a real window across the display.
   * The arithmetic below is the same, tick for tick: advance by velocity, reverse
   * an axis that hit an edge and keep 70% of its speed, then shed friction. It is
   * a chained timeout rather than an interval because a tick that arrives late
   * should not have the next one arrive immediately behind it.
   *
   * On the desktop the edges being bounced off are the screen's, because the
   * document is the screen — which is the version Codex actually ships.
   */
  function throwPet(velocity) {
    let vx = velocity.x * THROW_MULTIPLIER;
    let vy = velocity.y * THROW_MULTIPLIER;
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || (vx === 0 && vy === 0)) return;

    stopMomentum();

    const startedAt = performance.now();
    let previousAt = startedAt;

    const tick = () => {
      const now = performance.now();
      // Clamped at both ends: a backgrounded window can hand back an hour.
      const dtMs = Math.min(Math.max(0, now - previousAt), MAX_TICK_DT_MS);
      previousAt = now;

      const seconds = dtMs / 1000;
      const wantedX = x + vx * seconds;
      const wantedY = y + vy * seconds;

      place(wantedX, wantedY);

      // place() rounds and clamps to the work area and assigns the value it used,
      // so a position that came back different from the *rounded* wanted one is a
      // position that hit an edge. Codex compares the same way — main 102975 is
      // `this.anchor.x !== Math.round(h.x) && (i = n ? -i * G5 : 0)`, where the
      // anchor has been through Vf and `h` has not. Comparing against the raw
      // wanted value instead would call every single tick a bounce.
      if (x !== Math.round(wantedX)) vx = -vx * RESTITUTION;
      if (y !== Math.round(wantedY)) vy = -vy * RESTITUTION;

      const kept = FRICTION ** (dtMs / TICK_MS);
      vx *= kept;
      vy *= kept;

      if (now - startedAt >= MAX_MOMENTUM_MS || Math.hypot(vx, vy) < STOP_SPEED) {
        stopMomentum();
        report();
        // It has landed somewhere new, which may or may not be under the cursor.
        if (pointerAt !== null) updatePointer(pointerAt.x, pointerAt.y);
        refresh();
        return;
      }

      momentumTimer = setTimeout(tick, TICK_MS);
    };

    momentumTimer = setTimeout(tick, TICK_MS);
  }

  /* ── The pointer ────────────────────────────────────────────────────────
   *
   * Antigravity's shell has `-webkit-app-region: drag` on its own chrome, and a
   * press that lands inside a drag region is taken by the window manager before
   * the page ever sees a `pointerdown` — while `mousemove` keeps arriving, which
   * is exactly the shape of "the pet watches the cursor but will not be picked
   * up". The stylesheets opt every part of the pet back out with `no-drag`; this
   * end holds up the other half of the bargain.
   *
   * Capture on the document rather than bubble on the pet, and after
   * `setPointerCapture` rather than instead of it. Capture is the fast path: with
   * it, every move and release for this pointer is delivered to the pet however
   * far outside it the cursor travels. But the workbench is full of listeners that
   * call `stopPropagation`, and some of them capture the pointer themselves —
   * either one takes the release away, and a pet whose `pointerup` never arrives
   * is a pet stuck to the cursor. Listening at the document in the capture phase
   * runs us before any of them and needs no capture to have been granted.
   */

  on(pet, "pointerdown", (event) => {
    // Codex's own guard: the primary button only, and never a ctrl-press (which is
    // a right-click on macOS).
    if (event.button !== 0 || event.ctrlKey || event.isPrimary === false) return;
    // The mascot is draggable; the badge sitting on it is a button. Asking which
    // hit region the press landed in rather than testing for a `.no-drag` class
    // also means a page that happens to use that class cannot nail the pet down.
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-pet-hit]") !== pet) return;

    event.preventDefault();
    // Nothing in the workbench needs to know the pet was pressed, and one of the
    // things it might do about it is take the pointer.
    event.stopPropagation();
    // Best-effort: a page that has already captured this pointer makes this throw,
    // and the document-level handlers below do not need it to have worked.
    try {
      pet.setPointerCapture(event.pointerId);
    } catch {}
    stopMomentum();

    drag = {
      pointerId: event.pointerId,
      samples: [sampleOf(event)],
      x: event.clientX,
      y: event.clientY,
      grabX: event.clientX - x,
      grabY: event.clientY - y,
      hasMoved: false
    };

    transient = null;
    pet.dataset.petDragging = "true";
    tray.dataset.petDragging = "true";
    chat.dataset.petDragging = "true";
    // Keep the corner badge anchored while the mascot moves.
    renderBadge();
    // A held pet does not look around, so the pose has to come off now.
    paint();
    refresh();
    if (desktop) host.send({ type: "bettergravity:overlay-drag-state", dragging: true });
  });

  on(
    document,
    "pointermove",
    (event) => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      // A release outside the window can be missed even with document capture.
      if (event.buttons === 0) {
        endDrag(event, false);
        return;
      }

      const next = sampleOf(event);
      drag.samples = prune([...drag.samples, next]);

      const dx = next.x - drag.x;
      const dy = next.y - drag.y;
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;

      drag.hasMoved = true;
      drag.x = next.x;
      drag.y = next.y;

      // Codex suppresses the running frames while its throw physics are on, because
      // in that mode the mascot is drawn as an orb with no sprite to animate — and
      // those physics are almost never on (see throwPet). Ours is always the sprite,
      // so it turns and runs the way it is being pulled.
      if (dx >= RUN_THRESHOLD_PX) transient = "running-right";
      else if (dx <= -RUN_THRESHOLD_PX) transient = "running-left";

      place(next.x - drag.grabX, next.y - drag.grabY);
      refresh();
    },
    true
  );

  /**
   * @param {boolean} released true for a real release, false for a cancelled one
   */
  function endDrag(event, released) {
    if (drag === null || event.pointerId !== drag.pointerId) return;

    const held = drag;
    drag = null;
    if (desktop) host.send({ type: "bettergravity:overlay-drag-state", dragging: false });
    // Codex clears the transient here, so the pet stops running the instant it is
    // let go and flies through the air as whatever the agent is doing.
    transient = null;

    try {
      if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
    } catch {}
    delete pet.dataset.petDragging;
    delete tray.dataset.petDragging;
    delete chat.dataset.petDragging;
    renderBadge();
    refresh();

    // Cancellation is a placement, never a click or a throw. The next real
    // pointer move can re-establish hover after focus or capture was lost.
    if (!released) {
      forgetPointer();
      report();
      return;
    }

    const release = sampleOf(event);
    const samples = prune([...held.samples, release]);

    // A flick too fast to register a single accepted move still counts as a drag,
    // measured from where the press started.
    const first = held.samples[0];
    const last = release ?? held.samples.at(-1);
    const moved =
      held.hasMoved ||
      (first != null &&
        last != null &&
        (Math.abs(last.x - first.x) >= DRAG_THRESHOLD_PX ||
          Math.abs(last.y - first.y) >= DRAG_THRESHOLD_PX));

    if (released && !moved) {
      // Codex's mascot brings the app forward when it is clicked rather than
      // dragged. Native focus also restores a minimized owner on the desktop.
      if (desktop) host.focusOwner?.();
      host.send({ t: "poke" });
      if (pointerAt !== null) updatePointer(pointerAt.x, pointerAt.y);
      return;
    }

    const velocity = config.bounce ? velocityOf(samples) : null;
    if (velocity !== null) throwPet(velocity);
    else {
      report();
      if (pointerAt !== null) updatePointer(pointerAt.x, pointerAt.y);
    }
  }

  on(document, "pointerup", (event) => endDrag(event, true), true);
  on(document, "pointercancel", (event) => endDrag(event, false), true);
  on(pet, "lostpointercapture", (event) => endDrag(event, false));

  /* ── The things you can press ───────────────────────────────────────────
   *
   * One delegated handler, because the cards are pooled and rebuilt on every poll
   * and a listener per card would have to be taken off again.
   *
   * The order matters: a control is inside a card, so the control has to be asked
   * about first, or every stop button would also open the thread it belongs to.
   */

  /** Which entry a press landed on, whatever part of the card it hit. */
  const keyOf = (target) =>
    target instanceof Element ? (target.closest("[data-pet-key]")?.dataset.petKey ?? null) : null;

  const tell = (t, key) => {
    if (typeof key !== "string" || key.length === 0) return;
    if (desktop && t === "open") host.focusOwner?.();
    host.send({ t, key });
  };

  // The standard Codex badge can be dragged to a corner independently of the
  // mascot. Crossing its 4px threshold must suppress the following click.
  on(badge, "pointerdown", (event) => {
    if (event.button !== 0 || badge.disabled) return;
    event.stopPropagation();
    try { badge.setPointerCapture(event.pointerId); } catch {}
    badgeDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  });
  on(badge, "pointermove", (event) => {
    if (badgeDrag === null || event.pointerId !== badgeDrag.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - badgeDrag.x;
    const dy = event.clientY - badgeDrag.y;
    if (!badgeDrag.moved && Math.abs(dx) < BADGE_DRAG_THRESHOLD && Math.abs(dy) < BADGE_DRAG_THRESHOLD) return;
    event.preventDefault();
    badgeDrag.moved = true;
    badge.style.translate = `${dx}px ${dy}px`;
  });
  const releaseBadge = (event, cancelled) => {
    const held = badgeDrag;
    if (held === null || event.pointerId !== held.pointerId) return;
    event.stopPropagation();
    badgeDrag = null;
    badge.style.removeProperty("translate");
    if (badge.hasPointerCapture?.(event.pointerId)) badge.releasePointerCapture(event.pointerId);
    if (cancelled || !held.moved) return;
    badgeCorner = `${event.clientY < y + height / 2 ? "top" : "bottom"}-${event.clientX < x + width / 2 ? "start" : "end"}`;
    pet.dataset.petBadgeCorner = badgeCorner;
    host.send({ t: "badge-corner", corner: badgeCorner });
    event.preventDefault();
    suppressBadgeClick = true;
    clearTimeout(badgeClickTimer);
    badgeClickTimer = setTimeout(() => { suppressBadgeClick = false; }, 0);
  };
  on(badge, "pointerup", (event) => releaseBadge(event, false));
  on(badge, "pointercancel", (event) => releaseBadge(event, true));
  on(badge, "lostpointercapture", () => {
    badgeDrag = null;
    badge.style.removeProperty("translate");
  });

  on(document, "click", (event) => {
    if (!(event.target instanceof Element)) return;

    /*
     * The badge, which is one control doing two jobs — Rr(), page 2949:
     *
     *   Rr = (e) => {
     *     if ((Lr(!1), e !== !0 && W && q.length > 1)) { …close-notification-stack…; Dr(); return }
     *     (Dr(), c(Ca, !1), w.set(wa, !1))
     *   }
     *
     * `Lr(!1)` gives up the quick-chat caret first. Then, with the stack open and
     * more than one thread in it, the press only closes the stack and stops there —
     * the pills are not put away until a second press has nothing left to collapse.
     * `Dr()` is `ft(!1), Wt(0)`: closed, and rewound to the top.
     */
    if (event.target.closest('[data-pet-hit="badge"]') !== null) {
      event.stopPropagation();
      if (suppressBadgeClick) { suppressBadgeClick = false; event.preventDefault(); return; }
      if (entries.length === 0 || badge.disabled) return;
      if (isPetEditor(document.activeElement)) document.activeElement.blur();
      if (stashed) {
        // Vr(): the count is the way back.
        stashed = false;
        stackExpanded = false;
        scrollOffset = 0;
        host.send({ t: "activity-visibility", visible: true });
      } else if (stackExpanded && entries.length > 1) {
        stackExpanded = false;
        scrollOffset = 0;
      } else {
        stashed = true;
        stackExpanded = false;
        scrollOffset = 0;
        host.send({ t: "activity-visibility", visible: false });
      }
      renderCluster();
      return;
    }

    const control = event.target.closest("[data-pet-control]");
    if (control !== null) {
      const key = keyOf(control);
      switch (control.dataset.petControl) {
        case "reply": {
          if (replyState?.key === key) {
            closeReply();
            break;
          }
          const card = cardFor(key);
          if (!card) break;
          closeReply();
          replyState = { key, draft: "", requestId: null, error: false };
          replyRevision++;
          setNearby(true);
          renderCluster();
          // Request native focus explicitly: an Electron overlay can select a
          // DOM field without emitting focus while its window is not focusable.
          focusEditor();
          card.replyInput.focus({ preventScroll: true });
          break;
        }
        case "stop":
          if (control.getAttribute("aria-hidden") !== "true") {
            if (replyState?.key === key) closeReply();
            tell("stop", key);
          }
          break;
        case "success":
        case "close":
          tell("dismiss", key);
          break;
        case "send":
          submitChat();
          break;
      }
      renderCluster();
      return;
    }

    const card = event.target.closest('[data-pet-hit="card"]');
    if (card === null) return;

    /*
     * onActivateNotification. A pile of more than one is a lid before it is a
     * button: the first press opens the stack and goes no further, because until
     * it is open there is no telling which of the threads underneath was meant.
     * One card on its own opens straight away.
     */
    if (!stackExpanded && entries.length > 1) {
      stackExpanded = true;
      scrollOffset = 0;
      renderCluster();
      return;
    }
    tell("open", keyOf(card));
  });

  /*
   * dbe(): the stack scrolls inside its 208 px viewport, clamped so it cannot be
   * pushed past either end. Only when it is open — a pile has nothing to scroll,
   * and swallowing the editor's own wheel events over a closed one would be rude.
   */
  on(
    tray,
    "wheel",
    (event) => {
      if (!stackExpanded) return;
      revealReply = false;
      const next = clampScroll(scrollOffset + event.deltaY);
      if (next === scrollOffset) return;
      event.preventDefault();
      scrollOffset = next;
      renderTray();
      layout();
    },
    { passive: false }
  );

  /** The chat pill, which is one line of text and the button on the end of it. */
  function submitChat() {
    const text = chatInput.value.trim();
    if (text.length === 0) return;
    chatInput.value = "";
    host.send({ t: "ask", text, key: null });
  }

  function closeReply() {
    if (replyState === null) return;
    const field = cardFor(replyState.key)?.replyInput;
    replyState = null;
    replyRevision++;
    if (document.activeElement === field) field.blur();
    composerClosed();
  }

  function submitReply(key) {
    const state = replyState;
    if (state === null || state.key !== key || state.requestId !== null) return;
    const text = state.draft.trim();
    if (!text) return;
    state.requestId = String(++replySequence);
    state.error = false;
    replyRevision++;
    renderCluster();
    try {
      host.send({ t: "ask", key, text, requestId: state.requestId });
    } catch {
      state.requestId = null;
      state.error = true;
      replyRevision++;
      renderCluster();
    }
  }

  function animateReplyLayout(reveal) {
    tray.dataset.petReplyLayout = "true";
    if (reveal) revealReply = true;
    clearTimeout(replyLayoutTimer);
    replyLayoutTimer = setTimeout(() => {
      replyLayoutTimer = undefined;
      if (disposed) return;
      heightKey = null;
      renderTray();
      layout();
      revealReply = false;
      if (replyState === null) delete tray.dataset.petReplyLayout;
    }, reducedMotion.matches ? 0 : 252);
  }

  // Codex's height curve is cubic-bezier(0.23, 1, 0.32, 1). Drive the height
  // and its measured stack positions in one frame, as its onUpdate callback
  // does; a CSS height transition can advance before ResizeObserver delivers.
  function replyEase(progress) {
    if (progress <= 0 || progress >= 1) return progress;
    let low = 0;
    let high = 1;
    for (let index = 0; index < 16; index++) {
      const t = (low + high) / 2;
      const x = 3 * (1 - t) ** 2 * t * 0.23 + 3 * (1 - t) * t ** 2 * 0.32 + t ** 3;
      if (x < progress) low = t;
      else high = t;
    }
    return 1 - (1 - (low + high) / 2) ** 3;
  }

  function animateReplies(now) {
    replyFrame = undefined;
    if (disposed) return;
    for (const card of cards) {
      const motion = card.replyMotion;
      if (!motion) continue;
      const progress = reducedMotion.matches ? 1 : Math.min(1, Math.max(0, (now - motion.started) / 220));
      const eased = replyEase(progress);
      card.replyBox.style.height = `${motion.height + (motion.targetHeight - motion.height) * eased}px`;
      card.replyBox.style.marginBottom = `${motion.margin + (motion.targetMargin - motion.margin) * eased}px`;
      if (progress === 1) card.replyMotion = null;
    }
    heightKey = null;
    renderTray();
    layout();
    if (cards.some(card => card.replyMotion)) replyFrame ??= requestAnimationFrame(animateReplies);
    else revealReply = false;
  }

  function sizeReply(card) {
    const open = replyState?.key === card.root.dataset.petKey;
    const next = open ? Math.max(26, card.replyForm.offsetHeight) : 0;
    if (card.replyTargetHeight === next) return;
    card.replyTargetHeight = next;
    const margin = open ? 14 : 0;
    animateReplyLayout(open);
    if (reducedMotion.matches) {
      card.replyMotion = null;
      card.replyBox.style.height = `${next}px`;
      card.replyBox.style.marginBottom = `${margin}px`;
    } else {
      card.replyMotion = {
        started: performance.now(),
        height: Number.parseFloat(card.replyBox.style.height) || 0,
        margin: Number.parseFloat(card.replyBox.style.marginBottom) || 0,
        targetHeight: next,
        targetMargin: margin
      };
      replyFrame ??= requestAnimationFrame(animateReplies);
    }
  }

  function syncReply(card, entry) {
    const state = replyState?.key === entry.key ? replyState : null;
    const open = state !== null;
    card.root.dataset.petReplying = String(open);
    card.reply.setAttribute("aria-label", `Reply to ${entry.title}`);
    card.reply.setAttribute("aria-pressed", String(open));
    card.reply.tabIndex = card.root.dataset.petControlsVisible === "true" ? 0 : -1;
    card.replyBox.inert = !open;
    card.replyBox.setAttribute("aria-hidden", String(!open));
    card.replyForm.setAttribute("aria-busy", String(state?.requestId != null));
    card.replyInput.disabled = !open;
    card.replyInput.setAttribute("aria-label", `Follow up on ${entry.title}`);
    const draft = state?.draft ?? "";
    if (card.replyInput.value !== draft) card.replyInput.value = draft;
    card.replyError.hidden = !state?.error;
    sizeReply(card);
  }

  function scrollReplyIntoView() {
    if (!stackExpanded || replyState === null) return false;
    let top = 0;
    for (const entry of entries) {
      const size = heightOf(entry.key);
      if (entry.key === replyState.key) {
        const next = clampScroll(Math.min(top, Math.max(scrollOffset, top + size - STACK_VIEWPORT_HEIGHT)));
        if (next === scrollOffset) return false;
        scrollOffset = next;
        return true;
      }
      top += size + STACK_GAP;
    }
    return false;
  }

  const isPetEditor = (element) => element === chatInput ||
    (element instanceof HTMLTextAreaElement && tray.contains(element) && element.classList.contains("bettergravity-pet-card__reply-input"));

  function focusEditor() {
    if (desktop) host.setFocusable?.(true);
  }

  function editorBlur(event) {
    // Moving between the inline reply and quick chat must not give native focus
    // back to the application behind the floating window.
    if (desktop && !isPetEditor(event.relatedTarget)) host.setFocusable?.(false);
    composerClosed();
    if (pointerAt === null) forgetPointer();
    else updatePointer(pointerAt.x, pointerAt.y);
  }

  function wireReply(card) {
    const { replyForm: form, replyInput: field } = card;
    on(form, "pointerdown", (event) => {
      event.stopPropagation();
      focusEditor();
    });
    on(form, "click", (event) => event.stopPropagation());
    on(form, "keyup", (event) => event.stopPropagation());
    on(form, "submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      submitReply(keyOf(form));
    });
    on(field, "input", () => {
      if (replyState?.key !== keyOf(field)) return;
      replyState.draft = field.value;
      replyState.error = false;
      replyRevision++;
      renderTray();
      layout();
      composerChanged();
    });
    on(field, "focus", () => {
      focusEditor();
      if (setNearby(true)) renderCluster();
    });
    on(field, "blur", editorBlur);
    for (const type of ["select", "keyup", "pointerup", "scroll"]) on(field, type, composerChanged);
    on(field, "keydown", (event) => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeReply();
        renderCluster();
      }
    });
    on(field, "wheel", (event) => {
      // Let a multiline draft scroll before handing the wheel to the task list.
      const canScroll = event.deltaY < 0 ? field.scrollTop > 0 :
        field.scrollTop + field.clientHeight < field.scrollHeight;
      if (canScroll) event.stopPropagation();
    }, { passive: true });
  }

  /** hi(): the editor state that can move a caret, including multiline scroll. */
  const composerReading = (field) =>
    [
      field.value,
      field.selectionStart,
      field.selectionEnd,
      field.selectionDirection,
      field.scrollLeft,
      field.scrollTop
    ].join("\0");

  /** The `follow-up-editor-changed` half of frame 5666: measure, then report. */
  function composerChanged() {
    const field = document.activeElement;
    if (replyState === null || field !== cardFor(replyState.key)?.replyInput) {
      composerClosed();
      return;
    }
    const reading = composerReading(field);
    if (reading === caretReading) return;
    caretReading = reading;
    caretAt = caretPointOf(field);
    paint();
  }

  /** Losing the composer loses the point with it — `G(void 0)` clears `w`. */
  function composerClosed() {
    if (caretAt === null && caretReading === null) return;
    caretAt = null;
    caretReading = null;
    paint();
  }

  /*
   * onChange and onSelect, frame 5776. A value that changed and a caret that
   * moved are the same event as far as the head is concerned, so both arrive
   * here.
   *
   * Four listeners for React's two because `onSelect` is not the DOM event of
   * that name: Chromium fires `select` only when a range is actually selected,
   * and React's own plugin makes up the difference by watching keyup and mouseup
   * as well and firing when the selection reads differently. Which is why
   * composerChanged is gated on the reading rather than on the event — an arrow
   * key that moves the caret is a report, and a modifier that moves nothing is
   * not, whichever listener happens to catch it.
   */
  on(chatInput, "input", composerChanged);
  on(chatInput, "select", composerChanged);
  on(chatInput, "keyup", composerChanged);
  on(chatInput, "pointerup", composerChanged);
  // A non-focusable desktop window can focus a DOM input without receiving any
  // keys. Request native focus only while this editor is being used.
  on(chatInput, "pointerdown", focusEditor);
  on(chatInput, "focus", focusEditor);

  on(chatInput, "keydown", (event) => {
    // The editor has a great many global key handlers and no reason to see a
    // question being typed at the pet, so none of them get it.
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submitChat();
    }
    else if (event.key === "Escape") chatInput.blur();
  });

  // Losing the caret is what lets the cluster close again, and it may already be
  // outside the pet by then.
  on(chatInput, "blur", editorBlur);

  /* ── Talking to the other half ──────────────────────────────────────────
   *
   * `config` and `activity` are the sensor pushing new state;
   * `at` puts the pet back where it was last left, which is how a desktop pet
   * remembers its place across restarts; `reply-result` confirms a send or keeps
   * a failed draft in its card; `bye` is the teardown.
   */

  track(
    host.onMessage((message) => {
      if (message === null || typeof message !== "object") return;

      // While dragging across multiple screens, the window hops between monitors.
      if (message.type === "bettergravity:overlay-display-switched") {
        if (drag !== null && message.bounds && Number.isFinite(message.cursorX) && Number.isFinite(message.cursorY)) {
          const localX = message.cursorX - message.bounds.x;
          const localY = message.cursorY - message.bounds.y;
          drag.x = localX;
          drag.y = localY;
          place(localX - drag.grabX, localY - drag.grabY);
          refresh();
        }
        return;
      }

      // The native window also samples the desktop cursor. This recovers hover
      // and click-through state when Windows stops forwarding mousemove events.
      if (message.type === "bettergravity:overlay-pointer") {
        if (desktop && Number.isFinite(message.x) && Number.isFinite(message.y)) {
          if (drag !== null) {
            drag.samples = prune([...drag.samples, { x: message.x, y: message.y, timeMs: performance.now() }]);
            drag.hasMoved = true;
            drag.x = message.x;
            drag.y = message.y;
            place(message.x - drag.grabX, message.y - drag.grabY);
            refresh();
          } else {
            updatePointer(message.x, message.y);
          }
        }
        return;
      }
      if (message.type === "bettergravity:overlay-context-menu-result") {
        if (message.requestId !== menuRequest?.id) return;
        const request = menuRequest;
        menuRequest = null;
        if (message.unsupported) showPetMenu(request.point);
        else if (message.id === "close-pet") host.send({ t: "hide" });
        return;
      }

      switch (message.t) {
        case "reply-result": {
          if (replyState === null || typeof message.requestId !== "string" ||
              replyState.key !== message.key || replyState.requestId !== message.requestId) break;
          if (message.ok === true) closeReply();
          else {
            replyState.requestId = null;
            replyState.error = true;
            replyRevision++;
          }
          renderCluster();
          break;
        }
        case "config": {
          const before = config;
          config = { ...config, ...message.config };
          if (config.size !== before.size) applySize();
          if (config.sheet !== before.sheet) applySheet();
          renderActivity();
          paint();
          break;
        }
        case "activity": {
          entries = Array.isArray(message.entries) ? message.entries : [];
          working = message.working === true || entries.some((entry) => entry.status === "running");
          renderActivity();
          break;
        }
        case "at": {
          if (Number.isFinite(message.x) && Number.isFinite(message.y)) {
            stopMomentum();
            place(message.x, message.y);
          }
          break;
        }
        case "bye": {
          dispose();
          break;
        }
      }
    })
  );

  function dispose() {
    if (disposed) return;
    disposed = true;

    clearTimeout(frameTimer);
    clearTimeout(momentumTimer);
    clearTimeout(dismissTimer);
    clearTimeout(replyLayoutTimer);
    clearTimeout(badgeClickTimer);
    badgeAnimation?.cancel();
    if (replyFrame !== undefined) cancelAnimationFrame(replyFrame);

    for (const cleanup of cleanups.splice(0)) {
      // One teardown that throws must not strand the rest of them.
      try {
        cleanup();
      } catch {}
    }

    pet.remove();
    tray.remove();
    chat.remove();
    petMenu.remove();
    if (desktop) {
      host.setFocusable?.(false);
      host.setInteractive(false);
    }
  }

  /* ── Waking up ──────────────────────────────────────────────────────────
   *
   * There is no code here for the greeting, and that is the point of it. Codex
   * greets you with a notification rather than an animation — Ti(), native-page
   * 1431 — and the wave is what rr() makes of a notification whose kind is
   * `first-awake`. The sensor puts that card in the list and the pet plays its
   * waving reaction. Any agent starting work preempts the greeting immediately.
   */

  function mount() {
    if (disposed) return;

    document.body.append(pet, tray, chat, petMenu);
    applySheet();
    applySize();

    // Where it was last left, or the bottom-right corner — Codex's own default
    // spot, and on the desktop that corner is the corner of the screen.
    const at = data?.at;
    place(
      Number.isFinite(at?.x) ? at.x : maxX() - VIEWPORT_INSET,
      Number.isFinite(at?.y) ? at.y : maxY() - VIEWPORT_INSET
    );

    renderActivity();

    // Unconditionally, because refresh() only rebuilds when the state changes and
    // a pet that woke up idle has never had a sequence started at all.
    rebuild();

    // The sensor cannot see into this document — on the desktop it is a window in
    // another process with nothing shared but a message channel. This is the only
    // proof it ever gets that the pet is really standing here, and a desktop
    // window that never sends it is treated as a window that never opened.
    host.send({ t: "hello", desktop, width: window.innerWidth, height: window.innerHeight });
  }

  if (document.body !== null) mount();
  else on(document, "DOMContentLoaded", mount, { once: true });
}

export { petSurface };
