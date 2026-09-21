// The incoming diplomacy proposal: an alliance offered to me, or a peace
// treaty offered by the other principal of a war I am a side of. Dealt over
// the screen exactly the way OfferOverlay.jsx deals an incoming trade — same
// alertdialog, same focus trap, same "no Escape, the three buttons are the
// only way out" rule — because the spec asks for the SAME interaction model,
// not a new one. Reachable even when it is not my turn: ally_accept/decline
// and peace_accept/decline are both "any time" verbs (see game_action).
//
// `offer` is one of:
//   { kind: "ally", from: fig }
//   { kind: "peace", war: { id, declarer, target, endsRound, peace: { from, amount } } }
// null renders nothing (mounted unconditionally by ClientScreen so its own
// exit animation is not cut off mid-fade, same convention as CardOverlay).

import { useEffect, useId, useRef } from "react";
import { Flag, Handshake } from "lucide-react";
import { m, AnimatePresence } from "../Components/Motion";
import Tok from "./Tok";
import { fmt } from "./format";
import { hasCyrillic } from "./boardDisplay";
import { playerByFig } from "../Hooks/rules";
import { allyBenefits, allyCosts } from "./diplomacyText";
import t from "./trade.module.css";
import d from "./diplomacy.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function DiplomacyOverlay({ offer, players, me, busy, onAccept, onDecline }) {
  const boxRef = useRef(null);
  const restoreRef = useRef(null);
  const rid = useId();
  const titleId = `${rid}-title`;
  const descId = `${rid}-desc`;

  useEffect(() => {
    if (!offer) return undefined;
    restoreRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => boxRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      const el = restoreRef.current;
      if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
    };
  }, [offer]);

  function handleKeyDown(e) {
    // Escape is deliberately NOT bound — same rule as OfferOverlay: Decline /
    // Accept are the only way to leave a proposal with real consequences.
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

  const isAlly = offer?.kind === "ally";
  const isPeace = offer?.kind === "peace";
  const war = isPeace ? offer.war : null;
  const fromFig = isAlly ? offer.from : war?.peace?.from;
  const fromPlayer = fromFig ? playerByFig(players, fromFig) : null;
  const cyr = hasCyrillic(fromPlayer?.name);
  const amount = isPeace ? Number(war?.peace?.amount) || 0 : 0;
  // The peace payment (if any) flows FROM the proposer TO me — the other
  // principal — so it is only ever a gain for the player reading this
  // overlay, never something to afford.
  const acceptDisabled = busy;

  return (
    <AnimatePresence>
      {offer && (
        <m.div
          key="diplomacy"
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
                {isAlly
                  ? `${fromPlayer?.name ?? "Someone"} proposes an alliance`
                  : `${fromPlayer?.name ?? "Someone"} offers peace`}
              </strong>
            </div>

            {isAlly && (
              <div id={descId}>
                <div className={d.panelCols}>
                  <div>
                    <p className={`${d.panelColHead} ${d.good}`}>Benefits</p>
                    <ul className={d.panelList}>
                      {allyBenefits().map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className={`${d.panelColHead} ${d.bad}`}>Costs</p>
                    <ul className={d.panelList}>
                      {allyCosts().map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {isPeace && (
              <div id={descId}>
                <p className={d.offerNote}>
                  Accepting ends the war immediately, for both whole sides — rent goes back to
                  normal between everyone who was dragged in.
                </p>
                {amount > 0 && (
                  <div className={d.offerAmount}>
                    <span>They pay you</span>
                    <strong>{fmt(amount)}</strong>
                  </div>
                )}
              </div>
            )}

            <div className={t.ofAct}>
              <button type="button" className={t.ofSec} onClick={onDecline} disabled={busy}>
                Decline
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
