// Scenario data for the offline client preview harness
// (client-harness.html / src/dev/clientHarness.jsx / src/dev/mockSupabase.js).
//
// Every scenario builds a plausible mid-game room row shaped exactly like
// supabase/migrations/20260918140000_game_rules.sql +
// 20260918160000_game_log.sql produce: { uuid, position, Players,
// current_order, game }. "Afo" (fig1) is always the local player the harness
// logs the toolbar in as.
//
// Most of them seat four (Ero/Afo/Koli/Gaya = fig0..fig3); "six-players" and
// "tv-six-players" fill the room to the cap of six so the phone and the TV can
// be previewed at full load. Six seats and the eight figures fig0..fig7 come
// from supabase/migrations/20260920100000_six_players.sql.
//
// Board layout reference (src/Hooks/baseState.jsx, 1-indexed):
//   streets   2,4 (#D92650) · 7,9,10 (#eb75e7) · 12,14,15 (#F5786C)
//             17,19,20 (#1F8F5D) · 22,24,25 (#1F8FFF) · 27,29,30 (#F56CC6)
//             32,34,35 (#6F6CF5) · 38,40 (#DE951F)
//   railroads 6, 16, 26, 36        utilities 13 (Light), 28 (Water)
//   tax       5 ($200), 39 ($400 Luxury Tax)
//   chance    8, 23, 37            community 3, 18, 33
//   jail 11 (visit/in-jail) · GTJ 31 · parking 21 · start 1
//
// Some scenarios also carry an "intro": a forced roll fired ~500ms after the
// room loads, run through the exact same event-producing code the mock uses
// for a real roll (see mockSupabase.js). That is what makes "just landed on
// an unowned street" etc. arrive as a live update (game.seq bump) instead of
// a static row, so the feed-driven UI (dice, card overlay, log, sounds)
// reacts the same way it would against the real backend.

import { initialState } from "../Hooks/baseState";
import { FIGS, MAX_PLAYERS as RULES_MAX_PLAYERS } from "../Hooks/rules";

export const ROOM_UUID = "MOCK01";

// The eight selectable figures and the six-seat cap. Taken from
// src/Hooks/rules.js so the harness can never disagree with the client, and
// matching supabase/migrations/20260920100000_six_players.sql.
export const FIGURES = FIGS;
export const MAX_PLAYERS = RULES_MAX_PLAYERS;

export const PLAYER_IDS = {
  ero: "mock-ero",
  afo: "mock-afo",
  koli: "mock-koli",
  gaya: "mock-gaya",
  bat: "mock-bat",
  mummy: "mock-mummy",
};

export const ME_PLAYER_ID = PLAYER_IDS.afo;
export const ME_FIGURE = "fig1";

// A board straight out of initialState() may still carry only fig0..fig3 (that
// file is owned by another agent). The server's own data step -- see
// public.mono_upgrade_cells in 20260920100000_six_players.sql -- brings every
// stored board up to the eight-key shape, so the harness does the same to
// whatever it builds: `defaults` first, existing values second, so nothing
// already set is overwritten.
function upgradeCells(board) {
  for (const cell of Object.values(board)) {
    const bought = { ...(cell.bought || {}) };
    for (const f of FIGURES) {
      if (!(f in cell)) cell[f] = false;
      if (!(f in bought)) bought[f] = false;
    }
    cell.bought = bought;
  }
  return board;
}

// A separate set of ids for `tv-autoplay` (src/dev/tvHarness.jsx): every
// seat there is a bot, and the bot-scheduling code in mockSupabase.js only
// ever special-cases ME_PLAYER_ID ("mock-afo") -- reusing PLAYER_IDS.afo for
// one of the four seats would make that seat "the human" and stop the demo
// dead the moment it became their turn.
export const AUTOPLAY_PLAYER_IDS = {
  ero: "mock-bot-ero",
  afo: "mock-bot-afo",
  koli: "mock-bot-koli",
  gaya: "mock-bot-gaya",
  bat: "mock-bot-bat",
  mummy: "mock-bot-mummy",
};

// `extra(board, own)` lets a scenario hand out one or two more cells on top
// of the shared default holdings below, e.g. so the trade scenarios have a
// tradable (house-free) set or single cell for Afo to offer -- the default
// board only gives Afo the salmon set, and that one has houses on purpose.
function buildBoard(extra) {
  const board = upgradeCells(initialState());
  const own = (id, fig) => {
    board[id].bought[fig] = true;
  };

  // Afo (fig1, "me") owns the full salmon set with a couple of houses up --
  // the "one full colour set owned by me with a couple of houses" the brief
  // asks for. Fittingly, it is the set literally named after the players
  // (cells 12/14/15: "Дом Афо / Дом Эро / Дом Коли").
  own(12, "fig1");
  own(14, "fig1");
  own(15, "fig1");
  board[12].houses = 2;
  board[14].houses = 1;
  board[15].houses = 1;

  // Ero (fig0): a railroad, a utility, one street of the pink set.
  own(2, "fig0");
  own(6, "fig0");
  own(13, "fig0");

  // Koli (fig2): two of the three light-pink streets, a railroad.
  own(7, "fig2");
  own(9, "fig2");
  own(26, "fig2");

  // Gaya (fig3): one green street, one blue street, a railroad.
  own(17, "fig3");
  own(22, "fig3");
  own(16, "fig3");

  if (extra) extra(board, own);
  return board;
}

function placeTokens(board, players) {
  for (const p of players) {
    if (board[p.position]) board[p.position][p.figure] = true;
  }
}

