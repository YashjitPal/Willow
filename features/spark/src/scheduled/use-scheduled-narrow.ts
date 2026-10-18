import { useEffect, useState } from 'react';

/** Below 960px Gemini's Scheduled tab turns its pane into a sheet and its composer into the mobile one. */
export const SCHEDULED_NARROW_QUERY = '(max-width: 959.98px)';

export const useScheduledNarrow = (): boolean => {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(SCHEDULED_NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(SCHEDULED_NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
};
