import { RouterProvider, createBrowserRouter } from "react-router-dom";
import GlyphFieldLab from "./features/lab/GlyphFieldLab";
import UnderwritingPage from "./features/underwriting/UnderwritingPage";
import { ChatLayout } from "./shell/ChatLayout";
import { GravityShell } from "./shell/GravityShell";
import { HomePage } from "./shell/HomePage";
import { UnobioShell } from "./shell/UnobioShell";

const router = createBrowserRouter([
  {
    element: <UnobioShell />,
    children: [{ path: "/", element: <HomePage /> }],
  },
  { path: "/lab/glyph-field", element: <GlyphFieldLab /> },
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

export default function App() {
  return <RouterProvider router={router} />;
}
