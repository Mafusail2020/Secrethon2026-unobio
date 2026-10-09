import { RouterProvider, createBrowserRouter } from "react-router-dom";
import GlyphFieldLab from "./features/lab/GlyphFieldLab";
import DeckPage from "./features/underwriting/artifact/report/deck/DeckPage";
import UnderwritingPage from "./features/underwriting/UnderwritingPage";
import { ChatLayout } from "./shell/ChatLayout";
import { GravityShell } from "./shell/GravityShell";
import { HomePage } from "./shell/HomePage";
import { installPortalTransition } from "./shell/portalTransition";
import { UnobioShell } from "./shell/UnobioShell";

const router = createBrowserRouter([
  {
    element: <UnobioShell />,
    children: [{ path: "/", element: <HomePage /> }],
  },
  { path: "/lab/glyph-field", element: <GlyphFieldLab /> },
  { path: "/underwriting/runs/:runId/deck", element: <DeckPage /> },
  {
    element: <GravityShell />,
    children: [
      {
        element: <ChatLayout />,
        children: [
          { path: "/underwriting", element: <UnderwritingPage /> },
          { path: "/underwriting/runs/:runId", element: <UnderwritingPage /> },
        ],
      },
    ],
  },
]);

installPortalTransition(router);

export default function App() {
  return <RouterProvider router={router} />;
}
