import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import * as Phone from "../../../willow/phone.ts";
import { PhonePhotoToolkit, PhoneStandardToolkit, PhoneToolError } from "./tools.ts";

const run = (tool: Phone.PhoneToolName, args: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () => Phone.callPhone(tool, args),
    catch: (error) =>
      new PhoneToolError({ message: error instanceof Error ? error.message : String(error) }),
  });

const fail = (message: string) => Effect.fail(new PhoneToolError({ message }));

const fields = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const layerStandard = PhoneStandardToolkit.toLayer({
  phone_status: ({ includeDevice }) =>
    Effect.gen(function* () {
      const phone = Phone.describePhone();
      if (!phone.connected) return { connected: false, tools: [] };
      const tools = [...phone.tools];
      if (includeDevice === false || !tools.includes("phone_status")) {
        return { connected: true, label: phone.label, tools };
      }
      const device = yield* run("phone_status", {});
      return { connected: true, label: phone.label, tools, device };
    }),
  phone_location: ({ accuracy }) =>
    Effect.gen(function* () {
      const result = fields(yield* run("phone_location", { accuracy: accuracy ?? "balanced" }));
      const latitude = finite(result.latitude);
      const longitude = finite(result.longitude);
      if (latitude === null || longitude === null)
        return yield* fail("The phone sent no location.");
      return {
        latitude,
        longitude,
        accuracy: finite(result.accuracy),
        altitude: finite(result.altitude),
        timestamp: finite(result.timestamp) ?? (yield* Clock.currentTimeMillis),
      };
    }),
  phone_notify: ({ title, body }) => {
    const heading = title.trim().slice(0, 120);
    if (!heading) return fail("A notification needs a title.");
    const text = body?.trim().slice(0, 1000);
    return run("phone_notify", { title: heading, ...(text ? { body: text } : {}) }).pipe(
      Effect.as({ shown: true }),
    );
  },
  phone_vibrate: ({ pattern }) =>
    run("phone_vibrate", { pattern: pattern ?? "medium" }).pipe(Effect.as({ done: true })),
  phone_open_url: ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return fail("That is not a link.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fail("Only http and https links open on the phone.");
    }
    return run("phone_open_url", { url: parsed.href }).pipe(
      Effect.map((value) => ({ opened: fields(value).opened !== false })),
    );
  },
  phone_clipboard_set: ({ text }) =>
    run("phone_clipboard_set", { text: text.slice(0, 20_000) }).pipe(Effect.as({ done: true })),
});

export const layerPhoto = PhonePhotoToolkit.toLayer({
  phone_photo: ({ maxSize }) =>
    run("phone_photo", {
      maxSize: Math.round(Math.min(2048, Math.max(256, finite(maxSize) ?? 1024))),
    }).pipe(
      Effect.flatMap((value) => {
        const result = fields(value);
        const data = typeof result.base64 === "string" ? result.base64.replace(/\s+/g, "") : "";
        if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) return fail("The phone sent no photo.");
        const mimeType =
          typeof result.mimeType === "string" && /^image\/(jpeg|png|webp)$/.test(result.mimeType)
            ? result.mimeType
            : "image/jpeg";
        return Effect.succeed({
          screenshot: {
            mimeType,
            data,
            width: finite(result.width) ?? 0,
            height: finite(result.height) ?? 0,
          },
        });
      }),
    ),
});
