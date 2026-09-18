// The player tokens, drawn in one overlay above the board grid.
//
// This is the old Components/TokenLayer.jsx re-skinned, and the motion is
// deliberately unchanged: one persistent DOM element per player, never
// unmounted while it moves, flying from its old tile to the new one along a
// single arc that bends towards the middle of the board, with squash-and-
// stretch and a lean into the direction of travel. Longer moves get a longer,
// higher arc. Only transform is animated. Joining grows in, leaving shrinks
// out. `reducedMotion="user"` on the shared MotionConfig switches all of it off
// for anyone who asked for that.
//
// What changed is the skin and where a piece comes to rest. Per the figure
// manual (design-reference/figures-manual.html) a board space carries the
// player's ROUND TOKEN, not the full-body figure — full figures are for hero
// moments, the discs are what reads at 105px across a room. So the piece is
// `Tok`: 24px as the manual says, 28px when only one or two stand on a roomy
// tile (the rows and the corners), with a 2px --surface ring around it so two
// touching discs stay separate. They sit side by side with a 2px gap in the
// tile's `.tt-here` slot, bottom-left everywhere except the top row, where the
// prototype's top-left slot is back: the band is at the bottom there, and a
// small disc tucked under the mark leaves the name and price completely clear.
//
// COORDINATES. The whole TV is one element with `transform: scale(s)` on it, so
// getBoundingClientRect() here returns SCALED pixels, while the tokens are
// positioned in the unscaled 1920x1080 space. Rather than measure and divide,
// the slots are read off the offsetLeft/offsetTop chain: those are pure layout
// values that a CSS transform does not touch, so the numbers are the same at
// every window size, and nothing here has to know what the current scale is.
//
// It also means no dimension of the board is written down here. The board is
// NOT square (reference §0: ~1282 x 1024, 150px corners), and the arc's centre
// of gravity is read from the wrapper's own offset size.

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "../Components/Motion";
import Tok from "../Client/Tok";
import { FIGS, STEP_MS, WALK } from "../Hooks/useWalkingTokens";
import { playerByFig } from "../Hooks/rules";
import s from "./tv.module.css";

const TOK = 24; // the manual's board-space size
const TOK_BIG = 28; // 1-2 players on a roomy tile (the rows and the corners)
const GAP = 2; // between two discs standing side by side
const STACK = 16; // three or four overlap like an avatar stack instead
const EDGE = 6; // the anchor's inset from the tile's edges (.here)
const LEAN_DEG = 12;
const MIN_HOP_HEIGHT = 22;
const MAX_HOP_HEIGHT = 140;
const MIN_HOP_S = 0.35;
const MAX_HOP_S = 1.1;
const STEP_HOP_S = (STEP_MS / 1000) * 0.85; // cap when walking cell by cell

// Flight time and arc height for a move of `dist` pixels.
function hopFor(dist) {
  let duration = Math.min(MAX_HOP_S, MIN_HOP_S + dist / 900);
  if (WALK) duration = Math.min(duration, STEP_HOP_S);
  const height = Math.min(MAX_HOP_HEIGHT, Math.max(MIN_HOP_HEIGHT, dist * 0.3));
  return { duration, height };
}

// Peak of the arc for a move from A to B: the midpoint pushed `height` px along
// the perpendicular of AB, on whichever side faces the board centre. Capped so
// the peak never overshoots the centre.
function arcPeak(ax, ay, bx, by, cx, cy, height) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const toCx = cx - mx;
  const toCy = cy - my;
  if (nx * toCx + ny * toCy < 0) {
    nx = -nx;
    ny = -ny;
  }
  const h = Math.min(height, Math.hypot(toCx, toCy) * 0.8);
  return { x: mx + nx * h, y: my + ny * h };
}

// Samples a quadratic curve from A through `peak` to B as evenly spaced
// keyframes, with one gentle ease-in-out over the whole flight. Played with
// linear interpolation between samples this gives a single continuous arc:
// speed never drops to zero mid-air, unlike two eased halves meeting at the
// peak.
const ARC_SAMPLES = 32;
function arcKeyframes(ax, ay, bx, by, peak) {
  const ctrlX = 2 * peak.x - (ax + bx) / 2;
  const ctrlY = 2 * peak.y - (ay + by) / 2;
  const xs = [];
  const ys = [];
  const times = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const u = i / ARC_SAMPLES;
    const t = 0.5 - Math.cos(Math.PI * u) / 2; // ease-in-out sine
    const p = 1 - t;
    xs.push(p * p * ax + 2 * p * t * ctrlX + t * t * bx);
    ys.push(p * p * ay + 2 * p * t * ctrlY + t * t * by);
    times.push(u);
  }
  return { xs, ys, times };
}

// Distance from `el`'s border box to `root`'s, walking the offsetParent chain.
// Layout pixels: unaffected by the transform scale on an ancestor.
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

// Every `.here` anchor, in unscaled board coordinates: `x` is where the left
// edge of the first disc goes, `y`/`h` are the anchor box the discs align
// inside (bottom-aligned, or top-aligned on the top row), `limit` how far right
// the row may run before it closes up, and `roomy` whether this tile can carry
// the larger disc.
function measureSlots(wrap) {
  const slots = {};
  for (const el of wrap.querySelectorAll("[data-here]")) {
    const tile = el.parentElement;
    const { x, y } = offsetIn(el, wrap);
    const side = tile?.dataset.side;
    const flank = side === "l" || side === "r";
    const tileW = tile ? tile.offsetWidth : 80;
    // On the side columns the name and price sit BESIDE the mark, so a row of
    // discs that ran the full width of the tile would go straight through them.
    // There it stops at the text column; everywhere else the text is above or
    // below the discs and the whole tile is fair game.
    const txt = flank ? tile?.querySelector("[data-txt]") : null;
    slots[Number(el.dataset.here)] = {
      x,
      y,
      h: el.offsetHeight,
      top: side === "t", // the top row's slot hangs from the top edge
      limit: txt ? txt.offsetLeft : tileW - EDGE,
      roomy: !flank,
    };
  }
  return {
    slots,
    cx: wrap.offsetWidth / 2,
    cy: wrap.offsetHeight / 2,
  };
}

