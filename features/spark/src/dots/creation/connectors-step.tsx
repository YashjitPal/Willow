import { useEffect, useRef, useState, type CSSProperties } from "react";
import { defineMessages, FormattedMessage } from "../lib/intl";
import { useReducedMotion } from "../lib/reduced-motion";
import { calendarLight20 } from "../codex-icons/calendar-light-20";
import { documentLight20 } from "../codex-icons/document-light-20";
import { envelopeLight20, EnvelopeLight20Icon } from "../codex-icons/envelope-light-20";
import { Icon } from "../codex-icons/icon";
import { MsSharepointRegular20Icon } from "../codex-icons/ms-sharepoint-regular-20";
import { personLight20 } from "../codex-icons/person-light-20";
import { slackRegular20 } from "../codex-icons/slack-regular-20";
import { Button } from "../codex-ui/button";
import { ImageWithFallback } from "../codex-ui/image-with-fallback";
import { Spinner } from "../codex-ui/spinner";
import { mockRoundTripMs, useCreationStore, type ConnectorKind, type ConnectorProvider, type ConnectorsMock } from "../state/creation-store";
import { gmailLogoAsset } from "./assets/gmail-logo";
import { OnboardingCard, OnboardingHeading, OnboardingStepLayout } from "./onboarding-layout";
import { OnboardingLogo } from "./onboarding-logo";
import { GoogleCalendarLogo, GoogleContactsLogo, GoogleDriveLogo, MicrosoftOutlookLogo, MicrosoftTeamsLogo } from "./provider-logos";

interface ProviderConnection {
  kind: ConnectorKind;
  name: string;
  /** Connected by installing its plugin; Google Contacts has no plugin and connects through OAuth directly. */
  hasPlugin: boolean;
}

/** `Pa`: the plugins suggested for each mail provider. */
const providerConnections: Record<ConnectorProvider, ProviderConnection[]> = {
  google: [
    { kind: "email", name: "Gmail", hasPlugin: true },
    { kind: "calendar", name: "Google Calendar", hasPlugin: true },
    { kind: "contacts", name: "Google Contacts", hasPlugin: false },
    { kind: "drive", name: "Google Drive", hasPlugin: true },
  ],
  microsoft: [
    { kind: "email", name: "Outlook Email", hasPlugin: true },
    { kind: "calendar", name: "Outlook Calendar", hasPlugin: true },
    { kind: "sharepoint", name: "SharePoint", hasPlugin: true },
    { kind: "teams", name: "Microsoft Teams", hasPlugin: true },
  ],
};

/** `Na`: email and calendar are already connected, so the connectors step can be skipped. */
export function connectorsComplete(connectors: ConnectorsMock) {
  return connectors.status === "ready" && (["email", "calendar"] as const).every((kind) => connectors.connected.includes(kind));
}

const messages = defineMessages({
  emailTitle: { id: "orbit.onboarding.connectors.email", defaultMessage: "Email", description: "Email plugin row label during bot onboarding" },
  emailDescription: {
    id: "orbit.onboarding.connectors.emailDescription.v2",
    defaultMessage: "Stay on top of important emails.",
    description: "Description of the email plugin during bot onboarding",
  },
  calendarTitle: { id: "orbit.onboarding.connectors.calendar", defaultMessage: "Calendar", description: "Calendar plugin row label during bot onboarding" },
  calendarDescription: {
    id: "orbit.onboarding.connectors.calendarDescription.v2",
    defaultMessage: "Be prepared for every meeting.",
    description: "Description of the calendar plugin during bot onboarding",
  },
  contactsTitle: { id: "orbit.onboarding.connectors.contacts", defaultMessage: "Contacts", description: "Google Contacts plugin row label during bot onboarding" },
  contactsDescription: {
    id: "orbit.onboarding.connectors.contactsDescription.brandName",
    defaultMessage: "Let your {productName} know who matters.",
    description: "Description of the Google Contacts plugin. {productName} is the untranslated term for the user's agent.",
  },
  driveTitle: { id: "orbit.onboarding.connectors.drive", defaultMessage: "Drive", description: "Google Drive plugin row label during bot onboarding" },
  driveDescription: {
    id: "orbit.onboarding.connectors.driveDescription.v2",
    defaultMessage: "Work with your docs, sheets and slides.",
    description: "Description of the Google Drive plugin during bot onboarding",
  },
  sharepointTitle: {
    id: "orbit.onboarding.connectors.sharepoint",
    defaultMessage: "SharePoint",
    description: "Microsoft SharePoint plugin row label during bot onboarding",
  },
  sharepointDescription: {
    id: "orbit.onboarding.connectors.sharepointDescription.productName",
    defaultMessage: "Help your {dot} find and use your files",
    description: "Description of the SharePoint plugin. {dot} is the untranslated term for the user's agent.",
  },
  teamsTitle: { id: "orbit.onboarding.connectors.teams", defaultMessage: "Teams", description: "Microsoft Teams plugin row label during bot onboarding" },
  teamsDescription: {
    id: "orbit.onboarding.connectors.teamsDescription.productName",
    defaultMessage: "Give your {dot} context from your conversations",
    description: "Description of the Teams plugin. {dot} is the untranslated term for the user's agent.",
  },
});

