// Brand logos for the board cells that name a real product (src/Hooks/baseState.jsx
// `header`). Everything else -- the Cyrillic streets, "For Honor", "Rainbox 6
// Siege", and every special/railroad/utility cell -- has no entry and keeps
// Mark.jsx's monogram/icon fallback.
//
// Each owner-supplied file is a single-path, viewBox="0 0 24 24" simple-icons
// style SVG. Rather than use it as a `mask-image` -- Chrome silently drops a
// mask whose source SVG has no intrinsic width/height, which every one of
// these files lacks (viewBox only), and the "mask" then paints as a plain
// filled square instead of the logo shape -- the single <path d="…"> is
// pulled out once, at module load, with `?raw` (Vite serves the file's text
// instead of a URL) and a plain regex (there is exactly one <path> per file).
// Mark.jsx renders that `d` inside its own inline <svg fill="currentColor">,
// which has none of the mask's intrinsic-size problems and follows
// currentColor exactly, same as any other icon in this file.
import discordRaw from "../Images/marks/discord.svg?raw";
import dota2Raw from "../Images/marks/dota2.svg?raw";
import epicgamesRaw from "../Images/marks/epicgames.svg?raw";
import leagueoflegendsRaw from "../Images/marks/leagueoflegends.svg?raw";
import spotifyRaw from "../Images/marks/spotify.svg?raw";
import steamRaw from "../Images/marks/steam.svg?raw";
import ubisoftRaw from "../Images/marks/ubisoft.svg?raw";
import windows11Raw from "../Images/marks/windows11.svg?raw";

function pathD(raw, name) {
  const found = raw.match(/<path[^>]*\sd="([^"]+)"/);
  if (!found) throw new Error(`marks.js: no <path d="…"> found in ${name}`);
  return found[1];
}

// Keyed by the cell's `header`, normalised (trimmed, lower-cased, internal
// whitespace collapsed to single spaces) -- an explicit map, no fuzzy
// matching, so a header that isn't listed here is unambiguously "no logo".
//
// Windows: the owner supplied both windows.svg and windows11.svg, but the two
// files carry byte-identical <path> data (only the <title> differs), so there
// is no pixel difference to judge "reads better at 16px" between them.
// windows11 was picked as the current, still-supported mark.
// Every entry is `{ d, viewBox }`. `viewBox` defaults to the standard
// simple-icons "0 0 24 24" square; a handful of brand marks are wordmarks
// rather than glyphs and are cropped tighter below (see MARK_VIEWBOX,
// underneath).
//
// MINECRAFT is the one entry that is NOT a brand file. The supplied
// simple-icons asset is a WORDMARK: measured, its path only occupies
// y = [10, 14] of the 0..24 box — a 24x4 sliver. An earlier pass cropped the
// viewBox to "0 9 24 6" to make it fill more of the square, which does make it
// bigger but cannot make it legible: at a 44px tile it is still six letters
// across 44 pixels, and at chip and event-row size it is a smudge. There is no
// crop of a wordmark that turns it into a glyph.
//
// So this one is drawn here instead, in the same single-path, single-colour,
// fills-the-box style as every other mark: the isometric block, which is what
// the game actually signifies and what reads at any size. Three closed
// subpaths — top, left face, right face — each shrunk about its own centroid
// so the ~1px gaps between them are the cube's edges. Nothing is stroked, so it
// scales cleanly, and being one <path d> it goes through Mark.jsx untouched
// like the rest.
//
//   top    rhombus  (12,2) (22,8) (12,14) (2,8),   scaled 0.84 about (12,8)
//   left   quad     (2,8) (12,14) (12,22) (2,16),  scaled 0.86 about (7,15)
//   right  quad     (22,8) (12,14) (12,22) (22,16), scaled 0.86 about (17,15)
//
// The scale factors are what set the width of the gaps, and they are chosen for
// the SMALLEST place this is drawn (the 18px marker on an event row), not the
// 44px tile: at 0.9 the gaps came out under a device pixel there and the three
// faces fused into a plain hexagon. ~1.7 user units survives 18px on a 2x
// screen and still looks like an edge, not a moat, at 88px on the TV.
const MINECRAFT_BLOCK =
  "M12 2.96L20.4 8L12 13.04L3.6 8Z" +
  "M2.7 8.98L11.3 14.14L11.3 20.98L2.7 15.82Z" +
  "M21.3 8.98L21.3 15.82L12.7 20.98L12.7 14.14Z";

const MARK_BY_HEADER = {
  minecraft: MINECRAFT_BLOCK,
  lol: pathD(leagueoflegendsRaw, "leagueoflegends.svg"),
  ubisoft: pathD(ubisoftRaw, "ubisoft.svg"),
  egs: pathD(epicgamesRaw, "epicgames.svg"),
  steam: pathD(steamRaw, "steam.svg"),
  spotify: pathD(spotifyRaw, "spotify.svg"),
  discord: pathD(discordRaw, "discord.svg"),
  windows: pathD(windows11Raw, "windows11.svg"),
  "dota 2": pathD(dota2Raw, "dota2.svg"),
};

// Per-mark viewBox overrides, for a brand file whose glyph does not fill the
// standard 0..24 square. Empty now: the one entry was the Minecraft wordmark
// crop, and that mark is drawn as a real glyph above instead, which fills the
// box on its own.
const MARK_VIEWBOX = {};

function normalize(header) {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Returns `{ d, viewBox }` for `cell`'s brand logo, or null when it has no
// logo (see MARK_BY_HEADER above).
export function markFor(cell) {
  const key = normalize(cell?.header);
  const d = MARK_BY_HEADER[key];
  if (!d) return null;
  return { d, viewBox: MARK_VIEWBOX[key] || "0 0 24 24" };
}
