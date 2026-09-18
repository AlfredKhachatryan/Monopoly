// The dice, for the phone AND the TV.
//
// Why a real cube. The old FlatDice was a flat square with a CSS `tumble`
// keyframe while a setInterval re-randomised the pips every 80ms. Three things
// made that feel rough: the faces TELEPORTED (a 3 became a 6 with no motion in
// between), the rotation RESTARTED from 0 on every roll, and the whole thing
// stopped dead. A real cube fixes all three at the source: the six faces are
// painted once and never change, so every face change is physically motivated
// by the rotation that caused it; the cube keeps whatever orientation it was
// left in, so nothing ever snaps back to zero; and the landing resolves EXACTLY
// onto the rolled face because "show a 5" is just "rotate so the 5 is at the
// front".
//
// How it is driven. One WAAPI animation per die per phase, with the trajectory
// SAMPLED in JS into `transform` keyframes played back linearly — the same
// technique TvTokens uses for its arcs, and for the same reason: an eased
// browser curve cannot express "decelerate, overshoot 6 degrees, settle" as one
// continuous motion, and two chained CSS animations always show their seam.
// Nothing but `transform` and `opacity` is ever animated, so every frame is a
// compositor frame.
//
// The two phases:
//
//   AIR      open ended, constant angular velocity, `iterations: Infinity`.
//            Only ever used for MY OWN roll on MY OWN phone, which starts the
//            instant the button is tapped — before the server has answered.
//   LANDING  from wherever the cube is RIGHT NOW to the exact rolled face.
//            When it follows the air phase the amount of rotation is chosen so
//            that the landing's initial angular velocity matches the air
//            phase's, which is what makes the two read as one throw instead of
//            a spin and then a separate fall.
//
// The two dice are deliberately out of step: different spin axes, different
// turn counts, and the second one comes to rest LAND_STAGGER ms after the
// first. `restAt` is when BOTH are down.
//
// Reduced motion: no cube, no tumble. The dice hold the previous faces at a
// dimmed opacity for the length of the beat and then cross-fade to the result,
// so the ORDER of information is identical — which is what the reveal buffer
// (useReveal.js) depends on.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import s from "./rollDice.module.css";

// Which of the nine pip cells are lit for each face. Same map as the old
// FlatDice, so a die reads identically to the one players already know.
const FACES = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

// The cube: opposite faces sum to 7, exactly like a real die.
const SIDES = [
  { v: 1, t: "" },
  { v: 6, t: "rotateY(180deg)" },
  { v: 3, t: "rotateY(90deg)" },
  { v: 4, t: "rotateY(-90deg)" },
  { v: 5, t: "rotateX(90deg)" },
  { v: 2, t: "rotateX(-90deg)" },
];

