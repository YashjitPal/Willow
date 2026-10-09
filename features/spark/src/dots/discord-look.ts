/**
 * A bot's Discord bot wears the bot's own look: its character for a picture — as large as the circle Discord cuts a
 * picture to allows, on transparency — its wallpaper for a banner, and its name. Willow gives it all three when the
 * bot is linked, and again whenever the user changes any of them here, unless they turn it off on the bot's Discord
 * page. One window does it at a time, and a window that finds nothing new to send sends nothing. Discord limits how
 * often a bot may change, so a change it refuses for now waits as long as it asks (`discordLookPlan` in
 * `harness/runtime/discord.ts`).
 */
import { atom } from 'nanostores';
import { requestSavedAvatarCapture } from './character/avatar/saved-avatar-capture';
import { sameBytes } from './character/orbit/appearance-codec';
import { getDotState } from './character/orbit/conversation-character';
import { dotWallpaperColors, dotWallpaperUrl } from './computer/dot-wallpaper';
import { pictureFrame } from './discord-picture';
import { dotTintHex } from './dot-tint';
import { sparkDots, type SparkDot } from './dots-store';
import { setDotDiscordProfile } from './harness/dot-runtime';
import { discordLinks, discordLookPlan, discordUsername, updateDiscordLink, type DiscordLook, type DiscordLookWanted } from './harness/runtime/discord';
import { withWebLock } from './harness/runtime/web-lock';
import { useCharacterStore } from './state/character-store';
import { useDotStore } from './state/dot-store';

/** Raised when how the picture or the banner is drawn changes, so every bot's is drawn again once. */
const PICTURE_VERSION = 2;
const BANNER_VERSION = 1;
/** Discord's banner is 17 by 6 (680 × 240); drawn at twice that. */
const BANNER_WIDTH = 1360;
const BANNER_HEIGHT = 480;
/** As the capture's own: a first boot on a cold shader cache is slow, and must not be cut short. */
const DRAW_WAIT_MS = 4 * 60_000;
/** A change in the editor comes in a burst; the picture is made once it settles. */
const SETTLE_MS = 2_500;
/** Drawing the character failed: try again after a while rather than on every change. */
const DRAW_RETRY_MS = 10 * 60_000;

/** Which bots are being brought in step on Discord right now, for their Discord page. */
export const discordLookBusy = atom<Record<string, boolean>>({});

const setBusy = (dotId: string, busy: boolean) => {
  const { [dotId]: _was, ...rest } = discordLookBusy.get();
  discordLookBusy.set(busy ? { ...rest, [dotId]: true } : rest);
};

/** A short fingerprint of what a picture is drawn from. */
const fingerprint = (version: number, text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${version}-${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
};

/** The picture's: the character. */
const lookKey = (dot: Pick<SparkDot, 'presetId' | 'appearance' | 'petId'>): string => fingerprint(PICTURE_VERSION, `${dot.presetId}|${dot.appearance ?? ''}`);

/** The banner's: the wallpaper, which is the bot's colour. */
const bannerKey = (dot: Pick<SparkDot, 'presetId' | 'appearance' | 'petId'>): string => fingerprint(BANNER_VERSION, `banner|${dotTintHex(dot) ?? ''}`);

const wantedFor = (dot: SparkDot): DiscordLookWanted => ({ avatarKey: lookKey(dot), bannerKey: bannerKey(dot), name: discordUsername(dot.name) });

/** The bot's character as Willow draws its avatar (`saved-avatar-capture.ts`), as a data URL. */
const characterPicture = (dotId: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const dot = useDotStore.getState().dots.find((entry) => entry.conversationId === dotId);
    const state = dot ? getDotState(dot) : null;
    if (!state) {
      reject(new Error('This bot has no character to draw.'));
      return;
    }
    const saved = () => {
      const image = useCharacterStore.getState().savedImages[dotId];
      return image && sameBytes(image.state, state) ? image.src : null;
    };
    const ready = saved();
    if (ready) {
      resolve(ready);
      return;
    }
    const release = requestSavedAvatarCapture(dotId, state);
    let unsubscribe = () => {};
    const finish = (src: string | null) => {
      window.clearTimeout(timer);
      unsubscribe();
      release();
      if (src) resolve(src);
      else reject(new Error('Willow couldn’t draw the bot’s picture.'));
    };
    const timer = window.setTimeout(() => finish(null), DRAW_WAIT_MS);
    unsubscribe = useCharacterStore.subscribe((store) => {
      if (store.rendererFailure) finish(null);
      else {
        const src = saved();
        if (src) finish(src);
      }
    });
  });

