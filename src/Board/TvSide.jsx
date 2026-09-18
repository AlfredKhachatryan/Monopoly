// The right-hand column: which room this is, who is playing, what they own and
// what just happened.
//
// PROPS (contract with the shell): roomId board players game current controls error
//
// ---------------------------------------------------------------------------
// Everything has to fit, always
// ---------------------------------------------------------------------------
// The column is 1024px tall and never scrolls — a board on a wall with a
// scrollbar is a broken board. Four players holding ten properties each is the
// worst case the game can produce, and the latest list still has to be there
// underneath. So the column squeezes, in this order:
//
//   1. the latest list drops from 4 rows to 3, then to 2
//   2. property swatches go 30px -> 26px
//   3. the player cards tighten their padding and gaps, and the player token
//      drops from the figure manual's 56px to 48px
//
// The type never shrinks: a board is read from across a room.
//
// It is measured, not guessed: the latest list sits in a `minmax(0, 1fr)` track,
// so its height IS the space left over once the header and the players have
// taken theirs. Reading that one number says both how many rows fit and whether
// the cards above need to give something back. The loop terminates because
// `dens` only ever increases within one set of data, and the row count does not
// feed back into the track height.
//
// ---------------------------------------------------------------------------
// Neutral names
// ---------------------------------------------------------------------------
// Event rows are the shared EventRow with `meFig: null`, which is what makes
// describeEvent say "Koli" where the phone would say "You". One sentence still
// leaks: a `trade` event with status `expired` quotes the server's reason
// verbatim, and the server writes those in the second person ("You do not own
// Далма Молл"). The TV has no second person, so the reason is dropped here
// before the row ever sees it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "framer-motion";
import { ownedBy } from "../Hooks/rules";
import { groupByColor } from "../Hooks/groupByColor";
import { Pips, hasCyrillic } from "../Client/boardDisplay";
import { describeEvent } from "../Client/EventView";
import EventRow from "../Client/EventRow";
import Mark from "../Client/Mark";
import Tok from "../Client/Tok";
import { fmt, fmtSigned } from "../Client/format";
import * as figures from "../Client/figures";
import { useTvFeed, useTvReduce } from "./TvFeed";
import s from "./tvSide.module.css";

// "Imp" / "Cyclops" / "Specter" / "Yeti", once the shared figure module
// publishes them. A namespace import rather than a named one on purpose: the
// key is being added by another agent, and a named import of an export that
// does not exist yet is a build error, not an undefined.
const FIGURE_NAME = figures.FIGURE_NAME ?? {};

// The numbers the squeeze reasons with. They mirror tvSide.module.css: a row is
// 40px, rows are 8px apart, and the "Latest" label plus its gap is 26px.
const ROW_H = 40;
const ROW_GAP = 8;
const LABEL_H = 26;
const MIN_ROWS = 2;
const MAX_ROWS = 4;

const SW = [30, 26, 26]; // property swatch size per density step
// Token size per density step. 56px is the figure manual's size for a TV player
// card; the tightest step trims it to 48 rather than touching the type.
const TOK = [56, 56, 48];

