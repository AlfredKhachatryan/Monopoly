// Drop-in replacement for src/Hooks/supabase.jsx, used only by the offline
// client preview harness (client-harness.html -> src/dev/clientHarness.jsx).
//
// vite.config.js's mockSupabasePlugin swaps this file in for
// src/Hooks/supabase.jsx, but only when running `npm run dev:mock`
// (serve + VITE_MOCK=1) -- never for `npm run dev` and never for
// `npm run build`. See that file for how the swap is gated.
//
// It exposes the same five names src/Hooks/useGameRoom.js (and the rest of
// the app) imports from "./supabase" -- useFetch, fetchRoom, gameAction,
// createGame, useRealtimeUpdates -- backed by a single in-memory room instead
// of a network call, plus a `mockDev` namespace (not part of the real
// module) that the harness toolbar uses to switch scenarios and inject live
// events.
//
// It is not a rules engine: it reuses the exact rent/build math the client
// already trusts from src/Hooks/rules.js, and copies event *shapes* from
// supabase/migrations/20260918140000_game_rules.sql (mono_* helpers),
// 20260918160000_game_log.sql (the `game.log` field) and
// 20260920170000_casino_farm_rebalance.sql (the pot, the farm counter, the
// casino and the jailed-landlord rule) so anything reading `game.events` /
// `game.log` sees the same JSON it would from the real RPC.
// Card decks are a small hand-picked subset (9 Chance, 6 Community), not the
// full 15/16 from the SQL -- enough to exercise every card `kind` at least
// once, `back` excepted (no scenario needs it yet).
//
// WHAT THE 2026-09-20 REBALANCE ADDED HERE, all of it mirroring that
// migration rather than inventing anything:
//   * `game.pot`      the Free Parking pot. Tax, Luxury Tax and every card
//                     that fines you to the bank pile up on it; landing on
//                     cell 21 takes the lot. A pot of 0 is silent. See potBox.
//   * jail blocks rent  a landlord in jail collects NOTHING, and a `rentFree`
//                     event says so rather than leaving a silent gap.
//   * `board["28"].income`  the Weed Farm's counter. It lives on the CELL, so
//                     it follows the deed through a trade or a bankruptcy.
//   * `casino_play`   the one new verb, and the new phase 'casino' that makes
//                     landing on cell 13 mandatory. THE RANDOMNESS IS HERE
//                     (casinoSpin), never on the client -- the phone only
//                     animates the result that comes back.
//   * START_BONUS 150 and the retargeted Chance card (mc9), which used to be
//                     "advance to the nearest utility" and is now "advance to
//                     the Casino".
//
// WHAT SPEC-DIPLOMACY.md (scratchpad, 2026-09-21) ADDED HERE -- alliances,
// war and the backstab gambit, mirroring that spec rather than inventing
// anything of its own:
//   * `game.round`    every game now counts rounds (starts 1), bumped ONCE at
//                     the tail of applyAction() when the turn actually moved
//                     during this action AND landed on the first still-active
//                     player in turn order -- checked there rather than at
//                     every nextTurn() call site (there are four) so a round
//                     can never be double-counted or missed. That wrap is
//                     also the "start of round" hook: ally upkeep, war
//                     expiry and traitor-brand expiry all run there. See the
//                     round-tick block in applyAction()/runStartOfRound().
//   * `game.alliances`/`game.allyOffers`/`game.wars`/`game.winners`  the
//                     diplomacy layer's own state, read/written through the
//                     module-level `diplo` box below for the same reason
//                     `potBox` exists: charge() is the one funnel for every
//                     forced charge and is called a dozen places deep, and it
//                     is the only place that can decide "does the payer have
//                     an ally who can cover this" (the shared-debts rule).
//   * `player.traitor`/`traitorUntil`/`backstabUsed`  live on each seat like
//                     `inJail`/`bankrupt` already do.
//   * `rentMods()` from src/Hooks/diplomacy.js is applied inside land()'s
//                     rent branch: no rent between allies, double rent across
//                     a war, +25% for the payer's own alliance tag, +25% for
//                     a lingering traitor brand -- multiplied together and
//                     floored once, mirroring rules.js's rentFor() exactly.
//   * nine new verbs (ally_propose/accept/decline/cancel/break, war_declare,
//                     peace_propose/accept/decline, backstab), all guarded
//                     the same way every other verb in this file is: "own
//                     turn" means your turn and phase roll/act, refused
//                     during an auction or a casino bet -- except the four
//                     "any time" verbs (ally_accept/decline/cancel,
//                     peace_accept/decline), which are added to those two
//                     phase allow-lists so an incoming offer can still be
//                     answered while an unrelated auction or bet is live.
//   * bots decline every alliance proposal and accept every peace offer put
//                     to them, on the same "must never hang the room" timer
//                     pattern as scheduleAuctionBotIfNeeded/
//                     scheduleTradeBotIfNeeded -- see scheduleAllyBotIfNeeded/
//                     schedulePeaceBotIfNeeded. A bot never declares war,
//                     which needs no code: nothing in this file ever calls
//                     war_declare on a bot's behalf.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeConnection } from "../Hooks/connection";
import {
  ownerOf,
  cellKind,
  priceOf,
  rentFor,
  canBuild,
  farmIncome,
  FARM_INCOME_START,
  FARM_INCOME_STEP,
  FIGS,
  JAIL_FINE,
  MAX_PLAYERS,
  START_BONUS,
} from "../Hooks/rules";
import {
  allyOf,
  areAllies,
  warSides,
  canAlly,
  canDeclareWar,
  rentMods,
  WAR_FEE,
  WAR_ROUNDS,
  ALLY_UPKEEP,
  COMMISSION,
  BACKSTAB_CUT,
  TRAITOR_ROUNDS,
} from "../Hooks/diplomacy";
import {
  SCENARIOS,
  SCENARIO_NAMES,
  DEFAULT_SCENARIO,
  TV_SCENARIO_NAMES,
  DEFAULT_TV_SCENARIO,
  LOGIN_SCENARIO_NAMES,
  DEFAULT_LOGIN_SCENARIO,
  ROOM_UUID,
  ME_PLAYER_ID,
  ME_FIGURE,
} from "./scenarios";

// ---------------------------------------------------------------------------
// Seats and figures. Mirrors supabase/migrations/20260920100000_six_players.sql
// VERBATIM: eight selectable figures, six seats. The two spare figures exist so
// the sixth player to pick still has a choice -- they are not extra seats.
// Ownership lives per cell in `bought`, so every cell carries all eight keys.
// ---------------------------------------------------------------------------

// FIGS / MAX_PLAYERS come from src/Hooks/rules.js so the mock can never drift
// from the client's own idea of the figure list. Re-exported under the local
// name this file already used.
export const FIGURES = FIGS;
export { MAX_PLAYERS };

// Player names the mock's stand-in seats use, one per figure. fig0..fig3 keep
// the four the harness has always shown; fig4..fig7 are named after their
// figures (Bat / Mummy / Octo / Slime, see src/Client/figures.js).
const BOT_NAMES = {
  fig0: "Ero",
  fig1: "Afo",
  fig2: "Koli",
  fig3: "Gaya",
  fig4: "Bat",
  fig5: "Mummy",
  fig6: "Octo",
  fig7: "Slime",
};

// Grep dist/ for this after `npm run build` to prove the mock never ships.
export const MOCK_SUPABASE_MARKER = "MONOPOLY_MOCK_SUPABASE_v1";
// eslint-disable-next-line no-console
console.info(`[mock] ${MOCK_SUPABASE_MARKER} -- offline client preview backend is active`);

// ---------------------------------------------------------------------------
// Module state: one room, a set of realtime listeners, one pending bot loop.
// ---------------------------------------------------------------------------

let room = null; // the current row, as fetchRoom/realtime deliver it
let listeners = new Set(); // (payload) => void, mimics postgres_changes callbacks
let fetchMode = "normal"; // "normal" | "hang" | "error"
// Simulated network cut, driven by window.__mockConn.drop() / .restore(). While
// it is on: no realtime event is delivered, every open channel is told
// CHANNEL_ERROR, and fetchRoom/gameAction fail the way a dead Wi-Fi link makes
// them fail (error.network === true), so the whole reconnect path in
// src/Hooks/connection.js runs for real in the harness.
let mockDropped = false;
let mockChannels = new Set(); // stand-in for supabase.getChannels()
let mockOpened = 0; // lifetime count of subscriptions opened, for leak checks
let pendingActionError = null; // one-shot message the next gameAction() call rejects with
let autoplayToken = 0; // bumped on every loadScenario() to cancel a running bot loop

// Auction/trading bot scheduling. One pending timer of each kind at a time --
// a fresh auction/trade turn always supersedes whatever was queued before it.
// Each entry is { timer, key, run } so "force bot to move now" (the dev
// toolbar) can cancel the wait and invoke the same decision immediately.
let pendingAuctionBotTimer = null;
let pendingTradeBotTimer = null;
// Same idea for a BOT that landed on the Casino: the bet is mandatory, so a
// bot left standing there would hold the room in phase 'casino' forever.
let pendingCasinoBotTimer = null;
// Same idea again, this time for the two diplomacy offers a bot can be asked
// to answer: an incoming alliance proposal (always declined) and an incoming
// peace offer on a war it is a principal of (always accepted). See
// scheduleAllyBotIfNeeded()/schedulePeaceBotIfNeeded() near the other bot
// brains below.
let pendingAllyBotTimer = null;
let pendingPeaceBotTimer = null;
// Each bot's private ceiling for the auction it is currently in, keyed by
// "<cell>|<figure>" so it stays the same across that bot's repeated turns in
// one auction but is free to differ next time. Cleared on scenario switch.
let auctionBotLimits = {};
// A scenario can override the bots'-answer delay for the trade it seeds
// (e.g. `trade-outgoing` wants a long wait so the banner can be
// screenshotted); null means "use the normal ~1.5s".
let tradeBotDelayMs = null;

