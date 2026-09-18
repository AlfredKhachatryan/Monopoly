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
// supabase/migrations/20260918140000_game_rules.sql (mono_* helpers) and
// 20260918160000_game_log.sql (the `game.log` field) so anything reading
// `game.events` / `game.log` sees the same JSON it would from the real RPC.
// Card decks are a small hand-picked subset (4 Chance, 4 Community), not the
// full 15/16 from the SQL -- enough to exercise every card `kind` at least
// once.

import { useEffect, useRef, useState } from "react";
import { ownerOf, cellKind, priceOf, rentFor, canBuild } from "../Hooks/rules";
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
let pendingActionError = null; // one-shot message the next gameAction() call rejects with
let autoplayToken = 0; // bumped on every loadScenario() to cancel a running bot loop

// Auction/trading bot scheduling. One pending timer of each kind at a time --
// a fresh auction/trade turn always supersedes whatever was queued before it.
// Each entry is { timer, key, run } so "force bot to move now" (the dev
// toolbar) can cancel the wait and invoke the same decision immediately.
let pendingAuctionBotTimer = null;
let pendingTradeBotTimer = null;
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

function emit(newRow) {
  room = newRow;
  for (const fn of listeners) {
    try {
      fn({ new: clone(newRow) });
    } catch {
      /* a bad subscriber should not break the room */
    }
  }
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
  { id: "mc4", kind: "moveTo", cell: 1, text: "Advance to Старт. Collect $200." },
  { id: "mc5", kind: "payEach", amount: 50, text: "You have been elected chairman of the board. Pay each player $50." },
  {
    id: "mc6",
    kind: "repairs",
    house: 25,
    hotel: 100,
    text: "Make general repairs on all your property: $25 per house, $100 per hotel.",
  },
];

const COMMUNITY_DECK = [
  { id: "mk1", kind: "collect", amount: 100, text: "Life insurance matures. Collect $100." },
  { id: "mk2", kind: "pay", amount: 50, text: "Doctor's fee. Pay $50." },
  { id: "mk3", kind: "goJail", text: "Go directly to Jail. Do not pass Start, do not collect $200." },
  { id: "mk4", kind: "collect", amount: 20, text: "Income tax refund. Collect $20." },
  { id: "mk5", kind: "collectEach", amount: 10, text: "It is your birthday. Collect $10 from every player." },
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
}

function charge(players, board, idx, amount, toIdx, reason, cellId, events) {
  if (idx == null || !amount || amount <= 0 || players[idx].bankrupt) return;
  const have = players[idx].money;
  const fig = players[idx].figure;
  const toFig = toIdx != null ? players[toIdx].figure : null;
  if (have < amount) {
    bankrupt(players, board, idx, toIdx, reason, amount, events);
    return;
  }
  players[idx].money -= amount;
  if (toIdx != null) players[toIdx].money += amount;
  events.push({ type: "pay", figure: fig, to: toFig, amount, reason, cell: cellId ?? null });
}

function moveTo(board, players, idx, newPos, collectGo, events) {
  const fig = players[idx].figure;
  const oldPos = players[idx].position || 1;
  for (const key of Object.keys(board)) board[key][fig] = false;
  board[newPos][fig] = true;
  players[idx].position = newPos;
  events.push({ type: "move", figure: fig, from: oldPos, to: newPos });
  if (collectGo && newPos <= oldPos) credit(players, idx, 200, "passGo", events);
}

