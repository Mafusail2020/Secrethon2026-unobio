import { createContext, useContext } from "react";
import type { ViewData } from "../artifact/ViewContent";

export const ViewDataContext = createContext<ViewData | null>(null);

export function useViewData(): ViewData {
  const data = useContext(ViewDataContext);
  if (!data) throw new Error("a view was rendered outside the dock");
  return data;
}
