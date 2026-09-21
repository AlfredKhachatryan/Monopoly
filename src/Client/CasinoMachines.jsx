// The three machines on the casino floor: a slot cabinet, a roulette track and
// the prize wheel.
//
// Each one is rendered by BOTH casino components, from the same props:
//
//   idle      `result` is null. CasinoPanel shows the machine the player has
//             picked, at rest, before any money is on it — and so does
//             CasinoResult for the moment between the button press and the
//             server's answer.
//   spinning  `result` is the server's own block and `run` has flipped on. The
//             machine travels from the idle position to the position that
//             block describes.
//   stopped   `reveal` is on: the machine may now say what it landed on.
//
// THE CONTRACT, which is the same one CasinoResult.jsx states: by the time a
// `result` exists the server has already settled the bet. Nothing in this file
// draws a number, seeds anything from a clock, or starts moving before the
// answer is known. Every stop position comes from casinoGames.js and is a pure
// function of the index the server sent, so a machine cannot come to rest on
// something the server did not pick — there is nowhere else for the position
// to come from. "Spin, then correct" is not possible here either, because
// there is no spin without a destination.
//
// Idle and spinning are the same elements in the same place — only a custom
// property (reels, track) or a rotation (wheel) changes — which is what lets
// the hand-over from the takeover to the replay read as one machine.

import { useEffect, useRef } from "react";
import { Spade } from "lucide-react";
import {
  REEL_NAMES,
  REEL_SYMBOLS,
  ROULETTE_LAPS,
  ROULETTE_ORDER,
  ROULETTE_START,
  WEDGE_DEG,
  WHEEL_LAYOUT,
  colourOfSlot,
  multLabel,
  pocketAtCell,
  reelCellCount,
  reelStartIndex,
  reelStopIndex,
  rouletteStopIndex,
  symbolAtCell,
  wedgeCentreDeg,
  wedgeLabel,
  wedgeTone,
  wheelMult,
  wheelStopDeg,
} from "./casinoGames";
import c from "./casino.module.css";

// How long each machine takes to come to rest. CasinoResult times the verdict
// off these, so they are exported rather than repeated. The reels' figure is
// the LAST reel; the other two stop before it.
export const REEL_MS = [1700, 2200, 2700];
export const SPIN_MS = { slots: REEL_MS[2], roulette: 3600, wheel: 5600 };

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

// What the marquee lights are doing. One vocabulary for all three machines:
//   idle   a slow alternate twinkle      spin   the chase
//   win    everything flashing           lose   lit but still
// (`prefers-reduced-motion` turns every one of them into "lit but still".)
function lightsFor({ result, run, reveal, mult }) {
  if (!result) return "idle";
  if (!reveal) return run ? "spin" : "idle";
  return Number(mult) > 0 ? "win" : "lose";
}

// A row of bulbs for the two machines that are rectangles. `--d` is the bulb's
// place in the chase (0, 1, 2, 0, 1, 2 …): three phases is the classic marquee,
// and it reads as travelling light at any speed.
function Bulbs({ count, mode }) {
  return (
    <span className={c.bulbs} data-mode={mode} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ "--d": i % 3 }} />
      ))}
    </span>
  );
}

// ---- slots -------------------------------------------------------------------

// Which reels made the result. ×10 is all three; ×2 is the matching pair, and
// which pair it is has to be worked out from the indices rather than assumed,
// because mono_casino_spin pays a pair on any of the three combinations.
export function slotHits(reels, mult) {
  const [a, b, d] = reels;
  if (Number(mult) >= 10) return [0, 1, 2];
  if (a === b) return [0, 1];
  if (b === d) return [1, 2];
  if (a === d) return [0, 2];
  return [];
}

