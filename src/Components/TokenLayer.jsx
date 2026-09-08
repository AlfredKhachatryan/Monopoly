import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "./Motion";
import { FIGS, STEP_MS, WALK } from "../Hooks/useWalkingTokens";

// One persistent DOM element per player token, drawn in an overlay above the
// board grid. Tokens never unmount while moving: a move animates the same
// element from its previous cell to the new one along an arc, with a bit of
// squash-and-stretch and a lean into the direction of travel. The arc gets
// longer and higher the further the token has to fly. Only transform is
// animated.

const TOKEN_W = 20;
const TOKEN_H = 30;
const GAP = 2; // between tokens sharing a cell
const PAD_X = 8; // offset from the cell's left edge
const PAD_Y = 18; // offset from the cell's top edge (below the header strip)
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

// Position of every cell relative to the grid container, plus the grid's
// centre point (the arc always bends towards it so it stays over the board).
function measureCells(grid) {
  const cells = {};
  const base = grid.getBoundingClientRect();
  for (let i = 1; i <= 40; i++) {
    const el = grid.getElementsByClassName(`itemCard${i}`)[0];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    cells[i] = { x: r.left - base.left, y: r.top - base.top };
  }
  return { cells, cx: base.width / 2, cy: base.height / 2 };
}

// Peak of the arc for a move from A to B: the midpoint pushed `height` px
// along the perpendicular of AB, on whichever side faces the board centre.
// Capped so the peak never overshoots the centre.
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
    const s = 1 - t;
    xs.push(s * s * ax + 2 * s * t * ctrlX + t * t * bx);
    ys.push(s * s * ay + 2 * s * t * ctrlY + t * t * by);
    times.push(u);
  }
  return { xs, ys, times };
}

const Token = memo(function Token({ fig, x, y, cx, cy }) {
  // Where this token was drawn last time, so the arc can start from there.
  const prev = useRef(null);
  const from = prev.current;
  useEffect(() => {
    prev.current = { x, y };
  }, [x, y]);

  const moved = from && (from.x !== x || from.y !== y);
  let target;
  if (moved && Math.hypot(x - from.x, y - from.y) < TOKEN_W * 2) {
    // shuffling sideways inside the same cell: just slide, no hop
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
    // lean towards where it is going: right/left for horizontal steps,
    // a smaller forward tip for vertical ones
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
      className={`fig ${fig}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: TOKEN_W,
        height: TOKEN_H,
        transformOrigin: "50% 100%",
      }}
      initial={{ x, y, rotate: 0, scaleX: 0, scaleY: 0 }}
      animate={target}
      exit={{
        scaleX: 0,
        scaleY: 0,
        transition: { duration: 0.15, ease: "easeIn" },
      }}
    >
      <div className="selectedFig" style={{ backgroundColor: "#f5f5f580" }} />
    </m.div>
  );
});

// Must be rendered as a direct child of the grid container (`.parent`).
// `shown` is the displayed cell per figure from useWalkingTokens.
export function TokenLayer({ shown }) {
  const layerRef = useRef(null);
  const [layout, setLayout] = useState({ cells: {}, cx: 0, cy: 0 });
  const { cells: rects, cx, cy } = layout;

  // Measure from our own element: its parent is the grid. (A ref passed down
  // from the Board would still be null here on the very first mount.)
  useLayoutEffect(() => {
    const grid = layerRef.current?.parentElement;
    if (!grid) return;
    const update = () => setLayout(measureCells(grid));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);

  // Tokens sharing a cell line up side by side, in figure order.
  const byCell = {};
  for (const f of FIGS) {
    if (shown[f] === undefined) continue;
    (byCell[shown[f]] ||= []).push(f);
  }
  const tokens = [];
  for (const f of FIGS) {
    const cell = shown[f];
    const r = rects[cell];
    if (r === undefined) continue;
    const i = byCell[cell].indexOf(f);
    tokens.push({
      fig: f,
      x: r.x + PAD_X + i * (TOKEN_W + GAP),
      y: r.y + PAD_Y,
    });
  }

  return (
    <div
      ref={layerRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 4,
      }}
    >
      <AnimatePresence initial={false}>
        {tokens.map((t) => (
          <Token key={t.fig} fig={t.fig} x={t.x} y={t.y} cx={cx} cy={cy} />
        ))}
      </AnimatePresence>
    </div>
  );
}