function basePlayers(overrides = {}) {
  const table = {
    ero: { name: "Ero", figure: "fig0", money: 1180, position: 6, order: 0, playerId: PLAYER_IDS.ero, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
    afo: { name: "Afo", figure: "fig1", money: 1450, position: 15, order: 1, playerId: PLAYER_IDS.afo, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
    koli: { name: "Koli", figure: "fig2", money: 860, position: 9, order: 2, playerId: PLAYER_IDS.koli, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
    gaya: { name: "Gaya", figure: "fig3", money: 2050, position: 22, order: 3, playerId: PLAYER_IDS.gaya, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
  };
  return ["ero", "afo", "koli", "gaya"].map((key) => ({ ...table[key], ...(overrides[key] || {}) }));
}

function baseRow({
  playerOverrides = {},
  currentOrder = 1,
  phase = "roll",
  doubles = 0,
  dice = null,
  winner = null,
  boardMutator = null,
} = {}) {
  const players = basePlayers(playerOverrides);
  const board = buildBoard(boardMutator);
  placeTokens(board, players);
  return {
    uuid: ROOM_UUID,
    position: board,
    Players: players,
    current_order: currentOrder,
    game: {
      seq: 1,
      phase,
      doubles,
      dice,
      actor: null,
      action: null,
      events: [],
      lastCard: null,
      winner,
      // Present and null rather than absent, same as a real room's row --
      // see mockSupabase.js's finalize().
      auction: null,
      trade: null,
      // A little seeded history so the game log / ticker isn't empty on
      // first paint, same as a room several turns in would have.
      log: [
        { type: "join", figure: "fig0", name: "Ero", seq: -3, by: PLAYER_IDS.ero },
        { type: "join", figure: "fig1", name: "Afo", seq: -2, by: PLAYER_IDS.afo },
        { type: "join", figure: "fig2", name: "Koli", seq: -1, by: PLAYER_IDS.koli },
        { type: "join", figure: "fig3", name: "Gaya", seq: 0, by: PLAYER_IDS.gaya },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// TV-only helpers (src/dev/tvHarness.jsx). The phone scenarios above always
// assume exactly Ero/Afo/Koli/Gaya at the default board; the TV needs rooms
// with 0, 2 and fully-loaded 4 players, and a board built entirely by hand
// (`tv-rich`), so this builds a row from an arbitrary player list instead of
// basePlayers()'s fixed four.
// ---------------------------------------------------------------------------

function customRow({ players, board, boardMutator, currentOrder = 0, phase = "roll", doubles = 0, dice = null, winner = null }) {
  const finalBoard = board ? upgradeCells(board) : buildBoard(boardMutator);
  placeTokens(finalBoard, players);
  return {
    uuid: ROOM_UUID,
    position: finalBoard,
    Players: players,
    current_order: currentOrder,
    game: {
      seq: 1,
      phase,
      doubles,
      dice,
      actor: null,
      action: null,
      events: [],
      lastCard: null,
      winner,
      auction: null,
      trade: null,
      log: players.map((p, i) => ({ type: "join", figure: p.figure, name: p.name, seq: i - players.length, by: p.playerId })),
    },
  };
}

// `tv-rich`: every one of the 28 ownable cells is owned, several full colour
// sets carry houses or a hotel (houses: 5 = hotel, same convention as the
// `repairs` card handler above), long Cyrillic names stress the TV's text
// truncation, one player sits in jail and one is bankrupt (and therefore
// owns nothing -- a real bankruptcy transfers every property away, see
// `bankrupt()` above, so a bankrupt owner here would be an inconsistent row).
function buildRichBoard() {
  const board = initialState();
  const own = (id, fig, houses) => {
    board[id].bought[fig] = true;
    if (houses != null) board[id].houses = houses;
  };
  // Ero (fig0): the cheap red set with a house each, the pink set built to 3
  // houses, two railroads, one utility.
  own(2, "fig0", 1);
  own(4, "fig0", 1);
  own(7, "fig0", 3);
  own(9, "fig0", 3);
  own(10, "fig0", 3);
  own(6, "fig0");
  own(16, "fig0");
  own(13, "fig0");
  // Afo (fig1): the salmon set with a hotel, the green set bare, one railroad.
  own(12, "fig1", 4);
  own(14, "fig1", 4);
  own(15, "fig1", 5); // hotel
  own(17, "fig1");
  own(19, "fig1");
  own(20, "fig1");
  own(26, "fig1");
  // Gaya (fig3): blue with houses, magenta bare, purple with a couple of
  // houses, both orange streets, one railroad, one utility.
  own(22, "fig3", 2);
  own(24, "fig3", 2);
  own(25, "fig3", 2);
  own(27, "fig3");
  own(29, "fig3");
  own(30, "fig3");
  own(32, "fig3", 1);
  own(34, "fig3", 1);
  own(35, "fig3");
  own(38, "fig3");
  own(40, "fig3");
  own(36, "fig3");
  own(28, "fig3");
  // Koli (fig2): bankrupt -- owns nothing, on purpose.
  return board;
}

function richPlayers() {
  return [
    {
      name: "Александр Константинопольский",
      figure: "fig0",
      money: 1240,
      position: 5,
      order: 0,
      playerId: PLAYER_IDS.ero,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
    },
    {
      name: "Afo",
      figure: "fig1",
      money: 980,
      position: 1,
      order: 1,
      playerId: PLAYER_IDS.afo,
      inJail: false,
      jailTurns: 0,
      jailCards: 1,
      bankrupt: false,
    },
    {
      name: "Константин Севастопольский",
      figure: "fig2",
      money: 0,
      position: 39,
      order: 2,
      playerId: PLAYER_IDS.koli,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: true,
    },
    {
      name: "Екатерина Виноградова-Долгорукая",
      figure: "fig3",
      money: 640,
      position: 11,
      order: 3,
      playerId: PLAYER_IDS.gaya,
      inJail: true,
      jailTurns: 1,
      jailCards: 0,
      bankrupt: false,
    },
  ];
}

function autoplayPlayers(keys = ["ero", "afo", "koli", "gaya"]) {
  const table = {
    ero: { name: "Ero", figure: "fig0", playerId: AUTOPLAY_PLAYER_IDS.ero },
    afo: { name: "Afo", figure: "fig1", playerId: AUTOPLAY_PLAYER_IDS.afo },
    koli: { name: "Koli", figure: "fig2", playerId: AUTOPLAY_PLAYER_IDS.koli },
    gaya: { name: "Gaya", figure: "fig3", playerId: AUTOPLAY_PLAYER_IDS.gaya },
    bat: { name: "Bat", figure: "fig4", playerId: AUTOPLAY_PLAYER_IDS.bat },
    mummy: { name: "Mummy", figure: "fig5", playerId: AUTOPLAY_PLAYER_IDS.mummy },
  };
  return keys.map((key, i) => ({
    ...table[key],
    money: 1600,
    position: 1,
    order: i,
    inJail: false,
    jailTurns: 0,
    jailCards: 0,
    bankrupt: false,
  }));
}

// ---------------------------------------------------------------------------
// The full room: six seats, fig0..fig5, every figure holding something.
//
// `six-players` (phone) and `tv-six-players` (TV) share this so the two
// layouts are previewed against the *same* row -- the phone's player strip and
// the TV's side panel both have to survive six names, six token stacks on one
// cell's worth of board and six sets of holdings.
//
// Seat order is Ero(fig0) · Afo(fig1, "me") · Koli(fig2) · Gaya(fig3) ·
// Bat(fig4) · Mummy(fig5), so `current_order: 1` is still the local player's
// turn exactly like every other phone scenario.
// ---------------------------------------------------------------------------

const SIX_SEATS = [
  { name: "Ero", figure: "fig0", money: 1180, position: 6, playerId: PLAYER_IDS.ero, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
  { name: "Afo", figure: "fig1", money: 1450, position: 15, playerId: PLAYER_IDS.afo, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
  { name: "Koli", figure: "fig2", money: 860, position: 9, playerId: PLAYER_IDS.koli, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
  { name: "Гаяне Ованнисян-Мкртчян", figure: "fig3", money: 2050, position: 22, playerId: PLAYER_IDS.gaya, inJail: true, jailTurns: 1, jailCards: 0, bankrupt: false },
  { name: "Bat", figure: "fig4", money: 640, position: 1, playerId: PLAYER_IDS.bat, inJail: false, jailTurns: 0, jailCards: 1, bankrupt: false },
  { name: "Mummy", figure: "fig5", money: 310, position: 6, playerId: PLAYER_IDS.mummy, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
];

function sixPlayers(overrides = {}) {
  return SIX_SEATS.map((p, i) => ({ ...p, order: i, ...(overrides[p.figure] || {}) }));
}

// The default buildBoard() holdings plus a slice for fig4 and fig5, so no seat
// on the TV's side panel is empty and the two new figures appear both as an
// owner badge and as a token sharing cell 6 with Ero.
function sixBoard() {
  return buildBoard((board, own) => {
    own(19, "fig4");
    own(20, "fig4");
    own(36, "fig4");
    own(24, "fig5");
    own(25, "fig5");
    own(28, "fig5");
    own(38, "fig5");
    board[19].houses = 0;
  });
}

function sixRow(extra = {}) {
  return customRow({
    players: sixPlayers(extra.playerOverrides),
    board: sixBoard(),
    currentOrder: extra.currentOrder ?? 1,
    phase: extra.phase ?? "roll",
    doubles: extra.doubles ?? 0,
    dice: extra.dice ?? null,
  });
}

export const SCENARIOS = {
  "my-roll": {
    label: "my-roll",
    describe: "My turn, nothing rolled yet.",
    build: () => ({ row: baseRow({ currentOrder: 1, phase: "roll" }) }),
  },

  "my-buy": {
    label: "my-buy",
    describe: "Just landed on an unowned street with enough money.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 25 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 32 }, // Spotify, #6F6CF5, $300, unowned
    }),
  },

  "my-buy-poor": {
    label: "my-buy-poor",
    describe: "Just landed on an unowned street without enough money.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 25, money: 40 } },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 35 }, // Windows, #6F6CF5, $320, unowned
    }),
  },

  // The owner's bug report: "I cannot buy the second Railroad". I already own
  // one railroad (26) and land on another, unowned one (36). The act row must
  // offer Buy $200 / Pass exactly as it does for a street.
  "my-buy-railroad": {
    label: "my-buy-railroad",
    describe: "I already own railroad 26 and land on the unowned railroad 36.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 30 } },
        boardMutator: (board, own) => {
          board[26].bought.fig2 = false; // Koli's by default
          own(26, "fig1"); // mine, so I land on 36 already holding one
        },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 36 }, // RailRoad "Carry", $200, unowned
    }),
  },

  // Same question for the second utility: I own 13 (Light) and land on 28
  // (Water).
  "my-buy-utility": {
    label: "my-buy-utility",
    describe: "I already own utility 13 and land on the unowned utility 28.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 23 } },
        boardMutator: (board, own) => {
          board[13].bought.fig0 = false; // Ero's by default
          own(13, "fig1");
        },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 28 }, // Communal "Water", $150, unowned
    }),
  },

  // What a phone sees after a RELOAD (or any first load) while it is already
  // standing, mid-turn, on an unowned space: the row is in phase "act" and no
  // live `land` event will ever arrive again for it.
  "my-buy-reloaded": {
    label: "my-buy-reloaded",
    describe: "Fresh load, already standing on the unowned railroad 36 in phase act.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "act",
        dice: [4, 6],
        playerOverrides: { afo: { position: 36 } },
        boardMutator: (board, own) => {
          board[26].bought.fig2 = false;
          own(26, "fig1");
        },
      }),
    }),
  },

  // The same fresh load, but the log says I already put this space up for
  // auction and nobody bid. The offer must stay gone: that is what passing on
  // a space means, and it has to survive a reload the same way the offer
  // itself now does.
  "my-buy-declined": {
    label: "my-buy-declined",
    describe: "Fresh load on railroad 36 after I passed and its auction found no bidder.",
    build: () => {
      const row = baseRow({
        currentOrder: 1,
        phase: "act",
        dice: [4, 6],
        playerOverrides: { afo: { position: 36 } },
      });
      row.game.log = [
        ...row.game.log,
        { type: "land", figure: "fig1", cell: 36, kind: "road", seq: 1, by: PLAYER_IDS.afo },
        { type: "auction_start", figure: "fig1", cell: 36, seq: 2, by: PLAYER_IDS.afo },
        { type: "auction_none", cell: 36, seq: 3, by: PLAYER_IDS.gaya },
      ];
      return { row };
    },
  },

  // "Advance to the nearest railroad" (Chance mc8, index 7 -- c5 in the SQL).
  // The one card that puts a token on a railroad with no roll-and-land of its
  // own: the roll lands on Chance 23, the card then moves me again, inside the
  // same action, onto railroad 26. Two `move`s and two `land`s in one
  // `game.events` batch, and the buy offer has to be decided from the SECOND
  // landing -- which is precisely the bookkeeping the "cannot buy the second
  // Railroad" report turned out to be about.
  //
  // 26 is Koli's by default, so it is handed to nobody here and I already hold
  // 16, making this the exact shape of the original report: a second railroad,
  // free, reached by the one route nothing else in the harness covers.
  "my-card-nearest-road": {
    label: "my-card-nearest-road",
    describe: "Chance 23 → nearest railroad card → land on the unowned railroad 26. BUY must appear.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 20 } },
        boardMutator: (board, own) => {
          board[26].bought.fig2 = false; // free it up: this is the one I must be offered
          board[16].bought.fig3 = false; // Gaya's by default
          own(16, "fig1"); // mine, so 26 would be my SECOND railroad
        },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 23, forceCard: { deck: "chance", index: 7 } },
    }),
  },

  // The same card from Chance 37, the only Chance cell with no railroad above
  // it: the target wraps round to railroad 6 and the move therefore passes
  // Start, so the batch also carries a `collect` of $200 with reason `passGo`.
  // 6 is Ero's by default and stays his, so this is the RENT half of the card:
  // one railroad owned is $25, doubled by the card to $50.
  "my-card-nearest-road-wrap": {
    label: "my-card-nearest-road-wrap",
    describe: "Chance 37 → nearest railroad wraps to Ero's railroad 6: +$200 Start, −$50 double rent.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 34 } },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 37, forceCard: { deck: "chance", index: 7 } },
    }),
  },

  // The third and last Chance cell, 8, whose nearest railroad going forward is
  // 16 -- so between this, `my-card-nearest-road` (23 → 26) and
  // `my-card-nearest-road-wrap` (37 → 6) every Chance cell on the board has its
  // target pinned down, which is the only way an off-by-one in the `> pos`
  // comparison could not hide somewhere.
  //
  // This is also the one place the DOUBLED multi-railroad rate is exercised:
  // Ero is given 16 on top of his default 6, so the normal rent for a landing
  // there is the two-railroad rate of $50, and the card's road_mult of 2 makes
  // it $100. Both numbers are distinct from every undoubled rate in the table
  // (25/50/100/200), so the charge alone proves the multiplier was applied and
  // that it multiplied the count-based rate rather than replacing it.
  "my-card-nearest-road-rent": {
    label: "my-card-nearest-road-rent",
    describe: "Chance 8 → nearest railroad 16, owned by Ero who holds 2: −$100 (2-railroad $50, doubled).",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 5 } },
        boardMutator: (board, own) => {
          board[16].bought.fig3 = false; // Gaya's by default
          own(16, "fig0"); // Ero's second railroad, so his rate is $50 before the card
        },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 8, forceCard: { deck: "chance", index: 7 } },
    }),
  },

  // The utility twin of the same card kind (Chance mc9, index 8 -- c4 in the
  // SQL), kept because it is the only place the server's `util_mult` override
  // is reachable at all: Ero owns utility 13 and only that one, so ordinary
  // rent would be 4x dice, and the card forces 10x instead. The dice are the
  // ORIGINAL roll's, not a re-throw -- see the `nearest` case in
  // mockSupabase.js's applyCard() for why.
  "my-card-nearest-utility": {
    label: "my-card-nearest-utility",
    describe: "Chance 8 → nearest utility card → Ero's utility 13 at 10× dice, not 4×.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 5 } },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 8, forceCard: { deck: "chance", index: 8 } },
    }),
  },

  "my-build": {
    label: "my-build",
    describe: "Landed on my own buildable colour set.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 3 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 15 }, // my own street, room to build
    }),
  },

  "my-end": {
    label: "my-end",
    describe: "Just paid rent after landing on someone else's property.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 5 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 9 }, // Koli's street, no full set: base rent
    }),
  },

  doubles: {
    label: "doubles",
    describe: "Rolled doubles: roll again.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 15 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 1, forceDoubles: true }, // lands on Start, no side effects
    }),
  },

  jail: {
    label: "jail",
    describe: "My turn, in jail, holding a Get Out Of Jail Free card.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 11, inJail: true, jailTurns: 1, jailCards: 1 } },
      }),
    }),
  },

  waiting: {
    label: "waiting",
    describe: "Someone else's turn.",
    build: () => ({ row: baseRow({ currentOrder: 0, phase: "roll" }) }),
  },

  "chance-card": {
    label: "chance-card",
    describe: "Roll + land + card, so the card overlay opens.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 5 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 8, forceCard: { deck: "chance", index: 0 } },
    }),
  },

  "card-pay-each": {
    label: "card-pay-each",
    describe: "Chance payEach card: I pay every other player $50 (pill: −150$).",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 5 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 8, forceCard: { deck: "chance", index: 4 } },
    }),
  },

  "card-repairs": {
    label: "card-repairs",
    describe: "Chance repairs card on my own 4 houses (pill: −100$, 4 × $25).",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 5 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 8, forceCard: { deck: "chance", index: 5 } },
    }),
  },

  "card-collect-each": {
    label: "card-collect-each",
    describe: "Community collectEach card: every other player pays me $10 (pill: +30$).",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 5 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 18, forceCard: { deck: "community", index: 4 } },
    }),
  },

  // ---------------------------------------------------------------------
  // Auctions. All seven share cell 24 ("LOL", #1F8FFF, $220, unowned) so the
  // auction panel always shows the same property. `game.auction` is built
  // by hand here (not via mockSupabase.js's buildAuction()) since scenarios
  // are pure data -- see that function's doc comment for the exact order/in/
  // turn invariants these numbers were chosen to satisfy.
  // ---------------------------------------------------------------------

  "auction-my-move": {
    label: "auction-my-move",
    describe: "I passed on LOL, it's my move, a high bid already exists from a bot.",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 1, phase: "auction", playerOverrides: { afo: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig1",
          bid: 150,
          leader: "fig2",
          order: ["fig2", "fig3", "fig0", "fig1"],
          in: ["fig2", "fig3", "fig0", "fig1"],
          turn: "fig1",
          last: { fig2: 150, fig3: 100, fig0: 80 },
        };
        return row;
      })(),
    }),
  },

  "auction-no-bids": {
    label: "auction-no-bids",
    describe: "Auction just started by me, no bids yet, a bot to move (bots act, then me).",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 1, phase: "auction", playerOverrides: { afo: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig1",
          bid: 0,
          leader: null,
          order: ["fig2", "fig3", "fig0", "fig1"],
          in: ["fig2", "fig3", "fig0", "fig1"],
          turn: "fig2",
          last: {},
        };
        return row;
      })(),
    }),
  },

  "auction-leading": {
    label: "auction-leading",
    describe: "I hold the high bid on LOL, a bot to move.",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 2, phase: "auction", playerOverrides: { koli: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig2",
          bid: 170,
          leader: "fig1",
          order: ["fig3", "fig0", "fig1", "fig2"],
          in: ["fig3", "fig0", "fig1", "fig2"],
          turn: "fig2",
          last: { fig3: 130, fig0: 150, fig1: 170 },
        };
        return row;
      })(),
    }),
  },

  "auction-dropped": {
    label: "auction-dropped",
    describe: "I dropped out of the LOL auction, bots continue without me.",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 3, phase: "auction", playerOverrides: { gaya: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig3",
          bid: 140,
          leader: "fig2",
          order: ["fig0", "fig1", "fig2", "fig3"],
          in: ["fig0", "fig2", "fig3"],
          turn: "fig0",
          last: { fig1: 100, fig2: 140 },
        };
        return row;
      })(),
    }),
  },

  "auction-poor": {
    label: "auction-poor",
    describe: "My move on the LOL auction, but I cannot afford the next minimum bid.",
    build: () => ({
      row: (() => {
        const row = baseRow({
          currentOrder: 0,
          phase: "auction",
          playerOverrides: { ero: { position: 24 }, afo: { money: 40 } },
        });
        row.game.auction = {
          cell: 24,
          startedBy: "fig0",
          bid: 40,
          leader: "fig2",
          order: ["fig1", "fig2", "fig3", "fig0"],
          in: ["fig1", "fig2", "fig3", "fig0"],
          turn: "fig1",
          last: { fig2: 40 },
        };
        return row;
      })(),
    }),
  },

  "auction-by-bot": {
    label: "auction-by-bot",
    describe: "Not my turn: Ero started the LOL auction, I'm in the rotation.",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 0, phase: "auction", playerOverrides: { ero: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig0",
          bid: 90,
          leader: "fig1",
          order: ["fig1", "fig2", "fig3", "fig0"],
          in: ["fig1", "fig2", "fig3", "fig0"],
          turn: "fig2",
          last: { fig1: 90 },
        };
        return row;
      })(),
    }),
  },

  "auction-last-one": {
    label: "auction-last-one",
    describe: "Everyone else dropped with no bid on LOL; I may bid $10 or drop.",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 0, phase: "auction", playerOverrides: { ero: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig0",
          bid: 0,
          leader: null,
          order: ["fig1", "fig2", "fig3", "fig0"],
          in: ["fig1"],
          turn: "fig1",
          last: {},
        };
        return row;
      })(),
    }),
  },

  // ---------------------------------------------------------------------
  // Trading. `trade-compose`/`trade-outgoing`/`trade-accepted`/
  // `trade-declined` give Afo an extra tradable holding on top of the
  // default board (the default salmon set has houses on purpose, so it
  // alone can't demonstrate a tradable chip).
  // ---------------------------------------------------------------------

  "trade-compose": {
    label: "trade-compose",
    describe: "My turn, act phase: I own a tradable set plus a built-up one; two bots own tradable cells.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "act",
        // Ubisoft/EGS/Steam (#F56CC6), no houses: a whole tradable set on
        // top of the salmon set (12/14/15), which has houses and stays
        // non-tradable -- the brief's "one property whose set has houses".
        boardMutator: (board, own) => {
          own(27, "fig1");
          own(29, "fig1");
          own(30, "fig1");
        },
      }),
    }),
  },

  "trade-not-my-turn": {
    label: "trade-not-my-turn",
    describe: "Bot's turn: composing a trade must be refused by the client.",
    build: () => ({ row: baseRow({ currentOrder: 0, phase: "act" }) }),
  },

  "trade-incoming": {
    label: "trade-incoming",
    describe: "Pending offer from Koli: her Чинар for my $180, live-pushed ~600ms after load.",
    build: () => ({
      row: baseRow({ currentOrder: 2, phase: "act" }),
      intro: {
        delay: 600,
        trade: {
          status: "offered",
          data: { from: "fig2", to: "fig1", give: { cells: [9], cash: 0 }, get: { cells: [], cash: 180 } },
        },
      },
    }),
  },

  "trade-incoming-counter": {
    label: "trade-incoming-counter",
    describe: "Koli sends a counter-offer, live-pushed ~600ms after load.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "act" }),
      intro: {
        delay: 600,
        trade: {
          status: "countered",
          data: { from: "fig2", to: "fig1", give: { cells: [7], cash: 0 }, get: { cells: [], cash: 200 }, counter: true },
        },
      },
    }),
  },

  "trade-incoming-poor": {
    label: "trade-incoming-poor",
    describe: "Koli's incoming offer wants more cash than I have.",
    build: () => ({
      row: baseRow({ currentOrder: 2, phase: "act", playerOverrides: { afo: { money: 50 } } }),
      intro: {
        delay: 600,
        trade: {
          status: "offered",
          data: { from: "fig2", to: "fig1", give: { cells: [9], cash: 0 }, get: { cells: [], cash: 200 } },
        },
      },
    }),
  },

  "trade-expired": {
    label: "trade-expired",
    describe: "Incoming offer from Koli, but her Чинар changed hands before I can Accept (resolves to expired).",
    build: () => {
      const row = baseRow({
        currentOrder: 2,
        phase: "act",
        // Koli's offer still names cell 9, but it quietly changed hands to
        // Gaya after the offer was made -- exactly the "ownership changed
        // in between" case validation re-runs at accept time to catch.
        boardMutator: (board) => {
          board[9].bought.fig2 = false;
          board[9].bought.fig3 = true;
        },
      });
      row.game.trade = {
        id: 1,
        from: "fig2",
        to: "fig1",
        give: { cells: [9], cash: 0 },
        get: { cells: [], cash: 180 },
        counter: false,
      };
      return { row };
    },
  },

  "trade-outgoing": {
    label: "trade-outgoing",
    describe: "My offer to Koli is pending; she answers after a long ~8s delay (waiting banner).",
    build: () => {
      const row = baseRow({
        currentOrder: 1,
        phase: "act",
        boardMutator: (board, own) => own(36, "fig1"), // RailRoad "Carry", unowned by default
      });
      row.game.trade = {
        id: 1,
        from: "fig1",
        to: "fig2",
        give: { cells: [36], cash: 0 },
        get: { cells: [], cash: 150 },
        counter: false,
      };
      return { row, tradeBotDelayMs: 8000 };
    },
  },

  "trade-accepted": {
    label: "trade-accepted",
    describe: "Live result: Koli accepts my railroad-for-cash offer shortly after load.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "act", boardMutator: (board, own) => own(36, "fig1") }),
      intro: {
        delay: 700,
        trade: {
          status: "accepted",
          data: { from: "fig1", to: "fig2", give: { cells: [36], cash: 0 }, get: { cells: [], cash: 150 } },
        },
      },
    }),
  },

  "trade-declined": {
    label: "trade-declined",
    describe: "Live result: Koli declines my railroad-for-cash offer shortly after load.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "act", boardMutator: (board, own) => own(36, "fig1") }),
      intro: {
        delay: 700,
        trade: {
          status: "declined",
          data: { from: "fig1", to: "fig2", give: { cells: [36], cash: 0 }, get: { cells: [], cash: 150 } },
        },
      },
    }),
  },

  bankrupt: {
    label: "bankrupt",
    describe: "I am bankrupt, watching the rest play out.",
    build: () => ({
      row: baseRow({
        currentOrder: 2,
        phase: "roll",
        playerOverrides: { afo: { money: 0, bankrupt: true } },
      }),
    }),
  },

  "game-over-win": {
    label: "game-over-win",
    describe: "I am the last player standing.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "over",
        winner: "fig1",
        playerOverrides: {
          ero: { bankrupt: true, money: 0 },
          koli: { bankrupt: true, money: 0 },
          gaya: { bankrupt: true, money: 0 },
        },
      }),
    }),
  },

  "game-over-lose": {
    label: "game-over-lose",
    describe: "Someone else won.",
    build: () => ({
      row: baseRow({
        currentOrder: 0,
        phase: "over",
        winner: "fig0",
        playerOverrides: {
          afo: { bankrupt: true, money: 0 },
          koli: { bankrupt: true, money: 0 },
          gaya: { bankrupt: true, money: 0 },
        },
      }),
    }),
  },

  // ---------------------------------------------------------------------
  // Six seats. The room at the cap: six names in the player strip, two
  // tokens sharing cell 6, and holdings for every figure including the two
  // new ones (fig4 Bat, fig5 Mummy).
  // ---------------------------------------------------------------------

  "six-players": {
    label: "six-players",
    describe: "A full room: six players, fig0..fig5, my turn. Phone layout at full load.",
    build: () => ({ row: sixRow({ currentOrder: 1, phase: "roll" }) }),
  },

  "six-players-not-my-turn": {
    label: "six-players-not-my-turn",
    describe: "Full six-player room, the 6th seat (Mummy, fig5) is to move.",
    build: () => ({ row: sixRow({ currentOrder: 5, phase: "roll" }) }),
  },

  // ---------------------------------------------------------------------
  // Jail and doubles. The field is `game.doubles` (the count of consecutive
  // doubles THIS player has rolled); `Players[].inJail` / `.jailTurns` /
  // `.jailCards` are the per-player jail state. Events: roll{doubles:bool},
  // jail{reason:"gtj"|"card"|"doubles"}, jailStay{turn}, jailLeave{how:
  // "doubles"|"fee"|"pay"|"card"}, again{doubles}. See the jail/doubles
  // section of supabase/tests/auction_trade.test.mjs for the full contract.
  // ---------------------------------------------------------------------

  "jail-in-jail-card": {
    label: "jail-in-jail-card",
    describe: "I am in jail on my turn (1 turn served) holding a Get Out Of Jail Free card: roll / pay 50$ / use card.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 11, inJail: true, jailTurns: 1, jailCards: 1 } },
      }),
    }),
  },

  "jail-in-jail-no-card": {
    label: "jail-in-jail-no-card",
    describe: "In jail on my turn with no card and only 40$: the pay-50$ button must be refused.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 11, inJail: true, jailTurns: 1, jailCards: 0, money: 40 } },
      }),
    }),
  },

  "jail-in-jail-last-chance": {
    label: "jail-in-jail-last-chance",
    describe: "In jail, two turns already served: the next failed roll takes the 50$ fine and moves me anyway.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 11, inJail: true, jailTurns: 2, jailCards: 0 } },
      }),
    }),
  },

  "jail-gtj-cell": {
    label: "jail-gtj-cell",
    describe: 'Lands on "Go To Jail" (31) ~600ms after load: jail{reason:"gtj"}, no 200$ for passing Start.',
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll" }),
      intro: { actorId: PLAYER_IDS.afo, target: 31, delay: 600 },
    }),
  },

  "jail-doubles-1": {
    label: "jail-doubles-1",
    describe: "Rolls their 1st double ~600ms after load: game.doubles goes 0 -> 1, the turn stays mine.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll" }),
      intro: { actorId: PLAYER_IDS.afo, target: 21, forceDoubles: true, delay: 600 },
    }),
  },

  "jail-doubles-2": {
    label: "jail-doubles-2",
    describe: "Already on 1 double; rolls their 2nd ~600ms after load: game.doubles goes 1 -> 2.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        doubles: 1,
        dice: [4, 4],
        playerOverrides: { afo: { position: 21 } },
      }),
      intro: { actorId: PLAYER_IDS.afo, target: 25, forceDoubles: true, delay: 600 },
    }),
  },

  "jail-doubles-3": {
    label: "jail-doubles-3",
    describe: "Already on 2 doubles; the 3rd ~600ms after load goes straight to jail (no move by that roll) and game.doubles resets to 0.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        doubles: 2,
        dice: [5, 5],
        playerOverrides: { afo: { position: 25 } },
      }),
      intro: { actorId: PLAYER_IDS.afo, forceDoubles: true, delay: 600 },
    }),
  },

  loading: {
    label: "loading",
    describe: "The initial fetch never resolves.",
    build: () => ({ row: baseRow({ currentOrder: 1, phase: "roll" }), fetchMode: "hang" }),
  },

  "fetch-error": {
    label: "fetch-error",
    describe: "The initial fetch fails.",
    build: () => ({ row: baseRow({ currentOrder: 1, phase: "roll" }), fetchMode: "error" }),
  },

  "server-error": {
    label: "server-error",
    describe: 'The next action is rejected with "Not enough money".',
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll" }),
      errorNextAction: "Not enough money",
    }),
  },

  // ---------------------------------------------------------------------
  // TV-only scenarios (src/dev/tvHarness.jsx, tv-harness.html). "tv-" is a
  // stable prefix: mockDev exposes these separately as `tvScenarios` (see
  // mockSupabase.js) so the phone harness's dropdown above is unaffected.
  // ---------------------------------------------------------------------

  "tv-idle": {
    label: "tv-idle",
    describe: "4 players mid-game, a bot's turn, nothing happening yet.",
    build: () => ({ row: baseRow({ currentOrder: 0, phase: "roll" }) }),
  },

  "tv-my-turn": {
    label: "tv-my-turn",
    describe: "Afo's turn, ready to roll.",
    build: () => ({ row: baseRow({ currentOrder: 1, phase: "roll" }) }),
  },

  "tv-doubles": {
    label: "tv-doubles",
    describe: "Afo rolled doubles shortly after load: roll again.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 15 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 1, forceDoubles: true },
    }),
  },

  "tv-card-chance": {
    label: "tv-card-chance",
    describe: "A Chance card flies in from the deck ~700ms after load.",
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll", playerOverrides: { afo: { position: 5 } } }),
      intro: { actorId: PLAYER_IDS.afo, target: 8, forceCard: { deck: "chance", index: 0 }, delay: 700 },
    }),
  },

  "tv-card-chest": {
    label: "tv-card-chest",
    describe: "A Community Chest card flies in from the deck ~700ms after load.",
    build: () => ({
      row: baseRow({ currentOrder: 2, phase: "roll", playerOverrides: { koli: { position: 17 } } }),
      intro: { actorId: PLAYER_IDS.koli, target: 18, forceCard: { deck: "community", index: 0 }, delay: 700 },
    }),
  },

  "tv-auction-no-bids": {
    label: "tv-auction-no-bids",
    describe: "Auction just started on LOL, no bids yet.",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 1, phase: "auction", playerOverrides: { afo: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig1",
          bid: 0,
          leader: null,
          order: ["fig2", "fig3", "fig0", "fig1"],
          in: ["fig2", "fig3", "fig0", "fig1"],
          turn: "fig2",
          last: {},
        };
        return row;
      })(),
    }),
  },

  "tv-auction-leader": {
    label: "tv-auction-leader",
    describe: "An auction on LOL with a current high bidder.",
    build: () => ({
      row: (() => {
        const row = baseRow({ currentOrder: 2, phase: "auction", playerOverrides: { koli: { position: 24 } } });
        row.game.auction = {
          cell: 24,
          startedBy: "fig2",
          bid: 170,
          leader: "fig1",
          order: ["fig3", "fig0", "fig1", "fig2"],
          in: ["fig3", "fig0", "fig1", "fig2"],
          turn: "fig2",
          last: { fig3: 130, fig0: 150, fig1: 170 },
        };
        return row;
      })(),
    }),
  },

  "tv-trade-pending": {
    label: "tv-trade-pending",
    describe: "A bot-to-bot trade offer sits pending (long answer delay, for a screenshot).",
    build: () => {
      const row = baseRow({ currentOrder: 2, phase: "act", boardMutator: (board, own) => own(36, "fig2") });
      row.game.trade = { id: 1, from: "fig2", to: "fig0", give: { cells: [36], cash: 0 }, get: { cells: [], cash: 150 }, counter: false };
      return { row, tradeBotDelayMs: 15000 };
    },
  },

  "tv-trade-counter": {
    label: "tv-trade-counter",
    describe: "Live result: Koli sends Ero a counter-offer ~700ms after load.",
    build: () => ({
      row: baseRow({ currentOrder: 0, phase: "act" }),
      intro: {
        delay: 700,
        trade: {
          status: "countered",
          data: { from: "fig2", to: "fig0", give: { cells: [7], cash: 0 }, get: { cells: [], cash: 200 }, counter: true },
        },
      },
    }),
  },

  "tv-trade-accepted": {
    label: "tv-trade-accepted",
    describe: "Live result: a bot-to-bot trade is accepted ~700ms after load.",
    build: () => ({
      row: baseRow({ currentOrder: 0, phase: "act", boardMutator: (board, own) => own(36, "fig2") }),
      intro: {
        delay: 700,
        trade: { status: "accepted", data: { from: "fig2", to: "fig0", give: { cells: [36], cash: 0 }, get: { cells: [], cash: 150 } } },
      },
    }),
  },

  "tv-trade-declined": {
    label: "tv-trade-declined",
    describe: "Live result: a bot-to-bot trade is declined ~700ms after load.",
    build: () => ({
      row: baseRow({ currentOrder: 0, phase: "act", boardMutator: (board, own) => own(36, "fig2") }),
      intro: {
        delay: 700,
        trade: { status: "declined", data: { from: "fig2", to: "fig0", give: { cells: [36], cash: 0 }, get: { cells: [], cash: 150 } } },
      },
    }),
  },

  "tv-game-over": {
    label: "tv-game-over",
    describe: "Game over: Ero is the last player standing.",
    build: () => ({
      row: baseRow({
        currentOrder: 0,
        phase: "over",
        winner: "fig0",
        playerOverrides: {
          afo: { bankrupt: true, money: 0 },
          koli: { bankrupt: true, money: 0 },
          gaya: { bankrupt: true, money: 0 },
        },
      }),
    }),
  },

  "tv-two-players": {
    label: "tv-two-players",
    describe: "Only two players seated: Ero and Afo.",
    build: () => ({
      row: customRow({
        players: [
          { name: "Ero", figure: "fig0", money: 1800, position: 6, order: 0, playerId: PLAYER_IDS.ero, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
          { name: "Afo", figure: "fig1", money: 2100, position: 15, order: 1, playerId: PLAYER_IDS.afo, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false },
        ],
        currentOrder: 0,
        phase: "roll",
        boardMutator: (board) => {
          // Only two seats exist in this room: strip every other figure's
          // ownership so no cell is "owned" by a nonexistent player.
          for (const cell of Object.values(board)) {
            for (const f of FIGURES) {
              if (f === "fig0" || f === "fig1") continue;
              if (cell.bought) cell.bought[f] = false;
              cell[f] = false;
            }
          }
        },
      }),
    }),
  },

  "tv-rich": {
    label: "tv-rich",
    describe: "Worst case: all 28 ownable cells owned, full sets with houses/hotel, long Cyrillic names, one jailed, one bankrupt.",
    build: () => ({
      row: customRow({ players: richPlayers(), board: buildRichBoard(), currentOrder: 1, phase: "roll" }),
    }),
  },

  "tv-six-players": {
    label: "tv-six-players",
    describe: "A full room: six players, fig0..fig5, one of them jailed. The TV side panel at full load.",
    build: () => ({ row: sixRow({ currentOrder: 1, phase: "roll" }) }),
  },

  "tv-six-autoplay": {
    label: "tv-six-autoplay",
    describe: "All six seats are bots: a full-load game plays itself indefinitely, auctions and trades included.",
    build: () => ({
      row: customRow({
        players: autoplayPlayers(["ero", "afo", "koli", "gaya", "bat", "mummy"]),
        board: initialState(),
        currentOrder: 0,
        phase: "roll",
      }),
      autoplay: true,
    }),
  },

  "tv-jail-in-jail-card": {
    label: "tv-jail-in-jail-card",
    describe: "Afo is in jail on their turn holding a Get Out Of Jail Free card (TV jail badge + card count).",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        playerOverrides: { afo: { position: 11, inJail: true, jailTurns: 1, jailCards: 1 } },
      }),
    }),
  },

  "tv-jail-gtj-cell": {
    label: "tv-jail-gtj-cell",
    describe: 'Afo lands on "Go To Jail" (31) ~900ms after load: the token flies to 31 and then to Jail (11).',
    build: () => ({
      row: baseRow({ currentOrder: 1, phase: "roll" }),
      intro: { actorId: PLAYER_IDS.afo, target: 31, delay: 900 },
    }),
  },

  "tv-jail-doubles-3": {
    label: "tv-jail-doubles-3",
    describe: "Afo is on 2 doubles; the 3rd ~900ms after load sends them to jail without moving by that roll.",
    build: () => ({
      row: baseRow({
        currentOrder: 1,
        phase: "roll",
        doubles: 2,
        dice: [5, 5],
        playerOverrides: { afo: { position: 25 } },
      }),
      intro: { actorId: PLAYER_IDS.afo, forceDoubles: true, delay: 900 },
    }),
  },

  "tv-empty-room": {
    label: "tv-empty-room",
    describe: "The room exists but nobody has joined yet (empty-room hint).",
    build: () => ({
      row: {
        uuid: ROOM_UUID,
        position: upgradeCells(initialState()),
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
      },
    }),
  },

  "tv-no-room": {
    label: "tv-no-room",
    describe: "No room id anywhere (URL or localStorage) -- the Board's enter-code / Host screen.",
    noRoom: true,
    build: () => ({ row: null }),
  },

  "tv-moving": {
    label: "tv-moving",
    describe: "Ero moves 9 tiles (wrapping past Start) ~1s after load, then Koli moves 3 tiles ~2.4s after load -- flying-token animation.",
    build: () => ({
      row: baseRow({ currentOrder: 0, phase: "roll", playerOverrides: { ero: { position: 32 } } }),
      intro: [
        { actorId: PLAYER_IDS.ero, target: 1, delay: 1000 },
        { actorId: PLAYER_IDS.koli, target: 12, delay: 2400 },
      ],
    }),
  },

  "tv-autoplay": {
    label: "tv-autoplay",
    describe: "All four seats are bots: the game plays itself indefinitely (~1.2s beats), including auctions and occasional bot-to-bot trades.",
    build: () => ({
      row: customRow({ players: autoplayPlayers(), board: initialState(), currentOrder: 0, phase: "roll" }),
      autoplay: true,
    }),
  },
};

