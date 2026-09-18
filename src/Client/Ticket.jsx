// The space you are standing on, as a torn-off ticket: the mark, the group, the
// name, the houses on it — and then either a stub of Price / Rent / Owner if it
// can be owned, or a single line of what the space does if it cannot.
//
// The Build pill only appears when you own at least one complete colour set
// somewhere on the board; it opens the deeds sheet, which is where building
// actually happens.

import { Hammer } from "lucide-react";
import {
  JAIL_MAX_TURNS,
  RAILROAD_RENT,
  START_BONUS,
  cellKind,
  isProperty,
  nameOfFig,
  ownerOf,
  priceOf,
  streetRent,
} from "../Hooks/rules";
import { groupLabel, Pips, hasCyrillic } from "./boardDisplay";
import { fmt, fmtText } from "./format";
import Mark from "./Mark";
import s from "./screen.module.css";

function noteFor(cell, lastCard, me) {
  switch (cellKind(cell)) {
    case "start":
      return `Collect ${fmt(START_BONUS)} each time you pass Start`;
    case "chance":
    case "community":
      return lastCard ? fmtText(lastCard) : "Take the card";
    case "tax":
      return `Pay ${fmt(cell.price || 0)}`;
    // Standing on Jail is two different facts. Saying "Just visiting" to a
    // player who is locked up is the ticket contradicting the banner.
    case "jail":
      return me?.inJail
        ? `In jail · turn ${Math.min((me.jailTurns || 0) + 1, JAIL_MAX_TURNS)} of ${JAIL_MAX_TURNS}`
        : "Just visiting";
    case "parking":
      return "Nothing to pay here. Take a breather.";
    case "gtj":
      return "Unlucky: go straight to jail";
    default:
      return cell?.info || "";
  }
}

// What a visitor pays here right now, written the way this space charges.
// rules.rentFor() answers 0 for an unowned space, and the ticket wants to show
// what it *would* fetch, so the three cases are spelled out from the same
// constants the server uses.
function rentLabel(board, cell) {
  const owner = ownerOf(cell);
  switch (cellKind(cell)) {
    case "street":
      return fmt(streetRent(board, cell, cell.houses || 0));
    case "road": {
      const n = owner
        ? Object.values(board || {}).filter((c) => cellKind(c) === "road" && ownerOf(c) === owner)
            .length
        : 1;
      return fmt(RAILROAD_RENT[Math.max(Math.min(n, RAILROAD_RENT.length) - 1, 0)]);
    }
    case "communal": {
      const n = owner
        ? Object.values(board || {}).filter(
            (c) => cellKind(c) === "communal" && ownerOf(c) === owner,
          ).length
        : 1;
      return n >= 2 ? "10× roll" : "4× roll";
    }
    default:
      return "—";
  }
}

export default function Ticket({
  cell,
  board,
  players,
  me,
  canBuild,
  onBuild,
  lastCard,
  label = "You are here",
}) {
  if (!cell) return null;

  const ownable = isProperty(cell);
  const owner = ownerOf(cell);
  const ownerLabel = !owner ? "Free" : owner === me?.figure ? "You" : nameOfFig(players, owner);
  const price = priceOf(cell);

  return (
    <article className={s.ticket} aria-label={label}>
      <div className={s.tTop}>
        <Mark cell={cell} size={44} radius={14} className={s.tMark} />
        <div className={s.tHead}>
          <span className={s.grpRow}>
            <span className={s.grp}>{groupLabel(cell)}</span>
            <Pips houses={cell.houses} />
          </span>
          {/* Most of this board's names are Russian; telling the browser so
              keeps hyphenation and speech synthesis honest. */}
          <h2 className={s.pname} lang={hasCyrillic(cell.header) ? "ru" : undefined}>
            {cell.header}
          </h2>
        </div>
        {canBuild && (
          <button type="button" className={s.tBuild} onClick={onBuild}>
            <Hammer size={18} /> Build
          </button>
        )}
      </div>

      <div className={s.tPerf} aria-hidden="true" />

      {ownable ? (
        <div className={s.tStub}>
          <div>
            <strong>{price != null ? fmt(price) : "—"}</strong>
            <span>Price</span>
          </div>
          <div>
            <strong>{rentLabel(board, cell)}</strong>
            <span>Rent</span>
          </div>
          <div>
            <strong>{ownerLabel}</strong>
            <span>Owner</span>
          </div>
        </div>
      ) : (
        <p className={s.tNote}>{noteFor(cell, lastCard, me)}</p>
      )}
    </article>
  );
}
