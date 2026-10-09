import type { RouteObject } from "react-router-dom";
import { SpacePage } from "./space-page";

/** Nested by `spacesRoutes` under `PagesAvailabilityGate`; an export named `*Routes` would also mount it at the top level. */
export const spacePageRoute: RouteObject = { path: "/space/:pageId", element: <SpacePage /> };