// ---------------------------------------------------------------------------
// Login-only scenarios (src/dev/loginHarness.jsx, login-harness.html). "login-"
// is a stable prefix, exactly like "tv-" above: mockDev exposes these as their
// own `loginScenarios` list so neither the phone nor the TV dropdown changes.
//
// The login screen reads almost nothing of a room: only `Players` (who is in,
// which figures are taken) and whether the row exists at all. So these rooms
// are built from a plain `initialState()` board and a short player list rather
// than the mid-game `baseRow()` the other scenarios share.
//
// Each carries a `login` block, which the harness writes to localStorage
// BEFORE the first render (the Login page reads `localStorage.roomId` and
// `localStorage.playerInfo` in a lazy useState initialiser):
//   roomCode    what shows up prefilled in the room-code field ("" = empty)
//   playerInfo  the returning-player record, or null to clear it
// ---------------------------------------------------------------------------

const LOGIN_SEATS = {
  ero: { name: "Ero", figure: "fig0", playerId: PLAYER_IDS.ero },
  afo: { name: "Afo", figure: "fig1", playerId: PLAYER_IDS.afo },
  koli: { name: "Koli", figure: "fig2", playerId: PLAYER_IDS.koli },
  gaya: { name: "Gaya", figure: "fig3", playerId: PLAYER_IDS.gaya },
  bat: { name: "Bat", figure: "fig4", playerId: PLAYER_IDS.bat },
  mummy: { name: "Mummy", figure: "fig5", playerId: PLAYER_IDS.mummy },
};

