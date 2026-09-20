// The auction panel on the board centre.
//
// The auction this game runs is TURN BASED — no timer, nothing expires by
// itself (supabase/migrations/20260919100000_auction_trade.sql). So the
// prototype's countdown ring is not a countdown here: it is a full ring in
// --crim around the leader's token, --line when nobody has bid, and the stat
// that used to read "4s / LEFT" reads "Koli / TO BID".
//
// Every field of `auction` is treated as optional. A room mid-migration, a
// half-written state or an old row can arrive without `order`, `in` or `last`,
// and a board on a wall must not go blank over it.

import { useEffect, useRef, useState } from "react";
import { Gavel } from "lucide-react";
import { accentFor, nextBid, nameOfFig, playerByFig, priceOf, readableOn } from "../Hooks/rules";
import { groupLabel, hasCyrillic } from "../Client/boardDisplay";
import { fmt } from "../Client/format";
import Mark from "../Client/Mark";
import Tok from "../Client/Tok";
import c from "./tvCenter.module.css";

export default function TvAuction({ auction, board, players }) {
  const cell = board?.[auction?.cell] ?? null;
  const tint = accentFor(cell);
  const onTint = readableOn(tint);

  const bid = Number(auction?.bid) || 0;
  const leaderFig = auction?.leader ?? null;
  const leader = leaderFig ? playerByFig(players, leaderFig) : null;
  const turnFig = auction?.turn ?? null;

  // Without `order` the rotation is unknown, so fall back to the seating order
  // minus the bankrupt — the same set the server would have built.
  const order =
    Array.isArray(auction?.order) && auction.order.length > 0
      ? auction.order
      : (players || []).filter((p) => !p.bankrupt).map((p) => p.figure);
  const stillIn = Array.isArray(auction?.in) ? auction.in : order;
  const last = auction?.last && typeof auction.last === "object" ? auction.last : {};

  // The amount pulses when it changes, and only then: mounting the panel is not
  // a change, it is the first thing anyone sees.
  const prev = useRef(bid);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (prev.current === bid) return;
    prev.current = bid;
    setPulse((p) => p + 1);
  }, [bid]);

  const name = cell?.header ?? "This property";
  const price = priceOf(cell);

  return (
    <div className={c.auc}>
      <div className={c.aucTitle}>
        <Gavel size={26} aria-hidden="true" />
        Auction
      </div>

      <div className={c.aucMain}>
        <div
          className={c.ticket}
          style={{
            "--tint": tint,
            "--on-tint": onTint,
            // bits.module.css reads --mark-bg / --mark-fg from an ancestor
            // before the mark's own inline colours, which is how the ticket
            // repaints the mark as a translucent panel on its own tint.
            "--mark-bg": "rgba(255, 255, 255, .22)",
            "--mark-fg": onTint,
          }}
        >
          <Mark cell={cell} size={64} radius={18} className={c.ticketMark} />
          <span className={c.grp}>{groupLabel(cell) || "Property"}</span>
          <span className={c.pname} lang={hasCyrillic(name) ? "ru" : undefined}>
            {name}
          </span>
          {price != null && <span className={c.price}>List price {fmt(price)}</span>}
        </div>

        <div className={c.aucRight}>
          <div className={c.bidRow}>
            <span className={`${c.ring} ${leaderFig ? c.ringOn : ""}`}>
              {leader ? (
                <span className={c.ringIn}>
                  <Tok player={leader} size={92} />
                </span>
              ) : (
                <span className={c.ringEmpty}>
                  <Gavel size={38} aria-hidden="true" />
                </span>
              )}
            </span>

            <div className={c.aucBid}>
              <span>{leader ? `High bid · ${leader.name}` : "No bids yet"}</span>
              <strong key={pulse} className={pulse > 0 ? c.pulse : undefined}>
                {bid > 0 ? fmt(bid) : `Start at ${fmt(nextBid(auction))}`}
              </strong>
            </div>

            <div className={c.aucTurn}>
              <strong>{turnFig ? nameOfFig(players, turnFig) : "—"}</strong>
              <span>to bid</span>
            </div>
          </div>

          {/* Up to four bidders keep one line each, exactly as they did; five
              or six go onto two lines of three rather than shrink a chip below
              what a face and a number need. The number of columns is decided
              here, in one place, and the CSS follows it. */}
          <div
            className={c.bidders}
            style={{ "--bidder-cols": order.length > 4 ? 3 : Math.max(1, order.length) }}
          >
            {order.map((fig) => {
              const p = playerByFig(players, fig);
              const out = !stillIn.includes(fig);
              const amount = Number(last[fig]);
              const has = Number.isFinite(amount) && amount > 0;
              const text = out ? "Out" : has ? fmt(amount) : "—";
              const said = out
                ? `${nameOfFig(players, fig)}: dropped out`
                : `${nameOfFig(players, fig)}: ${has ? `bid ${fmt(amount)}` : "no bid yet"}${
                    fig === leaderFig ? ", leading" : ""
                  }${fig === turnFig ? ", to bid" : ""}`;
              return (
                <span
                  key={fig}
                  className={[
                    c.bidder,
                    fig === leaderFig ? c.isLead : "",
                    out ? c.isOut : "",
                    !out && fig === turnFig ? c.isTurn : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <Tok player={p || { name: fig, figure: fig }} size={36} />
                  <span className={c.sr}>{said}</span>
                  <span aria-hidden="true">{text}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
