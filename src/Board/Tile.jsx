// One of the 40 spaces on the TV board.
//
// Memoised, and it takes nothing but `cell` (one object out of `pos`) and
// strings. That is the property the old board had and this one keeps: a token
// hopping across the board changes only TvTokens' own state, so none of these
// 40 components re-render while it flies. Everything a tile needs to know about
// the players — who owns it, who is standing on it — is passed in as a already
// flattened string/colour, never as the players array (a fresh array every
// render would defeat the memo).
//
// The tile is a single `role="img"` with a full label rather than a pile of
// small labelled parts: on a shared screen a tile is one thing you read, and
// 40 tiles' worth of nested landmarks is unusable.

import { memo } from "react";
import Mark from "../Client/Mark";
import Tok from "../Client/Tok";
import { Pips, groupLabel, hasCyrillic } from "../Client/boardDisplay";
import { fmt } from "../Client/format";
import { accentFor, cellKind, isProperty, priceOf, readableOn } from "../Hooks/rules";
import s from "./tv.module.css";

// Board id (1..40) -> [row, col, side] on the 11x11 grid.
//
// VERIFIED against the board players already know (src/styles/main.css,
// .itemCard1 ... .itemCard40, which the old TV laid out): Start is the
// bottom-right corner, the loop runs right-to-left along the bottom, up the
// left column, left-to-right along the top and down the right column. The
// prototype's mapping in design-reference/tv-board-reference.md is the same
// loop in the same direction, so nothing had to be flipped — id 11 is still
// Jail bottom-left, 21 Free Parking top-left, 31 Go To Jail top-right.
export function placeOf(id) {
  const i = Number(id) - 1;
  if (i === 0) return [11, 11, "c"]; // Start, bottom-right
  if (i < 10) return [11, 11 - i, "b"]; // bottom row, right -> left
  if (i === 10) return [11, 1, "c"]; // Jail, bottom-left
  if (i < 20) return [21 - i, 1, "l"]; // left column, bottom -> top
  if (i === 20) return [1, 1, "c"]; // Free Parking, top-left
  if (i < 30) return [1, i - 19, "t"]; // top row, left -> right
  if (i === 30) return [1, 11, "c"]; // Go To Jail, top-right
  return [i - 29, 11, "r"]; // right column, top -> bottom
}

// The name a tile reads by. Streets carry theirs in `header`; every other kind
// puts the useful word in `info` ("Support" / "Offlane" for the four railroads,
// "Light" / "Water" for the two utilities, "Free Park", "Go To Jail"), which is
// exactly what the old board printed on those cards.
export function nameOf(cell) {
  if (!cell) return "";
  return cellKind(cell) === "street" ? cell.header : cell.info || cell.header || "";
}

// The second line: a price for anything ownable, a short word for the rest.
const SPECIAL_LINE = {
  start: "+200$",
  chance: "Card",
  community: "Card",
  tax: "Pay",
  jail: "In Jail",
  parking: "Rest",
  gtj: "Unlucky",
};

export function lineOf(cell) {
  if (!cell) return "";
  if (isProperty(cell)) {
    const price = priceOf(cell);
    return price ? fmt(price) : "";
  }
  return SPECIAL_LINE[cellKind(cell)] || "";
}

function labelOf(cell, ownerName, here) {
  if (!cell) return "Empty space";
  const name = nameOf(cell);
  const bits = [name];
  const group = groupLabel(cell);
  // "Chance, Chance" / "Tax, Tax": on a special space the group name IS the
  // name, and saying it twice is just noise in a 40-tile screen reader pass.
  if (group && group.toLowerCase() !== String(name).toLowerCase()) bits.push(group);
  const line = lineOf(cell);
  if (line) bits.push(isProperty(cell) ? line : line.toLowerCase());
  if (ownerName) bits.push(`owned by ${ownerName}`);
  else if (isProperty(cell)) bits.push("unowned");
  const houses = Math.round(Number(cell.houses)) || 0;
  if (houses >= 5) bits.push("hotel");
  else if (houses > 0) bits.push(`${houses} house${houses === 1 ? "" : "s"}`);
  if (here) bits.push(`${here} here`);
  return bits.join(", ");
}

const Tile = memo(function Tile({
  cell,
  id,
  act,
  ownerFig,
  ownerName,
  here,
  tight = 0,
}) {
  const [row, col, side] = placeOf(id);
  const corner = side === "c";
  const flank = side === "l" || side === "r";
  const tint = accentFor(cell);
  const name = nameOf(cell);
  const line = lineOf(cell);
  // The side columns are only 80px tall but 158px wide, and the name sits
  // BESIDE the mark rather than under it — so the mark gives up room to buy the
  // name a second line's worth of width. On the rows and the corners the tile
  // also reserves a permanent piece lane along its outer edge, which is what
  // caps the corner mark below the 56 it would have had if the pieces simply
  // sat on top of everything.
  //
  // All three went up a step with the wider board (2026-09-20, see the .screen
  // comment in tv.module.css): 112px of tile carries a 44px mark the way 105px
  // carried 40.
  const markSize = corner ? 50 : flank ? 36 : 44;

  return (
    <div
      className={`${s.tile}${act ? ` ${s.act}` : ""}`}
      data-side={side}
      data-i={id}
      /* How many steps down the name goes so a long single word fits whole
         rather than being cut — worked out in fitName.js, applied in CSS.
         It is the ONLY thing that varies the text block, and it depends on the
         name and the side of the board alone: a tile must look exactly the same
         whether or not anyone is standing on it. */
      data-tight={tight || undefined}
      style={{
        gridArea: `${row} / ${col} / ${row + 1} / ${col + 1}`,
        "--tint": tint,
        "--on-tint": readableOn(tint),
      }}
      role="img"
      aria-label={labelOf(cell, ownerName, here)}
    >
      {cell ? (
        <>
          <Mark
            cell={cell}
            size={markSize}
            radius={corner ? 14 : flank ? 10 : 12}
          />
          {/* data-txt: on the side columns, where there is no room for a lane,
              TvTokens stops the pieces at this block's left edge so they cover
              the mark and never the name or the price. */}
          <span className={s.txt} data-txt="">
            <span className={s.name} lang={hasCyrillic(name) ? "ru" : undefined}>
              {name}
            </span>
            {/* Price and pips share one line — "140$ ▪▪▪▪" — so a wrapped name
                never has to fight a third row for the tile's height. */}
            {line || cell.houses ? (
              <span className={s.meta}>
                {line ? <span className={s.price}>{line}</span> : null}
                <Pips houses={cell.houses} className={s.pips} />
              </span>
            ) : null}
          </span>
          {ownerFig ? (
            <span className={s.own}>
              {/* The owner is a plain 18px colour dot, never a face: at this
                  size a portrait is mud, and the tile already has a character
                  standing on it whenever someone is actually there. */}
              <Tok
                player={{ figure: ownerFig, name: ownerName }}
                size={18}
                plain
                className={s.ownTok}
              />
            </span>
          ) : null}
        </>
      ) : null}
      {/* Empty on purpose: the resting slot TvTokens measures. */}
      <span className={s.here} data-here={id} aria-hidden="true" />
    </div>
  );
});

export default Tile;
