// Shared board-space display helpers, used by the ticket (Ticket.jsx) and by
// the sheets so a space reads the same everywhere: the name of its colour
// group, the label for its kind, and the house/hotel pips.
//
// CONTRACT: GROUP_NAMES, KIND_LABEL, groupLabel(cell), Pips({ houses,
// className }), hasCyrillic(s). Keep this file free of anything screen- or
// sheet-specific — it is imported by files on both sides of this split.

import { Home, Hotel } from "lucide-react";
import { FIG_COLORS, HOTEL, cellKind } from "../Hooks/rules";
import b from "./bits.module.css";

// Human names for this board's eight street colours, keyed by the lower-cased
// hex the cells carry (src/Hooks/baseState.jsx), cross-checked against the
// board's actual colours.
//
// REKEYED with the palette rework (spec §11): the eight groups used to collapse
// into four near-identical reds and a gold that was also the railroad accent and
// the Community deck accent, so they were replaced with eight hues evenly spaced
// round the wheel. This map is keyed by HEX, which means it silently returns
// nothing the moment the hexes move — every name here must match
// src/Hooks/baseState.jsx exactly, in lower case. Three of them were also
// renamed to match what they now actually look like: Salmon → Orange,
// Orchid → Teal, Pink → Magenta.
export const GROUP_NAMES = {
  "#e02749": "Crimson", // cells 2, 4
  "#0fb5b5": "Teal", // 7, 9, 10
  "#f2762a": "Orange", // 12, 14, 15
  "#24a75a": "Green", // 17, 19, 20
  "#2b7fff": "Azure", // 22, 24, 25
  "#e451c4": "Magenta", // 27, 29, 30
  "#e8b224": "Gold", // 32, 34, 35
  "#7b5cff": "Indigo", // 38, 40
};

// Keyed by what cellKind() (src/Hooks/rules.js) returns. `communal` is gone
// with the two utilities it stood for: cell 13 is the Casino (the bank is the
// house, so it is never owned) and cell 28 is the Weed Farm (owned, but it pays
// a counter rather than a rent).
export const KIND_LABEL = {
  street: "Street",
  road: "Railroad",
  casino: "Casino",
  farm: "Weed Farm",
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

// One `Home` glyph per house and a single `Hotel` glyph for the hotel, plus a
// visually-hidden text equivalent, since the icons alone say nothing to a
// screen reader. Safe on any input: 0, undefined, null, NaN or a string all
// render nothing.
//
// They used to be four green squares and one red bar (spec §9). Two problems
// with that: at 8px a square is a smudge on a TV across a room, and the red bar
// borrowed --crim, which made a hotel look like it belonged to whoever owns the
// red group rather than to its actual owner. Line icons read at a glance and
// carry a colour of their own, so `fig` tints them in the OWNER's figure colour
// — buildings and ownership then say the same thing in the same hue. Without
// `fig` they fall back to currentColor, which is what the ticket and the sheets
// want (there the surrounding card already establishes whose it is).
export function Pips({ houses, className = "", fig = null }) {
  const n = Math.round(Number(houses));
  if (!Number.isFinite(n) || n <= 0) return null;
  const hotel = n >= HOTEL;
  const label = hotel ? "Hotel" : `${n} house${n === 1 ? "" : "s"}`;
  // --pip-ink rather than a plain `color`: an inline colour would beat every
  // stylesheet, and two of the eight figures (fig5 mummy slate #56606E, fig6
  // octopus blue #1E63C8) are under 3:1 against the board's --surface — the
  // same fact the token ring in tv.module.css exists for. Handing the colour
  // over as a custom property lets the surface it lands on lift it towards its
  // own ink without any of this having to know which surface that is.
  const tint = fig ? FIG_COLORS[fig] : null;
  return (
    <span className={`${b.pips} ${className}`} style={tint ? { "--pip-ink": tint } : undefined}>
      {/* `size` is left to CSS (--pip in bits.module.css): a tile, a slot chip
          and a sheet row each want a different one, and passing a number here
          would bake the tile's into all three. */}
      {hotel ? (
        <Hotel aria-hidden="true" />
      ) : (
        Array.from({ length: Math.min(n, 4) }, (_, i) => <Home key={i} aria-hidden="true" />)
      )}
      <span className={b.sr}>{label}</span>
    </span>
  );
}

// This board's names are Russian as often as not; used to set lang="ru" on
// the text so assistive tech and font shaping treat it correctly.
export const hasCyrillic = (s) => /[Ѐ-ӿ]/.test(String(s ?? ""));
