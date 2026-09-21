// Client-side mirror of the diplomacy rules: alliances, wars and the
// backstab gambit. This is the CONTRACT file named in
// scratchpad/SPEC-DIPLOMACY.md -- its exported names and signatures are
// shared with the phone UI, the TV UI and the SQL agent, all working in
// parallel, so nothing here may be renamed or reshaped after the fact.
//
// Pure functions only, no React, no mutation of their arguments. Every
// function is defensive against a `game` that predates this feature: an old
// room row has no `alliances`/`wars`/`round` at all, and `game` itself can be
// null/undefined for a fresh board, so every read goes through `?.` and a
// fallback rather than assuming the shape exists.
//
// `game.round`, `game.alliances`, `game.allyOffers`, `game.wars` and
// `game.winners` are the state shapes the spec locks down; `player.traitor`,
// `player.traitorUntil` and `player.backstabUsed` live on each entry of the
// `players` array the same way `inJail`/`bankrupt` already do. See
// src/dev/mockSupabase.js for the verbs that mutate them and
// src/Hooks/rules.js's rentFor() for where rentMods() gets applied.

import { playerByFig } from "./rules";

// ---------------------------------------------------------------------------
// Constants. Numbers are the user's locked decisions (SPEC-DIPLOMACY.md §1-3),
// not tuning knobs -- change them only if that spec changes.
// ---------------------------------------------------------------------------
export const WAR_FEE = 500; // paid to the BANK, not the pot, to declare war
export const WAR_ROUNDS = 5; // a war lasts 5 full rounds absent an early peace
export const ALLY_UPKEEP = 50; // per allied player, into the pot, every round start
export const ALLY_TAX = 1.25; // +25% rent an allied player pays a non-ally owner
export const COMMISSION = 0.1; // the bank's cut to the OTHER ally when a non-ally pays rent
export const BACKSTAB_CUT = 0.15; // floor(15% of the ally's cash) the backstabber takes
export const TRAITOR_ROUNDS = 5; // how many rounds the backstabber's own +25% lasts
export const TRAITOR_TAX = 1.25; // the backstabber's own rent penalty while it lasts

// ---------------------------------------------------------------------------
// Alliances
// ---------------------------------------------------------------------------

// The figure `fig` is currently allied with, or null. One alliance per
// player, so this is always at most one answer.
export function allyOf(game, fig) {
  const alliances = game?.alliances;
  if (!Array.isArray(alliances) || !fig) return null;
  const pair = alliances.find((al) => al && (al.a === fig || al.b === fig));
  if (!pair) return null;
  return pair.a === fig ? pair.b : pair.a;
}

export function areAllies(game, a, b) {
  if (!a || !b || a === b) return false;
  return allyOf(game, a) === b;
}

// ---------------------------------------------------------------------------
// War
//
// Sides are never stored -- they are computed LIVE from the current
// alliances every time one of these is called, exactly as the spec requires
// ("forming or breaking an alliance mid-war changes the sides immediately").
// A war that has ended (peace, expiry, or a principal's bankruptcy) is
// removed from `game.wars` by the verb that ended it, so every function here
// only ever has to look at wars that are still live.
// ---------------------------------------------------------------------------

// { a: fig[], b: fig[] }, side A led by the declarer, side B by the target.
// A dragged-in ally shows up here even though they never declared anything.
export function warSides(game, war) {
  if (!war) return { a: [], b: [] };
  const aAlly = allyOf(game, war.declarer);
  const bAlly = allyOf(game, war.target);
  return {
    a: aAlly ? [war.declarer, aAlly] : [war.declarer],
    b: bAlly ? [war.target, bAlly] : [war.target],
  };
}

// Every war (declared or dragged into) `fig` is currently a side of.
export function warsOf(game, fig) {
  const wars = game?.wars;
  if (!Array.isArray(wars) || !fig) return [];
  return wars.filter((war) => {
    const sides = warSides(game, war);
    return sides.a.includes(fig) || sides.b.includes(fig);
  });
}

