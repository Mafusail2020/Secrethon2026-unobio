import type { Claim } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { InfoTip } from "../../../../components/ui/InfoTip";
import { LABEL_HELP } from "./labels";

export function LabelChip({ label }: { label: Claim["label"] }) {
  const help = LABEL_HELP[label];
  return (
    <InfoTip title={help.title} body={help.body}>
      <Badge className="border-slate-300 text-slate-700">{label}</Badge>
    </InfoTip>
  );
}
