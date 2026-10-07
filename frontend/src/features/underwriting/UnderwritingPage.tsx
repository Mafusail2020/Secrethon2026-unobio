import { useParams } from "react-router-dom";
import { RunWorkspace } from "./RunWorkspace";

export default function UnderwritingPage() {
  const { runId } = useParams();
  // a different run is a fresh workspace: stream state and tab selection reset
  return <RunWorkspace key={runId ?? "new"} runId={runId} />;
}
