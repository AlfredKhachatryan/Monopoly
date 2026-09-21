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
import { Pips, groupLabel, hasCyrillic } from "../Client/boardDisplay";
import { fmt } from "../Client/format";
import {
  FIG_COLORS,
  accentFor,
  cellKind,
  farmIncome,
  isProperty,
  ownerOf,
  priceOf,
  readableOn,
  rentFor,
} from "../Hooks/rules";
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
// "Casino", "Weed Farm", "Free Park", "Go To Jail"), which is exactly what the
// old board printed on those cards.
export function nameOf(cell) {
  if (!cell) return "";
  return cellKind(cell) === "street" ? cell.header : cell.info || cell.header || "";
}

// The second line: a number for anything with a number, a short word for the
// rest. "+150$" and not the "+200$" it used to say — the rebalance cut the pass
// GO bonus (START_BONUS in rules.js, and the SQL it mirrors), and a board that
// still promises 200 is a board that lies to the room.
const SPECIAL_LINE = {
  start: "+150$",
  chance: "Card",
  community: "Card",
  tax: "Pay",
  jail: "In Jail",
  parking: "Rest",
  gtj: "Unlucky",
  // Landing is mandatory and the bank is the house, so there is nothing to buy
  // and nothing to owe — the only thing a player does here is stake something.
  casino: "Bet",
};

// The number on a tile, and the small word over it (lineTagOf below).
//
// SIGNATURE (spec §4). This used to take nothing but `cell`, because the only
// number it ever showed was the purchase price, which lives on the cell. An
// OWNED space now shows the live rent instead, and rent is a fact about the
// whole board (colour sets, how many railroads the owner holds) and about the
// players (a jailed owner collects nothing, §3) — so both have to be passed in.
// `pot` is the Free Parking pot, which lives on `game.pot` and belongs to
// exactly one cell.
//
// It is NOT called from inside Tile: Tile is memoised on primitives only (see
// the note at the top of this file) and handing it `board` and `players` would
// make every one of the 40 tiles re-render on every state change. BoardGrid
// calls this once per cell and passes the finished string down.
export function lineOf(cell, board = null, players = null, pot = 0) {
  if (!cell) return "";
  const kind = cellKind(cell);
  // The farm shows its COUNTER, never a rent (a visitor pays it nothing) and
  // never its price (§6: the counter has to be readable from the sofa, and the
  // price only matters for the few seconds the auction overlay is up).
  if (kind === "farm") return fmt(farmIncome(cell));
  if (kind === "parking") {
    const n = Math.round(Number(pot)) || 0;
    return n > 0 ? fmt(n) : SPECIAL_LINE.parking;
  }
  if (isProperty(cell)) {
    // Owned: what a visitor would owe RIGHT NOW. A jailed owner makes that
    // honestly 0, which is the whole point of showing it.
    if (ownerOf(cell)) return fmt(rentFor(board, cell.id, players));
    const price = priceOf(cell);
    return price ? fmt(price) : "";
  }
  return SPECIAL_LINE[kind] || "";
}

// The small uppercase word above the number. "" means the line stands alone,
// which is now the case for EVERY ordinary property.
//
// PRICE / RENT ARE GONE (owner call, 2026-09-20). They used to be printed on
// every ownable space, on the argument that the pair is what makes "240$" on an
// owned tile legible as a charge rather than a shop sign. The owner looked at a
// real board and did not want the word there: a bare number is what the printed
// game prints, the room already knows what the number on a deed means, and 22
// tiles each carrying a tiny extra caption is 22 tiles of clutter.
//
// The rent LOGIC is untouched — lineOf() above still shows the live rent on an
// owned space and the purchase price on an unowned one. Only the caption went.
//
// Two spaces keep theirs, and they are the two where a bare number genuinely
// says nothing:
//   CROP <income>  the Weed Farm's counter is not a price and not a rent; a
//                  visitor pays it nothing, and "1250$" alone on that tile would
//                  be read as a charge by everybody in the room.
//   POT <amount>   the Free Parking pot is money sitting on the board waiting to
//                  be won. Same problem, opposite sign.
// Both words are also what the phone's Ticket says for the same numbers, so the
// two screens in one room still agree.
//
// data-line on the tile is written from this, so it is now set for exactly
// those two kinds — which is what .tile[data-line] in tv.module.css leans on.
export function lineTagOf(cell, pot = 0) {
  if (!cell) return "";
  const kind = cellKind(cell);
  if (kind === "farm") return "Crop";
  if (kind === "parking") return (Math.round(Number(pot)) || 0) > 0 ? "Pot" : "";
  return "";
}

