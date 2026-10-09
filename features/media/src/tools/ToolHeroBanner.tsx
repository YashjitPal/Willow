/**
 * Flow's `flow-applet-hero-banner`: the picture across the top of each Tools tab.
 *
 * - Templates: "Build all the tools you can imagine." with Create tool.
 * - My Tools: "Submit your tool to be featured".
 * - Community: the carousel of featured tools — the "Submit your tool" slide, then one per
 *   spotlight tool with its icon, makers and a "Try …" button. A slide holds for 6s (its dash
 *   fills over the same time), then the next one replaces it at once; a dash jumps to its slide.
 */
import React from 'react';
import { BANNERS, COMMUNITY_SLIDES, type CarouselSlide } from './catalog';
import type { ManagerTab } from './tools-store';
import { FlowButton } from './ui';

const SLIDE_MS = 6000;

const STATIC: Record<'GALLERY' | 'MY_APPS', { image: string; title: string; subtitle: string }> = {
  GALLERY: {
    image: BANNERS.templates,
    title: 'Build all the tools you can imagine.',
    subtitle: 'An idea and a description are all it takes to make whatever tool you need.',
  },
  MY_APPS: {
    image: BANNERS.myTools,
    title: 'Submit your tool to be featured',
    subtitle: "Each week we share a handful of the community's most exciting new tools for everyone to use. Submit yours today!",
  },
};

const authorLine = (slide: CarouselSlide): string => `by ${slide.author ?? ''}`;

const CommunityCarousel: React.FC<{ onTry: (slide: CarouselSlide) => void }> = ({ onTry }) => {
  const slides = COMMUNITY_SLIDES;
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (slides.length <= 1) return undefined;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [index, slides.length]);
  const slide = slides[index % slides.length]!;
  const isTool = !!slide.toolName;
  return (
    <div className="banner community-carousel-banner">
      <img className="banner-image" src={slide.background} alt="" draggable={false} />
      <div className="banner-overlay community-carousel-overlay">
        <div className="community-banner-top">
          <h1 className="hero-title">{slide.title}</h1>
          <p className="hero-subtitle">{slide.subtitle}</p>
        </div>
        <div className="community-banner-bottom">
          <div className="community-banner-bottom-content">
            <div className="community-banner-bottom-left">
              {isTool && (
                <div className="community-tool-info">
                  <img className="community-tool-thumbnail" src={slide.toolIcon} alt="" draggable={false} />
                  <div className="community-tool-details">
                    <span className="community-tool-name">{slide.toolName}</span>
                    <div className="community-author-row">
                      <div className="community-author-avatars">
                        {(slide.avatars ?? []).map((src) => <img key={src} className="community-author-avatar" src={src} alt="" draggable={false} />)}
                      </div>
                      <span className="community-author-name">{authorLine(slide)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {isTool && (
              <div className="community-banner-bottom-right">
                <FlowButton variant="secondary" size="medium" className="hero-cta-button community-cta-button" onClick={() => onTry(slide)}>
                  {slide.cta}
                </FlowButton>
              </div>
            )}
          </div>
          <div className="community-carousel-indicators" role="tablist" aria-label="Community banner slides">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                className={`carousel-indicator-dash${i === index ? ' active' : ''}`}
                aria-selected={i === index}
                aria-label={`Slide ${i + 1}`}
                onClick={() => setIndex(i)}
              >
                {i === index && <div key={`${s.id}-${index}`} className="carousel-indicator-progress" style={{ animationDuration: `${SLIDE_MS}ms` }} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ToolHeroBanner: React.FC<{ tab: ManagerTab; onCreateTool: () => void; onTrySlide: (slide: CarouselSlide) => void }> = ({ tab, onCreateTool, onTrySlide }) => {
  if (tab === 'COMMUNITY') {
    return (
      <div className="ng-flow-applet-hero-banner">
        <CommunityCarousel onTry={onTrySlide} />
      </div>
    );
  }
  const hero = STATIC[tab];
  return (
    <div className="ng-flow-applet-hero-banner">
      <div className="banner">
        <img className="banner-image" src={hero.image} alt="" draggable={false} />
        <div className="banner-overlay">
          <div className="hero-content">
            <h1 className="hero-title">{hero.title}</h1>
            <p className="hero-subtitle">{hero.subtitle}</p>
            {tab === 'GALLERY' && (
              <FlowButton variant="secondary" size="medium" className="hero-cta-button" onClick={onCreateTool}>
                Create tool
              </FlowButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