// Cube orientation that brings face `v` to the front. Each one uses a single
// axis, so the order the three rotations are written in never matters at rest —
// and every target below is this value plus whole turns, which is why the
// landing lands on the rolled face and not near it.
const REST = {
  1: [0, 0],
  2: [90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [-90, 0],
  6: [0, 180],
};

const face = (v) => (FACES[Math.round(Number(v))] ? Math.round(Number(v)) : 1);

// ---- the landing trajectory ------------------------------------------------
//
//   u in [0, DECEL]   decelerate from full speed to a stop, 6 degrees PAST the
//                     target (one exponent, one curve, no restarts)
//   u in [DECEL, 1]   settle those 6 degrees back, velocity zero at both ends
//
// The junction has zero velocity on both sides, so there is no kink: it reads
// as a die hitting the table and rocking once.
const DECEL = 0.8;
const POW = 2.4;
const SLOPE = POW / DECEL; // d(theta)/du at u = 0, in units of the total turn
const OVER = 6; // degrees of overshoot — the spec's ceiling, not a target
const SAMPLES = 60;

const smooth = (w) => w * w * (3 - 2 * w);

// Air-phase spin, per die: whole turns per period, and the period. Different
// axes and a 10% difference in period, so the pair never looks like one object.
const AIR = [
  { tx: 1, ty: 2, tz: 0, ms: 760 },
  { tx: 2, ty: 1, tz: 1, ms: 840 },
];

// A roll that starts from rest (everybody who is not the player who tapped)
// has no velocity to match, so its turn counts are named outright.
const THROW = [
  { tx: 1.75, ty: 2.5, tz: 0.75 },
  { tx: 2.5, ty: 1.75, tz: -1 },
];

export const LAND_STAGGER = 120; // the second die comes down this much later
export const CANCEL_MS = 250; // a rejected roll puts the dice back this fast
// The dice declare themselves at rest a couple of frames before `restAt`, which
// is also when the reveal buffer lets the new state through. Both are timers
// against the same clock, and without the lead they race: one run in twenty
// released the board a frame before the dice said they had stopped. By then the
// cube is inside the last degree of its settle, so nothing is visibly early —
// it just makes the ORDER unambiguous, which is the whole point.
const SETTLED_LEAD = 40;

const mod360 = (a) => ((a % 360) + 360) % 360;

// The value congruent to `base` (mod 360) that sits closest to `want`. This is
// what makes the landing exact: whatever the cube's current angle, the target
// is always REST + a whole number of turns.
function congruent(base, want) {
  return base + 360 * Math.round((want - base) / 360);
}

function prefersReduce() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function useReduce(override) {
  const [reduce, setReduce] = useState(prefersReduce);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return override === undefined ? reduce : !!override;
}

function Pips({ value }) {
  const on = FACES[face(value)];
  return (
    <>
      {CELLS.map((i) => (
        <i key={i} className={on.includes(i) ? s.pipOn : undefined} />
      ))}
    </>
  );
}

// One die. A hook, not a component: everything below the React boundary is
// imperative on purpose, because React never writes `transform` on the cube —
// so a re-render in the middle of a throw (a banner appearing, a cash count-up
// ticking) cannot interrupt it. Called twice, unconditionally, in a fixed
// order, which is all the rules of hooks ask for.
function useDie(index, hop) {
  const cubeRef = useRef(null);
  const shadeRef = useRef(null);
  // Where the cube is, in absolute degrees. Never reset: a new roll continues
  // from wherever the last one left it.
  const at = useRef({ x: 0, y: 0, z: 0, lift: 0 });
  const air = useRef(null);
  const anims = useRef([]);

  const stop = () => {
    for (const a of anims.current) {
      try {
        a.cancel();
      } catch {
        /* an animation whose element is gone */
      }
    }
    anims.current = [];
    air.current = null;
  };

  const paint = (x, y, z, lift) => {
    at.current = { x, y, z, lift };
    const cube = cubeRef.current;
    if (cube) {
      cube.style.transform = `translate3d(0, ${lift}px, 0) rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`;
    }
    const shade = shadeRef.current;
    if (shade) {
      const k = 1 - Math.min(1, Math.abs(lift) / Math.max(1, hop));
      shade.style.transform = `scale(${0.6 + 0.4 * k})`;
      shade.style.opacity = String(0.1 + 0.2 * k);
    }
  };

  // Where the cube is at this instant, derived from the air loop's clock rather
  // than read back out of a matrix: the loop is linear, so the angle is just
  // start + rate x elapsed, and there is no rounding to drift on.
  const now = () => {
    const a = air.current;
    if (!a) return at.current;
    const t = Number(a.anim.currentTime) || 0;
    return {
      x: a.from.x + a.rate.x * t,
      y: a.from.y + a.rate.y * t,
      z: a.from.z + a.rate.z * t,
      lift: a.from.lift,
    };
  };

  const startAir = () => {
    const cube = cubeRef.current;
    if (!cube) return;
    stop();
    const spin = AIR[index];
    const from = { ...at.current, lift: -hop * 0.7 };
    const rate = {
      x: (360 * spin.tx) / spin.ms,
      y: (360 * spin.ty) / spin.ms,
      z: (360 * spin.tz) / spin.ms,
    };
    const to = {
      x: from.x + 360 * spin.tx,
      y: from.y + 360 * spin.ty,
      z: from.z + 360 * spin.tz,
    };
    // Start and end are the same orientation (whole turns), so `Infinity`
    // loops without a seam.
    const anim = cube.animate(
      [
        {
          transform: `translate3d(0, ${from.lift}px, 0) rotateX(${from.x}deg) rotateY(${from.y}deg) rotateZ(${from.z}deg)`,
        },
        {
          transform: `translate3d(0, ${from.lift}px, 0) rotateX(${to.x}deg) rotateY(${to.y}deg) rotateZ(${to.z}deg)`,
        },
      ],
      { duration: spin.ms, iterations: Infinity, easing: "linear" },
    );
    anims.current.push(anim);
    air.current = { anim, from, rate };
    at.current = from;

    const shade = shadeRef.current;
    if (shade) {
      const sa = shade.animate(
        [
          { transform: "scale(1)", opacity: 0.3 },
          { transform: "scale(0.62)", opacity: 0.12 },
        ],
        { duration: 180, easing: "ease-out", fill: "forwards" },
      );
      anims.current.push(sa);
    }
  };

  // `ms` is how long the landing may take, `value` the face it must end on.
  const land = (value, ms) => {
    const cube = cubeRef.current;
    if (!cube) return;
    const from = now();
    const fromAir = !!air.current;
    const rate = air.current?.rate ?? null;
    const dur = Math.max(160, ms);
    const [restX, restY] = REST[face(value)];

    // How far to turn. Out of the air: exactly enough that the landing STARTS
    // at the speed the cube is already going (theta'(0) = SLOPE x R / dur), so
    // the two phases are one motion. From rest: the named turn counts.
    const want = fromAir
      ? {
          x: from.x + (rate.x * dur) / SLOPE,
          y: from.y + (rate.y * dur) / SLOPE,
          z: from.z + (rate.z * dur) / SLOPE,
        }
      : {
          x: from.x + 360 * THROW[index].tx,
          y: from.y + 360 * THROW[index].ty,
          z: from.z + 360 * THROW[index].tz,
        };

    const to = {
      x: congruent(restX, want.x),
      y: congruent(restY, want.y),
      z: congruent(0, want.z),
    };

    const span = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const big = Math.max(Math.abs(span.x), Math.abs(span.y), Math.abs(span.z)) || 1;
    const over = {
      x: (OVER * span.x) / big,
      y: (OVER * span.y) / big,
      z: (OVER * span.z) / big,
    };

    const frames = [];
    const shadeFrames = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      let f;
      if (u <= DECEL) {
        const v = u / DECEL;
        f = 1 - (1 - v) ** POW; // 0 -> 1, fastest at the start
      } else {
        f = 1; // the settle below carries the last few degrees
      }
      const back = u <= DECEL ? 1 : 1 - smooth((u - DECEL) / (1 - DECEL));
      const x = from.x + span.x * f + over.x * back * (u <= DECEL ? f : 1);
      const y = from.y + span.y * f + over.y * back * (u <= DECEL ? f : 1);
      const z = from.z + span.z * f + over.z * back * (u <= DECEL ? f : 1);

      // The arc. Thrown from rest it goes up and comes down; resolved out of
      // the air it is already up and only comes down. Either way it is on the
      // table at u = DECEL, and rocks once on the settle.
      let lift;
      if (u <= DECEL) {
        const v = u / DECEL;
        lift = fromAir ? from.lift * (1 - f) : -hop * Math.sin(Math.PI * v);
      } else {
        lift = -hop * 0.09 * Math.sin(Math.PI * ((u - DECEL) / (1 - DECEL)));
      }

      frames.push({
        offset: u,
        transform: `translate3d(0, ${lift.toFixed(2)}px, 0) rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg) rotateZ(${z.toFixed(2)}deg)`,
      });
      const k = 1 - Math.min(1, Math.abs(lift) / Math.max(1, hop));
      shadeFrames.push({
        offset: u,
        transform: `scale(${(0.6 + 0.4 * k).toFixed(3)})`,
        opacity: (0.1 + 0.2 * k).toFixed(3),
      });
    }

    stop();
    const anim = cube.animate(frames, { duration: dur, easing: "linear", fill: "forwards" });
    anims.current.push(anim);
    const shade = shadeRef.current;
    if (shade) {
      const sa = shade.animate(shadeFrames, { duration: dur, easing: "linear", fill: "forwards" });
      anims.current.push(sa);
    }
    anim.onfinish = () => {
      // Commit the resting orientation to the element and drop the animation,
      // so the next roll starts from a real, readable transform.
      stop();
      paint(to.x, to.y, to.z, 0);
    };
  };

  // Back to the face that was showing before the roll, for an action the server
  // refused. No fake result, and nothing in between.
  const cancel = (value) => {
    const cube = cubeRef.current;
    if (!cube) return;
    const from = now();
    const [restX, restY] = REST[face(value)];
    const to = {
      x: congruent(restX, from.x),
      y: congruent(restY, from.y),
      z: congruent(0, from.z),
    };
    stop();
    const anim = cube.animate(
      [
        {
          transform: `translate3d(0, ${from.lift}px, 0) rotateX(${from.x}deg) rotateY(${from.y}deg) rotateZ(${from.z}deg)`,
        },
        {
          transform: `translate3d(0, 0, 0) rotateX(${to.x}deg) rotateY(${to.y}deg) rotateZ(${to.z}deg)`,
        },
      ],
      { duration: CANCEL_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
    );
    anims.current.push(anim);
    const shade = shadeRef.current;
    if (shade) {
      anims.current.push(
        shade.animate([{ transform: "scale(1)", opacity: 0.3 }], {
          duration: CANCEL_MS,
          easing: "ease-out",
          fill: "forwards",
        }),
      );
    }
    anim.onfinish = () => {
      stop();
      paint(to.x, to.y, to.z, 0);
    };
  };

  // Snap, with nothing in flight: a refetch, a first paint, a scenario swap.
  const settle = (value) => {
    stop();
    const [restX, restY] = REST[face(value)];
    paint(congruent(restX, at.current.x), congruent(restY, at.current.y), congruent(0, at.current.z), 0);
  };

  return { cubeRef, shadeRef, startAir, land, cancel, settle, stop };
}

/**
 * values   the faces to show at rest (the game's dice)
 * roll     null, or { id, startedAt, result, restAt, cancelled }
 *            id        changes once per roll; a new id starts the beat
 *            result    [d1, d2] once the server has answered, else null
 *            restAt    epoch ms at which BOTH dice must be down
 *            cancelled the action was refused: put the dice back
 * size     px per die (44 phone, 34 in the decide state, 88 TV)
 * reduce   force the reduced-motion path (the TV listens for it itself)
 */
export default function RollDice({
  values = [1, 1],
  roll = null,
  size = 44,
  gap,
  radius,
  label,
  reduce: reduceProp,
  className = "",
}) {
  const reduce = useReduce(reduceProp);
  // How high the throw goes. Deliberately modest: a rotating cube already
  // projects wider than its resting face, and on the phone the dice tray is
  // only 14px taller than the die, so a big arc would put a die over the ticket
  // above it.
  const hop = Math.round(size * 0.3);
  const a = useDie(0, hop);
  const b = useDie(1, hop);
  const dice = [a, b];

  // The faces that are actually SHOWN. While a roll is in the air these stay on
  // the previous result — the cube is spinning, and nothing may read the new
  // one off it until it is down.
  const [shown, setShown] = useState(() => [face(values[0]), face(values[1])]);
  const [state, setState] = useState("rest"); // rest | air | landing
  const latest = useRef([face(values[0]), face(values[1])]);
  const seen = useRef(null);
  const resolved = useRef(null);
  const timers = useRef([]);
  // The result this roll landed on. It outranks `values` afterwards: the dice
  // come to rest a hair before (or after) the buffered snapshot that carries
  // the same numbers is released, and without this the cube would rotate back
  // to the PREVIOUS face for that one frame.
  const locked = useRef(null);

  useEffect(() => {
    latest.current = [face(values[0]), face(values[1])];
  });

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // ---- a new roll starts -------------------------------------------------
  useEffect(() => {
    const id = roll?.id ?? null;
    if (id === null || id === seen.current) return;
    seen.current = id;
    resolved.current = null;
    locked.current = null;
    clearTimers();
    if (reduce) {
      setState("air");
      return;
    }
    setState("air");
    if (roll.result) {
      // Somebody else's roll (or our own, answered before the first frame):
      // one continuous throw straight onto the result.
      return;
    }
    dice.forEach((d) => d.startAir());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.id, reduce]);

  // ---- the result arrives (or the roll is refused) ------------------------
  useEffect(() => {
    if (!roll || roll.id !== seen.current) return;

    if (roll.cancelled) {
      if (resolved.current === "cancelled") return;
      resolved.current = "cancelled";
      clearTimers();
      // A refused action changed nothing, so `values` still holds the faces
      // that were showing before the tap.
      const back = latest.current;
      if (reduce) {
        setShown(back);
        setState("rest");
        return;
      }
      dice.forEach((d, i) => d.cancel(back[i]));
      timers.current.push(
        setTimeout(() => {
          setShown(back);
          setState("rest");
        }, CANCEL_MS),
      );
      return;
    }

    const result = roll.result;
    if (!result || resolved.current === roll.id) return;
    resolved.current = roll.id;

    const restAt = roll.restAt ?? Date.now();
    const total = Math.max(0, restAt - Date.now());
    const final = [face(result[0]), face(result[1])];

    if (reduce) {
      // No tumble: hold the previous faces dimmed for the whole beat, then
      // cross-fade. The reveal buffer holds for exactly as long, so the order
      // of information is the same as with motion on.
      timers.current.push(
        setTimeout(
          () => {
            locked.current = final;
            setShown(final);
            setState("rest");
          },
          Math.max(0, total - SETTLED_LEAD),
        ),
      );
      return;
    }

    // The second die comes down LAND_STAGGER later, which is also what makes
    // the two durations differ by roughly 10%.
    const each = [Math.max(0, total - LAND_STAGGER), total];
    dice.forEach((d, i) => d.land(final[i], each[i]));
    setState("landing");
    timers.current.push(
      setTimeout(
        () => {
          locked.current = final;
          setShown(final);
          setState("rest");
        },
        Math.max(0, total - SETTLED_LEAD),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.id, roll?.result, roll?.cancelled, roll?.restAt, reduce]);

  // ---- resting values change with nothing in flight -----------------------
  useLayoutEffect(() => {
    if (state !== "rest") return;
    const next = locked.current ?? [face(values[0]), face(values[1])];
    setShown((cur) => (cur[0] === next[0] && cur[1] === next[1] ? cur : next));
    dice.forEach((d, i) => d.settle(next[i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values[0], values[1], state, size]);

  useEffect(
    () => () => {
      clearTimers();
      a.stop();
      b.stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const rolling = state !== "rest";
  const style = { "--die": `${size}px` };
  if (gap != null) style["--die-gap"] = `${gap}px`;
  if (radius != null) style["--die-r"] = `${radius}px`;

  return (
    <span
      className={`${s.dice} ${className}`}
      style={style}
      role="img"
      aria-label={rolling ? "Rolling" : label || `Dice ${shown[0]} and ${shown[1]}`}
    >
      {dice.map((d, i) => (
        <span key={i} className={s.slot}>
          <span ref={d.shadeRef} className={s.shade} aria-hidden="true" />
          {reduce ? (
            <span className={`${s.flat} ${rolling ? s.flatRolling : ""}`}>
              <Pips value={shown[i]} />
            </span>
          ) : (
            <span ref={d.cubeRef} className={s.cube}>
              {SIDES.map((side) => (
                <span key={side.v} className={s.face} style={{ "--f": side.t }}>
                  <Pips value={side.v} />
                </span>
              ))}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