// A cabinet: a lit marquee carrying the paytable, three windows onto three
// drums, a payline across them and a brass base. Each window is 1.8 symbols
// tall so the neighbours peek in above and below the payline — which is what
// makes a strip of icons read as a DRUM.
//
// Reel i's strip rests on cell `--at`. Idle that is reelStartIndex(i); with a
// result it is reelStopIndex(i, reels[i]) — 6 + the server's index, and cell n
// shows symbol n % 6, so the symbol on the payline IS the one the server sent.
export function SlotsMachine({ result = null, run = false, reveal = false, mult = 0 }) {
  const reels = Array.isArray(result?.reels)
    ? [0, 1, 2].map((i) => Number(result.reels[i]) || 0)
    : null;
  const hits = reels && reveal ? slotHits(reels, mult) : [];
  const mode = lightsFor({ result, run, reveal, mult });
  const label = reels
    ? reveal
      ? `Reels: ${reels.map((r) => REEL_NAMES[r] ?? r).join(", ")}`
      : "The reels are spinning"
    : "Slot machine, three reels";

  return (
    <div className={c.cab} data-mode={mode} role="img" aria-label={label}>
      <div className={c.cabTop}>
        <Bulbs count={9} mode={mode} />
        <span className={c.cabPlate} aria-hidden="true">
          Three alike ×10 · Pair ×2
        </span>
      </div>
      <div className={c.cabGlass}>
        {[0, 1, 2].map((i) => {
          const at = reels && run ? reelStopIndex(i, reels[i]) : reelStartIndex(i);
          return (
            <div
              key={i}
              className={c.reel}
              data-run={reels && run ? "1" : undefined}
              data-hit={hits.includes(i) ? "1" : undefined}
              data-miss={reveal && hits.length > 0 && !hits.includes(i) ? "1" : undefined}
              data-stop={reels ? reelStopIndex(i, reels[i]) : undefined}
              style={{ "--at": at, "--spin": `${REEL_MS[i]}ms` }}
            >
              <div className={c.reelStrip}>
                {Array.from({ length: reelCellCount(i) }, (_, n) => {
                  const Ico = REEL_SYMBOLS[symbolAtCell(n)];
                  return (
                    <span key={n} className={c.sym} data-sym={symbolAtCell(n)} aria-hidden="true">
                      <Ico strokeWidth={2.1} />
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
        <span className={c.payline} aria-hidden="true" />
      </div>
      <div className={c.cabBase} aria-hidden="true">
        <i />
        <span>Slots</span>
        <i />
      </div>
    </div>
  );
}

// ---- roulette ----------------------------------------------------------------

const SPOTS = [
  { id: "red", label: "Red", pays: "×2" },
  { id: "black", label: "Black", pays: "×2" },
  { id: "green", label: "Green", pays: "×14" },
];

// A straight run of the 37 pockets in European wheel order, scrolled under a
// fixed pointer with the ball sitting in it. A spinning disc of 37 numbers is
// unreadable at phone size; the pockets and their colours are the part that
// matters, and this shows them full-size. Same contract as the reels: the
// track rests on cell `--at`, and with a result that is rouletteStopIndex(slot)
// — the server's pocket, found in ROULETTE_ORDER — so it cannot land anywhere
// else.
//
// Under the track is the layout the chip goes on: the three bets the server
// takes. In the takeover these ARE the colour picker (`onPick` is given and
// they are buttons); in the replay they are the same three boxes with the chip
// where the player put it, and once the ball has stopped the box that matches
// the pocket lights up — so "did my colour come in" is answered by the table
// before the verdict says it in dollars.
export function RouletteMachine({
  result = null,
  run = false,
  reveal = false,
  mult = 0,
  pick = "red",
  onPick = null,
  disabled = false,
}) {
  const has = result != null && result.slot != null;
  const slot = has ? Number(result.slot) || 0 : null;
  const at = has && run ? rouletteStopIndex(slot) : ROULETTE_START;
  const landed = has && reveal ? colourOfSlot(slot) : null;
  const mode = lightsFor({ result: has ? result : null, run, reveal, mult });
  const chosen = (has ? result.pick : null) ?? pick;
  const label = has
    ? reveal
      ? `The ball landed on ${slot}, ${colourOfSlot(slot)}`
      : "The ball is rolling"
    : "Roulette";

  return (
    <div className={c.table} data-mode={mode}>
      <div className={c.track} role="img" aria-label={label}>
        <Bulbs count={11} mode={mode} />
        <div
          className={c.trackGlass}
          data-run={has && run ? "1" : undefined}
          data-stop={has ? rouletteStopIndex(slot) : undefined}
          style={{ "--at": at }}
        >
          <div className={c.trackStrip}>
            {Array.from({ length: ROULETTE_ORDER.length * ROULETTE_LAPS }, (_, n) => {
              const p = pocketAtCell(n);
              return (
                <span key={n} className={c.pocket} data-c={colourOfSlot(p)} aria-hidden="true">
                  <i>{p}</i>
                </span>
              );
            })}
          </div>
          <span className={c.trackMark} aria-hidden="true" />
          <span className={c.ball} aria-hidden="true" />
        </div>
        <span className={c.trackPin} aria-hidden="true" />
      </div>

      <div className={c.spots} role="group" aria-label={onPick ? "Pick a colour" : "The bet"}>
        {SPOTS.map((s) => {
          const on = chosen === s.id;
          const body = (
            <>
              <i className={c.chip} aria-hidden="true" />
              <b>{s.label}</b>
              <em>{s.pays}</em>
            </>
          );
          return onPick ? (
            <button
              key={s.id}
              type="button"
              className={c.spot}
              data-c={s.id}
              aria-pressed={on}
              aria-label={`${s.label}, pays ${s.pays}`}
              onClick={() => onPick(s.id)}
              disabled={disabled}
            >
              {body}
            </button>
          ) : (
            <span
              key={s.id}
              className={c.spot}
              data-c={s.id}
              data-on={on ? "1" : undefined}
              data-landed={landed === s.id ? "1" : undefined}
            >
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---- the prize wheel ---------------------------------------------------------

// Polar → SVG, with the angle measured the way the wheel is: degrees CLOCKWISE
// from twelve o'clock. (SVG's y axis points down, hence the minus.)
function pt(r, deg) {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(3)},${(-r * Math.cos(a)).toFixed(3)}`;
}

const R_WEDGE = 84; // the painted disc
const R_PEG = 79; // the pegs the pointer ticks past, on the wedge boundaries
const R_TEXT = 61; // where a wedge's label sits
const R_BULB = 92.5; // the rim lights
const BULBS = 24;
const PIN_HINGE_Y = -97; // where the pointer is pinned to the rim

function wedgePath(pos) {
  const mid = wedgeCentreDeg(pos);
  const a0 = mid - WEDGE_DEG / 2;
  const a1 = mid + WEDGE_DEG / 2;
  return `M0,0 L${pt(R_WEDGE, a0)} A${R_WEDGE},${R_WEDGE} 0 0 1 ${pt(R_WEDGE, a1)} Z`;
}

// A long ease-out: the wheel is flung and then dies. 1 − (1 − t)^3.2 has no
// ramp-up at all (a wheel that has just been thrown is already at full speed)
// and a very long tail — the last three wedges take about a third of the whole
// spin, and the last peg goes past the pointer well over a second before the
// wheel stops, so the final wedge really does crawl in.
const EASE_POW = 3.2;
const easeOut = (t) => 1 - Math.pow(1 - t, EASE_POW);

// Three layers in one square, because only one of them moves:
//   the rim     static. Brass, with the 24 bulbs. They chase by CSS alone.
//   the disc    the twelve wedges, their labels and the pegs. This is the only
//               thing that rotates, and it rotates as ONE composited element
//               (a transform on the wrapper, not on the SVG's children), so a
//               five-second spin is a layer being turned rather than twelve
//               paths and twelve text runs being repainted sixty times a
//               second on a phone.
//   the top     static again: the hub, which shows the result once the wheel
//               has stopped and NOT before, and the pointer.
//
// Position p (clockwise from twelve o'clock) carries segment WHEEL_LAYOUT[p];
// the label printed on it is wedgeLabel(that segment) and its paint is
// wedgeTone(that segment) — both read straight from wheelMult(), so a wedge
// cannot advertise anything other than what the server pays for it. The stop
// is wheelStopDeg(segment): whole turns plus exactly what it takes to carry
// that wedge's centre under the pointer. See casinoGames.js.
//
// THE SPIN IS DRIVEN FROM requestAnimationFrame, not a CSS transition, for one
// reason: the pointer. It has to flick when a peg goes past it, and only code
// that knows the wheel's angle on every frame knows when that is. Each frame
// computes the angle from the elapsed time and the fixed destination — never
// from the previous frame — so a dropped frame, a background tab or a slow
// phone can make the spin choppy but cannot make it end anywhere else; the
// last frame writes the destination itself, exactly.
export function WheelMachine({ result = null, run = false, reveal = false, mult = 0 }) {
  const has = result != null && result.segment != null;
  const segment = has ? Math.min(Math.max(Math.round(Number(result.segment)) || 1, 1), 12) : null;
  const stop = has ? wheelStopDeg(segment) : null;
  const disc = useRef(null);
  const pin = useRef(null);
  const mode = lightsFor({ result: has ? result : null, run, reveal, mult });

  useEffect(() => {
    const el = disc.current;
    const pinEl = pin.current;
    if (!el) return undefined;
    const turnTo = (deg) => {
      el.style.transform = `rotate(${deg}deg)`;
    };
    // The pointer is an SVG group, so its rotation is written as a
    // `transform` attribute with the hinge spelled out in user units — no
    // transform-origin / transform-box to be interpreted differently by
    // different engines.
    const flick = (deg) => {
      if (pinEl) pinEl.setAttribute("transform", `rotate(${deg.toFixed(2)} 0 ${PIN_HINGE_Y})`);
    };

    if (stop == null || !run) {
      turnTo(0);
      flick(0);
      return undefined;
    }
    // Reduced motion: no journey. The wheel is simply shown where it stopped.
    // Nothing is lost by that — the destination was always the information.
    if (prefersReducedMotion()) {
      turnTo(stop % 360);
      flick(0);
      return undefined;
    }

    const total = SPIN_MS.wheel;
    const t0 = performance.now();
    let raf = 0;
    let lastNow = t0;
    let lastDeg = 0;
    // Pegs stand on the wedge boundaries, 15° off each centre, so peg k is
    // under the pointer when the rotation is 15 + 30k. `pegs` counts how many
    // have gone by; when it changes between two frames, one (or several) just
    // passed and the pointer is kicked over in the direction the rim is
    // travelling — harder the faster the wheel is going — and then springs
    // back. At the destination the rotation sits on a wedge CENTRE, half a
    // wedge from either peg, so the pointer always ends upright.
    let pegs = 0;
    let lean = 0;

    const frame = (now) => {
      const t = Math.min((now - t0) / total, 1);
      const deg = stop * easeOut(t);
      const dt = Math.max(now - lastNow, 1);
      const passed = Math.floor((deg + WEDGE_DEG / 2) / WEDGE_DEG);
      if (passed !== pegs) {
        pegs = passed;
        const speed = ((deg - lastDeg) / dt) * 1000; // degrees per second
        lean = -Math.min(7 + speed * 0.028, 30);
      } else {
        lean *= Math.exp(-dt / 85);
      }
      lastNow = now;
      lastDeg = deg;
      if (t >= 1) {
        turnTo(stop);
        flick(0);
        return;
      }
      turnTo(deg);
      flick(lean);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [stop, run]);

  const label = has
    ? reveal
      ? `The wheel stopped on ${wedgeLabel(segment)}`
      : "The wheel is spinning"
    : "Prize wheel, twelve wedges";

  return (
    <div
      className={c.wheel}
      data-mode={mode}
      data-tone={has && reveal ? wedgeTone(segment) : undefined}
      role="img"
      aria-label={label}
    >
      <svg className={c.wheelRim} viewBox="-100 -100 200 200" aria-hidden="true">
        <defs>
          <radialGradient id="casRim" cx="50%" cy="50%" r="50%">
            <stop offset="84%" stopColor="#7c5f17" />
            <stop offset="90%" stopColor="#e9c766" />
            <stop offset="96%" stopColor="#b8912f" />
            <stop offset="100%" stopColor="#6b5113" />
          </radialGradient>
        </defs>
        <circle r="99" fill="url(#casRim)" />
        <circle r="85.5" fill="#06261c" />
        <g className={c.rimBulbs} data-mode={mode}>
          {Array.from({ length: BULBS }, (_, i) => {
            const [x, y] = pt(R_BULB, (360 / BULBS) * i).split(",");
            return <circle key={i} cx={x} cy={y} r="3.1" style={{ "--d": i % 3 }} />;
          })}
        </g>
      </svg>

      <div
        ref={disc}
        className={c.wheelDisc}
        data-reveal={has && reveal ? "1" : undefined}
        data-stop={stop ?? undefined}
      >
        <svg viewBox="-100 -100 200 200" aria-hidden="true">
          {WHEEL_LAYOUT.map((seg, pos) => (
            <g
              key={seg}
              className={c.wedge}
              data-pos={pos}
              data-seg={seg}
              data-tone={wedgeTone(seg)}
              data-alt={pos % 2 ? "1" : undefined}
              data-win={has && reveal && seg === segment ? "1" : undefined}
            >
              <path d={wedgePath(pos)} />
              <text
                transform={`rotate(${wedgeCentreDeg(pos)}) translate(0,${-R_TEXT})`}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {wedgeLabel(seg)}
              </text>
              {/* a small stud towards the hub, so the long dark wedges are
                  not just a slab of paint below their label */}
              <circle
                className={c.stud}
                r="2.2"
                transform={`rotate(${wedgeCentreDeg(pos)}) translate(0,-38)`}
              />
            </g>
          ))}
          <circle r={R_WEDGE} className={c.discEdge} />
          {WHEEL_LAYOUT.map((seg, pos) => {
            const [x, y] = pt(R_PEG, wedgeCentreDeg(pos) + WEDGE_DEG / 2).split(",");
            return <circle key={seg} className={c.peg} cx={x} cy={y} r="2.6" />;
          })}
        </svg>
      </div>

      {/* The hub carries the result, and it must NOT carry it while the wheel
          is still turning — a hub that says "×3" over a wheel that has not
          stopped answers the question the spin is asking. It shows the house's
          spade until the same `reveal` beat the verdict waits for. */}
      <div className={c.wheelHub} data-reveal={has && reveal ? "1" : undefined} aria-hidden="true">
        {has && reveal ? (
          <b>{wheelMult(segment) > 0 ? multLabel(wheelMult(segment)) : "LOSE"}</b>
        ) : (
          <Spade strokeWidth={2.2} />
        )}
      </div>

      <svg className={c.wheelTop} viewBox="-100 -100 200 200" aria-hidden="true">
        {/* Hinged at the top of the rim, tip reaching in past the pegs. The
            rotation is written by the spin loop; the origin is the hinge. */}
        <g ref={pin} className={c.wheelPin}>
          <path d="M-9,-101 L9,-101 L2.2,-74 Q0,-70.5 -2.2,-74 Z" />
          <circle cx="0" cy={PIN_HINGE_Y} r="4.2" />
        </g>
      </svg>
    </div>
  );
}

// ---- one switch ---------------------------------------------------------------

// The machine for a game id, so the two casino components cannot disagree about
// which component a game is. An id this client has never heard of gets the
// cabinet, idle — a frame with nothing in it would be worse.
export default function CasinoMachine({ game, ...rest }) {
  if (game === "wheel") return <WheelMachine {...rest} />;
  if (game === "roulette") return <RouletteMachine {...rest} />;
  return <SlotsMachine {...rest} />;
}
