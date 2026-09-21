// The tinted half of the screen, and since the "hero deed card" rework most of
// it: a slim bar saying who you are, what you have and whose turn it is; the
// space you are standing on as a large deed card; and the ONE latest thing that
// happened.
//
// Nothing here is a control except the log affordance, the card's own Build
// pill and, when a banner brings one, its single way out (the pending trade
// offer's Cancel) — the aura is the part you read, the panel underneath is the
// part you press.
//
// Layout, three rows:
//   .auraTop   banners + the bar. Still ONE block: the banners used to be a
//              grid child of their own, which made `space-between` strand the
//              name and cash halfway down an empty screen.
//   `card`     the flexible row. It used to be a void — the events hung off the
//              bottom edge and everything between them and the cash was empty
//              tint, while the space you were standing on was squeezed into a
//              118px ticket in the panel below. The card (Ticket.jsx) now has
//              that row, and sizes itself to whatever height it is given.
//   .latest    one event row and the way into the full log. It was three rows;
//              the other two were a second copy of a list that is one tap away,
//              and they were paid for out of the card's height.
//
// `children` still replaces the last two rows wholesale — that is how the
// loading line and the end-of-game trophy get the aura to themselves.

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { ChevronRight, Handshake, Skull, Swords } from "lucide-react";
import { m, AnimatePresence, fadeUp } from "../Components/Motion";
import { fmt, fmtSigned } from "./format";
import EventRow from "./EventRow";
import Tok from "./Tok";
import s from "./screen.module.css";

