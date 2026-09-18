// How big a tile's name may be, and how far an occupied tile pushes its text
// clear of the figure standing on it.
//
// A tile name NEVER breaks inside a word (the CSS says so), so a single long
// word — "Minecraft", "Community", "Фирмини" — either fits the column or it
// does not. When it does not, stepping the type down one or two pixels is
// always better than cutting the word: "Minecraft" reads, "Minecraf / t" and
// "Minecra…" do not.
//
// The widths are measured with canvas `measureText` in the real font rather
// than estimated from character counts: this board mixes Latin and Cyrillic,
// and Manrope's advance widths differ by a factor of 1.4 between them ("Молл"
// is as wide as "Honor" with one fewer letter), so any per-character constant
// is wrong for half the board. Results are cached per word and size, so the
// whole board costs a few dozen measurements once.

// The text column's content width per side, straight out of tv.module.css:
//   rows    ~105px tile − 4px padding × 2
//   corner   150px tile − 4px padding × 2
//   flanks   150px tile − 12 − 8 padding − 32px mark − 6px gap − 20px kept
//            free, always, for the owner dot in the corner above
//
// NOTHING here depends on who is standing on the tile or who owns it: a tile
// must look identical whether or not there are pieces on it, so the fit is a
// function of the name and the side of the board, and only of those.
const AVAIL = { b: 97, t: 97, c: 142, l: 72, r: 72 };
// The base font size per side, matching .name in tv.module.css.
const BASE = { b: 14, t: 14, c: 16, l: 13, r: 13 };
const STEPS = 2; // 14 → 13 → 12 (16 → 15 → 14 on a corner)

const cache = new Map();
let ctx;

function context() {
  if (ctx !== undefined) return ctx;
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

export function wordWidth(text, size) {
  const key = `${size}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const c = context();
  // No canvas (or a browser that refuses one): assume the widest advance this
  // board actually contains, so we step DOWN rather than cut a word.
  const w = c
    ? ((c.font = `800 ${size}px Manrope, system-ui, sans-serif`), c.measureText(text).width)
    : Array.from(text).length * size * 0.74;
  cache.set(key, w);
  return w;
}

// Measurements taken before Manrope arrives are in the fallback font and wrong;
// BoardGrid throws them away once the webfont is ready.
export function clearFitCache() {
  cache.clear();
}

export function fontsReady() {
  try {
    return document.fonts ? document.fonts.check('800 14px "Manrope"') : true;
  } catch {
    return true;
  }
}

export function longestWord(name) {
  let out = "";
  for (const w of String(name ?? "").trim().split(/\s+/)) {
    if (Array.from(w).length > Array.from(out).length) out = w;
  }
  return out;
}

// -> how many steps down the name goes (0-2) so its longest word fits whole.
export function fitTile(name, side) {
  const base = BASE[side] ?? 14;
  const avail = AVAIL[side] ?? 97;
  const word = longestWord(name);
  if (!word) return 0;
  for (let step = 0; step <= STEPS; step++) {
    if (wordWidth(word, base - step) <= avail) return step;
  }
  // Nothing fits: smallest type, and the ellipsis takes over — but on a whole
  // word, never inside one.
  return STEPS;
}