const clone = (x) => JSON.parse(JSON.stringify(x));
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// Latency knob (dev only).
//
// The mock answers an action in 120-240ms, which is a fast, very even network
// and never exercises the phone's OPTIMISTIC roll path properly -- the dice
// there start on the tap and resolve onto whatever the server eventually says,
// so the interesting cases are "the answer beat the dice" (lag 0) and "the
// answer was late" (lag 2000). `?lag=<ms>` pins the reply time so those can be
// driven deliberately; `window.mockDev.setLag(ms)` does the same at runtime,
// and `null` puts the normal jitter back.
// ---------------------------------------------------------------------------
function readLagParam() {
  try {
    const raw = new URLSearchParams(window.location.search).get("lag");
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
let actionLag = typeof window === "undefined" ? null : readLagParam();
const actionDelay = () => (actionLag == null ? 120 + Math.random() * 120 : actionLag);

// ---------------------------------------------------------------------------
// Linked-mode bridge (tv-harness.html?phone=1 -> a TV iframe + a phone
// iframe, see TESTING.md "Offline TV preview" / this file's doc comment).
// Two same-origin iframes each load this module fresh -- an iframe is its
// own JS realm even on the same origin, so there is no shared `room`
// variable between them unless something copies it across by hand. That is
// all this section does. It is inert (no channel, no listeners, zero
// overhead) until a harness calls enableLinkBridge(), which only the linked
// pair's two pages ever do -- every other scenario/page is untouched.
//
// The phone iframe is always the AUTHORITY: it runs the one real
// applyAction/bot pipeline and publishes every row it produces. The TV
// iframe is a FOLLOWER: it never runs applyAction against its own local
// `room` while linked -- it only overwrites `room` with whatever the
// authority publishes, and forwards its own action attempts (skip_turn,
// new_game, ...) to the authority instead of running them locally (see the
// `linkRole === "follower"` branch of the exported gameAction() below).
// ---------------------------------------------------------------------------
const LINK_KEY = "monopoly-mock-link-v1";
let linkChannel = null;
let linkRole = null; // "authority" | "follower" | null

function linkSend(msg) {
  const payload = { ...msg, _t: Date.now(), _r: Math.random() };
  try {
    linkChannel?.postMessage(payload);
  } catch {
    /* channel gone (page unloading) -- the storage fallback below still fires */
  }
  try {
    // A same-key write is what fires the `storage` event on OTHER same-origin
    // documents (never on this one), so this doubles as a cross-browser
    // fallback for whenever BroadcastChannel is unavailable.
    localStorage.setItem(LINK_KEY, JSON.stringify(payload));
  } catch {
    /* private browsing / storage disabled: BroadcastChannel alone still works */
  }
}

function handleLinkMessage(msg) {
  if (!msg || !linkRole) return;
  if (linkRole === "follower" && msg.type === "row") {
    // Apply verbatim -- no afterStateChange(), no local bot timers. The
    // authority owns every bit of game logic; this side only ever mirrors it.
    room = msg.row ? clone(msg.row) : null;
    for (const fn of listeners) {
      try {
        fn({ new: room ? clone(room) : null });
      } catch {
        /* a bad subscriber should not break the mirror */
      }
    }
    return;
  }
  if (linkRole === "authority" && msg.type === "action") {
    gameAction(msg.uuid, msg.action, msg.payload || {}).catch(() => {});
    return;
  }
  if (linkRole === "authority" && msg.type === "request_sync" && room) {
    linkSend({ type: "row", row: clone(room) });
  }
}

// Called once by tv-harness.jsx (role "follower") or client-harness's
// clientHarness.jsx (role "authority") when the page was opened as one half
// of a linked pair. Never called by a normal single-page scenario.
export function enableLinkBridge(role) {
  if (linkRole) return; // idempotent: a scenario switch must not open a 2nd channel
  linkRole = role;
  if (typeof BroadcastChannel !== "undefined") {
    linkChannel = new BroadcastChannel(LINK_KEY);
    linkChannel.onmessage = (ev) => handleLinkMessage(ev.data);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (ev) => {
      if (ev.key !== LINK_KEY || !ev.newValue) return;
      try {
        handleLinkMessage(JSON.parse(ev.newValue));
      } catch {
        /* not our message shape */
      }
    });
  }
  if (role === "authority" && room) {
    linkSend({ type: "row", row: clone(room) }); // catch up a TV that is already waiting
  }
  if (role === "follower") {
    linkSend({ type: "request_sync" }); // in case the phone loaded first and is already live
  }
}

// How long the "socket" takes to deliver an UPDATE, in ms. 0 = synchronous,
// which is what the mock has always done and what every existing scenario
// still gets. See `mockConn.latency()` for why this knob exists.
let realtimeLatency = 0;

// How long the RPC's RETURN leg takes: the gap between the server committing
// our action and our own reply landing back on this phone. 0 = the reply is
// handed back in the same tick as the commit, which is what the mock has
// always done -- and which is precisely why it could not model the window a
// real round trip leaves open, where a resync issued by somebody else's timer
// can read the committed row and adopt it before our own reply arrives.
let replyLag = 0;

function emit(newRow) {
  // The commit is ALWAYS synchronous: `room` is the table, and a fetch issued
  // one millisecond after an action must already see the new row, exactly as
  // it would against Postgres. Only the DELIVERY of the change event can lag,
  // which is the whole point of the knob.
  room = newRow;
  const deliver = () => {
    // Read `listeners` at fire time, not at emit time: a channel torn down
    // during the delay must not be called, and one opened during it is a real
    // subscriber by then.
    for (const fn of listeners) {
      try {
        fn({ new: clone(newRow) });
      } catch {
        /* a bad subscriber should not break the room */
      }
    }
  };
  if (realtimeLatency > 0) setTimeout(deliver, realtimeLatency);
  else deliver();
  if (linkRole === "authority") linkSend({ type: "row", row: clone(newRow) });
}

// Follower-only helper (see gameAction()'s `linkRole === "follower"` branch):
// hands one action attempt to the authority instead of running it here.
function linkForwardAction(uuid, action, payload) {
  linkSend({ type: "action", uuid, action, payload });
}

// ---------------------------------------------------------------------------
// Small card decks. Shapes match mono_deck() in the SQL migration.
// ---------------------------------------------------------------------------

// mc5/mc6 and mk5 copy `kind`, amounts and text VERBATIM from cards c14, c10
// and k9 in supabase/migrations/20260918140000_game_rules.sql, so payEach /
// repairs / collectEach -- the only three card kinds that move money for
// more than one player at once -- can be exercised here too.
const CHANCE_DECK = [
  { id: "mc1", kind: "collect", amount: 50, text: "Bank pays you a dividend of $50." },
  { id: "mc2", kind: "pay", amount: 15, text: "Speeding fine. Pay $15." },
  { id: "mc3", kind: "jailCard", text: "Get Out Of Jail Free. Keep this card until you need it." },
  // The Start bonus is 150 now (spec §1), and mono_deck rewrote every card
  // text that promised 200 for the same reason this one is rewritten: the
  // phones print the text verbatim, so a card that says $200 is the server
  // lying to the table through the client.
  { id: "mc4", kind: "moveTo", cell: 1, text: "Advance to Старт. Collect $150." },
  { id: "mc5", kind: "payEach", amount: 50, text: "You have been elected chairman of the board. Pay each player $50." },
  {
    id: "mc6",
    kind: "repairs",
    house: 25,
    hotel: 100,
    text: "Make general repairs on all your property: $25 per house, $100 per hotel.",
  },
  // c9 in the SQL. Both decks carry BOTH a goJail and a jailCard there, so
  // both carry both here: the jail/doubles harness scenarios have to be able
  // to reach every jail entrance and exit from either deck.
  { id: "mc7", kind: "goJail", text: "Go directly to Jail. Do not pass Start, do not collect $200." },
  // mc8/mc9 are c5 and c4 in the SQL, texts VERBATIM. They are APPENDED rather
  // than slotted in next to the other movement cards on purpose: the previous
  // session's scratch drivers and both handoff documents name Chance cards by
  // their numeric index (`__forceCard: { deck: 'chance', index: 5 }` is the
  // repairs card and has to stay the repairs card), so renumbering would
  // silently retarget every one of those scripts at a different card.
  //
  // WHY THESE TWO MATTER MORE THAN THEIR SIZE SUGGESTS. `nearest` is the only
  // card kind that puts a player onto a railroad or a utility WITHOUT a
  // roll-and-land sequence: the roll lands on a Chance cell, and the card then
  // moves the token a second time inside the SAME action, so one `game.events`
  // batch carries two `move`s and two `land`s. Everything on the phone that
  // decides "am I standing somewhere I could buy" has to read the LAST of those
  // two landings, not the first -- which is exactly the class of mistake the
  // "I cannot buy the second Railroad" report turned out to be.
  //
  // Note the SQL's `what` is a mono_cell_kind(), not a colour or a group name.
  // After the rebalance 'road' is the ONLY kind `nearest` is still used for:
  // the two utilities are gone, so there is nothing to be "nearest" to on the
  // other side of that branch.
  { id: "mc8", kind: "nearest", what: "road", text: "Advance to the nearest railroad. If it is owned, pay double rent." },
  // Was "advance to the nearest utility... pay 10 times your dice", which is
  // now three impossible things in one card: there are no utilities, there is
  // no utility rent branch, and `util_mult` does not exist. The SQL RETARGETED
  // it rather than deleting it (mono_deck's c4), so the Chance deck keeps its
  // fifteen cards and its odds — and so does this one, at the same index 8,
  // because the harness scripts and both handoff documents address Chance
  // cards by numeric index (`__forceCard: { deck:'chance', index:5 }` is the
  // repairs card and has to stay the repairs card).
  //
  // `what` rather than a hard-coded 13: mono_deck resolves the target with
  // mono_cell_of_kind(board,'casino') so a re-laid board still works, and the
  // moveTo branch below does the same. Landing there opens the mandatory bet
  // exactly as a rolled landing does — which is the whole point of the card.
  {
    id: "mc9",
    kind: "moveTo",
    what: "casino",
    text: "The house misses you. Advance to the Casino and place a bet.",
  },
];

const COMMUNITY_DECK = [
  { id: "mk1", kind: "collect", amount: 100, text: "Life insurance matures. Collect $100." },
  { id: "mk2", kind: "pay", amount: 50, text: "Doctor's fee. Pay $50." },
  { id: "mk3", kind: "goJail", text: "Go directly to Jail. Do not pass Start, do not collect $200." },
  { id: "mk4", kind: "collect", amount: 20, text: "Income tax refund. Collect $20." },
  { id: "mk5", kind: "collectEach", amount: 10, text: "It is your birthday. Collect $10 from every player." },
  // k5 in the SQL -- see the note on mc7 above.
  { id: "mk6", kind: "jailCard", text: "Get Out Of Jail Free. Keep this card until you need it." },
];

function drawCard(deck, forceIndex) {
  const cards = deck === "chance" ? CHANCE_DECK : COMMUNITY_DECK;
  const i = Number.isInteger(forceIndex) ? forceIndex : Math.floor(Math.random() * cards.length);
  return cards[Math.max(0, Math.min(i, cards.length - 1))];
}

// ---------------------------------------------------------------------------
// mono_*-style helpers. Unlike the SQL they mutate `players`/`board` in
// place (plain JS objects freshly cloned per action) instead of threading an
// immutable jsonb value through -- same result, much less ceremony.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The Free Parking pot, and why it is a module-level box.
//
// mono_charge() adds a fine to `game.pot` by reaching into the same immutable
// `st` value it is already threading (`jsonb_set(st, '{game,pot}', …)`). The
// mock's helpers mutate plain objects instead and none of them is handed the
// game block — charge() takes players/board/events and nothing else, and it is
// called from a dozen places, several of them two calls deep inside
// applyCard(). Threading a new argument through all of them to carry ONE
// integer would be a much bigger edit than the rule deserves.
//
// So the running total lives here, reset at the top of every applyAction() and
// read back by finalize(). That is safe for exactly the reason it would not be
// on the server: applyAction is synchronous from end to end and there is one
// room, so no two actions can ever be inside it at the same time.
//
// WHICH MONEY LANDS HERE is the same three reasons the SQL lists, and for the
// same reason they live in one place rather than at the call sites: a charge
// with a creditor is somebody's income, and a charge to the bank for a jail
// fine, a deed, a house or a losing bet is a price, not a penalty. Only a FINE
// goes to Free Parking.
const POT_REASONS = ["tax", "card", "repairs"];
let potBox = { value: 0 };

// ---------------------------------------------------------------------------
// Diplomacy: alliances, wars, backstab (SPEC-DIPLOMACY.md), and why THIS is
// a module-level box too.
//
// `diplo.alliances`/`allyOffers`/`wars`/`round` are exactly the shape
// src/Hooks/diplomacy.js's helpers expect as their `game` argument, so
// `diplo` itself is passed straight into allyOf()/areAllies()/warBetween()/
// rentMods()/canAlly()/canDeclareWar() wherever this file needs an answer.
//
// It exists as a box for the identical reason potBox does, immediately
// above: charge() is the one funnel for every FORCED charge (rent, tax, card
// fine, jail fee, repairs) and is called a dozen places deep, several of
// them two calls inside applyCard() -- and it is the only place that can
// decide "does the payer have an ally who can cover the shortfall" (the
// shared-debts rule). Threading `game.alliances` through every one of those
// call sites would be a much bigger edit than the rule deserves.
//
// Reset at the top of every applyAction() from the previous row, mutated in
// place by the verbs and by charge()/bankrupt()/land(), and read back by
// finalize() -- safe for the same reason potBox is safe: applyAction is
// synchronous end to end and there is one room.
let diplo = { alliances: [], allyOffers: [], wars: [], round: 1, winners: null };

// Removes `fig`'s alliance (if any) and reports it with the dissolve reason
// the spec's state shape enumerates ('upkeep' | 'bankrupt' | 'left'). A
// voluntary ally_break fires its own `ally, stage:'break'` event instead --
// this is only for the three ways an alliance ends WITHOUT either side
// choosing to. Mirrors mono_ally_dissolve(st, fig, reason).
function dissolveAllianceOf(fig, reason, events) {
  const idx = diplo.alliances.findIndex((al) => al.a === fig || al.b === fig);
  if (idx < 0) return;
  const al = diplo.alliances[idx];
  diplo.alliances.splice(idx, 1);
  events.push({ type: "ally", stage: "dissolve", a: al.a, b: al.b, reason });
}

// Drops every pending offer that touches `fig`, silently (the caller's own
// event -- form, backstab, leave -- already explains why). Mirrors
// mono_ally_offers_purge(st, fig): called after an alliance forms (both new
// members' other conversations are dead), after a backstab (the brand makes
// every proposal impossible) and on leave.
function purgeAllyOffersOf(fig) {
  diplo.allyOffers = diplo.allyOffers.filter((o) => o.from !== fig && o.to !== fig);
}

// Ends every war `fig` is a PRINCIPAL in (declarer or target) -- an ally
// merely dropping off a side ends nothing, the war is between the two who
// declared it; warSides() already reads alliances live so a dropped ally
// stops taking double rent on their own. Mirrors mono_wars_end_for(st, fig,
// reason).
function endWarsOf(fig, reason, events) {
  const toEnd = diplo.wars.filter((w) => w.declarer === fig || w.target === fig);
  for (const w of toEnd) {
    diplo.wars = diplo.wars.filter((x) => x.id !== w.id);
    events.push({ type: "war", stage: "end", warId: w.id, reason });
  }
}

// Post-action diplomacy reconciliation (mirrors the SQL's own comment
// verbatim): "A bankruptcy can happen anywhere inside a landing -- a card
// that charges every player, a rent that an ally could not cover -- so this
// is swept up here rather than at each of those call sites." Called once,
// at the tail of applyAction()/simulateActorStep(), after every other branch
// of the action has already run -- NOT inline inside bankrupt() itself,
// because a mid-action dissolve there would (incorrectly) stop a LATER charge
// in the same action from still reaching that ally for a share of a
// different debt. A bankrupt player's alliance dissolves, every war they
// were a PRINCIPAL in ends, and their pending proposals go with them.
function reconcileDiplomacyBankruptcies(players, events) {
  for (const p of players) {
    if (!p.bankrupt) continue;
    dissolveAllianceOf(p.figure, "bankrupt", events);
    endWarsOf(p.figure, "bankrupt", events);
    purgeAllyOffersOf(p.figure);
  }
}

// Start-of-round ally upkeep (spec §1, and mono_round_tick's step 1 in the
// SQL): every allied player owes $50 to the pot. Billed in SEAT ORDER, one
// at a time, NOT simultaneously -- if the first member cannot pay (or is
// already bankrupt), the alliance dissolves and the second is never billed
// at all; if the first pays and the SECOND cannot, the alliance still
// dissolves but the first's $50 is NOT refunded ("the bill was for the round
// the alliance was alive at the start of," verbatim from the SQL comment).
// This is deliberately NOT routed through charge(): upkeep must never
// bankrupt anyone or pull a shared debt from the other member's own pocket,
// it dissolves the pair instead the moment either one comes up short.
function collectAllyUpkeep(players, events) {
  const survivors = [];
  for (const al of diplo.alliances) {
    let a = players.find((p) => p.figure === al.a);
    let b = players.find((p) => p.figure === al.b);
    if (!a || !b) {
      events.push({ type: "ally", stage: "dissolve", a: al.a, b: al.b, reason: "left" });
      continue;
    }
    if (a.order > b.order) [a, b] = [b, a];
    let dissolved = false;
    for (const k of [a, b]) {
      if (k.bankrupt) {
        events.push({ type: "ally", stage: "dissolve", a: al.a, b: al.b, reason: "bankrupt" });
        dissolved = true;
        break;
      }
      if (k.money < ALLY_UPKEEP) {
        events.push({ type: "ally", stage: "dissolve", a: al.a, b: al.b, reason: "upkeep" });
        dissolved = true;
        break;
      }
      k.money -= ALLY_UPKEEP;
      potBox.value += ALLY_UPKEEP;
      events.push({ type: "pay", figure: k.figure, to: null, amount: ALLY_UPKEEP, reason: "allyUpkeep", cell: null });
      events.push({ type: "allyUpkeep", figure: k.figure, amount: ALLY_UPKEEP });
    }
    if (!dissolved) survivors.push(al);
  }
  diplo.alliances = survivors;
}

// The "start of a round" hook, in the SQL's own order: upkeep, then war
// expiry, then traitor-brand expiry (mono_round_tick's three numbered
// steps). Called once from the round-tick check at the tail of applyAction(),
// never per turn-advance -- see that check for how "a round ends" is
// detected (turn wrapped back to the first still-active seat).
function runStartOfRound(players, events) {
  collectAllyUpkeep(players, events);
  const expired = diplo.wars.filter((w) => diplo.round >= w.endsRound);
  for (const w of expired) {
    diplo.wars = diplo.wars.filter((x) => x.id !== w.id);
    events.push({ type: "war", stage: "expire", warId: w.id });
  }
  for (const p of players) {
    const until = Number(p.traitorUntil) || 0;
    if (until > 0 && diplo.round >= until) {
      p.traitorUntil = 0;
      events.push({ type: "traitor", stage: "expire", figure: p.figure });
    }
  }
}

// The seat order the round wraps back to: the smallest `order` among
// still-active (non-bankrupt) players, or null with nobody seated. Mirrors
// mono_first_active(players).
function firstActiveOrder(players) {
  const activeOrders = players.filter((p) => !p.bankrupt).map((p) => p.order);
  return activeOrders.length > 0 ? Math.min(...activeOrders) : null;
}

function credit(players, idx, amount, reason, events) {
  if (idx == null || !amount || amount <= 0) return;
  players[idx].money += amount;
  events.push({ type: "collect", figure: players[idx].figure, amount, reason });
}

function transferAssets(board, fig, toFig) {
  for (const key of Object.keys(board)) {
    const cell = board[key];
    if (cell.bought && cell.bought[fig]) {
      cell.bought[fig] = false;
      if (toFig) cell.bought[toFig] = true;
      if (cellKind(cell) === "street") cell.houses = 0;
    }
  }
}

function bankrupt(players, board, idx, toIdx, reason, amount, events) {
  const fig = players[idx].figure;
  const toFig = toIdx != null ? players[toIdx].figure : null;
  if (toIdx != null) {
    players[toIdx].money += players[idx].money;
    players[toIdx].jailCards = (players[toIdx].jailCards || 0) + (players[idx].jailCards || 0);
  }
  transferAssets(board, fig, toFig);
  players[idx].money = 0;
  players[idx].bankrupt = true;
  players[idx].inJail = false;
  players[idx].jailTurns = 0;
  players[idx].jailCards = 0;
  events.push({ type: "bankrupt", figure: fig, to: toFig, reason, amount });
  // NOT dissolving the alliance / ending the war here on purpose: the SQL's
  // own comment explains why (see reconcileDiplomacyBankruptcies() above) --
  // this runs once, for every bankrupt player, at the very end of the whole
  // action, not inline at the moment any one charge tips them over. Doing it
  // here would stop a LATER charge in the same action from still reaching
  // this player's ally for an unrelated shared debt.
}

// Reasons that can share a shortfall with an ally (spec §1's "anything that
// today can bankrupt": rent, tax, a card fine, repairs, the jail fee).
// Mirrors mono_charge's `forced` flag exactly. Voluntary spending -- buying,
// building, a bid, a casino bet, the war fee, a peace payment, backstab's
// cut -- never reaches this list, either because it never calls charge() at
// all (buy/build/auction bid are direct money edits) or because its own call
// site has already guaranteed affordability before charge() is ever called
// (casino_play, war_declare), so the shared-debt branch below is structurally
// unreachable for them regardless.
const FORCED_CHARGE_REASONS = ["rent", "tax", "card", "repairs", "jailFee"];

// `mods`, the 9th argument, is the diplomacy layer's `rentMods().mods` array.
// land() always passes one for a rent charge (even `[]`, when no modifier
// applies) and every other caller omits it -- mirrors mono_charge's `mods
// jsonb default null`, where only mono_land ever supplies a real value.
//
// Returns the amount that actually reached `toIdx` (0 when there is no
// creditor, e.g. a tax or a jail fee): land()'s rent commission needs to know
// what was ACTUALLY paid, which is the full amount in the normal and
// shared-debt cases but only whatever cash the payer had left in the
// bankruptcy case -- bankrupt() moves that leftover to the creditor, never
// the originally-requested amount.
function charge(players, board, idx, amount, toIdx, reason, cellId, events, mods) {
  if (idx == null || !amount || amount <= 0 || players[idx].bankrupt) return 0;
  let have = players[idx].money;
  const fig = players[idx].figure;
  const toFig = toIdx != null ? players[toIdx].figure : null;
  if (have < amount) {
    // Shared debts (spec §1): a FORCED charge that would bankrupt the payer
    // first asks whether their CURRENT ally can cover the gap -- together,
    // not the ally alone. The ally only ever pays the shortfall, the charge
    // is then paid IN FULL, and a `debtShare` event says so (plus the
    // ordinary `pay` event that money movement, ally -> payer, is what it
    // is). If payer + ally together still cannot cover it, the ally is left
    // completely untouched and the payer goes bankrupt exactly as before
    // this feature existed.
    const allyFig = FORCED_CHARGE_REASONS.includes(reason) ? allyOf(diplo, fig) : null;
    const allyIdx = allyFig ? players.findIndex((p) => p.figure === allyFig) : -1;
    const ally = allyIdx >= 0 ? players[allyIdx] : null;
    const shortfall = amount - have;
    if (ally && !ally.bankrupt && ally.money >= shortfall) {
      ally.money -= shortfall;
      // The gap is closed -- the payer's own balance actually receives the
      // shortfall (mirrors mono_charge's `money + short` patch) so the
      // ordinary deduction just below zeroes them out exactly, rather than
      // going negative.
      players[idx].money += shortfall;
      have = amount;
      events.push({ type: "pay", figure: allyFig, to: fig, amount: shortfall, reason: "debtShare", cell: cellId ?? null });
      events.push({ type: "debtShare", figure: fig, ally: allyFig, amount: shortfall, reason });
    } else {
      const leftover = players[idx].money;
      bankrupt(players, board, idx, toIdx, reason, amount, events);
      return toIdx != null ? leftover : 0;
    }
  }
  players[idx].money -= amount;
  if (toIdx != null) players[toIdx].money += amount;
  // A fine paid to the bank piles up on Free Parking; everything else does
  // not. The bankruptcy path above returns before this line, exactly as
  // mono_charge does — the pot never sees a bankruptcy, what little the player
  // had goes to the creditor or to the bank.
  else if (POT_REASONS.includes(reason)) potBox.value += amount;
  const evt = { type: "pay", figure: fig, to: toFig, amount, reason, cell: cellId ?? null };
  if (mods) evt.mods = mods;
  events.push(evt);
  return toIdx != null ? amount : 0;
}

function moveTo(board, players, idx, newPos, collectGo, events) {
  const fig = players[idx].figure;
  const oldPos = players[idx].position || 1;
  for (const key of Object.keys(board)) board[key][fig] = false;
  board[newPos][fig] = true;
  players[idx].position = newPos;
  events.push({ type: "move", figure: fig, from: oldPos, to: newPos });
  // START_BONUS, not a literal 200: the rebalance cut it to 150 and this is
  // the same constant mono_move_to now bakes in.
  if (collectGo && newPos <= oldPos) credit(players, idx, START_BONUS, "passGo", events);
}

function findCellOfKind(board, kind) {
  const found = Object.values(board).find((c) => cellKind(c) === kind);
  return found ? found.id : null;
}

// The target cell of an "advance to the nearest <kind>" card. Mirrors
// mono_apply_card's `when 'nearest'` branch (20260918140000_game_rules.sql
// lines 553-566) arithmetic for arithmetic:
//
//   select c.key::integer ... where kind = what and c.key::integer > pos
//   order by c.key::integer limit 1;            -- the next one FORWARD
//   if target is null then
//     target := public.mono_cell_of_kind(board, what);   -- else wrap to the first
//   end if;
//
// Two things about that are easy to get wrong and are therefore spelled out.
// (1) The comparison is strictly `> pos`, so a card drawn while standing ON a
// cell of the sought kind would send you a full lap around rather than leave
// you put -- unreachable on this board (no Chance cell is a railroad) but
// copied anyway, because "matches the server" is the whole contract of this
// file. (2) The fallback is mono_cell_of_kind, which is `order by key limit 1`
// -- the LOWEST-numbered cell of the kind, not "the nearest going backwards".
// From Chance 37 that is railroad 6 / utility 13, and the move to it is a
// forward wrap past Start, which is where the $200 comes from.
function nearestOfKind(board, pos, kind) {
  const ids = Object.values(board || {})
    .filter((c) => cellKind(c) === kind)
    .map((c) => c.id)
    .sort((a, b) => a - b);
  if (ids.length === 0) return null;
  const forward = ids.find((id) => id > pos);
  return forward ?? ids[0];
}

// Rent for a landing, with the ONE multiplier override mono_rent still takes
// (20260920170000_casino_farm_rebalance.sql re-created it without the other):
//
//   road:     RAILROAD_RENT[cnt - 1] * coalesce(road_mult, 1)
//             ... a plain multiplication on top of the normal 35/70/140/280,
//             so delegating to rentFor() and scaling the answer is exact.
//
// `util_mult` and the `communal` branch that read it are GONE with the two
// utilities: cell 13 is the Casino (no owner, no rent — the bank is the house)
// and cell 28 is the Weed Farm (owned, but it pays a counter to its owner
// rather than charging a visitor). Neither of them ever reaches this function;
// land() handles both before it gets here.
//
// `dice_sum` no longer enters into any rent either — it was only ever the
// utilities' input — so rentFor() is called with the players array instead,
// which is what its third argument means now. It is left out here because the
// one caller has ALREADY handled the jailed-owner case and would otherwise ask
// the same question twice, with the second answer silently overriding the
// event the first one emitted.
function rentWithMults(board, id, roadMult) {
  const cell = board?.[id];
  if (cellKind(cell) === "road") return rentFor(board, id) * (roadMult ?? 1);
  return rentFor(board, id);
}

// ---------------------------------------------------------------------------
// The casino. Mirrors public.mono_casino_spin() (20260920170000_casino_farm_
// rebalance.sql) outcome for outcome.
//
// The randomness is HERE, in the "server", and nowhere else. That is the whole
// point of the mechanic: the client only ever animates the object this returns,
// so replaying the action cannot reroll a loss, and the harness has to behave
// the same way or the dev loop would be testing a different game.
//
//   SLOTS     three independent reels of six symbols. The natural distribution
//             of 6^3 = 216 outcomes already IS the spec: 6 triples = 2.78%,
//             C(3,2) x 6 x 5 = 90 exact pairs = 41.67%, 120 all-different.
//   ROULETTE  one slot 0..36. 0 is green, 1..18 red, 19..36 black, so
//             18/37 - 18/37 - 1/37 exactly. Right colour x2, green x14.
//   WHEEL     twelve equal segments: 1-5 lose, 6-9 x1.5, 10-11 x3, 12 x10.
//
// x1.5 on an odd bet is floored, because the board deals in whole dollars and
// rounding the house's way is the convention every casino already uses.
//
// PAYOUT CONVENTION, same as the SQL: "x2" means the player ENDS HOLDING twice
// their bet. The caller settles it as a `pay` of the bet and then a `collect`
// of the payout, never as one net figure.
const CASINO_GAMES = ["slots", "roulette", "wheel"];

function casinoSpin(gameId, bet, pick) {
  const rnd = (n) => Math.floor(Math.random() * n);
  if (gameId === "slots") {
    const reels = [rnd(6), rnd(6), rnd(6)];
    const [a, b, c] = reels;
    const mult = a === b && b === c ? 10 : a === b || b === c || a === c ? 2 : 0;
    return { reels, game: gameId, bet, mult, payout: Math.floor(bet * mult) };
  }
  if (gameId === "roulette") {
    const slot = rnd(37);
    const colour = slot === 0 ? "green" : slot <= 18 ? "red" : "black";
    const mult = pick === colour ? (colour === "green" ? 14 : 2) : 0;
    return { slot, colour, pick, game: gameId, bet, mult, payout: Math.floor(bet * mult) };
  }
  const segment = rnd(12) + 1;
  const mult = segment <= 5 ? 0 : segment <= 9 ? 1.5 : segment <= 11 ? 3 : 10;
  return { segment, game: gameId, bet, mult, payout: Math.floor(bet * mult) };
}

// The minimum bet: 15% of the player's cash, rounded UP to the nearest $10 so
// the slider has round numbers to snap to, then clamped to the cash so a
// nearly-broke player is never asked for more than they own. Mirrors
// public.mono_casino_min_bet(integer) exactly, including the $10 floor — which
// is what keeps a player with $12 from being asked for $2 and then told the
// bet is too small.
function casinoMinBet(cash) {
  const n = Math.max(Math.floor(Number(cash) || 0), 0);
  if (n <= 0) return 0;
  return Math.min(Math.max(Math.ceil((n * 15) / 100 / 10) * 10, 10), n);
}

// ---------------------------------------------------------------------------
// Auction + trading helpers. Deliberately self-contained: src/Hooks/rules.js
// is being edited in parallel by another agent to add the client's own
// `tradable`/`nextBid`/`AUCTION_MIN_RAISE`, and this file must not race that
// -- it only imports the pre-existing ownerOf/cellKind/priceOf. Numbers and
// shapes here mirror design-reference/auction-trade-spec.md §1-2 exactly.
// ---------------------------------------------------------------------------

const AUCTION_MIN_RAISE = 10;

function localSetCells(board, color) {
  return Object.values(board || {}).filter((c) => cellKind(c) === "street" && c.color === color);
}

// Mirrors rules.js's `tradable(board, cellId)`: an ownable cell someone owns,
// with no building anywhere in its colour set (railroads and the Weed Farm are
// always tradable, they have no set). The Casino is deliberately absent — the
// bank is the house, so it is never bought, auctioned or traded.
function isTradableCell(board, cellId) {
  const cell = board?.[cellId];
  if (!cell) return false;
  const kind = cellKind(cell);
  if (kind !== "street" && kind !== "road" && kind !== "farm") return false;
  if (!ownerOf(cell)) return false;
  if (kind !== "street") return true;
  return !localSetCells(board, cell.color).some((c) => (c.houses || 0) > 0);
}

function tradableOwnedByFig(board, fig) {
  return Object.values(board || {})
    .filter((c) => ownerOf(c) === fig && isTradableCell(board, c.id))
    .sort((a, b) => a.id - b.id);
}

function normalizeTradeSide(side) {
  const cells = Array.isArray(side?.cells) ? side.cells.map((c) => Number(c)).filter((c) => Number.isFinite(c)) : [];
  const cash = Number(side?.cash) || 0;
  return { cells, cash };
}

// Message text is the server's exact wording (design-reference/auction-trade-
// spec.md §2 "Rules", as amended by the SQL agent 2026-09-18) so the client
// can match on it identically against either backend.
function validateTradeSides(board, fromPlayer, toPlayer, give, get) {
  if (!fromPlayer || !toPlayer) return { ok: false, reason: "That player is bankrupt" };
  if (fromPlayer.figure === toPlayer.figure) return { ok: false, reason: "You cannot trade with yourself" };
  if (fromPlayer.bankrupt || toPlayer.bankrupt) return { ok: false, reason: "That player is bankrupt" };
  const isMultipleOf10 = (n) => Number.isInteger(n) && n >= 0 && n % 10 === 0;
  if (!isMultipleOf10(give.cash) || !isMultipleOf10(get.cash)) {
    return { ok: false, reason: "Cash must be a whole number of 10$" };
  }
  if (give.cash > fromPlayer.money) return { ok: false, reason: "You do not have that much cash" };
  if (get.cash > toPlayer.money) return { ok: false, reason: "They do not have that much cash" };
  const nothing = give.cells.length === 0 && give.cash === 0 && get.cells.length === 0 && get.cash === 0;
  if (nothing) return { ok: false, reason: "An offer cannot be empty" };
  for (const cid of give.cells) {
    const header = board[cid]?.header ?? `cell ${cid}`;
    if (ownerOf(board[cid]) !== fromPlayer.figure) return { ok: false, reason: `You do not own ${header}` };
    if (!isTradableCell(board, cid)) return { ok: false, reason: `${header} has buildings in its colour set` };
  }
  for (const cid of get.cells) {
    const header = board[cid]?.header ?? `cell ${cid}`;
    if (ownerOf(board[cid]) !== toPlayer.figure) return { ok: false, reason: `They do not own ${header}` };
    if (!isTradableCell(board, cid)) return { ok: false, reason: `${header} has buildings in its colour set` };
  }
  return { ok: true };
}

// `id` rides on every trade event (spec §2 amendment); `reason` is only set
// for `expired` (the free-text explanation of what changed).
function tradeEvent(trade, status, reason) {
  const evt = { type: "trade", status, figure: trade.from, to: trade.to, give: trade.give, get: trade.get, id: trade.id };
  if (reason) evt.reason = reason;
  return evt;
}

// Applies the money/ownership swap for an accepted trade (a no-op for every
// other status) and always appends the `trade` event. Shared by the real
// `trade_accept` action and the dev-only injectTradeEvent() scenario helper
// so both produce identical event/state shapes.
function applyTradeResolution(players, board, trade, status, events, reason) {
  if (status === "accepted") {
    for (const cid of trade.give.cells) {
      board[cid].bought[trade.from] = false;
      board[cid].bought[trade.to] = true;
    }
    for (const cid of trade.get.cells) {
      board[cid].bought[trade.to] = false;
      board[cid].bought[trade.from] = true;
    }
    const fromIdx = players.findIndex((p) => p.figure === trade.from);
    const toIdx = players.findIndex((p) => p.figure === trade.to);
    if (fromIdx >= 0) players[fromIdx].money += trade.get.cash - trade.give.cash;
    if (toIdx >= 0) players[toIdx].money += trade.give.cash - trade.get.cash;
  }
  events.push(tradeEvent(trade, status, reason));
}

// Turn order for an auction: starting with the player after `startedBy`,
// `startedBy` last, bankrupt players excluded. Mirrors the spec's example
// exactly (startedBy fig1 -> order [fig2, fig3, fig0, fig1]).
function buildAuction(players, startedByFig, cellId) {
  const active = players
    .filter((p) => !p.bankrupt)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.figure);
  const startIdx = Math.max(active.indexOf(startedByFig), 0);
  const order = [];
  for (let i = 1; i <= active.length; i++) order.push(active[(startIdx + i) % active.length]);
  return {
    cell: cellId,
    startedBy: startedByFig,
    bid: 0,
    leader: null,
    order,
    in: [...order],
    turn: order[0],
    last: {},
  };
}

