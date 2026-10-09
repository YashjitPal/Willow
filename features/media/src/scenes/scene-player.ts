// Plays a scene onto a <canvas>, clip by clip, the way Flow's `video-canvas` does.
//
// Each clip gets its own <video>, in the page but invisible. The active one plays and is drawn
// every frame, cover-cropped to the scene's aspect ratio; the next one is parked on its first
// frame so the cut to it is a swap rather than a load. The scene's clock is the active video's
// own time mapped through the clip trims, so audio and picture never drift apart.
import { atom } from 'nanostores';
import { clipStarts, locateTime, type ClipSpan } from './scene-format';

/**
 * A cut made only as it comes holds a frame: the incoming clip's <video> moves on some time after
 * play(). Chrome suspends paused <video>s (all of them at once past eight idle, as a 10-clip scene
 * has), and one played from suspension showed its next frame up to 190ms late. So half a second
 * before the cut the next clip is seeked, which resumes it, and it starts a tick or two early, so
 * it is running when the cut comes.
 */
const CUT_WAKE_SECONDS = 0.5;
const CUT_LEAD_SECONDS = 0.04;

export interface PlayerClip extends ClipSpan {
  id: string;
  url?: string;
}

/** Everything but the playhead (`$time`), which changes every frame while playing. */
export interface PlayerState {
  duration: number;
  playing: boolean;
  muted: boolean;
  loop: boolean;
  /**
   * True once the canvas has painted a frame; the editor shows the scene's poster until then.
   * A seek never clears it: mid-seek the canvas keeps its last frame, and putting the poster
   * back would freeze the picture over a scene that is still playing.
   */
  ready: boolean;
}

