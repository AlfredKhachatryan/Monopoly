// Game rules the client needs for display and for enabling buttons.
// The server (supabase/migrations/20260918140000_game_rules.sql) is the
// authority; the numbers here must stay identical to the SQL.

export const START_BONUS = 200;
export const JAIL_FINE = 50;
export const JAIL_MAX_TURNS = 3;
export const HOTEL = 5; // houses value that means "hotel"
export const HOUSE_RENT_MULT = [1, 5, 15, 45, 60, 75]; // 0-4 houses, hotel
export const RAILROAD_RENT = [25, 50, 100, 200]; // 1-4 railroads owned
export const UTILITY_MULT = [4, 10]; // one / both utilities owned

export const FIGS = ["fig0", "fig1", "fig2", "fig3"];
export const FIG_COLORS = {
  fig0: "#E0284C",
  fig1: "#0B7A7A",
  fig2: "#7A4FE0",
  fig3: "#A86400",
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
  if (cell.communal) return "communal";
  return "street";
}

export const isProperty = (cell) =>
  ["street", "road", "communal"].includes(cellKind(cell));

export function ownerOf(cell) {
  return FIGS.find((f) => cell?.bought?.[f]) || null;
}

export function priceOf(cell) {
  switch (cellKind(cell)) {
    case "street":
      return cell.price;
    case "road":
      return cell.price || 200;
    case "communal":
      return cell.price || 150;
    default:
      return null;
  }
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
export function streetRent(board, cell, houses) {
  const base = Math.floor((cell.price || 0) / 10);
  if (houses <= 0) {
    const owner = ownerOf(cell);
    return owner && ownsSet(board, owner, cell.color) ? base * 2 : base;
  }
  return base * HOUSE_RENT_MULT[Math.min(houses, HOTEL)];
}

// What a visitor pays right now for standing on cell `id`.
export function rentFor(board, id, diceSum = 7) {
  const cell = board?.[id];
  const owner = ownerOf(cell);
  if (!owner) return 0;
  switch (cellKind(cell)) {
    case "street":
      return streetRent(board, cell, cell.houses || 0);
    case "road":
      return RAILROAD_RENT[Math.max(countOwned(board, owner, "road") - 1, 0)];
    case "communal":
      return (
        diceSum *
        UTILITY_MULT[countOwned(board, owner, "communal") >= 2 ? 1 : 0]
      );
    default:
      return 0;
  }
}

// Rows for the rent table on a street card: [label, amount][]
export function streetRentTable(board, cell) {
  const base = Math.floor((cell.price || 0) / 10);
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
// buildings simply cannot be offered. Railroads and utilities have no sets and
// are always tradable.
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
const KIND_ACCENT = {
  start: "#d92650",
  tax: "#1f8f5d",
  chance: "#d92650",
  community: "#de951f",
  jail: "#5f6b7a",
  gtj: "#5f6b7a",
  parking: "#5f6b7a",
  road: "#de951f",
};

export function accentFor(cell) {
  if (!cell) return "#d92650";
  const kind = cellKind(cell);
  if (kind === "street" && cell.color && cell.color !== "#000") return cell.color;
  if (kind === "communal") return cell.info === "Water" ? "#1f8fff" : "#de951f";
  return KIND_ACCENT[kind] || "#d92650";
}

// Black or white, whichever stays readable on top of `hex`. Needed because the
// accent swings from #0942b3 to #de951f and white text fails on the light end.
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
