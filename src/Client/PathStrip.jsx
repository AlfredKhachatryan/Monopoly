// Seven spaces of board: three behind you, you, three ahead. Each dot takes the
// group colour of the space it stands for, an owned space gets a ring, and your
// token sits in the middle and hops when you land.
//
// This replaces the swipeable Track. A phone player does not need the whole
// loop — they need to know what they just walked past and what is coming.

import { useEffect, useRef, useState } from "react";
import { Hammer } from "lucide-react";
import { accentFor, ownerOf } from "../Hooks/rules";
import Tok from "./Tok";
import s from "./screen.module.css";

const BEHIND = 3;
const AHEAD = 3;

function Lvl({ cell }) {
  const n = cell?.houses || 0;
  if (!n) return null;
  return (
    <span className={s.lvlMini}>
      <Hammer size={12} />
      {n >= 5 ? "H" : n}
    </span>
  );
}

// `standing` is false in the one case where the strip is not centred on the
// player: during an auction it focuses the space being sold, which may be
// somebody else's square entirely. The middle dot then shows the space itself
// instead of your token, and the label says which space it is.
export default function PathStrip({ board, position, me, standing = true }) {
  const [hop, setHop] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setHop((n) => n + 1);
  }, [position]);

  const size = board ? Object.keys(board).length : 0;
  if (!size || !position) return null;

  // The board is keyed 1..size and loops, so every offset wraps.
  const at = (offset) => board[(((position - 1 + offset) % size) + size) % size + 1];

  const around = [];
  for (let i = -BEHIND; i <= AHEAD; i++) around.push({ offset: i, cell: at(i) });

  const prev = at(-1);
  const next = at(1);

  // The house counts are drawn beside the neighbour names, and that row is
  // aria-hidden, so without this the only thing a screen reader learns about
  // the board around it is the names.
  const built = (cell) => {
    const n = cell?.houses || 0;
    if (!n) return "";
    return n >= 5 ? ", hotel" : `, ${n} house${n === 1 ? "" : "s"}`;
  };
  const here = board[position];
  const label = `${
    standing ? "Board around you" : `Board around ${here?.header ?? "this space"}`
  }: ${around
    .map(({ offset, cell }) =>
      offset === 0 && standing
        ? `you on ${cell?.header ?? "?"}${built(cell)}`
        : `${cell?.header ?? "?"}${built(cell)}`,
    )
    .join(", ")}`;

  return (
    <div className={s.path}>
      <div className={s.pathDots} role="img" aria-label={label}>
        {around.map(({ offset, cell }) =>
          offset === 0 ? (
            <span key={offset} className={`${s.pd} ${s.pdCur}`} style={{ "--dot": accentFor(cell) }}>
              {/* the key restarts the hop keyframes on every move */}
              {standing && (
                <span key={hop} className={s.hop}>
                  <Tok player={me} size={26} className={s.pTok} />
                </span>
              )}
            </span>
          ) : (
            <span
              key={offset}
              className={`${s.pd} ${cell && ownerOf(cell) ? s.pdOwned : ""}`}
              style={{ "--dot": accentFor(cell) }}
            />
          ),
        )}
      </div>
      <div className={s.pathLab} aria-hidden="true">
        <span className={s.pathSide}>
          <span className={s.pathName}>← {prev?.header ?? ""}</span>
          <Lvl cell={prev} />
        </span>
        <span className={s.pathSpacer} />
        <span className={`${s.pathSide} ${s.pathRight}`}>
          <Lvl cell={next} />
          <span className={s.pathName}>{next?.header ?? ""} →</span>
        </span>
      </div>
    </div>
  );
}
