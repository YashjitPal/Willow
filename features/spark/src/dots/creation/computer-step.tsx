import { useInView } from "framer-motion";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { FormattedMessage, useIntl } from "../lib/intl";
import { useReducedMotion } from "../lib/reduced-motion";
import { CheckmarkMdLight20Icon } from "../codex-icons/checkmark-md-light-20";
import { DesktopLight20Icon } from "../codex-icons/desktop-light-20";
import { LaptopLight20Icon } from "../codex-icons/laptop-light-20";
import { Button } from "../codex-ui/button";
import { Switch } from "../codex-ui/switch";
import { defaultOnboardingColor, mockRoundTripMs, useCreationStore, type ComputerAccessMock } from "../state/creation-store";
import { browserAgentCursorAsset } from "./assets/browser-agent-cursor";
import { creationToasts } from "./creation-toasts";
import { DotOnboardingRing, onboardingMotion } from "./dot-onboarding-ring";
import { saveOnboardingColor, useOnboardingColor } from "./onboarding-color-scope";
import { OnboardingCard, OnboardingHeading, OnboardingStepLayout } from "./onboarding-layout";

const css = { visor: "_visor_nvjz7_1", visorBackground: "_visorBackground_nvjz7_41" } as const;

const computerPreview = "/codex/assets/computer-preview-64538a5b8034.png";

type LocalComputerControl = "toggle" | "disabled" | "get-app" | "open-app";

interface ComputerStepProps {
  conversationId?: string | null;
  disabled?: boolean;
  onContinue: () => void;
}

function handoffLeftDeparture() {
  return new Promise<void>((resolve) => {
    const left = () => useCreationStore.getState().handoff?.phase !== "departing";
    if (left()) {
      resolve();
      return;
    }
    const unsubscribe = useCreationStore.subscribe(() => {
      if (!left()) return;
      unsubscribe();
      resolve();
    });
  });
}

/** `va`: saves the chosen color, then hands the ring over to the bot's room before continuing. */
export function ComputerStep({ conversationId = null, disabled = false, onContinue }: ComputerStepProps) {
  const reducedMotion = useReducedMotion();
  const saving = useCreationStore((s) => s.savingColor);

  const handleContinue = async () => {
    if (!(await saveOnboardingColor(conversationId))) return false;
    if (reducedMotion) {
      onContinue();
      return true;
    }
    const { handoff, session, setHandoff } = useCreationStore.getState();
    if (handoff != null) return false;
    setHandoff({ conversationId, color: session.color?.color ?? defaultOnboardingColor, phase: "departing" });
    void handoffLeftDeparture().then(() => {
      const phase = useCreationStore.getState().handoff?.phase;
      if (phase === "flying" || phase === "arrived") onContinue();
    });
    return true;
  };

  return <ComputerAccessGate conversationId={conversationId} disabled={disabled || saving} onContinue={handleContinue} />;
}

interface GateProps {
  conversationId: string | null;
  disabled: boolean;
  onContinue: () => Promise<boolean>;
}

/** `ya`: desktop access needs the executors gate and a desktop host; otherwise the option is disabled. */
function ComputerAccessGate({ conversationId, disabled, onContinue }: GateProps) {
  const access = useCreationStore((s) => s.computerAccess);
  if (conversationId != null && access !== "unavailable" && access !== "get-app" && access !== "open-app") {
    return <DesktopComputerAccess key={conversationId} access={access} disabled={disabled} onContinue={onContinue} />;
  }
  return (
    <ComputerAccessLayout
      disabled={disabled}
      onContinue={() => void onContinue()}
      localComputerEnabled={false}
      desktopAttached={false}
      desktopLoading={false}
      localComputerControl={access === "get-app" || access === "open-app" ? access : "disabled"}
      desktopDisabled
      onDesktopChange={() => {}}
    />
  );
}

interface DesktopConnection {
  connectionStatus: "loading" | "ready";
  accessDisabledByAdmin: boolean | null;
  disabled: boolean;
  error: string | null;
  attached: boolean | null;
  environmentId: string | null;
}

function mockDesktopConnection(access: ComputerAccessMock, environmentsUnavailable: string): DesktopConnection {
  return {
    connectionStatus: access === "loading" ? "loading" : "ready",
    accessDisabledByAdmin: access === "admin-disabled",
    disabled: access === "loading" || access === "error",
    error: access === "error" ? environmentsUnavailable : null,
    attached: access === "loading" ? null : access === "connected",
    environmentId: access === "loading" || access === "error" ? null : "local-environment",
  };
}

