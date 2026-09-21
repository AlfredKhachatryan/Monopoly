// The main stage for money: the TV is what everybody at the table is looking
// at, so this is where a payment is actually announced.
//
// Three things happen at once, and they are one sentence read three ways:
//
//   (a) a BANNER across the board centre, big enough to read from a sofa:
//         [payer token 64]  ->  amount  ->  [payee token 64 | bank]
//         "Koli pays Afo 80$ rent · Spotify"
//       neg-tinted on the payer's side, pos-tinted on the payee's.
//   (b) COINS travelling on a curved path from the payer's player card in the
//       right column to the payee's (or to and from the Bank anchor at the top
//       of that column), 6-10 discs with staggered starts.
//   (c) the two CASH NUMBERS counting, with a red/green wash and a delta chip —
//       that part lives in TvSide, timed to land exactly when the coins do
//       (BoardScreen hands it the same delay this layer is given).
//
// COORDINATES. The whole TV is one element with `transform: scale(s)` on it, so
// getBoundingClientRect() would hand back SCALED pixels while everything here
// is positioned in the unscaled 1920x1080 space. The anchors are therefore read
// off the offsetLeft/offsetTop chain — pure layout values a CSS transform does
// not touch — exactly as TvTokens does for the board's tiles.
//
// Nothing here is interactive and nothing here is announced: the banner's own
// sentence is read out once through the polite live region at the bottom, the
// coins are decoration.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Landmark } from "lucide-react";
import { m, AnimatePresence } from "../Components/Motion";
import { nameOfFig, playerByFig } from "../Hooks/rules";
import { fmt } from "../Client/format";
import { REASON_TEXT } from "../Client/transfers";
import { REVEAL } from "../Client/useReveal";
import Tok from "../Client/Tok";
import { useTvReduce } from "./TvFeed";
import s from "./tvPayFx.module.css";

const COINS_MIN = 6;
const COINS_MAX = 10;
const COIN_STAGGER = 55;
const ARC_SAMPLES = 24;
// How long an announcement may sit in the queue before it stops being news —
// counted from the moment it became ELIGIBLE, not from the moment the batch
// landed. `delay` is a real wait of its own now (a card's read beat is
// REVEAL.CARD_READ_MS on top of the piece's hop, and a chain is two of those),
// and charging this layer for a wait it was told to make would drop the
// announcement for being late when it was never allowed to be early.
const STALE_MS = 8000;

const has = (v) => v != null;

// Distance from `el`'s border box to `root`'s, up the offsetParent chain.
function offsetIn(el, root) {
  let x = 0;
  let y = 0;
  let node = el;
  while (node && node !== root && node.offsetParent !== undefined) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  return { x, y };
}

function centreOf(el, root) {
  const { x, y } = offsetIn(el, root);
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

// A quadratic arc from A to B, bowed towards the middle of the screen, sampled
// evenly so framer plays it as one continuous curve rather than two eased
// halves meeting at the peak.
function arc(a, b, bow) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * bow;
  const cy = my + ny * bow;
  const ctrlX = 2 * cx - mx;
  const ctrlY = 2 * cy - my;
  const xs = [];
  const ys = [];
  const times = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const u = i / ARC_SAMPLES;
    const t = 0.5 - Math.cos(Math.PI * u) / 2; // one gentle ease over the flight
    const p = 1 - t;
    xs.push(p * p * a.x + 2 * p * t * ctrlX + t * t * b.x);
    ys.push(p * p * a.y + 2 * p * t * ctrlY + t * t * b.y);
    times.push(u);
  }
  return { xs, ys, times };
}

// Neutral names, always: the TV is not addressed to anybody.
function sentence(a, players, board) {
  const t = a.lead;
  const amount = fmt(a.shown ?? a.total);
  const who = (f) => (has(f) ? nameOfFig(players, f) : "the bank");
  const note = t.cell != null ? board?.[t.cell]?.header : null;
  const reason = REASON_TEXT[t.reason] ? ` ${REASON_TEXT[t.reason]}` : "";
  const tail = note ? ` · ${note}` : "";

  if (a.group?.kind === "each-out") return `${who(a.group.who)} pays everyone ${amount}${tail}`;
  if (a.group?.kind === "each-in") return `Everyone pays ${who(a.group.who)} ${amount}${tail}`;
  if (!has(t.from)) return `${who(t.to)} collects ${amount}${reason}${tail}`;
  if (!has(t.to)) return `${who(t.from)} pays the bank ${amount}${reason}${tail}`;
  return `${who(t.from)} pays ${who(t.to)} ${amount}${reason}${tail}`;
}

