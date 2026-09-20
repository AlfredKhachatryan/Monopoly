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
// moments, the discs are what reads at 112px across a room. So the piece is
// `Tok`: 24px as the manual says, 28px when only one or two stand on a roomy
// tile (the rows and the corners), with a 2px --surface ring around it so two
// touching discs stay separate. They sit side by side with a 2px gap in the
// tile's `.tt-here` slot, bottom-left everywhere except the top row, where the
// prototype's top-left slot is back: the band is at the bottom there, and a
// small disc tucked under the mark leaves the name and price completely clear.
//
// SIX PIECES ON ONE TILE (2026-09-20). A room holds up to six players and every
// game opens with all of them standing on Start, so the crowded tile is the
// first thing the room ever sees, not an edge case. `layoutFor` below is the
// one place that decides the shape of a group, and it is written so that one,
// two, three and four pieces come out EXACTLY where they came out before —
// four-player games must look untouched. From five up it is allowed to change
// its mind:
//
//   · it steps the disc down 24 → 22 → 20 (Tok's art floor: under 20 the token
//     falls back to a letter) rather than let the overlap eat more than a third
//     of every disc. A corner is 158px wide, so Start at six players keeps the
//     manual's 24px and the same 1/3 overlap four players have today; a 112px
//     row tile drops to 20px;
//   · a tile too narrow for any of that — the left and right columns, where the
//     pieces must stop at the name — lays the group out in LINES instead,
//     growing inwards from the board's edge (upwards on the bottom row and the
//     columns, downwards on the top row), two per line rather than a six-disc
//     smear four pixels wide.
//
// The piece whose turn it is is drawn last and wears a ring, so "everyone is on
// Start, and it is Koli's go" is one glance rather than two.
//
// COORDINATES. The whole TV is one element with `transform: scale(s)` on it, so
// getBoundingClientRect() here returns SCALED pixels, while the tokens are
// positioned in the unscaled 1920x1080 space. Rather than measure and divide,
// the slots are read off the offsetLeft/offsetTop chain: those are pure layout
// values that a CSS transform does not touch, so the numbers are the same at
// every window size, and nothing here has to know what the current scale is.
//
// It also means no dimension of the board is written down here. The board is
// NOT square (~1364 x 1048, 158 x 144 corners), and the arc's centre
// of gravity is read from the wrapper's own offset size.

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "../Components/Motion";
import Tok from "../Client/Tok";
import { FIGS, STEP_MS, WALK } from "../Hooks/useWalkingTokens";
import { playerByFig } from "../Hooks/rules";
import s from "./tv.module.css";

const TOK = 24; // the manual's board-space size
const TOK_BIG = 28; // 1-2 players on a roomy tile (the rows and the corners)
const TOK_MIN = 20; // Tok draws the art down to 20px and a bare letter below it
const SIZES = [TOK, 22, TOK_MIN]; // the steps a crowded tile may take
const GAP = 2; // between two discs standing side by side
// The anchor's inset from the tile's edges (.here in tv.module.css — the two
// numbers must stay equal). NINE, not the six it was: a tile has a 10px corner
// radius, and a disc whose ring reached within 2px of both edges sat in the
// notch the radius cuts away, so on a corner tile it read as hanging off the
// board. The owner caught exactly that on a real TV. At 9 the disc's outermost
// ring is 5px from each edge, which is inside a 10px radius with room to spare.
const EDGE = 9;
const CROWD = 5; // from here up the group may change shape
const LEAN_DEG = 12;
const MIN_HOP_HEIGHT = 22;
const MAX_HOP_HEIGHT = 140;
const MIN_HOP_S = 0.35;
const MAX_HOP_S = 1.1;
const STEP_HOP_S = (STEP_MS / 1000) * 0.85; // cap when walking cell by cell

// The pitch an overlapping avatar stack uses: two thirds of every disc still
// showing. At 24px that is the 16px this board has always used.
const stackPitch = (size) => Math.round((size * 2) / 3);

// Keeps a rest position inside its tile whatever the arithmetic above wanted.
const clamp = (v, lo, hi) => (hi < lo ? lo : v < lo ? lo : v > hi ? hi : v);

// `want`, but never wider than the lane: the last disc's left edge may sit at
// most `usable - size` from the first one's.
function squeeze(want, usable, size, crowd) {
  if (crowd <= 1) return want;
  return Math.min(want, Math.max(0, usable - size) / (crowd - 1));
}

