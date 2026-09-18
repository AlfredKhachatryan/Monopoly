// The auction, in the act row's place.
//
// An auction is turn-based: there is no clock and nothing to race. The ring at
// the top is therefore not a countdown — it is a full crimson ring around the
// token of whoever holds the high bid, and a hairline ring with a gavel in it
// while nobody has bid. The stat on the right, where the prototype counted
// seconds down, says whose move it is instead.
//
// Everyone in the room sees this panel, not only the player whose turn it was:
// an auction is the one moment when every phone has something to do. The three
// buttons are live only for the player `auction.turn` points at; for everyone
// else the primary is a statement — Leading, Dropped, Waiting, Watching.
//
// Nothing here decides anything. Every press is a server action; the panel only
// draws `game.auction`, and it never assumes that object is complete: rooms
// written by an older server can arrive with keys missing.

import { useEffect, useRef, useState } from "react";
import { Gavel } from "lucide-react";
import { nextBid, playerByFig } from "../Hooks/rules";
import { fmt } from "./format";
import Tok from "./Tok";
import s from "./screen.module.css";

// The second raise button: a round jump for when ten at a time is too slow.
const JUMP = 50;

export default function AuctionPanel({ auction, board, players = [], me, busy, onBid, onDrop }) {
  const bid = Number(auction?.bid) || 0;

  // The amount pulses when it changes, the same way the cash in the aura bumps:
  // a key that changes restarts the keyframes, so a bid that repeats a previous
  // value still animates.
  const [beat, setBeat] = useState(0);
  const prev = useRef(bid);
  useEffect(() => {
    if (prev.current === bid) return;
    prev.current = bid;
    setBeat((n) => n + 1);
  }, [bid]);

  // Read defensively rather than bail out yet: the latch's hooks below must
  // run on every render regardless of whether an auction is running (Rules of
  // Hooks), so the actual `if (!auction) return null` waits until after them.
  const cell = auction?.cell != null ? board?.[auction.cell] : null;
  const cellName = cell?.header ?? (auction?.cell != null ? `cell ${auction.cell}` : "this space");

  const order = Array.isArray(auction?.order) ? auction.order : [];
  const stillIn = Array.isArray(auction?.in) ? auction.in : [];
  const last = auction?.last && typeof auction.last === "object" ? auction.last : {};
  const leader = auction?.leader || null;
  const turn = auction?.turn || null;

  const leadP = leader ? playerByFig(players, leader) : null;
  const turnP = turn ? playerByFig(players, turn) : null;

  const myFig = me?.figure ?? null;
  const myMove = !!myFig && turn === myFig;
  const iAmIn = !!myFig && stillIn.includes(myFig);
  const iBid = !!myFig && order.includes(myFig);
  const money = Number(me?.money) || 0;

  const min = nextBid(auction);
  const jump = bid > 0 ? bid + JUMP : JUMP;
  const canMin = money >= min;
  const canJump = money >= jump;

  // A double-tap on Bid / +50 / Drop must not reach the server a second time:
  // it is rejected harmlessly ("It is not your turn to bid" — the first call
  // already moved `turn` on), but that rejection still flashes a red error
  // banner for no reason a player can see anything went wrong. Latched
  // locally, no timers: one tap disables the three buttons until the auction
  // object itself moves (this key changes — a bid, a drop, the turn
  // advancing), or — if the call errored without changing anything — until
  // `busy` has cycled back to false so the same move can be tried again.
  const moveKey = `${turn}|${bid}|${stillIn.length}`;
  const [sentKey, setSentKey] = useState(null);
  const prevBusy = useRef(busy);
  useEffect(() => {
    if (sentKey !== null && sentKey !== moveKey) setSentKey(null);
  }, [moveKey, sentKey]);
  useEffect(() => {
    if (prevBusy.current && !busy && sentKey === moveKey) setSentKey(null);
    prevBusy.current = busy;
  }, [busy, moveKey, sentKey]);
  const latched = sentKey === moveKey;

  function guardedBid(amount) {
    if (latched) return;
    setSentKey(moveKey);
    onBid?.(amount);
  }
  function guardedDrop() {
    if (latched) return;
    setSentKey(moveKey);
    onDrop?.();
  }

  if (!auction) return null;

  // The primary. Mine says what pressing it does; everyone else's says what is
  // going on — the same "a disabled button is a statement, not a refusal" the
  // waiting state of the act row uses.
  let pri;
  if (myMove) {
    pri = {
      verb: "Bid",
      amount: fmt(min),
      hint: canMin ? undefined : "Not enough cash",
      label: `Bid ${fmt(min)} for ${cellName}`,
      disabled: busy || !canMin || latched,
      onClick: () => guardedBid(min),
    };
  } else if (!iBid) {
    pri = { verb: "Watching", hint: "You are not in this auction", disabled: true };
  } else if (leader === myFig) {
    pri = { verb: "Leading", hint: `Your bid: ${fmt(bid)}`, disabled: true };
  } else if (!iAmIn) {
    pri = { verb: "Dropped", hint: "You are out of this auction", disabled: true };
  } else {
    pri = {
      verb: "Waiting",
      hint: turnP ? `${turnP.name} is bidding` : "Waiting for the table",
      disabled: true,
    };
  }

  // One short sentence for a screen reader, replaced whenever the auction moves.
  const say = myMove
    ? "Your move"
    : leader && bid > 0
      ? `${leader === myFig ? "You" : (leadP?.name ?? "Someone")} bid ${fmt(bid)}`
      : turnP
        ? `${turnP.name} is bidding`
        : "";

  return (
    <section className={s.auc} aria-label={`Auction for ${cellName}`}>
      <p className={s.sr} aria-live="polite">
        {say}
      </p>

      <div className={s.aucTop}>
        <div className={s.ring} style={{ "--a": leader ? "100%" : "0%" }} aria-hidden="true">
          {leadP ? (
            <Tok player={leadP} size={42} className={s.ringTok} />
          ) : (
            <span className={s.ringEmpty}>
              <Gavel size={20} />
            </span>
          )}
        </div>

        <div className={s.aucBid}>
          <span>
            {leader ? `High bid · ${leader === myFig ? "you" : (leadP?.name ?? "someone")}` : "No bids yet"}
          </span>
          {/* the key restarts the pulse keyframes on every change */}
          <strong key={beat} className={s.pulse}>
            {bid > 0 ? fmt(bid) : `Start at ${fmt(min)}`}
          </strong>
        </div>

        <div className={s.aucTime}>
          <strong>{myMove ? "You" : (turnP?.name ?? "—")}</strong>
          <span>To bid</span>
        </div>
      </div>

      <ul className={s.bidders} aria-label="Bidders">
        {order.map((fig) => {
          const p = playerByFig(players, fig);
          const name = p?.name ?? fig;
          const out = !stillIn.includes(fig);
          const amount = Number(last?.[fig]) || 0;
          const isLead = fig === leader;
          const isTurn = !out && fig === turn;
          const value = out ? "Out" : amount > 0 ? fmt(amount) : "—";
          const sentence = out
            ? `${name}: dropped out`
            : isLead
              ? `${name}: bid ${fmt(amount)}, leading`
              : `${name}: ${amount > 0 ? `bid ${fmt(amount)}` : "no bid yet"}${
                  isTurn ? ", to bid" : ""
                }`;

          return (
            <li
              key={fig}
              className={`${s.bidder} ${isLead ? s.isLead : ""} ${out ? s.isOut : ""} ${
                isTurn ? s.isTurn : ""
              }`}
            >
              <Tok player={p} size={24} />
              <span className={s.sr}>{sentence}</span>
              <span className={s.bidderVal} aria-hidden="true">
                {value}
              </span>
            </li>
          );
        })}
      </ul>

      <div className={s.aucAct}>
        <button
          type="button"
          className={s.drop}
          onClick={guardedDrop}
          disabled={!myMove || busy || latched}
          aria-disabled={!myMove || busy || latched || undefined}
          aria-label="Drop out of the auction"
        >
          Drop
        </button>
        <button
          type="button"
          className={s.plus}
          onClick={() => guardedBid(jump)}
          disabled={!myMove || busy || !canJump || latched}
          aria-disabled={!myMove || busy || !canJump || latched || undefined}
          aria-label={`Bid ${fmt(jump)}`}
        >
          +{JUMP}
        </button>
        <button
          type="button"
          className={s.primary}
          onClick={pri.onClick}
          disabled={pri.disabled}
          aria-disabled={pri.disabled || undefined}
          aria-label={pri.label}
        >
          <span className={s.pvpa}>
            <span className={s.pv}>{pri.verb}</span>
            {pri.amount && <span className={s.pa}>{pri.amount}</span>}
          </span>
          {pri.hint && <span className={s.ph}>{pri.hint}</span>}
        </button>
      </div>
    </section>
  );
}
