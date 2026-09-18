// The incoming-offer overlay: a pending trade addressed to me, dealt over the
// screen the way the Chance/Community card is (see CardOverlay.jsx) — same
// focus save/restore, same Tab trap — but Escape does nothing here. The three
// buttons (Decline / Counter / Accept) are the only way out, matching the
// prototype's alertdialog.
//
// Columns are drawn from MY point of view: "You get" shows `trade.give`
// (what the sender is handing over), "You give" shows `trade.get` (what I'd
// hand over if I accept).

import { useEffect, useId, useRef } from "react";
import { Coins } from "lucide-react";
import { m, AnimatePresence } from "../Components/Motion";
import Tok from "./Tok";
import Mark from "./Mark";
import { fmt, fmtSigned } from "./format";
import { groupLabel, hasCyrillic } from "./boardDisplay";
import { playerByFig, priceOf } from "../Hooks/rules";
import t from "./trade.module.css";

// Same focusable-elements query Sheet.jsx traps Tab with.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function sideValue(board, side) {
  const cells = side?.cells || [];
  const cash = side?.cash || 0;
  return cells.reduce((sum, id) => sum + (priceOf(board?.[id]) || 0), 0) + cash;
}

// One column's contents: a row per cell, then a cash row, or "Nothing" when
// the side is empty.
function Side({ board, side }) {
  const cells = side?.cells || [];
  const cash = side?.cash || 0;
  if (cells.length === 0 && cash === 0) {
    return <p className={t.ofNone}>Nothing</p>;
  }
  return (
    <>
      {cells.map((id) => {
        const cell = board?.[id];
        if (!cell) return null;
        const cyr = hasCyrillic(cell.header);
        return (
          <div className={t.ofItem} key={id}>
            <Mark cell={cell} size={30} radius={9} />
            <div className={t.ofItemMain}>
              <span className={t.ofItemName} lang={cyr ? "ru" : undefined}>
                {cell.header}
              </span>
              <span className={t.ofItemSub}>
                {groupLabel(cell)} · {fmt(priceOf(cell))}
              </span>
            </div>
          </div>
        );
      })}
      {cash > 0 && (
        <div className={t.ofItem}>
          <span className={t.ofCoin} aria-hidden="true">
            <Coins size={16} />
          </span>
          <div className={t.ofItemMain}>
            <span className={t.ofItemName}>{fmt(cash)}</span>
            <span className={t.ofItemSub}>Cash</span>
          </div>
        </div>
      )}
    </>
  );
}

export default function OfferOverlay({ trade, board, players, me, busy, onAccept, onDecline, onCounter }) {
  const boxRef = useRef(null);
  const restoreRef = useRef(null);
  const rid = useId();
  const titleId = `${rid}-title`;
  const descId = `${rid}-desc`;

  // Focus the dialog container itself on open (not a button — nothing should
  // look "selected" the instant this appears), and give it back to whatever
  // had it once the overlay is gone. `preventScroll` matters here for the
  // same reason it does in Sheet.jsx/CardOverlay.jsx: the card is still
  // animating in from below when this fires.
  useEffect(() => {
    if (!trade) return undefined;
    restoreRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => boxRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      const el = restoreRef.current;
      if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
    };
  }, [trade]);

  function handleKeyDown(e) {
    // Escape is deliberately NOT bound: Decline / Counter / Accept are the
    // only way to leave an incoming offer.
    if (e.key !== "Tab") return;
    const root = boxRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll(FOCUSABLE));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (document.activeElement === root) {
      if (e.shiftKey) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const fromPlayer = trade ? playerByFig(players, trade.from) : null;
  const cannotAfford = trade ? (me?.money || 0) < (trade.get?.cash || 0) : false;
  const acceptDisabled = cannotAfford || busy;
  const net = trade ? sideValue(board, trade.give) - sideValue(board, trade.get) : 0;
  const cyr = hasCyrillic(fromPlayer?.name);

  return (
    <AnimatePresence>
      {trade && (
        <m.div
          key="offer"
          className={t.owrap}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.28 }}
        >
          <div className={t.oscrim} aria-hidden="true" />
          <m.div
            ref={boxRef}
            className={t.offer}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            initial={{ y: 200 }}
            animate={{ y: 0, transition: { duration: 0.4, ease: [0.2, 0.8, 0.3, 1] } }}
            exit={{ y: 120, transition: { duration: 0.18 } }}
          >
            <div className={t.ofHead}>
              <Tok player={fromPlayer} size={44} />
              <strong id={titleId} lang={cyr ? "ru" : undefined}>
                {fromPlayer?.name ?? "Someone"} {trade?.counter ? "sent a counter-offer" : "offers a trade"}
              </strong>
            </div>

            <div className={t.ofCols}>
              <div className={t.ofCol}>
                <div className={t.ofH}>You get</div>
                <Side board={board} side={trade?.give} />
              </div>
              <div className={t.ofCol}>
                <div className={t.ofH}>You give</div>
                <Side board={board} side={trade?.get} />
              </div>
            </div>

            <div id={descId} className={t.ofNet}>
              <span>Net value for you</span>
              <strong className={net >= 0 ? t.ofNetPos : t.ofNetNeg}>{fmtSigned(net)}</strong>
            </div>

            {cannotAfford && <p className={t.ofReason}>You don&rsquo;t have {fmt(trade?.get?.cash || 0)}</p>}

            <div className={t.ofAct}>
              <button type="button" className={t.ofSec} onClick={onDecline} disabled={busy}>
                Decline
              </button>
              <button type="button" className={t.ofSec} onClick={onCounter} disabled={busy}>
                Counter
              </button>
              <button type="button" className={t.ofPri} onClick={onAccept} disabled={acceptDisabled}>
                Accept
              </button>
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
