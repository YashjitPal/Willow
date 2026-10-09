import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

/**
 * The user's Android phone, through Willow's app (`../../../willow/phone.ts`). Deliberately a
 * small surface: its state and location, telling the user something, and a photo the user
 * takes after agreeing on the phone. The phone's owner can turn all of it off there.
 */
export class PhoneToolError extends Schema.TaggedError<PhoneToolError>()("PhoneToolError", {
  message: Schema.String,
}) {}

const PhoneStatusTool = Tool.make("phone_status", {
  description:
    "Whether the user's Android phone is connected through the Willow app, which phone_* tools its owner allows, and, when connected, its model, Android version, battery and network. Call this before the other phone_* tools.",
  parameters: Schema.Struct({
    includeDevice: Schema.optional(
      Schema.Boolean.annotate({
        description: "Also read the phone's model, battery and network. Defaults to true.",
      }),
    ),
  }),
  success: Schema.Struct({
    connected: Schema.Boolean,
    label: Schema.optional(Schema.String),
    tools: Schema.Array(Schema.String),
    device: Schema.optional(Schema.Unknown),
  }),
  failure: PhoneToolError,
})
  .annotate(Tool.Title, "Phone status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PhoneLocationTool = Tool.make("phone_location", {
  description:
    "The phone's current location (latitude, longitude, accuracy in meters). Android may ask the user for permission the first time.",
  parameters: Schema.Struct({
    accuracy: Schema.optional(
      Schema.Literals(["balanced", "high"]).annotate({
        description: "high uses GPS and takes longer. Defaults to balanced.",
      }),
    ),
  }),
  success: Schema.Struct({
    latitude: Schema.Number,
    longitude: Schema.Number,
    accuracy: Schema.NullOr(Schema.Number),
    altitude: Schema.NullOr(Schema.Number),
    timestamp: Schema.Number,
  }),
  failure: PhoneToolError,
})
  .annotate(Tool.Title, "Phone location")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const PhoneNotifyTool = Tool.make("phone_notify", {
  description:
    "Show a notification on the user's phone, for example when a long task finishes. Title up to 120 characters, body up to 1,000.",
  parameters: Schema.Struct({
    title: Schema.String,
    body: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ shown: Schema.Boolean }),
  failure: PhoneToolError,
})
  .annotate(Tool.Title, "Notify phone")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const PhoneVibrateTool = Tool.make("phone_vibrate", {
  description: "Vibrate the phone briefly, to get the user's attention.",
  parameters: Schema.Struct({
    pattern: Schema.optional(
      Schema.Literals(["light", "medium", "heavy", "success", "warning", "error"]).annotate({
        description: "Defaults to medium.",
      }),
    ),
  }),
  success: Schema.Struct({ done: Schema.Boolean }),
  failure: PhoneToolError,
})
  .annotate(Tool.Title, "Vibrate phone")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const PhoneOpenUrlTool = Tool.make("phone_open_url", {
  description:
    "Open an http or https link on the phone, in its browser or the app that handles it.",
  parameters: Schema.Struct({ url: Schema.String }),
  success: Schema.Struct({ opened: Schema.Boolean }),
  failure: PhoneToolError,
})
  .annotate(Tool.Title, "Open link on phone")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const PhoneClipboardTool = Tool.make("phone_clipboard_set", {
  description:
    "Put text on the phone's clipboard, replacing what is there, so the user can paste it. Up to 20,000 characters.",
  parameters: Schema.Struct({ text: Schema.String }),
  success: Schema.Struct({ done: Schema.Boolean }),
  failure: PhoneToolError,
})
  .annotate(Tool.Title, "Copy to phone")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const PhonePhotoTool = Tool.make("phone_photo", {
  description:
    "Ask the user to take a photo with the phone's camera and get it as an image. The phone asks the user first; they may decline. Waits up to three minutes.",
  parameters: Schema.Struct({
    maxSize: Schema.optional(
      Schema.Number.annotate({
        description: "Longest edge in pixels, 256 to 2048. Defaults to 1024.",
      }),
    ),
  }),
  success: Schema.Struct({
    screenshot: Schema.Struct({
      mimeType: Schema.String,
      data: Schema.String,
      width: Schema.Number,
      height: Schema.Number,
    }),
  }),
  failure: PhoneToolError,
})
  .annotate(Tool.Title, "Phone photo")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const PhoneStandardToolkit = Toolkit.make(
  PhoneStatusTool,
  PhoneLocationTool,
  PhoneNotifyTool,
  PhoneVibrateTool,
  PhoneOpenUrlTool,
  PhoneClipboardTool,
);

export const PhonePhotoToolkit = Toolkit.make(PhonePhotoTool);