// The "…and everyone else" end of a group announcement, as an overlapped row of
// faces. Who that actually is comes from the TRANSFERS, not from the player
// list: "Koli pays everyone 50$" is five payments in a six-player room, and the
// old `players.slice(0, 4)` both cut two of them off and put the payer himself
// in the crowd he is paying. The room holds six, so five faces is the worst
// case; anything beyond that still gets a "+N" rather than a wider banner.
const CROWD_MAX = 5;

function Side({ fig, players, everyone, others }) {
  if (everyone) {
    const list = others.length > 0 ? others : players;
    const shown = list.slice(0, CROWD_MAX);
    const more = list.length - shown.length;
    // Four faces keep the size they have always had; five close up a little so
    // the row stays inside the slot a single 64px token would have taken.
    const size = shown.length > 4 ? 34 : 40;
    return (
      <span className={s.everyone} data-tight={size < 40 ? "" : undefined} aria-hidden="true">
        {shown.map((p) => (
          <Tok key={p.figure ?? p.name} player={p} size={size} />
        ))}
        {more > 0 && <span className={s.everyoneMore}>+{more}</span>}
      </span>
    );
  }
  if (!has(fig)) {
    return (
      <span className={s.bank} aria-hidden="true">
        <Landmark size={34} />
      </span>
    );
  }
  return <Tok player={playerByFig(players, fig) ?? { figure: fig }} size={64} />;
}

