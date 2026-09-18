// CONTRACT (shared with the sheets): Tok({ player, size, className, plain }).
//
// The round player token. For a known figure at a readable size it's that
// figure's own token art (a filled circle in the figure's colour, a white
// inner ring, and its face — see src/Images/figures/); otherwise
// (unknown/missing figure, or too small to read the art) it falls back to
// the figure colour with the first letter of the name in white. Everything
// that needs to say "this player" uses it — the turn order in the aura, the
// dot standing on the path, the actor on an event row, the rows in the
// players sheet — so one player reads the same everywhere.

import { FIG_COLORS, readableOn } from "../Hooks/rules";
import { FIGURE_TOKEN } from "./figures";
import b from "./bits.module.css";

function initialOf(name) {
  const ch = Array.from(String(name ?? "").trim())[0];
  return ch ? ch.toLocaleUpperCase() : "?";
}

export default function Tok({ player, size = 24, className = "", plain = false }) {
  // Known figures get a fixed hex, so readableOn() can pick black or white to
  // stay AA against it. The "unknown figure" fallback paints on var(--muted),
  // which isn't a hex readableOn can read and swings dark/light with the
  // theme — var(--surface) happens to be the readable choice on it in both
  // (see the comment on .tok in bits.module.css).
  const known = FIG_COLORS[player?.figure];
  const color = known || "var(--muted)";
  const text = known ? readableOn(known) : "var(--surface)";

  // The token art only reads at a decent size, and `plain` lets a caller
  // force the dot even when there'd be room (e.g. the 18px owner marker on
  // TV tiles — already under 20 today, but callers may want the same
  // override larger). Unknown figures never get here: they keep today's
  // lettered dot no matter the size, since there's no art to fall back to.
  const showAvatar = Boolean(known) && size >= 20 && !plain;

  return (
    <span
      className={`${b.tok} ${className}`}
      style={{
        "--tk": `${size}px`,
        "--c": color,
        "--tc": text,
        "--tf": `${Math.max(9, Math.round(size * 0.46))}px`,
      }}
      aria-hidden="true"
    >
      {showAvatar ? (
        <img
          className={b.tokImg}
          src={FIGURE_TOKEN[player.figure]}
          alt=""
          draggable={false}
          decoding="async"
          loading="eager"
        />
      ) : known ? null : (
        initialOf(player?.name)
      )}
    </span>
  );
}
