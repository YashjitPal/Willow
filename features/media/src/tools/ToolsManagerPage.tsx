/**
 * Flow's `flow-applet-manager-page`: "Explore tools", the My Tools / Community / Templates
 * switch, the tab's hero, then its sections.
 *
 * - My Tools: Favorites (once anything is favorited), then My creations — Create New and your
 *   own tools, last opened first.
 * - Community: Spotlight creatives, then Image, Video, Experimental; spotlight order, then name.
 *   Tools you applied to feature lead the spotlight.
 * - Templates: Image, Video, Prompting, Experimental, in Flow's order.
 *
 * Opening a community tool asks first (Flow's preview dialog); opening a template opens your copy
 * of it (the view page makes it). The tab is remembered, not put in the address, as in Flow.
 */
import React from 'react';
import { useStore } from '@nanostores/react';
import { showSnack } from '../scenes/scene-store';
import { CATEGORY_TITLES, communityBySection, templatesBySection, type CarouselSlide } from './catalog';
import { CreateToolCard, ToolCard, type ToolCardActions } from './ToolCard';
import { ToolHeroBanner } from './ToolHeroBanner';
import { createToolLocation, galleryLocation, toolLocation } from './tools-routes';
import {
  $favorites,
  $myCreations,
  $toolPrefs,
  $tools,
  catalogEntry,
  remixTool,
  setActiveTab,
  setToolCover,
  toggleFavorite,
  togglePin,
  toolEntry,
  type ManagerTab,
  type ToolEntry,
} from './tools-store';
import { useToolsUi, type ToolsUi } from './tools-ui';
import { FlowIconButton, FlowToggles } from './ui';
import { useRailDrawer } from '../use-media-viewport';

const TABS: readonly { value: ManagerTab; label: string }[] = [
  { value: 'MY_APPS', label: 'My Tools' },
  { value: 'COMMUNITY', label: 'Community' },
  { value: 'GALLERY', label: 'Templates' },
];

/** Flow's `flow-navigation-header`: the back button and the page's title. */
export const NavigationHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
  <div className="ng-flow-navigation-header">
    <nav className="nav-header">
      <FlowIconButton
        icon="arrow_back"
        label="Back button to go to previous page"
        size="large"
        iconClassName="mat-icon-rtl-mirror"
        className="back-button"
        onClick={onBack}
      />
      <span className="header-title"><span>{title}</span></span>
    </nav>
  </div>
);

/** The card menu's actions, shared by every page that shows cards. */
export function useCardActions(ui: ToolsUi): ToolCardActions {
  return React.useMemo<ToolCardActions>(() => {
    const go = (id: string, mode?: 'APP' | 'EDIT') => ui.host.navigate(toolLocation(ui.host.search, id, { mode, from: 'tools' }));
    return {
      open: (entry) => {
        if (entry.kind !== 'community') { go(entry.id); return; }
        void ui.previewCommunity(entry).then((open) => { if (open) go(entry.id); });
      },
      edit: (entry) => go(entry.id, 'EDIT'),
      setCover: (entry) => { void ui.pickImage(1200).then((cover) => { if (cover) setToolCover(entry.id, cover); }); },
      remix: (entry) => {
        void remixTool(entry.id)
          .then((tool) => {
            showSnack({ icon: 'check_circle', text: 'Tool remixed and added to your gallery.', actions: [{ label: 'Dismiss' }] });
            go(tool.id, 'EDIT');
          })
          .catch(() => showSnack({ icon: 'error', text: 'Failed to remix tool', actions: [{ label: 'Dismiss' }], tone: 'error' }));
      },
      toggleFavorite: (entry) => { toggleFavorite(entry.id); },
      togglePin: (entry) => {
        const pinned = togglePin(entry.id);
        showSnack({ icon: 'check_circle', text: pinned ? 'Pinned to dock' : 'Unpinned from dock', actions: [{ label: 'Dismiss' }] });
      },
      share: (entry) => ui.openShare(entry),
      remove: (entry) => { void ui.confirmDelete(entry); },
    };
  }, [ui]);
}

const Section: React.FC<{ title: string; gallery?: boolean; children: React.ReactNode }> = ({ title, gallery, children }) => (
  <section className="applet-section">
    <h2 className="section-title">{title}</h2>
    <div className={`applet-grid${gallery ? ' applet-grid-gallery' : ''}`}>{children}</div>
  </section>
);

export const ToolsManagerPage: React.FC = () => {
  const ui = useToolsUi();
  const host = ui.host;
  const prefs = useStore($toolPrefs);
  const tools = useStore($tools);
  const myCreations = useStore($myCreations);
  const favorites = useStore($favorites);
  const tab: ManagerTab = prefs.activeTab ?? 'MY_APPS';
  const actions = useCardActions(ui);
  // A phone, upright or on its side, draws Media's rail as a drawer, opened from the header
  // (tools-responsive.css).
  const railAsDrawer = useRailDrawer();
  const contentRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [tab]);

  const createTool = () => host.navigate(createToolLocation(host.search));
  const trySlide = (slide: CarouselSlide) => {
    const entry = slide.toolId ? toolEntry(slide.toolId) : null;
    if (entry) actions.open(entry);
  };
  const card = (entry: ToolEntry, variant: 'default' | 'gallery') => <ToolCard key={entry.id} entry={entry} variant={variant} actions={actions} />;

  let sections: React.ReactNode;
  if (tab === 'MY_APPS') {
    sections = (
      <>
        {favorites.length > 0 && <Section title="Favorites">{favorites.map((e) => card(e, 'default'))}</Section>}
        <Section title="My creations">
          <CreateToolCard onCreate={createTool} />
          {myCreations.map((e) => card(e, 'default'))}
        </Section>
      </>
    );
  } else if (tab === 'GALLERY') {
    sections = templatesBySection().map(({ category, tools: list }) => (
      <Section key={category} title={CATEGORY_TITLES[category]} gallery>{list.map((t) => card(catalogEntry(t), 'gallery'))}</Section>
    ));
  } else {
    const featured = tools
      .filter((t) => t.featuredRequest)
      .sort((a, b) => (b.featuredRequest!.submittedAt - a.featuredRequest!.submittedAt))
      .map((t) => {
        const entry = toolEntry(t.id)!;
        return { ...entry, author: t.featuredRequest!.displayName };
      });
    sections = communityBySection().map(({ category, tools: list }) => (
      <Section key={category} title={CATEGORY_TITLES[category]} gallery>
        {category === 'Spotlight' && featured.map((e) => card(e, 'gallery'))}
        {list.map((t) => card(catalogEntry(t), 'gallery'))}
      </Section>
    ));
  }

  return (
    <div className="ng-flow-applet-manager-page">
      <div className="applet-manager-page">
        <header className="applet-manager-header">
          <div className="header-left-group">
            <NavigationHeader title="Explore tools" onBack={() => host.navigate(galleryLocation(host.search))} />
          </div>
          <div className="header-center-group">
            <FlowToggles className="marketplace-toggles" options={TABS} value={tab} onChange={setActiveTab} />
          </div>
          <div className="header-right-spacer">
            {railAsDrawer && <FlowIconButton icon="menu" label="Open menu" size="large" className="wt-open-nav" onClick={() => host.openNav()} />}
          </div>
        </header>
        <div className="wt-tools-body">
          {host.renderSidebar()}
          <div className="wt-tools-main">
            <div ref={contentRef} className="applet-manager-content">
              <ToolHeroBanner tab={tab} onCreateTool={createTool} onTrySlide={trySlide} />
              {sections}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
