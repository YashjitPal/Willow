import clsx from "clsx";
import { useId, type ReactNode } from "react";

/** `Na1Component`: the scrolling column of the welcome and connectors steps. */
export function OnboardingStepLayout({ step, children, actions }: { step: "welcome" | "connectors" | "computer"; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
        <div className={clsx("m-auto flex w-full max-w-md flex-col gap-8", step === "connectors" ? "py-0" : "py-4")}>
          {children}
          {actions == null ? null : (
            <div data-dot-copy className="flex flex-col gap-3">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** `Ra1Component`: the card of the connectors step, with its action pinned to the bottom. */
export function OnboardingCard({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div data-dot-copy className="w-full max-w-108 shrink-0 self-center overflow-clip rounded-[24px] border border-default bg-surface shadow-card">
      <div className="flex flex-col gap-4 p-3 pb-4">{children}</div>
      <div className="bg-surface px-3 pb-3">{action}</div>
    </div>
  );
}

interface OnboardingHeadingProps {
  titleId?: string;
  title: ReactNode;
  wideDescription?: boolean;
  children: ReactNode;
}

/** `Ia1Component`: the centered step title and description. */
export function OnboardingHeading({ titleId, title, wideDescription = false, children }: OnboardingHeadingProps) {
  return (
    <>
      <h1 id={titleId} className="text-center text-xl leading-7 font-semibold text-default">
        {title}
      </h1>
      <p className={clsx("mx-auto mt-3 text-center text-base leading-5 text-secondary", wideDescription ? "max-w-md" : "max-w-xs")}>{children}</p>
    </>
  );
}

interface OnboardingStatusLayoutProps {
  logo: ReactNode;
  actions?: ReactNode;
  title: ReactNode;
  children: ReactNode;
}

/** `Aa1Component`: the centered avatar with its status copy pinned to the bottom (creating and failed). */
export function OnboardingStatusLayout({ logo, actions, title, children }: OnboardingStatusLayoutProps) {
  const titleId = useId();
  return (
    <section className="relative flex h-full min-h-0 flex-col bg-surface" aria-labelledby={titleId}>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative">
          {logo}
          {actions == null ? null : (
            <div data-dot-copy className="pointer-events-auto absolute inset-x-0 top-full mt-6 flex justify-center">
              {actions}
            </div>
          )}
        </div>
      </div>
      <div className="mt-auto w-full max-w-md self-center p-6 sm:p-8">
        <div data-dot-copy role="status">
          <OnboardingHeading titleId={titleId} title={title}>
            {children}
          </OnboardingHeading>
        </div>
      </div>
    </section>
  );
}
