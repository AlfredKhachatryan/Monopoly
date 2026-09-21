// Game rules the client needs for display and for enabling buttons.
// The server (supabase/migrations/20260918140000_game_rules.sql) is the
// authority; the numbers here must stay identical to the SQL.

// rentMods() is the diplomacy layer's rent multiplier (war/allyTax/traitor);
// see rentFor()'s comment below for why importing it here is safe despite
// diplomacy.js importing playerByFig back from this file.
import { rentMods } from "./diplomacy";

// Post-playtest rebalance: games ran long, so income is down and rent is up.
// Passing Start pays less, streets earn more per turn, and buildings bite
// harder — the target is a 30-45 minute game for six players.
export const START_BONUS = 150; // was 200: fewer laps' worth of free money
export const JAIL_FINE = 50; // unchanged, and it goes to the BANK, not the pot
export const JAIL_MAX_TURNS = 3;
export const HOTEL = 5; // houses value that means "hotel"
// 0-4 houses, hotel. Was [1,5,15,45,60,75]; every step up is steeper now so
// that the first house or two already hurts and games end sooner.
export const HOUSE_RENT_MULT = [1, 6, 18, 50, 70, 90];
// 1-4 railroads owned. Was [25,50,100,200]: a 40% lift, since railroads are the
// only set nobody can build on and they were falling behind developed streets.
export const RAILROAD_RENT = [35, 70, 140, 280];

// The Weed Farm (cell 28) carries a counter instead of a rent. It starts at
// FARM_INCOME_START, grows by FARM_INCOME_STEP every time a NON-owner lands on
// it (they themselves pay nothing), and the owner collects the whole counter —
// paid by the bank — when the OWNER lands on their own farm, which resets it
// back to FARM_INCOME_START. There is no passive per-lap payout. The server
// owns these mutations; the numbers are here so the UI can say what is coming.
export const FARM_INCOME_START = 50;
export const FARM_INCOME_STEP = 150;

// Room cap is 6 players; 8 figures are selectable so a full room always has
// two spares to pick from.
export const MAX_PLAYERS = 6;

export const FIGS = [
  "fig0",
  "fig1",
  "fig2",
  "fig3",
  "fig4",
  "fig5",
  "fig6",
  "fig7",
];
export const FIG_COLORS = {
  fig0: "#E0284C",
  fig1: "#0B7A7A",
  fig2: "#7A4FE0",
  fig3: "#A86400",
  fig4: "#C2358A",
  fig5: "#56606E",
  fig6: "#1E63C8",
  fig7: "#4C9A1E",
};

export function cellKind(cell) {
  if (!cell) return null;
  if (cell.start) return "start";
  if (cell.tax) return "tax";
  if (cell.chance) return "chance";
  if (cell.community) return "community";
  if (cell.jail) return "jail";
  if (cell.GTJ) return "gtj";
  if (cell.parking) return "parking";
  if (cell.road) return "road";
  if (cell.casino) return "casino";
  if (cell.farm) return "farm";
  return "street";
}

// What can change hands. The Casino is deliberately NOT here: the bank is the
// house, so it is never bought, auctioned or traded. The Weed Farm is, and goes
// through the same auction and trade flow as any street or railroad.
export const isProperty = (cell) =>
  ["street", "road", "farm"].includes(cellKind(cell));

export function ownerOf(cell) {
  return FIGS.find((f) => cell?.bought?.[f]) || null;
}

export function priceOf(cell) {
  switch (cellKind(cell)) {
    case "street":
      return cell.price;
    case "road":
      return cell.price || 200;
    // Mirrors mono_price(): the farm falls back to the 150 the utility it
    // replaced carried, for a board seeded before the farm existed.
    case "farm":
      return cell.price || 150;
    // The Casino falls through to null on purpose — nothing may ever put a
    // price on it, so every "can I buy this?" check answers no by itself.
    default:
      return null;
  }
}

