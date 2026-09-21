// Shared consequence copy for the alliance / war / backstab confirmations.
//
// These moves are all irreversible (or expensive to undo) and the spec is
// explicit that the UI must spell out the REAL numbers before a player
// commits — not a vague "this is a big deal" warning. Two places need the
// exact same sentence about the exact same move: the confirm panel a player
// opens from their OWN turn (PlayersSheet.jsx, proposing/declaring) and the
// overlay that lands on someone else's phone when they are asked to answer
// (DiplomacyOverlay.jsx). Keeping the copy here, built from the same
// constants src/Hooks/diplomacy.js exports, is what keeps those two screens
// from ever describing the same alliance two different ways.
import { fmt } from "./format";
import {
  ALLY_TAX,
  ALLY_UPKEEP,
  COMMISSION,
  TRAITOR_ROUNDS,
  TRAITOR_TAX,
  WAR_FEE,
  WAR_ROUNDS,
} from "../Hooks/diplomacy";

const pct = (n) => `${Math.round(n * 100)}%`;

export function allyBenefits() {
  return [
    "No rent between you, ever",
    `The bank pays you ${pct(COMMISSION)} commission whenever an outsider pays your ally rent`,
    "Still standing together at the end? You win together",
  ];
}

export function allyCosts() {
  return [
    `+${pct(ALLY_TAX - 1)} rent to every OTHER owner, for as long as you are allied`,
    `${fmt(ALLY_UPKEEP)} upkeep to the Free Parking pot at the start of every round`,
    "A forced charge neither of you can cover alone comes out of both your pockets",
    "Their wars become your wars — and a branded Traitor can never ally again",
  ];
}

export function warCosts() {
  return [
    `${fmt(WAR_FEE)} paid to the bank, right now`,
    "Double rent both ways between the two sides",
    `Lasts ${WAR_ROUNDS} full rounds, or until an early peace treaty`,
    "Your own ally is dragged in with you — and so is theirs",
  ];
}

export function backstabCosts(cutAmount) {
  return [
    `You take ${fmt(cutAmount)} from them right now — 15% of their cash — and the alliance ends`,
    "Once per game",
    "Branded Traitor for the rest of the game: you can never ally again",
    `+${pct(TRAITOR_TAX - 1)} rent to everyone for ${TRAITOR_ROUNDS} rounds`,
  ];
}