// `delay` is the count-up's one addition: when money moved because of a
// TRANSFER, the coins crossing the column (TvPayFx) are the story, and the
// number is what they turn into when they land. So the count waits for them
// rather than being finished before they have left. Zero for everything else.
//
// The flash ring is the same beat: a red or green wash round the card for as
// long as the delta chip lingers, so a player glancing up a second later can
// still see who gained and who lost.
function TvCash({ value, reduce, className, delay = 0 }) {
  const target = Math.round(Number(value) || 0);
  const [shown, setShown] = useState(target);
  const [delta, setDelta] = useState(null);
  const prev = useRef(target);
  const wait = useRef(null);
  const clear = useRef(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) {
      setShown(target);
      return undefined;
    }

    let run = null;
    const go = () => {
      setDelta(target - from);
      clearTimeout(clear.current);
      clear.current = setTimeout(() => setDelta(null), 2000);
      if (reduce) {
        setShown(target);
        return;
      }
      // A count-up, not a slot machine: react-animated-numbers spins each digit
      // separately and reads as noise at 48px across a room.
      run = animate(from, target, {
        duration: Math.min(0.9, 0.25 + Math.abs(target - from) / 2500),
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (v) => setShown(Math.round(v)),
        onComplete: () => setShown(target),
      });
    };

    clearTimeout(wait.current);
    if (delay > 0 && !reduce) wait.current = setTimeout(go, delay);
    else go();

    return () => {
      clearTimeout(wait.current);
      run?.stop();
    };
    // `delay` arrives in the same commit as the new value and must not restart
    // the count on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce]);

  useEffect(
    () => () => {
      clearTimeout(wait.current);
      clearTimeout(clear.current);
    },
    [],
  );

  return (
    <span className={s.cashBox} data-move={delta ? (delta > 0 ? "pos" : "neg") : undefined}>
      <span className={className}>{fmt(shown)}</span>
      {delta ? (
        <span className={`${s.cashDelta} ${delta > 0 ? s.cashPos : s.cashNeg}`}>
          {fmtSigned(delta)}
        </span>
      ) : null}
    </span>
  );
}

// The server writes an expired trade's reason in the second person. Nothing on
// this screen is addressed to anybody, so it goes.
function neutral(ev) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "trade" && ev.status === "expired" && ev.reason) {
    const { reason, ...rest } = ev;
    return rest;
  }
  return ev;
}

