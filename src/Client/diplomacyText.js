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

// ---------------------------------------------------------------------------
// "Show 1 time after accepting" (complaint C): the full benefits/costs
// explainer above is a wall of eight short sentences, worth reading once and
// a repetitive wall every confirm after that. Two independent devices need
// the SAME "have I seen this" answer — the phone that proposes/declares and
// the phone that only ever receives/gets dragged in — so the flag lives in
// localStorage, keyed by device rather than by room or player, and it is
// asked at OPEN time (a panel that was shown and then cancelled still counts
// as shown; the point is whether the player has read it, not whether they
// went through with the move).
//
// Every access is wrapped in try/catch: a private tab, a full quota or a
// browser that simply refuses storage must not take the confirm panel down
// with it — the safe failure is "the full explainer shows every time",
// exactly what every device saw before this existed.
// ---------------------------------------------------------------------------
const LS_SEEN_ALLY = "mono_diplo_seen_ally_v1";
const LS_SEEN_WAR = "mono_diplo_seen_war_v1";

function readSeen(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSeen(key) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage unavailable — the explainer just keeps showing in full, which
       is the same experience every device had before this feature existed */
  }
}

export const hasSeenAllyExplainer = () => readSeen(LS_SEEN_ALLY);
export const markSeenAllyExplainer = () => writeSeen(LS_SEEN_ALLY);
export const hasSeenWarExplainer = () => readSeen(LS_SEEN_WAR);
export const markSeenWarExplainer = () => writeSeen(LS_SEEN_WAR);

// The one-line version of allyBenefits()/allyCosts(), for every confirm after
// the first: the three numbers that actually change a decision, nothing else.
export function allySummaryLine() {
  return `No rent between you · +${pct(ALLY_TAX - 1)} to others · ${fmt(ALLY_UPKEEP)}/round`;
}

// The one-line version of warCosts(), same idea.
export function warSummaryLine() {
  return `${fmt(WAR_FEE)} · double rent both ways · ${WAR_ROUNDS} rounds · allies join`;
}

// ---------------------------------------------------------------------------
// One-time "what just changed for me" cards (also complaint C): shown once
// per FORMATION/DECLARATION, from the live event feed — not a localStorage
// flag, because these are not "have you ever seen this explainer" but "did
// THIS alliance/war just start". See ClientScreen.jsx's feed effect, which
// keys them off `reveal.feed` the same way the backstab alert is — a batch
// that only ever arrives once, live, and never again on a reload or resync.
// ---------------------------------------------------------------------------

// Reuses allyBenefits()/allyCosts() verbatim: "what changed for you" IS the
// benefits-and-costs list, just read in the past tense by the card's own
// heading rather than repeated here as a third copy of the same eight lines.

// The war-started card's body. Deliberately NOT warCosts(): that list opens
// with "500$ paid to the bank, right now", which is true of the declarer and
// false of the target and of either dragged-in ally — none of whom paid a
// cent to end up here. `draggedIn` swaps the last line for the one sentence
// that actually explains how a player who declared nothing ended up in a war.
export function warStartedLines({ draggedIn }) {
  return [
    "Double rent both ways between the two sides",
    `Lasts ${WAR_ROUNDS} full rounds, or until an early peace treaty`,
    draggedIn
      ? "Only the two who started it can offer peace — you ride it out with your ally"
      : "Your ally is dragged in with you — and so is theirs",
  ];
}

// The victim's alert (complaint B): what was taken is said right next to the
// amount box in DiplomacyOverlay, so this is only the consequence line —
// the one fact that is NOT already on screen elsewhere.
export function backstabAlertLines() {
  return [
    "Your alliance is over.",
    `They are branded Traitor: +${pct(TRAITOR_TAX - 1)} rent to everyone for ${TRAITOR_ROUNDS} rounds.`,
  ];
}
