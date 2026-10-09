import { createFileRoute } from "@tanstack/react-router";

import { WillowSearchPage } from "../willow/WillowSearchPage";

export const Route = createFileRoute("/search")({
  component: WillowSearchPage,
});
