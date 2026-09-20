// The tinted half of the screen: who you are, what you have, whose turn it is,
// and the last three things that happened.
//
// Nothing here is a control except the log affordance and, when a banner brings
// one, its single way out (the pending trade offer's Cancel) — the aura is the
// part you read, the panel underneath is the part you press.
//
// Layout: one top block (banners + name/cash/turn) and one bottom block (the
// events). The banners used to be a grid child of their own, which made
// `space-between` strand the name and cash halfway down an empty screen.

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { m, AnimatePresence, fadeUp } from "../Components/Motion";
import { fmt, fmtSigned } from "./format";
import EventRow from "./EventRow";
import Tok from "./Tok";
import s from "./screen.module.css";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Counts to the new balance instead of snapping, bumps once when it changes,
// and whispers the difference beside the name so a player can see what a turn
// cost them without reading the log.
//
// `delay` is the one addition: when the money moved because of a TRANSFER, the
// count is held back until the moment the coins crossing the TV would land, so
// every screen in the room tells the same story at the same instant. Zero for
// everything else, which is exactly the behaviour this always had.
//
// `animate()` is framer-motion's standalone driver: it is outside the React
// tree, so MotionConfig reducedMotion never reaches it. The check has to
// happen here.
function Money({ name, value, flag, delay = 0 }) {
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState(null);
  const [beat, setBeat] = useState(0);
  const prev = useRef(value);
  const clear = useRef(null);
  const wait = useRef(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) {
      setShown(value);
      return undefined;
    }

    let controls = null;
    const run = () => {
      setDelta(value - from);
      setBeat((n) => n + 1);
      clearTimeout(clear.current);
      clear.current = setTimeout(() => setDelta(null), 2200);

      if (prefersReducedMotion()) {
        setShown(value);
        return;
      }
      controls = animate(from, value, {
        duration: 0.5,
        ease: "easeOut",
        onUpdate: (v) => setShown(v),
      });
    };

    clearTimeout(wait.current);
    if (delay > 0) wait.current = setTimeout(run, delay);
    else run();

    return () => {
      clearTimeout(wait.current);
      controls?.stop();
    };
    // `delay` is read at the moment the value changes and must not restart the
    // count on its own — it arrives in the same commit as the new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(
    () => () => {
      clearTimeout(clear.current);
      clearTimeout(wait.current);
    },
    [],
  );

  const flash = delta == null || delta === 0 ? undefined : delta > 0 ? "pos" : "neg";

  return (
    <>
      <span className={s.dName}>
        <span className={s.dNameText}>{name}</span>
        {flag && <span className={s.dFlag}>{flag}</span>}
        {delta != null && delta !== 0 && (
          <span className={`${s.dDelta} ${delta > 0 ? s.dPos : s.dNeg}`}>{fmtSigned(delta)}</span>
        )}
      </span>
      {/* the key restarts the bump AND the flash keyframes on every change */}
      <span key={beat} className={s.cashBox} data-flash={flash}>
        <strong className={s.bump}>{fmt(Math.round(shown))}</strong>
      </span>
    </>
  );
}

export default function Aura({
  me,
  players = [],
  current,
  winner,
  turnLabel,
  placeholder = "—",
  loading = false,
  banners = [],
  events = [],
  ctx,
  onOpenLog,
  children,
  // The transient money layer (PayFx.jsx) and how long the cash number waits
  // before it counts. Both are pure presentation handed in by the screen.
  payFx = null,
  cashDelay = 0,
}) {
  const ordered = [...players].sort((a, b) => a.order - b.order);

  return (
    <section className={s.aura} aria-label="Game status">
      <div className={s.auraTop}>
        {/* Hangs from the BOTTOM of this block, into the empty middle of the
            aura: a transfer must never cover the cash number it is about. */}
        {payFx}
        <div className={s.banners}>
          <AnimatePresence mode="popLayout">
            {banners.map((b) => (
              <m.p
                key={b.key}
                role={b.tone === "err" ? "alert" : "status"}
                className={`${s.bn} ${b.tone === "err" ? s.bnErr : ""} ${
                  b.tone === "good" ? s.bnGood : ""
                } ${b.tone === "warn" ? s.bnWarn : ""}`}
                variants={fadeUp}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                {b.text}
                {/* A banner can carry exactly one way out — the pending trade
                    offer's Cancel. Everything else is still read-only. */}
                {b.action && (
                  <button
                    type="button"
                    className={s.bnBtn}
                    onClick={b.action.onClick}
                    disabled={b.action.disabled}
                    aria-disabled={b.action.disabled || undefined}
                    aria-label={b.action.label}
                  >
                    {b.action.text}
                  </button>
                )}
              </m.p>
            ))}
          </AnimatePresence>
        </div>

        <div className={s.dSplit}>
          <div className={s.dLeft}>
            {me ? (
              <Money
                name={me.name}
                value={me.money ?? 0}
                flag={me.inJail ? "In jail" : null}
                delay={cashDelay}
              />
            ) : loading ? (
              <span aria-label="Loading">
                <span className={`${s.skel} ${s.skelName}`} />
                <span className={`${s.skel} ${s.skelCash}`} />
              </span>
            ) : (
              <span className={s.dName}>{placeholder}</span>
            )}
          </div>
          <div className={s.dRight}>
            {turnLabel ? (
              <strong className={s.dTurn}>{turnLabel}</strong>
            ) : loading ? (
              <span className={`${s.skel} ${s.skelTurn}`} />
            ) : null}
            {ordered.length > 0 && (
              // Same 22px token a 4-player room has always shown; past four it
              // steps down to 20 — Tok's own floor for drawing the figure art
              // at all (below that it falls back to a lettered dot, which
              // would be a worse regression than a slightly smaller token) —
              // so a 5th/6th seat wraps onto its own line (`.order`'s
              // `flex-wrap`) sooner, rather than squeezing onto the first.
              <ol className={s.order} aria-label="Turn order">
                {ordered.map((p) => (
                  <li
                    key={p.playerId}
                    className={`${
                      current?.playerId === p.playerId && !winner ? s.isNow : ""
                    } ${p.bankrupt ? s.isOut : ""}`}
                  >
                    <Tok player={p} size={ordered.length > 4 ? 20 : 22} className={s.oTok} />
                    <span className={s.sr}>
                      {p.name}
                      {p.bankrupt ? " (out)" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      {children ?? (
        <div className={s.evsWrap}>
          {/* One real button, on the same line as the section label, so the
              affordance does not cost a 44px band under the rows — and the
              list itself is not a click target pretending to be one. */}
          <div className={s.evsHead}>
            <span className={s.evsLab}>
              {events.length === 0 ? "Nothing has happened yet" : "Latest"}
            </span>
            <button type="button" className={s.evsMore} onClick={onOpenLog}>
              Full log
              <ChevronRight size={14} />
            </button>
          </div>
          <ul className={s.evs} aria-label="What just happened" aria-live="polite">
            {events.map((it) => (
              <EventRow
                key={it.key}
                event={it.ev}
                ctx={ctx}
                fresh={it.fresh}
                // Single line, as it was: this block is above the ticket and
                // the roll button and must not grow. A row whose text does not
                // fit becomes a button that opens the full log at itself.
                onOpen={onOpenLog ? () => onOpenLog(it.logKey) : undefined}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