// How `crowd` pieces share one tile's piece lane.
//
//   size      the disc's diameter
//   pitch     the step between two discs in a line
//   cols      how many go in a line
//   lineStep  the step between two lines, 0 when there is only one
//
// One to four is frozen: those three branches reproduce the old
// `crowd <= 2 ? TOK_BIG : TOK` / `STACK` arithmetic value for value, so a
// four-player board is pixel-identical to the one before six players existed.
function layoutFor(crowd, slot) {
  const usable = Math.max(slot.limit - EDGE, TOK_MIN); // lane width from the anchor

  if (crowd <= 2) {
    const size = slot.roomy ? TOK_BIG : TOK;
    return { size, pitch: squeeze(size + GAP, usable, size, crowd), cols: crowd, lineStep: 0 };
  }
  if (crowd < CROWD) {
    const pitch = squeeze(stackPitch(TOK), usable, TOK, crowd);
    return { size: TOK, pitch, cols: crowd, lineStep: 0 };
  }

  // Five or six. Keep one line for as long as every disc still shows two
  // thirds of itself; give up the diameter before giving up the overlap.
  for (const size of SIZES) {
    const pitch = stackPitch(size);
    if (size + (crowd - 1) * pitch <= usable) {
      return { size, pitch, cols: crowd, lineStep: 0 };
    }
  }

  // Still too narrow (the left and right columns): lines instead of a smear.
  const size = TOK_MIN;
  const step = size + GAP;
  const fitCols = Math.max(1, Math.floor((usable - size) / step) + 1);
  const room = Math.max(size, slot.tall - 2 * EDGE); // how tall the block may be
  const maxLines = Math.max(1, Math.floor((room - size) / step) + 1);
  const lines = Math.min(maxLines, Math.ceil(crowd / fitCols));
  const cols = Math.ceil(crowd / lines); // balanced lines: 3 + 3, never 5 + 1
  return {
    size,
    // `cols` may have been pushed past what the width wants in order to keep
    // the block inside the tile; then, and only then, a line overlaps again.
    pitch: squeeze(step, usable, size, cols),
    cols,
    lineStep: step,
  };
}

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
// the row may run before it closes up, `tall` how much height the tile could
// lend a second line of pieces, and `roomy` whether this tile can carry the
// larger disc.
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
    // Where the TILE itself is, so no arithmetic below can put a disc outside
    // it. The owner caught exactly that on a real TV: a piece on the bottom row
    // drawn under its tile, hanging over the edge of the canvas. Whatever the
    // cause, a rest position that leaves the tile is wrong by definition, so it
    // is clamped at the source rather than trusted.
    const box = tile ? offsetIn(tile, wrap) : { x: 0, y: 0 };
    slots[Number(el.dataset.here)] = {
      x,
      y,
      h: el.offsetHeight,
      top: side === "t", // the top row's slot hangs from the top edge
      limit: txt ? txt.offsetLeft : tileW - EDGE,
      tall: tile ? tile.offsetHeight : 0,
      roomy: !flank,
      bx: box.x,
      by: box.y,
      bw: tileW,
      bh: tile ? tile.offsetHeight : 0,
    };
  }
  return {
    slots,
    cx: wrap.offsetWidth / 2,
    cy: wrap.offsetHeight / 2,
  };
}

const Token = memo(function Token({ fig, name, now, jailed, snap, x, y, w, h, z, cx, cy }) {
  // Where this token was drawn last time, so the arc can start from there.
  const prev = useRef(null);
  const from = prev.current;
  useEffect(() => {
    prev.current = { x, y };
  }, [x, y]);

  const moved = from && (from.x !== x || from.y !== y);
  let target;
  if (snap) {
    // The board was just repaired after a reconnect. Nobody in the room saw
    // these pieces move, so they are simply THERE — an arc here would be the
    // screen performing a journey that happened while it was not watching.
    target = { x, y, rotate: 0, scaleX: 1, scaleY: 1, transition: { duration: 0 } };
  } else if (moved && Math.hypot(x - from.x, y - from.y) < w * 2) {
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
      data-now={now ? "" : undefined}
      data-jailed={jailed ? "" : undefined}
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
// displayed cell per figure from useWalkingTokens; `currentFig` is whose turn
// it is, so that piece can be drawn on top of whatever it shares a tile with.
export default function TvTokens({
  shown,
  players,
  currentFig = null,
  jailedFigs = null,
  // Bumped by the shell when the board was repaired after a drop. Compared
  // during render rather than in an effect, so the very commit that carries the
  // caught-up positions is the one that skips the flight.
  snapKey = 0,
}) {
  const layerRef = useRef(null);
  const seenSnap = useRef(snapKey);
  const snap = seenSnap.current !== snapKey;
  useEffect(() => {
    seenSnap.current = snapKey;
  }, [snapKey]);
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
    // 24px; five or six step the disc down, and only a tile too narrow for even
    // that breaks the group into lines. See layoutFor.
    const { size, pitch, cols, lineStep } = layoutFor(crowd, slot);
    const col = i % cols;
    const line = Math.floor(i / cols);
    tokens.push({
      fig: f,
      // A string, not the player object: Token is memoised, and a piece whose
      // player has left the room would otherwise get a fresh fallback object
      // on every render.
      name: playerByFig(players, f)?.name || "",
      now: f === currentFig,
      // Jailed pieces standing on the Jail corner wear a --neg ring, so the
      // difference between doing time and passing through is visible on the
      // board and not only on the player card.
      jailed: !!jailedFigs?.has?.(f),
      x: clamp(slot.x + col * pitch, slot.bx, slot.bx + slot.bw - size),
      // Discs share one edge of the anchor box whatever their size, so a tile
      // going from two players to three does not make them jump. Extra lines
      // grow away from that edge, i.e. into the tile.
      y: clamp(
        slot.top ? slot.y + line * lineStep : slot.y + slot.h - size - line * lineStep,
        slot.by,
        slot.by + slot.bh - size,
      ),
      w: size,
      h: size,
      // Later in the line covers earlier, and the player whose turn it is
      // covers everyone: on a tile holding the whole room, which piece is
      // about to move has to be the one you can actually see.
      z: f === currentFig ? crowd + 1 : i + 1,
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
            now={t.now}
            jailed={t.jailed}
            snap={snap}
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
