import Sheet from "../Sheet";
import Tok from "../Tok";
import { fmt } from "../format";
import { hasCyrillic } from "../boardDisplay";
import { ownedBy } from "../../Hooks/rules";
import sh from "../sheet.module.css";

// `onTrade` is optional: when it is there every other player still in the game
// gets a Trade pill on their row, which hands the figure to the caller (the
// client screen opens the trade sheet prefilled with that player). Without it
// the sheet is exactly what it was — a read-only table.
export default function PlayersSheet({
  open,
  onClose,
  board,
  players,
  current,
  winner,
  meFig,
  onTrade,
}) {
  const ordered = [...players].sort((a, b) => a.order - b.order);

  return (
    <Sheet open={open} title={`Players (${players.length})`} onClose={onClose}>
      <ul className={sh.list}>
        {ordered.map((p, i) => {
          const owned = ownedBy(board, p.figure);
          // Houses/jail cards used to be shown in the old client and got
          // dropped here; restored the same way the backup computed them.
          const houses = owned.reduce((n, cell) => n + (cell.houses || 0), 0);
          const jailCards = p.jailCards || 0;
          const isMe = p.figure === meFig;
          const isNow = current?.playerId === p.playerId && !winner;
          const isWinner = winner?.figure === p.figure;
          const cellName = board?.[p.position]?.header;
          const cyr = hasCyrillic(p.name);

          const bits = [
            fmt(p.money ?? 0),
            `${owned.length} deed${owned.length === 1 ? "" : "s"}`,
            houses ? `${houses} house${houses === 1 ? "" : "s"}` : null,
            jailCards ? `${jailCards} jail card${jailCards === 1 ? "" : "s"}` : null,
            cellName || null,
          ].filter(Boolean);

          return (
            <li key={p.playerId} className={p.bankrupt ? sh.dim : undefined}>
              <Tok player={p} size={36} />
              <div className={sh.rowMain}>
                <div className={sh.rowTitle}>
                  <span lang={cyr ? "ru" : undefined}>
                    {i + 1}. {p.name}
                  </span>
                  {isMe && <span className={`${sh.tag} ${sh.tagMe}`}>You</span>}
                  {isNow && <span className={sh.tag}>Now</span>}
                  {p.inJail && <span className={sh.tag}>Jail</span>}
                  {p.bankrupt && <span className={sh.tag}>Out</span>}
                  {isWinner && <span className={sh.tag}>Winner</span>}
                </div>
                <span className={`${sh.rowSub} ${sh.rowSubWrap}`}>{bits.join(" · ")}</span>
              </div>
              {onTrade && !isMe && !p.bankrupt && (
                <button
                  type="button"
                  className={sh.rowBtn}
                  onClick={() => onTrade(p.figure)}
                  aria-label={`Offer a trade to ${p.name}`}
                >
                  Trade
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
