// Groups board cells by colour, in the order the colour sets appear on the
// board (railroads, tax and every other special, colour "#000", come last).
// Returns [[color, cells], ...].
//
// REKEYED with the palette rework (spec §11). This list is matched against the
// raw `cell.color` string, so it is only ever as right as the hexes in
// src/Hooks/baseState.jsx — when those moved, every entry here stopped matching
// and the whole board silently fell into the "rest" bucket at the end, in
// Object.keys order. The order below is BOARD order (first cell of each group),
// not the order of the spec's palette table:
//
//   2,4 crimson · 7,9,10 teal · 12,14,15 orange · 17,19,20 green
//   22,24,25 azure · 27,29,30 magenta · 32,34,35 gold · 38,40 indigo
//
// "#000" is not a colour, it is the sentinel every non-street cell carries, and
// it stays pinned to the end so the specials sort below the eight sets.
//
// Matching is case-insensitive on purpose: the old list was written in mixed
// case ("#D92650" against a board that said "#d92650"), which is exactly the
// kind of silent miss this comment exists to stop happening again.
const COLOR_ORDER = [
  "#e02749",
  "#0fb5b5",
  "#f2762a",
  "#24a75a",
  "#2b7fff",
  "#e451c4",
  "#e8b224",
  "#7b5cff",
  "#000",
];

const rank = (color) => COLOR_ORDER.indexOf(String(color || "").toLowerCase());

export const groupByColor = (cells) => {
  const grouped = {};
  for (const cell of cells || []) {
    (grouped[cell.color] ||= []).push(cell);
  }

  const keys = Object.keys(grouped);
  const known = keys
    .filter((c) => rank(c) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => [c, grouped[c]]);
  const rest = keys.filter((c) => rank(c) < 0).map((c) => [c, grouped[c]]);
  return [...known, ...rest];
};
