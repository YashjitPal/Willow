/**
 * Willow's ratings under a response (features/chat ChatResponseChrome's ResponseActions): Good
 * response and Bad response, the chosen one's thumb filled; choosing it again takes it back. The
 * agents have nowhere to send a rating, so each is kept on this computer, by message.
 */
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { willowSymbol } from "./icons";

type Rating = "like" | "dislike";

const STORAGE_KEY = "willow-agents:ratings";
const KEPT_RATINGS = 500;

const ThumbUp = willowSymbol("thumb_up", "luminous");
const ThumbDown = willowSymbol("thumb_down", "luminous");

function readRatings(): Record<string, Rating> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return stored !== null && typeof stored === "object" ? (stored as Record<string, Rating>) : {};
  } catch {
    return {};
  }
}

function keepRating(messageId: string, rating: Rating | null) {
  const ratings = readRatings();
  delete ratings[messageId];
  if (rating) ratings[messageId] = rating;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(Object.entries(ratings).slice(-KEPT_RATINGS))),
    );
  } catch {
    // Storage that is full or turned off keeps the rating for this visit only.
  }
}

export function ResponseRating({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<Rating | null>(() => readRatings()[messageId] ?? null);
  const choose = (choice: Rating) => {
    const next = rating === choice ? null : choice;
    setRating(next);
    keepRating(messageId, next);
  };
  return (
    <>
      <RatingButton
        label="Good response"
        chosen={rating === "like"}
        icon={ThumbUp}
        onClick={() => choose("like")}
      />
      <RatingButton
        label="Bad response"
        chosen={rating === "dislike"}
        icon={ThumbDown}
        onClick={() => choose("dislike")}
      />
    </>
  );
}

function RatingButton({
  label,
  chosen,
  icon: Icon,
  onClick,
}: {
  label: string;
  chosen: boolean;
  icon: typeof ThumbUp;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={label}
            aria-pressed={chosen}
            onClick={onClick}
          />
        }
      >
        <Icon {...(chosen ? { fill: "currentColor" } : {})} />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
