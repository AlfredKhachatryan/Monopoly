// The 11 x 11 board: 40 tiles round the edge, the centre panel in the middle,
// the flying tokens on top.
//
// The per-tile strings that depend on the players (owner name, who is standing
// here) are worked out once per board/player change and handed to Tile as
// plain strings, so Tile's memo holds. `board` may be missing cells, or be {}
// entirely, for a room that has not loaded — every id 1..40 is still rendered
// so the grid keeps its shape, just empty.

import { useEffect, useMemo, useState } from "react";
import TvCenter from "./TvCenter";
import Tile, { nameOf, placeOf } from "./Tile";
import TvTokens from "./TvTokens";
import { clearFitCache, fitTile, fontsReady } from "./fitName";
import { FIGS, ownerOf, playerByFig } from "../Hooks/rules";
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
      };
    }
    return out;
  }, [board, players, fitVersion]);

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