export default function TvPayFx({
  items,
  token,
  delay = 0,
  players = [],
  board = null,
  game = null,
}) {
  const layerRef = useRef(null);
  const reduce = useTvReduce();
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [coins, setCoins] = useState([]);
  const [anchors, setAnchors] = useState({});
  const seen = useRef(null);
  const outTimer = useRef(null);

  // An auction, a trade or the final standings own the centre while they are
  // up, and none of them may be covered. The coins and the cash numbers carry
  // the news on their own in that case.
  const busyOverlay =
    game?.phase === "over" || !!game?.winner || !!game?.auction || !!game?.trade;

  // ---- where things are ---------------------------------------------------
  const measure = () => {
    const root = layerRef.current?.parentElement;
    if (!root) return;
    const out = {};
    for (const el of root.querySelectorAll("[data-pay-anchor]")) {
      out[el.dataset.payAnchor] = centreOf(el, root);
    }
    const centre = root.querySelector("[data-tv-center]");
    if (centre) {
      const { x, y } = offsetIn(centre, root);
      out.__centre = { x, y, w: centre.offsetWidth, h: centre.offsetHeight };
    }
    setAnchors(out);
  };

  useLayoutEffect(() => {
    measure();
    const root = layerRef.current?.parentElement;
    if (!root) return undefined;
    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(root);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
    // Player cards come and go as people join; re-measure when the column's
    // shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length]);

  // ---- the queue ----------------------------------------------------------
  useEffect(() => {
    if (token == null || token === seen.current) return;
    seen.current = token;
    if (!items || items.length === 0) return;
    const at = Date.now();
    setQueue((q) => [...q, ...items.map((a, i) => ({ ...a, uid: `${token}:${a.key}:${i}`, first: i === 0, at }))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (current || queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    if (Date.now() - next.at - (Number(delay) || 0) > STALE_MS) {
      setQueue(rest);
      return undefined;
    }
    // Measured from the moment the batch was released, not from the moment
    // this queue got round to it — same rule as the phone's PayFx, so the two
    // screens announce the same transfer at the same moment however long
    // anything ahead of it in the queue took.
    const wait = next.first
      ? Math.max(0, (Number(delay) || 0) - (Date.now() - next.at))
      : REVEAL.PAY_STAGGER_MS;
    const t = setTimeout(() => {
      setQueue(rest);
      setCurrent(next);
    }, wait);
    return () => clearTimeout(t);
  }, [current, queue, delay]);

  // ---- one announcement ---------------------------------------------------
  useEffect(() => {
    if (!current) return undefined;
    // The coins: one flight per transfer in the announcement (a "pay each
    // player 50$" is three), each a handful of discs with staggered starts.
    if (!reduce) {
      const made = [];
      current.members.forEach((t, mi) => {
        const from = anchors[has(t.from) ? t.from : "bank"];
        const to = anchors[has(t.to) ? t.to : "bank"];
        if (!from || !to) return;
        const n = Math.max(
          COINS_MIN,
          Math.min(COINS_MAX, COINS_MIN + Math.round(t.amount / 120)),
        );
        for (let i = 0; i < n; i++) {
          const spread = (i - (n - 1) / 2) * 14;
          const bow = (mi % 2 === 0 ? -1 : 1) * (110 + spread * 2.2);
          made.push({
            id: `${current.uid}:${mi}:${i}`,
            path: arc(
              { x: from.x + spread * 0.5, y: from.y },
              { x: to.x + spread * 0.5, y: to.y },
              bow,
            ),
            delay: mi * REVEAL.PAY_STAGGER_MS + i * COIN_STAGGER,
            tone: has(t.to) ? "pos" : "neg",
          });
        }
      });
      setCoins(made);
    }
    outTimer.current = setTimeout(
      () => {
        setCurrent(null);
        setCoins([]);
      },
      REVEAL.BANNER_IN_MS + REVEAL.BANNER_HOLD_MS,
    );
    return () => clearTimeout(outTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reduce]);

  useEffect(() => () => clearTimeout(outTimer.current), []);

  const text = current ? sentence(current, players, board) : "";
  // Everybody on the OTHER side of a group announcement, in seating order: the
  // payees of a "pays everyone", the payers of a "collects from everyone". Read
  // off the transfers themselves, so it is exactly who moved money and never
  // the whole room minus nobody.
  const crowd = useMemo(() => {
    if (!current?.group) return [];
    const side = current.group.kind === "each-out" ? "to" : "from";
    const seen = new Set();
    const out = [];
    for (const t of current.members) {
      const f = t[side];
      if (!has(f) || f === current.group.who || seen.has(f)) continue;
      seen.add(f);
      out.push(playerByFig(players, f) ?? { figure: f, name: f });
    }
    return out;
  }, [current, players]);
  const centre = anchors.__centre;
  // A purchase or a house is the quiet end of the scale: the coins and the cash
  // still move, but the board centre does not stop to announce it.
  const banner = current && !busyOverlay && centre && current.weight !== "quiet";
  const tone = current
    ? has(current.lead.to) && has(current.lead.from)
      ? "p2p"
      : has(current.lead.to)
        ? "pos"
        : "neg"
    : null;

  // The banner hangs from the BOTTOM of the board centre. That keeps it in the
  // middle of the board — where everyone is already looking — while leaving the
  // 440x540 card face above it completely clear, so a card and the transfer it
  // caused can be read one after the other without either moving.
  const style = useMemo(
    () =>
      centre
        ? { left: centre.x + 32, width: centre.w - 64, top: centre.y + centre.h - 150 }
        : undefined,
    [centre],
  );

  return (
    <div ref={layerRef} className={s.layer}>
      {!reduce && (
        <div className={s.coins} aria-hidden="true">
          <AnimatePresence>
            {coins.map((c) => (
              <m.span
                key={c.id}
                className={`${s.coin} ${c.tone === "neg" ? s.coinNeg : s.coinPos}`}
                initial={{ x: c.path.xs[0], y: c.path.ys[0], scale: 0.2, opacity: 0 }}
                animate={{
                  x: c.path.xs,
                  y: c.path.ys,
                  scale: [0.2, 1, 1, 0.75],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  x: { duration: REVEAL.COIN_MS / 1000, times: c.path.times, ease: "linear", delay: c.delay / 1000 },
                  y: { duration: REVEAL.COIN_MS / 1000, times: c.path.times, ease: "linear", delay: c.delay / 1000 },
                  scale: { duration: REVEAL.COIN_MS / 1000, times: [0, 0.15, 0.82, 1], delay: c.delay / 1000 },
                  opacity: { duration: REVEAL.COIN_MS / 1000, times: [0, 0.12, 0.8, 1], delay: c.delay / 1000 },
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {banner && (
          <m.div
            key={current.uid}
            className={`${s.banner} ${s[tone]}`}
            style={style}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { duration: REVEAL.BANNER_IN_MS / 1000, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              y: 10,
              transition: { duration: REVEAL.BANNER_OUT_MS / 1000, ease: [0.22, 1, 0.36, 1] },
            }}
            aria-hidden="true"
          >
            <span className={s.from}>
              <Side
                fig={current.lead.from}
                players={players}
                others={crowd}
                everyone={current.group?.kind === "each-in"}
              />
            </span>
            <span className={s.mid}>
              <span className={s.amount}>{fmt(current.shown ?? current.total)}</span>
              <span className={s.text}>{text}</span>
            </span>
            <span className={s.to}>
              <Side
                fig={current.lead.to}
                players={players}
                others={crowd}
                everyone={current.group?.kind === "each-out"}
              />
            </span>
          </m.div>
        )}
      </AnimatePresence>

      <span className={s.sr} role="status" aria-live="polite">
        {current ? text : ""}
      </span>
    </div>
  );
}
