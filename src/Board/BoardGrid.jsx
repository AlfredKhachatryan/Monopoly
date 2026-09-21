// The 11 x 11 board: 40 tiles round the edge, the centre panel in the middle,
// the flying tokens on top.
//
// The per-tile strings that depend on anything outside the cell itself (owner
// name, who is standing here, the live rent, the Free Parking pot) are worked
// out once per board/player change and handed to Tile as plain strings and
// booleans, so Tile's memo holds. `board` may be missing cells, or be {}
// entirely, for a room that has not loaded — every id 1..40 is still rendered
// so the grid keeps its shape, just empty.

import { useEffect, useMemo, useState } from "react";
import TvCenter from "./TvCenter";
import Tile, { lineOf, lineTagOf, nameOf, placeOf } from "./Tile";
import TvTokens from "./TvTokens";
import { clearFitCache, fitTile, fontsReady } from "./fitName";
import { FIGS, isProperty, ownerOf, playerByFig } from "../Hooks/rules";
import s from "./tv.module.css";

const IDS = Array.from({ length: 40 }, (_, i) => i + 1);

export default function BoardGrid({
  board,
  players,
  game,
  current,
  focusCellId,
  shown,
  // Bumped when the board was repaired after a reconnect: the pieces are put
  // where they are rather than flown there. Passed straight to TvTokens.
  snapKey = 0,
  // Passed straight through to the centre: the dice are the one thing that
  // must move while the rest of the screen is still holding its breath.
  roll,
  roller,
  // Passed straight through to the centre: a resync's own useTvFeed call
  // needs to know this row is not news either. See BoardScreen.jsx.
  silent = false,
}) {
  // Name widths are measured in the real font (fitName.js). Before Manrope
  // arrives those measurements are in the fallback face and wrong, so the first
  // render uses whatever is there and the board re-fits itself once — one extra
  // pass over 40 tiles at font-load time, and never again.
  const [fitVersion, setFitVersion] = useState(() => (fontsReady() ? 1 : 0));
  useEffect(() => {
    if (fitVersion) return undefined;
    let live = true;
    document.fonts?.ready
      ?.then(() => {
        if (!live) return;
        clearFitCache();
        setFitVersion(1);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fitVersion]);

  // The Free Parking pot (spec §2). The server keeps it on `game.pot` as a
  // plain integer and pays the whole thing out to whoever lands on cell 21, so
  // it belongs to exactly one tile — but it is the ONE number on a tile that
  // does not come from the board, so it is read here and handed down as a
  // primitive like everything else. Rounded once, not per tile.
  const pot = Math.round(Number(game?.pot)) || 0;

  const info = useMemo(() => {
    const out = {};
    for (const id of IDS) {
      const cell = board?.[id];
      const fig = cell ? ownerOf(cell) : null;
      const standing = cell
        ? FIGS.filter((f) => cell[f]).map((f) => playerByFig(players, f)?.name || f)
        : [];
      const here = standing.join(", ");
      out[id] = {
        cell: cell || null,
        ownerFig: fig,
        ownerName: fig ? playerByFig(players, fig)?.name || "" : "",
        here,
        // Depends on the name and the side of the board only — never on who is
        // standing there, so a tile's text is in the same place, at the same
        // size, occupied or not.
        tight: fitTile(nameOf(cell), placeOf(id)[2]),
        // The tile's number, and — on the farm and the Free Parking pot only —
        // the word over it. Computed HERE, not in Tile, and for the same reason
        // everything else in this map is: an owned space shows its live rent
        // (§4), which depends on the whole board and on who is in jail, and
        // passing Tile `board`/`players` would re-render all 40 memoised tiles
        // on every single state change. Two strings cost nothing and change
        // only when the answer does.
        //
        // `lineTag` is now empty for every ordinary property: PRICE and RENT
        // were removed on the owner's call and the number stands alone. It is
        // still passed rather than dropped, because the two tiles that DO carry
        // a word need it, and because Tile writes it to data-line and folds it
        // into the aria-label. Both are still primitives, so the memo holds
        // exactly as before.
        line: lineOf(cell, board, players, pot),
        lineTag: lineTagOf(cell, pot),
        // "Nobody has bought this yet" (§7) — and only ever about things that
        // CAN be bought. isProperty() is street/road/farm; the Casino, the
        // taxes, the decks and the four corners are never dimmed.
        dim: !!cell && isProperty(cell) && !fig,
      };
    }
    return out;
  }, [board, players, fitVersion, pot]);

  // Who is doing time. Passed to the token layer so a piece serving a sentence
  // on the Jail corner is told apart from one that is merely visiting — the two
  // stand on the same tile and mean opposite things.
  const jailedFigs = useMemo(() => {
    const out = new Set();
    for (const p of players || []) if (p?.inJail && !p?.bankrupt && p.figure) out.add(p.figure);
    return out;
  }, [players]);

  return (
    <div className={s.boardWrap}>
      <div className={s.board}>
        {IDS.map((id) => (
          <Tile
            key={id}
            id={id}
            cell={info[id].cell}
            act={id === focusCellId}
            ownerFig={info[id].ownerFig}
            ownerName={info[id].ownerName}
            here={info[id].here}
            tight={info[id].tight}
            line={info[id].line}
            lineTag={info[id].lineTag}
            dim={info[id].dim}
          />
        ))}
        <TvCenter
          board={board}
          players={players}
          game={game}
          current={current}
          focusCellId={focusCellId}
          roll={roll}
          roller={roller}
          silent={silent}
        />
      </div>
      <TvTokens
        shown={shown}
        players={players}
        currentFig={current?.figure ?? null}
        jailedFigs={jailedFigs}
        snapKey={snapKey}
      />
    </div>
  );
}
