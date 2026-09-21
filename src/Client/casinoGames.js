// What the three casino games ARE, in one place, so the panel that offers them
// and the animation that resolves them can never describe the same game
// differently.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: every number below is a
// DESCRIPTION of what the server already does, never an input to it. All the
// randomness lives in public.mono_casino_spin() (see
// supabase/migrations/20260920170000_casino_farm_rebalance.sql) — the client
// sends {game, bet, colour} and gets back the whole outcome. Nothing here rolls
// a die, picks a symbol or predicts a payout; the odds are written down only so
// the UI can state them honestly before a player commits money to them.
//
// PAYOUT CONVENTION, and it is the server's: "×2" means the player ENDS
// HOLDING twice their bet. It is settled as two ledger movements, a `pay` of
// the bet and then a `collect` of floor(bet × mult), so ×2 is +1× profit, ×1.5
// is +0.5× and ×0 is the bet gone. Every multiplier printed on screen means
// that, and the panel says so out loud.

import { Bell, Cherry, Club, Crown, Diamond, Gem } from "lucide-react";

// The six slot symbols, indexed 0..5 exactly as mono_casino_spin's reels are:
// it returns three independent `floor(random() * 6)`, so the index IS the
// symbol and this array is the only thing that turns one into a picture.
// Reordering it does not change the odds — but it does change which picture a
// stored result renders as, so don't.
export const REEL_SYMBOLS = [Cherry, Gem, Crown, Bell, Club, Diamond];

export const REEL_NAMES = ["cherry", "gem", "crown", "bell", "club", "diamond"];

// The pockets in European wheel order, which is the order a real roulette
// prints them in and has nothing to do with the odds: the server draws a flat
// `floor(random() * 37)`, so every pocket is 1/37 whatever order they are laid
// out in. This is presentation, and only presentation.
export const ROULETTE_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

// The SERVER's colouring, not the felt's: mono_casino_spin calls 0 green,
// 1..18 red and 19..36 black. A real wheel alternates red and black by pocket
// instead, and painting the strip that way would show a pocket in one colour
// while the result event called it another — so the server's rule wins, here
// and in the panel's colour buttons.
export function colourOfSlot(slot) {
  const n = Number(slot);
  if (!Number.isFinite(n)) return "green";
  if (n === 0) return "green";
  return n <= 18 ? "red" : "black";
}

// Twelve segments, 1..12, exactly as the server numbers them:
//   1-5  lose      6-9  ×1.5      10-11  ×3      12  ×10
export function wheelMult(segment) {
  const s = Number(segment);
  if (!Number.isFinite(s)) return 0;
  if (s <= 5) return 0;
  if (s <= 9) return 1.5;
  if (s <= 11) return 3;
  return 10;
}

// ---- where each machine comes to rest --------------------------------------
//
// Everything from here to the game list is PRESENTATION GEOMETRY, and every
// function in it has exactly one input that matters: the index the server sent.
// They live here rather than inside the components for two reasons. The idle
// machine in the takeover (CasinoPanel) and the spinning one in the replay
// (CasinoResult) must start from the same place or the hand-over between them
// shows; and a stop position that is a pure function of the server's number can
// be checked without a browser — which is how "the wedge under the pointer
// pays what the server paid" is asserted rather than hoped for.
//
// None of it is random and none of it is a guess: there is no jitter on the
// stopping angle, no "near miss" offset, nothing seeded from a clock. The same
// result always comes to rest in the same place.

// THE WHEEL. Twelve 30° wedges. The server numbers its segments 1..12 and pays
// by NUMBER (1-5 lose, 6-9 ×1.5, 10-11 ×3, 12 ×10) — it says nothing about
// where a segment sits on the wheel, because it has no wheel. So, exactly like
// ROULETTE_ORDER above, the order the wedges are PAINTED in is presentation:
// read clockwise from twelve o'clock, position p carries segment
// WHEEL_LAYOUT[p]. Painted 1..12 in a row the wheel would be five dead wedges,
// then four teal, two gold and the jackpot — a pie chart, not a prize wheel.
// Dealt round like this no two neighbours pay the same and the ×10 sits
// between two LOSE wedges, which is where every game-show wheel puts it.
//
// What is NOT presentation is what a wedge pays: the label printed on the wedge
// for segment s is always wheelMult(s), and the wheel always stops with the
// wedge for the server's segment under the pointer. Reordering this array
// moves wedges around the rim; it cannot change what any segment is worth or
// how likely it is (each is one draw in twelve, wherever it is painted).
export const WHEEL_LAYOUT = [12, 1, 6, 2, 10, 7, 3, 8, 4, 11, 9, 5];

export const WEDGE_DEG = 360 / WHEEL_LAYOUT.length;

// Whole turns the wheel makes before it starts to die. Presentation.
export const WHEEL_TURNS = 4;

// Where on the rim the server's segment is painted: 0 is the wedge centred on
// twelve o'clock when the wheel is at rest, counting clockwise. A segment the
// layout does not know (a newer server, a mangled event) falls back to the
// first LOSE wedge rather than to the jackpot sitting at position 0.
export function wheelPosOf(segment) {
  const at = WHEEL_LAYOUT.indexOf(Number(segment));
  return at >= 0 ? at : WHEEL_LAYOUT.indexOf(1);
}