async function attachDesktop() {
  await new Promise((resolve) => window.setTimeout(resolve, mockRoundTripMs));
  useCreationStore.setState({ computerAccess: "connected" });
}

/** `ba`: the local computer toggle, backed by the bot's desktop connection (`desktop-connection`). */
function DesktopComputerAccess({ access, disabled, onContinue }: Omit<GateProps, "conversationId"> & { access: ComputerAccessMock }) {
  const intl = useIntl();
  const connection = mockDesktopConnection(
    access,
    intl.formatMessage(
      {
        id: "restricted.aeon.desktopConnection.environmentsUnavailable.productName",
        defaultMessage: "Could not load your {dot}’s computers",
        description: "Error when the agent's existing computers cannot be loaded before changing its desktop connection. bot is a common noun for the agent and must remain untranslated.",
      },
      { dot: "bot" },
    ),
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const continued = useRef(false);
  const loading = connection.connectionStatus === "loading";
  const adminDisabled = connection.accessDisabledByAdmin === true || connection.accessDisabledByAdmin === null;
  const connectable = !connection.disabled && !adminDisabled;
  const toggleable = !adminDisabled && connection.error == null && (connectable || loading);
  const localComputerEnabled = (choice ?? true) && toggleable;

  const handleContinue = async () => {
    if (continued.current || !(await onContinue())) return;
    continued.current = true;
    const report = (result: "success" | "failure") => {
      if (result === "success") {
        creationToasts.success(
          <FormattedMessage
            id="restricted.orbitComputerOnboarding.connectionSucceeded.productName"
            defaultMessage="This computer is connected to your {dot}"
            description="Toast after local computer access connects during onboarding for the user's agent. The bot placeholder is the untranslated term for the user's agent."
            values={{ dot: "bot" }}
          />,
        );
        return;
      }
      creationToasts.danger(
        <FormattedMessage
          id="restricted.orbitComputerOnboarding.connectionUnconfirmedToast.productName"
          defaultMessage="Couldn’t confirm this computer’s access. Check its status in your {dot}."
          description="Toast when local computer access cannot be confirmed after onboarding has entered the agent thread. The bot placeholder is the untranslated term for the user's agent."
          values={{ dot: "bot" }}
        />,
        { errorAnalytics: { toastId: "restricted.orbitComputerOnboarding.connectionUnconfirmedToast" } },
      );
    };
    let result: "success" | "failure" | null = null;
    if (localComputerEnabled) {
      if (connection.attached === true) result = "success";
      else if (connectable && connection.environmentId != null) void attachDesktop().then(() => report("success"), () => report("failure"));
      else result = "failure";
    }
    if (result != null) report(result);
  };

  return (
    <ComputerAccessLayout
      disabled={disabled}
      onContinue={() => void handleContinue()}
      localComputerEnabled={localComputerEnabled}
      desktopAttached={connection.attached === true}
      desktopLoading={connection.error == null && loading}
      localComputerControl={toggleable ? "toggle" : "disabled"}
      desktopDisabled={disabled}
      desktopError={connection.error}
      onDesktopChange={setChoice}
    />
  );
}

interface ComputerAccessLayoutProps {
  disabled: boolean;
  onContinue: () => void;
  localComputerEnabled: boolean;
  desktopAttached: boolean;
  desktopLoading: boolean;
  localComputerControl: LocalComputerControl;
  desktopDisabled: boolean;
  desktopError?: ReactNode;
  onDesktopChange: (checked: boolean) => void;
}

/** `xa`: the computer access step, with an illustrated preview of the bot's own computer. */
function ComputerAccessLayout({
  disabled,
  onContinue,
  localComputerEnabled,
  desktopAttached,
  desktopLoading,
  localComputerControl,
  desktopDisabled,
  desktopError,
  onDesktopChange,
}: ComputerAccessLayoutProps) {
  const color = useOnboardingColor();
  const saving = useCreationStore((s) => s.savingColor);
  const toggleId = useId();
  const previewId = useId();
  const previewRef = useRef<SVGSVGElement>(null);
  const connecting = localComputerEnabled && !desktopAttached;

  let description: ReactNode;
  if (desktopError) {
    description = (
      <span role="alert" className="text-danger">
        {desktopError}
      </span>
    );
  } else if (localComputerControl === "toggle") {
    description = (
      <FormattedMessage
        id="restricted.orbitComputerOnboarding.localAccessDescription"
        defaultMessage="Access files and work on this computer wherever you message your {dot}. This disconnects any other connected desktop"
        description="Explains the scope and replacement effect of granting the bot access to the user's computer during onboarding. Its own cloud computer stays connected. {dot} is the untranslated term for the user's agent."
        values={{ dot: "bot" }}
      />
    );
  } else {
    description = (
      <FormattedMessage
        id="restricted.orbitComputerOnboarding.localDescription"
        defaultMessage="Work with your local files and ChatGPT conversations"
        description="Description of the optional local computer access toggle during bot onboarding."
      />
    );
  }

  const localComputer = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center self-start rounded-xl bg-secondary-soft text-default">
        <LaptopLight20Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${toggleId}-label`} className="block text-base leading-5 text-default">
          <FormattedMessage
            id="restricted.orbitComputerOnboarding.localComputer"
            defaultMessage="Your local computer"
            description="Label for the option to let the bot use the user's computer."
          />
        </span>
        <span id={`${toggleId}-description`} className="block text-xs leading-4.5 text-tertiary">
          {description}
        </span>
      </span>
    </>
  );

  const action = (
    <Button
      className="w-full justify-center"
      color="primary"
      radius="full"
      size="detailAction"
      loading={saving || (connecting && desktopLoading)}
      disabled={disabled}
      onClick={onContinue}
    >
      <FormattedMessage
        id="restricted.orbitComputerOnboarding.continue"
        defaultMessage="Continue"
        description="Continue to the bot after choosing whether to allow access to this computer."
      />
    </Button>
  );

  return (
    <OnboardingStepLayout step="computer">
      <header className="flex flex-col items-center gap-6 text-center">
        <figure data-dot-copy data-dot-computer-preview className="group w-[326px] max-w-full">
          <svg className="w-full overflow-visible drop-shadow-lg" aria-hidden viewBox="-3 -3 332 255">
            <defs>
              <clipPath id={`${previewId}-screen`}>
                <rect x="3" y="3" width="320" height="243" rx="12" />
              </clipPath>
            </defs>
            <rect x="-3" y="-3" width="332" height="255" rx="18" fill={color} />
            <rect width="326" height="249" rx="15" fill="white" />
            <image href={computerPreview} x="-2" y="-1" width="330" height="251" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${previewId}-screen)`} />
            <g clipPath={`url(#${previewId}-screen)`}>
              <PreviewScreen previewRef={previewRef} />
            </g>
            <foreignObject
              x="3"
              y="3"
              width="320"
              height="243"
              className="pointer-events-none opacity-100 transition-opacity duration-[250ms] group-hover:opacity-0 motion-reduce:transition-none"
            >
              <PreviewCursor color={color} previewRef={previewRef} />
            </foreignObject>
          </svg>
          <div aria-hidden className={`${css.visor} text-xs font-medium text-media-foreground`} style={{ "--onboarding-visor-color": color } as CSSProperties}>
            <span className={css.visorBackground} />
            <DotOnboardingRing data-dot-anchor data-dot-departure-color={color} className="size-5 shrink-0" />
            <span className="min-w-0 break-words">
              <FormattedMessage
                id="restricted.orbitComputerOnboarding.preview"
                defaultMessage="{dot}’s computer"
                description="Caption below an illustrated preview of the assistant's own computer. {dot} is the untranslated term for the user's agent."
                values={{ dot: "bot" }}
              />
            </span>
          </div>
        </figure>
        <div data-dot-copy>
          <OnboardingHeading
            wideDescription
            title={
              <FormattedMessage
                id="restricted.orbitComputerOnboarding.title"
                defaultMessage="Choose where your {dot} can work"
                description="Heading on the computer access step. {dot} is the untranslated term for the user's agent."
                values={{ dot: "bot" }}
              />
            }
          >
            <span className="mx-auto block max-w-108">
              <FormattedMessage
                id="restricted.orbitComputerOnboarding.description"
                defaultMessage="Your {dot} has its own computer, but you can also let it use yours. You can change this anytime."
                description="Explains that the assistant has a cloud computer and can optionally use apps on the user's computer. {dot} is the untranslated term for the user's agent."
                values={{ dot: "bot" }}
              />
            </span>
          </OnboardingHeading>
        </div>
      </header>
      <OnboardingCard action={action}>
        <div className="flex flex-col gap-3">
          <div className="flex min-h-10 items-center gap-3 pe-2">
            <span className="flex size-10 shrink-0 items-center justify-center self-start rounded-xl bg-secondary-soft text-default">
              <DesktopLight20Icon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base leading-5 text-default">
                <FormattedMessage
                  id="restricted.orbitComputerOnboarding.cloudComputer"
                  defaultMessage="Your {dot}’s computer"
                  description="Label for the assistant's always-available cloud computer. {dot} is the untranslated term for the user's agent."
                  values={{ dot: "bot" }}
                />
              </p>
              <p className="text-xs leading-4.5 text-tertiary">
                <FormattedMessage
                  id="restricted.orbitComputerOnboarding.cloudDescriptionWithYourDot"
                  defaultMessage="A powerful cloud computer where your {dot} works"
                  description="Description of the assistant's own cloud computer. {dot} is the untranslated term for the user's agent."
                  values={{ dot: "bot" }}
                />
              </p>
            </div>
            <span className="flex w-8 justify-center text-default">
              <CheckmarkMdLight20Icon />
              <span className="sr-only">
                <FormattedMessage
                  id="restricted.orbitComputerOnboarding.alwaysAvailable"
                  defaultMessage="Always available"
                  description="Accessible label for the checkmark indicating the bot's own computer is always available."
                />
              </span>
            </span>
          </div>
          {localComputerControl === "toggle" ? (
            <label className="flex min-h-10 cursor-interaction items-center gap-3 pe-2" htmlFor={toggleId}>
              {localComputer}
              <Switch
                id={toggleId}
                aria-labelledby={`${toggleId}-label`}
                aria-describedby={`${toggleId}-description`}
                checked={localComputerEnabled}
                disabled={desktopDisabled}
                onChange={onDesktopChange}
                tone="neutral"
              />
            </label>
          ) : (
            <div className="flex min-h-10 items-center gap-3 pe-2">
              {localComputer}
              {localComputerControl === "get-app" || localComputerControl === "open-app" ? (
                <Button as="a" href="/codex/open-app?target=dots" target="_blank" rel="noopener noreferrer" color="secondary" size="cardAction" radius="full">
                  {localComputerControl === "open-app" ? (
                    <FormattedMessage
                      id="restricted.orbitComputerOnboarding.openApp"
                      defaultMessage="Open app"
                      description="Link to open the desktop app when this account used it recently."
                    />
                  ) : (
                    <FormattedMessage
                      id="restricted.orbitComputerOnboarding.getApp"
                      defaultMessage="Get app"
                      description="Link to open or download the desktop app during bot onboarding in a browser."
                    />
                  )}
                </Button>
              ) : (
                <Button color="secondary" size="cardAction" radius="full" disabled>
                  <FormattedMessage
                    id="restricted.orbitComputerOnboarding.disabled"
                    defaultMessage="Disabled"
                    description="Status when this computer cannot be connected to the bot during onboarding."
                  />
                </Button>
              )}
            </div>
          )}
        </div>
      </OnboardingCard>
    </OnboardingStepLayout>
  );
}