// Next figure after `currentTurn` in `order` that is still `in` and is not
// the leader (wrap around). When only one player remains `in` and there is
// no leader yet, this correctly hands the move straight back to them --
// "one left with no bid still gets a move" in the spec.
function nextAuctionTurn(order, inFigs, currentTurn, leaderFig) {
  const n = order.length;
  const idx = Math.max(order.indexOf(currentTurn), 0);
  for (let i = 1; i <= n; i++) {
    const cand = order[(idx + i) % n];
    if (inFigs.includes(cand) && cand !== leaderFig) return cand;
  }
  return null;
}

// Resolves the auction after every bid/drop. Mutates `auction`, `players`
// and `board` in place; returns the still-active auction object, or null
// when the auction just ended (caller sets game.auction/phase from that).
function advanceAuction(auction, players, board, events) {
  if (auction.in.length === 0) {
    events.push({ type: "auction_none", cell: auction.cell });
    return null;
  }
  if (auction.leader && auction.in.length === 1 && auction.in[0] === auction.leader) {
    const idx = players.findIndex((p) => p.figure === auction.leader);
    const amount = auction.bid;
    // Validated at bid time, and no other action can touch money while an
    // auction is running, so this can never go negative -- see spec §1.
    players[idx].money -= amount;
    board[auction.cell].bought[auction.leader] = true;
    events.push({ type: "pay", figure: auction.leader, amount, reason: "auction", to: null, cell: auction.cell });
    events.push({ type: "auction_won", figure: auction.leader, cell: auction.cell, amount });
    return null;
  }
  auction.turn = nextAuctionTurn(auction.order, auction.in, auction.turn, auction.leader);
  return auction;
}

function sendToJail(board, players, idx, reason, events) {
  const jailId = findCellOfKind(board, "jail") ?? 11;
  moveTo(board, players, idx, jailId, false, events);
  players[idx].inJail = true;
  players[idx].jailTurns = 0;
  events.push({ type: "jail", figure: players[idx].figure, reason });
}

function applyCard(board, players, idx, card, diceSum, events, out) {
  switch (card.kind) {
    case "collect":
      credit(players, idx, card.amount, "card", events);
      break;
    case "pay":
      charge(players, board, idx, card.amount, null, "card", null, events);
      break;
    case "jailCard":
      players[idx].jailCards = (players[idx].jailCards || 0) + 1;
      break;
    case "goJail":
      sendToJail(board, players, idx, "card", events);
      break;
    // `cell` when the card names one outright, `what` when it names a KIND —
    // which is how mono_deck writes the three cards whose target is wherever
    // that cell happens to be on this board (Start, the first railroad, and
    // the Casino the retargeted c4 sends you to). A target that cannot be
    // found on the board leaves the player where they are, exactly as the
    // SQL's own `if target is not null` guard does.
    case "moveTo": {
      const target = card.cell ?? findCellOfKind(board, card.what);
      if (target != null) {
        moveTo(board, players, idx, target, true, events);
        land(board, players, idx, diceSum, events, out);
      }
      break;
    }
    // "Advance to the nearest railroad / utility" -- mono_apply_card's
    // `when 'nearest'`, lines 553-566. Three details, all of them load-bearing
    // and all of them taken from the SQL rather than from the Monopoly
    // rulebook, which disagrees with this server:
    //
    // 1. `pos` is read BEFORE the move (the mock's `players[idx].position` at
    //    entry is the Chance cell the roll landed on), so the search starts
    //    from the Chance cell, not from wherever the roll began.
    // 2. `collectGo` is TRUE. moveTo() pays the Start bonus whenever
    //    `newPos <= oldPos`, so wrapping from Chance 37 round to railroad 6
    //    collects it -- and, per the real rulebook, should. From Chance 8 or
    //    23 the target is a higher cell and nothing is paid.
    // 3. road_mult 2 is handed to land(), exactly as the SQL does it, so a
    //    railroad reached this way charges double the normal 35/70/140/280.
    //    The util_mult 10 that used to travel beside it is GONE with the
    //    utilities and with the rent branch that read it -- `road` is now the
    //    only kind `nearest` is ever asked for (see the deck above).
    //
    // The `if target is not null` guard is kept too: a board with no cell of
    // the sought kind draws the card, announces it, and then does nothing at
    // all -- no move, no land, no second event. Only reachable on a hand-built
    // board, but it is what the server would do.
    case "nearest": {
      const target = nearestOfKind(board, players[idx].position, card.what);
      if (target != null) {
        moveTo(board, players, idx, target, true, events);
        land(board, players, idx, diceSum, events, out, undefined, 2);
      }
      break;
    }
    // Shapes below mirror mono_apply_card's payEach / collectEach / repairs
    // exactly: each is a run of `charge()` calls, one `pay` event per player
    // pair (reason 'card'), or one `pay` for the drawer (reason 'repairs').
    case "payEach":
      for (let i = 0; i < players.length; i++) {
        if (players[idx].bankrupt) break;
        if (i !== idx && !players[i].bankrupt) {
          charge(players, board, idx, card.amount, i, "card", null, events);
        }
      }
      break;
    case "collectEach":
      for (let i = 0; i < players.length; i++) {
        if (i !== idx && !players[i].bankrupt) {
          charge(players, board, i, card.amount, idx, "card", null, events);
        }
      }
      break;
    case "repairs": {
      let houses = 0;
      let hotels = 0;
      const fig = players[idx].figure;
      for (const key of Object.keys(board)) {
        const c = board[key];
        if (cellKind(c) === "street" && ownerOf(c) === fig) {
          const h = c.houses || 0;
          if (h >= 5) hotels += 1;
          else houses += h;
        }
      }
      charge(players, board, idx, houses * card.house + hotels * card.hotel, null, "repairs", null, events);
      break;
    }
    default:
      break;
  }
}

