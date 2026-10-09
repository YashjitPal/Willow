import React from 'react';
import { FlowLoadingPage } from '@willow/media/FlowLoadingPage';

/**
 * What a tab shows while its page loads: Media's loading page, the one a project opens behind,
 * filling the tab in the theme's black or white. Not for the Media editor, whose own loading page
 * must stay the only animation there.
 */
export const TabLoading: React.FC<{ className?: string }> = ({ className = 'h-full w-full' }) => (
  <div className={`relative isolate ${className}`}>
    <FlowLoadingPage />
  </div>
);

export default TabLoading;