// Status at a glance, for the ONE row that has to fit turn order tokens, the
// pot pill and now this too on a 320px phone: an icon and a couple of words,
// never a sentence. `diploStatus` is built by ClientScreen from the same
// src/Hooks/diplomacy.js helpers the Players sheet uses, so the two can never
// disagree about whether I am, right now, allied / at war / a branded
// Traitor — see the derivation next to `myAllyFig` there.
const STATUS_ICON = { ally: Handshake, war: Swords, traitor: Skull };

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Counts to the new balance instead of snapping, bumps once when it changes,
// and whispers the difference beside the name so a player can see what a turn
// cost them without reading the log.
//
// It renders a FRAGMENT — the name (with its flag and whisper) and the cash —
// and leaves placing the two to the caller, so the bar can put them on one line
// with the turn label without this component knowing the bar exists.
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
  // The deed card for the space the screen is about (Ticket.jsx), or null for
  // the one player who is betting at the casino. A slot rather than an import:
  // which cell it shows, whether Build is live and what its label says are all
  // ClientScreen's decisions; the aura only decides where it goes.
  card = null,
  children,
  // The transient money layer (PayFx.jsx) and how long the cash number waits
  // before it counts. Both are pure presentation handed in by the screen.
  payFx = null,
  cashDelay = 0,
  // The Free Parking pot (game.pot). A running total of every fine paid to the
  // bank, waiting on cell 21 for whoever lands there. Shown only when it has
  // something in it — the server pays nothing and emits nothing for a pot of
  // 0, so a "POT 0$" chip would be a number that can never do anything.
  pot = 0,
  // My own diplomacy status, compact: [{ key: "ally"|"war"|"traitor", text }].
  // Empty for a room that predates diplomacy, or for a player with nothing to
  // report — the row below already hides itself when it has nothing to show,
  // same rule the pot pill follows.
  diploStatus = [],
}) {
  const ordered = [...players].sort((a, b) => a.order - b.order);

  return (
    <section className={s.aura} aria-label="Game status">
      <div className={s.auraTop}>
        {/* Hangs from the BOTTOM of this block: a transfer must never cover
            the cash number it is about. What lies below this block is no
            longer empty — it is the deed card — so the toast now drops over
            the card's band for the two seconds it lives. That is the right
            thing to cover: the card will still be there afterwards, and the
            cash is the half of the story the toast is telling. */}
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

        {/* The bar. Line one is the sentence the design asked for — name, cash,
            turn — and line two is the two permanent facts about the room that
            used to be stacked under the turn label: the order of play and the
            Free Parking pot. Two lines rather than one because a 360px phone
            cannot fit six tokens beside a name, a number and "Aleksandr's
            turn"; a landscape phone can, and the stylesheet folds both onto
            one line there. */}
        <div className={s.bar}>
          <div className={s.barMain}>
            {me ? (
              <Money
                name={me.name}
                value={me.money ?? 0}
                flag={me.inJail ? "In jail" : null}
                delay={cashDelay}
              />
            ) : loading ? (
              <span className={s.barSkel} aria-label="Loading">
                <span className={`${s.skel} ${s.skelName}`} />
                <span className={`${s.skel} ${s.skelCash}`} />
              </span>
            ) : (
              <span className={s.dName}>{placeholder}</span>
            )}
            {turnLabel ? (
              <strong className={s.dTurn}>{turnLabel}</strong>
            ) : loading ? (
              <span className={`${s.skel} ${s.skelTurn}`} />
            ) : null}
          </div>
          {(ordered.length > 0 || diploStatus.length > 0 || pot > 0) && (
            <div className={s.barSub}>
              {/* Turn order and my diplomacy status share the LEFT side of
                  this row, both wrapping together, so the pot pill on the
                  right is the only thing that ever gets pushed onto a line of
                  its own on a narrow phone — never the cash/turn line above,
                  which this whole row sits under precisely to protect. */}
              <div className={s.barLeft}>
                {ordered.length > 0 && (
                  // Same 22px token a 4-player room has always shown; past four
                  // it steps down to 20 — Tok's own floor for drawing the figure
                  // art at all (below that it falls back to a lettered dot,
                  // which would be a worse regression than a slightly smaller
                  // token) — so six seats still share the line with the pot
                  // pill, and `.order`'s `flex-wrap` catches them if they do not.
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
                {diploStatus.map((st) => {
                  const Ico = STATUS_ICON[st.key];
                  return (
                    <span key={st.key} className={`${s.statChip} ${s[`stat_${st.key}`] || ""}`}>
                      {Ico && <Ico size={12} aria-hidden="true" />}
                      {st.text}
                    </span>
                  );
                })}
              </div>
              {pot > 0 && (
                <span className={s.potPill}>
                  <span aria-hidden="true">Pot</span>
                  <strong aria-hidden="true">{fmt(pot)}</strong>
                  {/* the two visible bits read as "Pot 450$" out of order and
                      without context; one sentence replaces both */}
                  <span className={s.sr}>{fmt(pot)} waiting on Free Parking</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {children ?? (
        <>
          {/* Always a grid child, even when there is no card (the bettor at
              the casino): this is the flexible row, and with nothing in it the
              latest line would be auto-placed INTO that row and stretch. */}
          {card ?? <div aria-hidden="true" />}

          {/* One line. `events` still arrives as the newest few describable
              events, newest first (ClientScreen's `recent`); only the first is
              drawn. The list keeps its <ul>, its label and its `aria-live`, so
              a screen reader hears what it always heard — each new event,
              once, as it replaces the last — and the button beside it is the
              way to everything older. */}
          <div className={s.latest}>
            {events.length === 0 && <span className={s.evsLab}>Nothing has happened yet</span>}
            <ul className={s.evs} aria-label="What just happened" aria-live="polite">
              {events.slice(0, 1).map((it) => (
                <EventRow
                  key={it.key}
                  event={it.ev}
                  ctx={ctx}
                  fresh={it.fresh}
                  // Single line, as it was: this row sits between the card and
                  // the panel and must not grow. A row whose text does not fit
                  // becomes a button that opens the full log at itself.
                  onOpen={onOpenLog ? () => onOpenLog(it.logKey) : undefined}
                />
              ))}
            </ul>
            {/* One real button on the same line as the row, so the affordance
                does not cost a 44px band of its own — and the row itself is
                not a click target pretending to be one. */}
            <button
              type="button"
              className={s.evsMore}
              onClick={onOpenLog}
              aria-label="Open the full log"
            >
              Log
              <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
