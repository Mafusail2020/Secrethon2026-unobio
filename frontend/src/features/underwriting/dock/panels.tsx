import { ViewContent, type TabId } from "../artifact/ViewContent";
import { useViewData } from "./viewData";

function View({ tab }: { tab: TabId }) {
  return <ViewContent tab={tab} {...useViewData()} />;
}

export const ReportPanel = () => <View tab="report" />;
export const GraphPanel = () => <View tab="graph" />;
export const SourcesPanel = () => <View tab="sources" />;
export const LogsPanel = () => <View tab="logs" />;
