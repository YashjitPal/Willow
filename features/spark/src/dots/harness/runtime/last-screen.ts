/**
 * The latest screen each bot took a picture of — the user's, a window of theirs, or its own computer's — as it was
 * captured, at its own size: what `send_file` sends when the user wants to see what the bot saw. Kept in memory for
 * the window's life, one a bot.
 */

export interface DotScreenPicture {
  /** Base64. */
  data: string;
  mimeType: string;
  width: number;
  height: number;
  /** Whose screen, in words: "the user's screen", "your computer's screen". */
  of: string;
  at: number;
}

const latest = new Map<string, DotScreenPicture>();

export const rememberScreen = (dotId: string, picture: DotScreenPicture): void => {
  latest.set(dotId, picture);
};

export const latestScreen = (dotId: string): DotScreenPicture | undefined => latest.get(dotId);