const continueWithoutContext = (
  <FormattedMessage
    id="orbit.onboarding.connectors.continueWithoutContext.productName"
    defaultMessage="Continue without giving your {dot} this context"
    description="Creates the user's agent without connecting the recommended plugins. {dot} is the untranslated term for the user's agent."
    values={{ dot: "bot" }}
  />
);

function retryConnectorsLoad() {
  useCreationStore.setState((s) => ({ connectors: { ...s.connectors, status: "checking" } }));
  window.setTimeout(() => useCreationStore.setState((s) => ({ connectors: { ...s.connectors, status: "ready" } })), mockRoundTripMs);
}

interface ConnectorsStepProps {
  connectionFailed: boolean;
  onComplete: () => Promise<void>;
  onConnectionSucceeded: () => void;
}

/** `Po1Component`: suggests connecting the user's mail provider plugins before the bot is created. */
export function ConnectorsStep({ connectionFailed, onComplete, onConnectionSucceeded }: ConnectorsStepProps) {
  const connectors = useCreationStore((s) => s.connectors);
  const [failed, setFailed] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const completingRef = useRef(false);
  const provider = connectors.provider;

  const complete = async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    setCompleting(true);
    try {
      await onComplete();
    } catch {
      completingRef.current = false;
      setCompleting(false);
      setFailed(true);
    }
  };

  const connect = (connection: ProviderConnection) => {
    setFailed(false);
    setConnecting(true);
    window.setTimeout(() => {
      setConnecting(false);
      const { connectors: current } = useCreationStore.getState();
      if (current.connectFails) {
        setFailed(true);
        return;
      }
      useCreationStore.setState({ connectors: { ...current, connected: [...current.connected, connection.kind] } });
      onConnectionSucceeded();
    }, mockRoundTripMs);
  };

  if (connectors.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <p role="alert" className="text-secondary">
          <FormattedMessage
            id="orbit.onboarding.connectors.loadError"
            defaultMessage="We couldn’t load your tools"
            description="Error shown when plugin choices cannot be loaded during bot onboarding"
          />
        </p>
        <Button onClick={retryConnectorsLoad}>
          <FormattedMessage id="orbit.onboarding.connectors.retry" defaultMessage="Retry" description="Retries loading plugin choices during bot onboarding" />
        </Button>
        <Button color="ghost" onClick={() => void complete()}>
          {continueWithoutContext}
        </Button>
      </div>
    );
  }

  if (connectors.status === "checking") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <Spinner className="size-5" />
        <p role="status" className="text-secondary">
          <FormattedMessage
            id="orbit.onboarding.connectors.checkingProvider"
            defaultMessage="Checking your tools"
            description="Status while checking the user's email provider before showing bot plugin setup"
          />
        </p>
        <Button color="ghost" disabled={completing} onClick={() => void complete()}>
          {continueWithoutContext}
        </Button>
      </div>
    );
  }

  const rows = providerConnections[provider].map((connection) => {
    const connected = connectors.connected.includes(connection.kind);
    return { connection, connected, disabledByAdmin: !connected && connectors.disabledByAdmin.includes(connection.kind) };
  });
  const installTarget = rows.find(({ connection, connected, disabledByAdmin }) => connection.hasPlugin && !disabledByAdmin && !connected)?.connection;
  const unconnected = rows.filter(({ connected }) => !connected);
  const oauthTarget =
    unconnected.length === 1 && unconnected[0].connection.kind === "contacts" && !unconnected[0].disabledByAdmin ? unconnected[0].connection : undefined;
  const ready = connectorsComplete(connectors);

  let actionLabel;
  if (ready) {
    actionLabel = (
      <FormattedMessage
        id="orbit.onboarding.connectors.continue"
        defaultMessage="Continue"
        description="Creates the user's bot when there are no provider plugins left to connect"
      />
    );
  } else if (provider === "google") {
    actionLabel = (
      <FormattedMessage
        id="orbit.onboarding.connectors.continueWithGoogle"
        defaultMessage="Continue with Google"
        description="Opens the bundled Google plugin installation and authorization modal"
      />
    );
  } else {
    actionLabel = (
      <FormattedMessage
        id="orbit.onboarding.connectors.continueWithMicrosoft"
        defaultMessage="Continue with Microsoft"
        description="Opens the bundled Microsoft plugin installation and authorization modal"
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" aria-labelledby="dot-connector-title">
      <OnboardingStepLayout step="connectors">
        <header className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex h-56 w-80 max-w-full items-center justify-center">
            <ConnectorOrbit />
            <OnboardingLogo variant="connectors" />
          </div>
          <div data-dot-copy>
            <OnboardingHeading
              titleId="dot-connector-title"
              wideDescription
              title={
                <FormattedMessage
                  id="orbit.onboarding.connectors.title.brandName"
                  defaultMessage="Make your {productName} more helpful"
                  description="Title of the connector setup step in bot onboarding. {productName} is the untranslated term for the user's agent."
                  values={{ productName: "bot" }}
                />
              }
            >
              <FormattedMessage
                id="orbit.onboarding.connectors.suggestionsDescription.dot"
                defaultMessage="Your {dot} has access to your plugins on ChatGPT. Here are a few more that could make it even more useful."
                description="Introduces suggested apps during connector setup. {dot} is the untranslated term for the user's agent."
                values={{ dot: "bot" }}
              />
            </OnboardingHeading>
          </div>
        </header>
        <OnboardingCard
          action={
            <Button
              className="w-full justify-center"
              color="primary"
              radius="full"
              size="detailAction"
              disabled={completing || connecting || (!ready && installTarget == null && oauthTarget == null)}
              onClick={() => {
                if (ready) void complete();
                else if (oauthTarget != null) connect(oauthTarget);
                else if (installTarget != null) connect(installTarget);
              }}
            >
              {actionLabel}
            </Button>
          }
        >
          {rows.some(({ disabledByAdmin }) => disabledByAdmin) && (
            <div className="flex min-h-8 items-center justify-center rounded-lg bg-secondary-soft px-3 py-1.5 text-center text-xs leading-4.5 text-secondary select-none">
              <FormattedMessage
                id="orbit.onboarding.connectors.workspaceDisabledPlugins"
                defaultMessage="Your workspace has disabled some of these plugins"
                description="Notice above the provider plugin list when a workspace admin has disabled one or more plugins, including all of them"
              />
            </div>
          )}
          <div className="flex flex-col gap-3">
            {rows.map(({ connection, connected, disabledByAdmin }) => (
              <div key={connection.kind} className="flex min-h-10 items-center gap-3 pe-2">
                <span className="flex size-10 shrink-0 items-center justify-center self-start rounded-xl bg-secondary-soft">
                  <ConnectorLogo kind={connection.kind} provider={provider} />
                </span>
                <div className="min-w-0 flex-1 select-none">
                  <div className="text-base leading-5 text-default">
                    <FormattedMessage {...messages[`${connection.kind}Title`]} />
                  </div>
                  <div className="text-xs leading-4.5 text-tertiary">
                    <FormattedMessage {...messages[`${connection.kind}Description`]} values={{ productName: "bot", dot: "bot" }} />
                  </div>
                </div>
                <ConnectorStatus connected={connected} disabledByAdmin={disabledByAdmin} loading={false} />
              </div>
            ))}
          </div>
        </OnboardingCard>
        {(connectionFailed || failed) && (
          <p data-dot-copy className="text-center text-xs text-danger" role="alert">
            <FormattedMessage
              id="orbit.onboarding.connectors.connectionFailed"
              defaultMessage="Connection didn’t finish. Try again, or continue without connecting"
              description="Error shown when connecting a bundled provider during bot onboarding fails"
            />
          </p>
        )}
        {!ready && (
          <Button
            data-dot-copy
            className="-mt-5 w-fit max-w-full justify-center self-center text-center"
            color="ghost"
            radius="full"
            size="detailAction"
            disabled={completing || connecting}
            onClick={() => void complete()}
          >
            <span className="whitespace-normal">
              {rows.some(({ connected }) => connected) ? (
                <FormattedMessage
                  id="orbit.onboarding.connectors.continueWithoutAdditionalPlugins"
                  defaultMessage="Continue without connecting additional plugins"
                  description="Creates the user's agent using already connected plugins without connecting any more recommended plugins"
                />
              ) : (
                continueWithoutContext
              )}
            </span>
          </Button>
        )}
      </OnboardingStepLayout>
    </section>
  );
}

