// Four panels, and that is the whole navigation: what you own, who you are
// playing against, the trade you want to propose, and everything about the
// session — log, room code, sound, leaving.
//
// "My deeds" became "Deeds" when Trade joined the row: at 360px four buttons
// get 77px each, and a label that ellipsises is worse than a shorter one that
// does not. The count stays, because it is the only place the number is shown
// without opening anything.

import { ArrowLeftRight, ScrollText, SlidersHorizontal, Users } from "lucide-react";
import s from "./screen.module.css";

export default function BottomNav({ onOpen, deeds = 0, playerCount = 0 }) {
  return (
    <nav className={s.pnav} aria-label="Panels">
      <button type="button" onClick={() => onOpen("mine")} aria-label="My deeds">
        <ScrollText size={22} />
        <span>Deeds{deeds ? ` (${deeds})` : ""}</span>
      </button>
      <button type="button" onClick={() => onOpen("players")} aria-label="Players">
        <Users size={22} />
        <span>Players{playerCount ? ` (${playerCount})` : ""}</span>
      </button>
      <button type="button" onClick={() => onOpen("trade")} aria-label="Offer a trade">
        <ArrowLeftRight size={22} />
        <span>Trade</span>
      </button>
      <button type="button" onClick={() => onOpen("game")}>
        <SlidersHorizontal size={22} />
        <span>Game</span>
      </button>
    </nav>
  );
}