// The Weed Farm's live counter: what its owner would collect by landing on it
// right now. Reads the seeded/served value and falls back to the opening $50 so
// a board that predates the farm still renders a number instead of NaN.
export function farmIncome(cell) {
  if (cellKind(cell) !== "farm") return 0;
  const n = Number(cell?.income);
  return Number.isFinite(n) && n > 0 ? n : FARM_INCOME_START;
}

export function housePrice(cellId) {
  const id = Number(cellId);
  if (id <= 10) return 50;
  if (id <= 20) return 100;
  if (id <= 30) return 150;
  return 200;
}

// Streets sharing the colour of `color`, in board order.
export function setCells(board, color) {
  return Object.values(board || {})
    .filter((c) => cellKind(c) === "street" && c.color === color)
    .sort((a, b) => a.id - b.id);
}

export function ownsSet(board, fig, color) {
  const set = setCells(board, color);
  return set.length > 0 && set.every((c) => ownerOf(c) === fig);
}

export function ownedBy(board, fig) {
  if (!board || !fig) return [];
  return Object.values(board)
    .filter((c) => c.bought?.[fig])
    .sort((a, b) => a.id - b.id);
}

function countOwned(board, fig, kind) {
  return Object.values(board || {}).filter(
    (c) => cellKind(c) === kind && ownerOf(c) === fig,
  ).length;
}

// Rent for one street at a given house count, from the owner's point of view.
// Base rent is price/8 (it was price/10 before the rebalance) — streets had to
// pay for themselves faster for a six-player game to finish inside the hour.
export function streetRent(board, cell, houses) {
  const base = Math.floor((cell.price || 0) / 8);
  if (houses <= 0) {
    const owner = ownerOf(cell);
    return owner && ownsSet(board, owner, cell.color) ? base * 2 : base;
  }
  return base * HOUSE_RENT_MULT[Math.min(houses, HOTEL)];
}

// What a visitor pays right now for standing on cell `id`.
//
// The third argument used to be `diceSum`, which only the utilities needed.
// Both utilities are gone (Casino, Weed Farm), so the dice no longer enter into
// any rent — but a jailed owner does: while the owner sits in jail the property
// collects NOTHING, not for the owner, not for the pot, not for the bank. That
// fact lives on the players array, not on the board, so the signature now takes
// it. Pass the players array (the shape every screen already holds) or, when a
// caller only has the one fact, the boolean `true` for "the owner is in jail".
// Anything else — including a stale `diceSum` number from an un-updated call
// site — reads as "no jail information", which yields the old answer rather
// than a wrong one.
//
// `game` and `payerFig` (4th/5th args, both optional) are SPEC-DIPLOMACY.md's
// addition: rent now also depends on WHO is asking. When both are supplied,
// diplomacy.js's rentMods() is applied on top of the base rent below — no
// rent between allies, double rent across a war, +25% for the payer's own
// alliance tag, +25% for a lingering traitor brand, multiplied together and
// floored ONCE at the end (never per-step, or compounding rounding drift
// would make the same rent print differently depending on multiplier order).
// Either argument left out (most call sites do not know who is about to pay —
// a street card, an auction estimate, a TV overlay with no payer in view)
// must return EXACTLY what this function returned before diplomacy existed;
// importing rentMods here and gating it behind `game && payerFig` is what
// guarantees that rather than hoping every future edit keeps it true.
export function rentFor(board, id, players = null, game = null, payerFig = null) {
  const cell = board?.[id];
  const owner = ownerOf(cell);
  if (!owner) return 0;
  if (ownerInJail(players, owner)) return 0;
  const base = baseRentFor(board, cell, owner);
  if (base <= 0 || !game || !payerFig) return base;
  // diplomacy.js imports playerByFig from this file, so this is a circular
  // import the other way — safe because both sides only touch the other
  // module from inside a function body (here; canAlly/rentMods there), never
  // at module-eval time, so by the time either is actually called both
  // modules have finished loading. rentMods() is the single source of truth
  // for the mod order (war, then allyTax, then traitor) and the "floor once"
  // rule; nothing here re-derives it.
  const mods = rentMods(game, players, payerFig, owner);
  if (mods.zero) return 0;
  return Math.floor(base * mods.mult);
}