/** `Co1Component`. */
function ConnectorLogo({ kind, provider }: { kind: ConnectorKind; provider: ConnectorProvider }) {
  if (provider === "google") {
    if (kind === "email") return <ImageWithFallback className="size-5" alt="" src={gmailLogoAsset} fallback={<EnvelopeLight20Icon />} />;
    if (kind === "calendar") return <GoogleCalendarLogo className="size-5" aria-hidden />;
    if (kind === "contacts") return <GoogleContactsLogo className="size-5" aria-hidden />;
    return <GoogleDriveLogo className="size-5" aria-hidden />;
  }
  if (kind === "email" || kind === "calendar") return <MicrosoftOutlookLogo className="size-5" aria-hidden />;
  if (kind === "sharepoint") return <MsSharepointRegular20Icon />;
  return <MicrosoftTeamsLogo className="size-5" aria-hidden />;
}

/** `Fo1Component`. */
function ConnectorStatus({ connected, disabledByAdmin, loading }: { connected: boolean; disabledByAdmin: boolean; loading: boolean }) {
  if (disabledByAdmin) {
    return (
      <span className="shrink-0 text-xs leading-4.5 text-secondary select-none">
        <FormattedMessage
          id="orbit.onboarding.connectors.disabledByAdmin"
          defaultMessage="Disabled"
          description="Status for a provider plugin disabled by the user's workspace admin during bot onboarding"
        />
      </span>
    );
  }
  if (connected) {
    return (
      <span className="shrink-0 text-xs leading-4.5 text-secondary select-none">
        <FormattedMessage
          id="orbit.onboarding.connectors.connected"
          defaultMessage="Connected"
          description="Status for a plugin that is already connected during bot onboarding"
        />
      </span>
    );
  }
  return loading ? <Spinner className="size-4" /> : null;
}

