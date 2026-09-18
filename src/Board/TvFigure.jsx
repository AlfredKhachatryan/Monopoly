// The full-body character a player picked at login, at a given height.
//
// One indirection over the shared src/Client/Figure.jsx, kept because the TV
// reached for a character before that file existed and because it is the single
// place to reach for it now: nothing else on this board imports the art.
//
// CONTRACT, mirroring the shared component: ({ player, height, className,
// shadow }) — defaults included, so `shadow` means here exactly what it means
// there: the art's own baked-in ground-shadow ellipse, kept or dropped by
// swapping the SVG. Figure falls back to Tok for a figure it has no art for.

import Figure from "../Client/Figure";

export default function TvFigure({ player, height = 56, className = "", shadow = true }) {
  return <Figure player={player} height={height} className={className} shadow={shadow} />;
}
