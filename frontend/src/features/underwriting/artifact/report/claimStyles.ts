import type { Claim } from "../../../../api/types";

export const STANCE_STYLE: Record<Claim["stance"], string> = {
  pro: "border-emerald-300 bg-emerald-50 text-emerald-800",
  con: "border-red-300 bg-red-50 text-red-800",
  neutral: "border-slate-300 bg-slate-50 text-slate-700",
};

export const STANCE_BAR: Record<Claim["stance"], string> = {
  pro: "bg-emerald-500",
  con: "bg-red-500",
  neutral: "bg-slate-400",
};

export const STATUS_STYLE: Record<Claim["status"], string> = {
  accepted: "border-slate-200 text-muted",
  rejected: "border-red-300 bg-red-50 text-red-700",
  downgraded: "border-amber-300 bg-amber-50 text-amber-800",
};
