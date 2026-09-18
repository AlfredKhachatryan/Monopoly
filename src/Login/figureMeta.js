// What this screen needs to know about the four characters, read from the
// shared art module rather than restated here.
//
// src/Client/figures.js is being reshaped by the figure swap (new flat
// monsters: Imp, Cyclops, Specter, Yeti, as full/token/silhouette SVGs). A
// namespace import is used on purpose: a named import of an export that does
// not exist yet is a link-time error, while `mod.THING` is simply undefined
// until it lands. So this file reads whatever is there and falls back to the
// documented values (design-reference/figures-manual.html) until it is.
//
// Colours are NEVER restated: they come from FIG_COLORS in src/Hooks/rules.js,
// so the aura, the ring and the button follow the swap on their own.

import * as figures from "../Client/figures";

export const FIGS = ["fig0", "fig1", "fig2", "fig3"];

// design-reference/figures-manual.html, §"The four figures".
const NAME_FALLBACK = { fig0: "Imp", fig1: "Cyclops", fig2: "Specter", fig3: "Yeti" };

export const FIGURE_NAME = figures.FIGURE_NAME ?? NAME_FALLBACK;

export const nameOf = (fig) => FIGURE_NAME[fig] ?? NAME_FALLBACK[fig] ?? "Figure";

// One-colour SVGs, keyed the same way. Undefined until the swap lands, which
// is what FigurePicker checks before choosing the silhouette treatment over
// the greyscale one.
export const FIGURE_SILHOUETTE = figures.FIGURE_SILHOUETTE ?? null;

// width / height of the full figure art, so this screen can work out how tall
// four of them may be inside a row of a given width. The new art is 160x200.
const size = figures.FIGURE_SIZE ?? { width: 160, height: 200 };
export const FIGURE_ASPECT = figures.FIGURE_ASPECT ?? size.width / size.height;