function baseRentFor(board, cell, owner) {
  switch (cellKind(cell)) {
    case "street":
      return streetRent(board, cell, cell.houses || 0);
    case "road":
      return RAILROAD_RENT[Math.max(countOwned(board, owner, "road") - 1, 0)];
    // The Weed Farm never charges a visitor: a non-owner pays nothing and the
    // counter grows instead. The Casino has no owner, so it never gets here.
    case "farm":
      return 0;
    default:
      return 0;
  }
}

// Is `fig`'s player currently in jail? Accepts the players array, a bare
// boolean (for callers that already know), or null/undefined/anything else,
// which means "unknown" and therefore "not in jail".
function ownerInJail(players, fig) {
  if (typeof players === "boolean") return players;
  if (!Array.isArray(players)) return false;
  return !!playerByFig(players, fig)?.inJail;
}

// Rows for the rent table on a street card: [label, amount][]
export function streetRentTable(board, cell) {
  const base = Math.floor((cell.price || 0) / 8);
  return [
    ["Rent", base],
    ["Colour set", base * 2],
    ["1 house", base * HOUSE_RENT_MULT[1]],
    ["2 houses", base * HOUSE_RENT_MULT[2]],
    ["3 houses", base * HOUSE_RENT_MULT[3]],
    ["4 houses", base * HOUSE_RENT_MULT[4]],
    ["Hotel", base * HOUSE_RENT_MULT[5]],
  ];
}

// Can `fig` put one more house (or the hotel) on street `id`?
// Mirrors the checks in game_action('build').
export function canBuild(board, fig, id, money = Infinity) {
  const cell = board?.[id];
  if (!cell || cellKind(cell) !== "street") return { ok: false, reason: "Not a street" };
  if (ownerOf(cell) !== fig) return { ok: false, reason: "Not yours" };
  if (!ownsSet(board, fig, cell.color))
    return { ok: false, reason: "Needs the whole colour set" };
  const houses = cell.houses || 0;
  if (houses >= HOTEL) return { ok: false, reason: "Hotel built" };
  const min = Math.min(...setCells(board, cell.color).map((c) => c.houses || 0));
  if (houses > min) return { ok: false, reason: "Build on the other streets first" };
  const price = housePrice(id);
  if (money < price) return { ok: false, reason: `Needs $${price}` };
  return { ok: true, price, hotel: houses === HOTEL - 1 };
}

// ---- auctions ------------------------------------------------------------
// The smallest step between bids, and the smallest first bid. Mirrors
// MIN_RAISE in game_action('auction_bid').
export const AUCTION_MIN_RAISE = 10;

// What the next bid has to be: one step above the standing bid, or the step
// itself when nobody has bid yet. Never below AUCTION_MIN_RAISE.
export function nextBid(auction, step = AUCTION_MIN_RAISE) {
  const s = Math.max(Number(step) || 0, AUCTION_MIN_RAISE);
  const bid = Number(auction?.bid) || 0;
  return bid > 0 ? bid + s : Math.max(s, AUCTION_MIN_RAISE);
}

// ---- trading -------------------------------------------------------------
// A cell may change hands when it is ownable, someone owns it, and no cell of
// its colour set carries a building — houses are not tradable, so a set with
// buildings simply cannot be offered. Railroads and the Weed Farm have no sets
// and are always tradable. The Casino is not ownable, so isProperty() already
// rules it out.
export function tradable(board, cellId) {
  const cell = board?.[cellId];
  if (!cell || !isProperty(cell)) return false;
  if (!ownerOf(cell)) return false;
  if (cellKind(cell) !== "street") return true;
  const set = setCells(board, cell.color);
  return !set.some((c) => (c.houses || 0) > 0);
}

// The cells `fig` owns that could go into an offer, in board order.
export function tradableOwnedBy(board, fig) {
  return ownedBy(board, fig).filter((c) => tradable(board, c.id));
}

export const playerByFig = (players, fig) =>
  (players || []).find((p) => p.figure === fig) || null;

export const nameOfFig = (players, fig) => playerByFig(players, fig)?.name || fig;