// Resolve the cell the player stands on. `forceCard` (dev-only) skips the
// random draw so a scenario can guarantee which card shows up.
//
// `roadMult` is mono_land's one remaining trailing default argument
// (`road_mult integer default 1`); `util_mult` went with the utilities. Only
// the `nearest` card ever passes it -- every other caller, here and there,
// takes the default and gets ordinary rent.
//
// Four branches are new, all of them from the rebalance migration:
//   jail     a landlord in jail collects NOTHING. The visitor pays nobody --
//            not the owner, not the pot, not the bank -- and a `rentFree`
//            event says so, or the log would look like a dropped charge.
//   parking  hands over the whole pot and zeroes it. A pot of 0 is silent:
//            no money, no event, nothing at all.
//   farm     the owner harvests the counter by landing on it; everybody else
//            pays nothing and waters it by FARM_INCOME_STEP. The counter lives
//            ON THE CELL (`board["28"].income`) so it follows the deed through
//            a trade or a bankruptcy without anything having to move it.
//   casino   writes the pending block. The turn cannot move on until the
//            player has bet, which is what "mandatory" means here. `out` is
//            how it reaches applyAction -- land() is called from four places
//            and none of them can see the game block.
function land(board, players, idx, diceSum, events, out, forceCard, roadMult = 1) {
  const fig = players[idx].figure;
  const pos = players[idx].position;
  const cell = board[pos];
  const kind = cellKind(cell);
  events.push({ type: "land", figure: fig, cell: pos, kind });

  if (kind === "street" || kind === "road") {
    const owner = ownerOf(cell);
    if (owner && owner !== fig) {
      const ownerIdx = players.findIndex((p) => p.figure === owner);
      if (ownerIdx >= 0 && !players[ownerIdx].bankrupt) {
        if (players[ownerIdx].inJail) {
          events.push({
            type: "rentFree",
            figure: fig,
            owner,
            cell: pos,
            reason: "ownerInJail",
          });
        } else if (areAllies(diplo, fig, owner)) {
          // "No rent between allies" (spec §1) overrides every other
          // multiplier rather than composing with them -- same "say why with
          // an event instead of a silent gap" convention the jail branch
          // above already established, just with a different reason.
          events.push({ type: "rentFree", figure: fig, owner, cell: pos, reason: "ally" });
        } else {
          const base = rentWithMults(board, pos, roadMult);
          const rm = rentMods(diplo, players, fig, owner);
          const rent = rm.zero ? 0 : Math.floor(base * rm.mult);
          // Always attached, even as `[]` -- mirrors mono_land passing
          // `due->'mods'` (never SQL null) into mono_charge for every rent
          // charge, so a plain unmodified rent still carries `mods: []`
          // rather than omitting the key. Every OTHER charge() call site
          // leaves the 9th argument out entirely, which is how a non-rent
          // `pay` event ends up with no `mods` key at all.
          const paid = charge(players, board, idx, rent, ownerIdx, "rent", pos, events, rm.mods);
          // Rent commission (spec §1): when a NON-ally pays rent to one
          // ally, the BANK -- not the rent itself -- pays the OTHER ally 10%
          // of what was actually paid. `paid` (charge()'s return) is the
          // full rent in the normal and shared-debt cases, or only the
          // payer's remaining cash if this charge tipped them into
          // bankruptcy -- either way it is what "actually paid" means.
          const ownerAlly = allyOf(diplo, owner);
          if (ownerAlly && paid > 0) {
            const allyIdx = players.findIndex((p) => p.figure === ownerAlly);
            const commission = Math.floor(paid * COMMISSION);
            if (allyIdx >= 0 && !players[allyIdx].bankrupt && commission > 0) {
              // credit(), not a direct patch: mirrors mono_credit, which is
              // what actually emits the ordinary `collect` event alongside
              // the dedicated `commission` one below -- every money movement
              // gets both, so a balance is reconstructible from either feed.
              credit(players, allyIdx, commission, "commission", events);
              events.push({
                type: "commission",
                figure: ownerAlly,
                payer: fig,
                owner,
                amount: commission,
                cell: pos,
              });
            }
          }
        }
      }
    }
  } else if (kind === "tax") {
    charge(players, board, idx, cell.price || 0, null, "tax", pos, events);
  } else if (kind === "parking") {
    const pot = potBox.value;
    if (pot > 0) {
      // zeroed BEFORE the credit, exactly as the SQL does it: a pot that is
      // still readable after it has been paid out is the classic way to pay
      // it twice
      potBox.value = 0;
      credit(players, idx, pot, "pot", events);
      events.push({ type: "pot", figure: fig, cell: pos, amount: pot });
    }
  } else if (kind === "farm") {
    const owner = ownerOf(cell);
    const income = Math.max(farmIncome(cell), FARM_INCOME_START);
    if (owner && owner === fig) {
      // the owner came to collect: the whole counter, printed by the bank, and
      // the field starts growing again from the opening value
      cell.income = FARM_INCOME_START;
      credit(players, idx, income, "farm", events);
      events.push({
        type: "farm",
        stage: "harvest",
        figure: fig,
        cell: pos,
        amount: income,
        income: FARM_INCOME_START,
      });
    } else {
      // anybody else -- including everybody while it is still unowned -- pays
      // nothing and leaves the crop bigger for whoever holds the deed
      cell.income = income + FARM_INCOME_STEP;
      events.push({
        type: "farm",
        stage: "grow",
        figure: fig,
        cell: pos,
        amount: 0,
        income: cell.income,
      });
    }
  } else if (kind === "casino") {
    const cash = players[idx].money;
    if (cash > 0) {
      out.casino = { cell: pos, figure: fig, min: casinoMinBet(cash), max: cash };
      events.push({
        type: "casino",
        stage: "enter",
        figure: fig,
        cell: pos,
        min: out.casino.min,
        max: cash,
      });
    }
    // a player with no cash left has nothing to bet: the house waves them
    // through rather than deadlocking the room on an impossible action
  } else if (kind === "gtj") {
    sendToJail(board, players, idx, "gtj", events);
  } else if (kind === "chance" || kind === "community") {
    const card = forceCard ? drawCard(forceCard.deck, forceCard.index) : drawCard(kind);
    events.push({ type: "card", figure: fig, deck: kind, id: card.id, text: card.text });
    out.lastCard = { deck: kind, text: card.text, figure: fig };
    applyCard(board, players, idx, card, diceSum, events, out);
  }
  // start / jail (visiting): nothing extra, same as the SQL.
}

// One-shot forced dice for the very next roll, whoever makes it, set by
// `mockDev.forceNextRoll([d1, d2])`. The SQL harness gets the same control from
// setseed(); a headless check that has to land on one specific cell through the
// real `roll` action needs it here too. Consumed on use, so it can never leak
// into a later roll.
let nextRoll = null;

function performRoll(board, players, idx, events, initialDoubles, out, opts = {}) {
  const { forceTarget, forceDoubles, forceCard } = opts;
  const fig = players[idx].figure;
  const cellsCount = Object.keys(board).length;
  const forced = nextRoll;
  nextRoll = null;
  const d1 = forced ? forced[0] : 1 + Math.floor(Math.random() * 6);
  const d2 = forced ? forced[1] : forceDoubles ? d1 : 1 + Math.floor(Math.random() * 6);
  events.push({ type: "roll", figure: fig, d1, d2, doubles: d1 === d2 });

  const oldPos = players[idx].position || 1;
  const newPos = forceTarget ?? (((oldPos - 1 + d1 + d2) % cellsCount) + 1);
  let doublesCount = initialDoubles || 0;
  const wasInJail = players[idx].inJail;

  if (wasInJail) {
    doublesCount = 0;
    if (d1 === d2) {
      players[idx].inJail = false;
      players[idx].jailTurns = 0;
      events.push({ type: "jailLeave", figure: fig, how: "doubles" });
      moveTo(board, players, idx, newPos, true, events);
      land(board, players, idx, d1 + d2, events, out, forceCard);
    } else {
      players[idx].jailTurns = (players[idx].jailTurns || 0) + 1;
      if (players[idx].jailTurns >= 3) {
        // JAIL_FINE, not a literal: it goes to the BANK and never to the
        // parking pot (see POT_REASONS), which is why `jailFee` is absent
        // from that list.
        charge(players, board, idx, JAIL_FINE, null, "jailFee", null, events);
        if (!players[idx].bankrupt) {
          players[idx].inJail = false;
          players[idx].jailTurns = 0;
          events.push({ type: "jailLeave", figure: fig, how: "fee" });
          moveTo(board, players, idx, newPos, true, events);
          land(board, players, idx, d1 + d2, events, out, forceCard);
        }
      } else {
        events.push({ type: "jailStay", figure: fig, turn: players[idx].jailTurns });
      }
    }
  } else {
    doublesCount = d1 === d2 ? doublesCount + 1 : 0;
    if (doublesCount >= 3) {
      sendToJail(board, players, idx, "doubles", events);
      doublesCount = 0;
    } else {
      moveTo(board, players, idx, newPos, true, events);
      land(board, players, idx, d1 + d2, events, out, forceCard);
    }
  }
  if (players[idx].inJail) doublesCount = 0; // sent to jail: no extra turn
  return { dice: [d1, d2], doubles: doublesCount };
}

function nextTurn(players, turn) {
  const n = players.length;
  if (n === 0) return 0;
  let t = turn;
  for (let i = 0; i < n; i++) {
    t = (t + 1) % n;
    const idx = players.findIndex((p) => p.order === t);
    if (idx >= 0 && !players[idx].bankrupt) return t;
  }
  return turn;
}

// Bankrupt-skip + the diplomacy bankruptcy sweep + the round-tick, run after
// every action (mirrors the tail of game_action in the SQL, in the SQL's own
// order). `phaseIn` is whatever the action itself decided; `turn0` is the
// turn this action STARTED from, read straight off the row before anything
// in the switch above touched it. The round only ticks when the turn
// actually moved during THIS action and landed back on the first
// still-active seat -- checked here ONCE rather than at each of the four
// places that can move the turn, because only the bankrupt-skip right below
// can move it a SECOND time within the same action, and double-counting that
// second move as its own round would be wrong.
function applyEndOfActionChecks(players, turn, turn0, phaseIn, action, events) {
  let phase = phaseIn;
  if (phase !== "over") {
    const curIdx = players.findIndex((p) => p.order === turn);
    if (curIdx >= 0 && players[curIdx].bankrupt) {
      turn = nextTurn(players, turn);
      phase = "roll";
    }
  }
  // "A bankruptcy can happen anywhere inside a landing -- a card that
  // charges every player, a rent that an ally could not cover -- so this is
  // swept up here rather than at each of those call sites." (verbatim
  // reasoning from the SQL; see reconcileDiplomacyBankruptcies() itself.)
  reconcileDiplomacyBankruptcies(players, events);
  // new_game/reset_board set the turn back to 0 themselves, which would
  // otherwise read as a wrap and tick the freshly reset counter to 2.
  if (
    action !== "new_game" &&
    action !== "reset_board" &&
    phase !== "over" &&
    players.length > 0 &&
    turn !== turn0 &&
    turn === firstActiveOrder(players)
  ) {
    diplo.round += 1;
    runStartOfRound(players, events);
  }
  return { turn, phase };
}

// Last one standing wins -- or the last PAIR standing, if the two of them
// are allied (spec §1: the game is over when every non-bankrupt player is
// either one player or one allied pair -- two survivors who are NOT allied
// still have a game to play). Sorted by seat order so `winners` (and the
// legacy `winner`, its first entry) reads the same regardless of whatever
// order the players array itself happens to store them in.
function checkWin(players, winnerIn, winnersIn, events) {
  let winner = winnerIn;
  let winners = winnersIn;
  const active = players.filter((p) => !p.bankrupt).sort((a, b) => a.order - b.order);
  if (!winner && players.length >= 2 && (active.length === 1 || active.length === 2)) {
    if (active.length === 1 || areAllies(diplo, active[0].figure, active[1].figure)) {
      winners = active.map((p) => p.figure);
      winner = winners[0];
      events.push({ type: "win", figure: winner, figures: winners });
    }
  }
  return { winner, winners, phase: winner ? "over" : null };
}

function finalize(st, gmPrev, seq, events, patch) {
  const prevLog = Array.isArray(gmPrev.log) ? gmPrev.log : [];
  let log = prevLog.concat(events.map((e) => ({ ...e, seq, by: patch.actorId ?? null })));
  if (log.length > 40) log = log.slice(log.length - 40);
  // Six seats now, and clamped to the seats this room actually has rather than
  // to a constant -- mirrors `least(greatest(turn, 0), greatest(n - 1, 0))` in
  // supabase/migrations/20260920100000_six_players.sql (it was `, 3)` here and
  // there, which pinned a room to its first four players).
  st.current_order = Math.min(
    Math.max(patch.turn, 0),
    Math.max((st.Players || []).length - 1, 0),
  );
  st.game = {
    seq,
    phase: patch.phase,
    doubles: patch.doubles || 0,
    dice: patch.dice ?? null,
    actor: patch.actorId ?? null,
    action: patch.action ?? null,
    events,
    lastCard: patch.lastCard ?? null,
    winner: patch.winner ?? null,
    // Always an array -- [] while the game runs, 1 or 2 figures once it is
    // over (spec §1's allied-pair win). Mirrors the SQL exactly (`winners`
    // defaults to '[]'::jsonb, never null), and is computed fresh by
    // checkWin() every action rather than carried by the
    // undefined-means-unchanged convention below, same treatment as
    // `winner` itself, which this is a superset of.
    winners: patch.winners ?? [],
    // undefined means "unchanged" (most actions never touch these); an
    // explicit null clears it. Either way it must be a real key, never
    // missing, so the client's `game?.auction ?? null` always sees one.
    auction: patch.auction !== undefined ? patch.auction : (gmPrev.auction ?? null),
    trade: patch.trade !== undefined ? patch.trade : (gmPrev.trade ?? null),
    // The Free Parking pot. Always a real integer, never a missing key -- the
    // SQL seeds `pot` onto every existing row in its data step, and the
    // client's `Number(game?.pot) || 0` would quietly read 0 for a room where
    // it had gone missing, which is the one failure mode that loses money
    // silently. Read straight off potBox, which charge() and land() have both
    // already had their way with.
    pot: Math.max(Math.round(potBox.value) || 0, 0),
    // The pending casino bet, or null. Same "a real key, never missing" rule
    // as auction/trade, for the same reason: `game?.casino ?? null` on the
    // phone must always see one.
    casino: patch.casino !== undefined ? patch.casino : (gmPrev.casino ?? null),
    // Diplomacy state, read straight off the `diplo` box -- same "already had
    // its way with it" reasoning as `pot` above. `round` always starts at 1
    // and climbs even in a game that never touches an alliance or a war
    // (spec's Rounds section makes it unconditional).
    round: diplo.round,
    alliances: diplo.alliances,
    allyOffers: diplo.allyOffers,
    wars: diplo.wars,
    log,
  };
  return st;
}

// ---------------------------------------------------------------------------
// The validated action handler: what a real Client tap goes through.
// Actions not used by ClientScreen (join, new_game, skip_turn, ...) are not
// implemented -- see TESTING.md's "Offline client preview" section.
// ---------------------------------------------------------------------------

// Board-only actions (Board.jsx's boardAction() never sends a playerId for
// these -- see src/Pages/Board.jsx's newGame()/skipTurn()): they may run with
// no `me`, ignore the "game is over"/"you are bankrupt" guards, and (for
// skip_turn) run even mid-auction, exactly like the SQL's
// `action not in ('join','reset_board','new_game','skip_turn')` exemption.
const BOARD_ONLY_ACTIONS = ["new_game", "reset_board", "skip_turn"];

// `join` sits in the same exemption in the SQL: the whole point is that the
// caller is NOT in the room yet, so the "Player is not in this room" /
// bankrupt / game-over guards below must not fire for it. It is listed
// separately from BOARD_ONLY_ACTIONS because it is not a board button and,
// unlike skip_turn, it is still refused while an auction is running (the SQL
// leaves it out of the auction list too -- see the phase='auction' check).
const NO_SEAT_ACTIONS = [...BOARD_ONLY_ACTIONS, "join"];

