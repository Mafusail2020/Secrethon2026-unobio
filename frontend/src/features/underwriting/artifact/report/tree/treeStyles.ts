import type { Standing } from "../reportTree";

export const STANDING_STYLE: Record<Standing, string> = {
  favourable: "border-emerald-300 bg-emerald-50 text-emerald-800",
  mixed: "border-amber-300 bg-amber-50 text-amber-800",
  unfavourable: "border-red-300 bg-red-50 text-red-800",
  unknown: "border-slate-300 bg-slate-50 text-slate-600",
};

/** The colour of a card's left edge, so the four standings read down the page before any text does. */
export const STANDING_EDGE: Record<Standing, string> = {
  favourable: "border-l-emerald-500",
  mixed: "border-l-amber-400",
  unfavourable: "border-l-red-500",
  unknown: "border-l-slate-300",
};