export default function TvSide({
  roomId,
  board,
  players,
  game,
  current,
  controls,
  error,
  // How long the cash numbers wait before they count — see TvCash above.
  cashDelay = 0,
}) {
  const feed = useTvFeed(game);
  const reduce = useTvReduce();

  const list = useMemo(
    () => [...(players || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
    [players],
  );
  const over = game?.phase === "over" || !!game?.winner;

  // One pass over the board per render, shared by the cards and the squeeze.
  const cards = useMemo(
    () =>
      list.map((p) => {
        const owned = ownedBy(board, p.figure);
        return { p, owned, groups: groupByColor(owned) };
      }),
    [list, board],
  );

  const ctx = useMemo(
    () => ({ players: list, board, meFig: null }),
    [list, board],
  );

  // Newest first, only what can actually be drawn. Keys are `<seq>#<n within
  // that seq>` so a log that shifts (it is capped at 40) does not remount every
  // row and replay every animation.
  const rowsData = useMemo(() => {
    const log = Array.isArray(game?.log) ? game.log : null;
    const src = log && log.length > 0 ? log : Array.isArray(game?.events) ? game.events : [];
    const counts = new Map();
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const ev = neutral(src[i]);
      if (!ev) continue;
      const seq = ev.seq ?? "e";
      const n = counts.get(seq) ?? 0;
      counts.set(seq, n + 1);
      let ok = false;
      try {
        ok = !!describeEvent(ev, ctx);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      out.push({ ev, key: `${seq}#${n}`, seq: ev.seq ?? null });
    }
    return out.reverse().slice(0, MAX_ROWS);
  }, [game?.log, game?.events, ctx]);

  // ---- the squeeze -------------------------------------------------------
  const latestRef = useRef(null);
  const [dens, setDens] = useState(0);
  const [rows, setRows] = useState(MAX_ROWS);

  const shape = `${cards.length}:${cards.map((c) => c.owned.length).join(",")}`;
  const shapeRef = useRef(shape);
  useLayoutEffect(() => {
    if (shapeRef.current === shape) return;
    shapeRef.current = shape;
    setDens(0); // a new hand of properties gets the full layout offered again
  }, [shape]);

  useLayoutEffect(() => {
    const el = latestRef.current;
    if (!el) return;
    const h = el.clientHeight;
    const need = LABEL_H + ROW_H * MIN_ROWS + ROW_GAP;
    if (h < need && dens < SW.length - 1) {
      setDens(dens + 1);
      return;
    }
    const fit = Math.max(
      MIN_ROWS,
      Math.min(MAX_ROWS, Math.floor((h - LABEL_H + ROW_GAP) / (ROW_H + ROW_GAP))),
    );
    if (fit !== rows) setRows(fit);
  });

  const sw = SW[Math.min(dens, SW.length - 1)];
  const tokSize = TOK[Math.min(dens, TOK.length - 1)];
  const shown = rowsData.slice(0, rows);
  const n = list.length;
  const code = roomId || "—";

  return (
    <aside
      className={`${s.side} ${dens > 0 ? s[`d${dens}`] : ""}`}
      aria-label="Players and latest events"
    >
      <div className={s.top}>
        {/* The bank's end of a coin flight: money leaving or entering the game
            comes from (or goes to) the top of the column, where the room is
            named. Nothing is drawn here — TvPayFx only measures it. */}
        <div className={s.topRow} data-pay-anchor="bank">
          <span className={s.brand}>Room {code}</span>
          <span className={s.label}>
            {n} {n === 1 ? "player" : "players"}
          </span>
        </div>
        {controls && <div className={s.controls}>{controls}</div>}
        {error && (
          <p className={s.err} role="status">
            {error}
          </p>
        )}
        {n === 0 && <p className={s.hint}>Open /Login on your phone and enter {code}</p>}
      </div>

      <div className={s.players}>
        {cards.map(({ p, owned, groups }) => {
          const isNow =
            !over &&
            !!current &&
            (current.playerId != null
              ? current.playerId === p.playerId
              : current.figure === p.figure);
          const isWin = !!game?.winner && game.winner === p.figure;
          const deeds = owned.length;
          const sub = p.bankrupt
            ? "Out of the game"
            : [
                FIGURE_NAME[p.figure] || null,
                deeds > 0 ? `${deeds} deed${deeds === 1 ? "" : "s"}` : null,
                `on ${board?.[p.position]?.header ?? "the board"}`,
              ]
                .filter(Boolean)
                .join(" · ");

          return (
            <article
              key={p.playerId ?? p.figure}
              className={`${s.pl} ${isNow ? s.isNow : ""} ${p.bankrupt ? s.isDim : ""}`}
              /* Where the flying coins start and end. Measured off the
                 offsetLeft/offsetTop chain by TvPayFx, like TvTokens does, so
                 it is in the unscaled 1920x1080 space whatever the window. */
              data-pay-anchor={p.figure}
            >
              <div className={s.plTop}>
                <span className={s.plFig}>
                  <Tok player={p} size={tokSize} />
                </span>
                <div className={s.plField}>
                  <strong className={s.plLine}>
                    <span lang={hasCyrillic(p.name) ? "ru" : undefined}>{p.name}</span>
                    {isNow && <span className={s.now}>Now</span>}
                    {p.inJail && !p.bankrupt && <span className={s.tag}>Jail</span>}
                    {p.bankrupt && <span className={s.tag}>Out</span>}
                    {isWin && <span className={`${s.tag} ${s.tagWin}`}>Winner</span>}
                  </strong>
                  <span className={s.plSub}>{sub}</span>
                </div>
                <TvCash value={p.money} reduce={reduce} className={s.cash} delay={cashDelay} />
              </div>

              <div className={s.props}>
                {deeds === 0 ? (
                  <span className={s.propsEmpty}>No properties yet</span>
                ) : (
                  groups.map(([color, cells]) => (
                    <div className={s.grp} key={color ?? "none"}>
                      {cells.map((cell) => (
                        <span className={s.sw} key={cell.id}>
                          <Mark cell={cell} size={sw} radius={Math.round(sw * 0.27)} />
                          <Pips houses={cell.houses} className={s.swPips} />
                        </span>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </article>
          );
        })}
      </div>

      <section className={s.latest} ref={latestRef} aria-label="Latest">
        <span className={s.label}>Latest</span>
        <ul className={s.evs}>
          {shown.map((r) => (
            <EventRow
              key={r.key}
              event={r.ev}
              ctx={ctx}
              /* The figure manual's size for a TV feed row: 32px tokens,
                 marks and icon circles. The row's 40px min-height and 4px
                 padding were already sized for exactly this. */
              size={32}
              fresh={feed != null && (r.seq == null || r.seq === feed.seq)}
            />
          ))}
        </ul>
      </section>
    </aside>
  );
}