function applyAction(prevRow, action, payload) {
  const st = clone(prevRow);
  const players = st.Players;
  const board = st.position;
  let turn = st.current_order;
  // The turn this action STARTED from -- read before the switch below can
  // touch it, so the round-tick check can tell "did the turn move during
  // this action" from "was it already sitting on the first active seat".
  const turn0 = turn;
  const gmPrev = st.game || {};
  const seq = (gmPrev.seq || 0) + 1;
  let phase = gmPrev.phase || "roll";
  let doubles = gmPrev.doubles || 0;
  let dice = gmPrev.dice || null;
  let winner = gmPrev.winner || null;
  let winners = Array.isArray(gmPrev.winners) ? gmPrev.winners : [];
  // A pre-diplomacy row can have `winner` set with no `winners` array at
  // all: backfill it so a read-back is consistent either way, mirroring the
  // SQL's own defensive coalesce for an upgraded room.
  if (winner && winners.length === 0) winners = [winner];
  let lastCard = null;
  const events = [];
  // undefined = this action doesn't touch it, finalize() carries the
  // previous value forward; an explicit null/object is a real change.
  let auctionOut;
  let tradeOut;
  let logOverride; // set only by new_game/reset_board: the log restarts empty

  // The Free Parking pot for the duration of this action. charge() adds fines
  // to it and land()'s parking branch empties it; finalize() writes whatever
  // is left back onto the row. See the note on potBox itself.
  potBox = { value: Math.max(Math.round(Number(gmPrev.pot) || 0), 0) };

  // The diplomacy layer for the duration of this action. See the note on
  // `diplo` itself, right above charge(). Defensive against an old row that
  // predates this feature: `game.alliances` etc. may simply not exist yet.
  diplo = {
    alliances: Array.isArray(gmPrev.alliances) ? clone(gmPrev.alliances) : [],
    allyOffers: Array.isArray(gmPrev.allyOffers) ? clone(gmPrev.allyOffers) : [],
    wars: Array.isArray(gmPrev.wars) ? clone(gmPrev.wars) : [],
    round: Number.isInteger(gmPrev.round) && gmPrev.round > 0 ? gmPrev.round : 1,
  };

  // The pending casino bet. Same "json null and a missing key both mean
  // nothing pending" reading the SQL does, and the same defensive repair: a
  // phase left behind without its block would otherwise refuse every action in
  // the room forever.
  let cas = gmPrev.casino && typeof gmPrev.casino === "object" ? gmPrev.casino : null;
  if (!cas && phase === "casino") phase = "act";

  const pid = payload.playerId;
  const meIdx = pid ? players.findIndex((p) => p.playerId === pid) : -1;
  const me = meIdx >= 0 ? players[meIdx] : null;
  const boardOnly = BOARD_ONLY_ACTIONS.includes(action);
  const noSeat = NO_SEAT_ACTIONS.includes(action);

  if (!me && !noSeat) throw new Error("Player is not in this room");
  if (phase === "over" && !noSeat) throw new Error("The game is over");
  if (me?.bankrupt && !boardOnly) throw new Error("You are bankrupt");
  // The four "any time" diplomacy verbs (spec's Verbs table) are allowed
  // through both phase locks below, same as leave/skip_turn already are: an
  // incoming alliance or peace offer can land on someone mid-auction or
  // mid-bet elsewhere at the table, and they still have to be able to answer
  // it without that unrelated auction/bet blocking them. The five "own turn"
  // diplomacy verbs (propose/break/declare/peace_propose/backstab) are NOT
  // listed here on purpose -- they stay refused during either phase exactly
  // like every other own-turn action.
  const ANY_TIME_DIPLOMACY = ["ally_accept", "ally_decline", "ally_cancel", "peace_accept", "peace_decline"];
  if (
    phase === "auction" &&
    !["auction_bid", "auction_drop", "leave", "skip_turn", ...ANY_TIME_DIPLOMACY].includes(action)
  ) {
    throw new Error("An auction is running");
  }
  // Landing on the casino is MANDATORY, and "mandatory" is enforced right
  // here: the player cannot roll, move, buy, build, trade, auction or end
  // their turn around it. Only casino_play clears the block -- or skip_turn /
  // leave, for a phone that went away. Message verbatim from the SQL, because
  // the phone shows `error.message` to the player as-is.
  if (
    phase === "casino" &&
    !["casino_play", "leave", "skip_turn", ...ANY_TIME_DIPLOMACY].includes(action)
  ) {
    throw new Error("The casino is waiting");
  }

  switch (action) {
    // The Login page's one and only write (src/Login/LoginScreen.jsx).
    // Mirrors the SQL's `join` branch in
    // supabase/migrations/20260919100000_auction_trade.sql VERBATIM, down to
    // the order of the checks and the wording of every message -- the login
    // screen shows `error.message` to the player as-is, so "Room is full" and
    // "Figure is already taken" have to read exactly the same offline as they
    // do against the real backend.
    case "join": {
      if (me) return st; // already in the room: rejoin, nothing to change
      const name = payload.name;
      const figure = payload.figure;
      if (!pid || name == null || figure == null) {
        throw new Error("name, figure and playerId are required");
      }
      if (!FIGURES.includes(figure)) {
        throw new Error(`Unknown figure ${figure}`);
      }
      if (players.length >= MAX_PLAYERS) throw new Error("Room is full");
      if (players.some((p) => p.figure === figure)) throw new Error("Figure is already taken");
      const startId = findCellOfKind(board, "start") ?? 1;
      players.push({
        name,
        figure,
        money: 2500,
        position: startId,
        order: players.length,
        playerId: pid,
        inJail: false,
        jailTurns: 0,
        jailCards: 0,
        bankrupt: false,
      });
      board[startId][figure] = true;
      events.push({ type: "join", figure, name });
      break;
    }

    case "roll": {
      if (me.order !== turn) throw new Error("Not your turn");
      if (phase !== "roll") throw new Error("You already rolled, end your turn");
      const out = { lastCard: null };
      const r = performRoll(board, players, meIdx, events, doubles, out, {
        forceTarget: payload.__forceTarget,
        forceDoubles: payload.__forceDoubles,
        forceCard: payload.__forceCard,
      });
      dice = r.dice;
      doubles = r.doubles;
      phase = "act";
      lastCard = out.lastCard;
      // A bet can have been opened by the landing itself or by a Chance card
      // that sent the player to the Casino from the other side of the board.
      // Either way land() left it on `out`; the phase follows at the bottom of
      // this function, the same place the SQL derives it.
      if (out.casino) cas = out.casino;
      break;
    }

    case "move": {
      // Debug jump: resolves the landing but never validates whose turn it
      // is (see TESTING.md 0.4 -- a jump does not use up your turn).
      const to = Number(payload.to);
      if (!Number.isFinite(to)) throw new Error("move needs a target cell");
      const out = { lastCard: null };
      moveTo(board, players, meIdx, to, false, events);
      land(board, players, meIdx, (dice?.[0] ?? 3) + (dice?.[1] ?? 4), events, out);
      lastCard = out.lastCard;
      // The debug jump resolves the landing, so jumping onto cell 13 opens the
      // bet exactly as rolling onto it would -- which is the fastest way to
      // exercise the casino panel in the harness.
      if (out.casino) cas = out.casino;
      break;
    }

    case "buy": {
      const cellId = Number(payload.cell);
      const cell = board[cellId];
      if (!cell) throw new Error(`Cell ${cellId} does not exist`);
      if (cellId !== (me.position || 0)) throw new Error("You are not standing on that cell");
      const price = priceOf(cell);
      if (price == null) throw new Error("This cell is not for sale");
      if (ownerOf(cell)) throw new Error("Already owned");
      if (me.money < price) throw new Error("Not enough money");
      cell.bought[me.figure] = true;
      me.money -= price;
      events.push({ type: "buy", figure: me.figure, cell: cellId, amount: price });
      break;
    }

    case "build": {
      const cellId = Number(payload.cell);
      const check = canBuild(board, me.figure, cellId, me.money);
      if (!check.ok) throw new Error(check.reason);
      const cell = board[cellId];
      cell.houses = (cell.houses || 0) + 1;
      me.money -= check.price;
      events.push({ type: "build", figure: me.figure, cell: cellId, amount: check.price, houses: cell.houses });
      break;
    }

    // The one new verb. Payload: { playerId, game, bet, colour }.
    //
    // Every message below is the SQL's own wording -- the phone quotes
    // `error.message` straight to the player, so "Bet at least 380$" has to
    // read identically against either backend.
    //
    // THE RANDOMNESS IS HERE AND NOWHERE ELSE. casinoSpin() is called once,
    // inside the same action that takes the money; the client is handed the
    // finished result and only animates it. Replaying the action cannot
    // reroll a loss because the pending block is gone by the time a second
    // call arrives -- which is what the first check enforces.
    case "casino_play": {
      if (!cas || phase !== "casino") throw new Error("The casino is not waiting for you");
      if (me.order !== turn || cas.figure !== me.figure) {
        throw new Error("The casino is not waiting for you");
      }

      const casGame = payload.game;
      if (!casGame || !CASINO_GAMES.includes(casGame)) {
        throw new Error("Pick slots, roulette or wheel");
      }
      // Roulette is the only game with anything to choose after the bet; the
      // other two ignore whatever was sent, exactly as the SQL does.
      let casPick = payload.colour ?? null;
      if (casGame === "roulette") {
        if (!["red", "black", "green"].includes(casPick)) {
          throw new Error("Pick red, black or green");
        }
      } else {
        casPick = null;
      }

      const raw = payload.bet;
      if (raw == null || raw === "") throw new Error("casino_play needs a bet");
      const amt = Number(raw);
      if (!Number.isFinite(amt)) throw new Error("casino_play needs a bet");
      if (!Number.isInteger(amt)) throw new Error("The bet must be a whole number");
      // The floor and the ceiling are recomputed from the money the player has
      // RIGHT NOW rather than read out of the pending block: the block is a
      // hint for the slider, never an authority, and trusting it would let a
      // stale phone bet money that has since gone to a landlord.
      const minBet = casinoMinBet(me.money);
      if (amt > me.money) throw new Error("Not enough money");
      if (amt < minBet) throw new Error(`Bet at least ${minBet}$`);

      const spin = casinoSpin(casGame, amt, casPick);
      // Two movements, never one net figure -- see the payout convention on
      // casinoSpin(). The bank is the house: the bet vanishes into it and the
      // payout is printed by it, so neither side touches the parking pot
      // (reason 'casino' is not in POT_REASONS).
      charge(players, board, meIdx, amt, null, "casino", cas.cell, events);
      credit(players, meIdx, spin.payout, "casino", events);
      events.push({
        type: "casino",
        stage: "result",
        figure: me.figure,
        cell: cas.cell,
        game: casGame,
        bet: amt,
        mult: spin.mult,
        payout: spin.payout,
        result: spin,
      });
      cas = null;
      // one play per landing: back to a normal `act`, and end_turn follows
      phase = "act";
      break;
    }

    case "auction_start": {
      if (me.order !== turn) throw new Error("Not your turn");
      if (phase !== "act") throw new Error("Roll first");
      const cellId = Number(payload.cell);
      const cell = board[cellId];
      if (!cell) throw new Error(`Cell ${cellId} does not exist`);
      if (cellId !== (me.position || 0)) throw new Error("You are not standing on that cell");
      if (priceOf(cell) == null) throw new Error("This cell is not for sale");
      if (ownerOf(cell)) throw new Error("Already owned");
      if (gmPrev.trade) applyTradeResolution(players, board, gmPrev.trade, "cancelled", events);
      tradeOut = null;
      auctionOut = buildAuction(players, me.figure, cellId);
      events.push({ type: "auction_start", figure: me.figure, cell: cellId });
      phase = "auction";
      break;
    }

    case "auction_bid": {
      const auction = gmPrev.auction;
      if (!auction) throw new Error("No auction is running");
      if (!auction.in.length) throw new Error("Nobody can bid");
      if (me.figure !== auction.turn) throw new Error("It is not your turn to bid");
      const amount = Number(payload.amount);
      const minBid = auction.bid > 0 ? auction.bid + AUCTION_MIN_RAISE : AUCTION_MIN_RAISE;
      if (!Number.isFinite(amount) || amount % 10 !== 0) throw new Error("Bids must be a multiple of 10");
      if (amount < minBid) throw new Error(`Bid at least ${minBid}$`);
      if (amount > me.money) throw new Error("Not enough money");
      auction.bid = amount;
      auction.leader = me.figure;
      auction.last = { ...auction.last, [me.figure]: amount };
      events.push({ type: "bid", figure: me.figure, cell: auction.cell, amount });
      auctionOut = advanceAuction(auction, players, board, events);
      phase = auctionOut ? "auction" : "act";
      break;
    }

    case "auction_drop": {
      const auction = gmPrev.auction;
      if (!auction) throw new Error("No auction is running");
      if (!auction.in.length) throw new Error("Nobody can bid");
      if (me.figure !== auction.turn) throw new Error("It is not your turn to bid");
      auction.in = auction.in.filter((f) => f !== me.figure);
      events.push({ type: "drop", figure: me.figure, cell: auction.cell });
      auctionOut = advanceAuction(auction, players, board, events);
      phase = auctionOut ? "auction" : "act";
      break;
    }

    case "trade_offer": {
      if (me.order !== turn) throw new Error("You can only offer a trade on your turn");
      if (phase !== "roll" && phase !== "act") throw new Error("You cannot trade right now");
      if (gmPrev.trade) throw new Error("There is already a pending offer");
      const toFig = payload.to;
      const toIdx = players.findIndex((p) => p.figure === toFig);
      if (toIdx < 0) throw new Error("Unknown player");
      const give = normalizeTradeSide(payload.give);
      const get = normalizeTradeSide(payload.get);
      const check = validateTradeSides(board, me, players[toIdx], give, get);
      if (!check.ok) throw new Error(check.reason);
      const trade = { id: seq, from: me.figure, to: toFig, give, get, counter: false };
      tradeOut = trade;
      events.push(tradeEvent(trade, "offered"));
      break;
    }

    case "trade_accept": {
      // Per the spec's §2 amendment (adopted from the SQL agent): a stale
      // offer does NOT reject the call. It succeeds, clears the trade, and
      // reports itself only through the `expired` event's `reason` -- an
      // exception would otherwise roll back the clearing in the same
      // transaction and leave a dead offer blocking the room.
      const trade = gmPrev.trade;
      if (!trade) throw new Error("There is no offer to answer");
      if (me.figure !== trade.to) throw new Error("This offer is not yours to answer");
      const fromIdx = players.findIndex((p) => p.figure === trade.from);
      const fromPlayer = fromIdx >= 0 ? players[fromIdx] : null;
      const check = fromPlayer
        ? validateTradeSides(board, fromPlayer, me, trade.give, trade.get)
        : { ok: false, reason: "That player is bankrupt" };
      if (!check.ok) {
        applyTradeResolution(players, board, trade, "expired", events, check.reason);
      } else {
        applyTradeResolution(players, board, trade, "accepted", events);
      }
      tradeOut = null;
      break;
    }

    case "trade_decline": {
      const trade = gmPrev.trade;
      if (!trade) throw new Error("There is no offer to answer");
      if (me.figure !== trade.to) throw new Error("This offer is not yours to answer");
      applyTradeResolution(players, board, trade, "declined", events);
      tradeOut = null;
      break;
    }

    case "trade_cancel": {
      const trade = gmPrev.trade;
      if (!trade) throw new Error("There is no offer to cancel");
      if (me.figure !== trade.from) throw new Error("This offer is not yours to cancel");
      applyTradeResolution(players, board, trade, "cancelled", events);
      tradeOut = null;
      break;
    }

    case "trade_counter": {
      const trade = gmPrev.trade;
      if (!trade) throw new Error("There is no offer to answer");
      if (me.figure !== trade.to) throw new Error("This offer is not yours to answer");
      const newTo = trade.from;
      const toIdx = players.findIndex((p) => p.figure === newTo);
      const give = normalizeTradeSide(payload.give);
      const get = normalizeTradeSide(payload.get);
      const check = validateTradeSides(board, me, players[toIdx], give, get);
      if (!check.ok) throw new Error(check.reason);
      const newTrade = { id: seq, from: me.figure, to: newTo, give, get, counter: true };
      tradeOut = newTrade;
      events.push(tradeEvent(newTrade, "countered"));
      break;
    }

    case "pay_jail": {
      if (me.order !== turn) throw new Error("Not your turn");
      if (!me.inJail) throw new Error("You are not in jail");
      if (phase !== "roll") throw new Error("You already rolled");
      if (me.money < JAIL_FINE) throw new Error("Not enough money");
      me.money -= JAIL_FINE;
      me.inJail = false;
      me.jailTurns = 0;
      events.push({ type: "pay", figure: me.figure, to: null, amount: JAIL_FINE, reason: "jailFee" });
      events.push({ type: "jailLeave", figure: me.figure, how: "pay" });
      break;
    }

    case "use_jail_card": {
      if (me.order !== turn) throw new Error("Not your turn");
      if (!me.inJail) throw new Error("You are not in jail");
      if (phase !== "roll") throw new Error("You already rolled");
      if (!(me.jailCards > 0)) throw new Error("You have no Get Out Of Jail Free card");
      me.jailCards -= 1;
      me.inJail = false;
      me.jailTurns = 0;
      events.push({ type: "jailLeave", figure: me.figure, how: "card" });
      break;
    }

    case "end_turn": {
      if (me.order !== turn) throw new Error("Not your turn");
      if (phase !== "act") throw new Error("Roll first");
      if (gmPrev.trade) {
        applyTradeResolution(players, board, gmPrev.trade, "cancelled", events);
        tradeOut = null;
      }
      if (doubles > 0 && !me.inJail && !me.bankrupt) {
        events.push({ type: "again", figure: me.figure, doubles });
      } else {
        turn = nextTurn(players, turn);
        doubles = 0;
        events.push({ type: "turn", order: turn });
      }
      phase = "roll";
      break;
    }

    // ---------------------------------------------------------------------
    // Diplomacy: alliances (SPEC-DIPLOMACY.md §1). ally_propose/ally_break
    // are "own turn" like build/trade_offer; ally_accept/decline/cancel are
    // "any time" like a trade's accept/decline, and are exempted from the
    // auction/casino phase locks above for exactly that reason.
    // ---------------------------------------------------------------------

    case "ally_propose": {
      if (me.order !== turn) throw new Error("You can only propose an alliance on your turn");
      if (phase !== "roll" && phase !== "act") throw new Error("You cannot do that right now");
      const toFig = payload.to;
      const check = canAlly(diplo, players, me.figure, toFig);
      if (!check.ok) throw new Error(check.reason);
      // One conversation at a time between any two players, in either
      // direction: two crossing proposals would let both sides "accept" and
      // race.
      if (diplo.allyOffers.some((o) => (o.from === me.figure && o.to === toFig) || (o.from === toFig && o.to === me.figure))) {
        throw new Error("There is already an offer between you");
      }
      diplo.allyOffers.push({ from: me.figure, to: toFig });
      events.push({ type: "ally", stage: "propose", from: me.figure, to: toFig });
      break;
    }

    case "ally_accept": {
      const fromFig = payload.from;
      const offerIdx = diplo.allyOffers.findIndex((o) => o.from === fromFig && o.to === me.figure);
      if (offerIdx < 0) throw new Error("There is no offer to answer");
      // Re-validated at accept time, not just at propose time: the proposer
      // (or me) could have gone bankrupt, been branded traitor, or been
      // dragged into a war in the meantime -- `me.figure` first so every
      // sentence that comes back says "you" about whoever tapped Accept.
      const check = canAlly(diplo, players, me.figure, fromFig);
      if (!check.ok) throw new Error(check.reason);
      diplo.allyOffers.splice(offerIdx, 1);
      diplo.alliances.push({ a: fromFig, b: me.figure, since: diplo.round });
      // Both are spoken for now, so every OTHER proposal either of them was
      // part of is dead on arrival.
      purgeAllyOffersOf(fromFig);
      purgeAllyOffersOf(me.figure);
      events.push({ type: "ally", stage: "form", a: fromFig, b: me.figure });
      break;
    }

    case "ally_decline": {
      const fromFig = payload.from;
      const offerIdx = diplo.allyOffers.findIndex((o) => o.from === fromFig && o.to === me.figure);
      if (offerIdx < 0) throw new Error("There is no offer to answer");
      diplo.allyOffers.splice(offerIdx, 1);
      events.push({ type: "ally", stage: "decline", from: fromFig, to: me.figure });
      break;
    }

    case "ally_cancel": {
      const toFig = payload.to;
      const offerIdx = diplo.allyOffers.findIndex((o) => o.from === me.figure && o.to === toFig);
      if (offerIdx < 0) throw new Error("There is no offer to cancel");
      diplo.allyOffers.splice(offerIdx, 1);
      events.push({ type: "ally", stage: "cancel", from: me.figure, to: toFig });
      break;
    }

    case "ally_break": {
      if (me.order !== turn) throw new Error("You can only break an alliance on your turn");
      if (phase !== "roll" && phase !== "act") throw new Error("You cannot do that right now");
      const otherFig = allyOf(diplo, me.figure);
      if (!otherFig) throw new Error("You are not in an alliance");
      diplo.alliances = diplo.alliances.filter((al) => al.a !== me.figure && al.b !== me.figure);
      events.push({ type: "ally", stage: "break", figure: me.figure, other: otherFig });
      break;
    }

    // ---------------------------------------------------------------------
    // Diplomacy: war (spec §2). war_declare/peace_propose are "own turn";
    // peace_accept/decline are "any time", for the same reason the ally
    // answers above are.
    // ---------------------------------------------------------------------

    case "war_declare": {
      if (me.order !== turn) throw new Error("You can only declare war on your turn");
      if (phase !== "roll" && phase !== "act") throw new Error("You cannot do that right now");
      const target = payload.target;
      const check = canDeclareWar(diplo, players, me.figure, target, me.money);
      if (!check.ok) throw new Error(check.reason);
      // The fee is guaranteed affordable by canDeclareWar()'s own check just
      // above, so this can never trip charge()'s bankruptcy/shared-debt
      // branch -- it is reused purely for its "pay" event shape, the same
      // way casino_play reuses it for a bet that is always affordable too.
      // Straight to the bank, never the pot: 'warFee' is not a POT_REASON,
      // and it is deliberately not in FORCED_CHARGE_REASONS either -- a
      // declaration is a price paid for a status, not a fine the table
      // shares, exactly like every other voluntary spend.
      charge(players, board, meIdx, WAR_FEE, null, "warFee", null, events);
      const war = {
        id: seq,
        declarer: me.figure,
        target,
        startRound: diplo.round,
        endsRound: diplo.round + WAR_ROUNDS,
        peace: null,
      };
      diplo.wars.push(war);
      const sides = warSides(diplo, war);
      events.push({
        type: "war",
        stage: "declare",
        declarer: me.figure,
        target,
        sideA: sides.a,
        sideB: sides.b,
        endsRound: war.endsRound,
      });
      break;
    }

    case "peace_propose": {
      if (me.order !== turn) throw new Error("You can only offer peace on your turn");
      if (phase !== "roll" && phase !== "act") throw new Error("You cannot do that right now");
      const war = diplo.wars.find((w) => w.id === payload.warId);
      if (!war) throw new Error("There is no such war");
      if (war.declarer !== me.figure && war.target !== me.figure) {
        throw new Error("Only the two sides can make peace");
      }
      const amount = Number(payload.amount ?? 0);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("A peace payment cannot be negative");
      if (amount !== Math.trunc(amount)) throw new Error("The payment must be a whole number");
      if (amount > me.money) throw new Error("You do not have that much cash");
      war.peace = { from: me.figure, amount };
      events.push({ type: "war", stage: "peaceOffer", warId: war.id, from: me.figure, amount });
      break;
    }

    case "peace_accept": {
      const war = diplo.wars.find((w) => w.id === payload.warId);
      if (!war) throw new Error("There is no such war");
      if (!war.peace) throw new Error("There is no peace offer to answer");
      const otherPrincipal = war.declarer === war.peace.from ? war.target : war.declarer;
      if (me.figure !== otherPrincipal) throw new Error("This offer is not yours to answer");
      const amount = war.peace.amount;
      const fromIdx = players.findIndex((p) => p.figure === war.peace.from);
      if (fromIdx < 0) throw new Error("That player is not in this room");
      // The purse can have emptied between the offer and the answer.
      // Refusing here (rather than clamping to whatever is left) leaves the
      // offer standing so the other side can decline it instead of quietly
      // getting less than they were promised.
      if (amount > 0 && players[fromIdx].money < amount) {
        throw new Error("They can no longer pay what they promised");
      }
      if (amount > 0) {
        players[fromIdx].money -= amount;
        me.money += amount;
        events.push({ type: "pay", figure: war.peace.from, to: me.figure, amount, reason: "peace", cell: null });
      }
      diplo.wars = diplo.wars.filter((w) => w.id !== war.id);
      // Peace covers both whole sides, which needs no extra work: the sides
      // only ever existed as a live reading of this one war row.
      events.push({ type: "war", stage: "peace", warId: war.id, amount });
      break;
    }

    case "peace_decline": {
      const war = diplo.wars.find((w) => w.id === payload.warId);
      if (!war) throw new Error("There is no such war");
      if (!war.peace) throw new Error("There is no peace offer to answer");
      const otherPrincipal = war.declarer === war.peace.from ? war.target : war.declarer;
      if (me.figure !== otherPrincipal) throw new Error("This offer is not yours to answer");
      events.push({ type: "war", stage: "peaceDecline", warId: war.id, from: war.peace.from, amount: war.peace.amount });
      war.peace = null;
      break;
    }

    // ---------------------------------------------------------------------
    // Diplomacy: the backstab gambit (spec §3). Own turn, allied, once ever.
    // ---------------------------------------------------------------------

    case "backstab": {
      if (me.order !== turn) throw new Error("You can only backstab on your turn");
      if (phase !== "roll" && phase !== "act") throw new Error("You cannot do that right now");
      if (me.backstabUsed) throw new Error("You only have one backstab in you");
      const allyFig = allyOf(diplo, me.figure);
      if (!allyFig) throw new Error("You are not in an alliance");
      const allyIdx = players.findIndex((p) => p.figure === allyFig);
      const allyPlayer = allyIdx >= 0 ? players[allyIdx] : null;
      if (!allyPlayer) throw new Error("You are not in an alliance");
      // 15% of what the victim is holding right now, floored. Not a charge:
      // this money cannot bankrupt anybody and never reaches for a shared
      // debt or a third pocket.
      const cut = Math.floor(allyPlayer.money * BACKSTAB_CUT);
      // No separate `ally, stage:'dissolve'` event: the dedicated `backstab`
      // event below already says the alliance broke, and 'backstab' is not
      // one of the dissolve reasons the state shape enumerates -- silent on
      // purpose, the same way mono_ally_dissolve(st, fig) with no reason is.
      diplo.alliances = diplo.alliances.filter((al) => al.a !== me.figure && al.b !== me.figure);
      if (cut > 0) {
        allyPlayer.money -= cut;
        me.money += cut;
        // The ordinary money-movement event (victim "pays" the backstabber)
        // alongside the dedicated `backstab` event just below -- every money
        // movement in this game gets both.
        events.push({ type: "pay", figure: allyFig, to: me.figure, amount: cut, reason: "backstab", cell: null });
      }
      me.traitor = true;
      me.traitorUntil = diplo.round + TRAITOR_ROUNDS;
      me.backstabUsed = true;
      // The brand is permanent, so any proposal the backstabber had out is
      // now impossible.
      purgeAllyOffersOf(me.figure);
      events.push({ type: "backstab", figure: me.figure, victim: allyFig, amount: cut });
      break;
    }

    // Board button: force the turn to the next player. Mirrors
    // 20260919100000_auction_trade.sql's skip_turn exactly -- during an
    // auction it drops whoever is up to bid (a sleeping phone must not
    // freeze the room) instead of moving the game turn; outside one it
    // behaves like the pre-auction skip_turn (cancel a pending trade, next
    // player, phase back to 'roll').
    case "skip_turn": {
      // Unlike new_game/reset_board, skip_turn is NOT allowed once the game
      // is over (mirrors the SQL's own re-check inside its skip_turn branch,
      // even though it also sits outside the general phase==='over' guard
      // above with the other three board-only actions). Board.jsx already
      // disables the button once `over`, so this is unreachable via the UI.
      if (phase === "over") throw new Error("The game is over");
      const auction = gmPrev.auction;
      if (cas && phase === "casino") {
        // A phone that went to sleep at the table must not hold the room: the
        // house lets this one go unplayed and the turn moves on. This is the
        // ONLY way a landing on the casino ends without a bet, and it is a
        // board button -- the player's own phone is never given a way out.
        events.push({ type: "casino", stage: "skipped", figure: cas.figure, cell: cas.cell });
        cas = null;
        if (gmPrev.trade) {
          applyTradeResolution(players, board, gmPrev.trade, "cancelled", events);
          tradeOut = null;
        }
        turn = nextTurn(players, turn);
        doubles = 0;
        phase = "roll";
        events.push({ type: "skip", order: turn });
      } else if (auction && phase === "auction") {
        const targetFig = auction.turn;
        if (targetFig) {
          auction.in = auction.in.filter((f) => f !== targetFig);
          events.push({ type: "drop", figure: targetFig, cell: auction.cell });
        }
        auctionOut = advanceAuction(auction, players, board, events);
        if (!auctionOut) {
          // the auction just ended: back to the starter's turn, unless they
          // are no longer seated (mock never removes players, so this is
          // defensive rather than reachable here)
          const starterStillHere = players.some((p) => p.figure === auction.startedBy);
          phase = starterStillHere ? "act" : "roll";
        } else {
          phase = "auction";
        }
      } else {
        if (gmPrev.trade) {
          applyTradeResolution(players, board, gmPrev.trade, "cancelled", events);
          tradeOut = null;
        }
        turn = nextTurn(players, turn);
        doubles = 0;
        phase = "roll";
        events.push({ type: "skip", order: turn });
      }
      break;
    }

    // Board buttons: fresh board (from the payload's `position`), everyone
    // keeps their seat but money/position/jail/bankrupt all reset, ownership
    // and houses are cleared regardless of what the payload's board carried,
    // turn goes back to player 0, and the log restarts empty -- all mirroring
    // the SQL's `new_game`/`reset_board` branch exactly (money 2500, position
    // = the fresh board's start cell).
    case "new_game":
    case "reset_board": {
      const payloadBoard = payload.position;
      if (!payloadBoard || typeof payloadBoard !== "object") {
        throw new Error(`${action} needs a position object`);
      }
      const startId = findCellOfKind(payloadBoard, "start") ?? 1;
      for (const p of players) {
        p.money = 2500;
        p.position = startId;
        p.inJail = false;
        p.jailTurns = 0;
        p.jailCards = 0;
        p.bankrupt = false;
        // A new game starts nobody allied, at war or branded -- carrying any
        // of that over would not be a new game.
        p.traitor = false;
        p.traitorUntil = 0;
        p.backstabUsed = false;
      }
      const freshBoard = {};
      for (const key of Object.keys(payloadBoard)) {
        const cell = { ...payloadBoard[key] };
        delete cell.houses;
        cell.bought = {};
        for (const f of FIGURES) {
          cell[f] = false;
          cell.bought[f] = false;
        }
        freshBoard[key] = cell;
      }
      for (const p of players) {
        if (freshBoard[startId]) freshBoard[startId][p.figure] = true;
      }
      st.position = freshBoard;
      turn = 0;
      phase = "roll";
      doubles = 0;
      dice = null;
      winner = null;
      winners = [];
      auctionOut = null;
      tradeOut = null;
      // A new game starts with an empty pot and nobody at the tables. The
      // farm's counter comes back at FARM_INCOME_START with the fresh board,
      // since `income` is seeded on the cell by initialState().
      potBox.value = 0;
      cas = null;
      // ...and nobody allied, at war or offering either -- see the diplomacy
      // amendment note on `diplo` itself for why this box exists at all.
      diplo = { alliances: [], allyOffers: [], wars: [], round: 1 };
      logOverride = [];
      events.push({ type: "newGame" });
      break;
    }

    case "leave": {
      // No-op resolve: the harness has nowhere to send a departed player
      // (there is no /Login route here), so just acknowledge. A pending
      // trade involving the leaver is still cleared -- see spec §2 -- but a
      // running auction is left alone; the mock never actually removes
      // players so `in`/`order` never need surgery like the real server's.
      if (gmPrev.trade && (gmPrev.trade.from === me.figure || gmPrev.trade.to === me.figure)) {
        applyTradeResolution(players, board, gmPrev.trade, "cancelled", events);
        tradeOut = null;
      }
      // "A bankrupt OR DEPARTED player's alliance dissolves" (spec §1), and
      // every war they were a PRINCIPAL in ends too -- done here rather than
      // in the end-of-action sweep because the real server is about to splice
      // this player out of `players` entirely, after which nothing could tell
      // "left" from "was never here" (the mock never actually removes a
      // seat, but mirrors the SQL's own placement of this logic anyway).
      dissolveAllianceOf(me.figure, "left", events);
      endWarsOf(me.figure, "left", events);
      purgeAllyOffersOf(me.figure);
      events.push({ type: "leave", figure: me.figure });
      break;
    }

    default:
      throw new Error(`Unknown action ${action}`);
  }

  // Order matches the SQL's tail exactly: bankrupt-skip, the diplomacy
  // bankruptcy sweep and the round-tick all happen first (inside
  // applyEndOfActionChecks); the casino phase is derived next; the win check
  // runs last, because it needs the finished, reconciled player list.
  const checked = applyEndOfActionChecks(players, turn, turn0, phase, action, events);
  let finalPhase = checked.phase;

  // The casino phase is DERIVED, not tracked branch by branch -- the same way
  // the SQL reads the block back out of `st` at the end. A bet can have been
  // opened by a roll, by the debug jump or by a Chance card, and a player who
  // went broke or left on the way there owes the house nothing.
  let casFinal = cas;
  if (casFinal) {
    const ci = players.findIndex((p) => p.figure === casFinal.figure);
    if (ci < 0 || players[ci].bankrupt) casFinal = null;
  }
  if (finalPhase !== "over" && finalPhase !== "auction") {
    if (casFinal) finalPhase = "casino";
    else if (finalPhase === "casino") finalPhase = "act";
  }

  const won = checkWin(players, winner, winners, events);
  if (won.phase === "over") finalPhase = "over";
  // Nothing can be bid on, traded or wagered once somebody has won.
  if (finalPhase === "over") casFinal = null;

  // new_game/reset_board restart the log empty (the SQL resets `gm` to `{}`
  // first) -- everything else concats onto the room's existing history.
  const finalizeGmPrev = logOverride !== undefined ? { ...gmPrev, log: logOverride } : gmPrev;
  return finalize(st, finalizeGmPrev, seq, events, {
    turn: checked.turn,
    phase: finalPhase,
    doubles,
    dice,
    actorId: pid ?? null,
    action,
    winner: won.winner,
    winners: won.winners,
    lastCard,
    auction: auctionOut,
    trade: tradeOut,
    casino: casFinal,
  });
}