function labelOf(cell, ownerName, here, line, tag) {
  if (!cell) return "Empty space";
  const name = nameOf(cell);
  const bits = [name];
  const group = groupLabel(cell);
  // "Chance, Chance" / "Tax, Tax": on a special space the group name IS the
  // name, and saying it twice is just noise in a 40-tile screen reader pass.
  if (group && group.toLowerCase() !== String(name).toLowerCase()) bits.push(group);
  // The tag carries the meaning of the number ("rent 240$", "pot 1150$"), so a
  // screen reader hears the same distinction the sighted room does.
  if (line) bits.push(tag ? `${tag.toLowerCase()} ${line}` : line.toLowerCase());
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
  // Worked out in BoardGrid, from the board and the players, and handed over as
  // finished strings — see lineOf() above and the memo note at the top.
  line = "",
  lineTag = "",
  // True only for an ownable space nobody has bought yet (§7). Never for the
  // Casino, which nobody CAN buy, and never for a tax / card / corner cell.
  dim = false,
}) {
  const [row, col, side] = placeOf(id);
  const corner = side === "c";
  const flank = side === "l" || side === "r";
  const tint = accentFor(cell);
  const name = nameOf(cell);
  // The owner's figure colour, or null. Since 2026-09-20 this is not a marker
  // drawn NEXT TO the tile's colour — it IS the tile's colour: see --band
  // below.
  const own = ownerFig ? FIG_COLORS[ownerFig] || null : null;
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
      /* Owned. It no longer switches a ring or a tag on — those are gone (see
         --band below). What still hangs off it is the group stripe on the outer
         edge and the number switching from --muted to --ink, both of which are
         facts about an owned deed and neither of which needs a colour passed
         in. */
      data-own={own ? "" : undefined}
      /* Bought by nobody yet (§7). It dims the group band and the mark, not the
         whole tile — see the .tile[data-dim] rules in tv.module.css. */
      data-dim={dim ? "" : undefined}
      /* Which KIND of number this tile is showing, so CSS can treat one of them
         specially without a prop of its own: the Free Parking pot is money
         sitting on the board waiting to be won, and it is painted like it. */
      data-line={lineTag || undefined}
      style={{
        gridArea: `${row} / ${col} / ${row + 1} / ${col + 1}`,
        "--tint": tint,
        "--on-tint": readableOn(tint),
        /* THE ONE OWNERSHIP SIGNAL (owner call, 2026-09-20). The colour band
           along a tile's inner edge is the biggest patch of colour a tile has,
           and on an owned tile it is now the OWNER's colour instead of the
           group's — the deed changes hands, so the deed changes colour. That
           replaces the 3px ring and the little name tag that used to say the
           same thing twice in smaller print.
           --tint stays what it always was (the group / kind accent): the mark,
           the centre glow and the group stripe on the outer edge all still read
           it, and only the band switches. */
        "--band": own || tint,
      }}
      role="img"
      aria-label={labelOf(cell, ownerName, here, line, lineTag)}
    >
      {cell ? (
        <>
          {/* s.mk is a hook, not a look: it carries no rules of its own, it is
              only how .tile[data-dim] reaches the mark to grey it down (§7).
              CSS-module class names are hashed, so tv.module.css cannot name
              bits.module.css's .mark from the outside. */}
          <Mark
            cell={cell}
            size={markSize}
            radius={corner ? 14 : flank ? 10 : 12}
            className={s.mk}
          />
          {/* data-txt: on the side columns, where there is no room for a lane,
              TvTokens stops the pieces at this block's left edge so they cover
              the mark and never the name or the price. */}
          <span className={s.txt} data-txt="">
            <span className={s.name} lang={hasCyrillic(name) ? "ru" : undefined}>
              {name}
            </span>
            {/* Number and pips share one line — "140$ 🏠🏠" — so a wrapped name
                never has to fight a third row for the tile's height.
                A property's number now stands completely alone: PRICE / RENT
                were removed on the owner's call (see lineTagOf above), and with
                them the .price line-height hack that paid for them. The only
                tiles that still stack a word over their number are the farm
                (CROP) and the Free Parking pot (POT) — two numbers that are
                neither a price nor a rent and mean nothing unlabelled. Stacked
                rather than beside, because a four-digit number with four house
                glyphs next to it leaves a 112px row tile no horizontal room. */}
            {line || cell.houses ? (
              <span className={s.meta}>
                {line ? (
                  <span className={s.val}>
                    {lineTag ? <span className={s.tag}>{lineTag}</span> : null}
                    <span className={s.price}>{line}</span>
                  </span>
                ) : null}
                {/* Tinted in the owner's colour: on this board a building and a
                    deed are the same fact, so they are the same hue (§9). */}
                <Pips houses={cell.houses} className={s.pips} fig={ownerFig} />
              </span>
            ) : null}
          </span>
          {/* There is deliberately NOTHING here any more. Ownership used to be
              said twice — a 3px ring round the tile and a tag carrying the
              owner's name on the inner edge — and the owner's verdict was that
              it made the board busy without making it clearer. The band itself
              carries it now (--band above), which is one signal in the largest
              piece of colour the tile owns, and the owner's NAME is still in
              the aria-label for anyone reading the board with a screen reader.
              A sighted player matches the band to the player card, which is the
              same match the pieces already ask for. */}
        </>
      ) : null}
      {/* Empty on purpose: the resting slot TvTokens measures. */}
      <span className={s.here} data-here={id} aria-hidden="true" />
    </div>
  );
});

export default Tile;