// Colour the phone screen takes on while you stand on a cell. Streets have a
// colour of their own; everything else is "#000" on the board, so it falls back
// to the colour its icon already uses on the card.
//
// The governing rule after the palette rework: a SATURATED hue means "street
// group", and nothing else on the board may borrow one. Gold in particular used
// to be the railroad accent, the Community deck accent AND a street group at the
// same time, which is most of why the board read as a smear of similar colours.
// So the specials moved off the hue wheel:
//   - the specials separate by LIGHTNESS and chroma, not by hue. Hue is the one
//     axis with nothing left in it: all eight are spoken for by street groups.
//     So the specials sit at the extremes of lightness, where no group lives —
//     railroads are near-white polished steel, tax/chance/casino/farm are dark.
//     (The first attempt made them all neutral greys instead. Measured, road
//     and tax came out as the SAME hex, and four of six fell below chroma 13,
//     so on a TV they were one smear of grey. Corrected 2026-09-21.)
//   - jail / go to jail / free parking keep the old slate; they were never on
//     the wheel to begin with.
//   - the two decks are tellable apart by both temperature AND lightness now:
//     a deep violet for Chance against a warm mid ochre for Community.
//   - the Casino is felt green with brass trim and the Weed Farm a deep herbal
//     green; both sit darker than the Green (#24a75a) and Teal (#0fb5b5) street
//     groups by enough to clear dE 25, so they never read as a colour set.
//   - Start is the one cell allowed an accent of its own. It is a pale
//     champagne: celebratory by brightness instead of by hue, which keeps it off
//     the wheel. readableOn() flips its text to dark automatically.
// The non-street cells. These used to be "neutral/metallic" on the theory that a
// saturated hue should mean "street group" and nothing else — but that squeezed
// five different families into one narrow band of grey and they stopped being
// tellable apart. Measured, the old set was indefensible: road and tax were the
// SAME hex (dE 0.0), road/tax vs jail was dE 19, chance vs jail dE 20, and four
// of the six sat below chroma 13, i.e. they all rendered as slightly different
// greys on a TV across a room.
//
// What separates them now is lightness and chroma, not hue — which is the one
// axis still free, because every hue on the wheel already belongs to a street
// group. The specials live at the EXTREMES of lightness (road is near-white at
// L 83, tax/chance/casino/farm are dark at L 24-37) while the eight street
// groups all sit mid-bright and saturated. A cell can therefore share a hue
// family with a group and still never be confused with one.
//
// Every pair below clears dE 25 against every other special AND against all
// eight group hues; the tightest pairs are casino/farm at 27.8 and
// community/Orange at 29.1. If you change one of these, re-check it against
// both sets — the wheel is full and there is no slack left.
const KIND_ACCENT = {
  start: "#ffe9b8", // pale champagne, L 93 — the brightest thing on the board
  tax: "#66232f", // deep oxblood, L 24 — money leaving, and far below Crimson
  chance: "#5b34a6", // deep violet, L 33 — dark where Indigo is bright
  community: "#b5762e", // warm ochre, L 55 — the one mid-lightness special
  jail: "#5f6b7a", // slate, unchanged
  gtj: "#5f6b7a",
  parking: "#5f6b7a",
  road: "#c3d0de", // polished steel, L 83 — rails read by being LIGHT
  casino: "#0d5c46", // felt green (brass trim #b8912f lives on the cell)
  farm: "#33631c", // deep herbal green, pushed off the Green group
};

export function accentFor(cell) {
  if (!cell) return "#5f6b7a"; // slate: an unknown cell is neutral, not a railroad
  const kind = cellKind(cell);
  if (kind === "street" && cell.color && cell.color !== "#000") return cell.color;
  return KIND_ACCENT[kind] || "#5f6b7a";
}

// Black or white, whichever stays readable on top of `hex`. Needed because the
// accent swings from #66232f to #ffe9b8 and white text fails on the light end.
// sRGB relative luminance, WCAG crossover is about 0.18.
export function readableOn(hex) {
  if (typeof hex !== "string" || hex.length < 7) return "#ffffff";
  const ch = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return l > 0.18 ? "#14121b" : "#ffffff";
}
