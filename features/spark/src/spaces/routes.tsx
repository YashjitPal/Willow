import { Navigate, Outlet, type RouteObject } from "react-router-dom";
import { spacePageRoute } from "./editor/routes";
import { PagesHome } from "./landing/pages-home";
import { useSpacesStore } from "./state";

/** `Jys` (app-initial): Pages routes render once Pages are available and send everyone else home. */
function PagesAvailabilityGate() {
  const availability = useSpacesStore((state) => state.availability);
  if (availability === "loading") return null;
  if (availability === "disabled") return <Navigate to="/" replace />;
  return <Outlet />;
}

export const spacesRoutes: RouteObject[] = [
  {
    element: <PagesAvailabilityGate />,
    children: [{ path: "/space", element: <PagesHome /> }, spacePageRoute],
  },
];