// The war (if any) that puts `a` and `b` on OPPOSITE sides right now -- true
// for two principals, and true for a dragged-in ally on either end too.
export function warBetween(game, a, b) {
  if (!a || !b || a === b) return null;
  const wars = game?.wars;
  if (!Array.isArray(wars)) return null;
  for (const war of wars) {
    const sides = warSides(game, war);
    const aSide = sides.a.includes(a) ? "a" : sides.b.includes(a) ? "b" : null;
    const bSide = sides.a.includes(b) ? "a" : sides.b.includes(b) ? "b" : null;
    if (aSide && bSide && aSide !== bSide) return war;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Backstab / traitor
// ---------------------------------------------------------------------------

// Is the +25% traitor penalty still active? `traitorUntil` is the round AT
// WHOSE START the penalty ends (0 = never branded, or it already lapsed), so
// this is a live comparison against `game.round` rather than a flag the
// round-start hook has to remember to clear.
export function isTraitorNow(game, player) {
  const round = Math.max(Number(game?.round) || 1, 1);
  const until = Number(player?.traitorUntil) || 0;
  return until > 0 && round < until;
}

// ---------------------------------------------------------------------------
// Guards. Both return { ok: true } or { ok: false, reason: "<human sentence>" }
// -- the phone/TV show `reason` verbatim, same convention as every other
// refusal in this codebase (see mockSupabase.js's thrown Error messages).
// ---------------------------------------------------------------------------

// `a` is always the CALLER (self): every message below reads "you"/"they"
// on that assumption, exactly matching the SQL's own mono_can_ally(st, fig,
// other_fig) -- "`fig` first, so every sentence that comes back says 'you'
// about the player who is tapping the button." Both ally_propose (a=me,
// b=target) and ally_accept (a=me, b=proposer) call it this way.
export function canAlly(game, players, a, b) {
  if (!a || !b) return { ok: false, reason: "That player is not in this room" };
  if (a === b) return { ok: false, reason: "You cannot ally with yourself" };
  const pa = playerByFig(players, a);
  const pb = playerByFig(players, b);
  if (!pa || !pb) return { ok: false, reason: "That player is not in this room" };
  if (pa.bankrupt) return { ok: false, reason: "You are bankrupt" };
  if (pb.bankrupt) return { ok: false, reason: "That player is bankrupt" };
  if (pa.traitor) return { ok: false, reason: "You are a traitor, nobody will ally with you" };
  if (pb.traitor) return { ok: false, reason: "They are a traitor, nobody will ally with them" };
  if (allyOf(game, a)) return { ok: false, reason: "You are already in an alliance" };
  if (allyOf(game, b)) return { ok: false, reason: "They are already in an alliance" };
  if (warBetween(game, a, b)) return { ok: false, reason: "You are on opposite sides of a war" };
  // Forming the pair merges their two war lists. One war between them is fine
  // (the newcomer simply joins it, which is only possible if it's the SAME
  // war -- two principals on the same side, already excluded above from
  // being on opposite sides); two DISTINCT wars is a player who would owe
  // double rent in both directions at once, which the rent rules cannot
  // express. So: count the union's DISTINCT war ids, not just "does each
  // have any war" -- the latter would wrongly refuse the one-shared-war case.
  const ids = new Set([...warsOf(game, a), ...warsOf(game, b)].map((w) => w.id));
  if (ids.size > 1) return { ok: false, reason: "That would put you in two wars at once" };
  return { ok: true };
}

// Mirrors war_declare's inline checks in the SQL dispatcher (there is no
// separate mono_can_declare_war -- this client-side helper exists so the UI
// can gray out the button before it ever calls the server).
export function canDeclareWar(game, players, from, target, money) {
  const pt = playerByFig(players, target);
  if (!target || !pt) return { ok: false, reason: "That player is not in this room" };
  if (target === from) return { ok: false, reason: "You cannot declare war on yourself" };
  if (pt.bankrupt) return { ok: false, reason: "That player is bankrupt" };
  if (areAllies(game, from, target)) {
    return { ok: false, reason: "You cannot declare war on your ally" };
  }
  if ((Number(money) || 0) < WAR_FEE) return { ok: false, reason: "Not enough money" };
  const fromAlly = allyOf(game, from);
  const targetAlly = allyOf(game, target);
  const sideA = fromAlly ? [from, fromAlly] : [from];
  const sideB = targetAlly ? [target, targetAlly] : [target];
  const already = [...sideA, ...sideB].some((fig) => warsOf(game, fig).length > 0);
  if (already) return { ok: false, reason: "Somebody here is already at war" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rent modifiers -- SPEC-DIPLOMACY.md "Rent, in one place", steps 2-5. Step 1
// (a jailed owner collects nothing) is NOT this function's job: it already
// short-circuits rent to 0 before diplomacy ever enters the picture (see
// rules.js's rentFor and mockSupabase's land()), so a caller that reaches
// here has already established there IS a rent to modify.
//
// All multiplicative, applied in the order the spec lists (war, then the
// payer's own alliance tax, then a lingering traitor brand), floored ONCE at
// the very end by the caller -- never inside this function, so a caller that
// chains this with other multipliers (there are none today) still only
// floors once.
// ---------------------------------------------------------------------------
export function rentMods(game, players, payerFig, ownerFig) {
  // Mirrors mono_rent_mods's own opening guard: no payer/owner, or a payer
  // who somehow owns the cell they are standing on, is a plain unmodified
  // rent -- land() never actually calls this that way (it has already
  // checked `owner && owner !== fig`), but this keeps the two answers
  // identical for whatever else reads this pure function.
  if (!payerFig || !ownerFig || payerFig === ownerFig) return { mult: 1, zero: false, mods: [] };
  // Allies never pay each other rent, full stop -- this overrides every
  // other multiplier rather than composing with them.
  if (areAllies(game, payerFig, ownerFig)) return { mult: 1, zero: true, mods: [] };

  let mult = 1;
  const mods = [];
  if (warBetween(game, payerFig, ownerFig)) {
    mult *= 2;
    mods.push("war");
  }
  // "target on your back": being IN an alliance costs +25% to everyone who
  // is not that ally -- the owner already failed areAllies() above, so
  // reaching here means whatever ally the payer has (if any) is not this
  // owner.
  if (allyOf(game, payerFig)) {
    mult *= ALLY_TAX;
    mods.push("allyTax");
  }
  const payer = playerByFig(players, payerFig);
  if (isTraitorNow(game, payer)) {
    mult *= TRAITOR_TAX;
    mods.push("traitor");
  }
  return { mult, zero: false, mods };
}