const currentMinute = () => Math.floor(Date.now() / 60000) * 60000;

/** `TiComponent`: the live clock and app hotspots drawn over the computer preview. */
function PreviewScreen({ previewRef }: { previewRef: RefObject<SVGSVGElement | null> }) {
  const [minute, setMinute] = useState(currentMinute);

  useEffect(() => {
    let timeout: number | undefined;
    const tick = () => {
      window.clearTimeout(timeout);
      if (document.hidden) return;
      const now = Date.now();
      setMinute(Math.floor(now / 60000) * 60000);
      timeout = window.setTimeout(tick, 60000 - (now % 60000));
    };
    timeout = window.setTimeout(tick, 0);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(minute);

  return (
    <g>
      <svg x="137" y="91" width="55" height="19" viewBox="540 480 100 100" preserveAspectRatio="none">
        <image href={computerPreview} width="1694" height="1276" />
      </svg>
      <text x="164" y="107" textAnchor="middle" className="fill-media-background/75 select-none" fontSize="17" fontWeight="400">
        {parts.map((part, index) => (
          <tspan key={index} fontSize={part.type === "dayPeriod" ? "3" : undefined}>
            {part.value}
          </tspan>
        ))}
      </text>
      <svg
        ref={previewRef}
        x="-2"
        y="-1"
        width="330"
        height="251"
        viewBox="0 0 1694 1276"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none"
        aria-hidden="true"
      >
        {Array.from({ length: 15 }, (_, index) => (
          <rect
            key={index}
            className="pointer-events-auto cursor-interaction fill-transparent hover:fill-media-background/10"
            data-preview-hotspot
            x={549.5 + (index % 5) * 121.25}
            y={618.5 + Math.floor(index / 5) * 155.25}
            width="102"
            height={index >= 10 ? 147 : 137}
            rx="15"
          />
        ))}
        {Array.from({ length: 3 }, (_, index) => (
          <rect
            key={index}
            className="pointer-events-auto cursor-interaction fill-transparent hover:fill-media-background/10"
            data-preview-hotspot
            x={736 + index * 78}
            y="1166"
            width="72"
            height="76"
            rx="15"
          />
        ))}
        <g className="opacity-100 transition-opacity duration-[250ms] group-hover:opacity-0 motion-reduce:transition-none">
          <rect className="pointer-events-none fill-media-background/10" data-agent-highlight opacity="0" rx="15" />
        </g>
      </svg>
    </g>
  );
}

const cursorWaypoints: [number, number][] = [
  [0.22, 0.27],
  [0.57, 0.54],
  [0.5, 0.95],
  [0.65, 0.79],
  [0.72, 0.26],
  [0.35, 0.66],
  [0.78, 0.47],
];
const cursorTip: [number, number] = [-7.1, -7.4];
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** `Fi`: a curved cursor path between two waypoints, with the cursor turning along it. */
function cursorFlight(from: [number, number], to: [number, number], width: number, height: number, index: number, previousRotation: number) {
  const dx = (to[0] - from[0]) * width;
  const dy = (to[1] - from[1]) * height;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const side = index % 2 === 0 ? -1 : 1;
  const bend = Math.min(distance * 0.55, Math.min(width, height) * 0.34) * side;
  const control = (along: number, across: number): [number, number] => [
    clamp(from[0] + (dx * along - (dy / distance) * across) / width, 0.12, 0.88),
    clamp(from[1] + (dy * along + (dx / distance) * across) / height, 0.16, 0.86),
  ];
  const c1 = control(0.3, bend);
  const c2 = control(0.72, bend * 0.65);
  let rotation = previousRotation;
  const positions: [number, number][] = [];
  const keyframes = Array.from({ length: 61 }, (_, step) => {
    const t = step / 60;
    const u = 1 - t;
    const x = u ** 3 * from[0] + 3 * u ** 2 * t * c1[0] + 3 * u * t ** 2 * c2[0] + t ** 3 * to[0];
    const y = u ** 3 * from[1] + 3 * u ** 2 * t * c1[1] + 3 * u * t ** 2 * c2[1] + t ** 3 * to[1];
    const tx = (u ** 2 * (c1[0] - from[0]) + 2 * u * t * (c2[0] - c1[0]) + t ** 2 * (to[0] - c2[0])) * width;
    const ty = (u ** 2 * (c1[1] - from[1]) + 2 * u * t * (c2[1] - c1[1]) + t ** 2 * (to[1] - c2[1])) * height;
    const heading = (Math.atan2(ty, tx) * 180) / Math.PI + 134;
    rotation += ((((heading - rotation + 540) % 360) + 360) % 360) - 180;
    const ease = Math.min(t / 0.2, 1);
    const turned = previousRotation + (rotation - previousRotation) * ease * ease * (3 - 2 * ease);
    const flourish = index % 3 === 0 ? side * 110 * Math.sin(t * Math.PI) ** 2 : 0;
    const angle = ((turned + flourish) * Math.PI) / 180;
    const [tipX, tipY] = cursorTip;
    positions.push([x + (tipX * Math.cos(angle) - tipY * Math.sin(angle)) / width, y + (tipX * Math.sin(angle) + tipY * Math.cos(angle)) / height]);
    return { transform: `translate(${(x - 0.5) * 100}%, ${(y - 0.5) * 100}%) rotate(${turned + flourish}deg)` };
  });
  return { keyframes, positions, rotation };
}

/** `Ii`: highlights the hotspot under the cursor tip at each step of the path. */
function highlightKeyframes(positions: [number, number][], frame: SVGForeignObjectElement, preview: SVGSVGElement): Keyframe[] {
  const viewBox = preview.viewBox.baseVal;
  const scale = Math.max(preview.width.baseVal.value / viewBox.width, preview.height.baseVal.value / viewBox.height);
  const offsetX = preview.x.baseVal.value + (preview.width.baseVal.value - viewBox.width * scale) / 2;
  const offsetY = preview.y.baseVal.value + (preview.height.baseVal.value - viewBox.height * scale) / 2;
  const hotspots = Array.from(preview.querySelectorAll<SVGRectElement>("[data-preview-hotspot]"));
  return positions.map(([x, y], index) => {
    const point = new DOMPoint(
      viewBox.x + (frame.x.baseVal.value + x * frame.width.baseVal.value - offsetX) / scale,
      viewBox.y + (frame.y.baseVal.value + y * frame.height.baseVal.value - offsetY) / scale,
    );
    const hotspot = hotspots.find((rect) => rect.isPointInFill(point));
    return {
      offset: index / (positions.length - 1),
      easing: "steps(1, end)",
      opacity: hotspot == null ? 0 : 1,
      x: `${hotspot?.x.baseVal.value ?? 0}px`,
      y: `${hotspot?.y.baseVal.value ?? 0}px`,
      width: `${hotspot?.width.baseVal.value ?? 0}px`,
      height: `${hotspot?.height.baseVal.value ?? 0}px`,
    };
  });
}

const cursorSize = 24;
const cursorGlowVariable = "--browser-agent-cursor-glow-color";

/** `PiComponent`: the bot's cursor wandering between the preview's apps; it pauses while hovered. */
function PreviewCursor({ color, previewRef }: { color: string; previewRef: RefObject<SVGSVGElement | null> }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const inView = useInView(viewportRef);
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    const cursor = cursorRef.current;
    const preview = previewRef.current;
    const frame = viewportElement?.closest("foreignObject");
    const figure = viewportElement?.closest("[data-dot-computer-preview]");
    const highlight = preview?.querySelector("[data-agent-highlight]");
    if (viewportElement == null || cursor == null || frame == null || figure == null || preview == null || highlight == null || !inView) return;

    let waypoint = 0;
    let leg = 0;
    let rotation = 0;
    let timeout: number | undefined;
    let frameRequest: number | undefined;
    let hovered = window.matchMedia("(hover: hover)").matches && figure.matches(":hover");
    let playbackRate = Number(!hovered);
    let movement: Animation | undefined;
    let highlighting: Animation | undefined;

    const canAnimate = () => !document.hidden && !reducedMotion && viewportElement.clientWidth !== 0 && viewportElement.clientHeight !== 0;
    const setRate = (rate: number) => {
      playbackRate = rate;
      movement?.updatePlaybackRate(rate);
      highlighting?.updatePlaybackRate(rate);
    };
    const stopFade = () => {
      if (frameRequest == null) return;
      cancelAnimationFrame(frameRequest);
      frameRequest = undefined;
    };
    const move = () => {
      const { clientWidth, clientHeight } = viewportElement;
      const from = cursorWaypoints[waypoint];
      waypoint = (waypoint + 1) % cursorWaypoints.length;
      leg += 1;
      const to = cursorWaypoints[waypoint];
      const flight = cursorFlight(from, to, clientWidth, clientHeight, leg, rotation);
      rotation = flight.rotation;
      const timing: KeyframeAnimationOptions = {
        duration: 2000 + Math.min(Math.hypot((to[0] - from[0]) * clientWidth, (to[1] - from[1]) * clientHeight), 500),
        easing: onboardingMotion.easeMove,
        fill: "forwards",
      };
      highlighting?.cancel();
      highlighting = highlight.animate(highlightKeyframes(flight.positions, frame, preview), timing);
      movement = cursor.animate(flight.keyframes, timing);
      movement.onfinish = () => {
        cursor.style.transform = String(flight.keyframes.at(-1)?.transform ?? "none");
        movement?.cancel();
        movement = undefined;
        stopFade();
        playbackRate = Number(!hovered);
        if (!hovered && canAnimate()) {
          highlighting?.updatePlaybackRate(1);
          timeout = window.setTimeout(move, 1400);
        }
      };
    };
    const sync = () => {
      if (!canAnimate()) {
        stopFade();
        window.clearTimeout(timeout);
        movement?.pause();
        highlighting?.pause();
        return;
      }
      if (hovered) {
        if (frameRequest == null) {
          setRate(0);
          movement?.pause();
          highlighting?.pause();
        }
      } else if (movement == null) {
        window.clearTimeout(timeout);
        timeout = window.setTimeout(move, 1400);
      } else {
        if (frameRequest == null) setRate(1);
        movement.play();
        highlighting?.play();
      }
    };
    const fadeTo = (target: number) => {
      stopFade();
      window.clearTimeout(timeout);
      if (!canAnimate() || movement == null) {
        playbackRate = target;
        if (target === 1) sync();
        return;
      }
      if (target === 1) {
        setRate(playbackRate);
        movement.play();
        highlighting?.play();
      }
      const follow = () => {
        frameRequest = undefined;
        const opacity = Number.parseFloat(getComputedStyle(frame).opacity);
        setRate(opacity);
        if (opacity !== target && movement != null) frameRequest = requestAnimationFrame(follow);
        else if (target === 0) {
          movement?.pause();
          highlighting?.pause();
        }
      };
      frameRequest = requestAnimationFrame(follow);
    };
    const enter = () => {
      if (!window.matchMedia("(hover: hover)").matches) return;
      hovered = true;
      fadeTo(0);
    };
    const leave = () => {
      if (!hovered) return;
      hovered = false;
      fadeTo(1);
    };
    const observer = new ResizeObserver(() => {
      setViewport({ width: viewportElement.clientWidth, height: viewportElement.clientHeight });
      sync();
    });
    const [startX, startY] = cursorWaypoints[0];
    cursor.style.transform = `translate(${(startX - 0.5) * 100}%, ${(startY - 0.5) * 100}%)`;
    observer.observe(viewportElement);
    document.addEventListener("visibilitychange", sync);
    figure.addEventListener("mouseenter", enter);
    figure.addEventListener("mouseleave", leave);
    return () => {
      window.clearTimeout(timeout);
      stopFade();
      movement?.cancel();
      highlighting?.cancel();
      document.removeEventListener("visibilitychange", sync);
      figure.removeEventListener("mouseenter", enter);
      figure.removeEventListener("mouseleave", leave);
      observer.disconnect();
      setViewport(null);
    };
  }, [inView, reducedMotion, color, previewRef]);

  return (
    <div ref={viewportRef} className="pointer-events-none relative size-full">
      <div ref={cursorRef} className="absolute inset-0">
        {viewport != null && (
          <div aria-hidden="true" style={{ inset: 0, overflow: "hidden", pointerEvents: "none", position: "absolute", zIndex: 20 }}>
            <div
              data-testid="browser-agent-cursor"
              style={{
                height: cursorSize,
                left: 0,
                position: "absolute",
                top: 0,
                transformOrigin: `${cursorSize / 2}px ${cursorSize / 2}px`,
                willChange: "transform",
                width: cursorSize,
                transform: `translate3d(${viewport.width / 2 - cursorSize / 2}px, ${viewport.height / 2 - cursorSize / 2}px, 0) rotate(316deg) scale(1, 1)`,
                opacity: 1,
                filter: "blur(0px)",
              }}
            >
              <div style={{ transform: "translate3d(12px, -2.5px, 0)" }}>
                <img
                  alt=""
                  data-browser-agent-cursor-asset=""
                  data-testid="browser-agent-cursor-asset"
                  draggable={false}
                  height={24}
                  width={23}
                  src={browserAgentCursorAsset}
                  style={
                    {
                      display: "block",
                      [cursorGlowVariable]: color,
                      filter: `drop-shadow(0 0 6px color-mix(in srgb, var(${cursorGlowVariable}) 90%, transparent)) drop-shadow(0 0 15px color-mix(in srgb, var(${cursorGlowVariable}) 48%, transparent))`,
                      transform: "rotate(44deg) scale(1)",
                      transformOrigin: "0 0",
                    } as CSSProperties
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
