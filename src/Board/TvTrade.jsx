// The trade panel on the board centre.
//
// The phone shows an offer from the receiver's point of view ("You get" / "You
// give"); the TV belongs to nobody, so both columns are named after their
// player — "KOLI GIVES" / "AFO GIVES" — and no sentence on this screen ever
// says "you".
//
// It renders two things with one shape: the pending `game.trade`, and the
// panel that stays behind for ~2.8s after a `trade` event ends the offer. The
// caller normalises the event into the same object and passes `status`.

import { Ban, Check, Clock, CircleSlash, ArrowLeftRight, Coins, X } from "lucide-react";
import { nameOfFig, playerByFig, priceOf } from "../Hooks/rules";
import { groupLabel, hasCyrillic } from "../Client/boardDisplay";
import { fmt } from "../Client/format";
import Mark from "../Client/Mark";
import Tok from "../Client/Tok";
import c from "./tvCenter.module.css";

function Side({ title, part, board }) {
  const ids = Array.isArray(part?.cells) ? part.cells : [];
  const cells = ids.map((id) => board?.[id]).filter(Boolean);
  const cash = Number(part?.cash) || 0;

  return (
    <div className={c.trCol}>
      <span className={c.ofH}>{title}</span>
      {cells.map((cell) => {
        const price = priceOf(cell);
        const sub = [groupLabel(cell), price != null ? fmt(price) : null].filter(Boolean).join(" · ");
        return (
          <span className={c.ofItem} key={cell.id}>
            <Mark cell={cell} size={48} radius={14} />
            <span className={c.ofField}>
              <strong lang={hasCyrillic(cell.header) ? "ru" : undefined}>{cell.header}</strong>
              {sub && <span>{sub}</span>}
            </span>
          </span>
        );
      })}
      {cash > 0 && (
        <span className={c.ofItem}>
          <span className={c.cashMark} aria-hidden="true">
            <Coins size={26} />
          </span>
          <span className={c.ofField}>
            <strong>{fmt(cash)}</strong>
            <span>Cash</span>
          </span>
        </span>
      )}
      {cells.length === 0 && cash <= 0 && <span className={c.ofNone}>Nothing</span>}
    </div>
  );
}

// status: null while the offer is pending, otherwise how it ended.
const PILL = {
  accepted: { Icon: Check, text: "Deal accepted", tone: "pos" },
  declined: { Icon: X, text: "Declined", tone: "neg" },
  cancelled: { Icon: Ban, text: "Cancelled", tone: null },
  expired: { Icon: CircleSlash, text: "No longer valid", tone: null },
};

export default function TvTrade({ trade, board, players, status = null }) {
  const from = playerByFig(players, trade?.from);
  const to = playerByFig(players, trade?.to);
  const fromName = from?.name ?? nameOfFig(players, trade?.from);
  const toName = to?.name ?? nameOfFig(players, trade?.to);

  const pill = status ? PILL[status] : null;
  const Icon = pill ? pill.Icon : Clock;
  const pillText = pill ? pill.text : `Waiting for ${toName}`;
  const tone = pill?.tone === "pos" ? c.pos : pill?.tone === "neg" ? c.neg : "";

  return (
    <div className={c.trade}>
      <div className={c.trHead}>
        <Tok player={from || { name: fromName, figure: trade?.from }} size={64} />
        <ArrowLeftRight size={40} aria-hidden="true" />
        <Tok player={to || { name: toName, figure: trade?.to }} size={64} />
        <strong>
          {/* Once the offer has been answered the present tense is a lie — the
              panel is only still up to say how it ended. */}
          {status
            ? `Trade between ${fromName} and ${toName}`
            : trade?.counter
              ? `${fromName} sent ${toName} a counter-offer`
              : `${fromName} offers ${toName} a trade`}
        </strong>
      </div>

      <div className={c.trCols}>
        <Side title={`${fromName} gives`} part={trade?.give} board={board} />
        <Side title={`${toName} gives`} part={trade?.get} board={board} />
      </div>

      <span className={`${c.status} ${tone}`}>
        <Icon size={24} aria-hidden="true" />
        {pillText}
      </span>
    </div>
  );
}