const Token = memo(function Token({ fig, name, x, y, w, h, z, cx, cy }) {
  // Where this token was drawn last time, so the arc can start from there.
  const prev = useRef(null);
  const from = prev.current;
  useEffect(() => {
    prev.current = { x, y };
  }, [x, y]);

  const moved = from && (from.x !== x || from.y !== y);
  let target;
  if (moved && Math.hypot(x - from.x, y - from.y) < w * 2) {
    // shuffling sideways inside the same tile: just slide, no hop
    target = {
      x,
      y,
      rotate: 0,
      scaleX: 1,
      scaleY: 1,
      transition: { duration: 0.2, ease: "easeOut" },
    };
  } else if (moved) {
    const dx = x - from.x;
    const dy = y - from.y;
    const { duration: HOP_S, height: HOP_HEIGHT } = hopFor(Math.hypot(dx, dy));
    const peak = arcPeak(from.x, from.y, x, y, cx, cy, HOP_HEIGHT);
    const { xs, ys, times } = arcKeyframes(from.x, from.y, x, y, peak);
    const arc = { duration: HOP_S, times, ease: "linear" };
    // lean towards where it is going: right/left for horizontal steps, a
    // smaller forward tip for vertical ones
    const lean =
      Math.abs(dx) >= Math.abs(dy)
        ? Math.sign(dx) * LEAN_DEG
        : Math.sign(dy) * LEAN_DEG * 0.5;
    target = {
      x: xs,
      y: ys,
      rotate: [0, lean, lean * 0.6, -lean * 0.35, 0],
      scaleX: [1, 0.85, 1, 1.25, 1],
      scaleY: [1, 1.2, 1, 0.7, 1],
      transition: {
        x: arc,
        y: arc,
        rotate: { duration: HOP_S, times: [0, 0.25, 0.6, 0.85, 1] },
        scaleX: { duration: HOP_S, times: [0, 0.2, 0.55, 0.85, 1] },
        scaleY: { duration: HOP_S, times: [0, 0.2, 0.55, 0.85, 1] },
      },
    };
  } else {
    target = { x, y, rotate: 0, scaleX: 1, scaleY: 1 };
  }

  return (
    <m.div
      className={s.token}
      data-fig={fig}
      style={{ width: w, height: h, zIndex: z }}
      initial={{ x, y, rotate: 0, scaleX: 0, scaleY: 0 }}
      animate={target}
      exit={{ scaleX: 0, scaleY: 0, transition: { duration: 0.15, ease: "easeIn" } }}
    >
      <Tok player={{ figure: fig, name }} size={h} className={s.tokRing} />
    </m.div>
  );
});

// Must be rendered as a child of .boardWrap, beside the grid. `shown` is the
// displayed cell per figure from useWalkingTokens.
export default function TvTokens({ shown, players }) {
  const layerRef = useRef(null);
  const [{ slots, cx, cy }, setGeom] = useState({ slots: {}, cx: 0, cy: 0 });

  // Measured from our own element's parent, which is the wrapper the grid also
  // sits in — a ref handed down from the screen would still be null on the
  // first mount.
  useLayoutEffect(() => {
    const wrap = layerRef.current?.parentElement;
    if (!wrap) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      setGeom(measureSlots(wrap));
    };
    update();
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    window.addEventListener("resize", onResize);
    // The grid itself never changes size, but a font swap or a missing cell
    // arriving late can move a slot inside a tile.
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  // Tokens sharing a tile line up side by side, in figure order.
  const byCell = {};
  for (const f of FIGS) {
    if (shown?.[f] === undefined) continue;
    (byCell[shown[f]] ||= []).push(f);
  }

  const tokens = [];
  for (const f of FIGS) {
    const cell = shown?.[f];
    const slot = slots[cell];
    if (!slot) continue;
    const list = byCell[cell];
    const i = list.indexOf(f);
    const crowd = list.length;
    // One or two stand side by side at the larger size where there is room for
    // it; three or four close into an overlapping avatar stack at the manual's
    // 24px, later arrivals on top. Either way `room` keeps the whole group
    // inside the piece lane, well clear of the middle of the tile.
    const size = crowd <= 2 && slot.roomy ? TOK_BIG : TOK;
    const room = Math.max(0, slot.limit - EDGE - size);
    const step = crowd <= 2 ? size + GAP : STACK;
    const pitch = crowd > 1 ? Math.min(step, room / (crowd - 1)) : step;
    tokens.push({
      fig: f,
      // A string, not the player object: Token is memoised, and a piece whose
      // player has left the room would otherwise get a fresh fallback object
      // on every render.
      name: playerByFig(players, f)?.name || "",
      x: slot.x + i * pitch,
      // Discs share one edge of the anchor box whatever their size, so a tile
      // going from two players to three does not make them jump.
      y: slot.top ? slot.y : slot.y + slot.h - size,
      w: size,
      h: size,
      z: i + 1,
    });
  }

  return (
    <div ref={layerRef} className={s.tokens} aria-hidden="true">
      <AnimatePresence initial={false}>
        {tokens.map((t) => (
          <Token
            key={t.fig}
            fig={t.fig}
            name={t.name}
            x={t.x}
            y={t.y}
            w={t.w}
            h={t.h}
            z={t.z}
            cx={cx}
            cy={cy}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
