import { useId, useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { readableTurnError } from './dot-error';

/**
 * Why the bot could not go on, above the composer: what went wrong in a sentence, with Try again when it can, and the
 * provider's own words folded away beneath it.
 */
export function DotTurnError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const { message, detail } = readableTurnError(error);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <div className="spark-dots-detail__error" role="alert">
      <div className="spark-dots-detail__error-row">
        <MaterialSymbol name="error" family="luminous" roundness={100} size={18} weight={340} className="spark-dots-detail__error-icon" />
        <p className="spark-dots-detail__error-text">
          {message}
          {detail && ' '}
          {detail && (
            <button type="button" className="spark-dots-detail__error-toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((shown) => !shown)}>
              {open ? 'Hide details' : 'Details'}
            </button>
          )}
        </p>
        {onRetry && (
          <button type="button" className="spark-dots-detail__error-retry" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
      {detail && open && (
        <pre id={detailId} className="spark-dots-detail__error-detail">
          {detail}
        </pre>
      )}
    </div>
  );
}