const orbitIcons = [envelopeLight20, calendarLight20, personLight20, documentLight20, slackRegular20];

/** `Va`: a point on the tilted elliptical orbit around the avatar. */
function orbitFrame(progress: number) {
  const angle = progress * Math.PI * 2;
  const x = 114 * Math.cos(angle);
  const y = 68 * Math.sin(angle);
  const depth = (Math.sin(angle) + 1) / 2;
  const tiltedX = x * 0.978 + y * 0.208;
  const lean = (8 * tiltedX) / Math.hypot(111.492, 14.144);
  return {
    transform: `translate3d(${tiltedX}px, ${y * 0.978 - x * 0.208}px, 0) scale(${0.82 + depth * 0.18}) rotate(${lean}deg)`,
    transformOrigin: "center",
    opacity: 0.5 + depth * 0.4,
  };
}

/** `HaComponent`: app icons orbiting the avatar. */
function ConnectorOrbit() {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion) return;
    const animations = Array.from(ref.current?.children ?? []).map((icon, index) =>
      icon.animate(
        Array.from({ length: 181 }, (_, step) => orbitFrame(index / orbitIcons.length + step / 180)),
        { duration: 32000, iterations: Infinity, easing: "linear" },
      ),
    );
    const sync = () => {
      for (const animation of animations) {
        if (document.hidden) animation.pause();
        else animation.play();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      for (const animation of animations) animation.cancel();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reducedMotion]);

  return (
    <div ref={ref} data-dot-copy aria-hidden className="pointer-events-none absolute inset-0">
      {orbitIcons.map((asset, index) => (
        <span
          key={index}
          className="absolute top-1/2 left-1/2 -ms-5 -mt-5 flex size-10 items-center justify-center rounded-xl border border-subtle bg-surface text-secondary shadow-sm"
          style={orbitFrame(index / orbitIcons.length) as CSSProperties}
        >
          <Icon asset={asset} />
        </span>
      ))}
    </div>
  );
}
