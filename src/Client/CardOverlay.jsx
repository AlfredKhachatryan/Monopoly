// The Chance / Community Chest card, dealt over the screen.
//
// The server has already applied whatever the card said by the time this shows
// up, so there is nothing to decide: one button, and a tap on the scrim does
// the same thing. The amount pill only appears when the card actually moved
// money.

import { useEffect, useRef } from "react";
import { Gift, Sparkles } from "lucide-react";
import { m, AnimatePresence } from "../Components/Motion";
import { fmtSigned, fmtText } from "./format";
import s from "./screen.module.css";

export default function CardOverlay({ card, onClose }) {
  const btn = useRef(null);
  const restore = useRef(null);

  // Keeping onClose in a ref means the Escape listener is subscribed once per
  // open, not once per render of the parent screen.
  const close = useRef(onClose);
  close.current = onClose;

  // Focus moves to the OK button on open and goes back where it came from on
  // close — the same save/restore Sheet.jsx does, `preventScroll` included and
  // for the same reason: the card flies in from `y: -240`, so for the first few
  // frames the button being focused is off the top of the screen, and a plain
  // focus() would scroll the client root to chase it.
  useEffect(() => {
    if (!card) return undefined;
    restore.current = document.activeElement;
    const raf = requestAnimationFrame(() => btn.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      const el = restore.current;
      if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
    };
  }, [card]);

  useEffect(() => {
    if (!card) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  return (
    <AnimatePresence>
      {card && (
        <m.div
          key="gcard"
          className={s.gwrap}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28 }}
        >
          <div className={s.gscrim} onClick={onClose} aria-hidden="true" />
          <m.div
            className={s.gcard}
            data-deck={card.deck === "chance" ? "chance" : "chest"}
            role="alertdialog"
            aria-modal="true"
            aria-label={card.kind}
            /* The prototype dismisses on a tap anywhere, card face included;
               the OK button is there for the keyboard and for anyone who wants
               a button to press. */
            onClick={onClose}
            initial={{ opacity: 0, y: -240, rotate: -14, scale: 0.35 }}
            animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, y: -160, rotate: 8, scale: 0.6 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.3, 1] }}
          >
            <div className={s.gcHead}>
              {card.deck === "chance" ? <Sparkles size={26} /> : <Gift size={26} />}
              {card.kind}
            </div>
            <div className={s.gcBody}>
              <p className={s.gcText}>{fmtText(card.text)}</p>
              {card.amount ? (
                <span className={`${s.gcAmt} ${card.amount > 0 ? s.gcPos : s.gcNeg}`}>
                  {fmtSigned(card.amount)}
                </span>
              ) : null}
            </div>
            <button ref={btn} type="button" className={s.gcBtn} onClick={onClose}>
              OK
            </button>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
