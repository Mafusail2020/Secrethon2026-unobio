import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import UnderwritingPage from "./features/underwriting/UnderwritingPage";
import { UnobioShell } from "./shell/UnobioShell";

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/underwriting" replace /> },
  {
    element: <UnobioShell />,
    children: [
      { path: "/underwriting", element: <UnderwritingPage /> },
      { path: "/underwriting/runs/:runId", element: <UnderwritingPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
