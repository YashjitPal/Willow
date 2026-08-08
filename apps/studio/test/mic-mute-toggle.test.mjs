/**
 * The live-mode mic mute: the slash geometry, the extracted colour ramp, and the
 * wiring that makes the button actually gate the mic.
 *
 * The slash is checked by re-deriving it from ChatGPT's own sprite path commands
 * rather than by comparing against numbers copied out of the component. Its
 * `#ee832a` symbol opens with
 *
 *   M2.35 2.352 a.8.8 0 0 1 1.132 0 l14.167 14.166 a.8.8 0 0 1-1.132 1.131
 *
 * whose two quarter-arcs are the halves of a round cap, so each cap centre is the
 * point equidistant (r = 0.8) from that arc's endpoints. This recomputes those
 * centres and requires the component's endpoints to land on them — which is what
 * makes it a check of the extraction rather than a restatement of it.
 *
 * The rest reads the three sources as text, the convention in this directory,
 * since Node cannot import `.tsx` and a React tree is not what is under test —
 * the connections between the pieces are.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const read = (relative) =>
  fs.readFileSync(path.resolve(import.meta.dirname, '../../..', relative), 'utf8');

const slash = read('features/chat/src/composer/MicMutedSlash.tsx');
const composer = read('features/chat/src/composer/Composer.tsx');
const chatView = read('features/chat/src/ChatView.tsx');
const live = read('platform/ai/src/live.ts');

/** `x1={2.916}` -> 2.916 */
const attr = (source, name) => {
  const match = source.match(new RegExp(`${name}=\\{([-\\d.]+)\\}`));
  assert.ok(match, `${name} not found`);
  return Number(match[1]);
};

describe('muted mic slash geometry', () => {
  const SPRITE_RADIUS = 0.8;
  // The `M` point and the `l` delta, verbatim from the sprite path above.
  const arcStart = { x: 2.35, y: 2.352 };
  const arcEnd = { x: arcStart.x + 1.132, y: arcStart.y };
  const lineDelta = { x: 14.167, y: 14.166 };

  /**
   * Centre of the circle of radius `r` through both points, on the side the arc's
   * sweep flag picks: the chord midpoint pushed along the chord normal by the
   * remaining leg of the radius. Two such circles exist, mirrored across the
   * chord, and `sign` selects between them.
   */
  const capCentre = (a, b, r, sign) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const chord = Math.hypot(dx, dy);
    const leg = Math.sqrt(r * r - (chord / 2) ** 2);
    return {
      x: (a.x + b.x) / 2 + (sign * -dy * leg) / chord,
      y: (a.y + b.y) / 2 + (sign * dx * leg) / chord,
    };
  };

  it('places the caps where the sprite arcs put them', () => {
    // First cap: the arc from `M` to `M + 1.132`, bulging away from the bar.
    const first = capCentre(arcStart, arcEnd, SPRITE_RADIUS, 1);
    // Second cap: the same arc translated by the `l` command.
    const second = {
      x: first.x + lineDelta.x,
      y: first.y + lineDelta.y,
    };

    assert.ok(Math.abs(attr(slash, 'x1') - first.x) < 0.001, `x1 ${attr(slash, 'x1')} vs ${first.x}`);
    assert.ok(Math.abs(attr(slash, 'y1') - first.y) < 0.001, `y1 ${attr(slash, 'y1')} vs ${first.y}`);
    assert.ok(Math.abs(attr(slash, 'x2') - second.x) < 0.001, `x2 ${attr(slash, 'x2')} vs ${second.x}`);
    assert.ok(Math.abs(attr(slash, 'y2') - second.y) < 0.001, `y2 ${attr(slash, 'y2')} vs ${second.y}`);
  });

  it('is a round-capped bar of the sprite arc diameter', () => {
    assert.equal(attr(slash, 'strokeWidth'), SPRITE_RADIUS * 2);
    assert.match(slash, /strokeLinecap="round"/);
    // Same 20x20 box as the sprite symbol, so the bar spans the glyph the way it
    // does upstream instead of being scaled into a different frame.
    assert.match(slash, /viewBox="0 0 20 20"/);
  });

  it('inherits the button colour instead of hardcoding one', () => {
    assert.match(slash, /stroke="currentColor"/);
    // Decorative: the button's own aria-label already states mute state.
    assert.match(slash, /aria-hidden="true"/);
  });
});

