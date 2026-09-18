// CONTRACT (mirrored by src/Board/TvFigure.jsx until it swaps in): Figure({
// player, height, className, shadow }).
//
// The full-body monster a player picked at login, at a given height (width
// follows from the art's own aspect ratio, set explicitly so nothing shifts
// layout while the image loads). This is what the TV board places on tiles
// and flies between them, and what player cards can show large. Unknown
// figure (old rows / missing) falls back to Tok at a size that reads as a
// stand-in for a body rather than a tiny copy of it.
//
// The full-figure art has its own baked-in ground-shadow ellipse (the ART's
// first shape, not CSS), so `shadow` picks between two SVGs rather than
// toggling a decoration: FIGURE_FULL (shadow included) or FIGURE_FULL_NOSHADOW
// (that one ellipse removed) — see figures.js.

import Tok from "./Tok";
import { FIG_COLORS } from "../Hooks/rules";
import { FIGURE_FULL, FIGURE_FULL_NOSHADOW, FIGURE_ASPECT } from "./figures";
import b from "./bits.module.css";

export default function Figure({ player, height = 56, className = "", shadow = true }) {
  const known = FIG_COLORS[player?.figure];

  if (!known) {
    return <Tok player={player} size={Math.round(height * 0.6)} className={className} />;
  }

  const h = Math.round(height);
  const w = Math.round(h * FIGURE_ASPECT);
  const src = (shadow ? FIGURE_FULL : FIGURE_FULL_NOSHADOW)[player.figure];

  return (
    <span
      className={`${b.figure} ${className}`}
      style={{ width: w, height: h }}
      aria-hidden="true"
    >
      <img
        className={b.figureImg}
        src={src}
        width={w}
        height={h}
        alt=""
        draggable={false}
        decoding="async"
        loading="eager"
      />
    </span>
  );
}
