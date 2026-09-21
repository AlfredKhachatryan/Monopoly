// The full-screen diplomacy moments: an alliance proposed to me, a peace
// treaty from a war's other principal, and — since complaint B — the three
// ONE-SHOT cards nobody asked for but everyone is affected by: getting
// backstabbed, an alliance I am in just forming, and a war I am now a side of
// (including being dragged in by my own ally) just starting. All six share
// one shell: same alertdialog, same focus trap, same "no Escape" rule as
// OfferOverlay.jsx's incoming trade — the spec asks for the SAME interaction
// model throughout, not a new one per kind.
//
// Two of the six are ANSWERABLE (accept/decline changes something): `ally`
// and `peace`. The other four are ACKNOWLEDGE-ONLY — nothing to decide, just
// something the player must not be able to miss — and get a single dismiss
// button instead of two.
//
// `offer` is one of:
//   { kind: "ally", from: fig }
//   { kind: "peace", war: { id, declarer, target, endsRound, peace: { from, amount } } }
//   { kind: "backstabbed", by: fig, amount }            -- complaint B
//   { kind: "allyFormed", other: fig }                  -- complaint C
//   { kind: "warStarted", opponents: fig[], draggedInBy: fig | null }  -- complaint C
// null renders nothing (mounted unconditionally by ClientScreen so its own
// exit animation is not cut off mid-fade, same convention as CardOverlay).
//
// `onAccept`/`onDecline` only matter for the two answerable kinds; `onDismiss`
// only for the other four. A caller only has to pass the pair it needs — see
// ClientScreen.jsx, which mounts one instance per kind for that reason.

import { useEffect, useId, useRef, useState } from "react";
import { m, AnimatePresence } from "../Components/Motion";
import Tok from "./Tok";
import { fmt } from "./format";
import { hasCyrillic } from "./boardDisplay";
import { nameOfFig, playerByFig } from "../Hooks/rules";
import {
  allyBenefits,
  allyCosts,
  allySummaryLine,
  backstabAlertLines,
  hasSeenAllyExplainer,
  markSeenAllyExplainer,
  warStartedLines,
} from "./diplomacyText";
import t from "./trade.module.css";
import d from "./diplomacy.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function DiplomacyOverlay({ offer, players, me, busy, onAccept, onDecline, onDismiss }) {
  const boxRef = useRef(null);
  const restoreRef = useRef(null);
  const rid = useId();
  const titleId = `${rid}-title`;
  const descId = `${rid}-desc`;

  // The full ally explainer only the first time THIS device ever answers an
  // incoming proposal (complaint C) — the mirror of PlayersSheet's identical
  // toggle for the OUTGOING side of the same rule ("first time this device
  // proposes/receives an alliance"). Re-checked per offer rather than per
  // mount: the overlay stays on screen across a run of different offers in
  // one sitting, and each new one is its own "have I seen this" question —
  // though in practice the flag only flips false→true once, ever.
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    if (!offer) return;
    if (offer.kind === "ally") {
      const firstTime = !hasSeenAllyExplainer();
      setDetailsOpen(firstTime);
      if (firstTime) markSeenAllyExplainer();
    } else {
      setDetailsOpen(false);
    }
  }, [offer]);

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
    // Escape is deliberately NOT bound — same rule as OfferOverlay: the
    // button(s) at the bottom are the only way to leave, whether that is a
    // real decision (Accept/Decline) or just acknowledging news that already
    // happened (Got it / Understood).
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
  const isBackstabbed = offer?.kind === "backstabbed";
  const isAllyFormed = offer?.kind === "allyFormed";
  const isWarStarted = offer?.kind === "warStarted";
  // The two kinds with something to decide get Accept/Decline; the rest are
  // "this already happened" and get one dismiss button.
  const answerable = isAlly || isPeace;
  const war = isPeace ? offer.war : null;

  // One representative Tok in the header for every kind — the proposer, the
  // peace offerer, the backstabber, the new ally, or (for a war) whichever
  // figure best explains why I am now in it: the ally who dragged me in, or
  // else the first opponent.
  const fromFig = isAlly
    ? offer.from
    : isPeace
      ? war?.peace?.from
      : isBackstabbed
        ? offer.by
        : isAllyFormed
          ? offer.other
          : isWarStarted
            ? offer.draggedInBy || offer.opponents?.[0]
            : null;
  const fromPlayer = fromFig ? playerByFig(players, fromFig) : null;
  const cyr = hasCyrillic(fromPlayer?.name);
  // The peace payment (if any) flows FROM the proposer TO me — the other
  // principal — so it is only ever a gain for the player reading this
  // overlay, never something to afford. The backstab amount is the opposite:
  // always a loss for whoever this overlay is shown to (it only ever shows
  // to the victim).
  const amount = isPeace
    ? Number(war?.peace?.amount) || 0
    : isBackstabbed
      ? Number(offer.amount) || 0
      : 0;
  const acceptDisabled = busy;

  const draggedInName = isWarStarted && offer.draggedInBy ? nameOfFig(players, offer.draggedInBy) : null;
  const opponentNames = isWarStarted
    ? (offer.opponents || []).map((f) => nameOfFig(players, f)).join(" & ")
    : "";

  const title = isAlly
    ? `${fromPlayer?.name ?? "Someone"} proposes an alliance`
    : isPeace
      ? `${fromPlayer?.name ?? "Someone"} offers peace`
      : isBackstabbed
        ? `${fromPlayer?.name ?? "Someone"} backstabbed you`
        : isAllyFormed
          ? `${fromPlayer?.name ?? "Someone"} is now your ally`
          : isWarStarted
            ? draggedInName
              ? `You are at war because your ally ${draggedInName} is`
              : `You are at war with ${opponentNames || "someone"}`
            : "";

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
                {title}
              </strong>
              {/* The one thing complaint B asks the victim's phone to make
                  unmissable beyond the sentence itself: the TRAITOR brand,
                  right next to the name it now applies to. */}
              {isBackstabbed && <span className={d.traitorTag}>Traitor</span>}
            </div>

            {isAlly && (
              <div id={descId}>
                {detailsOpen ? (
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
                ) : (
                  <p className={d.panelSummary}>{allySummaryLine()}</p>
                )}
                <button type="button" className={d.detailsBtn} onClick={() => setDetailsOpen((v) => !v)}>
                  {detailsOpen ? "Hide details" : "Details"}
                </button>
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

            {/* ---- acknowledge-only kinds (complaints B and C) --------- */}

            {isBackstabbed && (
              <div id={descId}>
                <p className={d.panelLead}>Your alliance with {fromPlayer?.name ?? "them"} is over.</p>
                <div className={`${d.offerAmount} ${d.neg}`}>
                  <span>They took from you</span>
                  <strong>{fmt(amount)}</strong>
                </div>
                <ul className={d.panelList}>
                  {backstabAlertLines().map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {isAllyFormed && (
              <div id={descId}>
                <p className={d.panelLead}>Here is what changed for both of you.</p>
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

            {isWarStarted && (
              <div id={descId}>
                <ul className={d.panelList}>
                  {warStartedLines({ draggedIn: !!draggedInName }).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className={t.ofAct}>
              {answerable ? (
                <>
                  <button type="button" className={t.ofSec} onClick={onDecline} disabled={busy}>
                    Decline
                  </button>
                  <button type="button" className={t.ofPri} onClick={onAccept} disabled={acceptDisabled}>
                    Accept
                  </button>
                </>
              ) : (
                <button type="button" className={t.ofPri} onClick={onDismiss}>
                  {isBackstabbed ? "Understood" : "Got it"}
                </button>
              )}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