// The centre of position p, in degrees clockwise from the pointer, with the
// wheel at rest (rotation 0). Wedge p spans ±15° either side of it, and the
// pegs stand on the boundaries, at centre ± 15°.
export function wedgeCentreDeg(pos) {
  return pos * WEDGE_DEG;
}

// The clockwise rotation that brings the server's segment to rest dead centre
// under the pointer: WHEEL_TURNS whole turns, plus whatever is left to carry
// that wedge's centre round to twelve o'clock. After a rotation of R a wedge
// whose centre was at c sits at (c + R) mod 360, so R = turns·360 + (360 − c)
// puts it at 0 — under the pointer — and nowhere else.
export function wheelStopDeg(segment, turns = WHEEL_TURNS) {
  const c = wedgeCentreDeg(wheelPosOf(segment));
  return turns * 360 + ((360 - c) % 360);
}

// THE REELS. Each window looks onto a strip of the six symbols repeated, cell n
// showing symbol n % 6. The strip travels DOWNWARD, the way a real drum turns
// towards the player, so it starts deep in the strip and stops near the top:
// reel i rests on cell REEL_START[i] while idle and comes to rest on cell
// 6 + value — one whole lap in, so there is always a symbol peeking above the
// payline and one below it. The three reels carry different lap counts so they
// stop left to right, one after another.
export const REEL_LAPS = [4, 6, 8];

// What the three windows show before anybody has bet. Three DIFFERENT symbols
// on purpose: an idle cabinet showing three alike is an advert for a result
// that turns up 2.8% of the time.
const REEL_IDLE = [2, 0, 4];

export function reelCellCount(i) {
  return (REEL_LAPS[i] + 3) * REEL_SYMBOLS.length;
}

export function reelStartIndex(i) {
  return (REEL_LAPS[i] + 1) * REEL_SYMBOLS.length + REEL_IDLE[i];
}

export function reelStopIndex(i, value) {
  const n = REEL_SYMBOLS.length;
  const v = ((Math.round(Number(value) || 0) % n) + n) % n;
  return n + v;
}

export function symbolAtCell(n) {
  return n % REEL_SYMBOLS.length;
}

// THE ROULETTE TRACK. Five laps of ROULETTE_ORDER laid end to end, cell n
// showing pocket ROULETTE_ORDER[n % 37], scrolled right-to-left under a fixed
// pointer. Idle it rests on the green zero at the head of the second lap; it
// stops on the server's pocket in the fourth, two full laps and a bit later.
export const ROULETTE_LAPS = 5;

export const ROULETTE_START = ROULETTE_ORDER.length;

export function rouletteStopIndex(slot) {
  const at = ROULETTE_ORDER.indexOf(Number(slot));
  return ROULETTE_ORDER.length * 3 + Math.max(at, 0);
}

export function pocketAtCell(n) {
  return ROULETTE_ORDER[n % ROULETTE_ORDER.length];
}

// What is printed in a wheel wedge. The same multLabel the verdict uses, except
// that a wedge paying nothing says LOSE instead of "×0" — nobody has ever
// painted "×0" on a prize wheel.
export function wedgeLabel(segment) {
  const m = wheelMult(segment);
  return m > 0 ? multLabel(m) : "LOSE";
}

// lose / small / big / jackpot — which paint a wedge gets. Derived from what
// the segment PAYS, never from where it sits, so the colour cannot drift away
// from the number printed on it.
export function wedgeTone(segment) {
  const m = wheelMult(segment);
  if (m <= 0) return "lose";
  if (m >= 10) return "jackpot";
  return m >= 3 ? "big" : "small";
}

// The three games, in the order they are offered. `odds` is the honest line
// shown under the picker — the real chances and the real multipliers, with no
// rounding in the house's favour. The percentages are the exact distributions
// the server's own comment derives: 6/216 triples and 90/216 pairs for the
// reels, 18/37 and 1/37 for the wheel's pockets, 5/4/2/1 of 12 segments.
export const CASINO_GAMES = [
  {
    id: "slots",
    name: "Slots",
    // ~2.78% and ~41.67%, written to one decimal because a gambling UI that
    // rounds 2.78 up to 3 is already shading the truth.
    odds: "Three alike ×10 (2.8%) · any pair ×2 (41.7%) · anything else loses (55.6%)",
  },
  {
    id: "roulette",
    name: "Roulette",
    odds: "Red ×2 (18/37) · Black ×2 (18/37) · Green ×14 (1/37) · wrong colour loses",
  },
  {
    id: "wheel",
    name: "Wheel",
    odds: "12 segments · 5 lose · 4 pay ×1.5 · 2 pay ×3 · 1 pays ×10",
  },
];

export const GAME_NAME = {
  slots: "Slots",
  roulette: "Roulette",
  wheel: "Wheel of Fortune",
};

// "×10" / "×1.5" / "lost" — the way a multiplier is written everywhere on the
// phone. `mult` arrives from the server as a number (jsonb numeric), and 1.5
// has to survive as 1.5 rather than becoming 2.
export function multLabel(mult) {
  const m = Number(mult);
  if (!Number.isFinite(m) || m <= 0) return "×0";
  return `×${Number.isInteger(m) ? m : m.toFixed(1)}`;
}

// How loud the result is allowed to be: a losing bet, an ordinary win, or the
// ×10 / ×14 that only turns up a couple of times a game.
export function toneOfMult(mult) {
  const m = Number(mult) || 0;
  if (m <= 0) return "lose";
  return m >= 10 ? "jackpot" : "win";
}
