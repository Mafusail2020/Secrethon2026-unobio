import { createContext, useContext } from "react";
import type { GraphSpec, NodeSpec, UnderwritingReport } from "../../../../api/types";

export interface FocusClaim {
  id: string;
  nonce: number;
}

export interface CorrectionSeed {
  node: NodeSpec;
  /** why the node differs from claim.produced_by, when it does */
  note?: string;
  text: string;
  exclude: string[];
}

/** The panels under "The numbers behind it" that a reason computed from numbers can point to. */
export type NumbersPanel = "ledger" | "twins" | "valuation";

export interface ReportContextValue {
  report: UnderwritingReport;
  runId: string;
  graph: GraphSpec | undefined;
  canCorrect: boolean;
  focus: FocusClaim | undefined;
  jumpToClaim: (id: string) => void;
  /** Opens "The numbers behind it" and scrolls to the panel that produced a figure. */
  jumpToNumbers: (panel: NumbersPanel) => void;
  openCorrection: (seed: CorrectionSeed) => void;
}

export const ReportContext = createContext<ReportContextValue | null>(null);

export function useReportContext(): ReportContextValue {
  const value = useContext(ReportContext);
  if (!value) throw new Error("useReportContext needs a ReportContext provider");
  return value;
}