/**
 * The picture Discord shows in a circle: the character as large as that circle allows with none of it cut away, copied
 * pixel for pixel — never enlarged — on transparency (`pictureFrame`).
 */
const discordPicture = async (src: string): Promise<string> => {
  const image = new Image();
  image.src = src;
  await image.decode();
  const source = document.createElement('canvas');
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Willow couldn’t draw the bot’s picture.');
  sourceContext.drawImage(image, 0, 0);
  const frame = pictureFrame(sourceContext.getImageData(0, 0, source.width, source.height).data, source.width, source.height);
  if (!frame) throw new Error('Willow couldn’t find the bot’s character in its picture.');
  const canvas = document.createElement('canvas');
  canvas.width = frame.size;
  canvas.height = frame.size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Willow couldn’t draw the bot’s picture.');
  context.drawImage(source, frame.left, frame.top);
  return canvas.toDataURL('image/png');
};

/** The banner: the bot's wallpaper — its computer's, in its colour — cut to Discord's banner, a little below the middle. */
const discordBanner = async (dot: SparkDot): Promise<string> => {
  const image = new Image();
  image.src = dotWallpaperUrl(dotWallpaperColors(dotTintHex(dot)));
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = BANNER_WIDTH;
  canvas.height = BANNER_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Willow couldn’t draw the bot’s banner.');
  const width = image.naturalWidth || 3840;
  const height = image.naturalHeight || 2160;
  const scale = Math.max(BANNER_WIDTH / width, BANNER_HEIGHT / height);
  const drawn = height * scale;
  // Below the middle, where the dawn's glow meets the current.
  const top = Math.min(0, Math.max(BANNER_HEIGHT - drawn, (BANNER_HEIGHT - drawn) * 0.62));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, (BANNER_WIDTH - width * scale) / 2, top, width * scale, drawn);
  return canvas.toDataURL('image/jpeg', 0.92);
};

const changeLook = (dotId: string, change: (look: DiscordLook) => DiscordLook) => updateDiscordLink(dotId, (link) => ({ ...link, look: change(link.look ?? {}) }));

const retries = new Map<string, number>();

/** When Discord asked to wait, comes back once it is time. */
const comeBackAt = (dotId: string, at: number | undefined) => {
  window.clearTimeout(retries.get(dotId));
  retries.delete(dotId);
  if (!at) return;
  retries.set(dotId, window.setTimeout(() => {
    retries.delete(dotId);
    void syncDiscordLook(dotId);
  }, Math.min(Math.max(at - Date.now(), 0) + 1_000, 2 ** 31 - 1)));
};

/** The picture and the banner, whichever are to change, in one go; a banner Discord will not take does not hold up the picture. */
const sendPictures = async (dotId: string, dot: SparkDot, keys: { avatar?: string; banner?: string }): Promise<void> => {
  const change: { avatar?: string; banner?: string } = {};
  try {
    if (keys.avatar) change.avatar = await discordPicture(await characterPicture(dotId));
    if (keys.banner) change.banner = await discordBanner(dot);
  } catch (error) {
    const waitUntil = Date.now() + DRAW_RETRY_MS;
    changeLook(dotId, (look) => ({ ...look, problem: error instanceof Error ? error.message : String(error), waitUntil }));
    comeBackAt(dotId, waitUntil);
    return;
  }
  let result = await setDotDiscordProfile(dotId, change);
  let refusedBanner = false;
  if ('problem' in result && result.banner && change.avatar) {
    refusedBanner = true;
    result = await setDotDiscordProfile(dotId, { avatar: change.avatar });
  }
  if ('problem' in result) {
    const refusal = result;
    // Refused for now: wait as asked. Refused outright: not again until the look changes.
    changeLook(dotId, (look) => ({
      ...look,
      problem: refusal.problem,
      ...(refusal.waitUntil
        ? { waitUntil: refusal.waitUntil }
        : { ...(keys.avatar ? { avatarKey: keys.avatar } : {}), ...(keys.banner ? { bannerKey: keys.banner } : {}), waitUntil: undefined }),
    }));
    comeBackAt(dotId, refusal.waitUntil);
    return;
  }
  const done = result;
  updateDiscordLink(dotId, (link) => ({
    ...link,
    ...(done.avatar ? { botAvatar: done.avatar } : {}),
    botName: done.username,
    look: {
      ...link.look,
      ...(keys.avatar ? { avatarKey: keys.avatar } : {}),
      ...(keys.banner ? { bannerKey: keys.banner } : {}),
      problem: refusedBanner ? 'Discord didn’t take the banner.' : undefined,
      waitUntil: undefined,
      at: Date.now(),
    },
  }));
};