// A room nobody has played in yet: everyone on Start, 2500$, no ownership.
function lobbyRow(keys) {
  return customRow({
    players: keys.map((key, i) => ({
      ...LOGIN_SEATS[key],
      money: 2500,
      position: 1,
      order: i,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
    })),
    board: initialState(),
    currentOrder: 0,
    phase: "roll",
  });
}

const LOGIN_SCENARIOS = {
  "login-empty": {
    label: "login-empty",
    describe: "Nothing typed yet: no room code, no figure, no name.",
    login: { roomCode: "", playerInfo: null },
    build: () => ({ row: lobbyRow(["ero", "koli"]) }),
  },

  "login-open": {
    label: "login-open",
    describe: "Code prefilled, room found, nobody in it yet: every figure free.",
    login: { roomCode: ROOM_UUID, playerInfo: null },
    build: () => ({ row: lobbyRow([]) }),
  },

  "login-found": {
    label: "login-found",
    describe: "Code prefilled, room found with 2 of the 6 seats taken (Imp + Specter).",
    login: { roomCode: ROOM_UUID, playerInfo: null },
    build: () => ({ row: lobbyRow(["ero", "koli"]) }),
  },

  "login-not-found": {
    label: "login-not-found",
    describe: 'Code prefilled that no room answers to ("Room v6Pstf not found").',
    login: { roomCode: "v6Pstf", playerInfo: null },
    build: () => ({ row: lobbyRow(["ero", "koli"]) }),
  },

  "login-full": {
    label: "login-full",
    describe: "All six seats taken: the room is full even though fig6/fig7 are still unclaimed.",
    login: { roomCode: ROOM_UUID, playerInfo: null },
    build: () => ({ row: lobbyRow(["ero", "afo", "koli", "gaya", "bat", "mummy"]) }),
  },

  "login-five-seated": {
    label: "login-five-seated",
    describe: "Five of the six seats taken: one seat left, three figures still free to pick from.",
    login: { roomCode: ROOM_UUID, playerInfo: null },
    build: () => ({ row: lobbyRow(["ero", "afo", "koli", "gaya", "bat"]) }),
  },

  "login-returning": {
    label: "login-returning",
    describe: "localStorage.playerInfo matches a player in the room: rejoin, not join.",
    login: {
      roomCode: ROOM_UUID,
      playerInfo: { name: "Afo", figure: "fig1", money: 2500, position: 0, playerId: PLAYER_IDS.afo },
    },
    build: () => ({ row: lobbyRow(["ero", "afo", "koli"]) }),
  },

  "login-join-error": {
    label: "login-join-error",
    describe: 'The join is rejected: "Figure is already taken" (a bot took it a moment before).',
    login: { roomCode: ROOM_UUID, playerInfo: null },
    build: () => ({ row: lobbyRow(["ero", "koli"]), errorNextAction: "Figure is already taken" }),
  },

  "login-live-take": {
    label: "login-live-take",
    describe: "A second player joins ~1.5s after load and the Mummy (fig5) goes grey live.",
    login: { roomCode: ROOM_UUID, playerInfo: null },
    build: () => ({
      row: lobbyRow(["ero"]),
      intro: { delay: 1500, join: { name: "Mummy", figure: "fig5", playerId: PLAYER_IDS.mummy } },
    }),
  },
};

Object.assign(SCENARIOS, LOGIN_SCENARIOS);

const IS_TV = (n) => n.startsWith("tv-");
const IS_LOGIN = (n) => n.startsWith("login-");

export const SCENARIO_NAMES = Object.keys(SCENARIOS).filter((n) => !IS_TV(n) && !IS_LOGIN(n));
export const TV_SCENARIO_NAMES = Object.keys(SCENARIOS).filter(IS_TV);
export const LOGIN_SCENARIO_NAMES = Object.keys(SCENARIOS).filter(IS_LOGIN);
export const DEFAULT_SCENARIO = "my-roll";
export const DEFAULT_TV_SCENARIO = "tv-idle";
export const DEFAULT_LOGIN_SCENARIO = "login-found";
