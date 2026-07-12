import React from 'react';
import { useAuth } from '../context/AuthContext';
import { getCachedFirstName } from '../lib/displayName';

// Static mirror of CodeWorkspace's idle layout, shown as the Suspense fallback
// while the lazy CodeWorkspace chunk + its default card images load.
// IMPORTANT: geometry (offsets, sizes, fonts) must stay in sync with
// CodeWorkspace so the swap to the real UI is pixel-identical. Heading text is
// rendered for real (it's static/cached) so only the shimmer cards change.
// Must NOT import anything from CodeWorkspace.tsx — that would pull the lazy
// chunk back into the main bundle.
const CATEGORY_LABELS = ['For you', 'Social', 'Finance', 'Productivity', 'SaaS', 'AI Apps'];

export const CodeWorkspaceSkeleton: React.FC = () => {
  const { user, userProfile } = useAuth();
  // Same resolution order as CodeWorkspace's greeting
  const firstName = userProfile?.displayName?.split(' ')[0] || getCachedFirstName() || 'there';

  return (
    <div className="flex h-full w-full bg-[#1c1c1c] overflow-hidden text-sm relative pointer-events-none select-none">
      {/* Heading — real text so the swap to the live component doesn't flash */}
      <div className="absolute top-14 left-0 right-0 flex flex-col items-center justify-center z-10">
        <div className="flex flex-col items-center gap-1.5">
          <h2
            className="text-[#fbfcfe] text-center select-none font-bold antialiased"
            style={{
              fontFamily: '"Plus Jakarta Sans", "Outfit", "Ginto", "ui-sans-serif", "system-ui", "sans-serif"',
              fontSize: '34px',
              lineHeight: '48px',
              letterSpacing: '-0.035em',
              fontWeight: 800
            }}
          >
            Willow Code
          </h2>
          <p
            className="text-[#a1a1aa] text-center font-medium antialiased select-none"
            style={{
              fontFamily: '"Plus Jakarta Sans", "Outfit", "ui-sans-serif", "system-ui", "sans-serif"',
              fontSize: '28px',
              lineHeight: '32px',
              letterSpacing: '-0.28px',
              fontWeight: 500
            }}
          >
            Let's build some apps, {user ? firstName : 'there'}
          </p>

          {/* Category pills — real labels, default category active */}
          <div className="flex items-center gap-5 mt-7 select-none">
            {CATEGORY_LABELS.map((label, i) => (
              <div
                key={label}
                className={`text-[13.5px] font-semibold tracking-normal h-[32px] flex items-center justify-center rounded-full
                  ${i === 0 ? 'bg-white/10 text-white px-5' : 'text-[#81888f] px-2'}`}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom section — shimmer bento cards + prompt box slot */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] z-30">
        <div className="h-8 w-full bg-gradient-to-t from-[#1c1c1c] to-transparent" />

        <div className="px-[14px] pb-[110px]">
          <div className="grid gap-3.5" style={{ gridTemplateColumns: '354px 1fr 1fr' }}>
            {/* Column 1: two small cards + wide card */}
            <div className="flex flex-col gap-3.5 h-[340px]">
              <div className="grid grid-cols-2 gap-3.5 h-[170px]">
                <div className="rounded-[20px] bg-[#27272a]/50 border border-white/5 shadow-md animate-pulse" />
                <div className="rounded-[20px] bg-[#27272a]/50 border border-white/5 shadow-md animate-pulse" />
              </div>
              <div className="h-[156px] rounded-[20px] bg-[#27272a]/50 border border-white/5 shadow-md animate-pulse" />
            </div>
            {/* Columns 2 & 3: tall cards */}
            <div className="h-[340px] rounded-[20px] bg-[#27272a]/50 border border-white/5 shadow-md animate-pulse" />
            <div className="h-[340px] rounded-[20px] bg-[#27272a]/50 border border-white/5 shadow-md animate-pulse" />
          </div>
        </div>

        {/* Prompt box slot — same fixed 136px geometry as the live component */}
        <div className="relative h-[136px] bg-[#1c1c1c]">
          <div className="absolute bottom-0 left-0 right-0 px-[14px] pb-4 max-w-[800px] mx-auto">
            <div className="h-[120px] bg-[#27272a] rounded-[26px] border border-white/5 shadow-lg animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodeWorkspaceSkeleton;
