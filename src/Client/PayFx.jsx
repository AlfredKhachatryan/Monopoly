// "Wait — who just paid whom?"
//
// Money used to move in silence: a number in the aura counted to a new value
// and a row appeared in the log. On a table of four phones nobody noticed, and
// the player being paid noticed last. This is the transient layer that says it
// out loud, in the same grammar the TV uses:
//
//     [payer]  ->  amount  ->  [payee | bank]
//
// Scaled by how much it is my business. If I am one of the two sides it is
// full-width display type with my cash flashing behind it and a short haptic;
// if it is two other players it is a compact pill that does not move a single
// pixel of the panel (absolutely positioned inside the aura, `pointer-events:
// none` throughout).
//
// It never fights anything: while the card overlay or an incoming offer is up
// the queue simply pauses, and several transfers in one batch (a card's "pay
// each player 50$") play one after another rather than stacking.
//
// The text is announced ONCE through a polite live region. The tokens, the
// arrow and the coins are decoration and stay out of the accessibility tree.

import { useEffect, useRef, useState } from "react";
import { Landmark } from "lucide-react";
import { m, AnimatePresence } from "../Components/Motion";
import { nameOfFig, playerByFig } from "../Hooks/rules";
import { fmt } from "./format";
import { REASON_TEXT } from "./transfers";
import { REVEAL } from "./useReveal";
import Tok from "./Tok";
import s from "./payFx.module.css";

const has = (v) => v != null;

// A transfer that has been waiting behind an overlay this long is no longer
// news. It stays in the log; it just stops being a toast.
const STALE_MS = 6000;

// My point of view, always. The TV says "Koli pays Afo"; this says "You paid
// Koli" — the same sentence the event log already speaks in.
function lineFor(a, players, meFig) {
  const t = a.lead;
  const reason = REASON_TEXT[t.reason] ? ` ${REASON_TEXT[t.reason]}` : "";
  const amount = fmt(a.shown ?? a.total);
  const name = (f) => (f === meFig ? "You" : nameOfFig(players, f));
  const lower = (f) => (f === meFig ? "you" : nameOfFig(players, f));

  if (a.group?.kind === "each-out") {
    const who = a.group.who;
    return who === meFig
      ? { text: `You paid everyone ${amount}`, tone: "neg" }
      : { text: `${name(who)} paid everyone ${amount}`, tone: a.involvesMe ? "pos" : "neu" };
  }
  if (a.group?.kind === "each-in") {
    const who = a.group.who;
    return who === meFig
      ? { text: `Everyone paid you ${amount}`, tone: "pos" }
      : { text: `Everyone paid ${name(who)} ${amount}`, tone: a.involvesMe ? "neg" : "neu" };
  }

  if (!has(t.from)) {
    // From the bank.
    return t.to === meFig
      ? { text: `You collected ${amount}${reason ? ` for${reason}` : ""}`, tone: "pos" }
      : { text: `${name(t.to)} collected ${amount}`, tone: "neu" };
  }
  if (!has(t.to)) {
    // To the bank.
    return t.from === meFig
      ? { text: `You paid the bank ${amount}${reason}`, tone: "neg" }
      : { text: `${name(t.from)} paid the bank ${amount}`, tone: "neu" };
  }
  if (t.from === meFig) return { text: `You paid ${lower(t.to)} ${amount}${reason}`, tone: "neg" };
  if (t.to === meFig) return { text: `${name(t.from)} paid you ${amount}${reason}`, tone: "pos" };
  return { text: `${name(t.from)} paid ${lower(t.to)} ${amount}${reason}`, tone: "neu" };
}

function Side({ fig, players, size }) {
  if (!has(fig)) {
    return (
      <span className={s.bank} style={{ "--sz": `${size}px` }} aria-hidden="true">
        <Landmark size={Math.round(size * 0.52)} />
      </span>
    );
  }
  return <Tok player={playerByFig(players, fig) ?? { figure: fig }} size={size} />;
}

const enter = {
  hidden: { opacity: 0, y: -10, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * items     announcements() output for the batch just released, already
 *           totalled (see ClientScreen) — [] when nothing moved
 * token     bumps once per released batch; a new token queues `items`
 * delay     ms to wait before the first one (the piece moves first)
 * blocked   an overlay owns the screen: pause, do not overlap it
 * vibrate   the player has sound & vibration on
 */
export default function PayFx({
  items,
  token,
  delay = 0,
  blocked = false,
  players = [],
  meFig = null,
  vibrate = false,
}) {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const seen = useRef(null);
  const timer = useRef(null);
  const buzzed = useRef(null);

  // A new batch lands: everything it moved joins the queue, in order.
  useEffect(() => {
    if (token == null || token === seen.current) return;
    seen.current = token;
    if (!items || items.length === 0) return;
    const at = Date.now();
    const stamped = items.map((a, i) => ({
      ...a,
      uid: `${token}:${a.key}:${i}`,
      first: i === 0,
      at,
    }));
    setQueue((q) => [...q, ...stamped]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // One at a time, and never while something else owns the screen. A card that
  // sits open for a while is a real possibility (it takes a tap to dismiss), so
  // anything that waited too long is dropped rather than shown as news — the
  // log has it, and the log is where old things belong.
  useEffect(() => {
    if (current || blocked || queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    if (Date.now() - next.at > STALE_MS) {
      setQueue(rest);
      return undefined;
    }
    const wait = next.first ? delay : REVEAL.PAY_STAGGER_MS;
    const t = setTimeout(() => {
      setQueue(rest);
      setCurrent(next);
    }, wait);
    return () => clearTimeout(t);
  }, [current, blocked, queue, delay]);

  useEffect(() => {
    if (!current) return undefined;
    timer.current = setTimeout(() => setCurrent(null), REVEAL.TOAST_MS);
    return () => clearTimeout(timer.current);
  }, [current]);

  // A short pattern, only when I am one of the two sides, only if the player
  // has "Sound and vibration" on, and only where the browser has it at all
  // (iOS Safari does not implement it; nothing here throws when it is missing).
  useEffect(() => {
    if (!current || !current.involvesMe || !vibrate) return;
    if (buzzed.current === current.uid) return;
    buzzed.current = current.uid;
    try {
      const out = current.lead.from === meFig;
      navigator?.vibrate?.(out ? [18, 40, 26] : [14, 36, 14]);
    } catch {
      /* haptics are a nicety */
    }
  }, [current, vibrate]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const line = current ? lineFor(current, players, meFig) : null;
  // Full width and display type only for money I am actually part of — and
  // never for a purchase or a house, which is money I spent by pressing a
  // button a moment ago and already know about.
  const big = !!current?.involvesMe && current.weight !== "quiet";

  return (
    <>
      <div className={s.layer} aria-hidden="true">
        <AnimatePresence mode="wait">
          {current && (
            <m.div
              key={current.uid}
              className={`${s.toast} ${big ? s.big : s.pill} ${s[line.tone]}`}
              variants={enter}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <span className={s.row}>
                <Side fig={current.lead.from} players={players} size={big ? 30 : 22} />
                <span className={s.arrow} />
                <span className={s.amt}>{fmt(current.shown ?? current.total)}</span>
                <span className={s.arrow} />
                <Side fig={current.lead.to} players={players} size={big ? 30 : 22} />
              </span>
              <span className={s.text}>{line.text}</span>
            </m.div>
          )}
        </AnimatePresence>
      </div>
      <span className={s.sr} role="status" aria-live="polite">
        {line?.text ?? ""}
      </span>
    </>
  );
}