export class ScenePlayer {
  readonly $state = atom<PlayerState>({ duration: 0, playing: false, muted: false, loop: true, ready: false });
  /**
   * The playhead, in its own store: it moves every frame while playing. Subscribe to it only from
   * what draws it (the timecode, the timeline's playhead), never from the editor as a whole, or the
   * whole editor renders every frame and playback stutters.
   */
  readonly $time = atom(0);
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private clips: PlayerClip[] = [];
  private videos = new Map<string, HTMLVideoElement>();
  private videoHost: HTMLDivElement | null = null;
  /** The next clip's <video>, woken CUT_WAKE_SECONDS ahead of the cut. */
  private woken: HTMLVideoElement | null = null;
  /** The next clip's <video>, started CUT_LEAD_SECONDS ahead of the cut. */
  private leading: HTMLVideoElement | null = null;
  /**
   * A clip with no video (its file is missing, or an edit is replacing it) has no <video> clock
   * to follow: it plays as black for its length on the wall clock, from `at` and source time `from`.
   */
  private gap: { at: number; from: number } | null = null;
  private active = -1;
  private raf = 0;
  private aspect: '16:9' | '9:16' = '16:9';

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.mountVideos(canvas?.parentElement ?? null);
    this.resizeCanvas();
    this.draw();
  }

  /**
   * Puts the clips' <video>s in the page, beside the canvas: 2px each, side by side rather than
   * stacked, and all but transparent. Chrome steps a video the compositor doesn't draw (one in no
   * document) on a background timer rather than with the display, so drawn from there a 24fps
   * clip lost or doubled a frame every few hundred ms (gaps of 83-133ms where 50 is the most a
   * 24fps clip leaves on a 60Hz screen). In the page they arrive evenly.
   */
  private mountVideos(parent: HTMLElement | null): void {
    if (!parent) {
      this.videoHost?.remove();
      this.videoHost = null;
      return;
    }
    if (!this.videoHost) {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:absolute;left:0;top:0;display:flex;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:1';
      this.videoHost = host;
    }
    if (this.videoHost.parentElement !== parent) parent.appendChild(this.videoHost);
    for (const v of this.videos.values()) if (v.parentElement !== this.videoHost) this.videoHost.appendChild(v);
  }

  setAspect(aspect: '16:9' | '9:16'): void {
    this.aspect = aspect;
    this.resizeCanvas();
    this.draw();
  }

  /** Flow's canvas is 1920x1080 (or its portrait twin) and scales down with object-fit. */
  private resizeCanvas(): void {
    if (!this.canvas) return;
    const [w, h] = this.aspect === '9:16' ? [1080, 1920] : [1920, 1080];
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  setClips(clips: PlayerClip[]): void {
    this.cancelLeading();
    this.clips = clips;
    const keep = new Set(clips.map((c) => c.id));
    for (const [id, v] of this.videos) {
      if (!keep.has(id)) {
        v.pause();
        v.removeAttribute('src');
        v.load();
        v.remove();
        this.videos.delete(id);
      }
    }
    for (const clip of clips) {
      let v = this.videos.get(clip.id);
      if (!v) {
        v = document.createElement('video');
        v.playsInline = true;
        v.preload = 'auto';
        v.muted = this.$state.get().muted;
        v.style.cssText = 'flex:none;width:2px;height:2px';
        v.addEventListener('loadeddata', () => this.onLoaded(clip.id));
        v.addEventListener('seeked', () => this.draw());
        this.videos.set(clip.id, v);
        this.videoHost?.appendChild(v);
      }
      if (clip.url && v.getAttribute('data-src') !== clip.url) {
        v.setAttribute('data-src', clip.url);
        v.src = clip.url;
      }
    }
    const duration = clipStarts(clips).total;
    const time = Math.min(this.$time.get(), duration);
    this.patch({ duration });
    this.setTime(time);
    this.active = -1;
    this.seek(time);
  }

  private onLoaded(clipId: string): void {
    const loc = locateTime(this.clips, this.$time.get());
    if (!loc) return;
    const clip = this.clips[loc.index];
    if (clip.id === clipId) {
      const v = this.videos.get(clipId);
      if (v && Math.abs(v.currentTime - loc.sourceTime) > 0.05) v.currentTime = loc.sourceTime;
      this.draw();
    }
  }

  private patch(p: Partial<PlayerState>): void {
    const state = this.$state.get();
    // A patch that changes nothing would still hand every subscriber a new state to render.
    if ((Object.keys(p) as (keyof PlayerState)[]).every((k) => state[k] === p[k])) return;
    this.$state.set({ ...state, ...p });
  }

  private setTime(t: number): void {
    if (this.$time.get() !== t) this.$time.set(t);
  }

  private videoAt(index: number): HTMLVideoElement | undefined {
    const clip = this.clips[index];
    return clip ? this.videos.get(clip.id) : undefined;
  }

  /**
   * Parks the clip after `index` on its first frame. With one clip and loop on, "next" is the
   * clip itself, and parking it would undo every seek made while paused.
   */
  private preloadNext(index: number): void {
    const next = this.clips[index + 1] ?? (this.$state.get().loop ? this.clips[0] : undefined);
    if (!next || next.id === this.clips[index]?.id) return;
    const v = this.videos.get(next.id);
    if (v && v.paused && Math.abs(v.currentTime - next.trimStart) > 0.05) v.currentTime = next.trimStart;
  }

  /** The clip that plays after `index`: the first again at the end with loop on, else none (-1). */
  private nextIndexOf(index: number): number {
    const next = index + 1 < this.clips.length ? index + 1 : this.$state.get().loop ? 0 : -1;
    return next === index ? -1 : next;
  }

  /** Where in its source the active clip is: its <video>'s time, or a gap's wall clock. */
  private sourceTimeOf(clip: PlayerClip, v: HTMLVideoElement): number {
    if (clip.url) return v.currentTime;
    if (!this.gap) {
      const { starts } = clipStarts(this.clips);
      this.gap = { at: performance.now(), from: clip.trimStart + Math.max(0, this.$time.get() - (starts[this.active] ?? 0)) };
    }
    return this.gap.from + (performance.now() - this.gap.at) / 1000;
  }

  /** Seeks the clip after `index` on its first frame: a seek resumes a suspended <video>. */
  private wakeNext(index: number): void {
    const nextIndex = this.nextIndexOf(index);
    const v = nextIndex < 0 ? undefined : this.videoAt(nextIndex);
    if (!v || !this.clips[nextIndex].url || v === this.woken || !v.paused) return;
    this.woken = v;
    // Chrome skips a seek to the time a paused <video> is already at, suspended or not, so it
    // goes a millisecond on: the same frame.
    const parked = this.clips[nextIndex].trimStart;
    v.currentTime = Math.abs(v.currentTime - parked) < 0.0005 ? parked + 0.001 : parked;
  }

  /** Starts the clip after `index` just ahead of the cut, once it is parked on its first frame. */
  private leadNext(index: number): void {
    const nextIndex = this.nextIndexOf(index);
    if (nextIndex < 0) return;
    const v = this.videoAt(nextIndex);
    const clip = this.clips[nextIndex];
    if (!v || !clip.url || v === this.leading || !v.paused || Math.abs(v.currentTime - clip.trimStart) > 0.05) return;
    void v.play().catch(() => undefined);
    this.leading = v;
  }

  /** At the cut: whether `v` is already running from leadNext. */
  private takeLeading(v: HTMLVideoElement): boolean {
    if (v !== this.leading) return false;
    this.leading = null;
    return true;
  }

  /** A lead the playhead won't follow (a pause, a seek, new clips): stopped and parked again. */
  private cancelLeading(): void {
    const v = this.leading;
    if (!v) return;
    this.leading = null;
    v.pause();
    for (const [id, video] of this.videos) {
      if (video !== v) continue;
      const clip = this.clips.find((c) => c.id === id);
      if (clip) v.currentTime = clip.trimStart;
    }
  }

  seek(time: number): void {
    const { duration } = this.$state.get();
    const t = Math.min(Math.max(0, time), duration);
    const loc = locateTime(this.clips, t);
    this.cancelLeading();
    this.woken = null;
    this.gap = null;
    this.setTime(t);
    if (!loc) { this.draw(); return; }
    const wasPlaying = this.$state.get().playing;
    if (loc.index !== this.active) {
      this.videoAt(this.active)?.pause();
      this.active = loc.index;
    }
    const v = this.videoAt(loc.index);
    if (v) {
      if (Math.abs(v.currentTime - loc.sourceTime) > 0.01) v.currentTime = loc.sourceTime;
      if (wasPlaying) void v.play().catch(() => undefined);
    }
    this.preloadNext(loc.index);
    this.draw();
  }

  play(): void {
    if (!this.clips.length) return;
    const { duration } = this.$state.get();
    let time = this.$time.get();
    if (time >= duration - 0.01) time = 0;
    this.patch({ playing: true });
    this.seek(time);
    const v = this.videoAt(this.active);
    if (v) void v.play().catch(() => undefined);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.patch({ playing: false });
    this.cancelLeading();
    this.gap = null;
    this.videoAt(this.active)?.pause();
    cancelAnimationFrame(this.raf);
    this.draw();
  }

  toggle(): void {
    if (this.$state.get().playing) this.pause();
    else this.play();
  }

  setMuted(muted: boolean): void {
    this.patch({ muted });
    for (const v of this.videos.values()) v.muted = muted;
  }

  setLoop(loop: boolean): void {
    this.patch({ loop });
  }

  /** Start of the clip before the playhead's (or this clip's start, past its first second). */
  skipPrevious(): void {
    const { starts } = clipStarts(this.clips);
    const t = this.$time.get();
    let target = 0;
    for (let i = starts.length - 1; i >= 0; i -= 1) {
      if (starts[i] < t - 0.05) { target = starts[i]; break; }
    }
    this.seek(target);
  }

  skipNext(): void {
    const { starts, total } = clipStarts(this.clips);
    const t = this.$time.get();
    const next = starts.find((s) => s > t + 0.05);
    this.seek(next ?? total);
    if (next === undefined && this.$state.get().playing) this.pause();
  }

  private tick = (): void => {
    if (!this.$state.get().playing) return;
    const clip = this.clips[this.active];
    const v = this.videoAt(this.active);
    if (clip && v) {
      const { starts } = clipStarts(this.clips);
      const sourceTime = this.sourceTimeOf(clip, v);
      if ((clip.url && v.ended) || sourceTime >= clip.trimEnd - 0.02) {
        this.woken = null;
        this.gap = null;
        const nextIndex = this.active + 1;
        if (nextIndex < this.clips.length) {
          v.pause();
          this.active = nextIndex;
          const nv = this.videoAt(nextIndex);
          const nc = this.clips[nextIndex];
          if (nv && nc?.url && !this.takeLeading(nv)) {
            if (Math.abs(nv.currentTime - nc.trimStart) > 0.05) nv.currentTime = nc.trimStart;
            void nv.play().catch(() => undefined);
          }
          this.setTime(starts[nextIndex]);
          this.preloadNext(nextIndex);
        } else if (this.$state.get().loop) {
          v.pause();
          const first = this.videoAt(0);
          if (first && this.takeLeading(first)) {
            this.active = 0;
            this.setTime(0);
            this.preloadNext(0);
          } else {
            this.active = -1;
            this.seek(0);
            const fv = this.videoAt(this.active);
            if (fv) void fv.play().catch(() => undefined);
          }
        } else {
          this.setTime(clipStarts(this.clips).total);
          this.pause();
          return;
        }
      } else {
        this.setTime(starts[this.active] + Math.max(0, sourceTime - clip.trimStart));
        const remaining = clip.trimEnd - sourceTime;
        if (remaining < CUT_WAKE_SECONDS) this.wakeNext(this.active);
        if (remaining < CUT_LEAD_SECONDS) this.leadNext(this.active);
      }
    }
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  draw(): void {
    const { canvas, ctx } = this;
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const v = this.videoAt(this.active);
    if (this.clips[this.active] && !this.clips[this.active].url) {
      // A gap: black, not the last clip's last frame held over it.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (!v || v.readyState < 2 || !v.videoWidth) {
      // Mid-seek or mid-load: the last frame stays up. Black only before anything has been
      // painted, or when no clip is under the playhead at all.
      if (!v || !this.$state.get().ready) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
      }
      return;
    }
    const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, w, h);
    if (!this.$state.get().ready) this.patch({ ready: true });
  }

  /** The <video> under the playhead and the time inside it — what Save frame captures. */
  currentSource(): { clipId: string; sourceTime: number } | null {
    const loc = locateTime(this.clips, this.$time.get());
    if (!loc) return null;
    return { clipId: this.clips[loc.index].id, sourceTime: loc.sourceTime };
  }

  /**
   * Stops playback and releases every <video>. Not terminal: StrictMode unmounts and remounts
   * effects in development, and the next `setClips` rebuilds what this released.
   */
  dispose(): void {
    this.patch({ playing: false, ready: false });
    this.cancelLeading();
    cancelAnimationFrame(this.raf);
    for (const v of this.videos.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
    }
    this.videos.clear();
    this.active = -1;
  }
}