const sendName = async (dotId: string, name: string): Promise<void> => {
  const result = await setDotDiscordProfile(dotId, { username: name });
  if ('problem' in result) {
    changeLook(dotId, (look) => ({ ...look, problem: result.problem, ...(result.waitUntil ? { waitUntil: result.waitUntil } : { name, waitUntil: undefined }) }));
    comeBackAt(dotId, result.waitUntil);
    return;
  }
  updateDiscordLink(dotId, (link) => ({
    ...link,
    ...(result.avatar ? { botAvatar: result.avatar } : {}),
    botName: result.username,
    look: { ...link.look, name, problem: undefined, waitUntil: undefined, at: Date.now() },
  }));
};

const syncing = new Set<string>();

/** Brings one bot's look on Discord in step with its look here, when something is to change and now is the time. */
export const syncDiscordLook = async (dotId: string): Promise<void> => {
  const dot = sparkDots.get().dots.find((entry) => entry.id === dotId);
  if (!dot || dot.status !== 'ready' || syncing.has(dotId)) return;
  const wanted = wantedFor(dot);
  const link = discordLinks.get()[dotId];
  if (!link) return;
  if (!discordLookPlan(link, wanted, Date.now())) {
    comeBackAt(dotId, (link.look?.waitUntil ?? 0) > Date.now() ? link.look?.waitUntil : undefined);
    return;
  }
  syncing.add(dotId);
  setBusy(dotId, true);
  try {
    await withWebLock(`willow-dot-discord-look:${dotId}`, async () => {
      // Another window may have done it a moment ago.
      const current = discordLinks.get()[dotId];
      const plan = current ? discordLookPlan(current, wanted, Date.now()) : null;
      if (!plan) return;
      if ((plan.avatar && wanted.avatarKey) || (plan.banner && wanted.bannerKey)) {
        await sendPictures(dotId, dot, { ...(plan.avatar && wanted.avatarKey ? { avatar: wanted.avatarKey } : {}), ...(plan.banner && wanted.bannerKey ? { banner: wanted.bannerKey } : {}) });
      }
      const after = discordLinks.get()[dotId];
      if (plan.name && after && !((after.look?.waitUntil ?? 0) > Date.now())) await sendName(dotId, plan.name);
    });
  } finally {
    syncing.delete(dotId);
    setBusy(dotId, false);
  }
};

/** Turns the look's following on or off for one bot; turned back on, the bot is given its look again in full. */
export const setDiscordLookOn = (dotId: string, on: boolean): void => {
  changeLook(dotId, (look) => (on ? { at: look.at } : { ...look, off: true, problem: undefined, waitUntil: undefined }));
  if (on) void syncDiscordLook(dotId);
  else comeBackAt(dotId, undefined);
};

let watchers = 0;
let stopWatching = () => {};

/**
 * Keeps every linked bot's Discord look in step from now on: once at the start, for changes made while Willow was
 * closed, then after each change of its character, colour or name, or of its link. Resolves to a stop function.
 */
export const watchDiscordLooks = (): (() => void) => {
  watchers += 1;
  if (watchers === 1) {
    const timers = new Map<string, number>();
    let seen = new Map<string, string>();
    const schedule = (dotId: string) => {
      window.clearTimeout(timers.get(dotId));
      timers.set(dotId, window.setTimeout(() => {
        timers.delete(dotId);
        void syncDiscordLook(dotId);
      }, SETTLE_MS));
    };
    const check = () => {
      const links = discordLinks.get();
      const next = new Map<string, string>();
      for (const dot of sparkDots.get().dots) {
        const link = links[dot.id];
        if (!link) continue;
        const now = `${link.botId}|${link.look?.off ? 'off' : 'on'}|${lookKey(dot)}|${dot.name ?? ''}|${dot.status}`;
        next.set(dot.id, now);
        if (seen.get(dot.id) !== now) schedule(dot.id);
      }
      seen = next;
    };
    check();
    const unsubscribeDots = sparkDots.listen(check);
    const unsubscribeLinks = discordLinks.listen(check);
    stopWatching = () => {
      unsubscribeDots();
      unsubscribeLinks();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      for (const timer of retries.values()) window.clearTimeout(timer);
      retries.clear();
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    watchers -= 1;
    if (watchers === 0) stopWatching();
  };
};
