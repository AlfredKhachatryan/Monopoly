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
import minecraftRaw from "../Images/marks/minecraft.svg?raw";
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
const MARK_BY_HEADER = {
  minecraft: pathD(minecraftRaw, "minecraft.svg"),
  lol: pathD(leagueoflegendsRaw, "leagueoflegends.svg"),
  ubisoft: pathD(ubisoftRaw, "ubisoft.svg"),
  egs: pathD(epicgamesRaw, "epicgames.svg"),
  steam: pathD(steamRaw, "steam.svg"),
  spotify: pathD(spotifyRaw, "spotify.svg"),
  discord: pathD(discordRaw, "discord.svg"),
  windows: pathD(windows11Raw, "windows11.svg"),
  "dota 2": pathD(dota2Raw, "dota2.svg"),
};

function normalize(header) {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Returns the brand's `<path d>` string for `cell`, or null when it has no
// logo (see MARK_BY_HEADER above).
export function markFor(cell) {
  return MARK_BY_HEADER[normalize(cell?.header)] ?? null;
}