function findCellOfKind(board, kind) {
  const found = Object.values(board).find((c) => cellKind(c) === kind);
  return found ? found.id : null;
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
// with no building anywhere in its colour set (railroads/utilities always
// tradable, they have no set).
function isTradableCell(board, cellId) {
  const cell = board?.[cellId];
  if (!cell) return false;
  const kind = cellKind(cell);
  if (kind !== "street" && kind !== "road" && kind !== "communal") return false;
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
    case "moveTo":
      moveTo(board, players, idx, card.cell, true, events);
      land(board, players, idx, diceSum, events, out);
      break;
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
function land(board, players, idx, diceSum, events, out, forceCard) {
  const fig = players[idx].figure;
  const pos = players[idx].position;
  const cell = board[pos];
  const kind = cellKind(cell);
  events.push({ type: "land", figure: fig, cell: pos, kind });

  if (kind === "street" || kind === "road" || kind === "communal") {
    const owner = ownerOf(cell);
    if (owner && owner !== fig) {
      const ownerIdx = players.findIndex((p) => p.figure === owner);
      if (ownerIdx >= 0 && !players[ownerIdx].bankrupt) {
        const amount = rentFor(board, pos, diceSum);
        charge(players, board, idx, amount, ownerIdx, "rent", pos, events);
      }
    }
  } else if (kind === "tax") {
    charge(players, board, idx, cell.price || 0, null, "tax", pos, events);
  } else if (kind === "gtj") {
    sendToJail(board, players, idx, "gtj", events);
  } else if (kind === "chance" || kind === "community") {
    const card = forceCard ? drawCard(forceCard.deck, forceCard.index) : drawCard(kind);
    events.push({ type: "card", figure: fig, deck: kind, id: card.id, text: card.text });
    out.lastCard = { deck: kind, text: card.text, figure: fig };
    applyCard(board, players, idx, card, diceSum, events, out);
  }
  // start / parking / jail (visiting): nothing extra, same as the SQL.
}

function performRoll(board, players, idx, events, initialDoubles, out, opts = {}) {
  const { forceTarget, forceDoubles, forceCard } = opts;
  const fig = players[idx].figure;
  const cellsCount = Object.keys(board).length;
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = forceDoubles ? d1 : 1 + Math.floor(Math.random() * 6);
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
        charge(players, board, idx, 50, null, "jailFee", null, events);
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

// Bankrupt-skip + win check, run after every action (mirrors the tail of
// game_action in the SQL). `phaseIn` is whatever the action itself decided.
function applyEndOfActionChecks(players, turn, phaseIn, winnerIn, events) {
  let winner = winnerIn;
  let phase = phaseIn;
  if (phase !== "over") {
    const curIdx = players.findIndex((p) => p.order === turn);
    if (curIdx >= 0 && players[curIdx].bankrupt) {
      turn = nextTurn(players, turn);
      phase = "roll";
    }
  }
  const active = players.filter((p) => !p.bankrupt);
  if (!winner && players.length >= 2 && active.length === 1) {
    winner = active[0].figure;
    phase = "over";
    events.push({ type: "win", figure: winner });
  }
  if (winner) phase = "over";
  return { turn, phase, winner };
}

function finalize(st, gmPrev, seq, events, patch) {
  const prevLog = Array.isArray(gmPrev.log) ? gmPrev.log : [];
  let log = prevLog.concat(events.map((e) => ({ ...e, seq, by: patch.actorId ?? null })));
  if (log.length > 40) log = log.slice(log.length - 40);
  st.current_order = Math.min(Math.max(patch.turn, 0), 3);
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
    // undefined means "unchanged" (most actions never touch these); an
    // explicit null clears it. Either way it must be a real key, never
    // missing, so the client's `game?.auction ?? null` always sees one.
    auction: patch.auction !== undefined ? patch.auction : (gmPrev.auction ?? null),
    trade: patch.trade !== undefined ? patch.trade : (gmPrev.trade ?? null),
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
  const gmPrev = st.game || {};
  const seq = (gmPrev.seq || 0) + 1;
  let phase = gmPrev.phase || "roll";
  let doubles = gmPrev.doubles || 0;
  let dice = gmPrev.dice || null;
  let winner = gmPrev.winner || null;
  let lastCard = null;
  const events = [];
  // undefined = this action doesn't touch it, finalize() carries the
  // previous value forward; an explicit null/object is a real change.
  let auctionOut;
  let tradeOut;
  let logOverride; // set only by new_game/reset_board: the log restarts empty

  const pid = payload.playerId;
  const meIdx = pid ? players.findIndex((p) => p.playerId === pid) : -1;
  const me = meIdx >= 0 ? players[meIdx] : null;
  const boardOnly = BOARD_ONLY_ACTIONS.includes(action);
  const noSeat = NO_SEAT_ACTIONS.includes(action);

  if (!me && !noSeat) throw new Error("Player is not in this room");
  if (phase === "over" && !noSeat) throw new Error("The game is over");
  if (me?.bankrupt && !boardOnly) throw new Error("You are bankrupt");
  if (phase === "auction" && !["auction_bid", "auction_drop", "leave", "skip_turn"].includes(action)) {
    throw new Error("An auction is running");
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
      if (!["fig0", "fig1", "fig2", "fig3"].includes(figure)) {
        throw new Error(`Unknown figure ${figure}`);
      }
      if (players.length >= 4) throw new Error("Room is full");
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
      if (me.money < 50) throw new Error("Not enough money");
      me.money -= 50;
      me.inJail = false;
      me.jailTurns = 0;
      events.push({ type: "pay", figure: me.figure, to: null, amount: 50, reason: "jailFee" });
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
      if (auction && phase === "auction") {
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
      }
      const freshBoard = {};
      for (const key of Object.keys(payloadBoard)) {
        const cell = { ...payloadBoard[key] };
        delete cell.houses;
        cell.fig0 = false;
        cell.fig1 = false;
        cell.fig2 = false;
        cell.fig3 = false;
        cell.bought = { fig0: false, fig1: false, fig2: false, fig3: false };
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
      auctionOut = null;
      tradeOut = null;
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
      events.push({ type: "leave", figure: me.figure });
      break;
    }

    default:
      throw new Error(`Unknown action ${action}`);
  }

  const checked = applyEndOfActionChecks(players, turn, phase, winner, events);
  // new_game/reset_board restart the log empty (the SQL resets `gm` to `{}`
  // first) -- everything else concats onto the room's existing history.
  const finalizeGmPrev = logOverride !== undefined ? { ...gmPrev, log: logOverride } : gmPrev;
  return finalize(st, finalizeGmPrev, seq, events, {
    turn: checked.turn,
    phase: checked.phase,
    doubles,
    dice,
    actorId: pid ?? null,
    action,
    winner: checked.winner,
    lastCard,
    auction: auctionOut,
    trade: tradeOut,
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

  const gmPrev = st.game || {};
  const seq = (gmPrev.seq || 0) + 1;
  const events = [];
  const out = { lastCard: null };
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

  const checked = applyEndOfActionChecks(players, st.current_order, landedPhase, gmPrev.winner || null, events);
  const row = finalize(st, gmPrev, seq, events, {
    turn: checked.turn,
    phase: checked.phase,
    doubles: r.doubles,
    dice: r.dice,
    actorId: playerId,
    action: "roll",
    winner: checked.winner,
    lastCard: out.lastCard,
    auction: auctionOut,
  });
  emit(row);
  afterStateChange(row);
  return row;
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
  if (g.trade) scheduleTradeBotIfNeeded(row);
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

  return { data, error, loading };
}

export async function fetchRoom(uuid) {
  if (fetchMode === "hang") return new Promise(() => {}); // never resolves, by design
  if (fetchMode === "error") {
    return { data: null, error: { message: "Failed to fetch room (mock fetch-error scenario)" } };
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
  if (!room || room.uuid !== uuid) {
    return { data: null, error: { message: `Room ${uuid} not found` } };
  }
  if (pendingActionError) {
    const message = pendingActionError;
    pendingActionError = null; // one-shot, like the real "next action rejects"
    console.error(`[mock] game_action ${action} failed for room ${uuid}: ${message}`);
    return { data: null, error: { message } };
  }
  try {
    const newRow = applyAction(room, action, payload);
    emit(newRow);
    afterStateChange(newRow);
    if (action === "end_turn") scheduleBotAutoplay();
    return { data: clone(newRow), error: null };
  } catch (e) {
    const message = e?.message || String(e);
    console.error(`[mock] game_action ${action} failed for room ${uuid}: ${message}`);
    return { data: null, error: { message } };
  }
}

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

export function useRealtimeUpdates(uuid, callback, onSubscribed) {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const subRef = useRef(onSubscribed);
  subRef.current = onSubscribed;

  useEffect(() => {
    if (!uuid) return;
    const fn = (payload) => {
      if (room && room.uuid === uuid) cbRef.current(payload);
    };
    listeners.add(fn);
    const t = setTimeout(() => subRef.current?.(), 0);
    return () => {
      listeners.delete(fn);
      clearTimeout(t);
    };
  }, [uuid]);
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
    pendingAuctionBotTimer = null;
    pendingTradeBotTimer = null;
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
    if (!room) return;
    const current = room.Players.find((p) => p.order === room.current_order);
    if (!current || current.playerId === ME_PLAYER_ID || current.bankrupt) return;
    const phase = (room.game || {}).phase;
    if (phase === "over" || phase === "auction") return;
    simulateActorStep(current.playerId, { buyIfAffordable: true, maybeAuction: true });
  },

  // Login harness toolbar: "another phone joins now". Takes the first figure
  // still free in the room through the same validated `join` action a real
  // second player would use, so the login screen's live "taken" state and its
  // realtime subscription are exercised exactly as they would be in a room.
  botJoinsNow() {
    if (!room) return;
    const taken = new Set(room.Players.map((p) => p.figure));
    const free = ["fig0", "fig1", "fig2", "fig3"].find((f) => !taken.has(f));
    if (!free) return;
    const names = { fig0: "Ero", fig1: "Afo", fig2: "Koli", fig3: "Gaya" };
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