// ---------------------------------------------------------------------------
// Unvalidated forced steps: scenario intros, the bot autoplay loop and the
// toolbar's 3 "push a live event" buttons all go through this. It performs a
// real roll (random unless forced) and always broadcasts through the same
// realtime path a genuine update would use.
// ---------------------------------------------------------------------------

function simulateActorStep(
  playerId,
  { forceTarget, forceDoubles, forceCard, buyIfAffordable, maybeAuction, setTurnTo } = {},
) {
  if (!room) return null;
  const st = clone(room);
  const players = st.Players;
  const board = st.position;
  const idx = players.findIndex((p) => p.playerId === playerId);
  if (idx < 0 || players[idx].bankrupt) return null;
  if (setTurnTo != null) st.current_order = setTurnTo;
  // The turn this step starts from -- see applyAction()'s own turn0 for why.
  const turn0 = st.current_order;

  const gmPrev = st.game || {};
  const seq = (gmPrev.seq || 0) + 1;
  const events = [];
  const out = { lastCard: null };
  // Same pot box applyAction() uses, seeded from the row this step starts
  // from: a scenario intro or a bot's roll can land on a tax cell (money IN)
  // or on Free Parking (money OUT), and finalize() reads the running value.
  // Forgetting this line would silently reset the pot on every bot turn.
  potBox = { value: Math.max(Math.round(Number(gmPrev.pot) || 0), 0) };
  // Same reasoning, same box, for the diplomacy layer: a forced roll can land
  // on an ally's street (free), an enemy's (double), or trigger a shared debt
  // just like a real roll can -- land()/charge() both read `diplo`, and
  // forgetting this line would silently drop every alliance/war on the next
  // bot turn.
  diplo = {
    alliances: Array.isArray(gmPrev.alliances) ? clone(gmPrev.alliances) : [],
    allyOffers: Array.isArray(gmPrev.allyOffers) ? clone(gmPrev.allyOffers) : [],
    wars: Array.isArray(gmPrev.wars) ? clone(gmPrev.wars) : [],
    round: Number.isInteger(gmPrev.round) && gmPrev.round > 0 ? gmPrev.round : 1,
  };
  const r = performRoll(board, players, idx, events, gmPrev.doubles || 0, out, {
    forceTarget,
    forceDoubles,
    forceCard,
  });

  let auctionOut;
  let landedPhase = "act";
  if (buyIfAffordable) {
    const cell = board[players[idx].position];
    const price = priceOf(cell);
    // small buffer so a bot doesn't spend down to zero
    if (price != null && !ownerOf(cell) && players[idx].money >= price + 100) {
      cell.bought[players[idx].figure] = true;
      players[idx].money -= price;
      events.push({ type: "buy", figure: players[idx].figure, cell: players[idx].position, amount: price });
    } else if (maybeAuction && price != null && !ownerOf(cell) && Math.random() < 0.5) {
      // A bot that skips buying starts an auction about half the time, so
      // the human gets to bid from the "waiting" side too (task brief §2).
      auctionOut = buildAuction(players, players[idx].figure, cell.id);
      events.push({ type: "auction_start", figure: players[idx].figure, cell: cell.id });
      landedPhase = "auction";
    }
  }

  const checked = applyEndOfActionChecks(players, st.current_order, turn0, landedPhase, "roll", events);
  // A forced step can land on the Casino too, and when it does the room owes
  // the house a bet exactly as it would after a real roll. The bot loop knows
  // what to do about that (it plays the minimum -- see runBotLoop), and the
  // human's own phone gets the panel. Never while an auction is running:
  // `landedPhase` has already decided that case.
  let casFinal = out.casino ?? null;
  let finalPhase = checked.phase;
  if (casFinal) {
    const ci = players.findIndex((p) => p.figure === casFinal.figure);
    if (ci < 0 || players[ci].bankrupt) casFinal = null;
  }
  if (finalPhase !== "over" && finalPhase !== "auction" && casFinal) finalPhase = "casino";

  const winnersPrev = Array.isArray(gmPrev.winners) ? gmPrev.winners : [];
  const won = checkWin(players, gmPrev.winner || null, winnersPrev, events);
  if (won.phase === "over") finalPhase = "over";
  if (finalPhase === "over") casFinal = null;

  const row = finalize(st, gmPrev, seq, events, {
    turn: checked.turn,
    phase: finalPhase,
    doubles: r.doubles,
    dice: r.dice,
    actorId: playerId,
    action: "roll",
    winner: won.winner,
    winners: won.winners,
    lastCard: out.lastCard,
    auction: auctionOut,
    casino: casFinal,
  });
  emit(row);
  afterStateChange(row);
  return row;
}

// A bot that landed on the Casino settles up.
//
// It has to: the bet is MANDATORY, so a bot left standing at the tables would
// hold phase 'casino' forever and every other phone in the room would be told
// "The casino is waiting" until the tab was reloaded. It plays the minimum,
// which is the smallest thing that clears the block, and picks a game at
// random so the harness sees all three animations over a few laps.
//
// Deliberately goes through applyAction rather than poking the row: the mock's
// casino_play is where the spin, the two ledger movements and the phase change
// live, and a bot taking a shortcut around them would stop testing the path
// the human's own tap takes.
function playBotCasino(playerId) {
  if (!room) return null;
  const game = CASINO_GAMES[Math.floor(Math.random() * CASINO_GAMES.length)];
  const colours = ["red", "black", "green"];
  const player = room.Players.find((p) => p.playerId === playerId);
  const bet = casinoMinBet(player?.money ?? 0);
  if (bet <= 0) return null;
  try {
    const row = applyAction(room, "casino_play", {
      playerId,
      game,
      bet,
      colour: colours[Math.floor(Math.random() * colours.length)],
    });
    emit(row);
    afterStateChange(row);
    return row;
  } catch {
    return null; // never let a bad bot state throw inside a timer
  }
}

// Whoever is at the tables right now, if anybody, and only when they are a bot.
// Returns the row it produced, or null when there was nothing to do.
function settleCasinoForBots() {
  const cas = room?.game?.casino;
  if (!cas || room.game.phase !== "casino") return null;
  const who = room.Players.find((p) => p.figure === cas.figure);
  if (!who || who.playerId === ME_PLAYER_ID) return null;
  return playBotCasino(who.playerId);
}

// After the human ends their turn, play the bots' turns for them with ~1s
// beats between each broadcast, exactly like watching real opponents act,
// until it is the human's turn again (or the game ends, or a safety cap is
// hit -- a bot chaining doubles forever should not hang the tab).
async function runBotLoop(token) {
  const MAX_STEPS = 25;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (token !== autoplayToken || !room) return;
    const current = room.Players.find((p) => p.order === room.current_order);
    if (!current || current.playerId === ME_PLAYER_ID || current.bankrupt) return;
    if ((room.game || {}).phase === "over") return;

    await delay(850 + Math.random() * 300);
    if (token !== autoplayToken || !room) return;
    const rolled = simulateActorStep(current.playerId, { buyIfAffordable: true, maybeAuction: true });
    if (!rolled || rolled.game.phase === "over") return;

    // The bot landed on the Casino. Let the human's phone see the panel's
    // spectator side for a beat, then play the minimum and clear the block —
    // the bet is mandatory, so nothing else in the room can move until it is.
    if (rolled.game.phase === "casino") {
      await delay(900);
      if (token !== autoplayToken || !room) return;
      const played = settleCasinoForBots();
      if (played?.game?.phase === "over") return;
    }

    if (rolled.game.phase === "auction") {
      // The bot itself started this auction (didn't buy, rolled the ~50%).
      // Bidding may involve the human, so just wait -- the auction's own
      // bot-vs-bot/bot-vs-human chain is driven independently by
      // scheduleAuctionBotIfNeeded()'s timers, not by this loop.
      while (token === autoplayToken && room && room.game?.phase === "auction") {
        await delay(300);
      }
      if (token !== autoplayToken || !room) return;
      if (room.game?.phase === "over") return;
    }

    await delay(850 + Math.random() * 300);
    if (token !== autoplayToken || !room) return;
    let ended;
    try {
      ended = applyAction(room, "end_turn", { playerId: current.playerId });
    } catch {
      return; // defensive: never let a bad bot state throw inside a timer
    }
    emit(ended);
    afterStateChange(ended);
  }
}

