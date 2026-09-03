/**
 * The user's location, as shown in the sidebar's settings menu.
 *
 * Opt-in and empty by default. Nothing here runs until the user presses "Update
 * location": the browser then asks for permission, and only on a grant does a
 * fix get taken. A profile that has never been asked reports "not set" rather
 * than guessing, because a confidently wrong city is worse than an absent one —
 * this row previously shipped a hardcoded "Kolkata, West Bengal, India" that
 * every install displayed regardless of where its user actually was.
 *
 * PRIVACY: resolving coordinates to a place name needs a geocoder, and there is
 * no offline one in the browser. On a successful fix the rounded latitude and
 * longitude are sent to BigDataCloud's keyless reverse-geocode endpoint, which
 * is the only time any location data leaves the device. Coordinates are rounded
 * to two decimals (~1km) before the request, which is ample for a city label and
 * avoids handing over a doorstep. Nothing is sent when the user declines, and
 * the result is stored locally only — it is never synced to an account.
 *
 * A nanostore rather than a React context for the same reason as
 * `experiments-store`: the sidebar menu reads it and the settings row writes it,
 * and neither justifies another provider in App.tsx.
 */

import { atom } from 'nanostores';

export type UserLocation = {
  /** Human-readable place, e.g. `Kolkata, West Bengal, India`. */
  label: string;
  /** ISO-8601 instant of the fix, so the UI can say how stale it is. */
  updatedAt: string;
  /**
   * True when the geocoder could not be reached and `label` is a coordinate
   * pair. Still a real location, just an unfriendly one.
   */
  approximate?: boolean;
};

/**
 * `idle` covers both "never asked" and "settled"; `location` says which.
 * `denied` and `unavailable` are kept apart because only the first is something
 * the user can undo, and the row's help text differs.
 */
export type LocationStatus = 'idle' | 'locating' | 'denied' | 'unavailable';

export type LocationState = {
  location: UserLocation | null;
  status: LocationStatus;
  /** Provider or permission text for the failure rows. Null unless failed. */
  error: string | null;
};

const STORAGE_KEY = 'willow:location';

export const LOCATION_DEFAULTS: LocationState = {
  location: null,
  status: 'idle',
  error: null,
};

/** Only the resolved place is persisted — a status is about one attempt. */
const readStored = (): LocationState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...LOCATION_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UserLocation>;
    const label = typeof parsed?.label === 'string' ? parsed.label.trim() : '';
    if (!label) return { ...LOCATION_DEFAULTS };
    return {
      location: {
        label,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        ...(parsed.approximate === true ? { approximate: true } : {}),
      },
      status: 'idle',
      error: null,
    };
  } catch {
    // Corrupt or unavailable storage must not stop the app booting.
    return { ...LOCATION_DEFAULTS };
  }
};

export const locationStore = atom<LocationState>(readStored());

const persist = (location: UserLocation | null): void => {
  try {
    if (location) localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A failed write only costs persistence; the in-memory value still applies.
  }
};

export const clearUserLocation = (): void => {
  locationStore.set({ ...LOCATION_DEFAULTS });
  persist(null);
};

/** `22.5726, 88.3639` -> `22.57°, 88.36°`, the fallback when geocoding fails. */
const coordinateLabel = (latitude: number, longitude: number): string =>
  `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`;

/**
 * The country in the form a person writes it.
 *
 * The geocoder returns the ISO long form, so a London fix ends
 * `...United Kingdom of Great Britain and Northern Ireland` and blows the row's
 * width. `Intl.DisplayNames` turns the country CODE into the common name the
 * same table Gemini shows uses, with the long form kept as the fallback for a
 * code it does not recognise.
 */
const countryLabel = (code: string, fallback: string): string => {
  try {
    if (code) {
      const display = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
      if (display && display !== code) return display;
    }
  } catch {
    // Older engines without the `region` type fall back to the long form.
  }
  return fallback;
};

