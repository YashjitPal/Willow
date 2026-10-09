import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { useIntl } from 'react-intl';
import { Tooltip } from '../../../codex/ui/tooltip';
import { DotAvatar } from './character';
import { dotName } from './dot-identity';
import type { Dot } from './state/dot-store';

export interface DotFacepileProps {
  dots: readonly Dot[];
  /** Characters drawn before the rest collapse into "+n". */
  max?: number;
  size?: number;
  className?: string;
  /** Names the dots in a tooltip; off inside a control that has its own. */
  withTooltip?: boolean;
}

/** The characters of the bots on a Page, overlapping like collaborators in Google Docs. */
export function DotFacepile({ dots, max = 4, size = 24, className, withTooltip = true }: DotFacepileProps) {
  const intl = useIntl();
  if (dots.length === 0) return null;
  const shown = dots.slice(0, max);
  const extra = dots.length - shown.length;
  const names = intl.formatList(dots.map(dotName), { type: 'conjunction' });
  const facepile = (
    <span role="img" aria-label={names} className={clsx('ws-dot-facepile', className)} style={{ '--ws-dot-size': `${size}px` } as CSSProperties}>
      {shown.map((dot) => (
        <span key={dot.conversationId} className="ws-dot-facepile__item">
          <DotAvatar className="ws-dot-facepile__avatar" identity={dot.conversationId} animated={false} />
        </span>
      ))}
      {extra > 0 ? <span className="ws-dot-facepile__more">+{extra}</span> : null}
    </span>
  );
  if (!withTooltip) return facepile;
  return (
    <Tooltip tooltipContent={names} triggerAsChild={false} className="inline-flex">
      {facepile}
    </Tooltip>
  );
}