describe('composer mic button in live mode', () => {
  it('only becomes a mute toggle while a live session is up', () => {
    const match = composer.match(/const isMicMuteToggle = ([^;]+);/);
    assert.ok(match, 'isMicMuteToggle not found');
    assert.match(match[1], /\bliveActive\b/);
    // Gated on the handler too, so a caller that opts into live mode without
    // wiring mute keeps dictation rather than getting a dead button.
    assert.match(match[1], /onToggleLiveMicMute/);
  });

  it('routes the click to mute, not dictation, while live', () => {
    assert.match(
      composer,
      /onClick=\{isMicMuteToggle \? handleToggleLiveMicMute : handleToggleDictation\}/,
    );
  });

  it('plays the earcon for the direction the toggle is heading', () => {
    // `!liveMicMuted` is where it is going, not where it is: muting plays the
    // falling release tone, unmuting the rising one.
    assert.match(composer, /playMicToggleEarcon\(!liveMicMuted\)/);
    assert.match(composer, /import \{ playMicToggleEarcon \} from '\.\/mic-earcon'/);
  });

  it('overlays the slash rather than swapping the icon', () => {
    assert.match(composer, /import \{ MicMutedSlash \} from '\.\/MicMutedSlash'/);
    assert.match(composer, /\{isMicMuteToggle && liveMicMuted && \(\s*<MicMutedSlash/);
    // The mic glyph itself is untouched, so it still renders when muted.
    assert.match(composer, /name="mic"/);
  });

  it('recolours only when muted, on the extracted ramp', () => {
    // Measured off ChatGPT's own button: bg-red-500!/hover:bg-red-400!/
    // active:bg-red-600! resolve to these three, glyph white dimming to #cdcdcd.
    assert.match(composer, /bg-\[#ff002a\]/);
    assert.match(composer, /hover:bg-\[#fa423e\]/);
    assert.match(composer, /active:bg-\[#ba2623\]/);
    assert.match(composer, /hover:text-\[#cdcdcd\]/);
    // 200ms cubic-bezier(0.4, 0, 0.2, 1), colours only.
    assert.match(composer, /transition-colors duration-200 ease-\[cubic-bezier\(0\.4,0,0\.2,1\)\]/);
  });

  it('announces mute state to assistive tech', () => {
    assert.match(composer, /aria-pressed=\{isMicMuteToggle \? liveMicMuted : undefined\}/);
    assert.match(composer, /"Turn on microphone" : "Turn off microphone"/);
  });

  it('suppresses the dictation ripple and stop-square while muting', () => {
    assert.match(composer, /\{isMicRippling && !isMicMuteToggle &&/);
    assert.match(composer, /\{isDictationActive && chatVariant && !isMicMuteToggle \?/);
  });
});

describe('mute wiring', () => {
  it('mutes at the track, keeping the socket and its timeline alive', () => {
    assert.match(
      live,
      /setMicMuted\(muted: boolean\): void \{\s*this\.micMuted = muted;\s*this\.micStream\?\.getAudioTracks\(\)\.forEach\(\(t\) => \{ t\.enabled = !muted; \}\);/,
    );
  });

  it('re-applies a mute the mic stream did not exist for yet', () => {
    // Covers both a mute chosen between start() and mic acquisition, and the
    // fresh stream a reconnect builds on the same session.
    assert.match(live, /if \(this\.micMuted\) this\.setMicMuted\(true\);/);
  });

  it('seeds a newly opened session from the current mute', () => {
    assert.match(chatView, /session\.setMicMuted\(micMutedRef\.current\);/);
    // A ref, not the state, so a mute press does not change openLiveSession's
    // identity and reconnect the socket.
    assert.match(chatView, /micMutedRef\.current = isMicMuted/);
  });

  it('drives the session from the toggle', () => {
    // The toggle only flips the flag; an effect reaches the session, so the state
    // updater stays pure under StrictMode's double invoke and two presses inside
    // one render still net out.
    assert.match(chatView, /setIsMicMuted\(\(prev\) => !prev\)/);
    assert.match(chatView, /liveSessionRef\.current\?\.setMicMuted\(isMicMuted\)/);
    assert.match(chatView, /liveMicMuted=\{isMicMuted\}/);
    assert.match(chatView, /onToggleLiveMicMute=\{handleToggleMicMute\}/);
  });

  it('clears mute on every path that ends the session', () => {
    // Mute is per-session, not a preference, so re-entering voice mode listens.
    const clears = chatView.match(/setIsMicMuted\(false\)/g) ?? [];
    assert.ok(clears.length >= 3, `expected stop + onError + onClose, saw ${clears.length}`);
  });
});