/**
 * Coordinates to a place name, in Gemini's three-part `city, region, country`
 * shape.
 *
 * `locality` is only a fallback for `city`, never an addition: it holds the
 * sub-area ("City of Westminster" inside London), so including both reads as two
 * different places. Any part can be blank — an ocean fix has nothing but a
 * country-less name — so empties are dropped and repeats collapsed rather than
 * joined blindly, which is what would otherwise render `, , India`.
 */
const reverseGeocode = async (
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<string | null> => {
  const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client'
    + `?latitude=${latitude.toFixed(2)}&longitude=${longitude.toFixed(2)}&localityLanguage=en`;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const data = await response.json() as Record<string, unknown>;
  const field = (key: string): string => (typeof data[key] === 'string' ? (data[key] as string).trim() : '');

  const parts = [
    field('city') || field('locality'),
    field('principalSubdivision'),
    countryLabel(field('countryCode'), field('countryName')),
  ].filter(Boolean);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length ? unique.join(', ') : null;
};

/*
 * The spec's own numbers, not the constants off the error instance.
 *
 * `PERMISSION_DENIED` is inherited from the prototype, so it is present on a real
 * `GeolocationPositionError` and absent on anything hand-built — a rejection that
 * is merely shaped like one would compare `1 === undefined` and get reported as a
 * device fault the user cannot act on. The values are fixed by the Geolocation
 * spec, so reading them directly is both safer and equivalent.
 */
const PERMISSION_DENIED = 1;
const POSITION_TIMEOUT = 3;

const isPermissionDenied = (error: unknown): boolean =>
  (error as GeolocationPositionError | undefined)?.code === PERMISSION_DENIED;

const positionErrorMessage = (error: unknown): string => {
  const code = (error as GeolocationPositionError | undefined)?.code;
  if (code === PERMISSION_DENIED) return 'Willow was not allowed to read this device\u2019s location.';
  if (code === POSITION_TIMEOUT) return 'Timed out waiting for a location fix.';
  return 'This device could not provide a location.';
};

const currentPosition = (): Promise<GeolocationPosition> => new Promise((resolve, reject) => {
  navigator.geolocation.getCurrentPosition(resolve, reject, {
    // A city label does not need GPS precision, and asking for it costs battery
    // and seconds on mobile for an answer rounded away moments later.
    enableHighAccuracy: false,
    timeout: 15_000,
    maximumAge: 5 * 60 * 1000,
  });
});

/**
 * Ask the browser for a fix and resolve it to a place name.
 *
 * Safe to call repeatedly — a second call while one is in flight is ignored, so
 * double-clicking the menu row cannot open two permission prompts.
 */
export const requestUserLocation = async (signal?: AbortSignal): Promise<void> => {
  if (locationStore.get().status === 'locating') return;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    locationStore.set({
      ...locationStore.get(),
      status: 'unavailable',
      error: 'This browser does not provide location access.',
    });
    return;
  }

  locationStore.set({ ...locationStore.get(), status: 'locating', error: null });

  let position: GeolocationPosition;
  try {
    position = await currentPosition();
  } catch (error) {
    locationStore.set({
      ...locationStore.get(),
      status: isPermissionDenied(error) ? 'denied' : 'unavailable',
      error: positionErrorMessage(error),
    });
    return;
  }

  const { latitude, longitude } = position.coords;
  /*
   * A geocoder failure is not a location failure. The fix already succeeded, so
   * the coordinates are kept and shown rather than discarding a grant the user
   * just gave and making them approve a second prompt.
   */
  let label: string | null = null;
  try {
    label = await reverseGeocode(latitude, longitude, signal);
  } catch {
    label = null;
  }

  const location: UserLocation = {
    label: label || coordinateLabel(latitude, longitude),
    updatedAt: new Date().toISOString(),
    ...(label ? {} : { approximate: true }),
  };
  locationStore.set({ location, status: 'idle', error: null });
  persist(location);
};