function scheduleBotAutoplay() {
  const token = ++autoplayToken;
  runBotLoop(token);
}

// ---------------------------------------------------------------------------
// `tv-autoplay`: every seat is a bot (no playerId equals ME_PLAYER_ID), so
// there is no human turn to stop for -- the loop just keeps going, forever,
// with an occasional bot-to-bot trade thrown in. Deliberately a separate
// function from runBotLoop() above rather than a couple of extra flags on
// it: runBotLoop is the well-exercised "play out the bots after a human ends
// their turn" path every other scenario relies on, and it is not worth the
// risk of a regression there to grow it for a demo mode that only one
// scenario uses.
// ---------------------------------------------------------------------------

function scheduleAutoplayDemo() {
  const token = ++autoplayToken;
  runAutoplayLoop(token);
}

// One bot proposes a trade to another bot, roughly like a human composing
// one in TradeSheet: a tradable cell of theirs for a bit of cash. Returns
// true if an offer was actually created. The answering side is handled by
// the existing scheduleTradeBotIfNeeded()/decideTradeBot() machinery -- it
// only special-cases ME_PLAYER_ID, and nobody in this scenario has that id.
function maybeStartBotTrade(actor) {
  if (!room) return false;
  const g = room.game || {};
  if (g.trade || g.phase !== "act") return false;
  const board = room.position;
  const mine = tradableOwnedByFig(board, actor.figure);
  if (!mine.length) return false;
  const others = room.Players.filter((p) => p.figure !== actor.figure && !p.bankrupt);
  if (!others.length) return false;
  const target = others[Math.floor(Math.random() * others.length)];
  const cell = mine[Math.floor(Math.random() * mine.length)];
  const price = priceOf(board[cell.id]) || 100;
  const askCash = Math.max(10, Math.round((price * (0.7 + Math.random() * 0.6)) / 10) * 10);
  const give = { cells: [cell.id], cash: 0 };
  const get = { cells: [], cash: Math.min(askCash, Math.max(0, Math.floor((target.money || 0) * 0.6 / 10) * 10)) };
  if (get.cash <= 0) return false;
  try {
    const row = applyAction(room, "trade_offer", { playerId: actor.playerId, to: target.figure, give, get });
    emit(row);
    afterStateChange(row);
    return true;
  } catch {
    return false; // e.g. the cell stopped being tradable a beat ago -- skip this round
  }
}

async function runAutoplayLoop(token) {
  const BEAT = 1200;
  for (;;) {
    if (token !== autoplayToken || !room) return;
    const current = room.Players.find((p) => p.order === room.current_order);
    if (!current || current.bankrupt) return;
    if ((room.game || {}).phase === "over") return; // one winner: the demo has run its course

    await delay(BEAT * 0.6 + Math.random() * BEAT * 0.4);
    if (token !== autoplayToken || !room) return;
    const rolled = simulateActorStep(current.playerId, { buyIfAffordable: true, maybeAuction: true });
    if (!rolled || rolled.game.phase === "over") return;

    // Every seat here is a bot, so the Casino always settles itself. Without
    // this the TV demo would stop dead the first time anyone landed on 13.
    if (rolled.game.phase === "casino") {
      await delay(900);
      if (token !== autoplayToken || !room) return;
      const played = settleCasinoForBots();
      if (played?.game?.phase === "over") return;
    }

    if (rolled.game.phase === "auction") {
      // Auctions always terminate (every bid/drop strictly shrinks `in` or
      // raises `bid`) -- no safety cap needed, unlike the trade wait below.
      while (token === autoplayToken && room && room.game?.phase === "auction") {
        await delay(250);
      }
      if (token !== autoplayToken || !room) return;
      if (room.game?.phase === "over") return;
    } else if (Math.random() < 0.18) {
      if (maybeStartBotTrade(current)) {
        let waited = 0;
        while (token === autoplayToken && room && room.game?.trade && waited < 60) {
          await delay(300);
          waited += 1;
        }
        if (token !== autoplayToken || !room) return;
        if (room.game?.trade) {
          // Safety valve: a counter/counter ping-pong that never converges
          // must not stall the whole demo. Decline whichever side is asked.
          const stuck = room.game.trade;
          const answerer = room.Players.find((p) => p.figure === stuck.to);
          if (answerer) {
            try {
              const declined = applyAction(room, "trade_decline", { playerId: answerer.playerId });
              emit(declined);
              afterStateChange(declined);
            } catch {
              /* best-effort: worst case the trade sits one extra beat */
            }
          }
        }
      }
    }

    await delay(BEAT * 0.6 + Math.random() * BEAT * 0.4);
    if (token !== autoplayToken || !room) return;
    let ended;
    try {
      ended = applyAction(room, "end_turn", { playerId: current.playerId });
    } catch {
      return;
    }
    emit(ended);
    afterStateChange(ended);
  }
}

// ---------------------------------------------------------------------------
// Auction/trade bot brains. Scheduled from afterStateChange() (called after
// every emit()), so any code path that changes game.auction/game.trade --
// a real action, a bot's own move, a scenario intro, or a toolbar button --
// automatically keeps the right bot's clock running.
// ---------------------------------------------------------------------------

function afterStateChange(row) {
  if (!row) return;
  const g = row.game || {};
  if (g.phase === "auction" && g.auction) scheduleAuctionBotIfNeeded(row);
  if (g.phase === "casino" && g.casino) scheduleCasinoBotIfNeeded(row);
  if (g.trade) scheduleTradeBotIfNeeded(row);
  scheduleAllyBotIfNeeded(row);
  schedulePeaceBotIfNeeded(row);
}

// A bot on the receiving end of an alliance proposal always declines it
// (SPEC-DIPLOMACY.md's bot brief). Without this a proposal to a bot would sit
// in game.allyOffers forever -- nothing else in this file ever answers on a
// bot's behalf, and a human phone has no button that could stand in for one.
// Same "one pending timer, re-checked as stale before it fires" pattern as
// scheduleAuctionBotIfNeeded/scheduleTradeBotIfNeeded above.
function scheduleAllyBotIfNeeded(row) {
  const offers = Array.isArray(row.game?.allyOffers) ? row.game.allyOffers : [];
  const offer = offers.find((o) => {
    const bot = row.Players.find((p) => p.figure === o.to);
    return bot && bot.playerId !== ME_PLAYER_ID && !bot.bankrupt;
  });
  if (!offer) {
    if (pendingAllyBotTimer) clearTimeout(pendingAllyBotTimer.timer);
    pendingAllyBotTimer = null;
    return;
  }
  const key = `${offer.from}|${offer.to}`;
  if (pendingAllyBotTimer && pendingAllyBotTimer.key === key) return;
  if (pendingAllyBotTimer) clearTimeout(pendingAllyBotTimer.timer);
  const bot = row.Players.find((p) => p.figure === offer.to);
  const run = () => {
    pendingAllyBotTimer = null;
    if (!room) return;
    const stillPending = (room.game?.allyOffers || []).some((o) => o.from === offer.from && o.to === offer.to);
    if (!stillPending) return; // stale: already answered some other way
    gameAction(room.uuid, "ally_decline", { playerId: bot.playerId, from: offer.from }).catch(() => {});
  };
  pendingAllyBotTimer = { timer: setTimeout(run, 900 + Math.random() * 400), key, run };
}

// A bot that is a war principal always accepts a peace offer put to it -- the
// mirror image of scheduleAllyBotIfNeeded above, same reasoning: a peace
// offer sitting on a bot's war would otherwise hang that war (and the room)
// forever.
function schedulePeaceBotIfNeeded(row) {
  const wars = Array.isArray(row.game?.wars) ? row.game.wars : [];
  const war = wars.find((w) => {
    if (!w.peace) return false;
    const otherFig = w.declarer === w.peace.from ? w.target : w.declarer;
    const bot = row.Players.find((p) => p.figure === otherFig);
    return bot && bot.playerId !== ME_PLAYER_ID && !bot.bankrupt;
  });
  if (!war) {
    if (pendingPeaceBotTimer) clearTimeout(pendingPeaceBotTimer.timer);
    pendingPeaceBotTimer = null;
    return;
  }
  const key = `${war.id}|${war.peace.from}|${war.peace.amount}`;
  if (pendingPeaceBotTimer && pendingPeaceBotTimer.key === key) return;
  if (pendingPeaceBotTimer) clearTimeout(pendingPeaceBotTimer.timer);
  const otherFig = war.declarer === war.peace.from ? war.target : war.declarer;
  const bot = row.Players.find((p) => p.figure === otherFig);
  const run = () => {
    pendingPeaceBotTimer = null;
    if (!room) return;
    const cur = (room.game?.wars || []).find((w) => w.id === war.id);
    if (!cur || !cur.peace) return; // stale: already resolved some other way
    gameAction(room.uuid, "peace_accept", { playerId: bot.playerId, warId: war.id }).catch(() => {});
  };
  pendingPeaceBotTimer = { timer: setTimeout(run, 900 + Math.random() * 400), key, run };
}

// A BOT standing at the tables has to be made to bet, from wherever the
// landing came from: a scenario intro, one of the toolbar's "push a live
// event" buttons, or a bot loop. The two loops handle their own case inline
// (they have to await it before calling end_turn), so this is the safety net
// for every other path -- without it, a scenario intro that happened to roll
// onto cell 13 for somebody else would freeze the harness with "The casino is
// waiting" on every button.
//
// Never for the human: their phone is the whole point of the feature, and the
// panel is waiting for them.
function scheduleCasinoBotIfNeeded(row) {
  const cas = row.game?.casino;
  if (!cas) return;
  const player = row.Players.find((p) => p.figure === cas.figure);
  if (!player || player.playerId === ME_PLAYER_ID || player.bankrupt) return;
  const key = `${cas.cell}|${cas.figure}|${row.game.seq}`;
  if (pendingCasinoBotTimer && pendingCasinoBotTimer.key === key) return;
  if (pendingCasinoBotTimer) clearTimeout(pendingCasinoBotTimer.timer);
  const run = () => {
    pendingCasinoBotTimer = null;
    // stale check: the loops may already have settled it
    if (!room || room.game?.phase !== "casino") return;
    if (room.game?.casino?.figure !== cas.figure) return;
    playBotCasino(player.playerId);
  };
  pendingCasinoBotTimer = { timer: setTimeout(run, 1100), key, run };
}

function scheduleAuctionBotIfNeeded(row) {
  const auction = row.game?.auction;
  if (!auction) return;
  const turnFig = auction.turn;
  const player = row.Players.find((p) => p.figure === turnFig);
  if (!player || player.playerId === ME_PLAYER_ID || player.bankrupt) return;
  const key = `${auction.cell}|${turnFig}|${auction.bid}|${auction.in.length}`;
  if (pendingAuctionBotTimer && pendingAuctionBotTimer.key === key) return;
  if (pendingAuctionBotTimer) clearTimeout(pendingAuctionBotTimer.timer);
  const cell = auction.cell;
  const run = () => {
    pendingAuctionBotTimer = null;
    if (!room) return;
    const cur = room.game?.auction;
    if (!cur || cur.cell !== cell || cur.turn !== turnFig) return; // stale: re-check before acting
    decideAuctionBot(room, cur, player);
  };
  const ms = 900 + Math.random() * 500;
  pendingAuctionBotTimer = { timer: setTimeout(run, ms), key, run };
}

function decideAuctionBot(current, auction, player) {
  const board = current.position;
  const cell = board[auction.cell];
  const price = priceOf(cell) || 0;
  const limitKey = `${auction.cell}|${player.figure}`;
  if (!(limitKey in auctionBotLimits)) {
    const pct = 0.55 + Math.random() * 0.6; // 55%-115% of list price
    let limit = Math.round((price * pct) / 10) * 10;
    limit = Math.min(limit, player.money - 50); // never above money - 50
    auctionBotLimits[limitKey] = Math.max(limit, 0);
  }
  const limit = auctionBotLimits[limitKey];
  const minNext = auction.bid > 0 ? auction.bid + AUCTION_MIN_RAISE : AUCTION_MIN_RAISE;
  let amount = null;
  if (minNext <= limit && minNext <= player.money) {
    const roll = Math.random();
    const raise = roll > 0.95 ? 50 : roll > 0.8 ? 20 : 10;
    let candidate = auction.bid > 0 ? auction.bid + raise : Math.max(raise, AUCTION_MIN_RAISE);
    candidate = Math.floor(Math.min(candidate, limit, player.money) / 10) * 10;
    if (candidate >= minNext) amount = candidate;
  }
  if (amount != null) {
    gameAction(current.uuid, "auction_bid", { playerId: player.playerId, amount }).catch(() => {});
  } else {
    gameAction(current.uuid, "auction_drop", { playerId: player.playerId }).catch(() => {});
  }
}

function scheduleTradeBotIfNeeded(row) {
  const trade = row.game?.trade;
  if (!trade) return;
  const bot = row.Players.find((p) => p.figure === trade.to);
  if (!bot || bot.playerId === ME_PLAYER_ID || bot.bankrupt) return;
  const key = trade.id;
  if (pendingTradeBotTimer && pendingTradeBotTimer.key === key) return;
  if (pendingTradeBotTimer) clearTimeout(pendingTradeBotTimer.timer);
  const run = () => {
    pendingTradeBotTimer = null;
    if (!room) return;
    const cur = room.game?.trade;
    if (!cur || cur.id !== key) return; // stale: the trade resolved already
    decideTradeBot(room, cur, bot);
  };
  const ms = tradeBotDelayMs != null ? tradeBotDelayMs : 1500 + Math.random() * 400;
  pendingTradeBotTimer = { timer: setTimeout(run, ms), key, run };
}

function decideTradeBot(current, trade, bot) {
  const board = current.position;
  const listPrice = (cellId) => priceOf(board[cellId]) || 0;
  const valueOfSide = (side) => side.cells.reduce((s, cid) => s + listPrice(cid), 0) + side.cash;
  // From the bot's (the answering `to` side's) point of view: it receives
  // `trade.give` and hands over `trade.get`.
  const net = valueOfSide(trade.give) - valueOfSide(trade.get);
  const canPay = trade.get.cash <= bot.money;
  if (net >= 0 && canPay) {
    gameAction(current.uuid, "trade_accept", { playerId: bot.playerId }).catch(() => {});
    return;
  }
  if (Math.random() < 0.25) {
    // Counter instead of declining outright: ask for +20-60$ more cash than
    // the offer already had, keeping the same properties on both sides.
    const delta = 20 + Math.floor(Math.random() * 5) * 10;
    const give = { cells: [...trade.get.cells], cash: trade.get.cash };
    const get = { cells: [...trade.give.cells], cash: trade.give.cash + delta };
    gameAction(current.uuid, "trade_counter", { playerId: bot.playerId, give, get }).catch(() => {});
    return;
  }
  gameAction(current.uuid, "trade_decline", { playerId: bot.playerId }).catch(() => {});
}

// Crafts a trade event as a live push without a preceding validated
// trade_offer -- used by scenario intros ("Koli's offer lands 600ms after
// the room loads") and the "bot offers me a trade" toolbar button. `status`
// "accepted"/"declined"/... resolves (or clears) the trade in the same step,
// so a scenario can show a finished result with no setup of its own.
function injectTradeEvent(partialTrade, status) {
  if (!room) return null;
  const st = clone(room);
  const players = st.Players;
  const board = st.position;
  const gmPrev = st.game || {};
  const seq = (gmPrev.seq || 0) + 1;
  const trade = { id: seq, counter: false, ...partialTrade };
  const events = [];
  applyTradeResolution(players, board, trade, status, events);
  const newTrade = status === "offered" || status === "countered" ? trade : null;
  const row = finalize(st, gmPrev, seq, events, {
    turn: st.current_order,
    phase: gmPrev.phase || "act",
    doubles: gmPrev.doubles || 0,
    dice: gmPrev.dice ?? null,
    actorId: trade.from,
    action: `trade_${status}`,
    winner: gmPrev.winner ?? null,
    winners: Array.isArray(gmPrev.winners) ? gmPrev.winners : [],
    lastCard: null,
    trade: newTrade,
  });
  emit(row);
  afterStateChange(row);
  return row;
}

// ---------------------------------------------------------------------------
// The exported surface. Same 5 names as src/Hooks/supabase.jsx.
// ---------------------------------------------------------------------------

