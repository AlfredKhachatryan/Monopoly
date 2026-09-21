import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { FIGS } from "./rules";

// Turns the "which cell has which figure" flags in `pos` into a map of
// displayed positions ({ fig0: 12, fig2: 3 }). TokenLayer animates the
// tokens between those cells.
//
// With WALK on, the displayed position advances one cell at a time towards
// the real one, so a token hops cell by cell. With WALK off (current
// setting) it jumps straight to the real cell and TokenLayer flies the token
// there in a single arc.
//
// - Figures that appear / disappear (join, leave, reset) are placed at once.
// - Moves longer than MAX_WALK cells (debug jumps) are placed at once too,
//   because a dice roll can never exceed 12.
// - Only one interval runs at a time, whatever number of figures move.
//
// `pin` — the card read beat (src/Client/useReveal.js's useCardBeat).
//
// A Chance card is resolved by the server in the same transaction as the roll
// that landed on it, so `pos` already has the piece in Jail, or three cells
// back, or on the railroad the card sent it to. Flown straight there, the
// piece never visits the deck at all and the card face is dealt over a board
// that has already given the answer away. `pin` is a { figure: cell } overlay
// on the TARGETS — not on the state, which is never touched — that holds the
// drawer on the deck cell for as long as the card is being read. When it
// lifts, the ordinary machinery below flies the piece on to where the row has
// said it was all along. A figure not named in `pin`, and a figure that is not
// on the board, are unaffected.

const CELLS = 40;
const WALK = false; // true = hop cell by cell, false = one arc per move
const STEP_MS = 290; // one hop per cell when walking
const MAX_WALK = 14;

function targetsFrom(pos) {
  const out = {};
  if (!pos) return out;
  for (const [key, cell] of Object.entries(pos)) {
    for (const f of FIGS) if (cell[f]) out[f] = Number(key);
  }
  return out;
}

export function useWalkingTokens(pos, pin = null) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(() => targetsFrom(pos));
  const shownRef = useRef(shown);
  const targetRef = useRef(shown);
  const timer = useRef(null);

  useEffect(() => {
    const targets = targetsFrom(pos);
    if (pin) {
      for (const [f, cell] of Object.entries(pin)) {
        // Only a figure that is actually on this board, and only a real cell:
        // a pin must never conjure a piece into existence or park one nowhere.
        if (targets[f] !== undefined && cell != null) targets[f] = Number(cell);
      }
    }
    targetRef.current = targets;

    // Advance every figure by one cell (or place it if it cannot walk).
    // Returns true while at least one figure still has cells to go.
    const step = () => {
      const cur = { ...shownRef.current };
      const tgt = targetRef.current;
      for (const f of FIGS) {
        const to = tgt[f];
        const from = cur[f];
        if (to === undefined) {
          delete cur[f];
          continue;
        }
        if (from === undefined || from === to) {
          cur[f] = to;
          continue;
        }
        const dist = (to - from + CELLS) % CELLS;
        cur[f] =
          !WALK || dist > MAX_WALK || reduceMotion ? to : (from % CELLS) + 1;
      }
      shownRef.current = cur;
      setShown(cur);
      return FIGS.some((f) => tgt[f] !== undefined && cur[f] !== tgt[f]);
    };

    if (timer.current) return; // a walk is already running; it reads targetRef
    if (step()) {
      timer.current = setInterval(() => {
        if (!step()) {
          clearInterval(timer.current);
          timer.current = null;
        }
      }, STEP_MS);
    }
  }, [pos, pin, reduceMotion]);

  useEffect(() => () => clearInterval(timer.current), []);

  return shown;
}

export { FIGS, STEP_MS, WALK };
