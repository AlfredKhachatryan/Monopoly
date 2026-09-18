// Shared board-space display helpers, used by the ticket (Ticket.jsx) and by
// the sheets so a space reads the same everywhere: the name of its colour
// group, the label for its kind, and the house/hotel pips.
//
// CONTRACT: GROUP_NAMES, KIND_LABEL, groupLabel(cell), Pips({ houses,
// className }), hasCyrillic(s). Keep this file free of anything screen- or
// sheet-specific — it is imported by files on both sides of this split.

import { HOTEL, cellKind } from "../Hooks/rules";
import b from "./bits.module.css";

// Human names for this board's eight street colours, keyed by the lower-cased
// hex the cells carry (src/Hooks/baseState.jsx), cross-checked against the
// board's actual colours.
export const GROUP_NAMES = {
  "#d92650": "Crimson",
  "#eb75e7": "Orchid",
  "#f5786c": "Salmon",
  "#1f8f5d": "Green",
  "#1f8fff": "Azure",
  "#f56cc6": "Pink",
  "#6f6cf5": "Indigo",
  "#de951f": "Gold",
};

// Keyed by what cellKind() (src/Hooks/rules.js) returns.
export const KIND_LABEL = {
  street: "Street",
  road: "Railroad",
  communal: "Utility",
  chance: "Chance",
  community: "Community Chest",
  tax: "Tax",
  jail: "Jail",
  gtj: "Go To Jail",
  parking: "Free Parking",
  start: "Start",
};

// The name a space reads by: its colour-group name for a street, otherwise
// the label for its kind. "" when neither is known (no cell, or an
// unrecognised kind).
export function groupLabel(cell) {
  const kind = cellKind(cell);
  if (kind === "street") {
    return GROUP_NAMES[String(cell?.color || "").toLowerCase()] || KIND_LABEL.street;
  }
  return KIND_LABEL[kind] || "";
}

// Small square pips for 1-4 houses, a wide bar for a hotel — plus a
// visually-hidden text equivalent, since the pips alone say nothing to a
// screen reader. Safe on any input: 0, undefined, null, NaN or a string all
// render nothing.
export function Pips({ houses, className = "" }) {
  const n = Math.round(Number(houses));
  if (!Number.isFinite(n) || n <= 0) return null;
  const hotel = n >= HOTEL;
  const label = hotel ? "Hotel" : `${n} house${n === 1 ? "" : "s"}`;
  return (
    <span className={`${b.pips} ${className}`}>
      {hotel ? <b /> : Array.from({ length: Math.min(n, 4) }, (_, i) => <i key={i} />)}
      <span className={b.sr}>{label}</span>
    </span>
  );
}

// This board's names are Russian as often as not; used to set lang="ru" on
// the text so assistive tech and font shaping treat it correctly.
export const hasCyrillic = (s) => /[Ѐ-ӿ]/.test(String(s ?? ""));