export function useFetch(uuid) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!uuid) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchRoom(uuid).then(({ data: d, error: err }) => {
      if (cancelled) return;
      setData(d);
      setError(err?.message ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  // Mirrors the real module: the fourth member of the return value, so a
  // screen built on useFetch (the Board, the Login page) can hand it to
  // useRealtimeUpdates as the resync callback. See src/Hooks/supabase.jsx.
  const refetch = useCallback(async () => {
    if (!uuid) return;
    const { data: d, error: err } = await fetchRoom(uuid);
    if (err) {
      if (!err.network) setError(err.message);
      return;
    }
    setError(null);
    setData(d);
  }, [uuid]);

  return { data, error, loading, refetch };
}

export async function fetchRoom(uuid) {
  if (fetchMode === "hang") return new Promise(() => {}); // never resolves, by design
  if (fetchMode === "error") {
    // A server-side failure: it answered, it said no. `network` stays false so
    // the phone still shows the message verbatim.
    return {
      data: null,
      error: { message: "Failed to fetch room (mock fetch-error scenario)", network: false },
    };
  }
  if (mockDropped) {
    await delay(60);
    return {
      data: null,
      error: { message: "TypeError: Failed to fetch", network: true },
    };
  }
  await delay(120);
  if (!room || room.uuid !== uuid) return { data: null, error: null };
  return { data: clone(room), error: null };
}

export async function gameAction(uuid, action, payload = {}) {
  // Linked mode, TV half: never run applyAction against this iframe's own
  // local `room` -- forward the attempt to the phone (the authority) and let
  // its published row come back over the link bridge instead. Optimistic
  // return: `data` is whatever we last mirrored, same shape a real reply has.
  if (linkRole === "follower") {
    linkForwardAction(uuid, action, payload);
    return { data: room ? clone(room) : null, error: null };
  }
  await delay(actionDelay());
  // Simulated network cut: the request never reaches a server, so there is no
  // rule message to show -- `network: true` is what makes the phone say
  // "Connection problem — try again" instead of quoting a fetch error. It is
  // also why nothing is retried: the mock, like the real RPC, is not
  // idempotent, and a dropped REPLY is indistinguishable from a dropped
  // request.
  if (mockDropped) {
    return { data: null, error: { message: "TypeError: Failed to fetch", network: true } };
  }
  if (!room || room.uuid !== uuid) {
    return { data: null, error: { message: `Room ${uuid} not found`, network: false } };
  }
  if (pendingActionError) {
    const message = pendingActionError;
    pendingActionError = null; // one-shot, like the real "next action rejects"
    console.error(`[mock] game_action ${action} failed for room ${uuid}: ${message}`);
    return { data: null, error: { message, network: false } };
  }
  try {
    const newRow = applyAction(room, action, payload);
    emit(newRow); // the commit; the change event may be delivered later
    afterStateChange(newRow);
    if (action === "end_turn") scheduleBotAutoplay();
    // The return leg. Everything above has already happened as far as the
    // server and every other client is concerned -- including a fetch issued
    // by this same phone, which is the window the resync race lives in.
    if (replyLag > 0) await delay(replyLag);
    return { data: clone(newRow), error: null };
  } catch (e) {
    const message = e?.message || String(e);
    console.error(`[mock] game_action ${action} failed for room ${uuid}: ${message}`);
    return { data: null, error: { message, network: false } };
  }
}

// ---------------------------------------------------------------------------
// Simulated connection drop (dev only, not part of the real supabase module).
//
//   window.__mockConn.drop()      pull the cable: every open channel is told
//                                 CHANNEL_ERROR, no realtime event is
//                                 delivered, fetches and actions fail as
//                                 network errors. The badge goes to
//                                 "Reconnecting…" and the backoff starts.
//   window.__mockConn.restore()   plug it back in. The next rebuild subscribes
//                                 successfully, which resyncs the room --
//                                 including anything `stepWhileDown()` did
//                                 while the phone could not hear it.
//   window.__mockConn.latency(ms) how long the socket takes to DELIVER an
//                                 UPDATE (the commit itself stays instant, so
//                                 a fetch always sees the new row at once).
//                                 Default 0, which is synchronous delivery --
//                                 and synchronous delivery is exactly why the
//                                 mock could never show the resync race that
//                                 cost real phones their roll: here the
//                                 Realtime echo always beat both the RPC reply
//                                 and any refetch. Against a hosted project
//                                 the echo is the SLOWEST of the three. Set it
//                                 to a second or two to get the real ordering.
//   window.__mockConn.channels()  how many subscriptions exist right now. Must
//                                 be exactly 1 for a mounted screen, drop or
//                                 no drop -- that is the duplicate-channel
//                                 leak check.
//
// Deliberately on `window` rather than in the toolbar: the UI agents want it
// for screenshots and the headless check wants it for assertions, and neither
// should need a button that ships nowhere.
// ---------------------------------------------------------------------------
export const mockConn = {
  drop() {
    if (mockDropped) return;
    mockDropped = true;
    for (const ch of mockChannels) {
      if (ch.alive) ch.onStatus("CHANNEL_ERROR");
    }
  },
  restore() {
    mockDropped = false;
    // No status is pushed here on purpose. A real socket does not announce
    // that the Wi-Fi is back -- it is the client's own retry that discovers
    // it. Letting connection.js's watchdog find it keeps the harness honest.
  },
  isDropped() {
    return mockDropped;
  },
  latency(ms) {
    if (ms !== undefined) realtimeLatency = Math.max(0, Number(ms) || 0);
    return realtimeLatency;
  },
  // The RPC's return leg (see `replyLag`). Together with latency() this gives
  // the mock the same three-way ordering a hosted project has: commit first,
  // our own reply second, the socket last.
  replyLag(ms) {
    if (ms !== undefined) replyLag = Math.max(0, Number(ms) || 0);
    return replyLag;
  },
  channels() {
    return mockChannels.size;
  },
  // Lifetime count of subscriptions opened. `channels()` says how many exist
  // now (must be 1); this says how many were ever built, which is what proves
  // a rebuild actually happened rather than the status just being relabelled.
  opened() {
    return mockOpened;
  },
  // Apply a real action as somebody else while this phone is cut off, so the
  // resync after reconnecting has something to actually catch up on.
  stepWhileDown(action, payload = {}) {
    if (!room) return null;
    const newRow = applyAction(room, action, payload);
    emit(newRow); // listeners are gated on mockDropped, so nothing is delivered
    afterStateChange(newRow);
    return clone(newRow);
  },
  seq() {
    return room?.game?.seq ?? null;
  },
};

// Published from here, not from the harness entry points, so every mock page
// (client, tv, login) gets it without any of those files changing.
if (typeof window !== "undefined") window.__mockConn = mockConn;

// Matches the real module's `createGame(position, makeCode, attempts)`
// signature exactly (src/Hooks/supabase.jsx): the TV's "Host New Game" calls
// `createGame(initialState(), () => short.rnd())`, so a fresh mock room must
// use whatever code `makeCode()` hands back, not the fixed ROOM_UUID -- a
// second hosted room in the same tab must not collide with the first.
export async function createGame(position, makeCode) {
  const uuid = typeof makeCode === "function" ? makeCode() : ROOM_UUID;
  room = {
    uuid,
    position,
    Players: [],
    current_order: 0,
    game: {
      seq: 0,
      phase: "roll",
      doubles: 0,
      dice: null,
      actor: null,
      action: null,
      events: [],
      lastCard: null,
      winner: null,
      auction: null,
      trade: null,
      log: [],
    },
  };
  return { uuid, error: null };
}

// Same signature and same return value as the real one: `onResync` is the
// caller's refetch, and the hook hands back `conn` for <ConnectionBadge>. The
// whole state machine (status names, backoff, visibility/online/pageshow
// resync, heartbeat) is the SHARED one in src/Hooks/connection.js -- this file
// only supplies "how to open a subscription", so the reconnect behaviour the
// harness previews is genuinely the behaviour the phones will get.
//
// `mockChannels` is the stand-in for supabase.getChannels(): the headless
// checks assert there is exactly one entry after a drop/reconnect cycle.
export function useRealtimeUpdates(uuid, callback, onResync) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  const connect = useCallback(
    ({ onStatus }) => {
      const channel = { uuid, onStatus, alive: true };
      const fn = (payload) => {
        if (mockDropped || !channel.alive) return; // cable unplugged
        if (room && room.uuid === uuid) cbRef.current?.(payload);
      };
      channel.fn = fn;
      listeners.add(fn);
      mockChannels.add(channel);
      mockOpened += 1;
      // A real subscribe is a round trip; a zero-delay timeout is close
      // enough, and it lets a drop taken during the handshake behave like one.
      const t = setTimeout(() => {
        if (!channel.alive) return;
        onStatus(mockDropped ? "CHANNEL_ERROR" : "SUBSCRIBED");
      }, 0);
      return () => {
        channel.alive = false;
        clearTimeout(t);
        listeners.delete(fn);
        mockChannels.delete(channel);
      };
    },
    [uuid],
  );

  return useRealtimeConnection(uuid, connect, onResync);
}

// ---------------------------------------------------------------------------
// Dev-only namespace. Not part of the real supabase module; only
// src/dev/clientHarness.jsx imports this.
// ---------------------------------------------------------------------------

function scenarioMeta(name) {
  return {
    name,
    label: SCENARIOS[name].label,
    describe: SCENARIOS[name].describe,
    noRoom: !!SCENARIOS[name].noRoom,
    // Login-only (src/dev/loginHarness.jsx): what this scenario wants in
    // localStorage before the Login screen's very first render -- the room
    // code it finds prefilled, and the playerInfo that decides whether it is
    // a returning player. `null` for every other scenario.
    login: SCENARIOS[name].login ?? null,
  };
}

export const mockDev = {
  scenarios: SCENARIO_NAMES.map(scenarioMeta),
  // TV-only scenarios (src/dev/tvHarness.jsx), kept out of `scenarios` above
  // so the phone harness's dropdown is unchanged.
  tvScenarios: TV_SCENARIO_NAMES.map(scenarioMeta),
  // Login-only scenarios (src/dev/loginHarness.jsx), kept out of both lists
  // above for the same reason.
  loginScenarios: LOGIN_SCENARIO_NAMES.map(scenarioMeta),
  defaultScenario: DEFAULT_SCENARIO,
  defaultTvScenario: DEFAULT_TV_SCENARIO,
  defaultLoginScenario: DEFAULT_LOGIN_SCENARIO,
  mePlayerId: ME_PLAYER_ID,
  meFigure: ME_FIGURE,
  roomUuid: ROOM_UUID,

  // See the latency knob at the top of this file. `null` restores the normal
  // 120-240ms jitter.
  setLag(ms) {
    actionLag = ms == null ? null : Math.max(0, Number(ms) || 0);
    return actionLag;
  },
  getLag() {
    return actionLag;
  },

  loadScenario(name) {
    const def = SCENARIOS[name] || SCENARIOS[DEFAULT_SCENARIO];
    const built = def.build();
    autoplayToken++; // cancel any bot loop left over from the previous scenario
    // A scenario switch scraps whatever auction/trade bot clock the previous
    // scenario had running, and any private auction valuation it cached.
    if (pendingAuctionBotTimer) clearTimeout(pendingAuctionBotTimer.timer);
    if (pendingTradeBotTimer) clearTimeout(pendingTradeBotTimer.timer);
    if (pendingCasinoBotTimer) clearTimeout(pendingCasinoBotTimer.timer);
    if (pendingAllyBotTimer) clearTimeout(pendingAllyBotTimer.timer);
    if (pendingPeaceBotTimer) clearTimeout(pendingPeaceBotTimer.timer);
    pendingAuctionBotTimer = null;
    pendingTradeBotTimer = null;
    pendingCasinoBotTimer = null;
    pendingAllyBotTimer = null;
    pendingPeaceBotTimer = null;
    auctionBotLimits = {};
    tradeBotDelayMs = built.tradeBotDelayMs ?? null;
    fetchMode = built.fetchMode || "normal";
    pendingActionError = built.errorNextAction || null;
    // `built.row` is null for a "no room at all" scenario (tv-no-room): the
    // harness itself is responsible for not seeding localStorage/`?room=`
    // for those (see scenarioMeta().noRoom); clone(null) is just null.
    room = built.row ? clone(built.row) : null;
    // Covers scenarios that seed an already-pending auction/trade in the
    // static row (e.g. `trade-outgoing`, `auction-no-bids`): the bot on the
    // hook for the next move needs its clock started too, not just the one
    // started by a live action.
    afterStateChange(room);
    if (built.intro) {
      const token = autoplayToken;
      // One intro object (legacy shape) or several staggered ones (e.g.
      // `tv-moving`: two different players move at two different times) --
      // each fires independently off its own absolute delay from page load.
      const steps = Array.isArray(built.intro) ? built.intro : [built.intro];
      for (const step of steps) {
        // Give the harness a beat to mount and subscribe first, same as a
        // real roll landing slightly after the tap that triggered it.
        setTimeout(() => {
          if (token !== autoplayToken) return;
          if (step.join) {
            // A late arrival: another phone takes a figure while the login
            // screen is open (`login-live-take`). Deliberately the real,
            // validated `join` action rather than a hand-written row, so the
            // realtime update the login screen reacts to is byte-identical to
            // the one a second player would actually produce.
            if (room) gameAction(room.uuid, "join", step.join).catch(() => {});
          } else if (step.trade) {
            injectTradeEvent(step.trade.data, step.trade.status);
          } else {
            simulateActorStep(step.actorId, {
              forceTarget: step.target,
              forceDoubles: step.forceDoubles,
              forceCard: step.forceCard,
            });
          }
        }, step.delay ?? 500);
      }
    }
    if (built.autoplay) {
      const token = autoplayToken;
      setTimeout(() => {
        if (token !== autoplayToken) return;
        scheduleAutoplayDemo();
      }, 400);
    }
    return clone(room);
  },

  // One-shot forced dice for the next `roll` action (see `nextRoll`). Pass
  // null to clear. Returns what is armed.
  forceNextRoll(pair) {
    if (pair === undefined) return nextRoll;
    nextRoll = Array.isArray(pair) ? [Number(pair[0]), Number(pair[1])] : null;
    return nextRoll;
  },

  forceMyRoll() {
    if (!room) return;
    const me = room.Players.find((p) => p.playerId === ME_PLAYER_ID);
    if (!me) return;
    simulateActorStep(ME_PLAYER_ID, { setTurnTo: me.order });
  },

  forceOpponentRent() {
    if (!room) return;
    const opp = room.Players.find((p) => p.playerId !== ME_PLAYER_ID && !p.bankrupt);
    if (!opp) return;
    simulateActorStep(opp.playerId, { forceTarget: 14 }); // Дом Эро, owned by me, 1 house
  },

  forceOpponentBuy() {
    if (!room) return;
    const opp = room.Players.find((p) => p.playerId !== ME_PLAYER_ID && !p.bankrupt);
    if (!opp) return;
    simulateActorStep(opp.playerId, { forceTarget: 24, buyIfAffordable: true }); // LOL, unowned
  },

  // Dev toolbar: "bot offers me a trade". Picks any non-bankrupt bot with at
  // least one tradable property and pushes a live offer straight to me,
  // regardless of whose turn it currently is (a debug shortcut, not a
  // validated trade_offer -- see injectTradeEvent()).
  botOffersMeATrade() {
    if (!room) return;
    if (room.game?.phase === "auction" || room.game?.trade) return;
    const board = room.position;
    const bot = room.Players.find((p) => p.playerId !== ME_PLAYER_ID && !p.bankrupt);
    if (!bot) return;
    const cells = tradableOwnedByFig(board, bot.figure);
    if (!cells.length) return;
    const me = room.Players.find((p) => p.playerId === ME_PLAYER_ID);
    const cash = Math.max(10, Math.round(((me?.money || 200) * 0.15) / 10) * 10);
    injectTradeEvent(
      { from: bot.figure, to: ME_FIGURE, give: { cells: [cells[0].id], cash: 0 }, get: { cells: [], cash } },
      "offered",
    );
  },

  // Dev toolbar: "bot starts an auction". Picks the first unowned ownable
  // cell and has any bot auction it off right now, independent of turn
  // order -- a shortcut to reach the "not my turn, a bot started it" states
  // without waiting for one to come up naturally.
  botStartsAuction() {
    if (!room) return;
    if (room.game?.phase === "auction" || room.game?.trade) return;
    const board = room.position;
    const bot = room.Players.find((p) => p.playerId !== ME_PLAYER_ID && !p.bankrupt);
    if (!bot) return;
    const cellEntry = Object.values(board).find((c) => priceOf(c) != null && !ownerOf(c));
    if (!cellEntry) return;
    const st = clone(room);
    const players = st.Players;
    const gmPrev = st.game || {};
    const seq = (gmPrev.seq || 0) + 1;
    const auction = buildAuction(players, bot.figure, cellEntry.id);
    const events = [{ type: "auction_start", figure: bot.figure, cell: cellEntry.id }];
    const row = finalize(st, gmPrev, seq, events, {
      turn: st.current_order,
      phase: "auction",
      doubles: gmPrev.doubles || 0,
      dice: gmPrev.dice ?? null,
      actorId: bot.playerId,
      action: "auction_start",
      winner: gmPrev.winner ?? null,
      winners: Array.isArray(gmPrev.winners) ? gmPrev.winners : [],
      lastCard: null,
      auction,
    });
    emit(row);
    afterStateChange(row);
  },

  // Dev toolbar: "force bot to move now". Skips whatever ~1s beat a pending
  // auction bid/drop or trade answer is waiting out and fires it right away;
  // falls back to instantly rolling for a bot mid-turn (roll phase) when
  // neither is pending, same as the existing forceOpponentBuy/Rent shortcuts.
  forceBotToMoveNow() {
    if (pendingAuctionBotTimer) {
      clearTimeout(pendingAuctionBotTimer.timer);
      const run = pendingAuctionBotTimer.run;
      pendingAuctionBotTimer = null;
      run();
      return;
    }
    if (pendingTradeBotTimer) {
      clearTimeout(pendingTradeBotTimer.timer);
      const run = pendingTradeBotTimer.run;
      pendingTradeBotTimer = null;
      run();
      return;
    }
    // A bot waiting at the casino is the same kind of pending beat: skip the
    // wait and make it bet now.
    if (pendingCasinoBotTimer) {
      clearTimeout(pendingCasinoBotTimer.timer);
      const run = pendingCasinoBotTimer.run;
      pendingCasinoBotTimer = null;
      run();
      return;
    }
    if (!room) return;
    const current = room.Players.find((p) => p.order === room.current_order);
    if (!current || current.playerId === ME_PLAYER_ID || current.bankrupt) return;
    const phase = (room.game || {}).phase;
    // 'casino' is excluded for the same reason 'auction' is: the room is
    // waiting on one specific decision, and rolling for somebody would be the
    // wrong move entirely. A bot's bet is reached through the branch above.
    if (phase === "over" || phase === "auction" || phase === "casino") return;
    simulateActorStep(current.playerId, { buyIfAffordable: true, maybeAuction: true });
  },

  // Login harness toolbar: "another phone joins now". Takes the first figure
  // still free in the room through the same validated `join` action a real
  // second player would use, so the login screen's live "taken" state and its
  // realtime subscription are exercised exactly as they would be in a room.
  botJoinsNow() {
    if (!room) return;
    const taken = new Set(room.Players.map((p) => p.figure));
    if (room.Players.length >= MAX_PLAYERS) return;
    const free = FIGURES.find((f) => !taken.has(f));
    if (!free) return;
    const names = BOT_NAMES;
    gameAction(room.uuid, "join", {
      name: names[free],
      figure: free,
      playerId: `mock-late-${free}`,
    }).catch(() => {});
  },

  getState() {
    return room ? clone(room) : null;
  },
};
